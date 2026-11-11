/**
 * Movement sounds: one footstep recipe per SurfaceType (step_<surface>), the matching
 * two-feet landing (land_<surface>), the body's own thud on a hard landing (land_heavy)
 * and the jump effort.
 *
 * The surfaces a player crosses most are built to be told apart with eyes closed: lino is
 * a soft low thud (with the odd squeak), tile a bright double tick, carpet a muffled pat,
 * concrete — which is also the asphalt and the paving outdoors — a gritty heel click, and
 * metal (gratings, walkways) a ringing clank with its loose rattle.
 */
import type { SurfaceType } from '../../../shared/maps/materials';
import { defineSound } from '../bank';
import type { Kit, NoiseColor } from '../kit';

interface Layer {
  type: 'lowpass' | 'bandpass' | 'highpass';
  freq: number;
  freqEnd?: number;
  q?: number;
  decay: number;
  gain: number;
  at?: number;
  attack?: number;
  color?: NoiseColor;
}

interface StepSpec {
  label: string;
  /** Low heel thump. */
  thump: { freq: number; decay: number; gain: number };
  /** Noise layers of the contact (heel, then toe when `at` is set). */
  layers: Layer[];
  /** Resonance of the floor itself (wood, metal, glass…). */
  ring?: { base: number; ratios: number[]; decay: number; gain: number; damp?: number };
  /** Loose bits: gravel, grit, leaves. */
  grains?: { count: [number, number]; span: number; lo: number; hi: number; q: number; decay: number; gain: number };
  extra?: (k: Kit, weight: number, variant: number) => void;
}

export const SURFACES: SurfaceType[] = [
  'concrete',
  'tile',
  'lino',
  'carpet',
  'wood',
  'metal',
  'glass',
  'plaster',
  'plastic',
  'fabric',
  'cardboard',
  'dirt',
  'grass',
  'gravel',
  'water',
  'foliage',
];

