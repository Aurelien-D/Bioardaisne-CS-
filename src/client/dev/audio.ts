/**
 * Audio test bench (dev/audio.html): a sound board driving the real engine through
 * the IAudio contract, a scope (waveform + spectrogram of any rendered sound) and an
 * automated analysis of the whole catalogue.
 *
 * Automation (Playwright): `await window.__audio.ready`, then
 *   analyse({ variants?, groups? })  → Record<name, { duration, peak, rms, centroidHz, … }>
 *       every sound is rendered through an OfflineAudioContext, passed through the
 *       emulated master stage (compressor + clipper) and measured:
 *       duration  seconds between the first and last sample above -60 dB of the peak
 *       peak      absolute peak after the master stage      rawPeak  before it
 *       rms       RMS level over that duration (linear)
 *       centroidHz  magnitude-weighted spectral centroid
 *       attackMs  time from 5 % to 90 % of the peak        dc  mean / peak
 *       endDb     level of the last 3 ms relative to the peak (click check)
 *       seam      loops only: step at the loop point relative to the typical sample step
 *       flags     problems found by the automatic checks
 *   waveform(name, variant?)   draws the waveform + spectrogram on the scope canvas
 *   gallery(names, columns?)   draws several of them in a grid (#gallery) for screenshots
 *   envelope(name, variant?, ms?, count?)  peak per window in dB, for attack / decay checks
 *   masterGain()               gain of the emulated master stage for a quiet signal (≈ 1)
 */
import type { FeedbackSound, UiSound } from '../core/contracts';
import { SettingsStore } from '../core/settings';
import { ANNOUNCE } from '../../shared/identity';
import type { SurfaceType } from '../../shared/maps/materials';
import type { Vec3 } from '../../shared/math/vec3';
import { WEAPONS, type WeaponId } from '../../shared/weapons/defs';
import {
  AudioEngine,
  CEILING,
  allSounds,
  calibrateCompressor,
  createMasterChain,
  createOffline,
  getSound,
  renderDef,
  startRendering,
} from '../audio';

const SAMPLE_RATE = 48000;

interface Metrics {
  group: string;
  duration: number;
  peak: number;
  rms: number;
  centroidHz: number;
  rawPeak: number;
  /** Attack measured after the master stage / on the raw render. */
  attackMs: number;
  rawAttackMs: number;
  dc: number;
  endDb: number;
  seam?: number;
  flags: string[];
}

interface AudioHarness {
  ready: Promise<void>;
  engine: AudioEngine;
  names(): string[];
  analyse(opts?: { variants?: boolean; groups?: string[] }): Promise<Record<string, Metrics>>;
  waveform(name: string, variant?: number, canvas?: HTMLCanvasElement): Promise<void>;
  gallery(names: string[], columns?: number): Promise<void>;
  hideGallery(): void;
  envelope(name: string, variant?: number, ms?: number, count?: number): Promise<number[]>;
  masterGain(): Promise<number>;
  /** Automatic make-up gain of the browser's compressor, as measured by the engine. */
  makeup(): Promise<number>;
}

declare global {
  interface Window {
    __audio: AudioHarness;
  }
}

// =================================================================================
// Rendering and measuring
// =================================================================================

const renders = new Map<string, Promise<AudioBuffer[]>>();

function rendered(name: string): Promise<AudioBuffer[]> {
  let p = renders.get(name);
  if (!p) {
    const def = getSound(name);
    if (!def) return Promise.reject(new Error(`Son inconnu : ${name}`));
    p = renderDef(def, SAMPLE_RATE);
    renders.set(name, p);
  }
  return p;
}

/**
 * Pass a buffer through the emulated master stage (compressor + clipper at unity volume).
 * The sound starts after a short pre-roll: a freshly created compressor needs a few
 * tens of milliseconds to settle, which never happens in the live engine.
 */
const PRE_ROLL = 0.3;

async function throughMaster(buf: AudioBuffer): Promise<Float32Array[]> {
  const makeup = await calibrateCompressor();
  const lead = Math.floor(SAMPLE_RATE * PRE_ROLL);
  const ctx = createOffline(buf.numberOfChannels, lead + buf.length + Math.floor(SAMPLE_RATE * 0.06), SAMPLE_RATE);
  const chain = createMasterChain(ctx, ctx.destination, makeup);
  chain.input.gain.value = 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(chain.input);
  src.start(lead / SAMPLE_RATE);
  const out = await startRendering(ctx);
  const chans: Float32Array[] = [];
  for (let c = 0; c < out.numberOfChannels; c++) chans.push(out.getChannelData(c).subarray(lead));
  return chans;
}

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function monoOf(chans: Float32Array[]): Float32Array {
  if (chans.length === 1) return chans[0];
  const n = chans[0].length;
  const m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = (chans[0][i] + chans[1][i]) * 0.5;
  return m;
}

function peakOf(chans: Float32Array[]): number {
  let p = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) p = Math.max(p, Math.abs(d[i]));
  return p;
}

