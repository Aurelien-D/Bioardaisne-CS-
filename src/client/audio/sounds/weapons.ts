/**
 * Gunshots: one recipe per weapon, rendered as
 *
 *   shot_<id>        what the shooter hears: the dry blast, stereo, full weight
 *   shot_<id>_room   its reflections indoors (close, hard walls: short and dense)
 *   shot_<id>_open   its reflections outdoors (slap-backs off the façades, long dark roll)
 *   shot_<id>_dry    another player's shot, direct sound (mono, spatialised by the engine)
 *   shot_<id>_tail   another player's shot, what carries far away (mono)
 *
 * The engine plays the blast and ONE reflection layer for the local player (a new shot
 * replaces the tail of the previous one, so a spray stays clean), and mixes dry + tail
 * according to the distance for everybody else. Handling sounds live in foley.ts.
 */
import type { WeaponId } from '../../../shared/weapons/defs';
import { defineSound } from '../bank';
import type { Kit, NoiseColor } from '../kit';

type ShotPart = 'full' | 'room' | 'open' | 'dry' | 'tail';

interface ShotSpec {
  label: string;
  dur: number;
  /** Normalised peak of the local (full) render. */
  peak: number;
  /** Peak of the remote tail render, relative to the dry render (engine mixes them). */
  tailPeak: number;
  /** Raw 3 ms full-band spike at the very start. */
  click: number;
  /** High-passed noise: the "crack". */
  crack: { hp: number; decay: number; gain: number };
  /** Band-passed bite that gives the weapon its voice. */
  snap: { freq: number; q: number; decay: number; gain: number };
  /** Pitched-down noise through a closing low-pass: the "body". */
  body: { color: NoiseColor; rate: number; f0: number; f1: number; q: number; decay: number; gain: number };
  /** Sine / triangle sweep: the chest thump. */
  thump: { type: OscillatorType; f0: number; f1: number; sweep: number; decay: number; gain: number };
  /** Clean pressure pulse added after the saturation: the weight felt rather than heard. */
  sub: { f0: number; f1: number; decay: number; gain: number };
  /** Level into the saturator and saturation amount. */
  pre: number;
  drive: number;
  /** Post-saturation tone: peaking EQ + low-pass. */
  voice: { freq: number; q: number; db: number; lp: number };
  /** Action noises (slide, bolt carrier) after the blast. */
  mech: { at: number; freq: number; q: number; decay: number; gain: number }[];
  /** Reverberant tail: band-passed noise decay. */
  tail: { pre: number; attack: number; bp: number; q: number; lp: number; decay: number; gain: number; width: number };
  /** Discrete slap-back echoes of the blast (open spaces). */
  echoes?: { at: number; gain: number; lp: number }[];
}

