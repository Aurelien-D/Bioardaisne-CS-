/**
 * Top-down map thumbnails for the map picker, drawn from the map data itself:
 * a slice of the collision solids 1 m above the floor (walls and tall cover),
 * low cover in a dimmer tone, spawn areas and objective zones.
 *
 * Map data is built lazily (one map per idle slot, never while the picker is
 * closed) and each rendering is cached for the lifetime of the page.
 */
import { getMap, hasMap } from '../../../shared/maps';
import type { MapData, Solid } from '../../../shared/maps/types';

const THUMB_W = 480;
const THUMB_H = 300;

const cache = new Map<string, HTMLCanvasElement | null>();
const waiting = new Map<string, ((c: HTMLCanvasElement | null) => void)[]>();
const queue: string[] = [];
let pumping = false;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function render(map: MapData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Reference floor = where players spawn; the slice is taken 1 m above it.
  const floorY = map.spawns.length > 0 ? median(map.spawns.map((s) => s.pos.y)) : map.bounds.min.y;
  const sliceY = floorY + 1.0;

  const walls: Solid[] = [];
  const low: Solid[] = [];
  const floors: Solid[] = [];
  for (const s of map.solids) {
    if (s.max.x - s.min.x <= 0 || s.max.z - s.min.z <= 0) continue;
    if (s.min.y < sliceY && s.max.y > sliceY) walls.push(s);
    else if (s.max.y > floorY + 0.3 && s.max.y <= sliceY && s.min.y < sliceY) low.push(s);
    else if (s.max.y > floorY - 0.6 && s.max.y <= floorY + 0.3) floors.push(s);
  }

  // Frame: footprint of everything drawn, clipped to the map bounds.
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  const grow = (s: { min: { x: number; z: number }; max: { x: number; z: number } }): void => {
    x0 = Math.min(x0, s.min.x);
    x1 = Math.max(x1, s.max.x);
    z0 = Math.min(z0, s.min.z);
    z1 = Math.max(z1, s.max.z);
  };
  for (const s of walls) grow(s);
  for (const s of floors) grow(s);
  if (!Number.isFinite(x0)) grow(map.bounds);
  x0 = Math.max(x0, map.bounds.min.x);
  x1 = Math.min(x1, map.bounds.max.x);
  z0 = Math.max(z0, map.bounds.min.z);
  z1 = Math.min(z1, map.bounds.max.z);
  if (!(x1 > x0) || !(z1 > z0)) {
    x0 = map.bounds.min.x;
    x1 = map.bounds.max.x;
    z0 = map.bounds.min.z;
    z1 = map.bounds.max.z;
  }

  const pad = 16;
  const scale = Math.min((THUMB_W - pad * 2) / Math.max(1, x1 - x0), (THUMB_H - pad * 2) / Math.max(1, z1 - z0));
  const ox = (THUMB_W - (x1 - x0) * scale) / 2 - x0 * scale;
  const oz = (THUMB_H - (z1 - z0) * scale) / 2 - z0 * scale;
  const px = (x: number): number => x * scale + ox;
  const pz = (z: number): number => z * scale + oz;

  // Background: blueprint navy with a 5 m grid.
  const bg = ctx.createLinearGradient(0, 0, THUMB_W, THUMB_H);
  bg.addColorStop(0, '#0c2a4c');
  bg.addColorStop(1, '#05162b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  ctx.strokeStyle = 'rgba(124, 192, 248, 0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const gridStep = 5;
  for (let gx = Math.ceil((0 - ox) / scale / gridStep) * gridStep; px(gx) < THUMB_W; gx += gridStep) {
    ctx.moveTo(Math.round(px(gx)) + 0.5, 0);
    ctx.lineTo(Math.round(px(gx)) + 0.5, THUMB_H);
  }
  for (let gz = Math.ceil((0 - oz) / scale / gridStep) * gridStep; pz(gz) < THUMB_H; gz += gridStep) {
    ctx.moveTo(0, Math.round(pz(gz)) + 0.5);
    ctx.lineTo(THUMB_W, Math.round(pz(gz)) + 0.5);
  }
  ctx.stroke();

  const fillSolids = (list: Solid[], style: string, minPx: number): void => {
    ctx.fillStyle = style;
    for (const s of list) {
      let w = (s.max.x - s.min.x) * scale;
      let d = (s.max.z - s.min.z) * scale;
      let x = px(s.min.x);
      let z = pz(s.min.z);
      if (w < minPx) {
        x -= (minPx - w) / 2;
        w = minPx;
      }
      if (d < minPx) {
        z -= (minPx - d) / 2;
        d = minPx;
      }
      ctx.fillRect(x, z, w, d);
    }
  };

  fillSolids(floors, 'rgba(70, 150, 225, 0.14)', 0);

  // Spawn areas: soft team-coloured glows under the walls.
  for (const sp of map.spawns) {
    const cx = px(sp.pos.x);
    const cz = pz(sp.pos.z);
    const r = Math.max(10, 3.2 * scale);
    const g = ctx.createRadialGradient(cx, cz, 0, cx, cz, r);
    const rgb = sp.team === 0 ? '74, 160, 240' : '240, 70, 80';
    g.addColorStop(0, `rgba(${rgb}, 0.34)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cz - r, r * 2, r * 2);
  }

  // Objective zones.
  ctx.font = '700 15px Inter, "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const zone of map.zones) {
    if (zone.kind === 'buy') continue;
    const color = zone.kind === 'site' ? '255, 194, 74' : '69, 214, 160';
    const x = px(zone.min.x);
    const z = pz(zone.min.z);
    const w = (zone.max.x - zone.min.x) * scale;
    const d = (zone.max.z - zone.min.z) * scale;
    ctx.fillStyle = `rgba(${color}, 0.16)`;
    ctx.fillRect(x, z, w, d);
    ctx.strokeStyle = `rgba(${color}, 0.9)`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x + 0.5, z + 0.5, w, d);
    ctx.setLineDash([]);
    if (zone.kind === 'site') {
      ctx.fillStyle = `rgba(${color}, 1)`;
      ctx.fillText(zone.id.slice(0, 2).toUpperCase(), x + w / 2, z + d / 2 + 1);
    }
  }

  fillSolids(low, 'rgba(110, 172, 235, 0.42)', 1.5);
  fillSolids(walls, 'rgba(216, 236, 255, 0.92)', 1.6);

  // Sample coolers (Sécurisation).
  for (const p of map.points) {
    if (p.kind !== 'sample') continue;
    const cx = px(p.pos.x);
    const cz = pz(p.pos.z);
    ctx.fillStyle = '#45d6a0';
    ctx.beginPath();
    ctx.moveTo(cx, cz - 5);
    ctx.lineTo(cx + 5, cz);
    ctx.lineTo(cx, cz + 5);
    ctx.lineTo(cx - 5, cz);
    ctx.closePath();
    ctx.fill();
  }

  // Vignette to seat the plan in its frame.
  const v = ctx.createRadialGradient(THUMB_W / 2, THUMB_H / 2, THUMB_H * 0.35, THUMB_W / 2, THUMB_H / 2, THUMB_W * 0.72);
  v.addColorStop(0, 'rgba(2, 10, 20, 0)');
  v.addColorStop(1, 'rgba(2, 10, 20, 0.55)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  return canvas;
}

function pump(): void {
  const id = queue.shift();
  if (id === undefined) {
    pumping = false;
    return;
  }
  let result: HTMLCanvasElement | null = null;
  try {
    if (hasMap(id)) result = render(getMap(id));
  } catch (err) {
    console.warn(`[menus] thumbnail failed for map "${id}"`, err);
  }
  cache.set(id, result);
  for (const cb of waiting.get(id) ?? []) cb(result);
  waiting.delete(id);
  // Leave the main thread free between two maps (building a map can take a few ms).
  window.setTimeout(pump, 30);
}

/** Rendered thumbnail of a map (shared 480 × 300 canvas — copy it, do not modify it). */
export function mapThumb(mapId: string): Promise<HTMLCanvasElement | null> {
  const cached = cache.get(mapId);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const list = waiting.get(mapId);
    if (list) list.push(resolve);
    else {
      waiting.set(mapId, [resolve]);
      queue.push(mapId);
    }
    if (!pumping) {
      pumping = true;
      window.setTimeout(pump, 60);
    }
  });
}

/**
 * A <canvas> that shows the thumbnail of `mapId` as soon as it is available
 * (a neutral placeholder is visible meanwhile, styled by `.bas-thumb`).
 */
export function createMapThumb(mapId: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'bas-thumb';
  canvas.width = THUMB_W;
  canvas.height = THUMB_H;
  canvas.setAttribute('aria-hidden', 'true');
  void mapThumb(mapId).then((src) => {
    if (!src) return;
    canvas.getContext('2d')?.drawImage(src, 0, 0);
    canvas.classList.add('is-ready');
  });
  return canvas;
}
