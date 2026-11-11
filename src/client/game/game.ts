/**
 * Game core: owns the session (connection, prediction, interpolation), the main
 * loop, the inputs, and wires every client subsystem together (ARCHITECTURE §10).
 */
import * as THREE from 'three';
import { BTN, INTERP_DELAY_MS, PFLAG, TICK_DT, type TeamId } from '../../shared/constants';
import { ANNOUNCE, TEAMS } from '../../shared/identity';
import { getMap } from '../../shared/maps';
import type { SurfaceType } from '../../shared/maps/materials';
import type { MapData } from '../../shared/maps/types';
import { angleDiff, anglesFromDir, clamp, forwardFromAngles, lerpAngle, type Vec3 } from '../../shared/math/vec3';
import { CollisionWorld, MASK } from '../../shared/physics/world';
import { clonePlayerState, eyeHeight, MAX_PITCH, newStepEvents, stepPlayer } from '../../shared/player/step';
import { cmdToTuple, type Connection, type GameEvent, type S_Snapshot, type ServerMsg } from '../../shared/protocol';
import { rayPlayer } from '../../shared/sim/hitboxes';
import type { MatchState, PlayerInfo, PlayerState, RoomConfig, UserCmd } from '../../shared/types';
import { DEFAULT_LOADOUT, TEAM_DEFAULT_LOADOUT, WEAPONS, weaponFromIndex, type Loadout, type WeaponId } from '../../shared/weapons/defs';
import { currentSpread } from '../../shared/weapons/logic';
import { createAudio } from '../audio';
import type { HudFrame, IAudio, IAvatar, IEffects, IEngine, IHud, IViewModel } from '../core/contracts';
import { radiansPerCount, SettingsStore, type KeyAction } from '../core/settings';
import { LocalConnection, WsConnection } from '../net/connection';
import { createAvatar, preloadAvatarAssets } from '../render/avatar';
import { createEffects } from '../render/effects';
import { createEngine } from '../render/engine';
import { createViewModel } from '../render/viewmodel';
import { createHud } from '../ui/hud';
import { bindingLabel } from '../ui/keys';
import { createMenus, type MenusApi } from '../ui/menus';
import './base.css';

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: number;
  flags: number;
  w: number;
}

interface Remote {
  id: number;
  avatar: IAvatar | null;
  buf: Sample[];
  alive: boolean;
  pos: Vec3;
  yaw: number;
  pitch: number;
  weapon: WeaponId;
  speed: number;
  stride: number;
  seen: number;
  corpse: IAvatar | null;
  corpseUntil: number;
}

type Mode = 'menu' | 'loading' | 'playing';

const HELD: KeyAction[] = ['forward', 'back', 'left', 'right', 'jump', 'crouch', 'walk', 'fire', 'altFire', 'reload', 'use'];
const HELD_BTN: Record<string, number> = {
  forward: BTN.Forward,
  back: BTN.Back,
  left: BTN.Left,
  right: BTN.Right,
  jump: BTN.Jump,
  crouch: BTN.Crouch,
  walk: BTN.Walk,
  fire: BTN.Fire,
  altFire: BTN.AltFire,
  reload: BTN.Reload,
  use: BTN.Use,
};

export class Game {
  readonly settings = new SettingsStore();
  private engine: IEngine;
  private audio: IAudio;
  private hud: IHud;
  private menus: MenusApi;
  private viewmodel: IViewModel;
  private effects: IEffects;
  private canvas: HTMLCanvasElement;

  private mode: Mode = 'menu';
  private conn: Connection | null = null;
  private myId = -1;
  private roomCode: string | null = null;
  private hostId = -1;
  private config: RoomConfig | null = null;
  private match: MatchState | null = null;
  private roster = new Map<number, PlayerInfo>();
  private map: MapData | null = null;
  private world: CollisionWorld | null = null;
  private loadToken = 0;

  // Local player (prediction)
  private me: PlayerState | null = null;
  private pending: UserCmd[] = [];
  private seq = 0;
  private prevPos: Vec3 = { x: 0, y: 0, z: 0 };
  private err: Vec3 = { x: 0, y: 0, z: 0 };
  private smoothY = 0;
  private viewYaw = 0;
  private viewPitch = 0;
  private frameDYaw = 0;
  private frameDPitch = 0;
  private acc = 0;
  private ev = newStepEvents();
  private scratchEv = newStepEvents();
  private wantSlot = -1;
  private lastSlot = 1;
  private stride = 0;
  private landDip = 0;
  private fov = 74;
  private ads = 0;
  private respawnAt = 0;
  private deathPos: Vec3 | null = null;
  private selfCorpse: IAvatar | null = null;
  private loadout: Loadout = { ...DEFAULT_LOADOUT };
  private vmWeapon: WeaponId | null = null;

  // Remote players
  private remotes = new Map<number, Remote>();
  private clockOffset = 0;
  private clockInit = false;
  private rtt = 0;
  private lastPing = 0;

  // Input
  private keyToActions = new Map<string, KeyAction[]>();
  private held = new Set<KeyAction>();
  private locked = false;
  private fakeLock = false;
  /** Pointer lock refused by the host page: aim with plain mouse movement instead. */
  private softLock = false;
  /** Published as a single page (no game server): solo only. */
  private readonly standalone = (window as unknown as { __BAS_STANDALONE__?: boolean }).__BAS_STANDALONE__ === true;
  /** Demonstration: spectate a bot match (phones, or #demo). */
  private demo = false;
  private followId = -1;
  private followUntil = 0;
  private chatOpen = false;
  private lockTries = 0;
  private showScores = false;

