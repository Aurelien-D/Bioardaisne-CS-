/**
 * Top-down plan of a map, cut at a given height — the main way map authors "see" a layout.
 *
 *   npx tsx tools/map-plan.ts <mapId> [--y 1.0] [--out tools/out] [--scale 30] [--no-png] [--ranges] [--signs]
 *
 * Writes <out>/plan_<mapId>.svg and a PNG rasterised with Playwright (same name).
 *
 * Reading the plan
 *  - +X points right, +Z points down. Grid every 5 m (thin lines every metre), coordinates on the edges.
 *  - Dark shapes: solids crossing the cut height (walls, tall furniture). Slate: solids that cross the cut
 *    but stop less than 1 m above it (counters, analysers). Light blue: glass. Thin grey: railings
 *    (bullets pass). Light grey: solids below the cut (furniture, steps; darker = higher).
 *  - Floors take the colour of their material; hatched areas have no floor.
 *  - Dashed outlines: slabs above the cut (mezzanines, ceilings).
 *  - Arrows: spawns (blue = Équipe Labo, red = Les Auditeurs) pointing where the player looks.
 *  - Yellow dots: lights. Purple ticks: signs. Diamonds: points. Translucent rectangles: zones.
 *  - Red crosses: leaks found by the validator (tools/map-check.ts).
 *  - Only the storey being cut is annotated: spawns, points, zones, lights and signs separated from
 *    the cut plane by a floor or a ceiling are left out (make another plan with another --y).
 *
 * `--y` is the absolute height of the cut (default: 1 m above the lowest spawn). For an upper
 * storey, pass e.g. `--y 4.2`: everything below is drawn as seen from above.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MAP_MODULES } from '../src/shared/maps';
import { MATERIALS, type MaterialInfo } from '../src/shared/maps/materials';
import type { MapData } from '../src/shared/maps/types';
import { floodFill, type Leak } from './map-check';

export interface PlanOptions {
  /** Absolute cut height (default: lowest spawn + 1 m). */
  y?: number;
  /** Pixels per metre (default: automatic, 20–40 px/m up to 80 m, reduced beyond). */
  scale?: number;
  /** Draw the range of every light. */
  ranges?: boolean;
  /** Write the text of every sign next to its tick. */
  signs?: boolean;
  /** Leaks to mark (default: computed with the validator's flood fill). */
  leaks?: Leak[];
}

const TEAM_COLORS = ['#3182ce', '#e7343f'];
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c: number): string => '#' + (c & 0xffffff).toString(16).padStart(6, '0');
const fr = (n: number, d = 1): string => (Math.round(n * 10 ** d) / 10 ** d).toString().replace('.', ',');

/** Mix a 0xRRGGBB colour toward white (t = 0 → colour, 1 → white). */
function lighten(c: number, t: number): string {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const m = (v: number): number => Math.round(v + (255 - v) * t);
  return hex((m(r) << 16) | (m(g) << 8) | m(b));
}

function tinted(mat: string, tint?: number): number {
  const info = (MATERIALS as Record<string, MaterialInfo>)[mat];
  const c = info ? info.color : 0x999999;
  if (tint === undefined) return c;
  const mul = (a: number, b: number): number => Math.round((a * b) / 255);
  return (mul((c >> 16) & 255, (tint >> 16) & 255) << 16) | (mul((c >> 8) & 255, (tint >> 8) & 255) << 8) | mul(c & 255, tint & 255);
}

