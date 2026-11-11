/**
 * Synthesis toolkit: small helpers on top of the Web Audio API used by every sound
 * recipe (src/client/audio/sounds/*). A recipe receives a `Kit` bound to a context,
 * a destination node, a start time and a seeded random generator, and builds a node
 * graph. Nothing here depends on the context being real-time: the same recipes are
 * rendered through OfflineAudioContexts by the sound bank (bank.ts).
 *
 * Conventions: every time passed to a Kit method is relative to the start of the
 * sound (`t0` is added internally); "decay" is always the time needed to fall by
 * 60 dB; envelope gains are created at 0 so nothing leaks before a sound starts.
 */
import { mulberry32, type Rng } from '../../shared/math/rng';

export type NoiseColor = 'white' | 'pink' | 'brown';
export type ReverbKind = 'room' | 'hall' | 'far' | 'corridor' | 'street';

const NOISE_SECONDS = 3;
const noiseCache = new Map<string, AudioBuffer>();
const irCache = new Map<string, AudioBuffer>();
const curveCache = new Map<string, Float32Array<ArrayBuffer>>();

/** Create an AudioBuffer that does not belong to a particular context. */
export function makeBuffer(ctx: BaseAudioContext, channels: number, length: number, sampleRate: number): AudioBuffer {
  try {
    return new AudioBuffer({ numberOfChannels: channels, length, sampleRate });
  } catch {
    return ctx.createBuffer(channels, length, sampleRate);
  }
}

/** Looping noise buffer (deterministic, shared by every context with the same sample rate). */
export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  const sr = ctx.sampleRate;
  const key = `${color}@${sr}`;
  const cached = noiseCache.get(key);
  if (cached) return cached;
  const n = Math.floor(sr * NOISE_SECONDS);
  const buf = makeBuffer(ctx, 1, n, sr);
  const d = buf.getChannelData(0);
  const rnd = mulberry32(color === 'white' ? 0x51a7e : color === 'pink' ? 0x9e3a1 : 0x3c0ffee);
  if (color === 'white') {
    for (let i = 0; i < n; i++) d[i] = rnd() * 2 - 1;
  } else if (color === 'pink') {
    // Paul Kellet's refined pink-noise filter.
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  if (color !== 'white') {
    // Remove the offset and the drift so the buffer loops without a step.
    const drift = d[n - 1] - d[0];
    let mean = 0;
    for (let i = 0; i < n; i++) {
      d[i] -= (drift * i) / (n - 1);
      mean += d[i];
    }
    mean /= n;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      d[i] -= mean;
      peak = Math.max(peak, Math.abs(d[i]));
    }
    const g = peak > 0 ? 0.98 / peak : 1;
    for (let i = 0; i < n; i++) d[i] *= g;
  }
  noiseCache.set(key, buf);
  return buf;
}

/**
 * t60: decay time; pre: pre-delay; damp: how fast the highs die; early: number of discrete early
 * reflections, spread over `spread` × 48 ms; bright: high-frequency content of the tail.
 */
const IR_SPECS: Record<ReverbKind, { t60: number; pre: number; damp: number; early: number; bright: number; spread: number; seed: number }> = {
  room: { t60: 0.55, pre: 0.004, damp: 0.5, early: 5, bright: 0.7, spread: 0.6, seed: 11 },
  hall: { t60: 1.7, pre: 0.012, damp: 0.6, early: 7, bright: 0.55, spread: 1, seed: 23 },
  far: { t60: 1.25, pre: 0.02, damp: 0.8, early: 6, bright: 0.35, spread: 1, seed: 37 },
  corridor: { t60: 0.42, pre: 0.003, damp: 0.45, early: 9, bright: 0.62, spread: 0.75, seed: 53 },
  street: { t60: 1.9, pre: 0.03, damp: 0.9, early: 5, bright: 0.3, spread: 2.6, seed: 71 },
};

/**
 * Generated stereo impulse response: a few early reflections followed by a diffuse
 * tail whose high frequencies die faster than the lows.
 *  room: small tiled lab room   hall: jingles and fanfares   far: shared send for distant world sounds
 *  corridor: hard, close walls (gunfire indoors)   street: open air between façades (gunfire outdoors)
 */
