/**
 * Weapon sounds: gunshots (one recipe per weapon, three renders each: the full stereo
 * shot heard by the shooter, and a mono "dry" part + mono "tail" part mixed by the
 * engine according to the distance for other players' shots), and the mechanical
 * foley used by reloads, draws, dry fire and the scope.
 */
import type { WeaponId } from '../../../shared/weapons/defs';
import { defineSound } from '../bank';
import type { Kit, NoiseColor } from '../kit';

type ShotPart = 'full' | 'dry' | 'tail';

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

function buildShot(k: Kit, s: ShotSpec, part: ShotPart): void {
  if (part !== 'tail') {
    const pre = k.gain(s.pre);
    const direct = k.gain(1);
    k.chain(
      pre,
      k.drive(s.drive),
      k.filter('peaking', k.vary(s.voice.freq, 0.05), s.voice.q, s.voice.db),
      k.lp(k.vary(s.voice.lp, 0.05), 0.6),
      direct,
      k.out,
    );
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
    for (const m of s.mech) {
      const at = k.vary(m.at, 0.12);
      k.burst({ at, type: 'bandpass', freq: k.vary(m.freq, 0.08), q: m.q, attack: 0.0003, decay: m.decay, gain: m.gain * 3, to: k.out });
      k.burst({ at, type: 'highpass', freq: 5000, attack: 0, decay: 0.004, gain: m.gain * 0.5, to: k.out });
    }
    if (part === 'full' && s.echoes) {
      let side = k.rng() < 0.5 ? -1 : 1;
      for (const e of s.echoes) {
        k.chain(direct, k.delay(k.vary(e.at, 0.1)), k.lp(e.lp, 0.5), k.gain(e.gain), k.pan(side * 0.55), k.out);
        side = -side;
      }
    }
  }
  if (part !== 'dry') {
    const far = part === 'tail';
    const t = s.tail;
    const sides = k.channels === 2 ? [-t.width, t.width] : [0];
    const lpF = far ? t.lp * 0.6 : t.lp;
    for (const side of sides) {
      const src = k.noise('white', t.pre, t.attack + t.decay + 0.02);
      const bp = k.bp(k.vary(t.bp, 0.08), t.q);
      const lp = k.lp(lpF, 0.5);
      k.glide(lp.frequency, t.pre, lpF, lpF * 0.3, t.decay * 0.8);
      const env = k.gain(0);
      k.perc(env.gain, t.pre, t.gain * (far ? 1 : sides.length === 2 ? 2.4 : 2), t.attack, t.decay);
      k.chain(src, bp, lp, env, k.pan(side), k.out);
    }
    if (far) {
      // What carries far away: the low thump, softened.
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
  }
}

for (const id of Object.keys(SHOTS) as Exclude<WeaponId, 'knife'>[]) {
  const s = SHOTS[id];
  defineSound({
    name: `shot_${id}`,
    group: 'shot',
    label: `Tir — ${s.label}`,
    dur: s.dur,
    channels: 2,
    variants: 4,
    peak: s.peak,
    build: (k) => buildShot(k, s, 'full'),
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

// --- Mechanical foley ---------------------------------------------------------------

interface ClackOpts {
  q?: number;
  decay?: number;
  /** Adds a short metallic ring. */
  ring?: number;
  /** Adds low-end weight (Hz of the thock). */
  body?: number;
}

/** Metal-on-metal contact. */
function clack(k: Kit, at: number, freq: number, gain: number, o: ClackOpts = {}): void {
  const decay = o.decay ?? 0.014;
  k.burst({ at, type: 'bandpass', freq, q: o.q ?? 5, attack: 0.0003, decay, gain: gain * 3 });
  k.burst({ at, type: 'highpass', freq: 4500, attack: 0, decay: 0.004, gain: gain * 0.7 });
  if (o.ring) k.partials({ at, base: freq * 0.93, ratios: [1, 1.52, 2.31], decay: o.ring, gain: gain * 0.22 });
  if (o.body) k.tone({ at, freq: o.body, freqEnd: o.body * 0.6, sweep: 0.03, decay: 0.045, gain: gain * 0.6 });
}

/** Sliding friction: band-passed noise whose centre moves. */
function scrape(k: Kit, at: number, dur: number, f0: number, f1: number, gain: number, q = 2): void {
  const src = k.noise('white', at, dur + 0.02);
  const bp = k.bp(f0, q);
  k.glide(bp.frequency, at, f0, f1, dur);
  const env = k.gain(0);
  k.swell(env.gain, at, gain * 1.6, dur * 0.3, dur * 0.15, dur * 0.55);
  k.chain(src, bp, env, k.out);
}

/** Soft cloth rustle: a few overlapping bumps of band-passed pink noise. */
function cloth(k: Kit, at: number, dur: number, gain: number): void {
  const bumps = 2 + Math.floor(k.rng() * 2);
  for (let i = 0; i < bumps; i++) {
    const t = at + (i / bumps) * dur * 0.7 + k.rand(0, dur * 0.1);
    const len = dur * k.rand(0.3, 0.5);
    const src = k.noise('pink', t, len + 0.02);
    const bp = k.bp(k.rand(700, 2100), 0.8);
    const env = k.gain(0);
    k.swell(env.gain, t, gain * k.rand(0.6, 1), len * 0.4, 0, len * 0.6);
    k.chain(src, k.hp(350), bp, env, k.out);
  }
}

const mech = (name: string, label: string, dur: number, peak: number, build: (k: Kit, v: number) => void, variants = 3): void =>
  defineSound({ name, group: 'mech', label, dur, channels: 1, variants, peak, build });

// Pistol magazine and slide.
mech('mag_out_light', 'Chargeur retiré (pistolet)', 0.3, 0.3, (k) => {
  clack(k, 0, k.vary(3300), 0.9, { q: 6, decay: 0.012 });
  scrape(k, 0.022, 0.085, k.vary(1800), k.vary(1050), 0.45, 2.2);
  clack(k, 0.115, k.vary(1500), 0.3, { q: 3, decay: 0.02 });
});
mech('mag_in_light', 'Chargeur inséré (pistolet)', 0.3, 0.36, (k) => {
  scrape(k, 0, 0.07, k.vary(1000), k.vary(1900), 0.4, 2.2);
  clack(k, 0.072, k.vary(1750), 1, { q: 3.5, decay: 0.022, body: 210, ring: 0.03 });
  clack(k, 0.086, k.vary(3600), 0.4, { q: 6, decay: 0.01 });
});
mech('rack_light', 'Culasse (pistolet)', 0.4, 0.42, (k) => {
  clack(k, 0, k.vary(2900), 0.5, { q: 5, decay: 0.012 });
  scrape(k, 0.006, 0.075, k.vary(2400), k.vary(1500), 0.6, 1.8);
  clack(k, 0.085, k.vary(2000), 0.45, { q: 4, decay: 0.014 });
  const fwd = k.vary(0.15, 0.1);
  scrape(k, fwd - 0.03, 0.03, 1700, 2800, 0.4, 1.8);
  clack(k, fwd, k.vary(2500), 1, { q: 4, decay: 0.02, body: 230, ring: 0.035 });
  clack(k, fwd + 0.012, k.vary(4300), 0.45, { q: 7, decay: 0.009 });
});

// Rifle / SMG magazine and charging handle.
mech('mag_out_heavy', 'Chargeur retiré (fusil)', 0.36, 0.34, (k) => {
  clack(k, 0, k.vary(2500), 0.9, { q: 5, decay: 0.016, ring: 0.025 });
  scrape(k, 0.03, 0.11, k.vary(1300), k.vary(700), 0.5, 1.8);
  clack(k, 0.15, k.vary(950), 0.4, { q: 2.5, decay: 0.028, body: 170 });
});
mech('mag_in_heavy', 'Chargeur inséré (fusil)', 0.36, 0.4, (k) => {
  scrape(k, 0, 0.085, k.vary(750), k.vary(1500), 0.45, 1.8);
  clack(k, 0.09, k.vary(1250), 1, { q: 3, decay: 0.03, body: 150, ring: 0.04 });
  clack(k, 0.108, k.vary(2900), 0.45, { q: 6, decay: 0.012 });
  clack(k, 0.19, k.vary(1700), 0.22, { q: 3, decay: 0.02, body: 190 });
});
mech('rack_heavy', 'Levier d’armement (fusil)', 0.5, 0.46, (k) => {
  clack(k, 0, k.vary(2100), 0.6, { q: 4, decay: 0.016 });
  scrape(k, 0.008, 0.1, k.vary(1900), k.vary(1000), 0.65, 1.6);
  clack(k, 0.115, k.vary(1300), 0.55, { q: 3, decay: 0.022, body: 180 });
  const fwd = k.vary(0.21, 0.08);
  scrape(k, fwd - 0.035, 0.035, 1200, 2300, 0.45, 1.6);
  clack(k, fwd, k.vary(1700), 1, { q: 3.5, decay: 0.028, body: 160, ring: 0.05 });
  clack(k, fwd + 0.014, k.vary(3500), 0.5, { q: 6, decay: 0.011 });
});

// Shotgun.
mech('shell_in', 'Cartouche insérée', 0.24, 0.3, (k) => {
  clack(k, 0, k.vary(1900), 0.5, { q: 4, decay: 0.012 });
  scrape(k, 0.012, 0.05, k.vary(1100), k.vary(1900), 0.5, 2);
  clack(k, 0.066, k.vary(1150), 1, { q: 3, decay: 0.024, body: 260 });
  clack(k, 0.078, k.vary(3000), 0.3, { q: 6, decay: 0.008 });
});
mech('pump', 'Pompe (fusil à pompe)', 0.5, 0.5, (k) => {
  scrape(k, 0, 0.075, k.vary(1500), k.vary(800), 0.7, 1.4);
  clack(k, 0.07, k.vary(1050), 1, { q: 2.6, decay: 0.03, body: 140, ring: 0.03 });
  clack(k, 0.082, k.vary(2700), 0.4, { q: 5, decay: 0.012 });
  const fwd = k.vary(0.2, 0.08);
  scrape(k, fwd, 0.065, k.vary(850), k.vary(1700), 0.7, 1.4);
  clack(k, fwd + 0.062, k.vary(1350), 1.1, { q: 2.8, decay: 0.032, body: 150, ring: 0.04 });
  clack(k, fwd + 0.075, k.vary(3300), 0.45, { q: 6, decay: 0.012 });
});

// Sniper bolt.
mech('bolt_open', 'Verrou ouvert (précision)', 0.4, 0.44, (k) => {
  clack(k, 0, k.vary(2600), 0.8, { q: 5, decay: 0.016, ring: 0.03 });
  scrape(k, 0.05, 0.13, k.vary(1900), k.vary(900), 0.6, 1.8);
  clack(k, 0.185, k.vary(1250), 1, { q: 3, decay: 0.028, body: 170, ring: 0.03 });
});
mech('bolt_close', 'Verrou fermé (précision)', 0.42, 0.46, (k) => {
  scrape(k, 0, 0.12, k.vary(950), k.vary(2000), 0.6, 1.8);
  clack(k, 0.122, k.vary(1500), 1, { q: 3, decay: 0.028, body: 160, ring: 0.04 });
  clack(k, 0.2, k.vary(2400), 0.8, { q: 5, decay: 0.018, body: 210, ring: 0.03 });
});

// Handling.
mech('cloth', 'Froissement de blouse', 0.34, 0.12, (k) => cloth(k, 0, k.vary(0.24, 0.15), 1), 4);
mech('handle_light', 'Prise en main (pistolet)', 0.3, 0.26, (k) => {
  cloth(k, 0, 0.14, 0.35);
  clack(k, 0.09, k.vary(2700), 0.8, { q: 5, decay: 0.014, body: 240 });
  clack(k, 0.125, k.vary(3900), 0.35, { q: 7, decay: 0.008 });
});
mech('handle_heavy', 'Prise en main (arme longue)', 0.4, 0.3, (k) => {
  cloth(k, 0, 0.2, 0.4);
  clack(k, 0.12, k.vary(1700), 0.9, { q: 3.5, decay: 0.022, body: 170, ring: 0.03 });
  clack(k, 0.165, k.vary(2800), 0.4, { q: 6, decay: 0.01 });
  clack(k, 0.24, k.vary(1300), 0.25, { q: 3, decay: 0.02, body: 150 });
});
mech('handle_knife', 'Bistouri dégainé', 0.4, 0.2, (k) => {
  cloth(k, 0, 0.12, 0.35);
  scrape(k, 0.05, 0.1, k.vary(4200), k.vary(7200), 0.5, 5);
  k.partials({ at: 0.13, base: k.vary(4700, 0.05), ratios: [1, 1.41, 1.93, 2.62], decay: 0.2, gain: 0.5, attack: 0.004 });
});
mech('dryfire', 'Percussion à vide', 0.14, 0.26, (k) => {
  clack(k, 0, k.vary(2900), 1, { q: 6, decay: 0.012, body: 420 });
  clack(k, 0.006, k.vary(980), 0.5, { q: 3, decay: 0.022 });
});
mech(
  'zoom',
  'Lunette',
  0.2,
  0.16,
  (k) => {
    clack(k, 0, k.vary(1900), 0.8, { q: 4, decay: 0.014 });
    // Tiny lens-ring whirr.
    k.tone({ at: 0.004, type: 'triangle', freq: k.vary(1300), freqEnd: k.vary(2500), sweep: 0.05, attack: 0.008, decay: 0.06, gain: 0.25 });
    scrape(k, 0.004, 0.06, 3000, 5500, 0.25, 3);
  },
  2,
);
