/**
 * Room: the authoritative game simulation for one match (players, bots, weapons,
 * damage, rounds). Environment-agnostic: the Node server hosts many Rooms behind
 * WebSockets, and the browser hosts one Room for solo play through a loopback.
 * See docs/ARCHITECTURE.md §7.
 */
import { createBot, type Bot, type BotEnv, type BotGoal, type BotPlayerView } from '../bots/bot';
import {
  ACTION,
  BTN,
  FALL_DAMAGE_MIN_SPEED,
  FALL_DAMAGE_PER_MS,
  HITGROUP,
  HITGROUP_MUL,
  LIMITS,
  MAX_LAG_COMP_MS,
  PFLAG,
  PROTOCOL_VERSION,
  SNAPSHOT_EVERY,
  TICK_DT,
  TICK_RATE,
} from '../constants';
import { BOT_NAMES } from '../identity';
import { getMap, hasMap, listMaps } from '../maps';
import type { MapData, ZoneDef } from '../maps/types';
import { mulberry32, type Rng } from '../math/rng';
import { clamp, forwardFlat, type Vec3 } from '../math/vec3';
import { NavGrid } from '../nav/navgrid';
import { CollisionWorld } from '../physics/world';
import { createPlayerState, eyePosition, newStepEvents, stepPlayer } from '../player/step';
import { tupleToCmd, type ClientMsg, type GameEvent, type RemoteTuple, type ServerMsg } from '../protocol';
import {
  DEFAULT_ROOM_CONFIG,
  MODE_DEFAULTS,
  type GameModeId,
  type MatchPhase,
  type MatchState,
  type ObjectiveState,
  type PlayerInfo,
  type PlayerState,
  type RoomConfig,
  type StepEvents,
  type TeamId,
  type UserCmd,
} from '../types';
import {
  isValidLoadout,
  TEAM_DEFAULT_LOADOUT,
  WEAPON_INDEX,
  WEAPONS,
  type Loadout,
  type WeaponId,
} from '../weapons/defs';
import { createSlots } from '../weapons/logic';
import { rayPlayer } from './hitboxes';

export interface RoomHost {
  /** Deliver a message to a connected client. */
  send(clientId: number, msg: ServerMsg): void;
  /** Monotonic clock in milliseconds (the "server time" used in snapshots). */
  now(): number;
}

/** Game modes implemented by this build. */
export const SUPPORTED_MODES: GameModeId[] = ['tdm', 'defuse'];

const HIST = 80; // lag-compensation samples per player (~1.2 s)
const POST_MS = 5000;
const OVER_MS = 10000;
const SPAWN_PROTECT = 2;

// --- "Audit surprise" (bomb defusal): the Auditeurs plant, the Labo defuses ---------------
const ATTACKERS = 1 as const;
const DEFENDERS = 0 as const;
/** Seconds of holding Use to plant / to defuse, and fuse length once planted. */
const PLANT_TIME = 3.2;
const DEFUSE_TIME = 7;
const BOMB_TIME = 40;
/** Blast: lethal at the centre, fading to nothing at this radius (m). */
const BOMB_RADIUS = 10;
const BOMB_DAMAGE = 260;
const PICKUP_RADIUS = 1.2;
const DEFUSE_RADIUS = 1.7;
/** Players joining this soon after a round went live still spawn into it. */
const JOIN_GRACE_MS = 15000;

interface BombState {
  /** Player id carrying the bomb, -1 if none. */
  carrier: number;
  dropped: Vec3 | null;
  planted: null | { site: string; pos: Vec3; explodeAt: number };
  defused: boolean;
  exploded: boolean;
}

interface SimPlayer {
  id: number;
  name: string;
  team: TeamId;
  bot: Bot | null;
  state: PlayerState;
  loadout: Loadout;
  kills: number;
  deaths: number;
  score: number;
  ping: number;
  queue: UserCmd[];
  lastSeq: number;
  /** Tick at which the player respawns (-1 = none). */
  respawnAt: number;
  events: GameEvent[];
  /** Ring buffer: [time, x, y, z, crouch] × HIST. */
  hist: Float64Array;
  histN: number;
  histI: number;
  streak: number;
  streakUntil: number;
  chatTimes: number[];
  view: BotPlayerView;
  /** BTN.Use held in the last command processed (plant / defuse). */
  useHeld: boolean;
}

const CONTROL_CHARS = new RegExp('[\\u0000-\\u001f\\u007f\\u2028\\u2029]', 'g');
const clean = (s: unknown, max: number): string =>
  (typeof s === 'string' ? s : '').replace(CONTROL_CHARS, ' ').trim().slice(0, max);

const num = (v: unknown, lo: number, hi: number, def: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), lo, hi) : def;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const r4 = (v: number): number => Math.round(v * 10000) / 10000;

/** Clamp / validate a (possibly partial, untrusted) config into a full RoomConfig. */
export function sanitizeConfig(partial: Partial<RoomConfig> | undefined): RoomConfig {
  const p = (partial && typeof partial === 'object' ? partial : {}) as Partial<RoomConfig>;
  const mode: GameModeId = SUPPORTED_MODES.includes(p.mode as GameModeId) ? (p.mode as GameModeId) : 'tdm';
  const base = { ...DEFAULT_ROOM_CONFIG, ...MODE_DEFAULTS[mode] };
  let mapId = typeof p.mapId === 'string' && hasMap(p.mapId) ? p.mapId : base.mapId;
  if (!hasMap(mapId)) mapId = listMaps()[0]?.id ?? listMaps(true)[0]!.id;
  return {
    mapId,
    mode,
    botFill: num(p.botFill, 0, LIMITS.maxPlayersPerRoom, base.botFill),
    botDifficulty: num(p.botDifficulty, 0, 3, base.botDifficulty),
    maxPlayers: num(p.maxPlayers, 1, LIMITS.maxPlayersPerRoom, base.maxPlayers),
    friendlyFire: p.friendlyFire === true,
    roundTime: num(p.roundTime, 30, 1200, base.roundTime),
    roundsToWin: num(p.roundsToWin, 1, 15, base.roundsToWin),
    killLimit: num(p.killLimit, 0, 200, base.killLimit),
    respawnDelay: num(p.respawnDelay, 0, 30, base.respawnDelay),
    freezeTime: num(p.freezeTime, 0, 20, base.freezeTime),
  };
}