export function impulseResponse(ctx: BaseAudioContext, kind: ReverbKind): AudioBuffer {
  const sr = ctx.sampleRate;
  const key = `${kind}@${sr}`;
  const cached = irCache.get(key);
  if (cached) return cached;
  const spec = IR_SPECS[kind];
  const n = Math.floor(sr * (spec.t60 * 1.15 + spec.pre));
  const buf = makeBuffer(ctx, 2, n, sr);
  const rnd = mulberry32(spec.seed);
  const preN = Math.floor(spec.pre * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // Diffuse tail: noise × exponential decay, through a one-pole low-pass that closes with time.
    let lp = 0;
    const k = Math.log(1000) / (spec.t60 * sr);
    for (let i = preN; i < n; i++) {
      const t = (i - preN) / sr;
      const env = Math.exp(-k * (i - preN)) * Math.min(1, t / 0.006);
      const w = (rnd() * 2 - 1) * env;
      // Cut-off falls from "bright" to dark over the tail.
      const a = Math.min(0.99, 1 - spec.bright * Math.exp((-t / spec.t60) * 3 * spec.damp) * 0.9 - 0.04);
      lp = lp * a + w * (1 - a);
      d[i] = lp;
    }
    // Early reflections.
    for (let e = 0; e < spec.early; e++) {
      const t = spec.pre + (0.003 + rnd() * 0.045) * spec.spread;
      const i = Math.floor(t * sr);
      const g = (0.5 + rnd() * 0.4) * (e % 2 === ch ? 1 : 0.55) * (rnd() < 0.5 ? -1 : 1);
      if (i < n) d[i] += g * 0.35;
      if (i + 1 < n) d[i + 1] += g * 0.18;
    }
    // Fade the very end so the response does not stop on a step.
    const fade = Math.min(n, Math.floor(sr * 0.03));
    for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
  }
  irCache.set(key, buf);
  return buf;
}

/** tanh saturation curve defined over the input range [-range, range] (the node clamps beyond). */
export function saturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = drive.toFixed(2);
  const cached = curveCache.get(key);
  if (cached) return cached;
  const n = 2049;
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  curveCache.set(key, c);
  return c;
}

export interface BurstOpts {
  /** Start, seconds after the beginning of the sound. */
  at?: number;
  color?: NoiseColor;
  /** Playback rate of the noise (below 1 = pitched-down, grainy noise). */
  rate?: number;
  type?: 'lowpass' | 'highpass' | 'bandpass' | 'none';
  freq?: number;
  /** Filter frequency reached at the end of the burst (exponential sweep). */
  freqEnd?: number;
  /** Fraction of the burst over which the sweep happens (default 1). */
  sweep?: number;
  q?: number;
  attack?: number;
  decay: number;
  gain: number;
  to?: AudioNode;
}

export interface ToneOpts {
  at?: number;
  type?: OscillatorType;
  freq: number;
  /** Frequency reached after `sweep` seconds (exponential glide). */
  freqEnd?: number;
  sweep?: number;
  attack?: number;
  /** Time spent at full level between attack and decay. */
  hold?: number;
  decay: number;
  gain: number;
  /** Vibrato: [rate Hz, depth in cents]. */
  vibrato?: [number, number];
  detune?: number;
  to?: AudioNode;
}

export interface PartialsOpts {
  at?: number;
  /** Fundamental the ratios are multiplied by. */
  base: number;
  ratios: readonly number[];
  /** Per-partial gain (default 1/(index+1)). */
  gains?: readonly number[];
  /** Decay of the first partial; higher partials decay faster (÷ ratio^damp). */
  decay: number;
  damp?: number;
  attack?: number;
  gain: number;
  type?: OscillatorType;
  to?: AudioNode;
}

export class Kit {
  readonly sr: number;

