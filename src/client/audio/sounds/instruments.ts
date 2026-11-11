/**
 * Small synthesised instruments shared by the feedback sounds, the announcer
 * jingles and the menu music.
 */
import type { Kit } from '../kit';

/** Frequency of a MIDI note number (69 = A4 = 440 Hz). */
export const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

function dest(k: Kit, to: AudioNode | undefined, pan: number): AudioNode {
  const target = to ?? k.out;
  if (pan === 0) return target;
  const p = k.pan(pan);
  p.connect(target);
  return p;
}

/** Soft mallet chime (vibraphone-like): fundamental + a few quickly dying harmonics. */
export function chime(k: Kit, at: number, freq: number, decay: number, gain: number, to?: AudioNode, pan = 0): void {
  const d = dest(k, to, pan);
  k.tone({ at, freq, decay, gain, attack: 0.002, to: d });
  k.tone({ at, freq: freq * 2, decay: decay * 0.45, gain: gain * 0.22, attack: 0.002, to: d });
  k.tone({ at, freq: freq * 4.02, decay: decay * 0.16, gain: gain * 0.16, attack: 0.001, to: d });
}

/** Bright bell with inharmonic partials. */
export function bell(k: Kit, at: number, freq: number, decay: number, gain: number, to?: AudioNode, pan = 0): void {
  k.partials({
    at,
    base: freq,
    ratios: [1, 2.0, 2.76, 5.4, 8.93],
    gains: [1, 0.45, 0.3, 0.14, 0.06],
    decay,
    damp: 0.75,
    attack: 0.0015,
    gain,
    to: dest(k, to, pan),
  });
}

/** Device beep: oscillator through a low-pass, flat top. */
export function beep(
  k: Kit,
  at: number,
  freq: number,
  dur: number,
  gain: number,
  to?: AudioNode,
  type: OscillatorType = 'square',
  pan = 0,
): void {
  const osc = k.osc(type, freq, at, dur + 0.08);
  const lp = k.lp(freq * 2.6, 0.7);
  const env = k.gain(0);
  k.perc(env.gain, at, gain, 0.003, 0.03, dur);
  k.chain(osc, lp, env, dest(k, to, pan));
}

/** Brassy synth note: two detuned saws through a low-pass that opens with the attack. */
export function brass(k: Kit, at: number, freq: number, dur: number, gain: number, to?: AudioNode, bright = 1, pan = 0): void {
  const lp = k.lp(500, 1.1);
  const t = k.t0 + at;
  const top = Math.min(freq * 7 * bright, 6500);
  lp.frequency.setValueAtTime(Math.max(300, freq * 1.2), t);
  lp.frequency.exponentialRampToValueAtTime(top, t + 0.03);
  lp.frequency.exponentialRampToValueAtTime(Math.max(400, top * 0.4), t + Math.max(0.06, dur));
  const env = k.gain(0);
  k.perc(env.gain, at, gain, 0.012, 0.14, Math.max(0, dur - 0.03));
  for (const cents of [-7, 7]) {
    const o = k.osc('sawtooth', freq, at, dur + 0.25);
    o.detune.value = cents;
    o.connect(lp);
  }
  const sub = k.osc('triangle', freq * 0.5, at, dur + 0.25);
  const subG = k.gain(0.35);
  sub.connect(subG);
  subG.connect(lp);
  k.chain(lp, env, dest(k, to, pan));
}

/** Plucked synth: saw + triangle through a fast closing low-pass. */
export function pluck(k: Kit, at: number, freq: number, decay: number, gain: number, to?: AudioNode, bright = 1, pan = 0): void {
  const lp = k.lp(freq * 2, 2.2);
  const t = k.t0 + at;
  lp.frequency.setValueAtTime(Math.min(freq * 7 * bright, 9000), t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 1.3), t + decay * 0.45);
  const env = k.gain(0);
  k.perc(env.gain, at, gain, 0.002, decay);
  const a = k.osc('sawtooth', freq, at, decay + 0.03);
  const b = k.osc('triangle', freq * 1.003, at, decay + 0.03);
  a.connect(lp);
  b.connect(lp);
  k.chain(lp, env, dest(k, to, pan));
}

/** Kick drum: sine sweep + soft click. */
export function kick(k: Kit, at: number, gain: number, to?: AudioNode, f0 = 150, f1 = 46, decay = 0.24): void {
  k.tone({ at, freq: f0, freqEnd: f1, sweep: 0.07, attack: 0.0015, decay, gain, to });
  k.burst({ at, type: 'lowpass', freq: 1800, attack: 0.0005, decay: 0.012, gain: gain * 0.35, to });
}

/** Snare-ish hit: band-passed noise + a short tone. */
export function snare(k: Kit, at: number, gain: number, to?: AudioNode, decay = 0.13): void {
  k.burst({ at, type: 'bandpass', freq: 1900, q: 0.7, attack: 0.001, decay, gain: gain * 1.6, to });
  k.burst({ at, type: 'highpass', freq: 5000, attack: 0.001, decay: decay * 0.7, gain: gain * 0.45, to });
  k.tone({ at, type: 'triangle', freq: 210, freqEnd: 160, sweep: 0.04, decay: 0.07, gain: gain * 0.5, to });
}

/** Rim click: dry, woody. */
export function rim(k: Kit, at: number, gain: number, to?: AudioNode): void {
  k.burst({ at, type: 'bandpass', freq: 1650, q: 5, attack: 0.0003, decay: 0.025, gain: gain * 3, to });
  k.tone({ at, type: 'triangle', freq: 820, decay: 0.03, gain: gain * 0.4, to });
}

/** Closed / open hi-hat. */
export function hat(k: Kit, at: number, gain: number, to?: AudioNode, decay = 0.035): void {
  k.burst({ at, type: 'highpass', freq: 7200, q: 0.9, attack: 0.0005, decay, gain, to });
  k.burst({ at, type: 'bandpass', freq: 9800, q: 3, attack: 0.0005, decay: decay * 0.7, gain: gain * 1.2, to });
}

/** Shaker: soft-attack high noise. */
export function shaker(k: Kit, at: number, gain: number, to?: AudioNode): void {
  k.burst({ at, type: 'bandpass', freq: 6200, q: 1.2, attack: 0.012, decay: 0.05, gain: gain * 1.5, to });
}