const STEPS: Record<SurfaceType, StepSpec> = {
  // Hard heel click, slightly gritty.
  concrete: {
    label: 'béton',
    thump: { freq: 112, decay: 0.05, gain: 0.6 },
    layers: [
      { type: 'bandpass', freq: 1700, q: 1.1, decay: 0.032, gain: 1 },
      { type: 'highpass', freq: 3200, decay: 0.012, gain: 0.3 },
      { type: 'bandpass', freq: 2300, q: 1, decay: 0.022, gain: 0.36, at: 0.032 },
    ],
    grains: { count: [2, 4], span: 0.07, lo: 2300, hi: 5200, q: 3, decay: 0.012, gain: 0.14 },
  },
  // Bright, short ceramic tick-tock.
  tile: {
    label: 'carrelage',
    thump: { freq: 140, decay: 0.035, gain: 0.4 },
    layers: [
      { type: 'bandpass', freq: 3100, q: 2.2, decay: 0.02, gain: 1 },
      { type: 'highpass', freq: 5200, decay: 0.006, gain: 0.45 },
      { type: 'bandpass', freq: 3900, q: 2.5, decay: 0.016, gain: 0.45, at: 0.03 },
    ],
    ring: { base: 2900, ratios: [1, 1.83], decay: 0.03, gain: 0.1 },
  },
  // Softer thud; one variant squeaks like a clog on a freshly mopped floor.
  lino: {
    label: 'lino',
    thump: { freq: 100, decay: 0.055, gain: 0.85 },
    layers: [
      { type: 'lowpass', freq: 1150, decay: 0.045, gain: 0.9 },
      { type: 'bandpass', freq: 850, q: 1.2, decay: 0.04, gain: 0.5 },
      { type: 'lowpass', freq: 1500, decay: 0.03, gain: 0.28, at: 0.035 },
    ],
    extra: (k, weight, variant) => {
      if (variant === 3 && weight === 1) {
        k.tone({ at: 0.03, freq: k.vary(1900), freqEnd: k.vary(2600), sweep: 0.04, attack: 0.012, decay: 0.035, gain: 0.07 });
      }
    },
  },
  // Muffled.
  carpet: {
    label: 'moquette',
    thump: { freq: 85, decay: 0.06, gain: 0.9 },
    layers: [
      { type: 'lowpass', freq: 520, decay: 0.065, gain: 1, attack: 0.003, color: 'pink' },
      { type: 'bandpass', freq: 300, q: 0.8, decay: 0.055, gain: 0.5 },
      { type: 'bandpass', freq: 1800, q: 0.7, decay: 0.03, gain: 0.05, attack: 0.004 },
    ],
  },
  // Hollow knock.
  wood: {
    label: 'bois',
    thump: { freq: 125, decay: 0.05, gain: 0.6 },
    ring: { base: 185, ratios: [1, 2.2, 3.6], decay: 0.1, gain: 0.7, damp: 0.9 },
    layers: [
      { type: 'bandpass', freq: 850, q: 2.5, decay: 0.03, gain: 0.7 },
      { type: 'highpass', freq: 2500, decay: 0.008, gain: 0.18 },
      { type: 'bandpass', freq: 1100, q: 2.5, decay: 0.025, gain: 0.28, at: 0.034 },
    ],
  },
  // Ring.
  metal: {
    label: 'métal',
    thump: { freq: 120, decay: 0.04, gain: 0.4 },
    ring: { base: 430, ratios: [1, 2.32, 3.86, 5.31, 7.1], decay: 0.18, gain: 0.5, damp: 0.5 },
    layers: [
      { type: 'bandpass', freq: 2600, q: 2, decay: 0.02, gain: 0.8 },
      { type: 'highpass', freq: 5000, decay: 0.006, gain: 0.3 },
      { type: 'bandpass', freq: 1150, q: 3, decay: 0.05, gain: 0.5 },
    ],
    // The grating sits loose in its frame: it chatters right after the foot lands.
    extra: (k, weight) => {
      const n = 2 + Math.floor(k.rng() * 2 * weight);
      for (let i = 0; i < n; i++) {
        k.burst({ at: k.rand(0.012, 0.06 * weight), type: 'bandpass', freq: k.rand(2800, 5600), q: 7, attack: 0.0003, decay: k.rand(0.008, 0.02), gain: k.rand(0.25, 0.6) });
      }
    },
  },
  glass: {
    label: 'verre',
    thump: { freq: 150, decay: 0.03, gain: 0.3 },
    ring: { base: 1900, ratios: [1, 1.72, 2.63], decay: 0.07, gain: 0.3 },
    layers: [
      { type: 'bandpass', freq: 4200, q: 3, decay: 0.014, gain: 0.9 },
      { type: 'highpass', freq: 6000, decay: 0.005, gain: 0.4 },
    ],
  },
  plaster: {
    label: 'plâtre',
    thump: { freq: 105, decay: 0.05, gain: 0.6 },
    layers: [
      { type: 'bandpass', freq: 1150, q: 0.9, decay: 0.032, gain: 1 },
      { type: 'highpass', freq: 2800, decay: 0.01, gain: 0.18 },
      { type: 'bandpass', freq: 1500, q: 0.9, decay: 0.022, gain: 0.32, at: 0.033 },
    ],
  },
  plastic: {
    label: 'plastique',
    thump: { freq: 130, decay: 0.04, gain: 0.5 },
    ring: { base: 310, ratios: [1, 1.9, 3.3], decay: 0.055, gain: 0.5, damp: 1 },
    layers: [
      { type: 'bandpass', freq: 1500, q: 3, decay: 0.022, gain: 0.8 },
      { type: 'highpass', freq: 3500, decay: 0.006, gain: 0.25 },
    ],
  },
  fabric: {
    label: 'tissu',
    thump: { freq: 95, decay: 0.05, gain: 0.6 },
    layers: [
      { type: 'lowpass', freq: 700, decay: 0.055, gain: 1, attack: 0.004, color: 'pink' },
      { type: 'bandpass', freq: 2200, q: 0.6, decay: 0.04, gain: 0.07, attack: 0.006 },
    ],
  },
  cardboard: {
    label: 'carton',
    thump: { freq: 115, decay: 0.05, gain: 0.6 },
    ring: { base: 240, ratios: [1, 1.6], decay: 0.06, gain: 0.4, damp: 1.2 },
    layers: [
      { type: 'bandpass', freq: 430, q: 2, decay: 0.055, gain: 1 },
      { type: 'bandpass', freq: 2400, q: 0.8, decay: 0.03, gain: 0.16, attack: 0.003 },
    ],
  },
  // Soft brush.
  dirt: {
    label: 'terre',
    thump: { freq: 90, decay: 0.06, gain: 0.8 },
    layers: [
      { type: 'lowpass', freq: 800, decay: 0.055, gain: 1, attack: 0.002, color: 'pink' },
      { type: 'bandpass', freq: 1800, q: 0.7, decay: 0.05, gain: 0.2, attack: 0.005 },
    ],
    grains: { count: [2, 4], span: 0.07, lo: 1500, hi: 4000, q: 2.5, decay: 0.012, gain: 0.09 },
  },
  grass: {
    label: 'herbe',
    thump: { freq: 85, decay: 0.055, gain: 0.6 },
    layers: [
      { type: 'lowpass', freq: 600, decay: 0.05, gain: 0.7, attack: 0.003, color: 'pink' },
      { type: 'bandpass', freq: 4200, q: 0.7, decay: 0.1, gain: 0.32, attack: 0.018 },
      { type: 'bandpass', freq: 6500, q: 1, decay: 0.06, gain: 0.14, attack: 0.03, at: 0.02 },
    ],
    grains: { count: [2, 4], span: 0.08, lo: 3000, hi: 7000, q: 4, decay: 0.01, gain: 0.06 },
  },
  // Crunch.
  gravel: {
    label: 'gravier',
    thump: { freq: 100, decay: 0.05, gain: 0.5 },
    layers: [
      { type: 'bandpass', freq: 2200, q: 0.6, decay: 0.11, gain: 0.6, attack: 0.004 },
      { type: 'lowpass', freq: 900, decay: 0.05, gain: 0.5 },
    ],
    grains: { count: [6, 10], span: 0.12, lo: 1400, hi: 5500, q: 3.5, decay: 0.014, gain: 0.4 },
  },
  // Splash.
  water: {
    label: 'eau',
    thump: { freq: 80, decay: 0.07, gain: 0.7 },
    layers: [
      { type: 'bandpass', freq: 1300, freqEnd: 2700, q: 0.8, decay: 0.15, gain: 0.9, attack: 0.006 },
      { type: 'highpass', freq: 4000, decay: 0.11, gain: 0.28, attack: 0.012 },
    ],
    extra: (k, weight) => {
      const n = 2 + Math.floor(k.rng() * 2 * weight);
      for (let i = 0; i < n; i++) {
        const f = k.rand(320, 620);
        k.tone({ at: k.rand(0.025, 0.11 * weight), freq: f, freqEnd: f * 1.9, sweep: 0.03, attack: 0.003, decay: 0.035, gain: 0.16 });
      }
    },
  },
  foliage: {
    label: 'feuillage',
    thump: { freq: 90, decay: 0.05, gain: 0.3 },
    layers: [
      { type: 'bandpass', freq: 5200, q: 0.8, decay: 0.1, gain: 0.6, attack: 0.015 },
      { type: 'bandpass', freq: 3200, q: 1, decay: 0.08, gain: 0.4, attack: 0.03, at: 0.03 },
    ],
    grains: { count: [3, 6], span: 0.11, lo: 3500, hi: 8000, q: 4, decay: 0.012, gain: 0.2 },
  },
};