export class Room {
  readonly code: string;
  private cfg: RoomConfig;
  private host: RoomHost;
  private rng: Rng;
  private map!: MapData;
  private world!: CollisionWorld;
  private nav: NavGrid | null = null;
  private players: SimPlayer[] = [];
  private byId = new Map<number, SimPlayer>();
  private nextId = 1;
  private hostId = -1;
  private tickN = 0;
  private ev: StepEvents = newStepEvents();

  private phase: MatchPhase = 'freeze';
  private phaseEnd = 0;
  private round = 0;
  private score: [number, number] = [0, 0];
  private kills: [number, number] = [0, 0];
  private lastWinner = -1;
  private lastReason = '';
  private firstBlood = false;
  private timeLowDone = false;
  private rosterDirty = false;
  private matchDirty = false;
  private botEnv: BotEnv;
  private views: BotPlayerView[] = [];
  private bomb: BombState = { carrier: -1, dropped: null, planted: null, defused: false, exploded: false };
  /** Site the attacking bots go for this round (index into the map's sites). */
  private targetSite = 0;
  /** Host time at which the current round went live. */
  private liveSince = 0;

  /**
   * @param code   room code shown to players
   * @param config room configuration (validated again here)
   * @param host   message delivery + clock
   * @param seed   RNG seed (spawn selection, bots…)
   */
  constructor(code: string, config: RoomConfig, host: RoomHost, seed = 1) {
    this.code = code;
    this.cfg = sanitizeConfig(config);
    this.host = host;
    this.rng = mulberry32(seed);
    this.loadMap();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const room = this;
    this.botEnv = {
      get world() {
        return room.world;
      },
      get nav() {
        return room.getNav();
      },
      get map() {
        return room.map;
      },
      time: 0,
      phase: 'freeze',
      friendlyFire: this.cfg.friendlyFire,
      players: this.views,
      goals: (team, id) => this.botGoals(team, id),
    };
    this.startMatch();
  }

  get config(): RoomConfig {
    return this.cfg;
  }

  /** Number of connected human players. */
  get humanCount(): number {
    let n = 0;
    for (const p of this.players) if (!p.bot) n++;
    return n;
  }

  /** Read-only view for tests and tools. */
  debugState(): {
    tick: number;
    phase: MatchPhase;
    round: number;
    score: [number, number];
    kills: [number, number];
    players: { id: number; name: string; team: TeamId; bot: boolean; kills: number; deaths: number; state: PlayerState }[];
    bomb: BombState;
    lastWinner: number;
    lastReason: string;
  } {
    return {
      bomb: this.bomb,
      lastWinner: this.lastWinner,
      lastReason: this.lastReason,
      tick: this.tickN,
      phase: this.phase,
      round: this.round,
      score: [this.score[0], this.score[1]],
      kills: [this.kills[0], this.kills[1]],
      players: this.players.map((p) => ({ id: p.id, name: p.name, team: p.team, bot: !!p.bot, kills: p.kills, deaths: p.deaths, state: p.state })),
    };
  }

  // ------------------------------------------------------------------ world

  private loadMap(): void {
    this.map = getMap(this.cfg.mapId);
    this.world = new CollisionWorld(this.map.solids);
    this.nav = null;
  }

  private getNav(): NavGrid {
    if (!this.nav) this.nav = NavGrid.build(this.world, this.map);
    return this.nav;
  }

  // ------------------------------------------------------------------ clients

  /** Register a human client; sends S_Welcome. The first client is the host. */
  addClient(name: string): number {
    const p = this.createPlayer(this.uniqueName(clean(name, LIMITS.maxNameLength) || 'Joueur'), this.smallerTeam(), null);
    if (this.hostId < 0) this.hostId = p.id;
    this.syncBots();
    if (this.canSpawnNow()) this.spawn(p);
    this.host.send(p.id, {
      t: 'welcome',
      id: p.id,
      room: this.code,
      config: this.cfg,
      hostId: this.hostId,
      time: this.host.now(),
      players: this.roster(),
      match: this.matchState(),
    });
    this.chat(-1, `${p.name} a rejoint la partie.`);
    this.rosterDirty = true;
    return p.id;
  }

  /** Remove a client (disconnect). Handles host migration and bot back-fill. */
  removeClient(id: number): void {
    const p = this.byId.get(id);
    if (!p || p.bot) return;
    if (this.bomb.carrier === p.id) this.dropBomb(p);
    this.removePlayer(p);
    this.checkElimination();
    if (this.hostId === id) this.hostId = this.players.find((q) => !q.bot)?.id ?? -1;
    this.chat(-1, `${p.name} a quitté la partie.`);
    this.syncBots();
    this.rosterDirty = true;
  }

  /** Handle a message from a client (never throws on malformed input). */
  handleMessage(id: number, msg: ClientMsg): void {
    try {
      const p = this.byId.get(id);
      if (!p || p.bot || !msg || typeof msg !== 'object') return;
      switch (msg.t) {
        case 'c':
          this.onCmds(p, msg.c);
          break;
        case 'ping':
          if (typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) {
            const ping = clamp(Math.round(msg.rtt), 0, 999);
            if (Math.abs(ping - p.ping) > 4) this.rosterDirty = true;
            p.ping = ping;
          }
          this.host.send(id, { t: 'pong', c: typeof msg.c === 'number' ? msg.c : 0, s: this.host.now() });
          break;
        case 'team':
          this.onTeam(p, msg.team);
          break;
        case 'loadout': {
          const l: Loadout = { primary: msg.primary, secondary: msg.secondary };
          if (!isValidLoadout(l)) return;
          p.loadout = l;
          if (p.state.alive && p.state.frozen) {
            p.state.slots = createSlots(l);
            p.state.active = 0;
            p.state.reload = 0;
          }
          break;
        }
        case 'chat':
          this.onChat(p, msg.text, msg.team === true);
          break;
        case 'config':
          if (id === this.hostId) this.onConfig(msg.patch, msg.restart === true);
          break;
        default:
          break;
      }
    } catch {
      /* malformed input must never break the simulation */
    }
  }

