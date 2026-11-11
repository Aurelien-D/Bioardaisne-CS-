/**
 * Real-time audio engine (implements IAudio).
 *
 *   voices ─┬─ world ── duck low-pass ─┐
 *           ├─ ui ─────────────────────┼─ sfx ──┐
 *           │      ambience ─ (world)  ┘        │
 *           ├─ voice (announcer jingles) ───────┼─ master ─ compressor ─ clipper ─ out
 *           └─ music ───────────────────────────┘
 *
 * Every sound is a pre-rendered AudioBuffer (see bank.ts) played through a pooled
 * voice: flat voices (gain + stereo pan) for the local player, the interface and
 * the music cues; spatial voices (distance low-pass + gain + HRTF panner + reverb
 * send) for everything that happens in the world. At most MAX_VOICES play at once;
 * when the pool is full the quietest / least important voice is faded out.
 *
 * The engine knows whether the listener stands indoors or outdoors (setIndoor, or the
 * ambience as a fallback): the local player's gunshots get the matching reflection
 * layer and the shared reverb of the world switches between a room and open air.
 *
 * Every public method is a silent no-op until unlock() has been called from a
 * user gesture, and when Web Audio is not available.
 */
import type { FeedbackSound, IAudio, UiSound, WeaponFoley } from '../core/contracts';
import type { SettingsStore } from '../core/settings';
import { ANNOUNCE } from '../../shared/identity';
import type { SurfaceType } from '../../shared/maps/materials';
import type { Vec3 } from '../../shared/math/vec3';
import { WEAPONS, type WeaponDef, type WeaponId } from '../../shared/weapons/defs';
import { Announcer } from './announcer';
import { Bank, allSounds, getSound, offlineSupported } from './bank';
import { impulseResponse } from './kit';
import { calibrateCompressor, createMasterChain, type MasterChain } from './master';
import './sounds';
import { foleySound, partName } from './sounds/foley';
import { SURFACES } from './sounds/steps';

// --- Limits ---------------------------------------------------------------------------

const MAX_VOICES = 32;
const MAX_SPATIAL_CHAINS = 36;
const MAX_FLAT_CHAINS = 24;
/** A sound requested before its buffer exists is still played if the render takes less than this. */
const LATE_MS = 220;

// --- Buses ----------------------------------------------------------------------------

const BUS_WORLD = 0;
const BUS_UI = 1;
const BUS_VOICE = 2;
const BUS_AMB = 3;

/** Level of the looping layers relative to their bus. */
const AMBIENCE_LEVEL = 0.55;
const MUSIC_LEVEL = 1.5;

// --- Voice groups (for selective cancellation) -------------------------------------------

const GROUP_NONE = 0;
const GROUP_LOCAL_RELOAD = 1;
const GROUP_AMBIENCE = 2;
/** Reflections of the local player's last shot: a new shot replaces them. */
const GROUP_LOCAL_TAIL = 3;
/** Pump / bolt cycling scheduled by the engine after a local shot (when the view model does not emit it). */
const GROUP_LOCAL_CYCLE = 4;

// --- Spatial behaviour per kind of sound ---------------------------------------------------

interface Spatial {
  /** Distance (m) under which the sound plays at full level. */
  ref: number;
  /** Distance at which it has completely faded out. */
  max: number;
  /** Roll-off steepness beyond `ref`. */
  roll: number;
  /** Low-pass cut-off: lpNear × exp(-d / lpDist), never below lpFar. */
  lpNear: number;
  lpFar: number;
  lpDist: number;
  /** Shared reverb send amount (grows with the distance). */
  send: number;
  /** Base priority (the audible level adds up to 30). */
  prio: number;
  /** Random pitch spread (±). */
  jitter: number;
}

const SP_SHOT: Spatial = { ref: 5, max: 150, roll: 0.6, lpNear: 19000, lpFar: 700, lpDist: 26, send: 0.5, prio: 40, jitter: 0.03 };
const SP_TAIL: Spatial = { ref: 7, max: 170, roll: 0.45, lpNear: 9000, lpFar: 420, lpDist: 30, send: 0.6, prio: 22, jitter: 0.04 };
const SP_MECH: Spatial = { ref: 1.5, max: 22, roll: 1, lpNear: 16000, lpFar: 2500, lpDist: 20, send: 0.08, prio: 12, jitter: 0.04 };
// Footsteps carry: hearing where the others run is half of the game.
const SP_STEP: Spatial = { ref: 3.2, max: 30, roll: 0.7, lpNear: 16000, lpFar: 1500, lpDist: 20, send: 0.12, prio: 30, jitter: 0.04 };
const SP_IMPACT: Spatial = { ref: 2.5, max: 50, roll: 0.9, lpNear: 18000, lpFar: 1500, lpDist: 25, send: 0.2, prio: 15, jitter: 0.07 };
const SP_BODY: Spatial = { ref: 2.5, max: 40, roll: 0.9, lpNear: 18000, lpFar: 1800, lpDist: 25, send: 0.12, prio: 35, jitter: 0.05 };
const SP_WHIZZ: Spatial = { ref: 0.9, max: 9, roll: 1.1, lpNear: 20000, lpFar: 20000, lpDist: 1, send: 0, prio: 45, jitter: 0.1 };
const SP_OBJ: Spatial = { ref: 6, max: 140, roll: 0.5, lpNear: 18000, lpFar: 1200, lpDist: 40, send: 0.35, prio: 60, jitter: 0 };
const SP_BLAST: Spatial = { ref: 25, max: 400, roll: 0.4, lpNear: 18000, lpFar: 900, lpDist: 90, send: 0.4, prio: 90, jitter: 0 };

const PRIO_FEEDBACK = 100;
const PRIO_LOCAL_SHOT = 95;
const PRIO_LOCAL = 70;
const PRIO_AMBIENCE = 4;

// --- Name tables (no string building while playing) ------------------------------------------

const WEAPON_LIST = Object.keys(WEAPONS) as WeaponId[];
const table = <K extends string>(keys: readonly K[], prefix: string, suffix = ''): Record<K, string> =>
  Object.fromEntries(keys.map((k) => [k, `${prefix}${k}${suffix}`])) as Record<K, string>;

const SHOT_FULL = table(WEAPON_LIST, 'shot_');
const SHOT_DRY = table(WEAPON_LIST, 'shot_', '_dry');
const SHOT_TAIL = table(WEAPON_LIST, 'shot_', '_tail');
const SHOT_ROOM = table(WEAPON_LIST, 'shot_', '_room');
const SHOT_OPEN = table(WEAPON_LIST, 'shot_', '_open');
const STEP_NAME = table(SURFACES, 'step_');
const LAND_NAME = table(SURFACES, 'land_');
const IMPACT_NAME = table(SURFACES, 'impact_');
const UI_NAME = table<UiSound>(['click', 'hover', 'back', 'error', 'join', 'chat'], 'ui_');
const FB_NAME = table<FeedbackSound>(
  [
    'hitmarker',
    'headshot',
    'kill',
    'hurt',
    'death',
    'respawn',
    'pickup',
    'countdown',
    'round_start',
    'round_win',
    'round_lose',
    'plant_tick',
    'defuse_tick',
  ],
  'fb_',
);

