/**
 * Master output stage, shared by the live engine and the offline analysis of the
 * dev harness:  input (master volume) → bus compressor → make-up trim → soft clipper.
 *
 * The compressor glues the mix (gunfire pushes the ambience down a little); the
 * clipper is the safety net: whatever comes in, the output never exceeds CEILING.
 */
import { createOffline, offlineSupported, startRendering } from './bank';

export const CEILING = 0.97;
const KNEE = 0.72;
/** Input range covered by the clipper curve (inputs beyond are held at the ceiling). */
const CLIP_RANGE = 4;

export const COMPRESSOR = { threshold: -5, knee: 5, ratio: 12, attack: 0.002, release: 0.13 } as const;

/**
 * Browsers add an automatic make-up gain to DynamicsCompressorNode. This is the gain
 * measured in Chromium for the settings above; calibrateCompressor() replaces it with
 * the value measured in the running browser.
 */
const DEFAULT_MAKEUP = 2.45;

let clipCurve: Float32Array<ArrayBuffer> | null = null;

/** Transparent below KNEE, then a smooth bend towards CEILING. */
export function softClip(x: number): number {
  const a = x < 0 ? -x : x;
  if (a <= KNEE) return x;
  const span = CEILING - KNEE;
  const y = KNEE + span * Math.tanh((a - KNEE) / span);
  return x < 0 ? -y : y;
}

function clipperCurve(): Float32Array<ArrayBuffer> {
  if (clipCurve) return clipCurve;
  const n = 16385;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = softClip(((i / (n - 1)) * 2 - 1) * CLIP_RANGE);
  clipCurve = c;
  return c;
}

export interface MasterChain {
  /** Connect the buses here; its gain is the master volume. */
  input: GainNode;
  compressor: DynamicsCompressorNode;
  /** Compensates the compressor's automatic make-up gain. */
  trim: GainNode;
}

function configure(comp: DynamicsCompressorNode): void {
  comp.threshold.value = COMPRESSOR.threshold;
  comp.knee.value = COMPRESSOR.knee;
  comp.ratio.value = COMPRESSOR.ratio;
  comp.attack.value = COMPRESSOR.attack;
  comp.release.value = COMPRESSOR.release;
}

export function createMasterChain(ctx: BaseAudioContext, destination: AudioNode, makeup = DEFAULT_MAKEUP): MasterChain {
  const input = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  configure(compressor);
  const trim = ctx.createGain();
  trim.gain.value = 1 / makeup;
  const pre = ctx.createGain();
  pre.gain.value = 1 / CLIP_RANGE;
  const clipper = ctx.createWaveShaper();
  clipper.curve = clipperCurve();
  input.connect(compressor);
  compressor.connect(trim);
  trim.connect(pre);
  pre.connect(clipper);
  clipper.connect(destination);
  return { input, compressor, trim };
}

let calibration: Promise<number> | null = null;

/**
 * Measure the compressor's automatic make-up gain in this browser: a quiet sine
 * (far below the threshold) is rendered through the node and its level compared.
 */
export function calibrateCompressor(): Promise<number> {
  if (calibration) return calibration;
  calibration = (async () => {
    if (!offlineSupported()) return DEFAULT_MAKEUP;
    try {
      const sr = 44100;
      const ctx = createOffline(1, Math.floor(sr * 0.25), sr);
      const osc = ctx.createOscillator();
      osc.frequency.value = 1000;
      const level = ctx.createGain();
      level.gain.value = 0.01;
      const comp = ctx.createDynamicsCompressor();
      configure(comp);
      osc.connect(level);
      level.connect(comp);
      comp.connect(ctx.destination);
      osc.start(0);
      const buf = await startRendering(ctx);
      const d = buf.getChannelData(0);
      let peak = 0;
      for (let i = Math.floor(d.length * 0.5); i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
      const makeup = peak / 0.01;
      return makeup > 0.5 && makeup < 8 ? makeup : DEFAULT_MAKEUP;
    } catch {
      return DEFAULT_MAKEUP;
    }
  })();
  return calibration;
}
