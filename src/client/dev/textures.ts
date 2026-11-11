/**
 * Texture gallery (dev page, /dev/textures.html): every material as a 3 × 3 tiled swatch,
 * with its reference colour next to the measured mean colour and its generation time.
 *
 * URL parameters:
 *   ?quality=low|medium|high   texture quality (default high)
 *   ?only=id1,id2              show these materials only (substring match with a trailing *)
 *   ?zoom=1                    add a 1:1 crop of the texture next to the tiled swatch
 *   ?cell=330                  minimum width of a grid cell in CSS pixels
 *   ?tiles=3                   repeats per swatch side
 *
 * window.__textures = { ready, totalMs, slowest, count } for automated screenshots.
 */
import { MATERIAL_IDS, MATERIALS, type MaterialId, type MaterialInfo } from '../../shared/maps/materials';
import type { Quality } from '../core/settings';
import { getMaterialTexture } from '../render/textures';

interface TexturesApi {
  ready: boolean;
  /** Time to generate every listed material, in milliseconds. */
  totalMs: number;
  slowest: { id: string; ms: number }[];
  count: number;
  error: string | null;
}

declare global {
  interface Window {
    __textures: TexturesApi;
  }
}

const api: TexturesApi = { ready: false, totalMs: 0, slowest: [], count: 0, error: null };
window.__textures = api;

const params = new URLSearchParams(location.search);
const qualityParam = params.get('quality');
const quality: Quality = qualityParam === 'low' || qualityParam === 'medium' ? qualityParam : 'high';
const zoom = params.get('zoom') === '1';
const tiles = Math.max(1, Math.min(6, Number(params.get('tiles') ?? 3) || 3));
const only = (params.get('only') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const matches = (id: string): boolean =>
  only.length === 0 || only.some((o) => (o.endsWith('*') ? id.startsWith(o.slice(0, -1)) : o === id));

const toLinear = (v: number): number => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const toSrgb = (l: number): number => Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));

/** Mean colour of a canvas, averaged in linear light, as sRGB bytes. */
function meanOf(canvas: HTMLCanvasElement): [number, number, number] {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let p = 0; p < d.length; p += 4) {
    r += toLinear(d[p]!);
    g += toLinear(d[p + 1]!);
    b += toLinear(d[p + 2]!);
  }
  const count = d.length / 4;
  return [toSrgb(r / count), toSrgb(g / count), toSrgb(b / count)];
}

const hexOf = (c: readonly number[]): string => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildNav(): void {
  const nav = document.getElementById('nav')!;
  for (const q of ['low', 'medium', 'high'] as const) {
    const a = el('a', q === quality ? 'on' : '', q === 'low' ? 'Basse' : q === 'medium' ? 'Moyenne' : 'Haute');
    const next = new URLSearchParams(params);
    next.set('quality', q);
    a.href = `?${next}`;
    nav.appendChild(a);
  }
}

function addSwatch(grid: HTMLElement, id: MaterialId, ms: number): void {
  const info: MaterialInfo = MATERIALS[id];
  const tex = getMaterialTexture(id, quality);
  const src = tex.image as HTMLCanvasElement;
  const box = el('div', 'swatch');
  box.id = `swatch-${id}`;

  // 3 × 3 repeats; each repeat is shown at 128 px (or smaller textures at their own size).
  const rep = Math.min(src.width, 160);
  const view = el('canvas');
  view.width = rep * tiles + (zoom ? rep * tiles : 0);
  view.height = rep * tiles;
  const ctx = view.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  for (let j = 0; j < tiles; j++) {
    for (let i = 0; i < tiles; i++) ctx.drawImage(src, i * rep, j * rep, rep, rep);
  }
  if (zoom) {
    // 1:1 crop straddling the tile corner, so that seams would show.
    const w = rep * tiles;
    const pat = ctx.createPattern(src, 'repeat')!;
    ctx.save();
    ctx.translate(w, 0);
    ctx.beginPath();
    ctx.rect(0, 0, w, w);
    ctx.clip();
    ctx.translate(w / 2, w / 2);
    ctx.fillStyle = pat;
    ctx.fillRect(-w / 2, -w / 2, w, w);
    ctx.restore();
  }
  box.appendChild(view);

  const mean = meanOf(src);
  const ref = [(info.color >> 16) & 255, (info.color >> 8) & 255, info.color & 255];
  const delta = Math.max(Math.abs(mean[0] - ref[0]!), Math.abs(mean[1] - ref[1]!), Math.abs(mean[2] - ref[2]!));

  const row = el('div', 'row');
  row.appendChild(el('span', 'id', id));
  const chipRef = el('span', 'chip');
  chipRef.style.background = hexOf(ref);
  chipRef.title = `Couleur de référence ${hexOf(ref)}`;
  const chipMean = el('span', 'chip');
  chipMean.style.background = hexOf(mean);
  chipMean.title = `Couleur moyenne mesurée ${hexOf(mean)}`;
  row.appendChild(chipRef);
  row.appendChild(chipMean);
  const meta = el('span', `meta${delta > 12 ? ' warn' : ''}`, `Δ${delta} · ${info.tile ?? 1} m · ${src.width} px · ${ms.toFixed(1)} ms`);
  row.appendChild(meta);
  box.appendChild(row);
  box.appendChild(el('div', 'desc', info.desc));
  grid.appendChild(box);
}

function main(): void {
  buildNav();
  const cell = Number(params.get('cell'));
  if (cell > 0) document.documentElement.style.setProperty('--cell', `${cell}px`);
  const grid = document.getElementById('grid')!;
  const ids = MATERIAL_IDS.filter(matches);

  // Generation pass first (timed on its own), then the swatches.
  const times = new Map<MaterialId, number>();
  const t0 = performance.now();
  for (const id of ids) {
    const t = performance.now();
    getMaterialTexture(id, quality);
    times.set(id, performance.now() - t);
  }
  api.totalMs = performance.now() - t0;
  api.count = ids.length;
  api.slowest = [...times.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, ms]) => ({ id, ms: Math.round(ms * 10) / 10 }));

  for (const id of ids) addSwatch(grid, id, times.get(id)!);

  const label = quality === 'low' ? 'basse' : quality === 'medium' ? 'moyenne' : 'haute';
  document.getElementById('stats')!.textContent =
    `${ids.length} matériaux · qualité ${label} · générés en ${api.totalMs.toFixed(0)} ms · le plus lent : ${api.slowest[0]?.id ?? '—'} (${api.slowest[0]?.ms ?? 0} ms)`;
  api.ready = true;
}

try {
  main();
} catch (err) {
  api.error = err instanceof Error ? (err.stack ?? err.message) : String(err);
  document.getElementById('stats')!.textContent = `Erreur : ${api.error}`;
  console.error(err);
}