/** Magnitude spectrum frames (Hann window of `win` samples, zero-padded FFT of `size`). */
function spectra(x: Float32Array, win: number, size: number, hop: number): Float32Array[] {
  const frames: Float32Array[] = [];
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const w = new Float32Array(win);
  for (let i = 0; i < win; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1));
  for (let start = -win / 2; start < x.length; start += hop) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < win; i++) {
      const k = start + i;
      if (k >= 0 && k < x.length) re[i] = x[k] * w[i];
    }
    fft(re, im);
    const mag = new Float32Array(size / 2);
    for (let i = 0; i < size / 2; i++) mag[i] = Math.hypot(re[i], im[i]);
    frames.push(mag);
  }
  return frames;
}

function measure(group: string, raw: AudioBuffer, post: Float32Array[], loop: boolean): Metrics {
  const sr = SAMPLE_RATE;
  const rawChans: Float32Array[] = [];
  for (let c = 0; c < raw.numberOfChannels; c++) rawChans.push(raw.getChannelData(c));
  const rawPeak = peakOf(rawChans);
  const peak = peakOf(post);
  const mono = monoOf(post);
  const n = mono.length;
  const floor = peak * 0.001;
  let first = 0;
  let last = n - 1;
  const loud = (i: number): boolean => post.some((d) => Math.abs(d[i]) > floor);
  while (first < n && !loud(first)) first++;
  while (last > first && !loud(last)) last--;
  const duration = Math.max(0, (last - first + 1) / sr);
  let sum = 0;
  let mean = 0;
  for (let i = first; i <= last; i++) {
    for (const d of post) sum += d[i] * d[i];
    mean += mono[i];
  }
  const count = Math.max(1, last - first + 1);
  const rms = Math.sqrt(sum / (count * post.length));
  mean /= count;
  // Attack: 5 % → 90 % of the peak.
  let a5 = first;
  while (a5 < n && !post.some((d) => Math.abs(d[a5]) >= peak * 0.05)) a5++;
  let a90 = a5;
  while (a90 < n && !post.some((d) => Math.abs(d[a90]) >= peak * 0.9)) a90++;
  const attackMs = ((a90 - a5) / sr) * 1000;
  let r5 = 0;
  while (r5 < raw.length && !rawChans.some((d) => Math.abs(d[r5]) >= rawPeak * 0.05)) r5++;
  let r90 = r5;
  while (r90 < raw.length && !rawChans.some((d) => Math.abs(d[r90]) >= rawPeak * 0.9)) r90++;
  const rawAttackMs = ((r90 - r5) / sr) * 1000;
  // Spectral centroid of the accumulated magnitude spectrum.
  const size = 2048;
  const frames = spectra(mono.subarray(first, last + 1), 1024, size, 512);
  const acc = new Float64Array(size / 2);
  for (const f of frames) for (let i = 0; i < f.length; i++) acc[i] += f[i];
  let num = 0;
  let den = 0;
  for (let i = 1; i < acc.length; i++) {
    num += ((i * sr) / size) * acc[i];
    den += acc[i];
  }
  const centroidHz = den > 0 ? num / den : 0;
  // Level at the very end of the raw buffer (a click would show here).
  const rawMono = monoOf(rawChans);
  const tail = Math.min(rawMono.length, Math.floor(sr * 0.003));
  let endPeak = 0;
  for (let i = rawMono.length - tail; i < rawMono.length; i++) endPeak = Math.max(endPeak, Math.abs(rawMono[i]));
  const endDb = 20 * Math.log10(Math.max(1e-9, endPeak / Math.max(1e-9, rawPeak)));

  const m: Metrics = { group, duration, peak, rms, centroidHz, rawPeak, attackMs, rawAttackMs, dc: peak > 0 ? mean / peak : 0, endDb, flags: [] };
  if (loop) {
    // Step across the loop point compared with the typical step between neighbours.
    let typical = 0;
    for (let i = 1; i < rawMono.length; i++) typical += Math.abs(rawMono[i] - rawMono[i - 1]);
    typical /= rawMono.length - 1;
    m.seam = typical > 0 ? Math.abs(rawMono[0] - rawMono[rawMono.length - 1]) / typical : 0;
    if (m.seam > 6) m.flags.push('raccord');
  } else if (endDb > -40) {
    m.flags.push('fin abrupte');
  }
  if (peak < 0.01) m.flags.push('silencieux');
  if (peak > 0.98) m.flags.push('saturation');
  if (Math.abs(m.dc) > 0.02 && !loop) m.flags.push('composante continue');
  return m;
}

async function analyseOne(name: string, variant: number): Promise<Metrics> {
  const def = getSound(name)!;
  const buffers = await rendered(name);
  const raw = buffers[Math.min(variant, buffers.length - 1)];
  const post = await throughMaster(raw);
  return measure(def.group, raw, post, !!def.loop);
}