const SHOTS: Record<Exclude<WeaponId, 'knife'>, ShotSpec> = {
  // Dry snap: short, tight, little low end, almost no tail.
  pistol: {
    label: 'Pipette P9',
    dur: 0.45,
    peak: 0.8,
    tailPeak: 0.3,
    click: 1.0,
    crack: { hp: 1900, decay: 0.02, gain: 1.0 },
    snap: { freq: 2500, q: 1.3, decay: 0.03, gain: 0.8 },
    body: { color: 'white', rate: 0.62, f0: 3400, f1: 480, q: 0.7, decay: 0.07, gain: 0.8 },
    thump: { type: 'sine', f0: 240, f1: 78, sweep: 0.03, decay: 0.07, gain: 0.85 },
    sub: { f0: 96, f1: 56, decay: 0.06, gain: 0.3 },
    pre: 0.6,
    drive: 2.2,
    voice: { freq: 2100, q: 0.9, db: 4, lp: 7600 },
    mech: [
      { at: 0.036, freq: 3500, q: 6, decay: 0.012, gain: 0.1 },
      { at: 0.064, freq: 2400, q: 5, decay: 0.016, gain: 0.08 },
    ],
    tail: { pre: 0.012, attack: 0.006, bp: 1400, q: 0.6, lp: 4600, decay: 0.3, gain: 0.2, width: 0.7 },
  },
  // Heavy boom: slow, fat low end, long dark tail.
  deagle: {
    label: 'Lancette .50',
    dur: 0.95,
    peak: 0.95,
    tailPeak: 0.42,
    click: 1.0,
    crack: { hp: 1000, decay: 0.035, gain: 0.9 },
    snap: { freq: 1300, q: 0.9, decay: 0.055, gain: 0.7 },
    body: { color: 'pink', rate: 0.42, f0: 2300, f1: 200, q: 0.8, decay: 0.2, gain: 1.4 },
    thump: { type: 'sine', f0: 165, f1: 42, sweep: 0.075, decay: 0.24, gain: 1.5 },
    sub: { f0: 82, f1: 42, decay: 0.17, gain: 0.75 },
    pre: 0.6,
    drive: 3.2,
    voice: { freq: 420, q: 0.8, db: 7, lp: 4600 },
    mech: [
      { at: 0.055, freq: 2100, q: 5, decay: 0.018, gain: 0.08 },
      { at: 0.1, freq: 1500, q: 4, decay: 0.022, gain: 0.07 },
    ],
    tail: { pre: 0.018, attack: 0.01, bp: 780, q: 0.5, lp: 3000, decay: 0.68, gain: 0.26, width: 0.8 },
    echoes: [{ at: 0.115, gain: 0.13, lp: 1500 }],
  },
  // Tight rattle: thin, bright, very short, lots of bolt noise.
  smg: {
    label: 'Centri-9',
    dur: 0.32,
    peak: 0.72,
    tailPeak: 0.25,
    click: 0.8,
    crack: { hp: 2700, decay: 0.012, gain: 0.9 },
    snap: { freq: 3300, q: 2, decay: 0.02, gain: 0.9 },
    body: { color: 'white', rate: 0.85, f0: 4300, f1: 900, q: 0.8, decay: 0.04, gain: 0.6 },
    thump: { type: 'triangle', f0: 310, f1: 125, sweep: 0.018, decay: 0.04, gain: 0.55 },
    sub: { f0: 112, f1: 70, decay: 0.04, gain: 0.22 },
    pre: 0.6,
    drive: 2.0,
    voice: { freq: 3000, q: 1.1, db: 5, lp: 9500 },
    mech: [
      { at: 0.018, freq: 4200, q: 7, decay: 0.01, gain: 0.2 },
      { at: 0.04, freq: 2900, q: 6, decay: 0.012, gain: 0.17 },
      { at: 0.058, freq: 5200, q: 8, decay: 0.008, gain: 0.09 },
    ],
    tail: { pre: 0.008, attack: 0.004, bp: 2100, q: 0.6, lp: 5600, decay: 0.19, gain: 0.15, width: 0.6 },
  },
  // Rough, mid-heavy bark: saturated mids, loose and nasty.
  rifle_ak: {
    label: 'AK-Tube 47',
    dur: 0.8,
    peak: 0.92,
    tailPeak: 0.4,
    click: 1.0,
    crack: { hp: 1300, decay: 0.028, gain: 0.8 },
    snap: { freq: 880, q: 1.1, decay: 0.075, gain: 1.3 },
    body: { color: 'white', rate: 0.38, f0: 2500, f1: 340, q: 1.3, decay: 0.12, gain: 1.2 },
    thump: { type: 'triangle', f0: 175, f1: 58, sweep: 0.05, decay: 0.13, gain: 1.0 },
    sub: { f0: 86, f1: 47, decay: 0.12, gain: 0.6 },
    pre: 0.7,
    drive: 4.5,
    voice: { freq: 820, q: 0.9, db: 8, lp: 5200 },
    mech: [
      { at: 0.036, freq: 1900, q: 4, decay: 0.02, gain: 0.15 },
      { at: 0.072, freq: 2600, q: 5, decay: 0.014, gain: 0.1 },
    ],
    tail: { pre: 0.015, attack: 0.008, bp: 900, q: 0.5, lp: 3300, decay: 0.55, gain: 0.24, width: 0.8 },
    echoes: [{ at: 0.1, gain: 0.08, lp: 1700 }],
  },
  // Crisper, brighter: clean crack, less low end, airy tail.
  rifle_m4: {
    label: 'M4 Sérum',
    dur: 0.7,
    peak: 0.86,
    tailPeak: 0.36,
    click: 1.0,
    crack: { hp: 2400, decay: 0.02, gain: 1.15 },
    snap: { freq: 2000, q: 1.4, decay: 0.04, gain: 0.9 },
    body: { color: 'white', rate: 0.7, f0: 4600, f1: 700, q: 0.7, decay: 0.075, gain: 0.8 },
    thump: { type: 'sine', f0: 215, f1: 80, sweep: 0.035, decay: 0.08, gain: 0.75 },
    sub: { f0: 98, f1: 56, decay: 0.085, gain: 0.45 },
    pre: 0.6,
    drive: 2.4,
    voice: { freq: 2300, q: 1.0, db: 5, lp: 9800 },
    mech: [
      { at: 0.028, freq: 4600, q: 7, decay: 0.01, gain: 0.13 },
      { at: 0.056, freq: 3300, q: 6, decay: 0.012, gain: 0.1 },
    ],
    tail: { pre: 0.012, attack: 0.006, bp: 1700, q: 0.5, lp: 5400, decay: 0.46, gain: 0.21, width: 0.8 },
    echoes: [{ at: 0.09, gain: 0.06, lp: 2400 }],
  },
  // Broad blast: wide-band, long body, big low end (the pump follows separately).
  shotgun: {
    label: 'Agitateur 12',
    dur: 1.1,
    peak: 0.96,
    tailPeak: 0.45,
    click: 1.0,
    crack: { hp: 700, decay: 0.05, gain: 0.9 },
    snap: { freq: 1150, q: 0.6, decay: 0.09, gain: 0.9 },
    body: { color: 'white', rate: 0.55, f0: 5200, f1: 280, q: 0.6, decay: 0.22, gain: 1.4 },
    thump: { type: 'sine', f0: 145, f1: 38, sweep: 0.09, decay: 0.26, gain: 1.4 },
    sub: { f0: 72, f1: 36, decay: 0.21, gain: 0.85 },
    pre: 0.65,
    drive: 3.6,
    voice: { freq: 330, q: 0.7, db: 6, lp: 5000 },
    mech: [],
    tail: { pre: 0.02, attack: 0.012, bp: 700, q: 0.4, lp: 2800, decay: 0.8, gain: 0.3, width: 0.9 },
    echoes: [{ at: 0.13, gain: 0.11, lp: 1200 }],
  },
  // Huge crack, long rolling tail with slap-backs (the bolt follows separately).
  sniper: {
    label: 'Le Microscope',
    dur: 1.75,
    peak: 0.98,
    tailPeak: 0.5,
    click: 1.2,
    crack: { hp: 1500, decay: 0.045, gain: 1.3 },
    snap: { freq: 2700, q: 0.8, decay: 0.055, gain: 1.0 },
    body: { color: 'pink', rate: 0.4, f0: 3200, f1: 170, q: 0.7, decay: 0.28, gain: 1.3 },
    thump: { type: 'sine', f0: 135, f1: 34, sweep: 0.1, decay: 0.32, gain: 1.5 },
    sub: { f0: 66, f1: 32, decay: 0.27, gain: 0.95 },
    pre: 0.7,
    drive: 3.8,
    voice: { freq: 1250, q: 0.7, db: 4, lp: 6800 },
    mech: [],
    tail: { pre: 0.025, attack: 0.015, bp: 650, q: 0.4, lp: 3600, decay: 1.4, gain: 0.36, width: 0.9 },
    echoes: [
      { at: 0.14, gain: 0.2, lp: 1900 },
      { at: 0.31, gain: 0.12, lp: 1200 },
      { at: 0.53, gain: 0.07, lp: 850 },
    ],
  },
};