  constructor(
    readonly ctx: BaseAudioContext,
    /** Destination of the sound being built. */
    readonly out: AudioNode,
    /** Context time at which the sound starts. */
    readonly t0: number,
    readonly rng: Rng,
    /** Channel count of the render (1 = mono: stereo placement is skipped). */
    readonly channels: number,
  ) {
    this.sr = ctx.sampleRate;
  }

  // --- Random helpers -------------------------------------------------------------

  rand(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rng();
  }

  /** `v` multiplied by a random factor in [1 - f, 1 + f]. */
  vary(v: number, f = 0.06): number {
    return v * (1 + (this.rng() * 2 - 1) * f);
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.min(list.length - 1, Math.floor(this.rng() * list.length))];
  }

  // --- Nodes ----------------------------------------------------------------------

  gain(value = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(freq, this.sr * 0.49);
    f.Q.value = q;
    f.gain.value = gainDb;
    return f;
  }

  lp(freq: number, q = 0.707): BiquadFilterNode {
    return this.filter('lowpass', freq, q);
  }

  hp(freq: number, q = 0.707): BiquadFilterNode {
    return this.filter('highpass', freq, q);
  }

  bp(freq: number, q = 1): BiquadFilterNode {
    return this.filter('bandpass', freq, q);
  }

  /** Soft saturation (tanh). Keep the input roughly within ±1.5. */
  drive(amount: number): WaveShaperNode {
    const w = this.ctx.createWaveShaper();
    w.curve = saturationCurve(amount);
    return w;
  }

  /** Stereo placement, -1 (left) … 1 (right). A plain pass-through in mono renders. */
  pan(p: number): AudioNode {
    if (this.channels < 2 || typeof this.ctx.createStereoPanner !== 'function') return this.gain(1);
    const n = this.ctx.createStereoPanner();
    n.pan.value = Math.max(-1, Math.min(1, p));
    return n;
  }

  delay(seconds: number): DelayNode {
    const d = this.ctx.createDelay(Math.max(0.05, seconds + 0.01));
    d.delayTime.value = seconds;
    return d;
  }

  /** Convolution reverb with a generated impulse response; returns the wet output of `input`. */
  reverb(input: AudioNode, kind: ReverbKind, wet: number, to: AudioNode = this.out): GainNode {
    const conv = this.ctx.createConvolver();
    conv.buffer = impulseResponse(this.ctx, kind);
    const g = this.gain(wet);
    input.connect(conv);
    conv.connect(g);
    g.connect(to);
    return g;
  }

  /** Connect nodes in series and return the last one. */
  chain(...nodes: AudioNode[]): AudioNode {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[nodes.length - 1];
  }

  // --- Sources --------------------------------------------------------------------

  noise(color: NoiseColor, at: number, dur: number, rate = 1): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    const buf = noiseBuffer(this.ctx, color);
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = rate;
    const t = this.t0 + Math.max(0, at);
    src.start(t, this.rng() * (buf.duration - 0.05));
    src.stop(t + dur);
    return src;
  }

  osc(type: OscillatorType, freq: number, at: number, dur: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const t = this.t0 + Math.max(0, at);
    o.start(t);
    o.stop(t + dur);
    return o;
  }

  // --- Envelopes ------------------------------------------------------------------

  /** Percussive envelope: linear attack to `peak`, exponential fall of 60 dB over `decay`. */
  perc(p: AudioParam, at: number, peak: number, attack: number, decay: number, hold = 0): void {
    const t = this.t0 + Math.max(0, at);
    if (peak <= 0) return;
    if (attack > 0) {
      p.setValueAtTime(0, t);
      p.linearRampToValueAtTime(peak, t + attack);
    } else {
      p.setValueAtTime(peak, t);
    }
    if (hold > 0) p.setValueAtTime(peak, t + attack + hold);
    const end = t + attack + hold + Math.max(0.002, decay);
    p.exponentialRampToValueAtTime(peak * 0.001, end);
    p.linearRampToValueAtTime(0, end + 0.003);
  }

  /** Smooth bell-shaped envelope (raised cosine rise, hold, raised cosine fall). */
  swell(p: AudioParam, at: number, peak: number, rise: number, hold: number, fall: number): void {
    const t = this.t0 + Math.max(0, at);
    const steps = 24;
    const up = new Float32Array(steps);
    const down = new Float32Array(steps);
    for (let i = 0; i < steps; i++) {
      const x = i / (steps - 1);
      up[i] = peak * (0.5 - 0.5 * Math.cos(Math.PI * x));
      down[i] = peak * (0.5 + 0.5 * Math.cos(Math.PI * x));
    }
    p.setValueAtTime(0, t);
    p.setValueCurveAtTime(up, t, Math.max(0.002, rise));
    p.setValueAtTime(peak, t + rise + 0.0001);
    p.setValueCurveAtTime(down, t + rise + hold + 0.0002, Math.max(0.002, fall));
    p.setValueAtTime(0, t + rise + hold + fall + 0.0005);
  }

  /** Glide a parameter from `from` to `to` (exponential when both are positive). */
  glide(p: AudioParam, at: number, from: number, to: number, dur: number): void {
    const t = this.t0 + Math.max(0, at);
    p.setValueAtTime(from, t);
    if (from > 0 && to > 0) p.exponentialRampToValueAtTime(to, t + Math.max(0.001, dur));
    else p.linearRampToValueAtTime(to, t + Math.max(0.001, dur));
  }

  // --- Building blocks ------------------------------------------------------------

  /** Filtered noise burst with a percussive envelope. */
  burst(o: BurstOpts): void {
    const at = o.at ?? 0;
    const attack = o.attack ?? 0.0005;
    const src = this.noise(o.color ?? 'white', at, attack + o.decay + 0.01, o.rate ?? 1);
    const env = this.gain(0);
    this.perc(env.gain, at, o.gain, attack, o.decay);
    const type = o.type ?? 'bandpass';
    if (type === 'none') {
      src.connect(env);
    } else {
      const f = this.filter(type, o.freq ?? 1000, o.q ?? (type === 'bandpass' ? 1 : 0.707));
      if (o.freqEnd !== undefined && o.freq !== undefined) {
        this.glide(f.frequency, at, Math.min(o.freq, this.sr * 0.49), Math.min(o.freqEnd, this.sr * 0.49), (attack + o.decay) * (o.sweep ?? 1));
      }
      src.connect(f);
      f.connect(env);
    }
    env.connect(o.to ?? this.out);
  }

  /** Oscillator blip with optional pitch glide and vibrato. */
  tone(o: ToneOpts): void {
    const at = o.at ?? 0;
    const attack = o.attack ?? 0.001;
    const hold = o.hold ?? 0;
    const osc = this.osc(o.type ?? 'sine', o.freq, at, attack + hold + o.decay + 0.01);
    if (o.detune) osc.detune.value = o.detune;
    if (o.freqEnd !== undefined) this.glide(osc.frequency, at, o.freq, o.freqEnd, o.sweep ?? o.decay);
    if (o.vibrato) {
      const lfo = this.osc('sine', o.vibrato[0], at, attack + hold + o.decay + 0.01);
      const depth = this.gain(o.vibrato[1]);
      lfo.connect(depth);
      depth.connect(osc.detune);
    }
    const env = this.gain(0);
    this.perc(env.gain, at, o.gain, attack, o.decay, hold);
    osc.connect(env);
    env.connect(o.to ?? this.out);
  }

  /** Sum of decaying partials: bells, metal rings, glass. */
  partials(o: PartialsOpts): void {
    const damp = o.damp ?? 0.6;
    for (let i = 0; i < o.ratios.length; i++) {
      const r = o.ratios[i];
      const f = o.base * r;
      if (f > this.sr * 0.45) continue;
      this.tone({
        at: o.at,
        type: o.type ?? 'sine',
        freq: f,
        attack: o.attack ?? 0.0008,
        decay: Math.max(0.01, o.decay / Math.pow(Math.max(1, r), damp)),
        gain: o.gain * (o.gains ? (o.gains[i] ?? 0) : 1 / (i + 1)),
        to: o.to,
      });
    }
  }
}