  private onCmds(p: SimPlayer, list: unknown): void {
    if (!Array.isArray(list)) return;
    const n = Math.min(list.length, LIMITS.maxCmdBacklog);
    for (let i = list.length - n; i < list.length; i++) {
      const t = list[i] as unknown[];
      if (!Array.isArray(t) || t.length < 6) continue;
      for (let k = 0; k < 6; k++) if (typeof t[k] !== 'number' || !Number.isFinite(t[k] as number)) return;
      const c = tupleToCmd(t as [number, number, number, number, number, number]);
      const lastQueued = p.queue.length ? p.queue[p.queue.length - 1]!.seq : p.lastSeq;
      if (!Number.isInteger(c.seq) || c.seq <= lastQueued || c.seq > lastQueued + 100000) continue;
      c.buttons = c.buttons | 0;
      c.slot = Number.isInteger(c.slot) && c.slot >= 0 && c.slot <= 2 ? c.slot : -1;
      p.queue.push(c);
    }
    while (p.queue.length > LIMITS.maxCmdBacklog) p.lastSeq = p.queue.shift()!.seq;
  }

  private onTeam(p: SimPlayer, team: unknown): void {
    let t: TeamId;
    if (team === 2) t = 2;
    else if (team === 0 || team === 1) t = team;
    else t = this.smallerTeam(p);
    if (t === p.team) return;
    if (this.bomb.carrier === p.id) this.dropBomb(p);
    if (p.state.alive) p.state.alive = false;
    p.view.alive = false;
    p.team = t;
    p.view.team = t;
    p.respawnAt = t === 2 || !this.canSpawnNow() ? -1 : this.tickN + TICK_RATE;
    if (t !== 2) p.loadout = { ...TEAM_DEFAULT_LOADOUT[t] };
    this.syncBots();
    this.checkElimination();
    this.rosterDirty = true;
  }

  private onChat(p: SimPlayer, text: unknown, teamOnly: boolean): void {
    const msg = clean(text, LIMITS.maxChatLength);
    if (!msg) return;
    const now = this.host.now();
    p.chatTimes = p.chatTimes.filter((t) => now - t < 5000);
    if (p.chatTimes.length >= 5) return;
    p.chatTimes.push(now);
    const out: ServerMsg = { t: 'chat', from: p.id, name: p.name, team: p.team, text: msg, teamOnly };
    for (const q of this.players) if (!q.bot && (!teamOnly || q.team === p.team)) this.host.send(q.id, out);
  }

  private chat(from: number, text: string): void {
    const out: ServerMsg = { t: 'chat', from, name: '', team: 2, text, teamOnly: false };
    for (const q of this.players) if (!q.bot) this.host.send(q.id, out);
  }

  private onConfig(patch: unknown, restart: boolean): void {
    const next = sanitizeConfig({ ...this.cfg, ...(patch && typeof patch === 'object' ? (patch as Partial<RoomConfig>) : {}) });
    const mapChanged = next.mapId !== this.cfg.mapId;
    const modeChanged = next.mode !== this.cfg.mode;
    this.cfg = next;
    this.botEnv.friendlyFire = next.friendlyFire;
    if (mapChanged) this.loadMap();
    if (restart || mapChanged || modeChanged) {
      for (const p of this.players) {
        p.kills = p.deaths = p.score = 0;
        p.state.alive = false;
      }
      this.syncBots();
      this.startMatch();
    } else {
      this.syncBots();
    }
    const out: ServerMsg = { t: 'match', match: this.matchState(), config: this.cfg };
    for (const q of this.players) if (!q.bot) this.host.send(q.id, out);
    this.matchDirty = false;
    this.rosterDirty = true;
  }

  // ------------------------------------------------------------------ players

  private createPlayer(name: string, team: TeamId, bot: Bot | null): SimPlayer {
    const id = this.nextId++;
    const loadout = team === 2 ? { ...TEAM_DEFAULT_LOADOUT[0] } : { ...TEAM_DEFAULT_LOADOUT[team] };
    const state = createPlayerState({ x: 0, y: 0, z: 0 }, 0, loadout);
    state.alive = false;
    const p: SimPlayer = {
      id,
      name,
      team,
      bot,
      state,
      loadout,
      kills: 0,
      deaths: 0,
      score: 0,
      ping: 0,
      queue: [],
      lastSeq: 0,
      respawnAt: -1,
      events: [],
      hist: new Float64Array(HIST * 5),
      histN: 0,
      histI: 0,
      streak: 0,
      streakUntil: 0,
      chatTimes: [],
      view: { id, team, alive: false, state },
      useHeld: false,
    };
    this.players.push(p);
    this.byId.set(id, p);
    this.views.push(p.view);
    return p;
  }

  private removePlayer(p: SimPlayer): void {
    const i = this.players.indexOf(p);
    if (i >= 0) this.players.splice(i, 1);
    const v = this.views.indexOf(p.view);
    if (v >= 0) this.views.splice(v, 1);
    this.byId.delete(p.id);
  }

  private uniqueName(base: string): string {
    let name = base;
    let n = 2;
    while (this.players.some((p) => p.name === name)) name = `${base.slice(0, LIMITS.maxNameLength - 3)} ${n++}`;
    return name;
  }

  private teamSize(team: TeamId, except?: SimPlayer): number {
    let n = 0;
    for (const p of this.players) if (p.team === team && p !== except) n++;
    return n;
  }

  private smallerTeam(except?: SimPlayer): TeamId {
    // Humans are balanced against humans first; bots fill the gaps afterwards.
    let h0 = 0;
    let h1 = 0;
    for (const p of this.players) {
      if (p.bot || p === except) continue;
      if (p.team === 0) h0++;
      else if (p.team === 1) h1++;
    }
    if (h0 !== h1) return h0 < h1 ? 0 : 1;
    return this.rng() < 0.5 ? 0 : 1;
  }