type ReloadPart = 'cloth' | 'mag_out' | 'mag_in' | 'slide' | 'bolt_back' | 'bolt_forward' | 'pump' | 'shell_in' | 'draw';
type ReloadStep = readonly [fraction: number, part: ReloadPart, gain: number];

/**
 * Reload choreography per weapon category, as fractions of the reload duration. Used for the
 * other players (and for a view model without animation events); the parts are the family
 * sounds of sounds/foley.ts.
 */
const RELOADS: Record<WeaponDef['category'], readonly ReloadStep[]> = {
  melee: [],
  pistol: [
    [0.02, 'cloth', 0.7],
    [0.16, 'mag_out', 1],
    [0.36, 'cloth', 0.5],
    [0.52, 'mag_in', 1],
    [0.8, 'slide', 1],
  ],
  smg: [
    [0.02, 'cloth', 0.7],
    [0.18, 'mag_out', 0.9],
    [0.38, 'cloth', 0.5],
    [0.54, 'mag_in', 0.95],
    [0.8, 'slide', 0.95],
  ],
  rifle: [
    [0.02, 'cloth', 0.8],
    [0.18, 'mag_out', 1],
    [0.38, 'cloth', 0.6],
    [0.54, 'mag_in', 1],
    [0.8, 'slide', 1],
  ],
  // Shell inserts are generated from the duration (see reload()).
  shotgun: [[0.02, 'cloth', 0.8]],
  sniper: [
    [0.07, 'bolt_back', 1],
    [0.26, 'mag_out', 1],
    [0.4, 'cloth', 0.6],
    [0.53, 'mag_in', 1],
    [0.77, 'bolt_forward', 1],
  ],
};

const RELOAD_PARTS: readonly ReloadPart[] = ['cloth', 'mag_out', 'mag_in', 'slide', 'bolt_back', 'bolt_forward', 'pump', 'shell_in', 'draw'];
/** Sound of each part per weapon ('' = the weapon has no such part). */
const PART_NAME = Object.fromEntries(
  WEAPON_LIST.map((w) => [w, Object.fromEntries(RELOAD_PARTS.map((p) => [p, p === 'cloth' ? 'cloth' : partName(w, p)]))]),
) as Record<WeaponId, Record<ReloadPart, string>>;

/** Jingle that precedes each announcer line, and how long the voice waits for it (ms). */
const JINGLES: Record<string, readonly [jingle: string, voiceDelay: number, rate: number]> = {
  round_start: ['jingle_neutral', 430, 1],
  round_start_last: ['jingle_tense', 520, 1],
  warmup: ['jingle_info', 260, 1],
  team_win_0: ['jingle_neutral', 430, 1.122],
  team_win_1: ['jingle_neutral', 430, 0.891],
  round_draw: ['jingle_info', 260, 0.891],
  match_win_0: ['jingle_match', 620, 1],
  match_win_1: ['jingle_match', 620, 0.891],
  match_draw: ['jingle_info', 260, 0.794],
  first_blood: ['jingle_streak', 230, 1],
  double_kill: ['jingle_streak', 230, 1.059],
  triple_kill: ['jingle_streak', 230, 1.122],
  multi_kill: ['jingle_streak', 230, 1.189],
  headshot: ['jingle_streak', 230, 1.335],
  knife_kill: ['jingle_streak', 230, 0.891],
  last_alive: ['jingle_tense', 520, 1],
  time_low: ['jingle_warn', 330, 1],
  bomb_planted: ['jingle_alert', 420, 1],
  bomb_defused: ['jingle_good', 400, 1],
  bomb_exploded: ['jingle_alert', 420, 0.794],
  bomb_dropped: ['jingle_info', 260, 0.891],
  bomb_picked: ['jingle_info', 260, 1.122],
  sample_taken: ['jingle_alert', 420, 1.122],
  sample_dropped: ['jingle_info', 260, 0.891],
  sample_returned: ['jingle_good', 400, 1.122],
  sample_extracted: ['jingle_alert', 420, 0.891],
};
const DEFAULT_JINGLE = ['jingle_info', 260, 1] as const;

interface AmbientEvent {
  sound: string;
  /** Seconds before the first occurrence, then between occurrences: [min, max]. */
  first: readonly [number, number];
  every: readonly [number, number];
  gain: readonly [number, number];
  /** 'sweep' pans across the stereo field during the sound (a passing car). */
  pan: 'random' | 'sweep';
  /** Number of times the sound is struck in a row: [min, max] and spacing. */
  repeat?: readonly [number, number, number];
}

const AMBIENT_EVENTS: Record<'interior' | 'city', readonly AmbientEvent[]> = {
  interior: [
    { sound: 'amb_beep', first: [3, 9], every: [7, 18], gain: [0.5, 1], pan: 'random' },
    { sound: 'amb_centrifuge', first: [9, 26], every: [38, 85], gain: [0.6, 1], pan: 'random' },
    { sound: 'amb_phone', first: [16, 48], every: [55, 120], gain: [0.6, 1], pan: 'random' },
  ],
  city: [
    { sound: 'amb_bird', first: [1.5, 5], every: [3, 10], gain: [0.4, 1], pan: 'random' },
    { sound: 'amb_car', first: [6, 16], every: [15, 38], gain: [0.6, 1], pan: 'sweep' },
    { sound: 'amb_bell', first: [20, 55], every: [75, 160], gain: [0.7, 1], pan: 'random', repeat: [1, 4, 2.35] },
  ],
};

// --- Local gunfire ---------------------------------------------------------------------

/**
 * Level of the local player's shot number `burst` of a spray (0 = first): every shot after the
 * first sits a little lower, so thirty rounds in three seconds stay punchy without piling up
 * against the limiter. Shared with the dev bench, which measures a whole spray offline.
 */
export function localShotLevel(burst: number): number {
  return burst <= 0 ? 1 : burst < 3 ? 0.93 : burst < 8 ? 0.87 : 0.82;
}

/** Level of the reflection layer that follows that shot. */
export function localTailLevel(burst: number): number {
  return burst <= 0 ? 1 : 0.85;
}

/**
 * Extra level panning of world sounds on top of the HRTF, at 90° to the side. The HRTF alone
 * places sounds faithfully but shyly (about 3 dB between the ears for a gunshot): in a game the
 * side a shot or a footstep comes from has to be obvious, on any headphones or speakers.
 */
export const SIDE_PAN = 0.5;

/** Time constant (s) of the fade applied to a voice that is cut short (stolen, cancelled, replaced). */
export const CUT_FADE = 0.006;

// --- Voices ---------------------------------------------------------------------------

const IDLE = 0;
const PLAYING = 1;
const FADING = 2;

class Voice {
  src: AudioBufferSourceNode | null = null;
  state = IDLE;
  prio = 0;
  group = GROUP_NONE;
  /** Context time after which the voice is certainly over (guards against a lost `ended`). */
  deadline = 0;
  startAt = 0;
  bus: AudioNode | null = null;
  /** World position (spatial voices), to keep the side panning right while the listener turns. */
  x = 0;
  y = 0;
  z = 0;
  readonly onEnded: () => void;

