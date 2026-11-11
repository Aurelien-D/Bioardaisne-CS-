/**
 * Sound bank: catalogue of synthesis recipes and their rendering into AudioBuffers.
 *
 * Every recipe is rendered once per variant through an OfflineAudioContext (all the
 * variants of a recipe share one context, laid out one after the other), then
 * cleaned in JavaScript: offset removal, trailing-silence trim, click-free fade-out
 * and peak normalisation. Playback afterwards only costs an AudioBufferSourceNode.
 */
import { hash3, mulberry32 } from '../../shared/math/rng';
import { Kit, makeBuffer } from './kit';

export type SoundGroup =
  | 'shot'
  | 'mech'
  | 'step'
  | 'impact'
  | 'feedback'
  | 'ui'
  | 'objective'
  | 'jingle'
  | 'ambience'
  | 'music';

export interface SoundDef {
  name: string;
  group: SoundGroup;
  /** French label shown on the dev sound board. */
  label: string;
  /** Render window in seconds: the sound must have died out by then. */
  dur: number;
  channels: 1 | 2;
  variants: number;
  /** Peak level the rendered buffer is normalised to. */
  peak: number;
  /**
   * Seamless loop: the render is `length + overlap` seconds long and the extra part is
   * cross-faded ('xfade', for steady textures) or added ('fold', for music whose notes
   * ring across the loop point) into the beginning.
   */
  loop?: { length: number; overlap: number; mode: 'xfade' | 'fold' };
  build(k: Kit, variant: number): void;
}

const registry = new Map<string, SoundDef>();

export function defineSound(def: SoundDef): void {
  registry.set(def.name, def);
}

export function getSound(name: string): SoundDef | undefined {
  return registry.get(name);
}

export function allSounds(): SoundDef[] {
  return [...registry.values()];
}

type OfflineCtor = new (channels: number, length: number, sampleRate: number) => OfflineAudioContext;

function offlineCtor(): OfflineCtor | null {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

export function offlineSupported(): boolean {
  return offlineCtor() !== null;
}

export function createOffline(channels: number, length: number, sampleRate: number): OfflineAudioContext {
  const Ctor = offlineCtor();
  if (!Ctor) throw new Error('OfflineAudioContext unavailable');
  return new Ctor(channels, Math.max(1, length), sampleRate);
}

/** startRendering() with support for the legacy callback form. */
export function startRendering(ctx: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise<AudioBuffer>((resolve, reject) => {
    let done = false;
    ctx.oncomplete = (ev) => {
      if (!done) {
        done = true;
        resolve(ev.renderedBuffer);
      }
    };
    try {
      const p = ctx.startRendering() as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') {
        p.then(
          (buf) => {
            if (!done) {
              done = true;
              resolve(buf);
            }
          },
          (err) => reject(err),
        );
      }
    } catch (err) {
      reject(err);
    }
  });
}

const GAP = 0.06;
const FADE_OUT = 0.006;

function seedOf(name: string, variant: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return hash3(h, variant, 0x5eed);
}

/** Render every variant of a recipe. */
export async function renderDef(def: SoundDef, sampleRate: number): Promise<AudioBuffer[]> {
  const extra = def.loop ? def.loop.overlap : 0;
  const slotSec = (def.loop ? def.loop.length : def.dur) + extra;
  const slot = Math.ceil((slotSec + GAP) * sampleRate);
  const ctx = createOffline(def.channels, slot * def.variants, sampleRate);
  for (let v = 0; v < def.variants; v++) {
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(ctx.destination);
    const kit = new Kit(ctx, out, (v * slot) / sampleRate, mulberry32(seedOf(def.name, v)), def.channels);
    def.build(kit, v);
  }
  const rendered = await startRendering(ctx);
  const buffers: AudioBuffer[] = [];
  const slotLen = Math.floor(slotSec * sampleRate);
  for (let v = 0; v < def.variants; v++) {
    const chans: Float32Array[] = [];
    for (let c = 0; c < def.channels; c++) {
      chans.push(rendered.getChannelData(c).slice(v * slot, v * slot + slotLen));
    }
    buffers.push(def.loop ? finishLoop(ctx, def, chans, sampleRate) : finishOneShot(ctx, def, chans, sampleRate));
  }
  return buffers;
}

function removeOffset(chans: Float32Array[], sampleRate: number): void {
  // One-pole high-pass at 12 Hz: removes DC without touching the low thumps.
  const a = 1 / (1 + (2 * Math.PI * 12) / sampleRate);
  for (const d of chans) {
    let y = 0;
    let x1 = 0;
    for (let i = 0; i < d.length; i++) {
      const x = d[i];
      y = a * (y + x - x1);
      x1 = x;
      d[i] = y;
    }
  }
}

function peakOf(chans: Float32Array[], length = chans[0].length): number {
  let peak = 0;
  for (const d of chans) {
    for (let i = 0; i < length; i++) {
      const v = d[i] < 0 ? -d[i] : d[i];
      if (v > peak) peak = v;
    }
  }
  return peak;
}

