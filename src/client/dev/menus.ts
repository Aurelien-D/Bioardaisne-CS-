/**
 * Menus test bench (dev/menus.html): the real menus over an animated placeholder
 * scene, with logging callbacks and a small fake game flow so every screen can be
 * reached by hand:
 *   solo / create / join → loading → team select → load-out → "in game"
 *   (Échap opens the pause menu, Reprendre closes it, Quitter returns to the title).
 *
 * Automation: `await window.__menus.ready`, then `window.__menus.show(screen, arg)`.
 *   show('main')                          title screen
 *   show('solo' | 'create' | 'join' | 'controls' | 'credits')
 *   show('options', 'mouse' | 'video' | 'audio' | 'crosshair' | 'keys')
 *   show('error', 'Salon introuvable…')   title screen with an error and a pre-filled code
 *   show('loading', 0.42)
 *   show('pause', 'host' | 'guest' | 'solo')
 *   show('pause-options', 'audio')  show('pause-host', 'host' | 'solo')  show('pause-leave', 'host' | 'guest' | 'solo')
 *   show('team', 'tdm' | 'defuse' | 'secure')   show('loadout', 0 | 1)
 *   show('hide')   show('rain')   show('toast', 'Texte')
 *
 * URL parameters: ?bg=scene (default) | plain | bright — what is drawn behind the
 * menus; ?maps=real keeps only the registered maps (by default two mock maps are
 * added while the registry has no public map); ?log=1 shows the callback log.
 */
import type { MenuCallbacks, PauseContext } from '../core/contracts';
import { SettingsStore } from '../core/settings';
import { MAP_MODULES, listMaps, type MapModule } from '../../shared/maps';
import { MapBuilder } from '../../shared/maps/builder';
import type { MapMeta } from '../../shared/maps/types';
import { DEFAULT_ROOM_CONFIG, type GameModeId, type RoomConfig, type TeamId } from '../../shared/types';
import { DEFAULT_LOADOUT, TEAM_DEFAULT_LOADOUT } from '../../shared/weapons/defs';
import { initKeyLabels } from '../ui/keys';
import { createMenus, type MenusApi } from '../ui/menus';

const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------------------------
// Mock maps (only while no public map is registered) to exercise the map picker
// ---------------------------------------------------------------------------------

function mockMap(meta: MapMeta, variant: number): MapModule {
  return {
    meta,
    build() {
      const b = new MapBuilder(meta);
      const W = variant === 0 ? 30 : 22;
      const D = variant === 0 ? 20 : 26;
      b.box(-W, -0.5, -D, W, 0, D, 'concrete_floor');
      b.box(-W - 0.4, 0, -D - 0.4, W + 0.4, 4, -D, 'plaster_white');
      b.box(-W - 0.4, 0, D, W + 0.4, 4, D + 0.4, 'plaster_white');
      b.box(-W - 0.4, 0, -D, -W, 4, D, 'plaster_white');
      b.box(W, 0, -D, W + 0.4, 4, D, 'plaster_white');
      // Rooms: a grid of walls with door gaps.
      const cols = variant === 0 ? [-18, -6, 6, 18] : [-10, 2, 12];
      for (const x of cols) {
        b.box(x, 0, -D, x + 0.3, 3, -D * 0.45, 'plaster_white');
        b.box(x, 0, -D * 0.25, x + 0.3, 3, D * 0.2, 'plaster_white');
        b.box(x, 0, D * 0.45, x + 0.3, 3, D, 'plaster_white');
      }
      for (const z of variant === 0 ? [-8, 8] : [-14, 0, 13]) {
        b.box(-W, 0, z, -W * 0.55, 3, z + 0.3, 'plaster_white');
        b.box(-W * 0.35, 0, z, W * 0.3, 3, z + 0.3, 'plaster_white');
        b.box(W * 0.5, 0, z, W, 3, z + 0.3, 'plaster_white');
      }
      // Benches (low cover) and crates.
      for (let i = 0; i < 9; i++) {
        const x = -W + 4 + ((i * 7.3) % (2 * W - 8));
        const z = -D + 3 + ((i * 11.1) % (2 * D - 6));
        b.box(x, 0, z, x + 3, 0.9, z + 0.8, 'laminate_white');
        b.box(x + 4, 0, z + 2, x + 5.2, 1.6, z + 3.2, 'cardboard');
      }
      for (let i = 0; i < 8; i++) {
        b.spawn(0, -W + 3 + (i % 4) * 1.6, 0, -D + 3 + Math.floor(i / 4) * 1.6, 180);
        b.spawn(1, W - 3 - (i % 4) * 1.6, 0, D - 3 - Math.floor(i / 4) * 1.6, 0);
      }
      if (meta.modes.includes('defuse')) {
        b.zone('site', 'A', -W * 0.5, 0, D * 0.5, -W * 0.5 + 6, 3, D * 0.5 + 5, 'Plateau technique');
        b.zone('site', 'B', W * 0.25, 0, -D * 0.8, W * 0.25 + 6, 3, -D * 0.8 + 5, 'Salle de prélèvement');
      }
      if (meta.modes.includes('secure')) {
        b.zone('extract', 'X', W - 7, 0, D - 6, W - 1, 3, D - 1, 'Parking');
        b.point('sample', 's1', -W * 0.6, 0, -2, 'Glacière 1');
        b.point('sample', 's2', -2, 0, -D * 0.6, 'Glacière 2');
      }
      return b.build();
    },
  };
}

