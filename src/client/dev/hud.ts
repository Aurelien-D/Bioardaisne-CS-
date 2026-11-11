/**
 * HUD test bench (dev/hud.html): the real HUD over a still "screenshot" of a lab
 * corridor, fed with animated fake data.
 *
 * Automation: `await window.__hud.ready`, then
 *   __hud.frame({ health: 18, clip: 3 })   merge values into every following frame (they stay until changed)
 *   __hud.frame(null)                      drop all overrides
 *   __hud.kill(entry?)  __hud.hit(headshot, kill)  __hud.damage(angle, amount)
 *   __hud.announce(title, sub, tone)  __hud.toast(text)  __hud.chat(name, team, text, teamOnly?)
 *   __hud.roster(count?)  __hud.scoreboard(visible)  __hud.openChat(teamOnly?)
 *   __hud.auto(false)                      stop the demo loop (static data, nothing random)
 *   __hud.hud / __hud.settings / __hud.calls
 *
 * URL parameters: ?bg=scene (default) | bright | dark — backdrop; ?auto=0 starts with
 * the demo loop off; ?fps=1 turns the FPS read-out on; ?mode=tdm|defuse|secure; ?team=0|1.
 *
 * Keyboard (demo loop on or off): Tab scoreboard, Entrée / Y chat, U team chat,
 * 1-3 weapons, R reload, H hit, J headshot, K kill, G damage, Z zoom, M mode, P announcement.
 */
import type { HudCallbacks, HudFrame, IHud, KillFeedEntry } from '../core/contracts';
import { SettingsStore } from '../core/settings';
import { ANNOUNCE, BOT_NAMES } from '../../shared/identity';
import { MapBuilder } from '../../shared/maps/builder';
import type { MapData } from '../../shared/maps/types';
import type { GameModeId, MatchState, PlayerInfo, TeamId } from '../../shared/types';
import { WEAPONS, type WeaponId } from '../../shared/weapons/defs';
import { createHud } from '../ui/hud';
import { initKeyLabels } from '../ui/keys';

const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------------
// Backdrop: a lab corridor in one-point perspective, drawn once per resize
// ---------------------------------------------------------------------------------

interface Palette {
  ceil: [string, string];
  wall: [string, string];
  floor: [string, string];
  stripe: string;
  light: string;
  line: string;
  door: string;
  bench: string;
  glow: number;
}

const PALETTES: Record<string, Palette> = {
  scene: {
    ceil: ['#8e9aa6', '#c5ced6'],
    wall: ['#9fb0bf', '#d9e2ea'],
    floor: ['#6f7f8d', '#39444e'],
    stripe: '#2b6cb0',
    light: '#ffffff',
    line: 'rgba(20, 40, 60, 0.28)',
    door: '#5c7186',
    bench: '#e9eef2',
    glow: 0.55,
  },
  bright: {
    ceil: ['#e9eef2', '#ffffff'],
    wall: ['#eef3f7', '#ffffff'],
    floor: ['#dfe6ec', '#c2ccd5'],
    stripe: '#7fb4e6',
    light: '#ffffff',
    line: 'rgba(40, 70, 100, 0.16)',
    door: '#cfd9e2',
    bench: '#ffffff',
    glow: 0.9,
  },
  dark: {
    ceil: ['#0b1118', '#17212b'],
    wall: ['#101a24', '#1f2c39'],
    floor: ['#141c24', '#070b0f'],
    stripe: '#123a66',
    light: '#8fb6d8',
    line: 'rgba(140, 190, 240, 0.1)',
    door: '#0c141c',
    bench: '#243240',
    glow: 0.16,
  },
};

