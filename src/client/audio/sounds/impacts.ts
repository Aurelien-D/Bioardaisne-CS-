/**
 * Bullet sounds in the world: impacts per SurfaceType (impact_<surface>), hits on
 * players (bodyhit, bodyhit_head) and near misses (whizz).
 */
import type { SurfaceType } from '../../../shared/maps/materials';
import { defineSound } from '../bank';
import type { Kit } from '../kit';

/** Scatter of small debris: short resonant grains at random times. */
function debris(
  k: Kit,
  count: number,
  from: number,
  to: number,
  lo: number,
  hi: number,
  gain: number,
  q = 4,
  decay = 0.014,
): void {
  for (let i = 0; i < count; i++) {
    const at = from + (to - from) * Math.pow(k.rng(), 1.4);
    k.burst({ at, type: 'bandpass', freq: k.rand(lo, hi), q, attack: 0.0004, decay: k.vary(decay, 0.3), gain: gain * k.rand(1, 2.6) * (1 - (0.6 * (at - from)) / (to - from)) });
  }
}

/** Tiny pitched pings (glass, ceramic shards). */
function pings(k: Kit, count: number, from: number, to: number, lo: number, hi: number, gain: number): void {
  for (let i = 0; i < count; i++) {
    const at = from + (to - from) * Math.pow(k.rng(), 1.3);
    const f = k.rand(lo, hi);
    k.tone({ at, freq: f, attack: 0.0006, decay: k.rand(0.02, 0.06), gain: gain * k.rand(0.5, 1) });
    k.tone({ at, freq: f * 1.51, attack: 0.0006, decay: 0.02, gain: gain * 0.3 });
  }
}

/** Puff of dust: soft low-passed noise. */
function dust(k: Kit, at: number, gain: number, decay = 0.14): void {
  k.burst({ at, color: 'pink', type: 'lowpass', freq: 2600, freqEnd: 700, attack: 0.012, decay, gain });
}