  constructor(
    owner: AudioEngine,
    /** Where the buffer source connects. */
    readonly input: AudioNode,
    readonly gain: GainNode,
    /** Last node of the chain, connected to a bus. */
    readonly out: AudioNode,
    readonly lowpass: BiquadFilterNode | null,
    readonly panner: PannerNode | null,
    readonly send: GainNode | null,
    readonly pan: StereoPannerNode | null,
  ) {
    this.onEnded = () => owner.release(this);
  }
}

interface Loop {
  name: string;
  src: AudioBufferSourceNode | null;
  gain: GainNode;
  /** Set when the loop was faded out (possibly before its buffer was rendered). */
  cancelled: boolean;
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function contextCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Slider value (0..1) to gain: a gentle taper so the low end of the slider stays usable. */
const taper = (v: number): number => Math.pow(clamp01(Number.isFinite(v) ? v : 0), 1.5);

export class AudioEngine implements IAudio {
  private ctx: AudioContext | null = null;
  private bank: Bank | null = null;
  private dead = false;

  private master: MasterChain | null = null;
  private sfxBus!: GainNode;
  private worldBus!: GainNode;
  private uiBus!: GainNode;
  private voiceBus!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private duck!: BiquadFilterNode;
  private duckGain!: GainNode;
  private reverbIn!: GainNode;
  /** Wet levels of the two shared reverbs (room indoors, open air outdoors). */
  private wetRoom!: GainNode;
  private wetOpen!: GainNode;
  private nyquist = 20000;
  /** Listener under a roof: told by the game (setIndoor), else guessed from the ambience. */
  private indoor = false;
  private indoorTold = false;

  private readonly spatial: Voice[] = [];
  private readonly flat: Voice[] = [];
  private active = 0;
  private readonly lastVariant = new Map<string, number>();

  // Listener.
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private rx = 1;
  private rz = 0;
  private listenerSet = false;

  // Rate limiters (context time of the last start).
  private lastImpact = -1;
  private impactBurst = 0;
  private lastWhizz = -1;
  private lastHover = -1;
  private lastHit = -1;
  private readonly lastTail: Record<string, number> = {};

  // Local weapon.
  private lastLocalShot = -10;
  private lastLocalWeapon: WeaponId | null = null;
  /** Shots fired in a row without letting go (drives the level of a spray). */
  private burst = 0;
  /** A magazine / shell event came since the last local shot: bolt and pump events belong to a reload. */
  private loadedSinceShot = false;
  /** Weapons whose view model emits its own pump / bolt sounds after a shot. */
  private readonly cycleByFoley: Partial<Record<WeaponId, boolean>> = {};
  private lastFoley: WeaponFoley | null = null;
  private lastFoleyAt = -1;

  // Feet: left and right alternate (local player, and everybody else as a whole).
  private localFoot = 1;
  private worldFoot = 1;

  // Loops.
  private ambWanted: 'interior' | 'city' | null = null;
  private amb: Loop | null = null;
  private ambTimer: ReturnType<typeof setInterval> | null = null;
  private readonly ambNext: number[] = [];
  private musicWanted: 'menu' | null = null;
  private mus: Loop | null = null;

  private readonly announcer: Announcer;
  private readonly gestureUnlock: () => void;

  constructor(private readonly settings: SettingsStore) {
    this.announcer = new Announcer(settings);
    settings.onChange(() => this.applySettings());
    // Safety net: the first click or key press unlocks the audio even if the game forgets to.
    this.gestureUnlock = () => this.unlock();
    try {
      window.addEventListener('pointerdown', this.gestureUnlock, { capture: true, passive: true });
      window.addEventListener('keydown', this.gestureUnlock, { capture: true, passive: true });
    } catch {
      /* no window: stay silent */
    }
  }

  // ===================================================================================
  // Set-up
  // ===================================================================================

  unlock(): void {
    if (this.dead) return;
    try {
      if (!this.ctx) this.init();
      const ctx = this.ctx;
      if (!ctx) return;
      if (ctx.state !== 'running') {
        void ctx.resume().then(
          () => this.onRunning(),
          () => undefined,
        );
      } else {
        this.onRunning();
      }
    } catch {
      this.dead = true;
    }
  }

  private onRunning(): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    try {
      window.removeEventListener('pointerdown', this.gestureUnlock, { capture: true });
      window.removeEventListener('keydown', this.gestureUnlock, { capture: true });
    } catch {
      /* ignore */
    }
    this.syncAmbience();
    this.syncMusic();
  }

  private init(): void {
    const Ctor = contextCtor();
    if (!Ctor || !offlineSupported()) {
      this.dead = true;
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      ctx = new Ctor();
    }
    this.ctx = ctx;
    this.nyquist = Math.min(20000, ctx.sampleRate * 0.46);
    this.bank = new Bank(ctx.sampleRate);

    const gain = (v: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    this.master = createMasterChain(ctx, ctx.destination);
    void calibrateCompressor().then((makeup) => {
      if (this.master) this.master.trim.gain.value = 1 / makeup;
    });
    this.sfxBus = gain(1);
    this.voiceBus = gain(1);
    this.musicBus = gain(1);
    this.worldBus = gain(1);
    this.uiBus = gain(1);
    this.ambBus = gain(AMBIENCE_LEVEL);
    // Hurt / death muffle: a low-pass (and a small dip) on everything heard in the world.
    this.duck = ctx.createBiquadFilter();
    this.duck.type = 'lowpass';
    this.duck.frequency.value = this.nyquist;
    this.duck.Q.value = 0.6;
    this.duckGain = gain(1);
    this.worldBus.connect(this.duck);
    this.ambBus.connect(this.duck);
    this.duck.connect(this.duckGain);
    this.duckGain.connect(this.sfxBus);
    this.uiBus.connect(this.sfxBus);
    this.sfxBus.connect(this.master.input);
    this.voiceBus.connect(this.master.input);
    this.musicBus.connect(this.master.input);
    // Shared reverb send for spatialised sounds: a room indoors, open air outdoors (cross-faded).
    this.reverbIn = gain(1);
    const reverb = (kind: 'room' | 'far'): GainNode => {
      const conv = ctx.createConvolver();
      conv.buffer = impulseResponse(ctx, kind);
      const wet = gain(0);
      this.reverbIn.connect(conv);
      conv.connect(wet);
      wet.connect(this.worldBus);
      return wet;
    };
    this.wetRoom = reverb('room');
    this.wetOpen = reverb('far');
    this.applyEnvironment(true);

    this.applyVolumes(true);
    this.pushListener(0, 0, -1);

    // Render the catalogue in the background, most urgent first. Loops are rendered on demand.
    const order = ['ui', 'feedback', 'shot', 'mech', 'step', 'impact', 'objective', 'jingle'];
    const names: string[] = [];
    for (const group of order) for (const d of allSounds()) if (d.group === group) names.push(d.name);
    this.bank.prewarm(names);
  }

  applySettings(): void {
    this.applyVolumes(false);
  }

  private applyVolumes(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const s = this.settings.value;
    const t = ctx.currentTime;
    const set = (g: GainNode, v: number): void => {
      try {
        if (immediate) g.gain.value = v;
        else g.gain.setTargetAtTime(v, t, 0.03);
      } catch {
        g.gain.value = v;
      }
    };
    set(this.master.input, taper(s.volumeMaster));
    set(this.sfxBus, taper(s.volumeSfx));
    set(this.voiceBus, taper(s.volumeVoice));
    set(this.musicBus, taper(s.volumeMusic) * MUSIC_LEVEL);
  }

  private get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  // ===================================================================================
  // Surroundings
  // ===================================================================================

  /** The listener stands under a roof (true) or under the open sky (false). */
  setIndoor(indoor: boolean): void {
    if (this.indoorTold && indoor === this.indoor) return;
    this.indoorTold = true;
    this.indoor = indoor;
    this.applyEnvironment(false);
  }

  private applyEnvironment(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.wetRoom) return;
    const room = this.indoor ? 0.75 : 0;
    const open = this.indoor ? 0.2 : 0.8;
    try {
      if (immediate) {
        this.wetRoom.gain.value = room;
        this.wetOpen.gain.value = open;
      } else {
        this.wetRoom.gain.setTargetAtTime(room, ctx.currentTime, 0.25);
        this.wetOpen.gain.setTargetAtTime(open, ctx.currentTime, 0.25);
      }
    } catch {
      this.wetRoom.gain.value = room;
      this.wetOpen.gain.value = open;
    }
  }

