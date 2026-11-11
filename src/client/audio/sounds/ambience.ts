/**
 * Ambience: two seamless background loops (amb_interior, amb_city) and the
 * occasional one-shot events the engine sprinkles over them at random
 * (analyser beeps, a centrifuge, a far phone; birds, a church bell, a passing car).
 */
import { defineSound } from '../bank';
import type { Kit } from '../kit';
import { beep } from './instruments';

/** Slow sine modulation of a parameter around its value. */
function lfo(k: Kit, target: AudioParam, rate: number, depth: number, total: number): void {
  const o = k.osc('sine', rate, 0, total);
  const d = k.gain(depth);
  o.connect(d);
  d.connect(target);
}

/**
 * Gain stage for the periodic (tonal) layers of a cross-faded loop. The loop seam is an
 * equal-power cross-fade, right for noise but +3 dB for content that is identical on both
 * sides; this pre-compensates so steady tones come out perfectly flat.
 */
function steady(k: Kit, length: number, overlap: number): GainNode {
  const g = k.gain(1);
  const n = 33;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * Math.PI * 0.5;
    curve[i] = 1 / (Math.sin(x) + Math.cos(x));
  }
  g.gain.setValueCurveAtTime(curve, k.t0, overlap);
  g.gain.setValueAtTime(1, k.t0 + overlap + 0.0001);
  g.gain.setValueCurveAtTime(curve, k.t0 + length, overlap);
  return g;
}

const INTERIOR_LENGTH = 16;
const INTERIOR_OVERLAP = 2;

defineSound({
  name: 'amb_interior',
  group: 'ambience',
  label: 'Ambiance — plateau technique',
  dur: INTERIOR_LENGTH + INTERIOR_OVERLAP,
  channels: 2,
  variants: 1,
  peak: 0.3,
  loop: { length: INTERIOR_LENGTH, overlap: INTERIOR_OVERLAP, mode: 'xfade' },
  build: (k) => {
    const total = INTERIOR_LENGTH + INTERIOR_OVERLAP + 0.05;
    // Ventilation: broad low rush, different on each side.
    for (const [side, rate] of [
      [-0.8, 1],
      [0.8, 0.87],
    ] as const) {
      const n = k.noise('pink', 0, total, rate);
      const g = k.gain(1);
      lfo(k, g.gain, (side < 0 ? 2 : 3) / INTERIOR_LENGTH, 0.12, total);
      k.chain(n, k.lp(430, 0.6), g, k.pan(side), k.out);
      // Air at the grilles.
      const hiss = k.noise('white', 0, total, rate);
      k.chain(hiss, k.bp(3300, 0.5), k.gain(0.035), k.pan(side), k.out);
    }
    // Duct resonances.
    const duct = k.noise('pink', 0, total, 0.93);
    for (const [f, q, g] of [
      [92, 5, 0.9],
      [185, 7, 0.7],
      [308, 9, 0.35],
    ] as const) {
      k.chain(duct, k.bp(f, q), k.gain(g), k.out);
    }
    // Mains hum: 50 Hz and its harmonics (whole periods in the loop length).
    const tones = steady(k, INTERIOR_LENGTH, INTERIOR_OVERLAP);
    tones.connect(k.out);
    for (const [f, g] of [
      [50, 0.16],
      [100, 0.1],
      [150, 0.04],
      [250, 0.012],
    ] as const) {
      const o = k.osc('sine', f, 0, total);
      k.chain(o, k.gain(g), tones);
    }
    // Fridge compressors: two close tones beating slowly.
    for (const [f, side] of [
      [118 + 1 / INTERIOR_LENGTH, -0.4],
      [118 + 6 / INTERIOR_LENGTH, 0.4],
    ] as const) {
      const o = k.osc('triangle', f, 0, total);
      k.chain(o, k.lp(400), k.gain(0.035), k.pan(side), tones);
    }
  },
});

const CITY_LENGTH = 20;
const CITY_OVERLAP = 2.5;