function paintScene(canvas: HTMLCanvasElement, kind: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const p = PALETTES[kind] ?? PALETTES.scene!;
  const w = (canvas.width = innerWidth);
  const h = (canvas.height = innerHeight);
  const cx = w * 0.5;
  const cy = h * 0.47;
  // Far end of the corridor.
  const fw = w * 0.16;
  const fh = h * 0.2;
  const L = cx - fw / 2;
  const R = cx + fw / 2;
  const T = cy - fh / 2;
  const B = cy + fh / 2;
  const grad = (x0: number, y0: number, x1: number, y1: number, c: [string, string]): CanvasGradient => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, c[0]);
    g.addColorStop(1, c[1]);
    return g;
  };
  const quad = (pts: number[], fill: string | CanvasGradient): void => {
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  /** Point on the corridor at depth k (0 = far end, 1 = screen edge) for a corner of the far wall. */
  const out = (x: number, y: number, k: number): [number, number] => [x + (x - cx) * k * 6.2, y + (y - cy) * k * 6.2];

  quad([0, 0, w, 0, R, T, L, T], grad(0, 0, 0, T, p.ceil));
  quad([0, h, w, h, R, B, L, B], grad(0, B, 0, h, p.floor));
  quad([0, 0, L, T, L, B, 0, h], grad(0, 0, L, 0, [p.wall[1], p.wall[0]]));
  quad([w, 0, R, T, R, B, w, h], grad(R, 0, w, 0, p.wall));
  quad([L, T, R, T, R, B, L, B], p.wall[0]);

  // Brand stripe along both walls.
  for (const side of [L, R]) {
    const a = out(side, cy + fh * 0.12, 1);
    const b = out(side, cy + fh * 0.2, 1);
    quad([side, cy + fh * 0.12, a[0], a[1], b[0], b[1], side, cy + fh * 0.2], p.stripe);
  }
  // Door at the far end, with a porthole.
  quad([cx - fw * 0.26, B, cx - fw * 0.26, T + fh * 0.16, cx + fw * 0.26, T + fh * 0.16, cx + fw * 0.26, B], p.door);
  ctx.fillStyle = p.light;
  ctx.globalAlpha = p.glow;
  ctx.beginPath();
  ctx.arc(cx, cy - fh * 0.08, fw * 0.07, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Floor tiles and wall joints.
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 1;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + (i / 6) * (fw / 2), B);
    ctx.lineTo(cx + (i / 6) * w * 1.9, h);
    ctx.stroke();
  }
  for (let i = 1; i <= 9; i++) {
    const k = (i / 9) ** 2.4;
    const a = out(L, B, k);
    const b = out(R, B, k);
    const c = out(L, T, k);
    const d = out(R, T, k);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.moveTo(b[0], b[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.stroke();
  }
  // Ceiling light panels.
  for (let i = 0; i < 5; i++) {
    const k0 = ((i + 0.25) / 5) ** 2.2;
    const k1 = ((i + 0.7) / 5) ** 2.2;
    const a = out(cx - fw * 0.2, T, k0);
    const b = out(cx + fw * 0.2, T, k0);
    const c = out(cx + fw * 0.2, T, k1);
    const d = out(cx - fw * 0.2, T, k1);
    ctx.globalAlpha = Math.min(1, p.glow + 0.3);
    quad([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]], p.light);
    ctx.globalAlpha = 1;
  }
  // A bench with analysers along the right wall.
  const b0 = out(R, B, 0.06);
  const b1 = out(R, B, 0.42);
  const t0 = out(R, cy + fh * 0.26, 0.06);
  const t1 = out(R, cy + fh * 0.26, 0.42);
  quad([b0[0] - w * 0.05, b0[1], b0[0], b0[1], t0[0], t0[1], t0[0] - w * 0.05, t0[1]], p.bench);
  quad([t0[0] - w * 0.05, t0[1], t0[0], t0[1], t1[0], t1[1], t1[0] - w * 0.2, t1[1]], p.bench);
  quad([b0[0] - w * 0.05, b0[1], t0[0] - w * 0.05, t0[1], t1[0] - w * 0.2, t1[1], t1[0] - w * 0.2, b1[1]], p.door);
  ctx.fillStyle = p.stripe;
  ctx.fillRect(t1[0] - w * 0.16, t1[1] - h * 0.11, w * 0.08, h * 0.11);
  // First-person weapon stand-in (bottom right).
  ctx.fillStyle = '#18222c';
  ctx.beginPath();
  ctx.moveTo(w * 0.62, h * 0.7);
  ctx.lineTo(w * 0.66, h * 0.66);
  ctx.lineTo(w * 0.86, h * 0.86);
  ctx.lineTo(w * 0.98, h);
  ctx.lineTo(w * 0.7, h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2f7fd0';
  ctx.beginPath();
  ctx.ellipse(w * 0.82, h * 0.97, w * 0.07, h * 0.09, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------------
// Fake map for the radar: rooms, benches, two sites, an extraction zone, coolers
// ---------------------------------------------------------------------------------

function demoMap(): MapData {
  const b = new MapBuilder({
    id: 'hud_demo',
    name: 'Laboratoire de Charleville',
    description: 'Carte factice du banc d’essai.',
    modes: ['tdm', 'defuse', 'secure'],
    players: [2, 16],
  });
  const W = 34;
  const D = 24;
  b.box(-W, -0.5, -D, W, 0, D, 'concrete_floor');
  b.box(-W - 0.4, 0, -D - 0.4, W + 0.4, 4, -D, 'plaster_white');
  b.box(-W - 0.4, 0, D, W + 0.4, 4, D + 0.4, 'plaster_white');
  b.box(-W - 0.4, 0, -D, -W, 4, D, 'plaster_white');
  b.box(W, 0, -D, W + 0.4, 4, D, 'plaster_white');
  for (const x of [-20, -7, 7, 20]) {
    b.box(x, 0, -D, x + 0.3, 3, -D * 0.5, 'plaster_white');
    b.box(x, 0, -D * 0.3, x + 0.3, 3, D * 0.2, 'plaster_white');
    b.box(x, 0, D * 0.42, x + 0.3, 3, D, 'plaster_white');
  }
  for (const z of [-9, 8]) {
    b.box(-W, 0, z, -W * 0.6, 3, z + 0.3, 'plaster_white');
    b.box(-W * 0.42, 0, z, W * 0.25, 3, z + 0.3, 'plaster_white');
    b.box(W * 0.45, 0, z, W, 3, z + 0.3, 'plaster_white');
  }
  for (let i = 0; i < 12; i++) {
    const x = -W + 4 + ((i * 7.3) % (2 * W - 9));
    const z = -D + 3 + ((i * 11.1) % (2 * D - 7));
    b.box(x, 0, z, x + 3.2, 0.9, z + 0.9, 'laminate_white');
    b.box(x + 4.2, 0, z + 2, x + 5.4, 1.7, z + 3.2, 'cardboard');
  }
  b.box(-3, 2.8, -3, 3, 3, 3, 'ceiling_tile'); // above the slice: must not show on the radar
  b.zone('site', 'A', -16, 0, 11, -9, 3, 18, 'Plateau technique');
  b.zone('site', 'B', 10, 0, -20, 17, 3, -13, 'Salle de prélèvement');
  b.zone('extract', 'X', 25, 0, 14, 32, 3, 22, 'Quai de livraison');
  b.point('sample', 's1', -24, 0, -3, 'Glacière 1');
  b.point('sample', 's2', 2, 0, -15, 'Glacière 2');
  for (let i = 0; i < 8; i++) {
    b.spawn(0, -W + 3 + (i % 4) * 1.6, 0, -D + 3 + Math.floor(i / 4) * 1.6, 180);
    b.spawn(1, W - 3 - (i % 4) * 1.6, 0, D - 3 - Math.floor(i / 4) * 1.6, 0);
  }
  return b.build();
}

// ---------------------------------------------------------------------------------
// Fake data
// ---------------------------------------------------------------------------------

const LOCAL_NAME = 'Stagiaire';
const HUMANS: Record<0 | 1, string[]> = {
  0: [LOCAL_NAME, 'Secrétaire Médicale', 'Interne de Garde'],
  1: ['Le Coursier', 'Client Mystère'],
};
const CHAT_LINES: [string, TeamId | -1, string, boolean][] = [
  ['Dr Pipette', 0, 'Ils passent par la salle de prélèvement !', true],
  ['Auditeur Zélé', 1, 'Vos procédures ne sont pas à jour…', false],
  ['Secrétaire Médicale', 0, 'J’ai plus de tubes violets, couvrez-moi', true],
  ['', -1, 'Le Coursier a rejoint Les Auditeurs', false],
  ['Le Coursier', 1, 'gg, belle série', false],
  ['Interne de Garde', 0, 'Qui a laissé la centrifugeuse ouverte ?', false],
  ['Fiche Qualité', 1, 'Je note, je note.', false],
];
const KILL_WEAPONS: (WeaponId | null)[] = ['rifle_m4', 'rifle_ak', 'smg', 'pistol', 'sniper', 'shotgun', 'deagle', 'knife', null];

function makeRoster(count: number, localTeam: TeamId): PlayerInfo[] {
  const list: PlayerInfo[] = [];
  const perTeam = [Math.ceil(count / 2), Math.floor(count / 2)];
  let id = 1;
  for (const team of [0, 1] as const) {
    const names = [...HUMANS[team], ...BOT_NAMES[team]];
    for (let i = 0; i < perTeam[team]!; i++) {
      const bot = i >= HUMANS[team].length;
      const kills = Math.max(0, Math.round(14 - i * 1.7 + ((i * 7 + team * 3) % 4)));
      const deaths = Math.round(4 + ((i * 5 + team) % 9));
      list.push({
        id: id++,
        name: names[i % names.length]!,
        team,
        bot,
        kills,
        deaths,
        score: kills * 2 + ((i * 3) % 5),
        ping: bot ? 0 : 18 + ((i * 37 + team * 11) % 90),
        alive: (i * 3 + team) % 4 !== 1,
      });
    }
  }
  // Local player: first human of the chosen team (id 1 when Labo).
  const me = list.find((p) => p.team === (localTeam === 1 ? 1 : 0) && !p.bot)!;
  me.name = LOCAL_NAME;
  list.push({ id: id++, name: 'Visiteur Médical', team: 2, bot: false, kills: 0, deaths: 0, score: 0, ping: 44, alive: false });
  list.push({ id: id++, name: 'Patient de 7 h 30', team: 2, bot: false, kills: 0, deaths: 0, score: 0, ping: 61, alive: false });
  return list;
}

interface Harness {
  ready: Promise<void>;
  hud: IHud;
  settings: SettingsStore;
  /** Every callback invocation, in order: [name, ...args]. */
  calls: unknown[][];
  frame(partial: Partial<HudFrame> | null): HudFrame;
  kill(entry?: Partial<KillFeedEntry>): void;
  hit(headshot?: boolean, kill?: boolean): void;
  damage(angle?: number, amount?: number): void;
  announce(title?: string, sub?: string, tone?: 'neutral' | 'good' | 'bad'): void;
  toast(text?: string): void;
  chat(name?: string, team?: TeamId | -1, text?: string, teamOnly?: boolean): void;
  roster(count?: number): PlayerInfo[];
  scoreboard(visible: boolean): void;
  openChat(teamOnly?: boolean): void;
  auto(on: boolean): void;
}

declare global {
  interface Window {
    __hud: Harness;
  }
}

const settings = new SettingsStore();
if (params.get('fps') === '1') settings.update({ showFps: true });
const calls: unknown[][] = [];
const callbacks: HudCallbacks = {
  chatSubmit(text, teamOnly) {
    calls.push(['chatSubmit', text, teamOnly]);
    hud.chatMessage(LOCAL_NAME, frame.team, text, teamOnly);
  },
  chatFocus(open) {
    calls.push(['chatFocus', open]);
  },
};

const scene = document.getElementById('scene') as HTMLCanvasElement;
const bg = params.get('bg') ?? 'scene';
paintScene(scene, bg);
addEventListener('resize', () => paintScene(scene, bg));

const hud = createHud(document.getElementById('hud')!, settings, callbacks);
const map = demoMap();
hud.setMap(map);

const startTeam: TeamId = params.get('team') === '1' ? 1 : 0;
const startMode = (['tdm', 'defuse', 'secure'].includes(params.get('mode') ?? '') ? params.get('mode') : 'tdm') as GameModeId;

/** The frame sent to the HUD (mutated by the demo loop, then overridden by `frame()` values). */
const frame: HudFrame = {
  visible: true,
  alive: true,
  health: 100,
  armor: 100,
  team: startTeam,
  weapon: 'rifle_m4',
  clip: 30,
  reserve: 90,
  reloading: false,
  slots: ['rifle_m4', 'pistol', 'knife'],
  activeSlot: 0,
  spread: 0.004,
  fov: settings.value.fov,
  zoom: 0,
  mode: startMode,
  phase: 'live',
  timeLeft: 163,
  round: 2,
  score: [1, 0],
  roundsToWin: startMode === 'tdm' ? 2 : 5,
  objectiveLine: '',
  prompt: null,
  action: null,
  spectating: null,
  respawnIn: -1,
  protected: false,
  carrying: false,
  ping: 28,
  fps: 144,
  radar: { x: -3, z: 2, yaw: 0.4, blips: [] },
};
let overrides: Partial<HudFrame> = {};
let auto = params.get('auto') !== '0';

const objectiveLine = (mode: GameModeId, a: number, b: number): string =>
  mode === 'tdm' ? `${a} – ${b} / 25` : mode === 'defuse' ? 'Sites A et B à protéger' : 'Glacières extraites : 1 / 2';

function staticBlips(t: number): NonNullable<HudFrame['radar']>['blips'] {
  const mate: TeamId = frame.team === 1 ? 1 : 0;
  const foe: TeamId = mate === 0 ? 1 : 0;
  const blips: NonNullable<HudFrame['radar']>['blips'] = [
    { x: -9 + Math.sin(t * 0.5) * 3, z: -4, team: mate, kind: 'player' },
    { x: 3, z: 9 + Math.cos(t * 0.4) * 2, team: mate, kind: 'player' },
    { x: -15, z: 12, team: mate, kind: 'player' },
    { x: 30, z: -18, team: mate, kind: 'player' },
    { x: 6 + Math.sin(t * 0.7) * 4, z: -9, team: foe, kind: 'player' },
    { x: -2, z: -14, team: foe, kind: 'player' },
  ];
  const mode = overrides.mode ?? frame.mode;
  if (mode === 'defuse') {
    blips.push({ x: -12.5, z: 14.5, team: 0, kind: 'site' }, { x: 13.5, z: -16.5, team: 0, kind: 'site' }, { x: 9, z: 4, team: 1, kind: 'bomb' });
  } else if (mode === 'secure') {
    blips.push({ x: -24, z: -3, team: 0, kind: 'sample' }, { x: 2, z: -15, team: 0, kind: 'sample' }, { x: 28.5, z: 18, team: 1, kind: 'site' });
  }
  return blips;
}

// --- Demo loop state -----------------------------------------------------------------
let simT = 0;
let nextShot = 1.5;
let burst = 0;
let reloadLeft = 0;
let nextKill = 2;
let nextChat = 4;
let nextHurt = 6;
let deadFor = 0;
let kills: [number, number] = [12, 9];
let seed = 12345;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)]!;

function randomKill(): KillFeedEntry {
  const killerTeam: TeamId = rnd() < 0.5 ? 0 : 1;
  const victimTeam: TeamId = killerTeam === 0 ? 1 : 0;
  const weapon = pick(KILL_WEAPONS);
  const local = rnd() < 0.25;
  const victim = pick(BOT_NAMES[victimTeam]);
  return {
    killer: weapon === null ? victim : local && killerTeam === frame.team ? LOCAL_NAME : pick(BOT_NAMES[killerTeam]),
    killerTeam: weapon === null ? victimTeam : killerTeam,
    victim,
    victimTeam,
    weapon,
    headshot: weapon !== null && weapon !== 'knife' && rnd() < 0.35,
    involvesLocal: weapon !== null && local && killerTeam === frame.team,
  };
}

function simulate(dt: number): void {
  simT += dt;
  const def = frame.weapon ? WEAPONS[frame.weapon] : null;
  frame.timeLeft = frame.timeLeft - dt;
  if (frame.timeLeft <= 0) frame.timeLeft = 163;
  frame.spread = Math.max(0.003, frame.spread * Math.exp(-6 * dt));
  frame.fps = 138 + Math.round(Math.sin(simT * 1.3) * 6);
  frame.ping = 27 + Math.round(Math.sin(simT * 0.7) * 4);
  const r = frame.radar!;
  r.yaw = 0.4 + Math.sin(simT * 0.35) * 1.4;
  r.x = -3 + Math.sin(simT * 0.21) * 9;
  r.z = 2 + Math.cos(simT * 0.17) * 7;

  if (deadFor > 0) {
    deadFor -= dt;
    frame.respawnIn = Math.max(0, deadFor);
    if (deadFor <= 0) {
      frame.alive = true;
      frame.health = 100;
      frame.armor = 100;
      frame.clip = def?.clip ?? 0;
      frame.respawnIn = -1;
      frame.spectating = null;
      frame.protected = true;
      window.setTimeout(() => (frame.protected = false), 2000);
    }
  } else if (def && def.kind !== 'melee') {
    if (reloadLeft > 0) {
      reloadLeft -= dt;
      if (reloadLeft <= 0) {
        const take = Math.min(def.clip - frame.clip, frame.reserve);
        frame.clip += take;
        frame.reserve = frame.reserve - take || def.reserve;
        frame.reloading = false;
      }
    } else if (simT >= nextShot) {
      if (burst === 0) burst = 3 + Math.floor(rnd() * 6);
      if (frame.clip > 0) {
        frame.clip--;
        frame.spread = Math.min(0.05, frame.spread + def.spreadShot * 2.2);
        if (rnd() < 0.4) hud.hitMarker(rnd() < 0.25, rnd() < 0.2);
      }
      burst--;
      nextShot = simT + (burst > 0 ? def.fireInterval : 1.2 + rnd() * 2.5);
      if (frame.clip <= 0) {
        frame.reloading = true;
        reloadLeft = def.reloadTime;
        burst = 0;
      }
    }
    if (simT >= nextHurt) {
      nextHurt = simT + 5 + rnd() * 6;
      const amount = 12 + Math.floor(rnd() * 30);
      hud.damageFrom((rnd() - 0.5) * Math.PI * 2, amount);
      frame.armor = Math.max(0, frame.armor - Math.round(amount / 2));
      frame.health = Math.max(0, frame.health - amount);
      if (frame.health <= 0) {
        frame.alive = false;
        frame.reloading = false;
        reloadLeft = 0;
        deadFor = 3;
        frame.spectating = 'Dr Pipette';
        kills[frame.team === 0 ? 1 : 0]++;
        hud.pushKill({ killer: 'Auditeur Zélé', killerTeam: frame.team === 0 ? 1 : 0, victim: LOCAL_NAME, victimTeam: frame.team, weapon: 'rifle_ak', headshot: false, involvesLocal: true });
      }
    }
  }

  if (simT >= nextKill) {
    nextKill = simT + 1.5 + rnd() * 3.5;
    const k = randomKill();
    kills[k.killerTeam === 0 ? 0 : 1]++;
    if (kills[0] >= 25 || kills[1] >= 25) kills = [0, 0];
    hud.pushKill(k);
  }
  if (simT >= nextChat) {
    nextChat = simT + 6 + rnd() * 7;
    const c = pick(CHAT_LINES);
    hud.chatMessage(c[0], c[1], c[2], c[3]);
  }
  frame.objectiveLine = objectiveLine(frame.mode, kills[0], kills[1]);
  r.blips = staticBlips(simT);
}

function matchState(): MatchState {
  const f = { ...frame, ...overrides };
  return {
    mapId: map.meta.id,
    mode: f.mode,
    phase: f.phase,
    phaseEnd: 0,
    round: f.round,
    score: f.score,
    roundsToWin: f.roundsToWin,
    lastWinner: -1,
    lastReason: '',
    obj: { kind: 'tdm', kills: [kills[0], kills[1]], killLimit: 25 },
  };
}

const api: Harness = {
  ready: Promise.resolve(),
  hud,
  settings,
  calls,
  frame(partial) {
    overrides = partial === null ? {} : { ...overrides, ...partial };
    const f = { ...frame, ...overrides };
    hud.update(f);
    return f;
  },
  kill(entry) {
    hud.pushKill({ ...randomKill(), ...entry });
  },
  hit(headshot = false, kill = false) {
    hud.hitMarker(headshot, kill);
  },
  damage(angle = 0.6, amount = 24) {
    hud.damageFrom(angle, amount);
  },
  announce(title, sub, tone = 'neutral') {
    const a = ANNOUNCE.round_start!;
    hud.announce(title ?? a.title, title ? sub : a.sub, tone);
  },
  toast(text = 'Vous avez rejoint l’Équipe Labo') {
    hud.toast(text);
  },
  chat(name = 'Dr Pipette', team = 0, text = 'Ils passent par la salle de prélèvement !', teamOnly = false) {
    hud.chatMessage(name, team, text, teamOnly);
  },
  roster(count = 16) {
    const f = { ...frame, ...overrides };
    const list = makeRoster(count, f.team);
    const me = list.find((p) => p.name === LOCAL_NAME)!;
    hud.setRoster(list, me.id, matchState());
    return list;
  },
  scoreboard(visible) {
    hud.setScoreboardVisible(visible);
  },
  openChat(teamOnly = false) {
    hud.openChat(teamOnly);
  },
  auto(on) {
    auto = on;
  },
};
window.__hud = api;
api.roster(16);

// --- Frame loop ----------------------------------------------------------------------
let last = performance.now();
function tick(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (auto) simulate(dt);
  else {
    frame.objectiveLine = objectiveLine(overrides.mode ?? frame.mode, kills[0], kills[1]);
    frame.radar!.blips = staticBlips(0);
  }
  hud.update({ ...frame, ...overrides });
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// --- Keyboard (manual testing) --------------------------------------------------------
const MODES: GameModeId[] = ['tdm', 'defuse', 'secure'];
const ANNOUNCE_KEYS = ['round_start', 'team_win_0', 'team_win_1', 'first_blood', 'bomb_planted', 'bomb_defused'];
let announceIndex = 0;
addEventListener('keydown', (e) => {
  if (hud.isChatOpen()) return;
  const slot = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
  if (slot >= 0 && frame.slots[slot]) {
    frame.activeSlot = slot;
    frame.weapon = frame.slots[slot]!;
    const def = WEAPONS[frame.weapon];
    frame.clip = def.clip;
    frame.reserve = def.reserve;
    frame.reloading = false;
    frame.zoom = 0;
    reloadLeft = 0;
    return;
  }
  switch (e.code) {
    case 'Tab':
      e.preventDefault();
      if (!e.repeat) {
        api.roster(16);
        hud.setScoreboardVisible(true);
      }
      break;
    case 'Enter':
    case 'KeyY':
      e.preventDefault();
      hud.openChat(false);
      break;
    case 'KeyU':
      e.preventDefault();
      hud.openChat(true);
      break;
    case 'KeyR':
      if (frame.weapon && WEAPONS[frame.weapon].clip > 0 && !frame.reloading) {
        frame.reloading = true;
        reloadLeft = WEAPONS[frame.weapon].reloadTime;
      }
      break;
    case 'KeyH':
      hud.hitMarker(false, false);
      break;
    case 'KeyJ':
      hud.hitMarker(true, false);
      break;
    case 'KeyK':
      hud.hitMarker(e.shiftKey, true);
      break;
    case 'KeyG':
      hud.damageFrom((rnd() - 0.5) * Math.PI * 2, 20);
      break;
    case 'KeyZ':
      if (frame.weapon === 'sniper') frame.zoom = (frame.zoom + 1) % 3;
      else {
        frame.slots[0] = 'sniper';
        frame.weapon = 'sniper';
        frame.activeSlot = 0;
        frame.clip = 5;
        frame.reserve = 20;
        frame.zoom = 1;
      }
      break;
    case 'KeyM':
      frame.mode = MODES[(MODES.indexOf(frame.mode) + 1) % MODES.length]!;
      frame.roundsToWin = frame.mode === 'tdm' ? 2 : 5;
      frame.carrying = frame.mode !== 'tdm';
      break;
    case 'KeyP': {
      const key = ANNOUNCE_KEYS[announceIndex++ % ANNOUNCE_KEYS.length]!;
      const a = ANNOUNCE[key]!;
      hud.announce(a.title, a.sub, key === 'team_win_0' || key === 'bomb_defused' ? 'good' : key === 'team_win_1' || key === 'bomb_planted' ? 'bad' : 'neutral');
      break;
    }
  }
});
addEventListener('keyup', (e) => {
  if (e.code === 'Tab') hud.setScoreboardVisible(false);
});

if (params.get('help') === '1') {
  document.getElementById('help')!.textContent =
    'Tab scores · Entrée chat · U équipe · 1-3 armes · R recharger · H/J/K touches · G dégâts · Z lunette · M mode · P annonce';
}

api.ready = (async () => {
  await initKeyLabels();
  await document.fonts.ready;
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
})();