if (params.get('maps') !== 'real' && listMaps().length === 0) {
  MAP_MODULES.push(
    mockMap(
      {
        id: 'mock_charleville',
        name: 'Laboratoire de Charleville',
        description: 'Plateau technique, salles de prélèvement et quai de livraison : le grand classique du samedi matin.',
        modes: ['tdm', 'defuse', 'secure'],
        players: [6, 16],
      },
      0,
    ),
    mockMap(
      {
        id: 'mock_rethel',
        name: 'Site de Rethel',
        description: 'Un laboratoire de proximité aux couloirs serrés. Idéal pour les duels rapides.',
        modes: ['tdm', 'secure'],
        players: [2, 8],
      },
      1,
    ),
  );
}

// ---------------------------------------------------------------------------------
// Placeholder scene behind the menus
// ---------------------------------------------------------------------------------

function startScene(canvas: HTMLCanvasElement, mode: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const resize = (): void => {
    canvas.width = Math.floor(innerWidth / 2);
    canvas.height = Math.floor(innerHeight / 2);
  };
  resize();
  addEventListener('resize', resize);
  const frame = (t: number): void => {
    const w = canvas.width;
    const h = canvas.height;
    if (mode === 'plain') {
      ctx.fillStyle = '#05101d';
      ctx.fillRect(0, 0, w, h);
      return; // static: nothing to animate
    }
    const bright = mode === 'bright';
    // A corridor in one-point perspective that slowly drifts: enough to judge
    // the menu backdrop over something that looks like a lit 3D scene.
    const cx = w * (0.62 + 0.05 * Math.sin(t / 7000));
    const cy = h * (0.46 + 0.02 * Math.cos(t / 5300));
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    if (bright) {
      sky.addColorStop(0, '#dfeaf3');
      sky.addColorStop(0.46, '#f7fbff');
      sky.addColorStop(0.47, '#b9c4cc');
      sky.addColorStop(1, '#8d9aa5');
    } else {
      sky.addColorStop(0, '#16304a');
      sky.addColorStop(0.46, '#2b587f');
      sky.addColorStop(0.47, '#1a2a38');
      sky.addColorStop(1, '#0b1520');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const k = ((i + (t / 2600) % 1) / 14) ** 2.2;
      const rw = w * 1.5 * k;
      const rh = h * 1.5 * k;
      ctx.strokeStyle = bright ? `rgba(40, 70, 100, ${0.1 + 0.5 * k})` : `rgba(140, 200, 255, ${0.08 + 0.4 * k})`;
      ctx.strokeRect(cx - rw / 2, cy - rh / 2, rw, rh);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.strokeStyle = bright ? 'rgba(40, 70, 100, 0.25)' : 'rgba(140, 200, 255, 0.16)';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * w, cy + Math.sin(a) * w);
      ctx.stroke();
    }
    // Ceiling lights.
    for (let i = 0; i < 5; i++) {
      const k = ((i + (t / 2600) % 1) / 5) ** 2;
      const lw = w * 0.5 * k;
      const y = cy - h * 0.7 * k;
      ctx.fillStyle = bright ? `rgba(255, 255, 255, ${0.5 + 0.5 * k})` : `rgba(210, 235, 255, ${0.25 + 0.6 * k})`;
      ctx.fillRect(cx - lw / 2, y, lw, Math.max(1, h * 0.03 * k));
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------------
// Menus + fake game flow
// ---------------------------------------------------------------------------------

type ShowArg = string | number | Record<string, unknown> | undefined;

interface Harness {
  ready: Promise<void>;
  show(screen: string, arg?: ShowArg): void;
  menus: MenusApi;
  settings: SettingsStore;
  /** Every callback invocation, in order: [name, ...args]. */
  calls: unknown[][];
}

declare global {
  interface Window {
    __menus: Harness;
  }
}

const settings = new SettingsStore();
const root = document.getElementById('menus')!;
const logEl = document.getElementById('log')!;
const calls: unknown[][] = [];
const showLog = params.get('log') === '1';

function log(name: string, ...args: unknown[]): void {
  calls.push([name, ...args]);
  if (name !== 'uiSound') console.log(`[menus] ${name}`, ...args);
  if (showLog) {
    const lines = calls
      .filter((c) => c[0] !== 'uiSound')
      .slice(-8)
      .map((c) => `${String(c[0])}(${c.slice(1).map((a) => JSON.stringify(a)).join(', ')})`);
    logEl.textContent = lines.join('\n');
  }
}

let config: RoomConfig = { ...DEFAULT_ROOM_CONFIG, mapId: (listMaps()[0] ?? listMaps(true)[0])?.id ?? DEFAULT_ROOM_CONFIG.mapId };
let online: { code: string; host: boolean } | null = null;
let inGame = false;
let team: TeamId = 0;
let loadingTimer = 0;
/** The pause menu is open (team / load-out picked from there do not chain to the next screen). */
let paused = false;
let pauseKind: string | undefined;

const pauseContext = (kind?: string): PauseContext => {
  if (kind === 'solo') return { roomCode: null, shareUrl: null, isHost: true, config, local: true };
  if (kind === 'guest') return { roomCode: 'K7M2P', shareUrl: `${location.origin}/?room=K7M2P`, isHost: false, config, local: false };
  if (kind === 'host') return { roomCode: 'K7M2P', shareUrl: `${location.origin}/?room=K7M2P`, isHost: true, config, local: false };
  return online
    ? { roomCode: online.code, shareUrl: `${location.origin}/?room=${online.code}`, isHost: online.host, config, local: false }
    : { roomCode: null, shareUrl: null, isHost: true, config, local: true };
};

const fakeLoading = (then: () => void): void => {
  const steps = ['Construction de la carte…', 'Génération des textures…', 'Calcul de l’éclairage…', 'Étalonnage des automates…', 'Connexion au plateau technique…'];
  let f = 0;
  window.clearInterval(loadingTimer);
  loadingTimer = window.setInterval(() => {
    f += 0.02;
    menus.showLoading(steps[Math.min(steps.length - 1, Math.floor(f * steps.length))]!, f);
    if (f >= 1) {
      window.clearInterval(loadingTimer);
      then();
    }
  }, 60);
};

const startGame = (): void => {
  fakeLoading(() => {
    inGame = true;
    menus.showTeamSelect({ counts: [3, 4], current: 2, mode: config.mode });
  });
};

const callbacks: MenuCallbacks = {
  playSolo(cfg) {
    log('playSolo', cfg);
    config = cfg;
    online = null;
    startGame();
  },
  createRoom(cfg) {
    log('createRoom', cfg);
    config = cfg;
    online = { code: 'K7M2P', host: true };
    startGame();
  },
  joinRoom(code) {
    log('joinRoom', code);
    if (code === 'XXXXX') {
      // Handy way to see the error state by hand.
      menus.showLoading('Connexion au salon…', 0.3);
      window.setTimeout(() => menus.showMain({ error: `Salon « ${code} » introuvable. Vérifiez le code auprès de l’hôte.`, joinCode: code }), 700);
      return;
    }
    online = { code, host: false };
    startGame();
  },
  resume() {
    log('resume');
    paused = false;
    menus.hide();
  },
  leave() {
    log('leave');
    inGame = false;
    paused = false;
    menus.showMain();
  },
  pickTeam(t) {
    log('pickTeam', t);
    team = t === 0 || t === 1 || t === 2 ? t : 0;
    // From the pause menu the menus resume by themselves; on the way into the game we chain the screens.
    if (paused) return;
    if (team === 2) menus.hide();
    else menus.showLoadout(TEAM_DEFAULT_LOADOUT[team], team);
  },
  pickLoadout(l) {
    log('pickLoadout', l);
    if (!paused) menus.hide();
  },
  hostConfig(patch, restart) {
    log('hostConfig', patch, restart);
    config = { ...config, ...patch };
    if (restart) {
      paused = false;
      startGame();
    } else menus.showPause(pauseContext(pauseKind));
  },
  uiSound(kind) {
    log('uiSound', kind);
  },
};

const menus = createMenus(root, settings, callbacks);

const openPause = (kind?: string): void => {
  inGame = true;
  paused = true;
  pauseKind = kind;
  menus.showPause(pauseContext(kind));
};

// "In game": Escape opens the pause menu (the real game does it when the pointer lock is released).
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && inGame && menus.current === null) openPause();
});