  // ===================================================================================
  // Listener
  // ===================================================================================

  setListener(pos: Vec3, forward: Vec3): void {
    this.lx = pos.x;
    this.ly = pos.y;
    this.lz = pos.z;
    this.listenerSet = true;
    if (!this.ctx) return;
    this.pushListener(forward.x, forward.y, forward.z);
    // Sounds already playing follow the head.
    for (let i = 0; i < this.spatial.length; i++) {
      const v = this.spatial[i];
      if (v.state === PLAYING && v.pan) v.pan.pan.value = this.sideOf(v.x, v.y, v.z);
    }
  }

  private pushListener(fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    let fl = Math.hypot(fx, fy, fz);
    if (!(fl > 1e-6)) {
      fx = 0;
      fy = 0;
      fz = -1;
      fl = 1;
    }
    fx /= fl;
    fy /= fl;
    fz /= fl;
    // right = forward × worldUp; kept from the previous frame when looking straight up or down.
    const rl = Math.hypot(fz, fx);
    if (rl > 1e-3) {
      this.rx = -fz / rl;
      this.rz = fx / rl;
    }
    // up = right × forward.
    const ux = -this.rz * fy;
    const uy = this.rz * fx - this.rx * fz;
    const uz = this.rx * fy;
    try {
      const l = ctx.listener;
      if (l.positionX) {
        l.positionX.value = this.lx;
        l.positionY.value = this.ly;
        l.positionZ.value = this.lz;
        l.forwardX.value = fx;
        l.forwardY.value = fy;
        l.forwardZ.value = fz;
        l.upX.value = ux;
        l.upY.value = uy;
        l.upZ.value = uz;
      } else {
        l.setPosition(this.lx, this.ly, this.lz);
        l.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    } catch {
      /* a listener that cannot be moved only loses the panning */
    }
  }

  // ===================================================================================
  // Voice pool
  // ===================================================================================

  /** Called when a buffer source ends: the chain goes back to the pool. */
  release(v: Voice): void {
    if (v.state === IDLE) return;
    if (v.state === PLAYING) this.active--;
    const src = v.src;
    if (src) {
      src.onended = null;
      try {
        src.disconnect();
      } catch {
        /* already disconnected */
      }
      v.src = null;
    }
    v.state = IDLE;
    v.group = GROUP_NONE;
  }

  /** Fade a voice out quickly (stolen or cancelled); it returns to the pool when the source ends. */
  private silence(v: Voice): void {
    const ctx = this.ctx;
    if (!ctx || v.state !== PLAYING || !v.src) return;
    const now = ctx.currentTime;
    this.active--;
    v.state = FADING;
    try {
      if (v.startAt > now + 0.005) {
        // Not started yet: simply never play it.
        v.src.stop();
        v.deadline = now + 0.05;
      } else {
        v.gain.gain.cancelScheduledValues(0);
        v.gain.gain.setTargetAtTime(0, now, CUT_FADE);
        v.src.stop(now + 0.04);
        v.deadline = now + 0.09;
      }
    } catch {
      this.release(v);
    }
  }

  private makeVoice(spatial: boolean): Voice {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    if (spatial) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.5;
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      // Attenuation is computed by the engine (per kind of sound), not by the panner.
      panner.rolloffFactor = 0;
      panner.refDistance = 1;
      const send = ctx.createGain();
      send.gain.value = 0;
      lp.connect(g);
      g.connect(panner);
      g.connect(send);
      send.connect(this.reverbIn);
      // Level panning after the HRTF (see SIDE_PAN).
      if (typeof ctx.createStereoPanner === 'function') {
        const side = ctx.createStereoPanner();
        panner.connect(side);
        return new Voice(this, lp, g, side, lp, panner, send, side);
      }
      return new Voice(this, lp, g, panner, lp, panner, send, null);
    }
    if (typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      g.connect(pan);
      return new Voice(this, g, g, pan, null, null, null, pan);
    }
    return new Voice(this, g, g, g, null, null, null, null);
  }

  private acquire(spatial: boolean, prio: number): Voice | null {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const pool = spatial ? this.spatial : this.flat;
    // Chains whose `ended` event was lost come back here.
    for (let i = 0; i < pool.length; i++) {
      const v = pool[i];
      if (v.state !== IDLE && now > v.deadline) this.release(v);
    }
    if (this.active >= MAX_VOICES) {
      let victim: Voice | null = null;
      for (let p = 0; p < 2; p++) {
        const list = p === 0 ? this.spatial : this.flat;
        for (let i = 0; i < list.length; i++) {
          const v = list[i];
          if (v.state === PLAYING && (victim === null || v.prio < victim.prio)) victim = v;
        }
      }
      if (!victim || victim.prio >= prio) return null;
      this.silence(victim);
    }
    for (let i = 0; i < pool.length; i++) if (pool[i].state === IDLE) return pool[i];
    if (pool.length < (spatial ? MAX_SPATIAL_CHAINS : MAX_FLAT_CHAINS)) {
      const v = this.makeVoice(spatial);
      pool.push(v);
      return v;
    }
    // Every chain of this kind is busy: free the least important one for the next request.
    let victim: Voice | null = null;
    for (let i = 0; i < pool.length; i++) {
      const v = pool[i];
      if (v.state === PLAYING && (victim === null || v.prio < victim.prio)) victim = v;
    }
    if (victim && victim.prio < prio) this.silence(victim);
    return null;
  }