/** One foot hitting the floor. `weight` 1 = walking step; above = landing (lower, longer). */
function foot(k: Kit, s: StepSpec, weight: number, at: number, gain: number, variant: number): void {
  const low = 1 / Math.sqrt(weight);
  const long = Math.sqrt(weight);
  k.tone({
    at,
    freq: k.vary(s.thump.freq, 0.08) * low,
    freqEnd: s.thump.freq * 0.55 * low,
    sweep: 0.03 * long,
    attack: 0.0015,
    decay: s.thump.decay * long * 1.2,
    gain: s.thump.gain * gain * weight,
  });
  for (const l of s.layers) {
    const f = k.vary(l.freq, 0.1) * low;
    k.burst({
      at: at + (l.at ? k.vary(l.at, 0.2) : 0),
      color: l.color,
      type: l.type,
      freq: f,
      freqEnd: l.freqEnd !== undefined ? l.freqEnd * low : undefined,
      q: l.q,
      attack: l.attack ?? 0.0005,
      decay: k.vary(l.decay, 0.12) * long,
      gain: l.gain * gain * (l.type === 'bandpass' ? 2.2 : 1.2),
    });
  }
  if (s.ring) {
    k.partials({
      at,
      base: k.vary(s.ring.base, 0.06) * low,
      ratios: s.ring.ratios,
      decay: s.ring.decay * long,
      damp: s.ring.damp,
      gain: s.ring.gain * gain,
    });
  }
  if (s.grains) {
    const g = s.grains;
    const n = Math.round(k.rand(g.count[0], g.count[1]) * weight);
    for (let i = 0; i < n; i++) {
      k.burst({
        at: at + k.rand(0.002, g.span * long),
        type: 'bandpass',
        freq: k.rand(g.lo, g.hi),
        q: g.q,
        attack: 0.0004,
        decay: k.vary(g.decay, 0.3),
        gain: g.gain * gain * k.rand(1.2, 3),
      });
    }
  }
  s.extra?.(k, weight, variant);
}