  /** Add / remove bots so that humans + bots = botFill, with balanced teams. */
  private syncBots(): void {
    const humans = this.players.filter((p) => !p.bot && p.team !== 2).length;
    const want = clamp(this.cfg.botFill - humans, 0, LIMITS.maxBots);
    const bots = this.players.filter((p) => p.bot);
    // Remove surplus bots from the larger team.
    while (bots.length > want) {
      const big: TeamId = this.teamSize(0) >= this.teamSize(1) ? 0 : 1;
      const i = bots.findIndex((b) => b.team === big);
      const victim = bots.splice(i >= 0 ? i : 0, 1)[0]!;
      this.removePlayer(victim);
      this.rosterDirty = true;
    }
    while (bots.length < want) {
      const team: TeamId = this.teamSize(0) <= this.teamSize(1) ? 0 : 1;
      bots.push(this.addBot(team));
    }
    // Rebalance: move a bot when teams differ by two or more.
    for (let guard = 0; guard < 8; guard++) {
      const d = this.teamSize(0) - this.teamSize(1);
      if (Math.abs(d) < 2) break;
      const from: TeamId = d > 0 ? 0 : 1;
      const b = bots.find((x) => x.team === from);
      if (!b) break;
      b.team = from === 0 ? 1 : 0;
      b.view.team = b.team;
      b.name = this.botName(b.team);
      if (this.bomb.carrier === b.id) this.dropBomb(b);
      b.state.alive = false;
      b.view.alive = false;
      b.respawnAt = this.canSpawnNow() ? this.tickN + TICK_RATE : -1;
      this.rosterDirty = true;
    }
  }

  private botName(team: 0 | 1): string {
    const pool = BOT_NAMES[team];
    const free = pool.filter((n) => !this.players.some((p) => p.name === n));
    return free.length ? free[Math.floor(this.rng() * free.length)]! : this.uniqueName(pool[0]!);
  }

  private addBot(team: 0 | 1): SimPlayer {
    const seed = Math.floor(this.rng() * 0x7fffffff);
    const p = this.createPlayer(this.botName(team), team, null);
    p.bot = createBot(p.id, this.cfg.botDifficulty, seed);
    const r = this.rng();
    const primary: WeaponId =
      r < 0.5 ? TEAM_DEFAULT_LOADOUT[team].primary : r < 0.68 ? (team === 0 ? 'rifle_ak' : 'rifle_m4') : r < 0.86 ? 'smg' : r < 0.94 ? 'shotgun' : 'sniper';
    p.loadout = { primary, secondary: this.rng() < 0.75 ? 'pistol' : 'deagle' };
    if (this.canSpawnNow()) this.spawn(p);
    this.rosterDirty = true;
    return p;
  }

  private spawn(p: SimPlayer): void {
    if (p.team === 2) return;
    const spawns = this.map.spawns.filter((s) => s.team === p.team);
    let best = spawns[0] ?? { team: p.team, pos: { x: 0, y: 1, z: 0 }, yaw: 0 };
    let bestScore = -Infinity;
    for (const s of spawns) {
      let nearEnemy = 1e9;
      let blocked = false;
      for (const q of this.players) {
        if (q === p || !q.state.alive) continue;
        const d = Math.hypot(q.state.pos.x - s.pos.x, q.state.pos.z - s.pos.z);
        if (d < 1.1 && Math.abs(q.state.pos.y - s.pos.y) < 2) blocked = true;
        if (q.team !== p.team && d < nearEnemy) nearEnemy = d;
      }
      const sc = (blocked ? -1000 : 0) + Math.min(nearEnemy, 30) + this.rng() * 6;
      if (sc > bestScore) {
        bestScore = sc;
        best = s;
      }
    }
    const st = createPlayerState(best.pos, best.yaw, p.loadout);
    st.frozen = this.phase === 'freeze';
    st.protect = this.phase === 'live' ? SPAWN_PROTECT : 0;
    // Keep the same object identity for bot views / debug.
    Object.assign(p.state, st);
    p.respawnAt = -1;
    p.histN = 0;
    p.view.alive = true;
    p.bot?.onSpawn();
    this.emitAll({ e: 'spawn', id: p.id });
    this.rosterDirty = true;
  }

  // ------------------------------------------------------------------ match flow

  private startMatch(): void {
    this.score = [0, 0];
    this.round = 0;
    this.lastWinner = -1;
    this.lastReason = '';
    this.startRound();
  }

  private startRound(): void {
    this.round++;
    this.kills = [0, 0];
    this.firstBlood = false;
    this.timeLowDone = false;
    this.phase = this.cfg.freezeTime > 0 ? 'freeze' : 'live';
    this.phaseEnd = this.host.now() + (this.cfg.freezeTime > 0 ? this.cfg.freezeTime : this.cfg.roundTime) * 1000;
    this.liveSince = this.host.now();
    this.bomb = { carrier: -1, dropped: null, planted: null, defused: false, exploded: false };
    this.syncBots();
    for (const p of this.players) {
      p.streak = 0;
      p.useHeld = false;
      this.spawn(p);
    }
    if (this.cfg.mode === 'defuse') {
      // One attacker starts with the bomb; the attacking bots agree on a site for the round.
      const carriers = this.players.filter((p) => p.team === ATTACKERS && p.state.alive);
      this.bomb.carrier = carriers.length ? carriers[Math.floor(this.rng() * carriers.length)]!.id : -1;
      this.targetSite = Math.floor(this.rng() * Math.max(1, this.sites().length));
    }
    const last = this.score[0] === this.cfg.roundsToWin - 1 && this.score[1] === this.cfg.roundsToWin - 1 && this.cfg.roundsToWin > 1;
    this.emitAll({ e: 'announce', key: last ? 'round_start_last' : 'round_start' });
    this.matchDirty = true;
  }

  private endRound(winner: number, reason: string): void {
    if (this.phase !== 'live') return;
    for (const p of this.players) {
      p.state.action = ACTION.None;
      p.state.actionT = 0;
    }
    this.lastWinner = winner;
    this.lastReason = reason;
    if (winner === 0 || winner === 1) this.score[winner]++;
    const matchWon = winner >= 0 && this.score[winner as 0 | 1] >= this.cfg.roundsToWin;
    if (matchWon) {
      this.phase = 'over';
      this.phaseEnd = this.host.now() + OVER_MS;
      this.emitAll({ e: 'announce', key: `match_win_${winner}` });
    } else {
      this.phase = 'post';
      this.phaseEnd = this.host.now() + POST_MS;
      this.emitAll({ e: 'announce', key: winner < 0 ? 'round_draw' : `team_win_${winner}` });
    }
    this.matchDirty = true;
  }