  private busNode(bus: number): AudioNode {
    return bus === BUS_WORLD ? this.worldBus : bus === BUS_UI ? this.uiBus : bus === BUS_VOICE ? this.voiceBus : this.ambBus;
  }

  private pickVariant(name: string, count: number): number {
    if (count <= 1) return 0;
    const last = this.lastVariant.get(name);
    let i = Math.floor(Math.random() * count);
    if (i === last) i = (i + 1 + Math.floor(Math.random() * (count - 1))) % count;
    this.lastVariant.set(name, i);
    return i;
  }

  /**
   * Play a non-spatial sound. `pan` -1..1; `panTo` (when finite) sweeps the pan over the sound.
   * Returns the voice (or null when dropped / deferred).
   */
  private playFlat(
    name: string,
    bus: number,
    gain: number,
    prio: number,
    delay = 0,
    rate = 1,
    jitter = 0,
    group = GROUP_NONE,
    pan = 0,
    panTo = NaN,
  ): Voice | null {
    const ctx = this.ctx;
    const bank = this.bank;
    if (!ctx || !bank || ctx.state !== 'running' || gain <= 0) return null;
    const buffers = bank.get(name);
    if (!buffers) {
      this.defer(name, delay, (late) => this.playFlat(name, bus, gain, prio, Math.max(0, delay - late), rate, jitter, group, pan, panTo));
      return null;
    }
    const v = this.acquire(false, prio);
    if (!v) return null;
    const buf = buffers[this.pickVariant(name, buffers.length)];
    const r = jitter > 0 ? rate * (1 + (Math.random() * 2 - 1) * jitter) : rate;
    const when = ctx.currentTime + delay;
    if (v.pan) {
      v.pan.pan.cancelScheduledValues(0);
      v.pan.pan.setValueAtTime(pan, when);
      if (Number.isFinite(panTo)) v.pan.pan.linearRampToValueAtTime(panTo, when + buf.duration / r);
    }
    this.startVoice(v, buf, this.busNode(bus), jitter > 0 ? gain * (0.92 + Math.random() * 0.16) : gain, r, when, prio, group);
    return v;
  }

  /** Play a sound in the world. `level` scales the gain, `tone` scales the low-pass cut-off. */
  private playAt(
    name: string,
    sp: Spatial,
    x: number,
    y: number,
    z: number,
    level = 1,
    delay = 0,
    rate = 1,
    tone = 1,
    group = GROUP_NONE,
  ): Voice | null {
    const ctx = this.ctx;
    const bank = this.bank;
    if (!ctx || !bank || ctx.state !== 'running') return null;
    const dx = x - this.lx;
    const dy = y - this.ly;
    const dz = z - this.lz;
    const d = this.listenerSet ? Math.sqrt(dx * dx + dy * dy + dz * dz) : 0;
    if (d >= sp.max) return null;
    // Inverse roll-off beyond the reference distance, eased to silence near the maximum.
    let g = d <= sp.ref ? 1 : sp.ref / (sp.ref + sp.roll * (d - sp.ref));
    const edge = d / sp.max;
    if (edge > 0.6) {
      const u = (1 - edge) / 0.4;
      g *= u * u * (3 - 2 * u);
    }
    g *= level;
    if (g < 0.002) return null;
    const buffers = bank.get(name);
    if (!buffers) {
      this.defer(name, delay, (late) => this.playAt(name, sp, x, y, z, level, Math.max(0, delay - late), rate, tone, group));
      return null;
    }
    const prio = sp.prio + 30 * Math.min(1, g);
    const v = this.acquire(true, prio);
    if (!v) return null;
    const buf = buffers[this.pickVariant(name, buffers.length)];
    const cutoff = Math.min(this.nyquist, Math.max(sp.lpFar, sp.lpNear * Math.exp(-d / sp.lpDist)) * tone);
    v.lowpass!.frequency.value = cutoff;
    v.send!.gain.value = sp.send > 0 ? Math.min(0.6, sp.send * (0.25 + d / 45)) : 0;
    const p = v.panner!;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
    v.x = x;
    v.y = y;
    v.z = z;
    if (v.pan) {
      v.pan.pan.cancelScheduledValues(0);
      v.pan.pan.value = this.sideOf(x, y, z);
    }
    const r = rate * (1 + (Math.random() * 2 - 1) * sp.jitter);
    this.startVoice(v, buf, this.worldBus, g * (0.92 + Math.random() * 0.16), r, ctx.currentTime + delay, prio, group);
    return v;
  }

  /** How far to the listener's right (+) or left (-) a point is, as a pan value. */
  private sideOf(x: number, y: number, z: number): number {
    const dx = x - this.lx;
    const dy = y - this.ly;
    const dz = z - this.lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return d > 1e-3 && this.listenerSet ? (SIDE_PAN * (dx * this.rx + dz * this.rz)) / d : 0;
  }

  private startVoice(
    v: Voice,
    buf: AudioBuffer,
    bus: AudioNode,
    gain: number,
    rate: number,
    when: number,
    prio: number,
    group: number,
  ): void {
    const ctx = this.ctx!;
    try {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      v.gain.gain.cancelScheduledValues(0);
      v.gain.gain.value = gain;
      if (v.bus !== bus) {
        if (v.bus) v.out.disconnect();
        v.out.connect(bus);
        v.bus = bus;
      }
      src.connect(v.input);
      src.onended = v.onEnded;
      src.start(when);
      v.src = src;
      v.state = PLAYING;
      v.prio = prio;
      v.group = group;
      v.startAt = when;
      v.deadline = when + buf.duration / rate + 0.5;
      this.active++;
    } catch {
      v.state = IDLE;
    }
  }

  /** First use of a sound whose buffer is still rendering: play it late rather than never. */
  private defer(name: string, delay: number, play: (lateSeconds: number) => void): void {
    const bank = this.bank;
    if (!bank || !getSound(name)) return;
    const asked = performance.now();
    bank.load(name, true).then(
      () => {
        const late = performance.now() - asked;
        if (late <= LATE_MS + delay * 1000 && this.running) play(late / 1000);
      },
      () => undefined,
    );
  }

  private cancelGroup(group: number): void {
    for (let p = 0; p < 2; p++) {
      const list = p === 0 ? this.spatial : this.flat;
      for (let i = 0; i < list.length; i++) if (list[i].state === PLAYING && list[i].group === group) this.silence(list[i]);
    }
  }

  // ===================================================================================
  // Weapons
  // ===================================================================================