const IMPACTS: Record<SurfaceType, { label: string; peak: number; dur: number; build: (k: Kit, v: number) => void }> = {
  concrete: {
    label: 'béton',
    peak: 0.46,
    dur: 0.4,
    build: (k) => {
      k.burst({ type: 'highpass', freq: 2200, attack: 0.0003, decay: 0.012, gain: 1.2 });
      k.burst({ type: 'bandpass', freq: k.vary(1300, 0.15), q: 0.8, decay: 0.05, gain: 1.6 });
      k.tone({ freq: 170, freqEnd: 90, sweep: 0.03, decay: 0.05, gain: 0.5 });
      dust(k, 0.006, 0.3);
      debris(k, 2 + Math.floor(k.rng() * 3), 0.03, 0.22, 2500, 5500, 0.16, 6, 0.012);
    },
  },
  tile: {
    label: 'carrelage',
    peak: 0.44,
    dur: 0.4,
    build: (k) => {
      k.burst({ type: 'highpass', freq: 3500, attack: 0.0003, decay: 0.01, gain: 1.2 });
      k.burst({ type: 'bandpass', freq: k.vary(2400, 0.1), q: 1.5, decay: 0.03, gain: 1.2 });
      k.partials({ base: k.vary(2600, 0.1), ratios: [1, 1.59, 2.41, 3.3], decay: 0.07, gain: 0.4 });
      pings(k, 3 + Math.floor(k.rng() * 3), 0.03, 0.24, 3500, 7500, 0.12);
    },
  },
  lino: {
    label: 'lino',
    peak: 0.4,
    dur: 0.3,
    build: (k) => {
      k.burst({ type: 'highpass', freq: 2400, attack: 0.0003, decay: 0.008, gain: 0.7 });
      k.burst({ type: 'bandpass', freq: k.vary(750, 0.12), q: 1.4, decay: 0.05, gain: 2 });
      k.tone({ freq: 150, freqEnd: 80, sweep: 0.03, decay: 0.06, gain: 0.7 });
      k.burst({ at: 0.004, color: 'pink', type: 'lowpass', freq: 1500, attack: 0.004, decay: 0.07, gain: 0.5 });
    },
  },
  carpet: {
    label: 'moquette',
    peak: 0.34,
    dur: 0.3,
    build: (k) => {
      k.burst({ color: 'pink', type: 'lowpass', freq: 1100, freqEnd: 350, attack: 0.003, decay: 0.08, gain: 2 });
      k.tone({ freq: 125, freqEnd: 70, sweep: 0.03, decay: 0.06, gain: 0.6 });
      k.burst({ type: 'bandpass', freq: 2300, q: 0.7, attack: 0.003, decay: 0.03, gain: 0.25 });
    },
  },
  wood: {
    label: 'bois',
    peak: 0.46,
    dur: 0.35,
    build: (k) => {
      k.partials({ base: k.vary(220, 0.12), ratios: [1, 2.3, 3.9], decay: 0.1, damp: 1, gain: 0.9 });
      k.burst({ type: 'bandpass', freq: k.vary(700, 0.1), q: 2, decay: 0.035, gain: 1.8 });
      k.burst({ type: 'highpass', freq: 2000, attack: 0.0003, decay: 0.01, gain: 0.7 });
      debris(k, 1 + Math.floor(k.rng() * 2), 0.04, 0.12, 1800, 3200, 0.14, 5, 0.012);
    },
  },
  metal: {
    label: 'métal',
    peak: 0.48,
    dur: 0.55,
    build: (k, v) => {
      const base = v === 2 ? k.rand(800, 1100) : k.rand(1700, 2900);
      k.burst({ type: 'highpass', freq: 3000, attack: 0.0002, decay: 0.006, gain: 1 });
      k.burst({ type: 'bandpass', freq: 1200, q: 2, decay: 0.03, gain: 1.4 });
      k.partials({ base, ratios: [1, 1.48, 2.07, 2.93, 3.71], gains: [1, 0.7, 0.5, 0.3, 0.2], decay: v === 2 ? 0.2 : 0.3, damp: 0.5, gain: 0.55 });
      if (v === 1) {
        // Ricochet whine flying away.
        k.tone({
          at: 0.012,
          freq: k.rand(3600, 4400),
          freqEnd: k.rand(1100, 1500),
          sweep: 0.34,
          attack: 0.008,
          decay: 0.34,
          gain: 0.22,
          vibrato: [k.rand(30, 46), 70],
        });
      }
    },
  },
  glass: {
    label: 'verre',
    peak: 0.44,
    dur: 0.5,
    build: (k) => {
      k.burst({ type: 'highpass', freq: 3000, attack: 0.0003, decay: 0.012, gain: 1.2 });
      k.burst({ type: 'bandpass', freq: k.vary(5500, 0.1), q: 1, decay: 0.05, gain: 1 });
      k.burst({ type: 'highpass', freq: 6000, attack: 0.004, decay: 0.2, gain: 0.2 });
      pings(k, 6 + Math.floor(k.rng() * 5), 0.008, 0.32, 4000, 9500, 0.16);
    },
  },
  plaster: {
    label: 'plâtre',
    peak: 0.4,
    dur: 0.4,
    build: (k) => {
      k.burst({ type: 'highpass', freq: 2500, attack: 0.0003, decay: 0.008, gain: 0.6 });
      k.burst({ type: 'lowpass', freq: 1800, decay: 0.05, gain: 1 });
      k.burst({ type: 'bandpass', freq: k.vary(900, 0.12), q: 1, decay: 0.06, gain: 1.5 });
      dust(k, 0.006, 0.4, 0.18);
      debris(k, 2 + Math.floor(k.rng() * 3), 0.04, 0.22, 1800, 3500, 0.1, 4, 0.015);
    },
  },
  plastic: {
    label: 'plastique',
    peak: 0.4,
    dur: 0.3,
    build: (k) => {
      k.burst({ type: 'highpass', freq: 4000, attack: 0.0002, decay: 0.006, gain: 0.8 });
      k.burst({ type: 'bandpass', freq: k.vary(1700, 0.12), q: 4, decay: 0.03, gain: 2.4 });
      k.partials({ base: k.vary(600, 0.12), ratios: [1, 2.4], decay: 0.045, damp: 1, gain: 0.45 });
    },
  },
  fabric: {
    label: 'tissu',
    peak: 0.32,
    dur: 0.3,
    build: (k) => {
      k.burst({ color: 'pink', type: 'lowpass', freq: 1300, freqEnd: 400, attack: 0.003, decay: 0.075, gain: 2 });
      k.burst({ type: 'bandpass', freq: 2600, q: 0.7, attack: 0.003, decay: 0.035, gain: 0.3 });
      k.tone({ freq: 120, freqEnd: 70, sweep: 0.03, decay: 0.05, gain: 0.4 });
    },
  },
  cardboard: {
    label: 'carton',
    peak: 0.38,
    dur: 0.3,
    build: (k) => {
      k.burst({ type: 'bandpass', freq: k.vary(380, 0.12), q: 2.2, decay: 0.07, gain: 2.4 });
      k.partials({ base: k.vary(210, 0.1), ratios: [1, 1.7], decay: 0.06, damp: 1, gain: 0.4 });
      k.burst({ type: 'bandpass', freq: 2600, q: 0.8, attack: 0.0006, decay: 0.028, gain: 0.8 });
    },
  },
  dirt: {
    label: 'terre',
    peak: 0.4,
    dur: 0.4,
    build: (k) => {
      k.tone({ freq: 130, freqEnd: 60, sweep: 0.04, decay: 0.07, gain: 0.8 });
      k.burst({ color: 'pink', type: 'lowpass', freq: 900, attack: 0.001, decay: 0.065, gain: 2 });
      dust(k, 0.006, 0.35);
      debris(k, 4 + Math.floor(k.rng() * 4), 0.03, 0.26, 1500, 4500, 0.1, 3, 0.015);
    },
  },
  grass: {
    label: 'herbe',
    peak: 0.36,
    dur: 0.4,
    build: (k) => {
      k.tone({ freq: 120, freqEnd: 60, sweep: 0.04, decay: 0.06, gain: 0.7 });
      k.burst({ color: 'pink', type: 'lowpass', freq: 750, attack: 0.002, decay: 0.06, gain: 1.8 });
      k.burst({ type: 'bandpass', freq: 4500, q: 0.8, attack: 0.008, decay: 0.09, gain: 0.5 });
      debris(k, 2 + Math.floor(k.rng() * 3), 0.03, 0.22, 2500, 6000, 0.06, 3, 0.014);
    },
  },
  gravel: {
    label: 'gravier',
    peak: 0.44,
    dur: 0.45,
    build: (k) => {
      k.burst({ type: 'highpass', freq: 1800, attack: 0.0003, decay: 0.012, gain: 1 });
      k.burst({ type: 'bandpass', freq: 2000, q: 0.6, attack: 0.002, decay: 0.1, gain: 1 });
      k.tone({ freq: 140, freqEnd: 75, sweep: 0.03, decay: 0.05, gain: 0.5 });
      debris(k, 7 + Math.floor(k.rng() * 6), 0.01, 0.3, 1500, 6000, 0.3, 4, 0.016);
    },
  },
  water: {
    label: 'eau',
    peak: 0.42,
    dur: 0.55,
    build: (k) => {
      const f = k.rand(260, 330);
      k.tone({ freq: f, freqEnd: f * 2.2, sweep: 0.06, attack: 0.002, decay: 0.09, gain: 0.8 });
      k.burst({ type: 'bandpass', freq: 1500, freqEnd: 3200, q: 0.8, attack: 0.008, decay: 0.22, gain: 1.6 });
      k.burst({ type: 'highpass', freq: 5000, attack: 0.012, decay: 0.16, gain: 0.3 });
      const n = 3 + Math.floor(k.rng() * 3);
      for (let i = 0; i < n; i++) {
        const b = k.rand(900, 2200);
        k.tone({ at: k.rand(0.08, 0.36), freq: b, freqEnd: b * 1.4, sweep: 0.02, attack: 0.002, decay: 0.03, gain: 0.12 });
      }
    },
  },
  foliage: {
    label: 'feuillage',
    peak: 0.3,
    dur: 0.35,
    build: (k) => {
      k.burst({ type: 'bandpass', freq: k.vary(5000, 0.1), q: 0.8, attack: 0.004, decay: 0.09, gain: 1.6 });
      k.burst({ at: 0.02, type: 'bandpass', freq: k.vary(2800, 0.1), q: 1, attack: 0.01, decay: 0.08, gain: 1 });
      debris(k, 3 + Math.floor(k.rng() * 3), 0.01, 0.2, 4000, 8000, 0.2, 4, 0.012);
    },
  },
};