for (const surf of SURFACES) {
  const s = STEPS[surf];
  defineSound({
    name: `step_${surf}`,
    group: 'step',
    label: `Pas — ${s.label}`,
    dur: 0.3,
    channels: 1,
    variants: 4,
    peak: 0.3,
    build: (k, v) => foot(k, s, 1, 0, 1, v),
  });
  defineSound({
    name: `land_${surf}`,
    group: 'step',
    label: `Réception — ${s.label}`,
    dur: 0.5,
    channels: 1,
    variants: 2,
    peak: 0.5,
    build: (k, v) => {
      // Two feet, a few milliseconds apart, then the gear settling.
      foot(k, s, 1.8, 0, 1, v);
      foot(k, s, 1.5, k.rand(0.018, 0.034), 0.6, v);
      k.burst({ at: 0.03, color: 'pink', type: 'bandpass', freq: k.rand(900, 1600), q: 0.8, attack: 0.02, decay: 0.12, gain: 0.12 });
    },
  });
}

// Hard landing: what the body adds to the floor's own sound — a low hit in the legs, the gear
// rattling on the belt and the breath knocked out. The engine fades it in with the fall speed.
defineSound({
  name: 'land_heavy',
  group: 'step',
  label: 'Réception lourde (corps)',
  dur: 0.5,
  channels: 1,
  variants: 3,
  peak: 0.5,
  build: (k) => {
    k.tone({ freq: k.vary(94, 0.08), freqEnd: 42, sweep: 0.07, attack: 0.002, decay: 0.17, gain: 1 });
    k.burst({ color: 'pink', type: 'lowpass', freq: 420, freqEnd: 160, attack: 0.002, decay: 0.12, gain: 2 });
    k.burst({ type: 'bandpass', freq: k.vary(900, 0.1), q: 0.8, attack: 0.001, decay: 0.03, gain: 0.5 });
    // Gear.
    const n = 3 + Math.floor(k.rng() * 3);
    for (let i = 0; i < n; i++) {
      k.burst({ at: k.rand(0.015, 0.13), type: 'bandpass', freq: k.rand(1500, 3400), q: 4, attack: 0.0004, decay: k.rand(0.008, 0.018), gain: k.rand(0.15, 0.4) });
    }
    // Breath.
    for (const [f, g] of [
      [k.vary(850, 0.08), 0.2],
      [k.vary(1750, 0.08), 0.09],
    ] as const) {
      const src = k.noise('white', 0.03, 0.2);
      const band = k.bp(f, 3);
      const env = k.gain(0);
      k.swell(env.gain, 0.03, g, 0.03, 0.01, 0.12);
      k.chain(src, band, env, k.out);
    }
  },
});

// Jump: push-off scuff, cloth, a short breath.
defineSound({
  name: 'jump',
  group: 'step',
  label: 'Saut',
  dur: 0.36,
  channels: 1,
  variants: 3,
  peak: 0.17,
  build: (k) => {
    k.burst({ color: 'pink', type: 'lowpass', freq: 520, attack: 0.002, decay: 0.05, gain: 1 });
    k.tone({ freq: 105, freqEnd: 70, sweep: 0.03, decay: 0.05, gain: 0.5 });
    const src = k.noise('pink', 0.01, 0.26);
    const bp = k.bp(k.vary(900, 0.15), 0.9);
    k.glide(bp.frequency, 0.01, 800, 1900, 0.2);
    const env = k.gain(0);
    k.swell(env.gain, 0.01, 0.5, 0.07, 0.01, 0.15);
    k.chain(src, bp, env, k.out);
    // Breath: two formant bands.
    for (const [f, g] of [
      [k.vary(1150, 0.08), 0.22],
      [k.vary(2500, 0.08), 0.1],
    ] as const) {
      const n = k.noise('white', 0.02, 0.2);
      const band = k.bp(f, 3.5);
      const e = k.gain(0);
      k.swell(e.gain, 0.02, g, 0.035, 0.01, 0.11);
      k.chain(n, band, e, k.out);
    }
  },
});