  private updatePhase(now: number): void {
    if (this.phase === 'freeze') {
      if (now >= this.phaseEnd) {
        this.phase = 'live';
        this.phaseEnd = now + this.cfg.roundTime * 1000;
        this.liveSince = now;
        for (const p of this.players) p.state.frozen = false;
        this.matchDirty = true;
      }
    } else if (this.phase === 'live') {
      const left = this.phaseEnd - now;
      if (!this.timeLowDone && left <= 30000 && this.cfg.roundTime > 45 && !this.bomb.planted) {
        this.timeLowDone = true;
        this.emitAll({ e: 'announce', key: 'time_low' });
      }
      if (left <= 0) {
        if (this.cfg.mode === 'defuse') {
          // Out of time without a plant: the defenders hold. (Once planted, the fuse decides: updateBomb.)
          if (!this.bomb.planted) this.endRound(DEFENDERS, 'time');
        } else {
          const [a, b] = this.kills;
          this.endRound(a === b ? -1 : a > b ? 0 : 1, 'time');
        }
      }
    } else if (now >= this.phaseEnd) {
      if (this.phase === 'over') {
        for (const p of this.players) p.kills = p.deaths = p.score = 0;
        this.startMatch();
      } else this.startRound();
    }
  }

  private objective(): ObjectiveState {
    if (this.cfg.mode === 'defuse') {
      const b = this.bomb;
      return {
        kind: 'defuse',
        carrier: b.carrier,
        dropped: b.dropped ? { ...b.dropped } : null,
        planted: b.planted ? { site: b.planted.site, pos: { ...b.planted.pos }, explodeAt: b.planted.explodeAt } : null,
        defused: b.defused,
        exploded: b.exploded,
      };
    }
    return { kind: 'tdm', kills: [this.kills[0], this.kills[1]], killLimit: this.cfg.killLimit };
  }

  private botGoals(team: TeamId, botId: number): BotGoal[] {
    if (this.cfg.mode !== 'defuse' || team === 2) return [];
    const b = this.bomb;
    const sites = this.sites();
    const centre = (z: ZoneDef): Vec3 => ({ x: (z.min.x + z.max.x) / 2, y: z.min.y, z: (z.min.z + z.max.z) / 2 });
    if (b.planted) {
      // Attackers guard the bomb, defenders go and defuse it.
      return team === ATTACKERS ? [{ kind: 'defend', pos: b.planted.pos, weight: 4 }] : [{ kind: 'objective', pos: b.planted.pos, weight: 10, use: true, radius: DEFUSE_RADIUS - 0.4 }];
    }
    if (!sites.length) return [];
    const target = sites[this.targetSite % sites.length]!;
    if (team === ATTACKERS) {
      if (b.dropped) return [{ kind: 'objective', pos: b.dropped, weight: 10 }];
      if (b.carrier === botId) return [{ kind: 'objective', pos: centre(target), weight: 10, use: true, radius: 2.4 }];
      return sites.map((z) => ({ kind: 'attack' as const, pos: centre(z), weight: z === target ? 5 : 1 }));
    }
    // Defenders: half the bots hold each site.
    const mine = sites[botId % sites.length]!;
    return sites.map((z) => ({ kind: 'defend' as const, pos: centre(z), weight: z === mine ? 5 : 1 }));
  }

  // ------------------------------------------------------------------ bomb mode

  /** No respawn during a round (elimination modes). */
  private get noRespawn(): boolean {
    return this.cfg.mode === 'defuse';
  }

  /** May a player who is not in the round (joined late, changed team) spawn right now? */
  private canSpawnNow(): boolean {
    if (this.phase === 'over') return false;
    if (!this.noRespawn || this.phase === 'freeze') return true;
    return this.phase === 'live' && !this.bomb.planted && this.host.now() - this.liveSince < JOIN_GRACE_MS;
  }

  private sites(): ZoneDef[] {
    return this.map.zones.filter((z) => z.kind === 'site');
  }

  private siteAt(pos: Vec3): ZoneDef | null {
    for (const z of this.sites()) {
      if (pos.x >= z.min.x && pos.x <= z.max.x && pos.z >= z.min.z && pos.z <= z.max.z && pos.y >= z.min.y - 0.5 && pos.y <= z.max.y) return z;
    }
    return null;
  }

  /** The carrier lost the bomb (death, disconnection, team change): it lies where they stood. */
  private dropBomb(p: SimPlayer): void {
    const b = this.bomb;
    if (b.carrier !== p.id || b.planted) return;
    b.carrier = -1;
    b.dropped = { x: p.state.pos.x, y: p.state.pos.y, z: p.state.pos.z };
    if (b.dropped.y < this.map.killY + 1) {
      // Lost out of the world with its carrier: it comes back where the attackers start.
      const home = this.map.spawns.find((sp) => sp.team === ATTACKERS);
      if (home) b.dropped = { x: home.pos.x, y: home.pos.y, z: home.pos.z };
    }
    this.emitAll({ e: 'obj', kind: 'bomb_dropped', id: p.id, pos: [r3(b.dropped.x), r3(b.dropped.y), r3(b.dropped.z)] });
    this.emitAll({ e: 'announce', key: 'bomb_dropped' });
    this.matchDirty = true;
  }

  /** A team with nobody left alive loses the round (attackers only before the plant). */
  private checkElimination(): void {
    if (!this.noRespawn || this.phase !== 'live') return;
    let att = 0;
    let def = 0;
    for (const p of this.players) {
      if (!p.state.alive) continue;
      if (p.team === ATTACKERS) att++;
      else if (p.team === DEFENDERS) def++;
    }
    if (def === 0 && this.teamSize(DEFENDERS) > 0) this.endRound(ATTACKERS, 'elimination');
    else if (att === 0 && this.teamSize(ATTACKERS) > 0 && !this.bomb.planted) this.endRound(DEFENDERS, 'elimination');
  }