function show(screen: string, arg?: ShowArg): void {
  window.clearInterval(loadingTimer);
  const s = typeof arg === 'string' ? arg : undefined;
  switch (screen) {
    case 'main':
      menus.showMain(typeof arg === 'object' ? (arg as { error?: string; joinCode?: string }) : undefined);
      break;
    case 'solo':
    case 'create':
    case 'join':
    case 'controls':
    case 'credits':
      menus.showMain();
      menus.navigate(screen);
      break;
    case 'options':
      menus.showMain();
      menus.navigate(`options/${s ?? 'mouse'}`);
      break;
    case 'error':
      menus.showMain({ error: s ?? 'Salon « K7M2P » introuvable. Vérifiez le code auprès de l’hôte.', joinCode: 'K7M2P' });
      break;
    case 'loading':
      menus.showLoading('Calcul de l’éclairage du plateau technique…', typeof arg === 'number' ? arg : 0.42);
      break;
    case 'pause':
      openPause(s ?? 'host');
      break;
    case 'pause-options':
      openPause('host');
      menus.navigate(`options/${s ?? 'mouse'}`);
      break;
    case 'pause-host':
      openPause(s ?? 'host');
      menus.navigate('host');
      break;
    case 'pause-leave':
      openPause(s ?? 'host');
      menus.navigate('leave');
      break;
    case 'team':
      paused = false;
      menus.showTeamSelect({ counts: [3, 5], current: typeof arg === 'object' ? ((arg.current as TeamId) ?? 2) : 2, mode: (s as GameModeId) ?? 'defuse' });
      break;
    case 'loadout': {
      paused = false;
      const t: TeamId = arg === 1 ? 1 : 0;
      menus.showLoadout(t === 1 ? TEAM_DEFAULT_LOADOUT[1] : DEFAULT_LOADOUT, t);
      break;
    }
    case 'hide':
      menus.hide();
      break;
    case 'rain':
      for (let i = 0; i < 5; i++) document.querySelector<HTMLElement>('.bas-logo-btn')?.click();
      break;
    case 'toast':
      menus.toast(s ?? 'Lien d’invitation copié !', 'success');
      break;
    default:
      console.warn(`[menus] unknown screen "${screen}"`);
  }
}

startScene(document.getElementById('scene') as HTMLCanvasElement, params.get('bg') ?? 'scene');

const ready = (async () => {
  await initKeyLabels();
  await document.fonts.ready;
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
})();

window.__menus = { ready, show, menus, settings, calls };

const room = params.get('room');
menus.showMain(room ? { joinCode: room } : undefined);
const initial = params.get('show');
if (initial) show(initial, params.get('arg') ?? undefined);