/** Builds the SVG plan of a map. */
export function renderPlan(map: MapData, opts: PlanOptions = {}): { svg: string; width: number; height: number; scale: number; cutY: number } {
  const { min, max } = map.bounds;
  const sizeX = max.x - min.x;
  const sizeZ = max.z - min.z;
  const maxDim = Math.max(sizeX, sizeZ);
  const ppm = opts.scale ?? Math.max(6, Math.min(40, Math.floor(1800 / maxDim)));
  const lowestSpawn = map.spawns.length ? Math.min(...map.spawns.map((s) => s.pos.y)) : min.y;
  const cutY = opts.y ?? lowestSpawn + 1.0;

  const ML = 58; // margins
  const MT = 64;
  const MR = 58;
  const MB = 150;
  const W = Math.ceil(sizeX * ppm) + ML + MR;
  const H = Math.ceil(sizeZ * ppm) + MT + MB;
  const X = (x: number): number => ML + (x - min.x) * ppm;
  const Z = (z: number): number => MT + (z - min.z) * ppm;
  const n2 = (v: number): string => (Math.round(v * 100) / 100).toString();
  const rect = (x0: number, z0: number, x1: number, z1: number, attrs: string): string =>
    `<rect x="${n2(X(x0))}" y="${n2(Z(z0))}" width="${n2((x1 - x0) * ppm)}" height="${n2((z1 - z0) * ppm)}" ${attrs}/>`;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="'DejaVu Sans', 'Segoe UI', Arial, sans-serif">`,
  );
  out.push(
    '<defs>' +
      '<pattern id="void" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#e9edf2"/><line x1="0" y1="0" x2="0" y2="8" stroke="#cfd6de" stroke-width="2"/></pattern>' +
      `<clipPath id="mapclip"><rect x="${ML}" y="${MT}" width="${n2(sizeX * ppm)}" height="${n2(sizeZ * ppm)}"/></clipPath>` +
      '</defs>',
  );
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(rect(min.x, min.z, max.x, max.z, 'fill="url(#void)"'));
  out.push('<g clip-path="url(#mapclip)">');

  // --- Everything below the cut, painted from the lowest top to the highest ------------------
  interface Low {
    top: number;
    svg: string;
  }
  const lows: Low[] = [];
  const isFloorLike = (w: number, d: number, h: number, top: number): boolean =>
    w * d >= 1 && Math.min(w, d) >= 0.6 && (h <= 0.5 || top <= cutY - 0.95);
  const floorKeys = new Set<string>();
  const key = (a: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): string =>
    [a.min.x, a.min.z, a.max.x, a.max.z, a.max.y].map((v) => v.toFixed(3)).join('|');
  for (const b of map.boxes) {
    const top = b.max.y;
    if (top > cutY + 1e-6) continue;
    const w = b.max.x - b.min.x;
    const d = b.max.z - b.min.z;
    if (!isFloorLike(w, d, top - b.min.y, top)) continue;
    const mat = b.faces?.py ?? b.mat;
    if (mat === null) continue;
    const info = (MATERIALS as Record<string, MaterialInfo>)[mat];
    if (info?.transparent) continue;
    const fill = lighten(tinted(mat, b.tint), 0.3);
    floorKeys.add(key(b));
    lows.push({ top, svg: rect(b.min.x, b.min.z, b.max.x, b.max.z, `fill="${fill}" stroke="${fill}" stroke-width="0.6"`) });
  }
  for (const s of map.solids) {
    const top = s.max.y;
    if (top > cutY + 1e-6 || s.noPlayers) continue;
    const w = s.max.x - s.min.x;
    const d = s.max.z - s.min.z;
    if (floorKeys.has(key(s)) || isFloorLike(w, d, top - s.min.y, top)) continue;
    // Darker when the top is closer to the cut (taller furniture).
    const k = Math.max(0, Math.min(1, (cutY - top) / 1.0));
    const g = Math.round(150 + 60 * k);
    const fill = `rgb(${g},${g + 5},${g + 12})`;
    lows.push({ top, svg: rect(s.min.x, s.min.z, s.max.x, s.max.z, `fill="${fill}" stroke="#7b8594" stroke-width="0.7"`) });
  }
  // Grid lines, drawn over everything that lies below the cut.
  const gridSvg: string[] = [];
  const gx0 = Math.ceil(min.x);
  const gz0 = Math.ceil(min.z);
  for (let x = gx0; x <= max.x; x++) {
    const major = x % 5 === 0;
    if (!major && ppm < 14) continue;
    gridSvg.push(
      `<line x1="${n2(X(x))}" y1="${MT}" x2="${n2(X(x))}" y2="${n2(Z(max.z))}" stroke="${major ? '#475569' : '#64748b'}" stroke-opacity="${major ? 0.45 : 0.13}" stroke-width="${major ? 1 : 0.6}"/>`,
    );
  }
  for (let z = gz0; z <= max.z; z++) {
    const major = z % 5 === 0;
    if (!major && ppm < 14) continue;
    gridSvg.push(
      `<line x1="${ML}" y1="${n2(Z(z))}" x2="${n2(X(max.x))}" y2="${n2(Z(z))}" stroke="${major ? '#475569' : '#64748b'}" stroke-opacity="${major ? 0.45 : 0.13}" stroke-width="${major ? 1 : 0.6}"/>`,
    );
  }
  // Round decorative primitives (plants, stools, bins…): thin outlines. Those entirely below the cut
  // take part in the painter's order (an upper floor hides them); the others are drawn on top.
  const roundAbove: string[] = [];
  for (const p of map.prims) {
    if (p.pos.y - p.size.y / 2 > cutY || Math.max(p.size.x, p.size.z) < 0.25) continue;
    if (p.rot && (Math.abs(p.rot.x) > 0.01 || Math.abs(p.rot.z) > 0.01)) continue;
    if (p.shape !== 'cyl' && p.shape !== 'sphere' && p.shape !== 'cone') continue;
    const svg = `<ellipse cx="${n2(X(p.pos.x))}" cy="${n2(Z(p.pos.z))}" rx="${n2((p.size.x / 2) * ppm)}" ry="${n2((p.size.z / 2) * ppm)}" fill="${lighten(tinted(p.mat, p.tint), 0.45)}" fill-opacity="0.75" stroke="#7b8594" stroke-width="0.6"/>`;
    const top = p.pos.y + p.size.y / 2;
    if (top <= cutY) lows.push({ top, svg });
    else roundAbove.push(svg);
  }
  lows.sort((a, b) => a.top - b.top);
  for (const l of lows) out.push(l.svg);
  out.push(...gridSvg);
  out.push(...roundAbove);

  // --- Slabs above the cut (mezzanines, ceilings): dashed outlines ---------------------------
  for (const s of map.solids) {
    if (s.min.y <= cutY || s.min.y > cutY + 2.6) continue;
    const w = s.max.x - s.min.x;
    const d = s.max.z - s.min.z;
    if (w * d < 2 || Math.min(w, d) < 0.8 || s.max.y - s.min.y > 0.6) continue;
    out.push(rect(s.min.x, s.min.z, s.max.x, s.max.z, 'fill="none" stroke="#64748b" stroke-width="1" stroke-dasharray="6 4" stroke-opacity="0.7"'));
  }

  // --- Solids crossing the cut ------------------------------------------------------------------
  const cuts = map.solids.filter((s) => s.min.y < cutY - 1e-6 && s.max.y > cutY + 1e-6 && !s.noPlayers);
  const order = (s: (typeof cuts)[number]): number => (s.noBullets ? 0 : s.surf === 'glass' ? 1 : s.max.y < cutY + 1 ? 2 : 3);
  cuts.sort((a, b) => order(a) - order(b));
  for (const s of cuts) {
    let fill = '#1f2937';
    let stroke = '#1f2937';
    if (s.noBullets) {
      fill = '#9aa3af';
      stroke = '#6b7280';
    } else if (s.surf === 'glass') {
      fill = '#7cc4ee';
      stroke = '#2b8fc7';
    } else if (s.max.y < cutY + 1) {
      fill = '#64748b';
      stroke = '#475569';
    }
    out.push(rect(s.min.x, s.min.z, s.max.x, s.max.z, `fill="${fill}" stroke="${stroke}" stroke-width="0.6"`));
  }

  // --- Zones ----------------------------------------------------------------------------------------
  const zoneColor: Record<string, string> = { site: '#f59e0b', extract: '#10b981', buy: '#6366f1' };
  const zoneText: Record<string, string> = { site: '#92400e', extract: '#065f46', buy: '#3730a3' };
  const zoneName: Record<string, string> = { site: 'Site', extract: 'Extraction', buy: 'Achat' };
  const labels: string[] = [];
  /** Label with a white halo, kept inside the map frame (labels are drawn above everything, unclipped). */
  const text = (x: number, y: number, s: string, size: number, fill: string, anchor = 'middle', weight = '600'): string => {
    const halfW = (s.length * size * 0.31) + 3;
    const cx = Math.max(ML + halfW, Math.min(ML + sizeX * ppm - halfW, x));
    const cy = Math.max(MT + size, Math.min(MT + sizeZ * ppm - 4, y));
    return `<text x="${n2(cx)}" y="${n2(cy)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${esc(s)}</text>`;
  };
  // What belongs to the storey being cut? An object is hidden when a slab (floor / ceiling) lies
  // between it and the cut plane: lower storeys are under a floor, upper storeys above a ceiling.
  const slabs = map.solids.filter((s) => {
    const w = s.max.x - s.min.x;
    const d = s.max.z - s.min.z;
    return !s.noPlayers && w * d >= 1 && Math.min(w, d) >= 0.6 && s.max.y - s.min.y <= 0.6;
  });
  const slabBetween = (x: number, z: number, yLow: number, yHigh: number): boolean =>
    slabs.some((s) => x > s.min.x && x < s.max.x && z > s.min.z && z < s.max.z && s.min.y >= yLow - 0.05 && s.max.y <= yHigh + 0.05);
  /** 0 = hidden, 0.3 = faded (far below the cut, e.g. seen through a stairwell), 1 = normal. */
  const levelOpacity = (x: number, y: number, z: number): number => {
    if (y > cutY + 0.2 || slabBetween(x, z, y, cutY)) return 0;
    return y < cutY - 3.4 ? 0.3 : 1;
  };
  const hiddenAbove = (x: number, y: number, z: number): boolean => (y <= cutY ? slabBetween(x, z, y, cutY) : slabBetween(x, z, cutY, y));
  for (const z of map.zones) {
    if (!levelOpacity((z.min.x + z.max.x) / 2, z.min.y, (z.min.z + z.max.z) / 2)) continue;
    const c = zoneColor[z.kind] ?? '#888888';
    out.push(rect(z.min.x, z.min.z, z.max.x, z.max.z, `fill="${c}" fill-opacity="0.22" stroke="${c}" stroke-width="2" stroke-dasharray="8 4"`));
    labels.push(text(X((z.min.x + z.max.x) / 2), Z((z.min.z + z.max.z) / 2) + 4, `${zoneName[z.kind] ?? z.kind} ${z.id}${z.label ? ` — ${z.label}` : ''}`, 13, zoneText[z.kind] ?? '#334155'));
  }

  // --- Lights --------------------------------------------------------------------------------------------
  for (const l of map.lights) {
    if (hiddenAbove(l.pos.x, l.pos.y, l.pos.z)) continue;
    if (opts.ranges) {
      out.push(`<circle cx="${n2(X(l.pos.x))}" cy="${n2(Z(l.pos.z))}" r="${n2(l.range * ppm)}" fill="none" stroke="#eab308" stroke-opacity="0.25" stroke-width="0.8"/>`);
    }
    out.push(`<circle cx="${n2(X(l.pos.x))}" cy="${n2(Z(l.pos.z))}" r="${Math.max(2, ppm * 0.07)}" fill="#facc15" stroke="#854d0e" stroke-width="0.7"/>`);
  }

  // --- Signs ----------------------------------------------------------------------------------------------
  for (const s of map.signs) {
    if (hiddenAbove(s.pos.x, s.pos.y, s.pos.z)) continue;
    const cx = X(s.pos.x);
    const cz = Z(s.pos.z);
    const hw = (s.w / 2) * ppm;
    if (s.facing >= 4) {
      const hh = (s.h / 2) * ppm;
      out.push(`<rect x="${n2(cx - hw)}" y="${n2(cz - hh)}" width="${n2(hw * 2)}" height="${n2(hh * 2)}" fill="#a855f7" fill-opacity="0.12" stroke="#a855f7" stroke-width="0.8" stroke-dasharray="3 2"/>`);
    } else {
      // Tick along the wall + a short stroke toward the side the sign faces.
      const nx = [0, 1, 0, -1][s.facing]!;
      const nz = [1, 0, -1, 0][s.facing]!;
      const tx = -nz;
      const tz = nx;
      out.push(`<line x1="${n2(cx - tx * hw)}" y1="${n2(cz - tz * hw)}" x2="${n2(cx + tx * hw)}" y2="${n2(cz + tz * hw)}" stroke="#a855f7" stroke-width="2"/>`);
      out.push(`<line x1="${n2(cx)}" y1="${n2(cz)}" x2="${n2(cx + nx * 5)}" y2="${n2(cz + nz * 5)}" stroke="#a855f7" stroke-width="1.2"/>`);
      if (opts.signs) labels.push(text(cx + nx * 14, cz + nz * 14 + 3, s.text, 8, '#6b21a8', 'middle', '400'));
    }
  }

  // --- Points -------------------------------------------------------------------------------------------------
  for (const p of map.points) {
    const op = levelOpacity(p.pos.x, p.pos.y, p.pos.z);
    if (!op) continue;
    const cx = X(p.pos.x);
    const cz = Z(p.pos.z);
    const r = 5;
    const c = p.kind === 'sample' ? '#0ea5e9' : '#0f766e';
    out.push(`<path d="M ${n2(cx)} ${n2(cz - r)} L ${n2(cx + r)} ${n2(cz)} L ${n2(cx)} ${n2(cz + r)} L ${n2(cx - r)} ${n2(cz)} Z" fill="${c}" stroke="#ffffff" stroke-width="1" opacity="${op}"/>`);
    if (op === 1) labels.push(text(cx, cz - 9, p.label ?? p.id, 11, '#134e4a'));
  }

  // --- Spawns ---------------------------------------------------------------------------------------------------
  map.spawns.forEach((s) => {
    const op = levelOpacity(s.pos.x, s.pos.y, s.pos.z);
    if (!op) return;
    const c = TEAM_COLORS[s.team] ?? '#888888';
    const cx = X(s.pos.x);
    const cz = Z(s.pos.z);
    const u = ppm; // 1 m
    const deg = (-s.yaw * 180) / Math.PI;
    out.push(
      `<g transform="translate(${n2(cx)} ${n2(cz)}) rotate(${n2(deg)})" opacity="${op}">` +
        `<circle r="${n2(0.35 * u)}" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="1"/>` +
        `<path d="M 0 ${n2(-0.62 * u)} L ${n2(0.26 * u)} ${n2(0.16 * u)} L 0 ${n2(0.02 * u)} L ${n2(-0.26 * u)} ${n2(0.16 * u)} Z" fill="${c}" stroke="#ffffff" stroke-width="0.8"/>` +
        '</g>',
    );
  });

  // --- Leaks --------------------------------------------------------------------------------------------------------
  const leaks = opts.leaks ?? [];
  for (const l of leaks) {
    const cx = X(l.pos.x);
    const cz = Z(l.pos.z);
    if (l.path.length > 1) {
      out.push(`<polyline points="${l.path.map((p) => `${n2(X(p.x))},${n2(Z(p.z))}`).join(' ')} ${n2(cx)},${n2(cz)}" fill="none" stroke="#dc2626" stroke-width="1.5" stroke-dasharray="5 3"/>`);
    }
    out.push(`<path d="M ${n2(cx - 8)} ${n2(cz - 8)} L ${n2(cx + 8)} ${n2(cz + 8)} M ${n2(cx + 8)} ${n2(cz - 8)} L ${n2(cx - 8)} ${n2(cz + 8)}" stroke="#dc2626" stroke-width="3.5" stroke-linecap="round"/>`);
    labels.push(text(cx, cz - 12, 'FUITE', 12, '#b91c1c'));
  }
  out.push('</g>');
  out.push(...labels);

  // --- Frame, coordinates, title block -----------------------------------------------------------------------------
  out.push(rect(min.x, min.z, max.x, max.z, 'fill="none" stroke="#0f172a" stroke-width="1.5"'));
  const step = ppm * 5 < 34 ? 10 : 5;
  for (let x = Math.ceil(min.x / step) * step; x <= max.x; x += step) {
    out.push(`<line x1="${n2(X(x))}" y1="${MT - 6}" x2="${n2(X(x))}" y2="${MT}" stroke="#0f172a" stroke-width="1"/>`);
    out.push(`<line x1="${n2(X(x))}" y1="${n2(Z(max.z))}" x2="${n2(X(x))}" y2="${n2(Z(max.z) + 6)}" stroke="#0f172a" stroke-width="1"/>`);
    out.push(`<text x="${n2(X(x))}" y="${MT - 10}" font-size="12" text-anchor="middle" fill="#0f172a">${x}</text>`);
    out.push(`<text x="${n2(X(x))}" y="${n2(Z(max.z) + 19)}" font-size="12" text-anchor="middle" fill="#0f172a">${x}</text>`);
  }
  for (let z = Math.ceil(min.z / step) * step; z <= max.z; z += step) {
    out.push(`<line x1="${ML - 6}" y1="${n2(Z(z))}" x2="${ML}" y2="${n2(Z(z))}" stroke="#0f172a" stroke-width="1"/>`);
    out.push(`<line x1="${n2(X(max.x))}" y1="${n2(Z(z))}" x2="${n2(X(max.x) + 6)}" y2="${n2(Z(z))}" stroke="#0f172a" stroke-width="1"/>`);
    out.push(`<text x="${ML - 10}" y="${n2(Z(z) + 4)}" font-size="12" text-anchor="end" fill="#0f172a">${z}</text>`);
    out.push(`<text x="${n2(X(max.x) + 10)}" y="${n2(Z(z) + 4)}" font-size="12" text-anchor="start" fill="#0f172a">${z}</text>`);
  }
  // Axis names.
  out.push(`<text x="${n2(X(max.x) + 8)}" y="${MT - 10}" font-size="12" font-weight="700" fill="#0f172a">X →</text>`);
  out.push(`<text x="${ML - 10}" y="${n2(Z(max.z) + 19)}" font-size="12" font-weight="700" text-anchor="end" fill="#0f172a">Z ↓</text>`);
  // Title.
  out.push(`<text x="${ML}" y="26" font-size="20" font-weight="700" fill="#003f71">${esc(map.meta.name)}</text>`);
  out.push(
    `<text x="${ML}" y="44" font-size="12" fill="#475569">${esc(map.meta.id)} — coupe à y = ${fr(cutY, 2)} m — ${fr(sizeX)} × ${fr(sizeZ)} m — ` +
      `${map.solids.length} solides, ${map.lights.length} lumières, ${map.spawns.length} apparitions — 1 m = ${ppm} px</text>`,
  );
  // Scale bar.
  const by = H - MB + 44;
  const barM = ppm * 10 <= 420 ? 10 : 5;
  out.push(`<g transform="translate(${ML} ${by})">`);
  for (let i = 0; i < barM; i++) {
    out.push(`<rect x="${i * ppm}" y="0" width="${ppm}" height="7" fill="${i % 2 ? '#ffffff' : '#0f172a'}" stroke="#0f172a" stroke-width="1"/>`);
  }
  out.push(`<text x="0" y="22" font-size="12" fill="#0f172a" text-anchor="middle">0</text>`);
  out.push(`<text x="${(barM / 2) * ppm}" y="22" font-size="12" fill="#0f172a" text-anchor="middle">${barM / 2}</text>`);
  out.push(`<text x="${barM * ppm}" y="22" font-size="12" fill="#0f172a" text-anchor="middle">${barM} m</text>`);
  out.push('</g>');
  // Legend.
  const legend: [string, string][] = [
    ['<rect x="0" y="-9" width="16" height="10" fill="#1f2937"/>', 'mur / solide haut'],
    ['<rect x="0" y="-9" width="16" height="10" fill="#64748b"/>', 'solide mi-hauteur'],
    ['<rect x="0" y="-9" width="16" height="10" fill="#c3c9d2" stroke="#7b8594" stroke-width="0.7"/>', 'mobilier bas'],
    ['<rect x="0" y="-9" width="16" height="10" fill="#7cc4ee" stroke="#2b8fc7"/>', 'vitrage'],
    ['<rect x="0" y="-6" width="16" height="4" fill="#9aa3af" stroke="#6b7280" stroke-width="0.6"/>', 'garde-corps'],
    ['<rect x="0" y="-9" width="16" height="10" fill="none" stroke="#64748b" stroke-dasharray="4 3"/>', 'dalle au-dessus'],
    [`<path d="M 8 -12 L 13 0 L 8 -3 L 3 0 Z" fill="${TEAM_COLORS[0]}"/>`, 'Équipe Labo'],
    [`<path d="M 8 -12 L 13 0 L 8 -3 L 3 0 Z" fill="${TEAM_COLORS[1]}"/>`, 'Les Auditeurs'],
    ['<circle cx="8" cy="-4" r="3.5" fill="#facc15" stroke="#854d0e" stroke-width="0.7"/>', 'lumière'],
    ['<line x1="1" y1="-4" x2="15" y2="-4" stroke="#a855f7" stroke-width="2"/>', 'panneau'],
    ['<path d="M 8 -10 L 13 -4 L 8 2 L 3 -4 Z" fill="#0f766e"/>', 'point'],
    ['<rect x="0" y="-9" width="16" height="10" fill="#f59e0b" fill-opacity="0.25" stroke="#f59e0b" stroke-dasharray="4 2"/>', 'zone'],
  ];
  let lx = ML;
  let ly = H - MB + 96;
  for (const [glyph, name] of legend) {
    const wEntry = 28 + name.length * 6.6;
    if (lx + wEntry > W - MR) {
      lx = ML;
      ly += 20;
    }
    out.push(`<g transform="translate(${n2(lx)} ${ly})">${glyph}<text x="22" y="0" font-size="11.5" fill="#334155">${esc(name)}</text></g>`);
    lx += wEntry + 8;
  }
  out.push('</svg>');
  return { svg: out.join('\n'), width: W, height: H, scale: ppm, cutY };
}