function finishOneShot(ctx: BaseAudioContext, def: SoundDef, chans: Float32Array[], sampleRate: number): AudioBuffer {
  removeOffset(chans, sampleRate);
  const peak = peakOf(chans);
  const n = chans[0].length;
  // Trim the silence at the end (below -72 dB of the peak).
  const floor = peak * 0.00025;
  let last = 0;
  for (const d of chans) {
    for (let i = n - 1; i > last; i--) {
      if (d[i] > floor || d[i] < -floor) {
        last = i;
        break;
      }
    }
  }
  const fade = Math.floor(FADE_OUT * sampleRate);
  const length = Math.min(n, Math.max(last + fade, Math.floor(0.01 * sampleRate)));
  const g = peak > 1e-9 ? def.peak / peak : 0;
  const buf = makeBuffer(ctx, def.channels, length, sampleRate);
  for (let c = 0; c < def.channels; c++) {
    const src = chans[c];
    const dst = buf.getChannelData(c);
    for (let i = 0; i < length; i++) dst[i] = src[i] * g;
    for (let i = 0; i < fade && i < length; i++) {
      const w = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade);
      dst[length - 1 - i] *= w;
    }
  }
  return buf;
}

function finishLoop(ctx: BaseAudioContext, def: SoundDef, chans: Float32Array[], sampleRate: number): AudioBuffer {
  const loop = def.loop!;
  const length = Math.floor(loop.length * sampleRate);
  const overlap = Math.min(Math.floor(loop.overlap * sampleRate), chans[0].length - length);
  removeOffset(chans, sampleRate);
  const buf = makeBuffer(ctx, def.channels, length, sampleRate);
  const out: Float32Array[] = [];
  for (let c = 0; c < def.channels; c++) {
    const src = chans[c];
    const dst = buf.getChannelData(c);
    dst.set(src.subarray(0, length));
    if (loop.mode === 'fold') {
      // What rings after the last bar is what you hear under the first one.
      for (let i = 0; i < overlap; i++) dst[i] += src[length + i];
    } else {
      // Equal-power cross-fade of the continuation into the head.
      for (let i = 0; i < overlap; i++) {
        const x = i / overlap;
        const a = Math.sin(x * Math.PI * 0.5);
        const b = Math.cos(x * Math.PI * 0.5);
        dst[i] = src[i] * a + src[length + i] * b;
      }
    }
    out.push(dst);
  }
  const peak = peakOf(out);
  const g = peak > 1e-9 ? def.peak / peak : 0;
  for (const d of out) for (let i = 0; i < d.length; i++) d[i] *= g;
  return buf;
}

/**
 * Lazy cache of rendered buffers. `get` never blocks: it returns the buffers when
 * they exist and otherwise starts (or prioritises) the render.
 */
export class Bank {
  private readonly ready = new Map<string, AudioBuffer[]>();
  private readonly pending = new Map<string, Promise<AudioBuffer[]>>();
  private readonly failed = new Set<string>();
  private queue: string[] = [];
  private running = 0;
  private disposed = false;

  constructor(
    readonly sampleRate: number,
    /** Renders allowed at the same time. */
    private readonly concurrency = 2,
  ) {}

  /** Buffers of a sound, or null while it is not rendered yet (the render is started). */
  get(name: string): AudioBuffer[] | null {
    const b = this.ready.get(name);
    if (b) return b;
    this.load(name, true);
    return null;
  }

  has(name: string): boolean {
    return this.ready.has(name);
  }

  /** Render (or wait for) a sound. Urgent requests jump the prewarm queue. */
  load(name: string, urgent = false): Promise<AudioBuffer[]> {
    const b = this.ready.get(name);
    if (b) return Promise.resolve(b);
    const p = this.pending.get(name);
    if (p) {
      if (urgent) this.bump(name);
      return p;
    }
    const def = registry.get(name);
    if (!def || this.failed.has(name) || this.disposed || !offlineSupported()) {
      return Promise.reject(new Error(`sound unavailable: ${name}`));
    }
    let resolve!: (b: AudioBuffer[]) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<AudioBuffer[]>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Callers that only prewarm never look at the promise.
    promise.catch(() => undefined);
    this.pending.set(name, promise);
    this.resolvers.set(name, { resolve, reject });
    if (urgent) this.queue.unshift(name);
    else this.queue.push(name);
    this.pump();
    return promise;
  }

  private readonly resolvers = new Map<string, { resolve: (b: AudioBuffer[]) => void; reject: (e: unknown) => void }>();

  /** Queue background renders, in the given order. */
  prewarm(names: readonly string[]): void {
    for (const n of names) {
      if (!this.ready.has(n) && !this.pending.has(n)) void this.load(n, false);
    }
  }

  /** Fraction of the catalogue already rendered (for diagnostics). */
  progress(): number {
    return registry.size > 0 ? this.ready.size / registry.size : 1;
  }

  dispose(): void {
    this.disposed = true;
    this.queue = [];
    this.ready.clear();
  }

  private bump(name: string): void {
    const i = this.queue.indexOf(name);
    if (i > 0) {
      this.queue.splice(i, 1);
      this.queue.unshift(name);
    }
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0) {
      const name = this.queue.shift()!;
      const def = registry.get(name);
      const res = this.resolvers.get(name);
      if (!def || !res) continue;
      this.running++;
      renderDef(def, this.sampleRate)
        .then(
          (buffers) => {
            if (!this.disposed) this.ready.set(name, buffers);
            res.resolve(buffers);
          },
          (err) => {
            this.failed.add(name);
            res.reject(err);
          },
        )
        .finally(() => {
          this.running--;
          this.pending.delete(name);
          this.resolvers.delete(name);
          this.pump();
        });
    }
  }
}