  shot(weapon: WeaponId, pos: Vec3 | null): void {
    if (!this.running) return;
    const now = this.ctx!.currentTime;
    if (pos === null) {
      const def = WEAPONS[weapon];
      const held = weapon === this.lastLocalWeapon && now - this.lastLocalShot < Math.max(0.17, (def?.fireInterval ?? 0.1) * 1.7);
      this.burst = held ? this.burst + 1 : 0;
      this.lastLocalShot = now;
      this.lastLocalWeapon = weapon;
      this.loadedSinceShot = false;
      this.playFlat(SHOT_FULL[weapon], BUS_WORLD, localShotLevel(this.burst), PRIO_LOCAL_SHOT, 0, 1, 0.025);
      if (weapon === 'knife') return;
      // Reflections of the place: one layer at a time, the new shot takes over from the last.
      this.cancelGroup(GROUP_LOCAL_TAIL);
      this.playFlat((this.indoor ? SHOT_ROOM : SHOT_OPEN)[weapon], BUS_WORLD, localTailLevel(this.burst), PRIO_LOCAL_SHOT - 8, 0, 1, 0.03, GROUP_LOCAL_TAIL);
      if (this.cycleByFoley[weapon]) return;
      const parts = PART_NAME[weapon];
      if (weapon === 'shotgun') this.playFlat(parts.pump, BUS_WORLD, 0.85, PRIO_LOCAL, 0.34, 1, 0.03, GROUP_LOCAL_CYCLE);
      else if (weapon === 'sniper') {
        this.playFlat(parts.bolt_back, BUS_WORLD, 0.85, PRIO_LOCAL, 0.48, 1, 0.03, GROUP_LOCAL_CYCLE);
        this.playFlat(parts.bolt_forward, BUS_WORLD, 0.85, PRIO_LOCAL, 0.88, 1, 0.03, GROUP_LOCAL_CYCLE);
      }
      return;
    }
    const { x, y, z } = pos;
    const d = this.listenerSet ? Math.hypot(x - this.lx, y - this.ly, z - this.lz) : 0;
    // Sound travels at 343 m/s: a far shot is seen (tracer, flash) before it is heard.
    const travel = Math.min(0.3, d / 343);
    this.playAt(SHOT_DRY[weapon], SP_SHOT, x, y, z, 1, travel);
    if (weapon === 'knife') return;
    // The tail arrives a little later and takes over as the shot gets farther:
    // close gunfire cracks, far gunfire thumps.
    if (now - (this.lastTail[weapon] ?? -1) > 0.07) {
      this.lastTail[weapon] = now;
      this.playAt(SHOT_TAIL[weapon], SP_TAIL, x, y, z, 0.8 + Math.min(1.4, d / 30), travel + 0.02 + Math.min(0.14, d / 500));
    }
    const parts = PART_NAME[weapon];
    if (weapon === 'shotgun') this.playAt(parts.pump, SP_MECH, x, y, z, 0.9, travel + 0.34);
    else if (weapon === 'sniper') {
      this.playAt(parts.bolt_back, SP_MECH, x, y, z, 0.9, travel + 0.48);
      this.playAt(parts.bolt_forward, SP_MECH, x, y, z, 0.9, travel + 0.88);
    }
  }

  /**
   * One mechanical sound of the local player's weapon, asked for by the first-person animation
   * on the frame the part moves. Each weapon family has its own set (sounds/foley.ts).
   */
  foley(sound: WeaponFoley, weapon: WeaponId): void {
    if (!this.running) return;
    const s = foleySound(weapon, sound);
    if (!s) return;
    const now = this.ctx!.currentTime;
    // The same event from two animation tracks on the same frame plays once.
    if (sound === this.lastFoley && now - this.lastFoleyAt < 0.03) return;
    this.lastFoley = sound;
    this.lastFoleyAt = now;
    if (sound === 'draw') {
      // Switching weapons interrupts whatever the hands were doing.
      this.cancelGroup(GROUP_LOCAL_RELOAD);
      this.cancelGroup(GROUP_LOCAL_CYCLE);
    } else if (sound === 'mag_out' || sound === 'mag_in' || sound === 'shell_in') {
      this.loadedSinceShot = true;
    } else if ((sound === 'pump' || sound === 'bolt_forward' || sound === 'bolt_back') && (weapon === 'shotgun' || weapon === 'sniper')) {
      // The view model cycles the action itself after a shot: the engine stops doing it.
      if (weapon === this.lastLocalWeapon && !this.loadedSinceShot && now - this.lastLocalShot < 1.4 && !this.cycleByFoley[weapon]) {
        this.cycleByFoley[weapon] = true;
        this.cancelGroup(GROUP_LOCAL_CYCLE);
      }
    }
    const soft = sound === 'cloth' || sound === 'swish';
    this.playFlat(s.name, BUS_WORLD, s.gain, soft ? PRIO_LOCAL - 25 : PRIO_LOCAL, 0, 1, 0.035, GROUP_LOCAL_RELOAD, (Math.random() - 0.5) * 0.3);
  }

  reload(weapon: WeaponId, duration: number, pos: Vec3 | null): void {
    if (!this.running) return;
    const def = WEAPONS[weapon];
    if (!def || !(duration > 0.2)) return;
    const local = pos === null;
    if (!local && Math.hypot(pos.x - this.lx, pos.y - this.ly, pos.z - this.lz) > SP_MECH.max) return;
    if (local) this.cancelGroup(GROUP_LOCAL_RELOAD);
    const parts = PART_NAME[weapon];
    const step = (frac: number, part: ReloadPart, gain: number): void => {
      const sound = parts[part];
      if (!sound) return;
      if (local) this.playFlat(sound, BUS_WORLD, gain, PRIO_LOCAL, frac * duration, 1, 0.03, GROUP_LOCAL_RELOAD, (Math.random() - 0.5) * 0.3);
      else this.playAt(sound, SP_MECH, pos.x, pos.y, pos.z, gain, frac * duration);
    };
    for (const [frac, part, gain] of RELOADS[def.category]) step(frac, part, gain);
    if (def.category === 'shotgun') {
      // One shell roughly every 0.45 s, then the pump.
      const shells = Math.max(2, Math.min(def.clip, Math.round((duration * 0.62) / 0.45)));
      for (let i = 0; i < shells; i++) step(0.1 + (0.62 * i) / shells, 'shell_in', 0.9 + (i % 2) * 0.1);
      step(0.82, 'pump', 1);
    }
  }

  draw(weapon: WeaponId, pos: Vec3 | null): void {
    if (!this.running) return;
    const sound = PART_NAME[weapon]?.draw;
    if (!sound) return;
    if (pos === null) {
      // Switching weapons interrupts a reload in progress.
      this.cancelGroup(GROUP_LOCAL_RELOAD);
      this.cancelGroup(GROUP_LOCAL_CYCLE);
      this.playFlat(sound, BUS_WORLD, 1, PRIO_LOCAL, 0, 1, 0.03, GROUP_LOCAL_RELOAD);
    } else {
      this.playAt(sound, SP_MECH, pos.x, pos.y, pos.z);
    }
  }

  dryFire(pos: Vec3 | null): void {
    if (!this.running) return;
    if (pos === null) this.playFlat('dryfire', BUS_WORLD, 1, PRIO_LOCAL, 0, 1, 0.04);
    else this.playAt('dryfire', SP_MECH, pos.x, pos.y, pos.z);
  }

  zoom(): void {
    if (!this.running) return;
    this.playFlat('zoom', BUS_WORLD, 1, PRIO_LOCAL, 0, 1, 0.04);
  }

  // ===================================================================================
  // Movement
  // ===================================================================================