async function analyse(opts: { variants?: boolean; groups?: string[] } = {}): Promise<Record<string, Metrics>> {
  const result: Record<string, Metrics> = {};
  for (const def of allSounds()) {
    if (opts.groups && !opts.groups.includes(def.group)) continue;
    const count = opts.variants ? def.variants : 1;
    for (let v = 0; v < count; v++) {
      result[v === 0 ? def.name : `${def.name}#${v}`] = await analyseOne(def.name, v);
    }
  }
  showTable(result);
  return result;
}

async function envelope(name: string, variant = 0, ms = 1, count = 40): Promise<number[]> {
  const buffers = await rendered(name);
  const buf = buffers[Math.min(variant, buffers.length - 1)];
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const peak = peakOf(chans);
  const step = Math.max(1, Math.floor((SAMPLE_RATE * ms) / 1000));
  const out: number[] = [];
  for (let w = 0; w < count; w++) {
    let p = 0;
    for (const d of chans) for (let i = w * step; i < Math.min(d.length, (w + 1) * step); i++) p = Math.max(p, Math.abs(d[i]));
    out.push(Math.round(200 * Math.log10(Math.max(1e-6, p / peak))) / 10);
  }
  return out;
}

async function masterGain(): Promise<number> {
  const n = Math.floor(SAMPLE_RATE * 0.3);
  const buf = new AudioBuffer({ numberOfChannels: 1, length: n, sampleRate: SAMPLE_RATE });
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = 0.02 * Math.sin((2 * Math.PI * 1000 * i) / SAMPLE_RATE);
  const out = await throughMaster(buf);
  let p = 0;
  for (let i = Math.floor(n / 2); i < n; i++) p = Math.max(p, Math.abs(out[0][i]));
  return p / 0.02;
}

// =================================================================================
// Scope: waveform + spectrogram
// =================================================================================

const RAMP: [number, [number, number, number]][] = [
  [0, [3, 11, 21]],
  [0.3, [0, 63, 113]],
  [0.58, [49, 130, 206]],
  [0.8, [234, 246, 254]],
  [0.93, [255, 194, 74]],
  [1, [231, 52, 63]],
];

function colour(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const u = (x - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
    }
  }
  return RAMP[RAMP.length - 1][1];
}