/** The blast itself, built into `dest`. `wide` adds the decorrelated air only the shooter hears. */
function blast(k: Kit, s: ShotSpec, dest: AudioNode, wide: boolean, mech: boolean): void {
  const pre = k.gain(s.pre);
  k.chain(pre, k.drive(s.drive), k.filter('peaking', k.vary(s.voice.freq, 0.05), s.voice.q, s.voice.db), k.lp(k.vary(s.voice.lp, 0.05), 0.6), dest);
  k.burst({ type: 'none', attack: 0, decay: 0.003, gain: s.click * 1.6, to: pre });
  k.burst({ type: 'highpass', freq: k.vary(s.crack.hp), attack: 0.0003, decay: k.vary(s.crack.decay), gain: s.crack.gain * 1.4, to: pre });
  k.burst({
    type: 'bandpass',
    freq: k.vary(s.snap.freq),
    q: s.snap.q,
    attack: 0.0005,
    decay: k.vary(s.snap.decay),
    gain: s.snap.gain * 1.6,
    to: pre,
  });
  k.burst({
    color: s.body.color,
    rate: s.body.rate,
    type: 'lowpass',
    freq: k.vary(s.body.f0),
    freqEnd: k.vary(s.body.f1),
    q: s.body.q,
    attack: 0.001,
    decay: k.vary(s.body.decay),
    gain: s.body.gain * (s.body.color === 'pink' ? 2.4 : 1.2),
    to: pre,
  });
  k.tone({
    type: s.thump.type,
    freq: k.vary(s.thump.f0),
    freqEnd: k.vary(s.thump.f1),
    sweep: s.thump.sweep,
    attack: 0.0012,
    decay: k.vary(s.thump.decay),
    gain: s.thump.gain,
    to: pre,
  });
  // Clean low end, past the saturator: it would only turn into mud there.
  k.tone({ type: 'sine', freq: k.vary(s.sub.f0, 0.04), freqEnd: s.sub.f1, sweep: s.sub.decay * 0.5, attack: 0.002, decay: k.vary(s.sub.decay), gain: s.sub.gain * 0.5, to: dest });
  if (wide && k.channels === 2) {
    // Muzzle gas spreading to both sides: two unrelated noise bursts, hard left and right.
    for (const side of [-0.85, 0.85]) {
      const p = k.pan(side);
      p.connect(dest);
      k.burst({ type: 'highpass', freq: k.vary(s.crack.hp * 0.8, 0.1), attack: 0.001, decay: k.vary(s.crack.decay * 2.2, 0.15), gain: s.crack.gain * 0.2, to: p });
      k.burst({ type: 'bandpass', freq: k.vary(s.snap.freq * 0.7, 0.1), q: 0.8, attack: 0.002, decay: k.vary(s.body.decay * 0.8, 0.15), gain: s.body.gain * 0.2, to: p });
    }
  }
  if (!mech) return;
  for (const m of s.mech) {
    const at = k.vary(m.at, 0.12);
    k.burst({ at, type: 'bandpass', freq: k.vary(m.freq, 0.08), q: m.q, attack: 0.0003, decay: m.decay, gain: m.gain * 3, to: dest });
    k.burst({ at, type: 'highpass', freq: 5000, attack: 0, decay: 0.004, gain: m.gain * 0.5, to: dest });
  }
}