for (const surf of Object.keys(IMPACTS) as SurfaceType[]) {
  const s = IMPACTS[surf];
  defineSound({
    name: `impact_${surf}`,
    group: 'impact',
    label: `Impact — ${s.label}`,
    dur: s.dur,
    channels: 1,
    variants: 3,
    peak: s.peak,
    build: s.build,
  });
}

// Bullet (or scalpel) hitting a player: soft, slightly wet thump.
defineSound({
  name: 'bodyhit',
  group: 'impact',
  label: 'Touche (corps)',
  dur: 0.3,
  channels: 1,
  variants: 3,
  peak: 0.5,
  build: (k) => {
    k.tone({ freq: k.vary(150, 0.1), freqEnd: 65, sweep: 0.04, decay: 0.085, gain: 1 });
    k.burst({ color: 'pink', type: 'lowpass', freq: 950, attack: 0.001, decay: 0.055, gain: 2.2 });
    k.burst({ type: 'bandpass', freq: k.vary(1400, 0.12), q: 1.4, decay: 0.02, gain: 1.4 });
    k.burst({ at: 0.012, type: 'bandpass', freq: k.vary(2600, 0.15), q: 2, attack: 0.002, decay: 0.03, gain: 0.3 });
  },
});

// Headshot: a distinct, sharper "dink".
defineSound({
  name: 'bodyhit_head',
  group: 'impact',
  label: 'Touche (tête)',
  dur: 0.36,
  channels: 1,
  variants: 2,
  peak: 0.6,
  build: (k) => {
    const base = k.vary(2050, 0.04);
    k.burst({ type: 'highpass', freq: 3500, attack: 0.0002, decay: 0.005, gain: 0.9 });
    k.burst({ type: 'bandpass', freq: base, q: 6, decay: 0.022, gain: 2.6 });
    k.partials({ base, ratios: [1, 1.62, 2.44, 3.3], gains: [1, 0.6, 0.35, 0.2], decay: 0.16, damp: 0.7, gain: 0.7 });
    k.tone({ freq: 180, freqEnd: 90, sweep: 0.03, decay: 0.045, gain: 0.45 });
  },
});