/** Rasterises an SVG to PNG with Playwright (headless Chromium). Returns false if Playwright is unavailable. */
export async function svgToPng(svg: string, width: number, height: number, file: string): Promise<boolean> {
  interface Page {
    setContent(html: string): Promise<void>;
    screenshot(o: { path: string; clip?: { x: number; y: number; width: number; height: number } }): Promise<unknown>;
  }
  interface Browser {
    newPage(o: { viewport: { width: number; height: number }; deviceScaleFactor: number }): Promise<Page>;
    close(): Promise<void>;
  }
  let chromium: { launch(): Promise<Browser> };
  try {
    chromium = (createRequire(import.meta.url)('playwright') as { chromium: { launch(): Promise<Browser> } }).chromium;
  } catch {
    return false;
  }
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
  } finally {
    await browser.close();
  }
  return true;
}

async function main(argv: string[]): Promise<number> {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (['--y', '--out', '--scale'].includes(a) && next !== undefined) {
        flags.set(a, next);
        i++;
      } else flags.set(a, 'true');
    } else positional.push(a);
  }
  const id = positional[0];
  const mod = MAP_MODULES.find((m) => m.meta.id === id);
  if (!mod) {
    console.error(id ? `Carte inconnue : « ${id} ».` : 'Aucune carte indiquée.');
    console.error(`Cartes disponibles : ${MAP_MODULES.map((m) => m.meta.id).join(', ')}.`);
    console.error('Usage : npx tsx tools/map-plan.ts <mapId> [--y 1.0] [--out tools/out] [--scale 30] [--no-png] [--ranges] [--signs]');
    return 2;
  }
  const map = mod.build();
  const outDir = flags.get('--out') ?? 'tools/out';
  mkdirSync(outDir, { recursive: true });
  const opts: PlanOptions = {};
  if (flags.has('--y')) opts.y = Number(flags.get('--y'));
  if (flags.has('--scale')) opts.scale = Number(flags.get('--scale'));
  if (flags.has('--ranges')) opts.ranges = true;
  if (flags.has('--signs')) opts.signs = true;
  if ((opts.y !== undefined && !Number.isFinite(opts.y)) || (opts.scale !== undefined && !(opts.scale > 0))) {
    console.error('Valeur numérique invalide pour --y ou --scale.');
    return 2;
  }
  if (map.spawns.length) opts.leaks = floodFill(map, map.spawns.map((s) => s.pos)).leaks;
  const plan = renderPlan(map, opts);
  const suffix = flags.has('--y') ? `_y${String(opts.y).replace('.', '_')}` : '';
  const svgFile = join(outDir, `plan_${map.meta.id}${suffix}.svg`);
  writeFileSync(svgFile, plan.svg);
  console.log(`Plan de « ${map.meta.name} » : coupe à y = ${fr(plan.cutY, 2)} m, ${plan.scale} px/m, ${plan.width} × ${plan.height} px`);
  console.log(`  SVG : ${svgFile}`);
  if (opts.leaks?.length) console.log(`  Attention : ${opts.leaks.length} fuite(s) marquée(s) d'une croix rouge.`);
  if (!flags.has('--no-png')) {
    const pngFile = svgFile.replace(/\.svg$/, '.png');
    try {
      if (await svgToPng(plan.svg, plan.width, plan.height, pngFile)) console.log(`  PNG : ${pngFile}`);
      else console.log('  PNG non généré : Playwright est introuvable (le SVG reste utilisable).');
    } catch (e) {
      console.log(`  PNG non généré : ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
    }
  }
  return 0;
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