defineSound({
  name: 'amb_city',
  group: 'ambience',
  label: 'Ambiance — centre-ville',
  dur: CITY_LENGTH + CITY_OVERLAP,
  channels: 2,
  variants: 1,
  peak: 0.3,
  loop: { length: CITY_LENGTH, overlap: CITY_OVERLAP, mode: 'xfade' },
  build: (k) => {
    const total = CITY_LENGTH + CITY_OVERLAP + 0.05;
    // Wind: band of noise whose colour and strength drift, one layer per side.
    for (const [side, rate, cycles] of [
      [-0.7, 1, 1],
      [0.7, 0.81, 2],
    ] as const) {
      const n = k.noise('pink', 0, total, rate);
      const bp = k.bp(560, 0.8);
      lfo(k, bp.frequency, cycles / CITY_LENGTH, 220, total);
      lfo(k, bp.frequency, (cycles + 2) / CITY_LENGTH, 90, total);
      const g = k.gain(0.75);
      lfo(k, g.gain, (cycles + 1) / CITY_LENGTH, 0.3, total);
      lfo(k, g.gain, (cycles + 4) / CITY_LENGTH, 0.12, total);
      k.chain(n, bp, g, k.pan(side), k.out);
      // Gusts in the leaves.
      const hi = k.noise('white', 0, total, rate);
      const hg = k.gain(0.035);
      lfo(k, hg.gain, (cycles + 2) / CITY_LENGTH, 0.025, total);
      k.chain(hi, k.bp(2600, 0.5), hg, k.pan(-side), k.out);
    }
    // Distant traffic: low rumble that swells slowly.
    for (const [side, rate] of [
      [-0.5, 1],
      [0.5, 0.9],
    ] as const) {
      const n = k.noise('brown', 0, total, rate);
      const g = k.gain(1.1);
      lfo(k, g.gain, (side < 0 ? 1 : 2) / CITY_LENGTH, 0.3, total);
      k.chain(n, k.lp(150, 0.7), g, k.pan(side), k.out);
    }
    const mid = k.noise('pink', 0, total, 0.77);
    const mg = k.gain(0.22);
    lfo(k, mg.gain, 3 / CITY_LENGTH, 0.08, total);
    k.chain(mid, k.bp(270, 1), mg, k.out);
  },
});

// --- Interior events ---------------------------------------------------------------

defineSound({
  name: 'amb_beep',
  group: 'ambience',
  label: 'Ambiance — bips d’automate',
  dur: 1.8,
  channels: 2,
  variants: 3,
  peak: 0.1,
  build: (k, v) => {
    const bus = k.gain(1);
    const lp = k.lp(2600, 0.7);
    bus.connect(lp);
    lp.connect(k.out);
    k.reverb(lp, 'room', 0.7);
    if (v === 0) for (let i = 0; i < 3; i++) beep(k, i * 0.21, 2200, 0.08, 0.6, bus, 'sine');
    else if (v === 1) beep(k, 0, 1850, 0.42, 0.5, bus, 'triangle');
    else for (let i = 0; i < 2; i++) beep(k, i * 0.13, 2640, 0.05, 0.6, bus, 'sine');
  },
});

defineSound({
  name: 'amb_centrifuge',
  group: 'ambience',
  label: 'Ambiance — centrifugeuse',
  dur: 7,
  channels: 2,
  variants: 2,
  peak: 0.075,
  build: (k) => {
    const up = k.rand(1.4, 1.9);
    const hold = k.rand(1.3, 2.1);
    const down = k.rand(2.0, 2.6);
    const top = k.rand(250, 330);
    const bus = k.gain(1);
    const far = k.lp(1100, 0.7);
    bus.connect(far);
    far.connect(k.out);
    k.reverb(far, 'room', 0.5);
    const env = k.gain(0);
    k.swell(env.gain, 0, 1, 0.6, up + hold - 0.6, down);
    env.connect(bus);
    const total = up + hold + down + 0.05;
    const sweep = (p: AudioParam, mul: number): void => {
      k.glide(p, 0, 55 * mul, top * mul, up);
      k.glide(p, up + hold, top * mul, 45 * mul, down);
    };
    const saw = k.osc('sawtooth', 55, 0, total);
    sweep(saw.frequency, 1);
    k.chain(saw, k.lp(700, 1), k.gain(0.5), env);
    const hum = k.osc('sine', 110, 0, total);
    sweep(hum.frequency, 2.01);
    k.chain(hum, k.gain(0.3), env);
    const air = k.noise('pink', 0, total);
    const bp = k.bp(300, 2);
    sweep(bp.frequency, 4);
    k.chain(air, bp, k.gain(0.9), env);
  },
});

defineSound({
  name: 'amb_phone',
  group: 'ambience',
  label: 'Ambiance — téléphone au loin',
  dur: 4.6,
  channels: 2,
  variants: 2,
  peak: 0.06,
  build: (k, v) => {
    const bus = k.gain(1);
    const far = k.chain(bus, k.bp(1400, 0.7), k.lp(2300, 0.7));
    far.connect(k.out);
    k.reverb(far, 'room', 0.8);
    const ring = (at: number, len: number): void => {
      const osc = k.osc('sine', 1200, at, len + 0.05);
      const warble = k.osc('square', v === 0 ? 18 : 25, at, len + 0.05);
      const depth = k.gain(v === 0 ? 170 : 60);
      warble.connect(depth);
      depth.connect(osc.frequency);
      const env = k.gain(0);
      k.perc(env.gain, at, 0.6, 0.01, 0.05, len);
      k.chain(osc, env, bus);
      const second = k.osc('sine', 1200 * 1.5, at, len + 0.05);
      depth.connect(second.frequency);
      const env2 = k.gain(0);
      k.perc(env2.gain, at, 0.2, 0.01, 0.05, len);
      k.chain(second, env2, bus);
    };
    if (v === 0) {
      ring(0, 0.85);
      ring(2.4, 0.85);
    } else {
      for (const t of [0, 0.5, 2.3, 2.8]) ring(t, 0.34);
    }
  },
});