  footstep(surf: SurfaceType, pos: Vec3 | null, loud: number): void {
    if (!this.running) return;
    const name = STEP_NAME[surf] ?? STEP_NAME.concrete;
    const level = 0.3 + 0.7 * clamp01(loud);
    if (pos === null) {
      // Left, right, left: the two feet sit on either side and are never quite the same pitch.
      // Your own steps stay a little under everybody else's.
      const foot = (this.localFoot = -this.localFoot);
      this.playFlat(name, BUS_WORLD, level * 0.7, PRIO_LOCAL - 20, 0, 1 + foot * 0.035, 0.04, GROUP_NONE, foot * 0.16);
    } else {
      const foot = (this.worldFoot = -this.worldFoot);
      this.playAt(name, SP_STEP, pos.x, pos.y, pos.z, level * 1.15, 0, 1 + foot * 0.035);
    }
  }

  jump(pos: Vec3 | null): void {
    if (!this.running) return;
    if (pos === null) this.playFlat('jump', BUS_WORLD, 0.9, PRIO_LOCAL - 20, 0, 1, 0.06);
    else this.playAt('jump', SP_STEP, pos.x, pos.y, pos.z, 1);
  }

  land(surf: SurfaceType, speed: number, pos: Vec3 | null): void {
    if (!this.running) return;
    const name = LAND_NAME[surf] ?? LAND_NAME.concrete;
    const s = Number.isFinite(speed) ? Math.abs(speed) : 4;
    // 0 for a step down, 1 for a fall that hurts: louder, lower and with the body's own thud.
    const k = clamp01((s - 2.5) / 9.5);
    const level = 0.35 + 0.85 * Math.sqrt(k);
    const rate = 1.08 - 0.24 * k;
    if (pos === null) {
      this.playFlat(name, BUS_WORLD, level * 0.85, PRIO_LOCAL - 10, 0, rate, 0.04);
      if (k > 0.45) this.playFlat('land_heavy', BUS_WORLD, (k - 0.3) * 1.2, PRIO_LOCAL - 12, 0, 1.1 - 0.2 * k, 0.04);
    } else {
      this.playAt(name, SP_STEP, pos.x, pos.y, pos.z, level * 1.1, 0, rate);
      if (k > 0.45) this.playAt('land_heavy', SP_STEP, pos.x, pos.y, pos.z, (k - 0.3) * 1.3, 0, 1.1 - 0.2 * k);
    }
  }

  // ===================================================================================
  // Bullets
  // ===================================================================================

  impact(surf: SurfaceType, pos: Vec3): void {
    if (!this.running) return;
    // A shotgun blast lands eight pellets in the same instant: three impacts are plenty.
    const now = this.ctx!.currentTime;
    if (now - this.lastImpact < 0.03) {
      if (++this.impactBurst > 2) return;
    } else {
      this.lastImpact = now;
      this.impactBurst = 0;
    }
    this.playAt(IMPACT_NAME[surf] ?? IMPACT_NAME.concrete, SP_IMPACT, pos.x, pos.y, pos.z, 1, this.impactBurst * 0.012);
  }

  bodyHit(pos: Vec3, headshot: boolean): void {
    if (!this.running) return;
    this.playAt(headshot ? 'bodyhit_head' : 'bodyhit', SP_BODY, pos.x, pos.y, pos.z);
  }

  /** `pos` = the point of the bullet's path closest to the listener: the closer, the louder. */
  whizz(pos: Vec3): void {
    if (!this.running) return;
    const now = this.ctx!.currentTime;
    // A burst passing by is a few distinct cracks, not a buzz.
    if (now - this.lastWhizz < 0.06) return;
    this.lastWhizz = now;
    // Very close: the supersonic crack; a little further: only the hiss of the bullet.
    const miss = Math.hypot(pos.x - this.lx, pos.y - this.ly, pos.z - this.lz);
    this.playAt(miss < 1.6 ? 'whizz_crack' : 'whizz', SP_WHIZZ, pos.x, pos.y, pos.z);
  }

  // ===================================================================================
  // Interface, feedback, objectives
  // ===================================================================================

  ui(kind: UiSound): void {
    if (!this.running) return;
    const name = UI_NAME[kind];
    if (!name) return;
    if (kind === 'hover') {
      const now = this.ctx!.currentTime;
      if (now - this.lastHover < 0.045) return;
      this.lastHover = now;
    }
    this.playFlat(name, BUS_UI, 1, PRIO_FEEDBACK);
  }

  feedback(kind: FeedbackSound): void {
    if (!this.running) return;
    const name = FB_NAME[kind];
    if (!name) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    if (kind === 'hitmarker') {
      if (now - this.lastHit < 0.02) return;
      this.lastHit = now;
    }
    this.playFlat(name, BUS_UI, 1, PRIO_FEEDBACK, 0, 1, kind === 'hitmarker' || kind === 'hurt' ? 0.03 : 0);
    if (kind === 'hurt') this.muffle(650, 0.55, 0.75);
    else if (kind === 'death') {
      this.cancelGroup(GROUP_LOCAL_RELOAD);
      this.muffle(380, 1.6, 0.6);
    } else if (kind === 'respawn') this.muffle(this.nyquist, 0.05, 1);
  }

  /** Low-pass duck of the world: drop to `cutoff` at once, open again over `recover` seconds. */
  private muffle(cutoff: number, recover: number, dip: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    try {
      const f = this.duck.frequency;
      f.cancelScheduledValues(now);
      f.setTargetAtTime(Math.min(cutoff, this.nyquist), now, 0.008);
      f.setTargetAtTime(this.nyquist, now + 0.09, recover / 3);
      const g = this.duckGain.gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(dip, now, 0.008);
      g.setTargetAtTime(1, now + 0.09, recover / 3);
    } catch {
      /* cosmetic */
    }
  }

  objective(kind: string, pos: Vec3 | null): void {
    if (!this.running || typeof kind !== 'string') return;
    const name = `obj_${kind}`;
    if (!getSound(name)) return;
    if (pos === null) {
      this.playFlat(name, BUS_WORLD, 1, PRIO_FEEDBACK - 5);
      return;
    }
    const blast = kind === 'bomb_exploded';
    this.playAt(name, blast ? SP_BLAST : SP_OBJ, pos.x, pos.y, pos.z);
    if (blast) {
      // Close to the blast, the world goes dull for a moment.
      const d = Math.hypot(pos.x - this.lx, pos.y - this.ly, pos.z - this.lz);
      if (d < 30) this.muffle(500 + d * 60, 1.4, 0.8);
    }
  }

  announce(key: string): void {
    if (typeof key !== 'string') return;
    const line = ANNOUNCE[key];
    const [jingle, voiceDelay, rate] = JINGLES[key] ?? DEFAULT_JINGLE;
    if (this.running) this.playFlat(jingle, BUS_VOICE, 1, PRIO_FEEDBACK - 2, 0, rate);
    if (line?.voice) this.announcer.say(line.voice, this.running ? voiceDelay : 0);
  }

  // ===================================================================================
  // Ambience and music
  // ===================================================================================