/** Length of the reflections for the shooter (seconds to -60 dB). */
const roomDecay = (s: ShotSpec): number => Math.min(0.62, Math.max(0.2, s.tail.decay * 0.72));
const openDecay = (s: ShotSpec): number => s.tail.decay * 1.45;

function buildShot(k: Kit, s: ShotSpec, part: ShotPart): void {
  const t = s.tail;
  if (part === 'full' || part === 'dry') {
    blast(k, s, k.out, part === 'full', true);
    return;
  }
  if (part === 'room' || part === 'open') {
    // The blast is built into a silent bus: only what the surroundings send back is kept.
    const bus = k.gain(1);
    blast(k, s, bus, false, false);
    const indoor = part === 'room';
    const shaped = k.chain(bus, k.hp(indoor ? 170 : 85, 0.6), k.lp(indoor ? Math.min(7500, t.lp * 1.5) : t.lp * 0.9, 0.5));
    const decay = indoor ? roomDecay(s) : openDecay(s);
    const env = k.gain(0);
    k.perc(env.gain, 0, 1, indoor ? 0.004 : t.attack, decay, indoor ? 0.02 : 0.05);
    env.connect(k.out);
    k.reverb(shaped, indoor ? 'corridor' : 'street', 1, env);
    let side = k.rng() < 0.5 ? -1 : 1;
    if (indoor) {
      // First bounces off the walls, floor and ceiling of a corridor.
      for (const [at, gain] of [
        [0.009, 0.3],
        [0.016, 0.24],
        [0.027, 0.17],
        [0.041, 0.11],
      ] as const) {
        k.chain(shaped, k.delay(k.vary(at, 0.15)), k.gain(gain), k.pan(side * 0.75), k.out);
        side = -side;
      }
    } else {
      // Slap-backs off distant façades, each darker than the last.
      const echoes = s.echoes ?? [{ at: 0.085, gain: 0.07, lp: 2000 }];
      for (const e of echoes) {
        k.chain(shaped, k.delay(k.vary(e.at, 0.1)), k.lp(e.lp, 0.5), k.gain(e.gain * 2.6), k.pan(side * 0.6), k.out);
        side = -side;
      }
      // The low roll that outlasts everything else.
      k.tone({
        type: 'sine',
        freq: s.thump.f0 * 0.6,
        freqEnd: s.thump.f1,
        sweep: s.thump.sweep * 2,
        attack: 0.02,
        decay: Math.min(0.9, s.thump.decay * 2.2),
        gain: 0.12 * s.thump.gain,
        at: t.pre,
      });
    }
    return;
  }
  // Another player's shot, far away: a dull noise tail, the softened thump and the echoes.
  const lpF = t.lp * 0.6;
  const src = k.noise('white', t.pre, t.attack + t.decay + 0.02);
  const bp = k.bp(k.vary(t.bp, 0.08), t.q);
  const lp = k.lp(lpF, 0.5);
  k.glide(lp.frequency, t.pre, lpF, lpF * 0.3, t.decay * 0.8);
  const env = k.gain(0);
  k.perc(env.gain, t.pre, t.gain, t.attack, t.decay);
  k.chain(src, bp, lp, env, k.out);
  k.tone({
    type: 'sine',
    freq: s.thump.f0 * 0.7,
    freqEnd: s.thump.f1 * 1.1,
    sweep: s.thump.sweep * 1.5,
    attack: 0.004,
    decay: s.thump.decay * 1.6,
    gain: t.gain * 0.5,
  });
  for (const e of s.echoes ?? []) {
    k.burst({ at: e.at, type: 'lowpass', freq: e.lp * 0.7, attack: 0.006, decay: 0.12, gain: e.gain * 0.8 });
  }
}