// --- City events -------------------------------------------------------------------

defineSound({
  name: 'amb_bird',
  group: 'ambience',
  label: 'Ambiance — oiseaux',
  dur: 1.9,
  channels: 2,
  variants: 4,
  peak: 0.085,
  build: (k, v) => {
    const bus = k.gain(1);
    const hp = k.hp(1800);
    bus.connect(hp);
    hp.connect(k.out);
    k.reverb(hp, 'far', 0.3);
    let t = 0;
    if (v === 3) {
      // Trill.
      const f = k.rand(3400, 4600);
      for (let i = 0; i < 9; i++) {
        k.tone({ at: t, freq: i % 2 ? f * 1.14 : f, attack: 0.006, decay: 0.035, gain: 0.5 + 0.05 * i, to: bus });
        t += 0.048;
      }
      return;
    }
    const n = 2 + Math.floor(k.rng() * 4);
    for (let i = 0; i < n; i++) {
      const f = k.rand(2900, 5200);
      const len = k.rand(0.05, 0.12);
      k.tone({
        at: t,
        freq: f,
        freqEnd: f * k.rand(0.72, 1.4),
        sweep: len,
        attack: 0.008,
        decay: len,
        gain: k.rand(0.5, 1),
        vibrato: [k.rand(24, 46), 110],
        to: bus,
      });
      t += len + k.rand(0.03, 0.16);
    }
  },
});

defineSound({
  name: 'amb_bell',
  group: 'ambience',
  label: 'Ambiance — cloche de l’église',
  dur: 11,
  channels: 2,
  variants: 2,
  peak: 0.085,
  build: (k, v) => {
    const bus = k.gain(1);
    const far = k.lp(1500, 0.6);
    bus.connect(far);
    far.connect(k.out);
    k.reverb(far, 'far', 0.6);
    const strikes = v === 0 ? 1 : 3;
    for (let s = 0; s < strikes; s++) {
      const at = s * 2.35;
      k.partials({
        at,
        base: 207.6,
        ratios: [0.5, 1, 1.2, 1.5, 2, 2.5, 3, 4.2],
        gains: [0.5, 1, 0.7, 0.3, 0.6, 0.25, 0.2, 0.1],
        decay: 5.2,
        damp: 0.9,
        attack: 0.004,
        gain: 0.5,
        to: bus,
      });
      k.burst({ at, type: 'bandpass', freq: 900, q: 2, attack: 0.001, decay: 0.04, gain: 0.6, to: bus });
    }
  },
});

defineSound({
  name: 'amb_car',
  group: 'ambience',
  label: 'Ambiance — voiture qui passe',
  dur: 6.8,
  channels: 2,
  variants: 2,
  peak: 0.12,
  build: (k, v) => {
    const dir = v === 0 ? 1 : -1;
    const rise = k.rand(2.2, 2.9);
    const fall = k.rand(2.9, 3.5);
    const env = k.gain(0);
    k.swell(env.gain, 0, 1, rise, 0.15, fall);
    let out: AudioNode = k.out;
    if (typeof k.ctx.createStereoPanner === 'function') {
      const p = k.ctx.createStereoPanner();
      p.pan.setValueAtTime(-0.9 * dir, k.t0);
      p.pan.linearRampToValueAtTime(0.9 * dir, k.t0 + rise + fall);
      p.connect(k.out);
      out = p;
    }
    k.chain(env, k.lp(2400, 0.6), out);
    const total = rise + fall + 0.3;
    k.chain(k.noise('brown', 0, total), k.lp(190, 0.7), k.gain(1.3), env);
    k.chain(k.noise('pink', 0, total), k.bp(330, 1), k.gain(0.55), env);
    const tyres = k.noise('white', 0, total);
    const bp = k.bp(1300, 0.6);
    k.glide(bp.frequency, 0, 1500, 900, rise + fall);
    k.chain(tyres, bp, k.gain(0.22), env);
    // Engine note with a hint of Doppler.
    const eng = k.osc('sawtooth', 92, 0, total);
    k.glide(eng.frequency, rise - 0.4, 92, 79, 0.9);
    k.chain(eng, k.lp(320, 1), k.gain(0.18), env);
  },
});