  ambience(kind: 'interior' | 'city' | null): void {
    const next = kind === 'interior' || kind === 'city' ? kind : null;
    if (next === this.ambWanted) return;
    this.ambWanted = next;
    // Until the game says otherwise, the ambience tells whether the map is an interior.
    if (!this.indoorTold && next !== null) {
      this.indoor = next === 'interior';
      this.applyEnvironment(false);
    }
    this.syncAmbience();
  }

  music(track: 'menu' | null): void {
    const next = track === 'menu' ? track : null;
    if (next === this.musicWanted) return;
    this.musicWanted = next;
    this.syncMusic();
  }

  private fadeOutLoop(loop: Loop, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const src = loop.src;
    loop.src = null;
    loop.cancelled = true;
    try {
      loop.gain.gain.cancelScheduledValues(now);
      loop.gain.gain.setTargetAtTime(0, now, seconds / 4);
      if (src) {
        src.onended = () => {
          try {
            src.disconnect();
            loop.gain.disconnect();
          } catch {
            /* ignore */
          }
        };
        src.stop(now + seconds * 1.3);
      } else {
        loop.gain.disconnect();
      }
    } catch {
      /* ignore */
    }
  }

  /** Start a looping buffer on `bus`, fading in; the source is attached when the render is ready. */
  private startLoop(name: string, bus: AudioNode, fadeIn: number, stillWanted: () => boolean): Loop | null {
    const ctx = this.ctx;
    const bank = this.bank;
    if (!ctx || !bank) return null;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(bus);
    const loop: Loop = { name, src: null, gain, cancelled: false };
    bank.load(name, true).then(
      (buffers) => {
        if (loop.cancelled || !stillWanted() || loop.src || !this.ctx) return;
        try {
          const src = ctx.createBufferSource();
          src.buffer = buffers[0];
          src.loop = true;
          src.connect(gain);
          const now = ctx.currentTime;
          gain.gain.cancelScheduledValues(now);
          gain.gain.setValueAtTime(0, now);
          gain.gain.linearRampToValueAtTime(1, now + fadeIn);
          src.start(now);
          loop.src = src;
        } catch {
          /* stays silent */
        }
      },
      () => undefined,
    );
    return loop;
  }

  private syncAmbience(): void {
    if (!this.ctx || !this.bank) return;
    const want = this.ambWanted;
    const name = want ? `amb_${want}` : null;
    if (this.amb && this.amb.name !== name) {
      // Cross-fade: the old bed leaves while the new one comes in.
      this.fadeOutLoop(this.amb, 1.8);
      this.amb = null;
      this.cancelGroup(GROUP_AMBIENCE);
    }
    if (this.ambTimer !== null) {
      clearInterval(this.ambTimer);
      this.ambTimer = null;
    }
    if (!want || !name) return;
    if (!this.amb) this.amb = this.startLoop(name, this.ambBus, 2.2, () => this.ambWanted === want && this.amb?.name === name);
    const events = AMBIENT_EVENTS[want];
    this.bank.prewarm(events.map((e) => e.sound));
    const now = this.ctx.currentTime;
    this.ambNext.length = 0;
    for (const e of events) this.ambNext.push(now + e.first[0] + Math.random() * (e.first[1] - e.first[0]));
    this.ambTimer = setInterval(() => this.ambientTick(want), 500);
  }

  private ambientTick(kind: 'interior' | 'city'): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.ambWanted !== kind) return;
    const now = ctx.currentTime;
    const events = AMBIENT_EVENTS[kind];
    for (let i = 0; i < events.length; i++) {
      if (now < this.ambNext[i]) continue;
      const e = events[i];
      this.ambNext[i] = now + e.every[0] + Math.random() * (e.every[1] - e.every[0]);
      const gain = e.gain[0] + Math.random() * (e.gain[1] - e.gain[0]);
      const side = Math.random() < 0.5 ? -1 : 1;
      const pan = e.pan === 'sweep' ? -0.9 * side : (Math.random() * 2 - 1) * 0.8;
      const count = e.repeat ? e.repeat[0] + Math.floor(Math.random() * (e.repeat[1] - e.repeat[0] + 1)) : 1;
      for (let n = 0; n < count; n++) {
        this.playFlat(
          e.sound,
          BUS_AMB,
          gain,
          PRIO_AMBIENCE,
          n * (e.repeat ? e.repeat[2] : 0),
          0.94 + Math.random() * 0.12,
          0,
          GROUP_AMBIENCE,
          pan,
          e.pan === 'sweep' ? 0.9 * side : NaN,
        );
      }
    }
  }

  private syncMusic(): void {
    if (!this.ctx || !this.bank) return;
    const want = this.musicWanted;
    const name = want ? `music_${want}` : null;
    if (this.mus && this.mus.name !== name) {
      this.fadeOutLoop(this.mus, 1.6);
      this.mus = null;
    }
    if (name && !this.mus) this.mus = this.startLoop(name, this.musicBus, 1.4, () => this.musicWanted === want && this.mus?.name === name);
  }

  // ===================================================================================
  // Stop
  // ===================================================================================

  stopAll(): void {
    this.announcer.cancel();
    this.ambWanted = null;
    this.musicWanted = null;
    this.indoorTold = false;
    this.burst = 0;
    if (this.ambTimer !== null) {
      clearInterval(this.ambTimer);
      this.ambTimer = null;
    }
    if (!this.ctx) return;
    if (this.amb) {
      this.fadeOutLoop(this.amb, 0.25);
      this.amb = null;
    }
    if (this.mus) {
      this.fadeOutLoop(this.mus, 0.25);
      this.mus = null;
    }
    for (let p = 0; p < 2; p++) {
      const list = p === 0 ? this.spatial : this.flat;
      for (let i = 0; i < list.length; i++) if (list[i].state === PLAYING) this.silence(list[i]);
    }
    try {
      const now = this.ctx.currentTime;
      this.duck.frequency.cancelScheduledValues(now);
      this.duck.frequency.setTargetAtTime(this.nyquist, now, 0.02);
      this.duckGain.gain.cancelScheduledValues(now);
      this.duckGain.gain.setTargetAtTime(1, now, 0.02);
    } catch {
      /* ignore */
    }
  }

  // ===================================================================================
  // Diagnostics (dev harness)
  // ===================================================================================

  /** Play any sound of the catalogue as rendered, flat (dev sound board). */
  preview(name: string): void {
    if (!this.running || !getSound(name)) return;
    this.playFlat(name, BUS_UI, 1, PRIO_FEEDBACK);
  }

  /** Snapshot of the engine state for the dev sound board. */
  debug(): { state: string; voices: number; maxVoices: number; indoor: boolean; chains: number; rendered: number; voice: string | null; sampleRate: number } {
    return {
      state: this.dead ? 'unavailable' : (this.ctx?.state ?? 'locked'),
      voices: this.active,
      maxVoices: MAX_VOICES,
      indoor: this.indoor,
      chains: this.spatial.length + this.flat.length,
      rendered: this.bank ? this.bank.progress() : 0,
      voice: this.announcer.voiceName,
      sampleRate: this.ctx?.sampleRate ?? 0,
    };
  }
}