/** Level of the shooter's reflection layers relative to the blast. */
const ROOM_LEVEL = 0.36;
const OPEN_LEVEL = 0.3;

for (const id of Object.keys(SHOTS) as Exclude<WeaponId, 'knife'>[]) {
  const s = SHOTS[id];
  defineSound({
    name: `shot_${id}`,
    group: 'shot',
    label: `Tir — ${s.label}`,
    dur: Math.min(s.dur, 0.7),
    channels: 2,
    variants: 4,
    peak: s.peak,
    build: (k) => buildShot(k, s, 'full'),
  });
  defineSound({
    name: `shot_${id}_room`,
    group: 'shot',
    label: `Réverbération intérieure — ${s.label}`,
    dur: roomDecay(s) + 0.25,
    channels: 2,
    variants: 2,
    peak: s.peak * ROOM_LEVEL,
    build: (k) => buildShot(k, s, 'room'),
  });
  defineSound({
    name: `shot_${id}_open`,
    group: 'shot',
    label: `Écho extérieur — ${s.label}`,
    dur: openDecay(s) + 0.5,
    channels: 2,
    variants: 2,
    peak: s.peak * OPEN_LEVEL,
    build: (k) => buildShot(k, s, 'open'),
  });
  defineSound({
    name: `shot_${id}_dry`,
    group: 'shot',
    label: `Tir distant (direct) — ${s.label}`,
    dur: Math.min(s.dur, 0.6),
    channels: 1,
    variants: 3,
    peak: s.peak,
    build: (k) => buildShot(k, s, 'dry'),
  });
  defineSound({
    name: `shot_${id}_tail`,
    group: 'shot',
    label: `Tir distant (écho) — ${s.label}`,
    dur: s.dur,
    channels: 1,
    variants: 2,
    peak: s.peak * s.tailPeak,
    build: (k) => buildShot(k, s, 'tail'),
  });
}

// --- Knife --------------------------------------------------------------------------

function buildWhoosh(k: Kit): void {
  const dur = k.vary(0.2, 0.12);
  const f = k.vary(1, 0.12);
  for (const [color, lo, hi, q, g] of [
    ['white', 700 * f, 3000 * f, 1.6, 1],
    ['pink', 350 * f, 1300 * f, 1.0, 0.8],
  ] as const) {
    const src = k.noise(color, 0, dur + 0.08);
    const bp = k.bp(lo, q);
    k.glide(bp.frequency, 0, lo, hi, dur * 0.45);
    k.glide(bp.frequency, dur * 0.45 + 0.001, hi, lo * 1.3, dur * 0.6);
    const env = k.gain(0);
    k.swell(env.gain, 0, g, dur * 0.42, 0.005, dur * 0.62);
    k.chain(src, bp, env, k.pan(color === 'white' ? 0.25 : -0.25), k.out);
  }
  // Thin metallic sheen of the blade.
  k.partials({ at: dur * 0.3, base: k.vary(5200, 0.08), ratios: [1, 1.47, 2.09], decay: 0.09, gain: 0.05, attack: 0.02 });
}

defineSound({ name: 'shot_knife', group: 'shot', label: 'Bistouri (coup)', dur: 0.36, channels: 2, variants: 4, peak: 0.32, build: buildWhoosh });
defineSound({ name: 'shot_knife_dry', group: 'shot', label: 'Bistouri distant', dur: 0.36, channels: 1, variants: 3, peak: 0.3, build: buildWhoosh });