// Near miss: a fast falling "fwip", sometimes with the tiny crack of the shock wave.
defineSound({
  name: 'whizz',
  group: 'impact',
  label: 'Balle qui siffle',
  dur: 0.34,
  channels: 1,
  variants: 4,
  peak: 0.4,
  build: (k, v) => {
    const dur = k.vary(0.17, 0.2);
    const hi = k.rand(4600, 6200);
    const lo = k.rand(1000, 1500);
    const src = k.noise('white', 0, dur + 0.05);
    const bp = k.bp(hi, 5);
    k.glide(bp.frequency, 0, hi, lo, dur);
    const env = k.gain(0);
    k.swell(env.gain, 0, 1, dur * 0.28, 0, dur * 0.72);
    k.chain(src, bp, env, k.out);
    const air = k.noise('white', 0, dur + 0.05);
    const airEnv = k.gain(0);
    k.swell(airEnv.gain, 0, 0.08, dur * 0.3, 0, dur * 0.5);
    k.chain(air, k.hp(6500), airEnv, k.out);
    if (v % 2 === 1) k.burst({ at: dur * 0.2, type: 'highpass', freq: 4200, attack: 0.0002, decay: 0.007, gain: 0.5 });
    // Faint tonal "zing" riding on the sweep.
    k.tone({ freq: hi * 0.9, freqEnd: lo * 0.9, sweep: dur, attack: dur * 0.25, decay: dur * 0.7, gain: 0.05 });
  },
});
