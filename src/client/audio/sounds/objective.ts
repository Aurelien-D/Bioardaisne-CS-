/**
 * Objective sounds (obj_*): the "écart critique" (bomb) and the sample coolers.
 * They are stereo so they sound full when played flat; the engine's panner mixes
 * them down when they are placed in the world.
 */
import { defineSound } from '../bank';
import type { Kit } from '../kit';
import { beep, bell, chime, hz, pluck } from './instruments';

const def = (
  name: string,
  label: string,
  dur: number,
  channels: 1 | 2,
  peak: number,
  build: (k: Kit, v: number) => void,
  variants = 1,
): void => defineSound({ name, group: 'objective', label, dur, channels, variants, peak, build });

function wetBus(k: Kit, kind: 'room' | 'hall', wet: number): GainNode {
  const bus = k.gain(1);
  bus.connect(k.out);
  k.reverb(bus, kind, wet);
  return bus;
}

// The dossier's timer: an insistent device beep (the game calls it faster and faster).
def('obj_bomb_beep', 'Écart critique — bip', 0.2, 1, 0.4, (k) => {
  const osc = k.osc('square', 2090, 0, 0.14);
  const bp = k.bp(2090, 2.5);
  const env = k.gain(0);
  k.perc(env.gain, 0, 1, 0.002, 0.045, 0.045);
  k.chain(osc, bp, env, k.out);
  k.tone({ freq: 1045, attack: 0.002, hold: 0.045, decay: 0.04, gain: 0.12 });
  k.burst({ type: 'highpass', freq: 4000, attack: 0.0002, decay: 0.004, gain: 0.15 });
});

// Planted: two-tone alarm.
def('obj_bomb_planted', 'Écart critique déposé', 1.8, 2, 0.5, (k) => {
  const bus = wetBus(k, 'room', 0.22);
  k.tone({ freq: 110, freqEnd: 50, sweep: 0.08, decay: 0.25, gain: 0.9, to: bus });
  for (let i = 0; i < 6; i++) {
    const hi = i % 2 === 0;
    beep(k, i * 0.15, hz(hi ? 83 : 78), 0.12, 0.6, bus, 'square', hi ? -0.2 : 0.2);
    beep(k, i * 0.15, hz(hi ? 83 : 78) * 0.5, 0.12, 0.3, bus, 'sawtooth');
  }
});

// Defused: relief — a rising major chime and a breath out.
def('obj_bomb_defused', 'Écart levé', 2.2, 2, 0.45, (k) => {
  const bus = wetBus(k, 'hall', 0.35);
  [76, 80, 83, 88].forEach((m, i) => chime(k, [0, 0.09, 0.18, 0.3][i], hz(m), 1.1, 0.8, bus, -0.45 + i * 0.3));
  bell(k, 0.3, hz(100), 0.8, 0.12, bus);
  const src = k.noise('pink', 0.05, 0.9);
  const env = k.gain(0);
  k.swell(env.gain, 0.05, 0.12, 0.16, 0.02, 0.6);
  const bp = k.bp(1700, 0.7);
  k.glide(bp.frequency, 0.05, 2200, 900, 0.8);
  k.chain(src, bp, env, bus);
});

// Exploded: the big one, then the audit report raining down in loose sheets.
def('obj_bomb_exploded', 'Suspension d’accréditation (explosion)', 3.6, 2, 0.98, (k) => {
  const pre = k.gain(0.6);
  const post = k.gain(1);
  k.chain(pre, k.drive(4), k.lp(5200, 0.6), post, k.out);
  k.reverb(post, 'hall', 0.22);
  k.burst({ type: 'none', attack: 0, decay: 0.004, gain: 2, to: pre });
  k.burst({ type: 'highpass', freq: 800, attack: 0.0003, decay: 0.06, gain: 1.6, to: pre });
  k.burst({ color: 'pink', rate: 0.35, type: 'lowpass', freq: 4200, freqEnd: 110, sweep: 0.7, q: 0.8, attack: 0.002, decay: 1.7, gain: 4, to: pre });
  k.tone({ freq: 95, freqEnd: 27, sweep: 0.55, attack: 0.002, decay: 1.5, gain: 1.8, to: pre });
  k.tone({ type: 'triangle', freq: 52, freqEnd: 30, sweep: 0.8, attack: 0.03, decay: 2.2, gain: 0.6, to: pre });
  for (const side of [-0.7, 0.7]) {
    const src = k.noise('brown', 0.02, 2.9);
    const env = k.gain(0);
    k.perc(env.gain, 0.02, 1.3, 0.06, 2.6);
    k.chain(src, k.lp(220, 0.8), env, k.pan(side), k.out);
  }
  // Debris.
  const chunks = 10 + Math.floor(k.rng() * 6);
  for (let i = 0; i < chunks; i++) {
    const at = 0.14 + Math.pow(k.rng(), 1.5) * 1.1;
    const p = k.pan(k.rand(-0.9, 0.9));
    p.connect(k.out);
    k.burst({ at, type: 'bandpass', freq: k.rand(700, 3600), q: 3, attack: 0.0005, decay: k.rand(0.02, 0.05), gain: k.rand(0.15, 0.5), to: p });
  }
  // Paper flutter: pairs of soft flaps, thinning out.
  const flaps = 16 + Math.floor(k.rng() * 6);
  for (let i = 0; i < flaps; i++) {
    const at = 0.4 + (i / flaps) * 2.5 + k.rand(-0.05, 0.05);
    const level = 0.3 * (1 - (at - 0.4) / 3.1);
    const p = k.pan(k.rand(-1, 1));
    p.connect(k.out);
    const f = k.rand(1900, 5200);
    for (let j = 0; j < 2; j++) {
      const t = at + j * k.rand(0.035, 0.06);
      const src = k.noise('white', t, 0.09);
      const bp = k.bp(f * (j === 0 ? 1 : 0.8), 1.4);
      const env = k.gain(0);
      k.swell(env.gain, t, level * (j === 0 ? 1 : 0.7), 0.012, 0, k.rand(0.03, 0.06));
      k.chain(src, bp, env, p);
    }
  }
});