function drawScope(canvas: HTMLCanvasElement, name: string, variant: number, buf: AudioBuffer, m: Metrics | null): void {
  const W = 940;
  const H = 660;
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#030b15';
  g.fillRect(0, 0, W, H);
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const mono = monoOf(chans);
  const n = mono.length;
  const peak = Math.max(1e-6, peakOf(chans));
  const padL = 46;
  const padR = 10;
  const plotW = W - padL - padR;
  const waveTop = 34;
  const waveH = 250;
  const specTop = waveTop + waveH + 26;
  const specH = H - specTop - 26;
  const dur = n / buf.sampleRate;

  // --- Waveform ---
  g.strokeStyle = 'rgba(140,190,240,0.16)';
  g.lineWidth = 1;
  g.strokeRect(padL + 0.5, waveTop + 0.5, plotW, waveH);
  const mid = waveTop + waveH / 2;
  g.beginPath();
  g.moveTo(padL, mid + 0.5);
  g.lineTo(padL + plotW, mid + 0.5);
  g.stroke();
  g.fillStyle = '#3d94e6';
  for (let x = 0; x < plotW; x++) {
    const a = Math.floor((x / plotW) * n);
    const b = Math.max(a + 1, Math.floor(((x + 1) / plotW) * n));
    let lo = 1;
    let hi = -1;
    for (let i = a; i < b && i < n; i++) {
      const v = mono[i] / peak;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const y0 = mid - hi * (waveH / 2 - 4);
    const y1 = mid - lo * (waveH / 2 - 4);
    g.fillRect(padL + x, y0, 1, Math.max(1, y1 - y0));
  }
  // Attack close-up: the first 12 ms, sample by sample.
  const zoomW = 230;
  const zoomH = 96;
  const zx = padL + plotW - zoomW - 8;
  const zy = waveTop + 8;
  g.fillStyle = 'rgba(3,11,21,0.9)';
  g.fillRect(zx, zy, zoomW, zoomH);
  g.strokeStyle = 'rgba(255,194,74,0.7)';
  g.strokeRect(zx + 0.5, zy + 0.5, zoomW, zoomH);
  const zoomN = Math.min(n, Math.floor(buf.sampleRate * 0.012));
  g.strokeStyle = '#ffc24a';
  g.beginPath();
  for (let i = 0; i < zoomN; i++) {
    const x = zx + (i / zoomN) * zoomW;
    const y = zy + zoomH / 2 - (mono[i] / peak) * (zoomH / 2 - 4);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.fillStyle = '#ffc24a';
  g.font = '11px ui-monospace, Consolas, monospace';
  g.fillText('attaque : 12 premières ms', zx + 6, zy + zoomH - 6);

  // --- Spectrogram (log frequency, 40 Hz – 20 kHz) ---
  const win = 512;
  const size = 2048;
  const hop = Math.max(16, Math.floor(n / plotW));
  const frames = spectra(mono, win, size, hop);
  let max = 1e-9;
  for (const f of frames) for (let i = 0; i < f.length; i++) if (f[i] > max) max = f[i];
  const img = g.createImageData(plotW, specH);
  const fLo = 40;
  const fHi = Math.min(20000, buf.sampleRate / 2);
  for (let x = 0; x < plotW; x++) {
    const f = frames[Math.min(frames.length - 1, Math.floor((x / plotW) * frames.length))];
    for (let y = 0; y < specH; y++) {
      const freq = fLo * Math.pow(fHi / fLo, 1 - y / (specH - 1));
      const bin = (freq * size) / buf.sampleRate;
      const b0 = Math.floor(bin);
      const u = bin - b0;
      const mag = (f[Math.min(f.length - 1, b0)] ?? 0) * (1 - u) + (f[Math.min(f.length - 1, b0 + 1)] ?? 0) * u;
      const db = 20 * Math.log10(Math.max(1e-9, mag / max));
      const [r, gg, b] = colour((db + 78) / 78);
      const o = (y * plotW + x) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, padL, specTop);
  g.strokeStyle = 'rgba(140,190,240,0.16)';
  g.strokeRect(padL + 0.5, specTop + 0.5, plotW, specH);

  // --- Axes and labels ---
  g.fillStyle = '#a9c0d8';
  g.font = '11px ui-monospace, Consolas, monospace';
  g.textAlign = 'right';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    if (f > fHi) continue;
    const y = specTop + (1 - Math.log(f / fLo) / Math.log(fHi / fLo)) * (specH - 1);
    g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, padL - 5, y + 4);
    g.fillStyle = 'rgba(255,255,255,0.07)';
    g.fillRect(padL, Math.round(y), plotW, 1);
    g.fillStyle = '#a9c0d8';
  }
  g.fillText('+1', padL - 5, waveTop + 12);
  g.fillText('0', padL - 5, mid + 4);
  g.fillText('−1', padL - 5, waveTop + waveH - 4);
  g.textAlign = 'center';
  const tick = dur > 8 ? 2 : dur > 3 ? 0.5 : dur > 1.2 ? 0.2 : dur > 0.5 ? 0.1 : dur > 0.2 ? 0.05 : 0.02;
  for (let t = 0; t <= dur + 1e-6; t += tick) {
    const x = padL + (t / dur) * plotW;
    g.fillStyle = 'rgba(255,255,255,0.09)';
    g.fillRect(Math.round(x), waveTop, 1, waveH);
    g.fillStyle = '#a9c0d8';
    const label = tick >= 1 ? `${t.toFixed(0)} s` : `${Math.round(t * 1000)} ms`;
    g.fillText(label, x, waveTop + waveH + 15);
    g.fillText(label, x, specTop + specH + 15);
  }
  g.textAlign = 'left';
  g.fillStyle = '#f3f8ff';
  g.font = '600 15px Inter, Segoe UI, system-ui, sans-serif';
  const def = getSound(name);
  g.fillText(`${name}${variant ? ` #${variant}` : ''}`, padL, 21);
  g.font = '12px ui-monospace, Consolas, monospace';
  g.fillStyle = '#a9c0d8';
  const info = m
    ? `${(m.duration * 1000).toFixed(0)} ms · crête ${m.peak.toFixed(2)} · centroïde ${m.centroidHz.toFixed(0)} Hz · attaque ${m.attackMs.toFixed(1)} ms`
    : `${(dur * 1000).toFixed(0)} ms`;
  g.textAlign = 'right';
  g.fillText(info, W - padR, 21);
  g.textAlign = 'left';
  if (def) {
    g.fillStyle = '#7089a3';
    g.fillText(def.label, padL + nameWidth(g, name, variant) + 10, 21);
  }
}

function nameWidth(g: CanvasRenderingContext2D, name: string, variant: number): number {
  g.save();
  g.font = '600 15px Inter, Segoe UI, system-ui, sans-serif';
  const w = g.measureText(`${name}${variant ? ` #${variant}` : ''}`).width;
  g.restore();
  return w;
}

let scopeCanvas: HTMLCanvasElement;

async function waveform(name: string, variant = 0, canvas: HTMLCanvasElement = scopeCanvas): Promise<void> {
  const buffers = await rendered(name);
  const v = Math.min(variant, buffers.length - 1);
  const m = await analyseOne(name, v);
  drawScope(canvas, name, v, buffers[v], m);
}

async function gallery(names: string[], columns = 4): Promise<void> {
  const root = document.getElementById('gallery')!;
  root.innerHTML = '';
  root.style.gridTemplateColumns = `repeat(${columns}, 470px)`;
  root.classList.add('show');
  for (const name of names) {
    const [n, v] = name.split('#');
    const c = document.createElement('canvas');
    root.appendChild(c);
    await waveform(n, v ? Number(v) : 0, c);
  }
}

// =================================================================================
// Sound board
// =================================================================================

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}

function button(label: string, action: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', cls ? { class: cls } : {}, label);
  b.addEventListener('click', action);
  return b;
}

function section(title: string, note = ''): HTMLElement {
  const s = el('section');
  const h = el('h2', {}, title);
  if (note) h.append(el('small', {}, note));
  s.append(h);
  return s;
}

function row(tag: string, ...children: Child[]): HTMLElement {
  const r = el('div', { class: 'row' });
  if (tag) r.append(el('span', { class: 'tag' }, tag));
  for (const c of children) r.append(c);
  return r;
}

const SURFACE_LABELS: Record<SurfaceType, string> = {
  concrete: 'Béton',
  tile: 'Carrelage',
  lino: 'Lino',
  carpet: 'Moquette',
  wood: 'Bois',
  metal: 'Métal',
  glass: 'Verre',
  plaster: 'Plâtre',
  plastic: 'Plastique',
  fabric: 'Tissu',
  cardboard: 'Carton',
  dirt: 'Terre',
  grass: 'Herbe',
  gravel: 'Gravier',
  water: 'Eau',
  foliage: 'Feuillage',
};

const FEEDBACK_LABELS: Record<FeedbackSound, string> = {
  hitmarker: 'Touche',
  headshot: 'Tir à la tête',
  kill: 'Élimination',
  hurt: 'Dégâts reçus',
  death: 'Mort',
  respawn: 'Retour au poste',
  pickup: 'Ramassage',
  countdown: 'Compte à rebours',
  round_start: 'Début de manche',
  round_win: 'Manche gagnée',
  round_lose: 'Manche perdue',
  plant_tick: 'Dépôt (tampon)',
  defuse_tick: 'Levée (stylo)',
};

const UI_LABELS: Record<UiSound, string> = {
  click: 'Clic',
  hover: 'Survol',
  back: 'Retour',
  error: 'Erreur',
  join: 'Joueur connecté',
  chat: 'Message',
};

const OBJECTIVE_LABELS: Record<string, string> = {
  bomb_beep: 'Bip du dossier',
  bomb_planted: 'Écart déposé',
  bomb_defused: 'Écart levé',
  bomb_exploded: 'Suspension (explosion)',
  bomb_dropped: 'Dossier tombé',
  bomb_picked: 'Dossier récupéré',
  sample_taken: 'Échantillon saisi',
  sample_dropped: 'Glacière au sol',
  sample_returned: 'Échantillon sécurisé',
  sample_extracted: 'Échantillon extrait',
};

const GROUP_LABELS: Record<string, string> = {
  shot: 'Tirs',
  mech: 'Mécanique',
  step: 'Déplacements',
  impact: 'Impacts',
  feedback: 'Retours',
  ui: 'Interface',
  objective: 'Objectifs',
  jingle: 'Annonces',
  ambience: 'Ambiances',
  music: 'Musique',
};

const settings = new SettingsStore();
const engine = new AudioEngine(settings);

// Source placement around the listener (who stands at the origin, looking towards -Z).
const source = { spatial: true, azimuth: 40, distance: 8, orbit: false };

function sourcePos(): Vec3 | null {
  if (!source.spatial) return null;
  return worldPos();
}

function worldPos(): Vec3 {
  const a = (source.azimuth * Math.PI) / 180;
  return { x: Math.sin(a) * source.distance, y: 1.6, z: -Math.cos(a) * source.distance };
}

function buildBoard(board: HTMLElement, side: HTMLElement): void {
  // --- Source ---------------------------------------------------------------------
  const src = section('Source sonore', 'position par rapport à l’auditeur (qui regarde vers le haut du radar)');
  const radar = el('canvas', { id: 'radar', width: '300', height: '300' });
  const controls = el('div', { class: 'controls' });
  const slider = (label: string, min: number, max: number, step: number, value: number, unit: string, on: (v: number) => void): HTMLInputElement => {
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    const out = el('output', {}, `${value}${unit}`);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = `${v}${unit}`;
      on(v);
    });
    controls.append(el('span', {}, label), input, out);
    return input;
  };
  const az = slider('Direction', 0, 360, 1, source.azimuth, '°', (v) => (source.azimuth = v));
  slider('Distance', 0.5, 150, 0.5, source.distance, ' m', (v) => (source.distance = v));
  const spatial = el('input', { type: 'checkbox' });
  spatial.checked = true;
  spatial.addEventListener('change', () => (source.spatial = spatial.checked));
  const orbit = el('input', { type: 'checkbox' });
  orbit.addEventListener('change', () => (source.orbit = orbit.checked));
  const checks = el(
    'div',
    { class: 'row' },
    el('label', { class: 'check' }, spatial, 'Son d’un autre joueur (spatialisé)'),
    el('label', { class: 'check' }, orbit, 'Orbite automatique'),
  );
  const right = el('div', {}, controls, checks);
  right.append(el('p', { class: 'hint' }, 'Décoché : les sons sont ceux du joueur local (pos = null), pleins et centrés.'));
  src.append(el('div', { class: 'source' }, radar, right));
  board.append(src);

  let lastFrame = performance.now();
  const frame = (): void => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (source.orbit) {
      source.azimuth = (source.azimuth + 50 * dt) % 360;
      az.value = String(Math.round(source.azimuth));
      (az.nextElementSibling as HTMLElement).textContent = `${Math.round(source.azimuth)}°`;
    }
    engine.setListener({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 });
    const g = radar.getContext('2d')!;
    g.clearRect(0, 0, 300, 300);
    g.strokeStyle = 'rgba(140,190,240,0.25)';
    for (const r of [45, 90, 135]) {
      g.beginPath();
      g.arc(150, 150, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.fillStyle = '#3182ce';
    g.beginPath();
    g.moveTo(150, 136);
    g.lineTo(160, 160);
    g.lineTo(140, 160);
    g.closePath();
    g.fill();
    const a = (source.azimuth * Math.PI) / 180;
    const r = 20 + 115 * Math.min(1, Math.log10(1 + source.distance) / Math.log10(151));
    g.fillStyle = source.spatial ? '#e7343f' : '#4a4a49';
    g.beginPath();
    g.arc(150 + Math.sin(a) * r, 150 - Math.cos(a) * r, 9, 0, Math.PI * 2);
    g.fill();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // --- Weapons --------------------------------------------------------------------
  const weapons = section('Armes', 'tir, rafale, rechargement complet, prise en main');
  const grid = el('div', { class: 'weapons' });
  for (const id of Object.keys(WEAPONS) as WeaponId[]) {
    const w = WEAPONS[id];
    const card = el('div', { class: 'weapon' }, el('strong', {}, w.name, el('em', {}, id)));
    const burst = (): void => {
      const shots = w.auto ? Math.min(12, Math.round(1.2 / w.fireInterval)) : 3;
      for (let i = 0; i < shots; i++) setTimeout(() => engine.shot(id, sourcePos()), i * w.fireInterval * 1000);
    };
    const r = el('div', { class: 'row' }, button('Tir', () => engine.shot(id, sourcePos()), 'primary'), button('Rafale', burst));
    if (w.reloadTime > 0) r.append(button('Recharger', () => engine.reload(id, w.reloadTime, sourcePos())));
    r.append(button('Dégainer', () => engine.draw(id, sourcePos())));
    r.append(button('∿', () => void showScope(`shot_${id}`), 'scope'));
    card.append(r);
    grid.append(card);
  }
  weapons.append(grid);
  weapons.append(
    row(
      '',
      button('Tir à vide', () => engine.dryFire(sourcePos())),
      button('Lunette', () => engine.zoom()),
      button('Coup de bistouri porté', () => engine.bodyHit(worldPos(), false)),
    ),
  );
  board.append(weapons);

  // --- Movement ---------------------------------------------------------------------
  const move = section('Déplacements', 'pas par surface (clic), réception (Maj + clic)');
  const steps = el('div', { class: 'row' });
  for (const surf of Object.keys(SURFACE_LABELS) as SurfaceType[]) {
    const b = el('button', {}, SURFACE_LABELS[surf]);
    b.addEventListener('click', (ev) => {
      if (ev.shiftKey) engine.land(surf, 7, sourcePos());
      else engine.footstep(surf, sourcePos(), 1);
    });
    steps.append(b);
  }
  move.append(steps);
  let walking: ReturnType<typeof setInterval> | null = null;
  let walkSurface = 0;
  const walk = button('Marcher (toutes les surfaces)', () => {
    if (walking !== null) {
      clearInterval(walking);
      walking = null;
      walk.classList.remove('on');
      return;
    }
    walk.classList.add('on');
    let n = 0;
    const list = Object.keys(SURFACE_LABELS) as SurfaceType[];
    walking = setInterval(() => {
      engine.footstep(list[walkSurface % list.length], sourcePos(), 1);
      if (++n % 6 === 0) walkSurface++;
    }, 330);
  });
  move.append(
    row(
      '',
      walk,
      button('Pas discret', () => engine.footstep('lino', sourcePos(), 0.25)),
      button('Saut', () => engine.jump(sourcePos())),
      button('Réception douce', () => engine.land('lino', 3, sourcePos())),
      button('Réception lourde', () => engine.land('concrete', 11, sourcePos())),
    ),
  );
  board.append(move);

  // --- Impacts ----------------------------------------------------------------------
  const impacts = section('Balles', 'impacts par surface, touches, sifflement');
  const imp = el('div', { class: 'row' });
  for (const surf of Object.keys(SURFACE_LABELS) as SurfaceType[]) imp.append(button(SURFACE_LABELS[surf], () => engine.impact(surf, worldPos())));
  impacts.append(imp);
  impacts.append(
    row(
      '',
      button('Touche (corps)', () => engine.bodyHit(worldPos(), false)),
      button('Touche (tête)', () => engine.bodyHit(worldPos(), true)),
      button('Balle qui siffle', () => engine.whizz({ x: Math.random() - 0.5, y: 1.6, z: -0.6 })),
      button('Salve de plombs', () => {
        for (let i = 0; i < 8; i++) engine.impact('plaster', worldPos());
      }),
    ),
  );
  board.append(impacts);

  // --- Feedback, UI -------------------------------------------------------------------
  const fb = section('Retours de jeu');
  const fbRow = el('div', { class: 'row' });
  for (const k of Object.keys(FEEDBACK_LABELS) as FeedbackSound[]) fbRow.append(button(FEEDBACK_LABELS[k], () => engine.feedback(k)));
  fb.append(fbRow);
  board.append(fb);

  const ui = section('Interface');
  const uiRow = el('div', { class: 'row' });
  for (const k of Object.keys(UI_LABELS) as UiSound[]) uiRow.append(button(UI_LABELS[k], () => engine.ui(k)));
  ui.append(uiRow);
  board.append(ui);

  // --- Objectives ---------------------------------------------------------------------
  const obj = section('Objectifs', 'suivent la source (ou plein écran si « spatialisé » est décoché)');
  const objRow = el('div', { class: 'row' });
  for (const k of Object.keys(OBJECTIVE_LABELS)) objRow.append(button(OBJECTIVE_LABELS[k], () => engine.objective(k, sourcePos())));
  obj.append(objRow);
  let ticking: ReturnType<typeof setTimeout> | null = null;
  const countdown = button('Compte à rebours du dossier (accéléré)', () => {
    if (ticking !== null) {
      clearTimeout(ticking);
      ticking = null;
      countdown.classList.remove('on');
      return;
    }
    countdown.classList.add('on');
    let left = 12;
    const tick = (): void => {
      engine.objective('bomb_beep', sourcePos());
      const wait = Math.max(0.09, 0.1 + 0.9 * (left / 12));
      left -= wait;
      if (left <= 0) {
        engine.objective('bomb_exploded', sourcePos());
        ticking = null;
        countdown.classList.remove('on');
        return;
      }
      ticking = setTimeout(tick, wait * 1000);
    };
    tick();
  });
  obj.append(row('', countdown));
  board.append(obj);

  // --- Announcer ----------------------------------------------------------------------
  const ann = section('Annonceur', 'jingle + voix de synthèse du navigateur');
  const annRow = el('div', { class: 'row' });
  for (const key of Object.keys(ANNOUNCE)) annRow.append(button(ANNOUNCE[key].title, () => engine.announce(key)));
  ann.append(annRow);
  const voiceToggle = el('input', { type: 'checkbox' });
  voiceToggle.checked = settings.value.announcerVoice;
  voiceToggle.addEventListener('change', () => settings.update({ announcerVoice: voiceToggle.checked }));
  ann.append(row('', el('label', { class: 'check' }, voiceToggle, 'Voix de l’annonceur')));
  board.append(ann);

  // --- Ambience, music, volumes ----------------------------------------------------------
  const loops = section('Ambiances et musique');
  loops.append(
    row(
      'Ambiance',
      button('Plateau technique', () => engine.ambience('interior')),
      button('Centre-ville', () => engine.ambience('city')),
      button('Aucune', () => engine.ambience(null)),
    ),
    row(
      'Musique',
      button('Menu', () => engine.music('menu')),
      button('Arrêt', () => engine.music(null)),
    ),
  );
  const vols = el('div', { class: 'controls' });
  const vol = (label: string, key: 'volumeMaster' | 'volumeSfx' | 'volumeVoice' | 'volumeMusic'): void => {
    const input = el('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(settings.value[key]) });
    const out = el('output', {}, `${Math.round(settings.value[key] * 100)} %`);
    input.addEventListener('input', () => {
      settings.update({ [key]: Number(input.value) });
      out.textContent = `${Math.round(Number(input.value) * 100)} %`;
    });
    vols.append(el('span', {}, label), input, out);
  };
  vol('Volume général', 'volumeMaster');
  vol('Effets', 'volumeSfx');
  vol('Annonceur', 'volumeVoice');
  vol('Musique', 'volumeMusic');
  loops.append(el('div', { style: 'margin-top:12px' }, vols));
  board.append(loops);

  // --- Scope ------------------------------------------------------------------------
  const scope = section('Oscilloscope', 'forme d’onde et spectrogramme du rendu');
  const select = el('select', { id: 'scope-select' });
  const byGroup = new Map<string, string[]>();
  for (const d of allSounds()) byGroup.set(d.group, [...(byGroup.get(d.group) ?? []), d.name]);
  for (const [group, names] of byGroup) {
    const og = el('optgroup', { label: GROUP_LABELS[group] ?? group });
    for (const n of names) og.append(el('option', { value: n }, `${n} — ${getSound(n)!.label}`));
    select.append(og);
  }
  const variant = el('select', { id: 'scope-variant' });
  const refreshVariants = (): void => {
    const def = getSound(select.value);
    variant.innerHTML = '';
    for (let v = 0; v < (def?.variants ?? 1); v++) variant.append(el('option', { value: String(v) }, `variante ${v + 1}`));
  };
  select.addEventListener('change', () => {
    refreshVariants();
    void showScope(select.value, 0);
  });
  variant.addEventListener('change', () => void showScope(select.value, Number(variant.value)));
  refreshVariants();
  scopeCanvas = el('canvas', { id: 'scope', width: '940', height: '660' });
  scope.append(
    row('', select, variant, button('Écouter', () => engine.preview(select.value), 'primary')),
    el('div', { style: 'margin-top:10px' }, scopeCanvas),
    el('p', { id: 'scope-title' }, 'Choisissez un son pour afficher son rendu (le bouton ∿ des armes fait de même).'),
  );
  side.append(scope);

  // --- Analysis ---------------------------------------------------------------------
  const an = section('Analyse automatique', 'tous les sons, après l’étage de sortie (compresseur + écrêteur)');
  const run = button(
    'Analyser tout le catalogue',
    () => {
      run.disabled = true;
      run.textContent = 'Analyse en cours…';
      void analyse().finally(() => {
        run.disabled = false;
        run.textContent = 'Analyser tout le catalogue';
      });
    },
    'primary',
  );
  an.append(row('', run), el('div', { id: 'table-wrap', style: 'margin-top:10px' }, el('table', { id: 'table' })));
  an.append(
    el(
      'p',
      { id: 'analysis-note' },
      `Durée mesurée à −60 dB de la crête ; crête après l’étage de sortie (plafond ${CEILING.toFixed(2)}) ; alertes : silencieux, saturation, fin abrupte, composante continue, raccord de boucle.`,
    ),
  );
  side.append(an);
}

async function showScope(name: string, variant = 0): Promise<void> {
  const select = document.getElementById('scope-select') as HTMLSelectElement | null;
  if (select && select.value !== name) {
    select.value = name;
    select.dispatchEvent(new Event('change'));
    return;
  }
  const title = document.getElementById('scope-title');
  if (title) title.textContent = 'Rendu en cours…';
  try {
    await waveform(name, variant);
    if (title) title.textContent = getSound(name)?.label ?? name;
  } catch (err) {
    if (title) title.textContent = `Rendu impossible : ${String(err)}`;
  }
}

function showTable(result: Record<string, Metrics>): void {
  const table = document.getElementById('table');
  if (!table) return;
  table.innerHTML = '';
  const head = el('tr');
  for (const h of ['Son', 'Durée', 'Crête', 'RMS', 'Centroïde', 'Attaque', 'Alertes']) head.append(el('th', {}, h));
  table.append(head);
  for (const [name, m] of Object.entries(result)) {
    const tr = el('tr');
    const db = 20 * Math.log10(Math.max(1e-9, m.rms));
    tr.append(
      el('td', {}, name),
      el('td', {}, m.duration >= 3 ? `${m.duration.toFixed(1)} s` : `${(m.duration * 1000).toFixed(0)} ms`),
      el('td', m.peak > 0.98 ? { class: 'bad' } : {}, m.peak.toFixed(3)),
      el('td', {}, `${db.toFixed(1)} dB`),
      el('td', {}, `${m.centroidHz.toFixed(0)} Hz`),
      el('td', {}, `${m.attackMs.toFixed(1)} ms`),
      el('td', m.flags.length ? { class: 'bad' } : {}, m.flags.join(', ') || '—'),
    );
    table.append(tr);
  }
}

function updateStatus(): void {
  const status = document.getElementById('status');
  if (!status) return;
  const d = engine.debug();
  const on = d.state === 'running';
  const state = on ? 'actif' : d.state === 'unavailable' ? 'Web Audio indisponible' : 'en attente d’un clic';
  status.innerHTML = '';
  const b = el('b', on ? {} : { class: 'off' }, state);
  status.append(
    'Moteur : ',
    b,
    on
      ? ` · ${d.sampleRate} Hz · voix actives : ${d.voices} / 32 · chaînes : ${d.chains} · catalogue rendu : ${Math.round(d.rendered * 100)} % · voix française : ${d.voice ?? 'voix par défaut du navigateur'}`
      : '',
  );
}

let resolveReady!: () => void;
const ready = new Promise<void>((res) => (resolveReady = res));

window.__audio = {
  ready,
  engine,
  names: () => allSounds().map((d) => d.name),
  analyse,
  waveform,
  gallery,
  hideGallery: () => document.getElementById('gallery')?.classList.remove('show'),
  envelope,
  masterGain,
  makeup: () => calibrateCompressor(),
};

function boot(): void {
  buildBoard(document.getElementById('board')!, document.getElementById('side')!);
  document.getElementById('stop-all')!.addEventListener('click', () => engine.stopAll());
  setInterval(updateStatus, 300);
  updateStatus();
  resolveReady();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