  private last = performance.now();
  private fps = 60;
  private light = new THREE.Color(1, 1, 1);
  private tmpV = new THREE.Vector3();
  private tmpC = new THREE.Color();

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement, menusRoot: HTMLElement) {
    this.canvas = canvas;
    this.engine = createEngine(canvas, this.settings);
    this.audio = createAudio(this.settings);
    this.viewmodel = createViewModel();
    this.engine.viewScene.add(this.viewmodel.root);
    this.viewmodel.setVisible(false);
    this.effects = createEffects(this.engine);
    this.hud = createHud(hudRoot, this.settings, {
      chatSubmit: (text, teamOnly) => this.conn?.send({ t: 'chat', text, team: teamOnly }),
      chatFocus: (open) => {
        this.chatOpen = open;
        this.held.clear();
      },
    });
    this.menus = createMenus(menusRoot, this.settings, {
      playSolo: (cfg) => this.connect(new LocalConnection(cfg, this.playerName())),
      createRoom: (cfg) => {
        if (this.standalone) return this.menus.toast('Le multijoueur nécessite le serveur du jeu (voir le dépôt GitHub). Ici : solo contre les bots.', 'info');
        this.connect(new WsConnection(this.wsUrl(), { name: this.playerName(), create: cfg }));
      },
      joinRoom: (code) => {
        if (this.standalone) return this.menus.toast('Le multijoueur nécessite le serveur du jeu (voir le dépôt GitHub). Ici : solo contre les bots.', 'info');
        this.connect(new WsConnection(this.wsUrl(), { name: this.playerName(), room: code }));
      },
      resume: () => {
        this.menus.hide();
        this.lock();
      },
      leave: () => this.leave(),
      pickTeam: (team) => {
        this.conn?.send({ t: 'team', team });
        this.menus.hide();
        this.lock();
      },
      pickLoadout: (l) => {
        this.loadout = l;
        this.conn?.send({ t: 'loadout', primary: l.primary, secondary: l.secondary });
        this.hud.toast('Armes choisies : appliquées à la prochaine réapparition.');
        this.menus.hide();
        this.lock();
      },
      hostConfig: (patch, restart) => this.conn?.send({ t: 'config', patch, restart }),
      uiSound: (kind) => this.audio.ui(kind),
    });
    this.rebuildKeys();
    this.settings.onChange(() => {
      this.rebuildKeys();
      this.engine.applySettings();
      this.audio.applySettings();
    });
    this.bindInput();
    const code = new URLSearchParams(location.search).get('room') ?? undefined;
    this.menus.showMain(code ? { joinCode: code } : undefined);
    if (code) this.menus.navigate('join');
    this.hud.update(this.hudFrame(false));
    if (new URLSearchParams(location.search).has('debug')) this.installDebug();
    requestAnimationFrame(this.frame);
    // Phones cannot play (keyboard + mouse game): show a bot match instead.
    if (location.hash === '#demo' || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) this.startDemo();
  }

  private startDemo(): void {
    this.demo = true;
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) this.settings.update({ quality: 'medium', resolutionScale: 0.75 });
    this.connect(new LocalConnection({ botFill: 10, botDifficulty: 2, freezeTime: 2, roundsToWin: 9, killLimit: 0, roundTime: 900 }, 'Spectateur'));
  }

  // ------------------------------------------------------------------ session

  private playerName(): string {
    return this.settings.value.playerName.trim() || 'Joueur';
  }

  private wsUrl(): string {
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  }

  private connect(conn: Connection): void {
    this.conn?.close();
    this.resetSession();
    this.conn = conn;
    this.mode = 'loading';
    this.menus.showLoading(conn.local ? 'Préparation de la partie…' : 'Connexion au serveur…', 0.02);
    conn.onMessage = (m) => this.onMessage(m);
    conn.onClose = (reason) => {
      if (this.conn !== conn) return;
      this.conn = null;
      this.toMenu(reason);
    };
  }

  private resetSession(): void {
    for (const r of this.remotes.values()) {
      r.avatar?.dispose();
      r.corpse?.dispose();
    }
    this.remotes.clear();
    this.selfCorpse?.dispose();
    this.selfCorpse = null;
    this.roster.clear();
    this.me = null;
    this.pending = [];
    this.seq = 0;
    this.myId = -1;
    this.match = null;
    this.config = null;
    this.roomCode = null;
    this.clockInit = false;
    this.deathPos = null;
    this.held.clear();
    this.effects.clear();
  }

  private leave(): void {
    const c = this.conn;
    this.conn = null;
    c?.close();
    this.toMenu();
  }

  private toMenu(error?: string): void {
    this.loadToken++;
    this.mode = 'menu';
    this.resetSession();
    this.engine.unloadMap();
    this.map = null;
    this.world = null;
    this.viewmodel.setVisible(false);
    this.audio.ambience(null);
    if (document.pointerLockElement) document.exitPointerLock();
    this.hud.setScoreboardVisible(false);
    this.hud.update(this.hudFrame(false));
    this.menus.showMain(error ? { error } : undefined);
  }

  private async loadMap(mapId: string): Promise<void> {
    const token = ++this.loadToken;
    this.mode = 'loading';
    this.menus.showLoading('Chargement de la carte…', 0.05);
    this.hud.update(this.hudFrame(false));
    if (document.pointerLockElement) document.exitPointerLock();
    await new Promise((r) => setTimeout(r, 30));
    const map = getMap(mapId);
    const world = new CollisionWorld(map.solids);
    if (this.settings.value.quality !== 'low') await Promise.race([preloadAvatarAssets(), new Promise((r) => setTimeout(r, 15000))]);
    await this.engine.loadMap(map, world, (f, label) => {
      if (token === this.loadToken) this.menus.showLoading(label, 0.05 + f * 0.95);
    });
    if (token !== this.loadToken) return;
    this.map = map;
    this.world = world;
    this.effects.clear();
    for (const r of this.remotes.values()) {
      r.buf.length = 0;
    }
    this.me = null;
    this.pending = [];
    this.hud.setMap(map);
    this.refreshRoster();
    this.audio.music(null);
    this.audio.ambience(map.env.sunIntensity > 0.4 ? 'city' : 'interior');
    this.mode = 'playing';
    this.menus.hide();
    if (this.demo) {
      this.hud.toast('Démonstration : match de bots. Le jeu se joue sur ordinateur, au clavier et à la souris.');
      return;
    }
    this.lock();
    this.hud.toast('Cliquez dans le jeu pour capturer la souris — Échap pour le menu.');
  }

  // ------------------------------------------------------------------ network

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome':
        this.myId = m.id;
        this.roomCode = this.conn?.local ? null : m.room;
        this.hostId = m.hostId;
        this.config = m.config;
        this.match = m.match;
        this.setRoster(m.players);
        this.clockOffset = m.time - performance.now();
        this.clockInit = true;
        if (this.demo) this.conn?.send({ t: 'team', team: 2 });
        void this.loadMap(m.config.mapId);
        break;
      case 'error':
        this.conn?.close();
        this.conn = null;
        this.toMenu(m.msg);
        break;
      case 'roster':
        this.hostId = m.hostId;
        this.setRoster(m.players);
        break;
      case 'match': {
        const prevMap = this.config?.mapId;
        this.match = m.match;
        if (m.config) this.config = m.config;
        if (m.config && m.config.mapId !== prevMap) void this.loadMap(m.config.mapId);
        this.refreshRoster();
        break;
      }
      case 'chat': {
        const team = m.from < 0 ? -1 : (m.team as TeamId);
        this.hud.chatMessage(m.from < 0 ? '' : m.name, team, m.text, m.teamOnly);
        if (m.from >= 0) this.audio.ui('chat');
        break;
      }
      case 'pong':
        this.rtt = Math.max(0, performance.now() - m.c);
        break;
      case 's':
        if (this.mode === 'playing') this.onSnapshot(m);
        break;
    }
  }

  private setRoster(players: PlayerInfo[]): void {
    this.roster.clear();
    for (const p of players) this.roster.set(p.id, p);
    // Drop avatars of players who left or changed team.
    for (const [id, r] of this.remotes) {
      if (!this.roster.has(id)) {
        r.avatar?.dispose();
        r.corpse?.dispose();
        this.remotes.delete(id);
      }
    }
    this.refreshRoster();
  }

  private refreshRoster(): void {
    if (!this.match) return;
    this.hud.setRoster([...this.roster.values()], this.myId, this.match);
    const counts: [number, number] = [0, 0];
    for (const p of this.roster.values()) if (p.team === 0 || p.team === 1) counts[p.team]++;
    this.menus.setTeamInfo({ counts, current: this.myTeam(), mode: this.match.mode });
    this.menus.setLoadoutInfo(this.loadout, this.myTeam());
  }

  private myTeam(): TeamId {
    return this.roster.get(this.myId)?.team ?? 2;
  }

  private name(id: number): string {
    return this.roster.get(id)?.name ?? '?';
  }

  private onSnapshot(m: S_Snapshot): void {
    const world = this.world;
    if (!world) return;
    const now = performance.now();
    const off = m.time - now;
    if (!this.clockInit) {
      this.clockOffset = off;
      this.clockInit = true;
    } else if (Math.abs(off - this.clockOffset) > 500) this.clockOffset = off;
    else this.clockOffset += (off - this.clockOffset) * 0.05;

    // --- local player: reconcile ---
    if (m.you) {
      const st = m.you;
      let i = 0;
      while (i < this.pending.length && this.pending[i]!.seq <= m.ack) i++;
      if (i > 0) this.pending.splice(0, i);
      for (const c of this.pending) stepPlayer(st, c, world, this.scratchEv);
      if (!this.me) {
        // (Re)spawn.
        this.viewYaw = st.yaw;
        this.viewPitch = 0;
        this.prevPos = { ...st.pos };
        this.smoothY = st.pos.y;
        this.err = { x: 0, y: 0, z: 0 };
        this.deathPos = null;
        this.selfCorpse?.dispose();
        this.selfCorpse = null;
        this.vmWeapon = null;
        this.audio.feedback('respawn');
        const t = this.myTeam();
        if (t !== 2 && this.loadout.primary === DEFAULT_LOADOUT.primary && st.slots[0]) this.loadout = { ...TEAM_DEFAULT_LOADOUT[t], primary: st.slots[0].id };
      } else {
        const ex = this.me.pos.x - st.pos.x;
        const ey = this.me.pos.y - st.pos.y;
        const ez = this.me.pos.z - st.pos.z;
        const e2 = ex * ex + ey * ey + ez * ez;
        if (e2 > 1e-10 && e2 < 4) {
          this.err.x += ex;
          this.err.y += ey;
          this.err.z += ez;
          this.prevPos.x -= ex;
          this.prevPos.y -= ey;
          this.prevPos.z -= ez;
        } else if (e2 >= 4) {
          this.prevPos = { ...st.pos };
          this.smoothY = st.pos.y;
          this.err = { x: 0, y: 0, z: 0 };
        }
      }
      this.me = st;
    } else {
      if (this.me) this.onLocalDeath();
      this.pending.length = 0;
      this.respawnAt = m.rs ?? 0;
    }

    // --- remote players ---
    for (const t of m.p) {
      let r = this.remotes.get(t[0]);
      if (!r) {
        r = {
          id: t[0],
          avatar: null,
          buf: [],
          alive: true,
          pos: { x: t[1], y: t[2], z: t[3] },
          yaw: t[4],
          pitch: t[5],
          weapon: weaponFromIndex(t[8]),
          speed: 0,
          stride: 0,
          seen: 0,
          corpse: null,
          corpseUntil: 0,
        };
        this.remotes.set(t[0], r);
      }
      const last = r.buf[r.buf.length - 1];
      // A big jump means a respawn: do not interpolate across it.
      if (!r.alive || (last && Math.hypot(last.x - t[1], last.z - t[3]) > 6)) r.buf.length = 0;
      r.alive = true;
      r.seen = m.n;
      r.buf.push({ t: m.time, x: t[1], y: t[2], z: t[3], yaw: t[4], pitch: t[5], crouch: t[6], flags: t[7], w: t[8] });
      if (r.buf.length > 24) r.buf.shift();
    }
    for (const r of this.remotes.values()) {
      if (r.alive && r.seen !== m.n) {
        r.alive = false;
        r.buf.length = 0;
      }
    }
    for (const e of m.ev) this.onEvent(e);
  }

  private onLocalDeath(): void {
    const me = this.me;
    if (!me) return;
    this.deathPos = { ...me.pos };
    this.me = null;
    this.viewmodel.setVisible(false);
    this.vmWeapon = null;
    this.audio.feedback('death');
    const info = this.roster.get(this.myId);
    if (info && info.team !== 2) {
      const a = createAvatar(info.team, info.name);
      this.engine.scene.add(a.root);
      const slot = me.slots[me.active];
      a.update({ dt: 0.016, pos: me.pos, yaw: me.yaw, pitch: 0, crouch: me.crouch, speed: 0, onGround: true, weapon: slot ? slot.id : 'knife', reloading: false, carrying: false, protected: false, light: this.light });
      a.die(forwardFromAngles(me.yaw + Math.PI, 0));
      this.selfCorpse = a;
    }
  }

  private onEvent(e: GameEvent): void {
    const world = this.world!;
    switch (e.e) {
      case 'shot': {
        const w = weaponFromIndex(e.w);
        const def = WEAPONS[w];
        const o = { x: e.o[0], y: e.o[1], z: e.o[2] };
        if (e.id !== this.myId && e.d.length) {
          const r = this.remotes.get(e.id);
          const from = r?.avatar ? r.avatar.getMuzzle(this.tmpV) : this.tmpV.set(o.x, o.y - 0.15, o.z);
          const start = { x: from.x, y: from.y, z: from.z };
          r?.avatar?.onFire();
          this.audio.shot(w, o);
          this.effects.muzzleFlash(start, { x: e.d[0]!, y: e.d[1]!, z: e.d[2]! }, w);
          for (let i = 0; i + 2 < e.d.length; i += 3) {
            const d = { x: e.d[i]!, y: e.d[i + 1]!, z: e.d[i + 2]! };
            const hit = world.raycast(o, d, def.range, MASK.Bullet);
            const dist = hit ? hit.dist : Math.min(def.range, 120);
            const end = { x: o.x + d.x * dist, y: o.y + d.y * dist, z: o.z + d.z * dist };
            this.effects.tracer(start, end, w);
            if (hit && def.kind !== 'melee') {
              this.effects.impact(hit.point, hit.normal, hit.surf);
              if (i === 0) this.audio.impact(hit.surf, hit.point);
            }
          }
        }
        if (e.h) {
          for (let i = 0; i + 3 < e.h.length; i += 4) {
            const p = { x: e.h[i + 1]!, y: e.h[i + 2]!, z: e.h[i + 3]! };
            const d = { x: p.x - o.x, y: 0, z: p.z - o.z };
            const l = Math.hypot(d.x, d.z) || 1;
            this.effects.blood(p, { x: d.x / l, y: 0.2, z: d.z / l });
            if (e.h[i] !== this.myId) this.audio.bodyHit(p, false);
          }
        }
        break;
      }
      case 'hit':
        this.hud.hitMarker(e.hg === 1, e.kill);
        this.audio.feedback(e.kill ? 'kill' : e.hg === 1 ? 'headshot' : 'hitmarker');
        break;
      case 'hurt': {
        const cam = this.engine.camera.position;
        const a = anglesFromDir({ x: e.from[0] - cam.x, y: 0, z: e.from[2] - cam.z });
        if (e.attacker >= 0) this.hud.damageFrom(angleDiff(this.viewYaw, a.yaw), e.dmg);
        this.audio.feedback('hurt');
        break;
      }
      case 'kill': {
        const k = this.roster.get(e.killer);
        const v = this.roster.get(e.victim);
        this.hud.pushKill({
          killer: k ? k.name : '',
          killerTeam: k ? k.team : 2,
          victim: v ? v.name : '?',
          victimTeam: v ? v.team : 2,
          weapon: e.w >= 0 ? weaponFromIndex(e.w) : null,
          headshot: e.hs,
          involvesLocal: e.killer === this.myId || e.victim === this.myId,
        });
        const r = this.remotes.get(e.victim);
        if (r?.avatar) {
          const kr = this.remotes.get(e.killer);
          const from = e.killer === this.myId ? this.engine.camera.position : kr ? kr.pos : r.pos;
          r.avatar.die({ x: r.pos.x - from.x, y: 0, z: r.pos.z - from.z });
          r.corpse?.dispose();
          r.corpse = r.avatar;
          r.corpseUntil = performance.now() + 8000;
          r.avatar = null;
          r.alive = false;
          r.buf.length = 0;
        }
        break;
      }
      case 'announce': {
        const a = ANNOUNCE[e.key];
        if (!a) break;
        const mine = this.myTeam();
        let tone: 'neutral' | 'good' | 'bad' = 'neutral';
        const win = /_win_(\d)$/.exec(e.key);
        if (win && mine !== 2) tone = Number(win[1]) === mine ? 'good' : 'bad';
        const sub = e.id !== undefined ? this.name(e.id) : a.sub;
        this.hud.announce(a.title, sub, tone);
        this.audio.announce(e.key);
        if (win) this.audio.feedback(tone === 'bad' ? 'round_lose' : 'round_win');
        else if (e.key.startsWith('round_start')) this.audio.feedback('round_start');
        break;
      }
      case 'obj':
        this.audio.objective(e.kind, e.pos ? { x: e.pos[0], y: e.pos[1], z: e.pos[2] } : null);
        break;
      case 'spawn':
        break;
    }
  }

  // ------------------------------------------------------------------ input

  private rebuildKeys(): void {
    this.keyToActions.clear();
    const keys = this.settings.value.keys;
    for (const action of Object.keys(keys) as KeyAction[]) {
      for (const code of keys[action]) {
        const list = this.keyToActions.get(code) ?? [];
        list.push(action);
        this.keyToActions.set(code, list);
      }
    }
  }

  private get capturing(): boolean {
    return this.mode === 'playing' && (this.locked || this.fakeLock || this.softLock) && this.menus.current === null && !this.chatOpen;
  }

  private lock(): void {
    if (this.mode !== 'playing' || this.fakeLock) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch {
      /* needs a user gesture: the player clicks the canvas */
    }
    // Some host pages refuse pointer lock altogether: fall back to plain mouse movement.
    if (this.standalone) {
      window.setTimeout(() => {
        if (this.mode === 'playing' && !this.locked && this.lockTries++ >= 1 && !this.softLock) {
          this.softLock = true;
          this.hud.toast('Capture de la souris indisponible ici : visez en déplaçant la souris, Échap pour le menu.');
        }
      }, 400);
    }
  }

  private press(code: string, down: boolean): boolean {
    const actions = this.keyToActions.get(code);
    if (!actions) return false;
    for (const a of actions) {
      if (HELD.includes(a)) {
        if (down) this.held.add(a);
        else this.held.delete(a);
        continue;
      }
      if (a === 'scoreboard') {
        this.showScores = down;
        this.hud.setScoreboardVisible(down);
        continue;
      }
      if (!down) continue;
      switch (a) {
        case 'slot1':
          this.wantSlot = 0;
          break;
        case 'slot2':
          this.wantSlot = 1;
          break;
        case 'slot3':
          this.wantSlot = 2;
          break;
        case 'lastWeapon':
          this.wantSlot = this.lastSlot;
          break;
        case 'chat':
          this.hud.openChat(false);
          break;
        case 'teamChat':
          this.hud.openChat(true);
          break;
        case 'loadout':
          if (document.pointerLockElement) document.exitPointerLock();
          this.menus.showLoadout(this.loadout, this.myTeam());
          break;
        case 'teamMenu': {
          if (document.pointerLockElement) document.exitPointerLock();
          const counts: [number, number] = [0, 0];
          for (const p of this.roster.values()) if (p.team === 0 || p.team === 1) counts[p.team]++;
          this.menus.showTeamSelect({ counts, current: this.myTeam(), mode: this.match?.mode ?? 'tdm' });
          break;
        }
        default:
          break;
      }
    }
    return true;
  }

  private bindInput(): void {
    const unlock = (): void => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', () => {
      if (this.mode === 'menu') this.audio.music('menu');
    }, { once: true });

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.held.clear();
        this.showScores = false;
        this.hud.setScoreboardVisible(false);
        if (was && this.mode === 'playing' && this.menus.current === null && !this.chatOpen) this.showPause();
      }
    });
    this.canvas.addEventListener('click', () => {
      if (this.mode === 'playing' && this.menus.current === null && !this.locked && !this.demo) this.lock();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.capturing || !(this.locked || this.softLock)) return;
      const s = this.settings.value;
      const zoom = this.me && (this.me.zoom > 0 || this.ads > 0.5) ? s.zoomSensitivity * (this.fov / s.fov) : 1;
      const k = radiansPerCount(s.sensitivity) * zoom;
      this.look(-e.movementX * k, -e.movementY * k * (s.invertY ? -1 : 1));
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.softLock && this.mode === 'playing' && this.menus.current === null && !this.chatOpen) {
        this.softLock = false;
        this.lockTries = 0;
        this.held.clear();
        this.showPause();
        return;
      }
      if (!this.capturing) return;
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      if (this.press(e.code, true) || e.code === 'Tab' || e.code === 'Space' || e.ctrlKey) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.press(e.code, false);
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.capturing) this.press(`Mouse${e.button}`, true);
    });
    window.addEventListener('mouseup', (e) => this.press(`Mouse${e.button}`, false));
    window.addEventListener('contextmenu', (e) => {
      if (this.mode === 'playing') e.preventDefault();
    });
    window.addEventListener('wheel', (e) => {
      if (!this.capturing || !this.me) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      for (let i = 1; i <= 3; i++) {
        const s = (this.me.active + dir * i + 3) % 3;
        if (this.me.slots[s]) {
          this.wantSlot = s;
          break;
        }
      }
    }, { passive: true });
    window.addEventListener('blur', () => this.held.clear());
    window.addEventListener('beforeunload', (e) => {
      if (this.mode === 'playing' && this.conn && !this.conn.local) e.preventDefault();
    });
    window.addEventListener('resize', () => this.engine.resize());
  }

  private look(dyaw: number, dpitch: number): void {
    this.viewYaw += dyaw;
    this.viewPitch = clamp(this.viewPitch + dpitch, -MAX_PITCH, MAX_PITCH);
    this.frameDYaw += dyaw;
    this.frameDPitch += dpitch;
  }

  private showPause(): void {
    if (!this.config) return;
    this.menus.showPause({
      roomCode: this.roomCode,
      shareUrl: this.roomCode ? `${location.origin}${location.pathname}?room=${this.roomCode}` : null,
      isHost: this.hostId === this.myId,
      config: this.config,
      local: this.conn?.local ?? true,
    });
  }

  private buttons(): number {
    let b = 0;
    if (this.capturing) for (const a of this.held) b |= HELD_BTN[a] ?? 0;
    return b;
  }

  // ------------------------------------------------------------------ simulation tick

  private surfaceUnder(p: Vec3): SurfaceType {
    const hit = this.world?.raycast({ x: p.x, y: p.y + 0.3, z: p.z }, { x: 0, y: -1, z: 0 }, 1.2, MASK.Player);
    return hit ? hit.surf : 'concrete';
  }

  private tick(): void {
    const me = this.me;
    const world = this.world;
    if (!me || !world || !this.conn) return;
    const cmd: UserCmd = {
      seq: ++this.seq,
      buttons: this.buttons(),
      yaw: this.viewYaw,
      pitch: this.viewPitch,
      slot: this.wantSlot,
      st: performance.now() + this.clockOffset - INTERP_DELAY_MS,
    };
    this.wantSlot = -1;
    this.prevPos.x = me.pos.x;
    this.prevPos.y = me.pos.y;
    this.prevPos.z = me.pos.z;
    const prevActive = me.active;
    const ev = this.ev;
    stepPlayer(me, cmd, world, ev);
    this.pending.push(cmd);
    if (this.pending.length > 128) this.pending.shift();
    this.conn.send({ t: 'c', c: [cmdToTuple(cmd)] });

    const slot = me.slots[me.active];
    const wid: WeaponId = slot ? slot.id : 'knife';
    const def = WEAPONS[wid];
    if (ev.switched) {
      this.lastSlot = prevActive;
      this.viewmodel.setWeapon(wid);
      this.vmWeapon = wid;
      this.viewmodel.onDraw(def.drawTime);
      this.audio.draw(wid, null);
    }
    if (ev.fired) {
      this.viewmodel.onFire();
      this.audio.shot(wid, null);
      const cam = this.engine.camera;
      const mz = this.viewmodel.getMuzzle(this.tmpV);
      cam.updateMatrixWorld();
      mz.applyMatrix4(cam.matrixWorld);
      const start = { x: mz.x, y: mz.y, z: mz.z };
      const o = ev.fired.origin;
      let first = true;
      for (const d of ev.fired.dirs) {
        const hit = world.raycast(o, d, def.range, MASK.Bullet);
        let dist = hit ? hit.dist : Math.min(def.range, 120);
        let body = false;
        for (const r of this.remotes.values()) {
          if (!r.alive || !r.avatar) continue;
          const h = rayPlayer(o, d, dist, r.pos, 0);
          if (h) {
            dist = h.dist;
            body = true;
          }
        }
        if (def.kind !== 'melee') {
          this.effects.tracer(start, { x: o.x + d.x * dist, y: o.y + d.y * dist, z: o.z + d.z * dist }, wid);
          if (hit && !body) {
            this.effects.impact(hit.point, hit.normal, hit.surf);
            if (first) this.audio.impact(hit.surf, hit.point);
          }
        }
        first = false;
      }
    }
    if (ev.dryFire) {
      this.viewmodel.onDryFire();
      this.audio.dryFire(null);
    }
    if (ev.reloadStarted) {
      this.viewmodel.onReload(def.reloadTime);
      this.audio.reload(wid, def.reloadTime, null);
    }
    if (ev.zoomChanged) this.audio.zoom();
    if (ev.jumped) this.audio.jump(null);
    if (ev.landedSpeed > 2.5) {
      this.audio.land(this.surfaceUnder(me.pos), ev.landedSpeed, null);
      this.landDip = Math.min(1, ev.landedSpeed / 9);
    }
    // Footsteps (silent when walking slowly or crouched).
    const sp = Math.hypot(me.vel.x, me.vel.z);
    if (me.onGround && sp > 3.3) {
      this.stride += sp * TICK_DT;
      if (this.stride > 2.3) {
        this.stride = 0;
        this.audio.footstep(this.surfaceUnder(me.pos), null, 0.7);
      }
    } else if (sp < 0.5) this.stride = 1.6;
  }

  // ------------------------------------------------------------------ frame

  private frame = (): void => {
    requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;

    if (this.mode === 'playing' && this.world) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK_DT && n++ < 16) {
        this.acc -= TICK_DT;
        this.tick();
      }
      if (this.acc > TICK_DT * 16) this.acc = 0;
      if (this.conn && now - this.lastPing > 2000) {
        this.lastPing = now;
        this.conn.send({ t: 'ping', c: now, rtt: Math.round(this.rtt) });
      }
      this.updateRemotes(now, dt);
      this.updateCamera(dt);
      this.effects.update(dt);
      const cam = this.engine.camera;
      const f = cam.getWorldDirection(this.tmpV);
      this.audio.setListener(cam.position, { x: f.x, y: f.y, z: f.z });
      this.hud.update(this.hudFrame(true));
    }
    this.frameDYaw = 0;
    this.frameDPitch = 0;
    this.engine.render();
  };

  private updateRemotes(now: number, dt: number): void {
    const rt = now + this.clockOffset - INTERP_DELAY_MS;
    for (const r of this.remotes.values()) {
      if (r.corpse) {
        r.corpse.update({ dt, pos: r.pos, yaw: 0, pitch: 0, crouch: 0, speed: 0, onGround: true, weapon: r.weapon, reloading: false, carrying: false, protected: false, light: this.light });
        if (now > r.corpseUntil) {
          r.corpse.dispose();
          r.corpse = null;
        }
      }
      if (!r.alive || r.buf.length === 0) {
        if (r.avatar) r.avatar.root.visible = false;
        continue;
      }
      const info = this.roster.get(r.id);
      if (!r.avatar) {
        if (!info || info.team === 2) continue;
        r.avatar = createAvatar(info.team, info.name);
        this.engine.scene.add(r.avatar.root);
      }
      r.avatar.root.visible = true;
      const b = r.buf;
      let a = b[0]!;
      let c = b[0]!;
      for (let i = b.length - 1; i >= 0; i--) {
        if (b[i]!.t <= rt) {
          a = b[i]!;
          c = b[Math.min(i + 1, b.length - 1)]!;
          break;
        }
      }
      let f = c.t > a.t ? (rt - a.t) / (c.t - a.t) : 0;
      f = clamp(f, 0, 1.5); // small extrapolation when starved
      const px = r.pos.x;
      const pz = r.pos.z;
      r.pos.x = a.x + (c.x - a.x) * f;
      r.pos.y = a.y + (c.y - a.y) * f;
      r.pos.z = a.z + (c.z - a.z) * f;
      r.yaw = lerpAngle(a.yaw, c.yaw, Math.min(1, f));
      r.pitch = a.pitch + (c.pitch - a.pitch) * Math.min(1, f);
      r.weapon = weaponFromIndex(c.w);
      const sp = dt > 0 ? Math.hypot(r.pos.x - px, r.pos.z - pz) / dt : 0;
      r.speed += (Math.min(sp, 9) - r.speed) * Math.min(1, dt * 10);
      const ground = (c.flags & PFLAG.OnGround) !== 0;
      this.engine.sampleLight(r.pos, this.tmpC);
      r.avatar.update({
        dt,
        pos: r.pos,
        yaw: r.yaw,
        pitch: r.pitch,
        crouch: a.crouch + (c.crouch - a.crouch) * Math.min(1, f),
        speed: r.speed,
        onGround: ground,
        weapon: r.weapon,
        reloading: (c.flags & PFLAG.Reloading) !== 0,
        carrying: (c.flags & PFLAG.Carrying) !== 0,
        protected: (c.flags & PFLAG.Protected) !== 0,
        light: this.tmpC,
      });
      if (ground && r.speed > 3.3) {
        r.stride += r.speed * dt;
        if (r.stride > 2.3) {
          r.stride = 0;
          this.audio.footstep(this.surfaceUnder(r.pos), { x: r.pos.x, y: r.pos.y, z: r.pos.z }, 0.8);
        }
      }
    }
  }

  private updateCamera(dt: number): void {
    const cam = this.engine.camera;
    const s = this.settings.value;
    const me = this.me;
    let targetFov = s.fov;
    if (me) {
      const a = clamp(this.acc / TICK_DT, 0, 1);
      const k = Math.exp(-dt * 14);
      this.err.x *= k;
      this.err.y *= k;
      this.err.z *= k;
      const x = this.prevPos.x + (me.pos.x - this.prevPos.x) * a + this.err.x;
      const y = this.prevPos.y + (me.pos.y - this.prevPos.y) * a + this.err.y;
      const z = this.prevPos.z + (me.pos.z - this.prevPos.z) * a + this.err.z;
      // Smooth stair steps.
      if (me.onGround && Math.abs(y - this.smoothY) < 0.7) this.smoothY += (y - this.smoothY) * Math.min(1, dt * 16);
      else this.smoothY = y;
      this.landDip *= Math.exp(-dt * 8);
      cam.position.set(x, this.smoothY + eyeHeight(me.crouch) - this.landDip * 0.07, z);
      cam.rotation.set(this.viewPitch + me.punchPitch, this.viewYaw + me.punchYaw, 0);
      const slot = me.slots[me.active];
      const wid: WeaponId = slot ? slot.id : 'knife';
      const def = WEAPONS[wid];
      if (me.zoom > 0 && def.zoomFov) targetFov = def.zoomFov[me.zoom - 1] ?? s.fov;
      // Aim down sights (held): every firearm except the scoped rifle, which has its own zoom.
      const canAds = def.kind !== 'melee' && def.category !== 'sniper' && me.reload <= 0 && me.draw <= 0;
      const wantAds = canAds && this.capturing && this.held.has('altFire') ? 1 : 0;
      this.ads += (wantAds - this.ads) * Math.min(1, dt * 14);
      if (this.ads < 0.002) this.ads = 0;
      if (this.ads > 0) targetFov = s.fov * (1 - this.ads * (def.category === 'pistol' || def.category === 'shotgun' ? 0.16 : 0.3));
      if (this.vmWeapon !== wid) {
        this.viewmodel.setWeapon(wid);
        this.vmWeapon = wid;
        this.viewmodel.onDraw(0.25);
      }
      this.viewmodel.setVisible(true);
      this.engine.sampleLight(me.pos, this.light);
      const sp = Math.hypot(me.vel.x, me.vel.z);
      this.viewmodel.update({
        dt,
        speed: s.viewBob ? sp : 0,
        onGround: me.onGround,
        crouch: me.crouch,
        lookDeltaYaw: this.frameDYaw,
        lookDeltaPitch: this.frameDPitch,
        punchPitch: me.punchPitch,
        punchYaw: me.punchYaw,
        zoom: me.zoom,
        ads: this.ads,
        light: this.light,
      });
    } else if (this.deathPos) {
      // Death camera: pull back and look at the body.
      const d = this.deathPos;
      const back = forwardFromAngles(this.viewYaw + Math.PI, 0);
      const want = this.tmpV.set(d.x + back.x * 2.6, d.y + 2.4, d.z + back.z * 2.6);
      const hit = this.world?.raycast({ x: d.x, y: d.y + 1.2, z: d.z }, { x: back.x * 0.73, y: 0.42, z: back.z * 0.73 }, 3.6, MASK.Bullet);
      if (hit) want.set(d.x + back.x * 0.73 * (hit.dist - 0.25), d.y + 1.2 + 0.42 * (hit.dist - 0.25), d.z + back.z * 0.73 * (hit.dist - 0.25));
      cam.position.lerp(want, Math.min(1, dt * 4));
      cam.lookAt(d.x, d.y + 0.4, d.z);
      this.selfCorpse?.update({ dt, pos: d, yaw: 0, pitch: 0, crouch: 0, speed: 0, onGround: true, weapon: 'knife', reloading: false, carrying: false, protected: false, light: this.light });
    } else if (this.followBot(dt)) {
      // Spectating a player (third-person chase camera).
    } else if (this.map) {
      // Spectator overview.
      const b = this.map.bounds;
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      const t = performance.now() * 0.00008;
      const rad = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) * 0.3;
      cam.position.set(cx + Math.cos(t) * rad, Math.min(b.max.y - 0.5, 9), cz + Math.sin(t) * rad);
      cam.lookAt(cx, 1, cz);
    }
    if (!me) this.ads = 0;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 14);
    this.engine.setFov(this.fov);
  }

  /** Spectator chase camera behind a living player; returns false when nobody can be followed. */
  private followBot(dt: number): boolean {
    if (this.myTeam() !== 2 || !this.world) return false;
    const now = performance.now();
    let r = this.remotes.get(this.followId);
    if (!r || !r.alive || !r.avatar || now > this.followUntil) {
      const alive = [...this.remotes.values()].filter((x) => x.alive && x.avatar);
      if (!alive.length) return false;
      r = alive[Math.floor(Math.random() * alive.length)]!;
      this.followId = r.id;
      this.followUntil = now + 14000;
    }
    const back = forwardFromAngles(r.yaw + Math.PI, 0);
    const head = { x: r.pos.x, y: r.pos.y + 1.55, z: r.pos.z };
    const dir = { x: back.x * 0.94, y: 0.34, z: back.z * 0.94 };
    const hit = this.world.raycast(head, dir, 3.2, MASK.Bullet);
    const d = (hit ? Math.max(0.4, hit.dist - 0.3) : 2.9);
    const cam = this.engine.camera;
    this.tmpV.set(head.x + dir.x * d, head.y + dir.y * d, head.z + dir.z * d);
    cam.position.lerp(this.tmpV, Math.min(1, dt * 7));
    const f = forwardFromAngles(r.yaw, r.pitch * 0.5);
    cam.lookAt(head.x + f.x * 6, head.y + f.y * 6 + 0.1, head.z + f.z * 6);
    return true;
  }

  // ------------------------------------------------------------------ HUD

  private hudFrame(visible: boolean): HudFrame {
    const me = this.me;
    const m = this.match;
    const slot = me ? me.slots[me.active] : null;
    const now = performance.now() + this.clockOffset;
    let objectiveLine = '';
    if (m && m.obj.kind === 'tdm') objectiveLine = `Éliminations ${m.obj.kills[0]} – ${m.obj.kills[1]}${m.obj.killLimit > 0 ? `  /  ${m.obj.killLimit}` : ''}`;
    const team = this.myTeam();
    let radar: HudFrame['radar'] = null;
    if (me) {
      const blips: NonNullable<HudFrame['radar']>['blips'] = [];
      for (const r of this.remotes.values()) {
        const info = this.roster.get(r.id);
        if (r.alive && info && info.team === team) blips.push({ x: r.pos.x, z: r.pos.z, team: info.team, kind: 'player' });
      }
      radar = { x: me.pos.x, z: me.pos.z, yaw: this.viewYaw, blips };
    }
    return {
      visible: visible && this.menus.current !== 'loading' && this.menus.current !== 'main',
      alive: !!me,
      health: me ? me.health : 0,
      armor: me ? me.armor : 0,
      team,
      weapon: slot ? slot.id : null,
      clip: slot ? slot.clip : 0,
      reserve: slot ? slot.reserve : 0,
      reloading: !!me && me.reload > 0,
      slots: me ? me.slots.map((w) => (w ? w.id : null)) : [],
      activeSlot: me ? me.active : 0,
      spread: me ? currentSpread(me) : 0,
      fov: this.fov,
      zoom: me ? me.zoom : 0,
      ads: !!me && this.ads > 0.35,
      mode: m ? m.mode : 'tdm',
      phase: m ? m.phase : 'warmup',
      timeLeft: m && m.phaseEnd > 0 ? Math.max(0, (m.phaseEnd - now) / 1000) : 0,
      round: m ? m.round : 1,
      score: m ? m.score : [0, 0],
      roundsToWin: m ? m.roundsToWin : 1,
      objectiveLine,
      prompt: !this.locked && !this.fakeLock && !this.softLock && !this.demo && this.menus.current === null && visible ? 'Cliquez pour reprendre le contrôle' : null,
      action: null,
      spectating: !me && team === 2 ? (this.followId >= 0 ? this.name(this.followId) : 'Spectateur') : !me ? `${TEAMS[team].name}` : null,
      respawnIn: !me && team !== 2 && this.respawnAt > 0 ? Math.max(0, (this.respawnAt - now) / 1000) : -1,
      protected: !!me && me.protect > 0,
      carrying: false,
      ping: Math.round(this.rtt),
      fps: Math.round(this.fps),
      radar,
    };
  }

  // ------------------------------------------------------------------ debug / automated tests

  private installDebug(): void {
    const g = this as Game;
    (window as unknown as { __bas: unknown }).__bas = {
      state: () => ({
        mode: g.mode,
        myId: g.myId,
        room: g.roomCode,
        team: g.myTeam(),
        me: g.me ? { pos: g.me.pos, health: g.me.health, alive: g.me.alive, clip: g.me.slots[g.me.active]?.clip ?? 0, weapon: g.me.slots[g.me.active]?.id, yaw: g.viewYaw, pitch: g.viewPitch, onGround: g.me.onGround } : null,
        remotes: [...g.remotes.values()].map((r) => ({ id: r.id, name: g.name(r.id), team: g.roster.get(r.id)?.team, alive: r.alive, pos: r.pos })),
        roster: [...g.roster.values()],
        match: g.match,
        fps: g.fps,
        rtt: g.rtt,
        menu: g.menus.current,
        keys: bindingLabel(g.settings.value.keys.forward),
      }),
      fakeLock: (on: boolean) => {
        g.fakeLock = on;
        if (on && g.menus.current) g.menus.hide();
      },
      key: (code: string, down: boolean) => g.press(code, down),
      look: (yaw: number, pitch: number) => {
        g.viewYaw = yaw;
        g.viewPitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
      },
      aimAt: (id: number, height = 1.2) => {
        const r = g.remotes.get(id);
        if (!r || !g.me) return false;
        const eye = { x: g.me.pos.x, y: g.me.pos.y + eyeHeight(g.me.crouch), z: g.me.pos.z };
        const a = anglesFromDir({ x: r.pos.x - eye.x, y: r.pos.y + height - eye.y, z: r.pos.z - eye.z });
        g.viewYaw = a.yaw - g.me.punchYaw;
        g.viewPitch = clamp(a.pitch - g.me.punchPitch, -MAX_PITCH, MAX_PITCH);
        return true;
      },
      canSee: (id: number) => {
        const r = g.remotes.get(id);
        if (!r || !g.me || !g.world) return false;
        return g.world.lineOfSight({ x: g.me.pos.x, y: g.me.pos.y + 1.6, z: g.me.pos.z }, { x: r.pos.x, y: r.pos.y + 1.2, z: r.pos.z });
      },
      send: (m: never) => g.conn?.send(m),
      clone: () => (g.me ? clonePlayerState(g.me) : null),
    };
  }
}