// Cooler grabbed: latch + urgent falling two-tone.
def('obj_sample_taken', 'Échantillon saisi', 0.7, 2, 0.42, (k) => {
  const bus = wetBus(k, 'room', 0.2);
  k.burst({ type: 'bandpass', freq: 1500, q: 3, attack: 0.0003, decay: 0.022, gain: 2.4, to: bus });
  k.tone({ freq: 210, freqEnd: 120, sweep: 0.03, decay: 0.05, gain: 0.6, to: bus });
  beep(k, 0.05, hz(83), 0.085, 0.7, bus, 'square', -0.2);
  beep(k, 0.165, hz(79), 0.13, 0.7, bus, 'square', 0.2);
});

// Cooler secured: fridge door closing + reassuring rising chime.
def('obj_sample_returned', 'Échantillon sécurisé', 1.1, 2, 0.4, (k) => {
  const bus = wetBus(k, 'room', 0.25);
  k.tone({ freq: 115, freqEnd: 68, sweep: 0.05, decay: 0.11, gain: 1, to: bus });
  k.burst({ color: 'pink', type: 'lowpass', freq: 520, attack: 0.001, decay: 0.08, gain: 2, to: bus });
  k.burst({ at: 0.004, type: 'bandpass', freq: 1300, q: 2, attack: 0.0005, decay: 0.02, gain: 0.8, to: bus });
  chime(k, 0.07, hz(79), 0.5, 0.7, bus, -0.25);
  chime(k, 0.17, hz(84), 0.6, 0.8, bus, 0.25);
});

// Cooler extracted: whoosh, van door, notification.
def('obj_sample_extracted', 'Échantillon extrait', 1.4, 2, 0.45, (k) => {
  const bus = wetBus(k, 'room', 0.25);
  const src = k.noise('white', 0, 0.42);
  const bp = k.bp(500, 1.2);
  k.glide(bp.frequency, 0, 500, 4200, 0.34);
  const env = k.gain(0);
  k.swell(env.gain, 0, 0.5, 0.3, 0, 0.06);
  k.chain(src, bp, env, bus);
  k.tone({ at: 0.36, freq: 92, freqEnd: 44, sweep: 0.08, decay: 0.22, gain: 1, to: bus });
  k.burst({ at: 0.36, type: 'bandpass', freq: 310, q: 1, attack: 0.001, decay: 0.1, gain: 2, to: bus });
  k.burst({ at: 0.362, type: 'bandpass', freq: 1900, q: 3, attack: 0.0005, decay: 0.02, gain: 0.8, to: bus });
  pluck(k, 0.42, hz(88), 0.16, 0.6, bus, 1.3, -0.3);
  pluck(k, 0.52, hz(83), 0.3, 0.6, bus, 1.3, 0.3);
});

// Dossier dropped: a folder slapping the floor.
def('obj_bomb_dropped', 'Dossier tombé', 0.3, 1, 0.3, (k) => {
  k.tone({ freq: 140, freqEnd: 80, sweep: 0.03, decay: 0.05, gain: 0.7 });
  k.burst({ type: 'bandpass', freq: k.vary(500, 0.1), q: 1.5, decay: 0.06, gain: 2 });
  k.burst({ type: 'highpass', freq: 2000, attack: 0.002, decay: 0.05, gain: 0.5 });
  k.burst({ at: 0.03, type: 'bandpass', freq: 3200, q: 1, attack: 0.008, decay: 0.07, gain: 0.3 });
});

// Dossier picked up: paper rustle + small rising blip.
def('obj_bomb_picked', 'Dossier récupéré', 0.4, 1, 0.3, (k) => {
  k.burst({ type: 'bandpass', freq: 3200, q: 1, attack: 0.01, decay: 0.08, gain: 0.8 });
  k.burst({ at: 0.05, type: 'bandpass', freq: 2400, q: 1, attack: 0.01, decay: 0.07, gain: 0.6 });
  pluck(k, 0.06, hz(79), 0.08, 0.7, undefined, 1.2);
  pluck(k, 0.12, hz(86), 0.14, 0.8, undefined, 1.3);
});

// Cooler dropped: hollow plastic thud with the tubes rattling inside.
def('obj_sample_dropped', 'Glacière au sol', 0.45, 1, 0.34, (k) => {
  k.partials({ base: k.vary(180, 0.08), ratios: [1, 2.1, 3.4], decay: 0.12, damp: 1, gain: 0.9 });
  k.burst({ type: 'bandpass', freq: 600, q: 2, decay: 0.045, gain: 2 });
  k.burst({ type: 'highpass', freq: 3000, attack: 0.0003, decay: 0.006, gain: 0.4 });
  const tubes = 4 + Math.floor(k.rng() * 3);
  for (let i = 0; i < tubes; i++) {
    const f = k.rand(3200, 6200);
    k.tone({ at: k.rand(0.015, 0.2), freq: f, attack: 0.0005, decay: k.rand(0.02, 0.04), gain: k.rand(0.06, 0.14) });
  }
});