  /** Bomb logic of a live round: pick-up, plant, defuse, explosion. */
  private updateBomb(now: number): void {
    const b = this.bomb;
    if (b.planted) {
      if (now >= b.planted.explodeAt) {
        this.explodeBomb();
        return;
      }
      const at = b.planted.pos;
      for (const p of this.players) {
        const s = p.state;
        if (p.team !== DEFENDERS || !s.alive) continue;
        const near = Math.hypot(s.pos.x - at.x, s.pos.z - at.z) < DEFUSE_RADIUS && Math.abs(s.pos.y - at.y) < 1.5;
        if (p.useHeld && near && (s.onGround || s.action === ACTION.Defuse)) {
          if (s.action !== ACTION.Defuse) {
            s.action = ACTION.Defuse;
            s.actionT = 0;
          }
          s.actionT += TICK_DT / DEFUSE_TIME;
          if (s.actionT >= 1) {
            b.defused = true;
            p.score += 3;
            this.emitAll({ e: 'obj', kind: 'bomb_defused', id: p.id, pos: [r3(at.x), r3(at.y), r3(at.z)] });
            this.emitAll({ e: 'announce', key: 'bomb_defused', id: p.id });
            this.rosterDirty = true;
            this.endRound(DEFENDERS, 'defused');
            return;
          }
        } else if (s.action === ACTION.Defuse) {
          s.action = ACTION.None;
          s.actionT = 0;
        }
      }
      return;
    }
    if (b.carrier < 0 && !b.dropped) {
      // Nobody could take the bomb when the round started (attackers joined afterwards): hand it out now.
      const late = this.players.filter((p) => p.team === ATTACKERS && p.state.alive);
      if (!late.length) return;
      b.carrier = late[Math.floor(this.rng() * late.length)]!.id;
      this.matchDirty = true;
    }
    if (b.dropped) {
      // Any attacker walking over the dropped bomb takes it.
      for (const p of this.players) {
        const s = p.state;
        if (p.team !== ATTACKERS || !s.alive) continue;
        if (Math.hypot(s.pos.x - b.dropped.x, s.pos.z - b.dropped.z) < PICKUP_RADIUS && Math.abs(s.pos.y - b.dropped.y) < 1.5) {
          b.carrier = p.id;
          b.dropped = null;
          this.emitAll({ e: 'obj', kind: 'bomb_picked', id: p.id });
          this.emitAll({ e: 'announce', key: 'bomb_picked', id: p.id });
          this.matchDirty = true;
          break;
        }
      }
      return;
    }
    const c = b.carrier >= 0 ? this.byId.get(b.carrier) : undefined;
    if (!c || !c.state.alive) return;
    const s = c.state;
    const site = this.siteAt(s.pos);
    if (c.useHeld && site && (s.onGround || s.action === ACTION.Plant)) {
      if (s.action !== ACTION.Plant) {
        s.action = ACTION.Plant;
        s.actionT = 0;
      }
      s.actionT += TICK_DT / PLANT_TIME;
      if (s.actionT >= 1) {
        s.action = ACTION.None;
        s.actionT = 0;
        b.planted = { site: site.id, pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z }, explodeAt: now + BOMB_TIME * 1000 };
        b.carrier = -1;
        this.phaseEnd = b.planted.explodeAt; // the fuse replaces the round clock
        c.score += 2;
        this.emitAll({ e: 'obj', kind: 'bomb_planted', id: c.id, pos: [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)] });
        this.emitAll({ e: 'announce', key: 'bomb_planted', id: c.id });
        this.matchDirty = true;
        this.rosterDirty = true;
      }
    } else if (s.action === ACTION.Plant) {
      s.action = ACTION.None;
      s.actionT = 0;
    }
  }

  private explodeBomb(): void {
    const b = this.bomb;
    if (!b.planted || b.exploded) return;
    const at = b.planted.pos;
    b.exploded = true;
    this.emitAll({ e: 'obj', kind: 'bomb_exploded', pos: [r3(at.x), r3(at.y), r3(at.z)] });
    this.emitAll({ e: 'announce', key: 'bomb_exploded' });
    this.endRound(ATTACKERS, 'exploded');
    // The blast, after the round is decided (so the deaths cannot change its outcome).
    for (const p of this.players.slice()) {
      const s = p.state;
      if (!s.alive) continue;
      const d = Math.hypot(s.pos.x - at.x, s.pos.y - at.y, s.pos.z - at.z);
      if (d < BOMB_RADIUS) this.damage(p, null, BOMB_DAMAGE * (1 - d / BOMB_RADIUS), HITGROUP.Chest, null);
    }
  }

  private matchState(): MatchState {
    return {
      mapId: this.cfg.mapId,
      mode: this.cfg.mode,
      phase: this.phase,
      phaseEnd: this.phaseEnd,
      round: this.round,
      score: [this.score[0], this.score[1]],
      roundsToWin: this.cfg.roundsToWin,
      lastWinner: this.lastWinner,
      lastReason: this.lastReason,
      obj: this.objective(),
    };
  }

  private roster(): PlayerInfo[] {
    return this.players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      bot: !!p.bot,
      kills: p.kills,
      deaths: p.deaths,
      score: p.score,
      ping: p.ping,
      alive: p.state.alive,
    }));
  }

  // ------------------------------------------------------------------ events

  private emitAll(ev: GameEvent, except = -1): void {
    for (const p of this.players) if (!p.bot && p.id !== except) p.events.push(ev);
  }

  private emitTo(p: SimPlayer, ev: GameEvent): void {
    if (!p.bot) p.events.push(ev);
  }

  // ------------------------------------------------------------------ combat

  /** Position of a player at server time `t` (interpolated in its history). */
  private rewind(p: SimPlayer, t: number, out: { pos: Vec3; crouch: number }): void {
    const h = p.hist;
    const n = p.histN;
    out.pos.x = p.state.pos.x;
    out.pos.y = p.state.pos.y;
    out.pos.z = p.state.pos.z;
    out.crouch = p.state.crouch;
    if (n < 2) return;
    // Walk back from the newest sample.
    let newer = (p.histI - 1 + HIST) % HIST;
    if (t >= h[newer * 5]!) return;
    for (let k = 1; k < n; k++) {
      const older = (newer - 1 + HIST) % HIST;
      const t0 = h[older * 5]!;
      const t1 = h[newer * 5]!;
      if (t >= t0) {
        const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
        out.pos.x = h[older * 5 + 1]! + (h[newer * 5 + 1]! - h[older * 5 + 1]!) * f;
        out.pos.y = h[older * 5 + 2]! + (h[newer * 5 + 2]! - h[older * 5 + 2]!) * f;
        out.pos.z = h[older * 5 + 3]! + (h[newer * 5 + 3]! - h[older * 5 + 3]!) * f;
        out.crouch = h[older * 5 + 4]! + (h[newer * 5 + 4]! - h[older * 5 + 4]!) * f;
        return;
      }
      newer = older;
    }
    out.pos.x = h[newer * 5 + 1]!;
    out.pos.y = h[newer * 5 + 2]!;
    out.pos.z = h[newer * 5 + 3]!;
    out.crouch = h[newer * 5 + 4]!;
  }

  private resolveShot(shooter: SimPlayer, weapon: WeaponId, origin: Vec3, dirs: Vec3[], st: number): void {
    const def = WEAPONS[weapon];
    const now = this.host.now();
    const t = shooter.bot ? now : clamp(st, now - MAX_LAG_COMP_MS, now);
    const targets: { p: SimPlayer; pos: Vec3; crouch: number; dmg: number; hg: number; hit: Vec3 | null }[] = [];
    for (const q of this.players) {
      if (q === shooter || !q.state.alive) continue;
      if (q.team === shooter.team && !this.cfg.friendlyFire) continue;
      const r = { pos: { x: 0, y: 0, z: 0 }, crouch: 0 };
      this.rewind(q, t, r);
      targets.push({ p: q, pos: r.pos, crouch: r.crouch, dmg: 0, hg: HITGROUP.None, hit: null });
    }
    const flatDirs: number[] = [];
    const flatHits: number[] = [];
    for (const d of dirs) {
      flatDirs.push(r4(d.x), r4(d.y), r4(d.z));
      const wall = this.world.raycast(origin, d, def.range);
      const maxDist = wall ? wall.dist : def.range;
      let best: (typeof targets)[number] | null = null;
      let bestHit: { dist: number; group: number } | null = null;
      for (const tg of targets) {
        const h = rayPlayer(origin, d, maxDist, tg.pos, tg.crouch);
        if (h && (!bestHit || h.dist < bestHit.dist)) {
          best = tg;
          bestHit = h;
        }
      }
      if (!best || !bestHit) continue;
      let dmg = def.damage * (bestHit.group === HITGROUP.Head ? def.headMul : (HITGROUP_MUL[bestHit.group] ?? 1));
      dmg *= Math.pow(def.falloff, bestHit.dist / 10);
      if (def.kind === 'melee') {
        const f = forwardFlat(best.p.state.yaw);
        if (f.x * d.x + f.z * d.z > 0.5) dmg *= 2; // from behind
      }
      best.dmg += dmg;
      if (best.hg !== HITGROUP.Head) best.hg = bestHit.group;
      best.hit = { x: origin.x + d.x * bestHit.dist, y: origin.y + d.y * bestHit.dist, z: origin.z + d.z * bestHit.dist };
    }
    for (const tg of targets) {
      if (tg.dmg <= 0 || !tg.hit) continue;
      flatHits.push(tg.p.id, r3(tg.hit.x), r3(tg.hit.y), r3(tg.hit.z));
      this.damage(tg.p, shooter, tg.dmg, tg.hg, weapon);
    }
    const ev: GameEvent = { e: 'shot', id: shooter.id, w: WEAPON_INDEX[weapon], o: [r3(origin.x), r3(origin.y), r3(origin.z)], d: flatDirs };
    if (flatHits.length) ev.h = flatHits;
    this.emitAll(ev, shooter.id);
    // The shooter still needs to know where its bullets hit players (blood effects).
    if (flatHits.length && !shooter.bot) shooter.events.push({ e: 'shot', id: shooter.id, w: WEAPON_INDEX[weapon], o: ev.o, d: [], h: flatHits });
    if (def.kind !== 'melee') {
      for (const q of this.players) {
        if (!q.bot || q === shooter || !q.state.alive) continue;
        const dx = q.state.pos.x - origin.x;
        const dz = q.state.pos.z - origin.z;
        if (dx * dx + dz * dz < 45 * 45) q.bot.onSound(origin, shooter.team);
      }
    }
  }

  private damage(victim: SimPlayer, attacker: SimPlayer | null, raw: number, hg: number, weapon: WeaponId | null): void {
    const s = victim.state;
    if (!s.alive || s.protect > 0 || this.phase === 'freeze') return;
    let dmg = raw;
    if (weapon && s.armor > 0 && hg !== HITGROUP.Legs) {
      const pen = WEAPONS[weapon].armorPen;
      const toHealth = raw * pen;
      const toArmor = (raw - toHealth) * 0.5;
      if (toArmor > s.armor) dmg = toHealth + (toArmor - s.armor) * 2;
      else dmg = toHealth;
      s.armor = Math.max(0, Math.round(s.armor - toArmor));
    }
    const amount = Math.max(1, Math.round(dmg));
    s.health -= amount;
    const kill = s.health <= 0;
    if (attacker) {
      this.emitTo(attacker, { e: 'hit', victim: victim.id, dmg: amount, hg, kill });
      const a = attacker.state.pos;
      this.emitTo(victim, { e: 'hurt', attacker: attacker.id, dmg: amount, hg, from: [r3(a.x), r3(a.y + 1.5), r3(a.z)] });
      victim.bot?.onHurt(attacker.id, eyePosition(attacker.state));
    } else {
      this.emitTo(victim, { e: 'hurt', attacker: -1, dmg: amount, hg, from: [r3(s.pos.x), r3(s.pos.y), r3(s.pos.z)] });
    }
    if (kill) this.kill(victim, attacker, weapon, hg === HITGROUP.Head);
  }

  private kill(victim: SimPlayer, killer: SimPlayer | null, weapon: WeaponId | null, hs: boolean): void {
    const s = victim.state;
    s.health = 0;
    s.alive = false;
    victim.view.alive = false;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnAt = this.noRespawn ? -1 : this.tickN + Math.round(this.cfg.respawnDelay * TICK_RATE);
    s.action = ACTION.None;
    s.actionT = 0;
    const real = killer && killer !== victim && killer.team !== victim.team;
    if (killer && real) {
      killer.kills++;
      killer.score += hs ? 3 : 2;
      if (this.phase === 'live' && (killer.team === 0 || killer.team === 1)) this.kills[killer.team]++;
      if (this.tickN > killer.streakUntil) killer.streak = 0;
      killer.streak++;
      killer.streakUntil = this.tickN + 4 * TICK_RATE;
      if (!this.firstBlood && this.phase === 'live') {
        this.firstBlood = true;
        this.emitAll({ e: 'announce', key: 'first_blood', id: killer.id });
      } else if (killer.streak === 2) this.emitAll({ e: 'announce', key: 'double_kill', id: killer.id });
      else if (killer.streak === 3) this.emitAll({ e: 'announce', key: 'triple_kill', id: killer.id });
      else if (killer.streak >= 4) this.emitAll({ e: 'announce', key: 'multi_kill', id: killer.id });
      else if (weapon === 'knife') this.emitAll({ e: 'announce', key: 'knife_kill', id: killer.id });
    } else if (killer && killer !== victim) {
      killer.score -= 2; // team kill
    }
    this.emitAll({ e: 'kill', killer: killer ? killer.id : -1, victim: victim.id, w: weapon ? WEAPON_INDEX[weapon] : -1, hs });
    this.rosterDirty = true;
    this.matchDirty = true;
    if (this.phase === 'live' && this.cfg.killLimit > 0) {
      if (this.kills[0] >= this.cfg.killLimit) this.endRound(0, 'kills');
      else if (this.kills[1] >= this.cfg.killLimit) this.endRound(1, 'kills');
    }
    if (this.noRespawn) {
      if (this.bomb.carrier === victim.id) this.dropBomb(victim);
      this.checkElimination();
    }
  }

  // ------------------------------------------------------------------ tick

  private runCmd(p: SimPlayer, cmd: UserCmd): void {
    const s = p.state;
    const ev = this.ev;
    if (s.protect > 0) s.protect = Math.max(0, s.protect - TICK_DT);
    stepPlayer(s, cmd, this.world, ev);
    p.useHeld = (cmd.buttons & BTN.Use) !== 0;
    if (ev.fired) this.resolveShot(p, ev.fired.weapon, ev.fired.origin, ev.fired.dirs, cmd.st);
    if (ev.landedSpeed > FALL_DAMAGE_MIN_SPEED) this.damage(p, null, (ev.landedSpeed - FALL_DAMAGE_MIN_SPEED) * FALL_DAMAGE_PER_MS, HITGROUP.Legs, null);
    if (s.alive && s.pos.y < this.map.killY) this.kill(p, null, null, false);
  }

  /** Advance the simulation by exactly one tick (TICK_DT). */
  tick(): void {
    const now = this.host.now();
    this.tickN++;
    this.updatePhase(now);
    this.botEnv.time = this.tickN * TICK_DT;
    this.botEnv.phase = this.phase;

    // Iterate over a copy: kills / bot sync may edit the list.
    const list = this.players.slice();
    for (const p of list) {
      if (!this.byId.has(p.id)) continue;
      if (p.bot) {
        if (p.state.alive) {
          const cmd = p.bot.think(p.view, this.botEnv, ++p.lastSeq);
          cmd.st = now;
          this.runCmd(p, cmd);
        }
      } else {
        let n = p.queue.length > 3 ? 2 : 1;
        while (n-- > 0 && p.queue.length) {
          const cmd = p.queue.shift()!;
          p.lastSeq = cmd.seq;
          if (p.state.alive) this.runCmd(p, cmd);
        }
      }
      // Respawn (TDM).
      if (!p.state.alive && p.team !== 2 && p.respawnAt >= 0 && this.tickN >= p.respawnAt && (this.phase === 'live' || this.phase === 'freeze')) this.spawn(p);
      // Lag-compensation history.
      if (p.state.alive) {
        const o = p.histI * 5;
        p.hist[o] = now;
        p.hist[o + 1] = p.state.pos.x;
        p.hist[o + 2] = p.state.pos.y;
        p.hist[o + 3] = p.state.pos.z;
        p.hist[o + 4] = p.state.crouch;
        p.histI = (p.histI + 1) % HIST;
        if (p.histN < HIST) p.histN++;
      }
    }

    if (this.cfg.mode === 'defuse' && this.phase === 'live') this.updateBomb(now);

    if (this.matchDirty) {
      this.matchDirty = false;
      const out: ServerMsg = { t: 'match', match: this.matchState() };
      for (const q of this.players) if (!q.bot) this.host.send(q.id, out);
    }
    if (this.rosterDirty) {
      this.rosterDirty = false;
      const out: ServerMsg = { t: 'roster', players: this.roster(), hostId: this.hostId };
      for (const q of this.players) if (!q.bot) this.host.send(q.id, out);
    }
    if (this.tickN % SNAPSHOT_EVERY === 0) this.sendSnapshots(now);
  }

  private sendSnapshots(now: number): void {
    const tuples: RemoteTuple[] = [];
    for (const p of this.players) {
      const s = p.state;
      if (!s.alive) continue;
      let flags = 0;
      if (s.onGround) flags |= PFLAG.OnGround;
      if (s.reload > 0) flags |= PFLAG.Reloading;
      if (s.zoom > 0) flags |= PFLAG.Zoomed;
      if (s.action !== 0) flags |= PFLAG.Acting;
      if (s.protect > 0) flags |= PFLAG.Protected;
      if (p.id === this.bomb.carrier) flags |= PFLAG.Carrying;
      const w = s.slots[s.active];
      tuples.push([p.id, r3(s.pos.x), r3(s.pos.y), r3(s.pos.z), r4(s.yaw), r4(s.pitch), r3(s.crouch), flags, w ? WEAPON_INDEX[w.id] : 0, s.health]);
    }
    for (const p of this.players) {
      if (p.bot) continue;
      const msg: ServerMsg = {
        t: 's',
        n: this.tickN,
        time: now,
        ack: p.lastSeq,
        you: p.state.alive ? p.state : null,
        p: tuples.filter((t) => t[0] !== p.id),
        ev: p.events,
      };
      if (!p.state.alive && p.respawnAt >= 0) msg.rs = now + ((p.respawnAt - this.tickN) * 1000) / TICK_RATE;
      this.host.send(p.id, msg);
      p.events = [];
    }
  }
}

export { PROTOCOL_VERSION };
