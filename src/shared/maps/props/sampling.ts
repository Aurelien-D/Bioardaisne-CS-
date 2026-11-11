/**
 * Sampling-room props (salles de prélèvement): phlebotomy chair, stool, trolley, couch…
 * Local space: origin at floor level, centre of the footprint, front facing +Z.
 */
import type { MapBuilder } from '../builder';
import type { MaterialId } from '../materials';
import { C, bx, casters, cyl, cylX, cylZ, handle, hull, starBase, tilt, type PropInfo } from './kit';
import { miniRack, sharpsBox } from './lab';

/** Fauteuil de prélèvement: reclined phlebotomy chair with wide arm rests (0.95 × 1.3 × 1.4 m). */
export function phlebotomyChair(b: MapBuilder, o: { mat?: MaterialId; tint?: number } = {}): void {
  const mat = o.mat ?? 'fabric_blue';
  const pad = 0xc8d4e4;
  bx(b, 0, 0, 0, 0.62, 0.04, 0.72, 'metal_dark');
  bx(b, 0, 0.04, -0.04, 0.16, 0.38, 0.16, 'metal_brushed');
  bx(b, 0, 0.42, 0.02, 0.56, 0.1, 0.54, mat, o.tint); // seat
  tilt(b, 0, 0.88, -0.37, 0.54, 0.8, 0.09, -18, mat, o.tint); // back
  tilt(b, 0, 1.32, -0.515, 0.3, 0.16, 0.09, -18, mat, 0xd0d8e4); // head rest
  tilt(b, 0, 0.285, 0.4, 0.5, 0.42, 0.06, -32, mat, o.tint); // leg rest
  bx(b, 0, 0.09, 0.5, 0.4, 0.025, 0.2, 'metal_brushed'); // foot plate
  for (const s of [-1, 1]) {
    bx(b, s * 0.36, 0.44, -0.02, 0.04, 0.2, 0.04, 'metal_brushed');
    bx(b, s * 0.37, 0.62, 0.02, 0.06, 0.02, 0.36, 'metal_brushed');
  }
  // arm rests: the left one is swung out and pushed forward, ready for the tourniquet
  bx(b, 0.39, 0.64, 0.08, 0.15, 0.05, 0.5, mat, pad);
  tilt(b, -0.43, 0.665, 0.22, 0.15, 0.05, 0.56, 0, mat, pad, -14);
  hull(b, 0, 0, 0.02, 0.9, 0.7, 0.9, 'fabric');
  hull(b, 0, 0.7, -0.42, 0.56, 0.68, 0.34, 'fabric');
}

/** Tabouret à roulettes: rolling stool (0.5 × 0.5 × 0.5 m). */
export function stool(b: MapBuilder, o: { mat?: MaterialId } = {}): void {
  const top = starBase(b, 0.25);
  cyl(b, 0, top, 0, 0.05, 0.3, 'metal_brushed', undefined, 8);
  cyl(b, 0, 0.3, 0, 0.22, 0.015, 'metal_brushed', undefined, 12); // foot ring
  cyl(b, 0, 0.42, 0, 0.36, 0.08, o.mat ?? 'fabric_blue', undefined, 12);
  hull(b, 0, 0, 0, 0.36, 0.5, 0.36, 'fabric');
}

/** Chariot de prélèvement: drawer trolley with tube racks and a sharps box (0.72 × 0.47 × 1.05 m). */
export function samplingTrolley(b: MapBuilder): void {
  casters(b, 0.66, 0.42, 0.09);
  bx(b, 0, 0.09, 0, 0.66, 0.69, 0.44, 'metal_white');
  const fronts = [C.blue, C.red, 0xe9c63a, 0x58b368];
  fronts.forEach((tint, k) => {
    const y = 0.11 + k * 0.165;
    bx(b, 0, y, 0.226, 0.62, 0.15, 0.014, 'plastic_white', tint);
    handle(b, 0, y + 0.1, 0.233, 0.2);
  });
  bx(b, 0, 0.78, 0, 0.7, 0.02, 0.46, 'metal_brushed');
  for (const s of [-1, 1]) {
    bx(b, 0, 0.8, s * 0.224, 0.7, 0.035, 0.012, 'metal_brushed');
    bx(b, s * 0.344, 0.8, 0, 0.012, 0.035, 0.44, 'metal_brushed');
  }
  cylZ(b, -0.39, 0.86, 0, 0.028, 0.44, 'metal_brushed', undefined, 8); // push bar
  for (const s of [-1, 1]) bx(b, -0.365, 0.8, s * 0.2, 0.05, 0.075, 0.025, 'metal_brushed');
  // on top: racks, sharps box, glove box, cotton jar, tourniquet
  miniRack(b, -0.16, 0.8, 0.1, 0, 'plastic_white');
  miniRack(b, -0.16, 0.8, -0.02, 2);
  miniRack(b, -0.16, 0.8, -0.14, 4, 'plastic_white');
  b.at(0.24, 0.8, -0.11, 0, () => sharpsBox(b));
  bx(b, 0.2, 0.8, 0.12, 0.24, 0.07, 0.12, 'cardboard', 0xcfe2f3);
  bx(b, 0.2, 0.87, 0.12, 0.1, 0.012, 0.05, 'plastic_white', 0x9ec5ea);
  cyl(b, 0.04, 0.8, -0.13, 0.08, 0.1, 'glass', undefined, 8);
  cyl(b, 0.04, 0.9, -0.13, 0.085, 0.015, 'metal_brushed', undefined, 8);
  cylX(b, 0.02, 0.815, 0.0, 0.03, 0.2, 'plastic_blue', C.navy, 6);
  hull(b, 0, 0, 0, 0.7, 0.95, 0.46, 'metal');
}

/** Lit d'examen: examination couch with a raised head section and a paper roll (1.95 × 0.65 × 0.85 m). */
export function examCouch(b: MapBuilder, o: { mat?: MaterialId; tint?: number } = {}): void {
  const mat = o.mat ?? 'fabric_blue';
  const tint = o.tint ?? 0xb8c8e0;
  for (const sx of [-0.82, 0.78]) for (const sz of [-1, 1]) bx(b, sx, 0, sz * 0.27, 0.04, 0.5, 0.04, 'metal_brushed');
  for (const sz of [-1, 1]) bx(b, -0.02, 0.46, sz * 0.27, 1.64, 0.04, 0.04, 'metal_brushed');
  for (const sx of [-0.82, 0.78]) bx(b, sx, 0.2, 0, 0.03, 0.03, 0.54, 'metal_brushed');
  bx(b, -0.02, 0.2, 0, 1.6, 0.02, 0.4, 'metal_grey', 0xdfe3e6); // lower shelf
  bx(b, -0.27, 0.5, 0, 1.36, 0.1, 0.62, mat, tint); // mattress
  tilt(b, 0.665, 0.67, 0, 0.56, 0.1, 0.62, 0, mat, tint, 0, 24); // head section
  bx(b, -0.27, 0.6, 0, 1.34, 0.004, 0.46, 'paper_white');
  tilt(b, 0.645, 0.716, 0, 0.54, 0.004, 0.46, 0, 'paper_white', undefined, 0, 24);
  cylZ(b, 0.95, 0.56, 0, 0.11, 0.5, 'paper_white', undefined, 10); // paper roll
  for (const sz of [-1, 1]) bx(b, 0.9, 0.5, sz * 0.27, 0.12, 0.08, 0.02, 'metal_brushed');
  hull(b, -0.02, 0, 0, 1.9, 0.62, 0.65, 'fabric');
  hull(b, 0.66, 0.62, 0, 0.5, 0.2, 0.65, 'fabric');
}

/** Lavabo: wall-mounted wash basin with splash-back, soap and paper towels. Back against the wall. */
export function washBasin(b: MapBuilder): void {
  const zb = -0.24; // wall plane
  bx(b, 0, 0.78, zb + 0.006, 0.76, 0.84, 0.012, 'wall_tile_white');
  // ceramic basin: bottom + four walls
  bx(b, 0, 0.72, 0, 0.56, 0.03, 0.4, 'plastic_white');
  bx(b, 0, 0.75, 0.185, 0.56, 0.13, 0.04, 'plastic_white');
  bx(b, 0, 0.75, zb + 0.045, 0.56, 0.13, 0.09, 'plastic_white');
  for (const s of [-1, 1]) bx(b, s * 0.26, 0.75, 0.01, 0.04, 0.13, 0.31, 'plastic_white');
  cyl(b, 0, 0.75, 0.02, 0.05, 0.004, 'metal_dark', undefined, 8);
  bx(b, 0, 0, zb + 0.11, 0.2, 0.72, 0.2, 'plastic_white'); // pedestal
  cyl(b, 0, 0.88, zb + 0.06, 0.035, 0.13, 'metal_brushed', undefined, 8);
  cylZ(b, 0, 1.0, zb + 0.13, 0.028, 0.16, 'metal_brushed', undefined, 8);
  bx(b, 0.07, 0.9, zb + 0.06, 0.07, 0.02, 0.025, 'metal_brushed');
  // soap dispenser and paper-towel dispenser
  bx(b, -0.25, 1.12, zb + 0.05, 0.09, 0.17, 0.075, 'plastic_white');
  bx(b, -0.25, 1.17, zb + 0.089, 0.05, 0.07, 0.003, 'plastic_white', C.blue);
  bx(b, -0.25, 1.1, zb + 0.07, 0.04, 0.02, 0.05, 'plastic_grey');
  bx(b, 0.12, 1.3, zb + 0.06, 0.3, 0.34, 0.1, 'plastic_white');
  bx(b, 0.12, 1.31, zb + 0.111, 0.2, 0.02, 0.003, 'plastic_black');
  bx(b, 0.12, 1.24, zb + 0.105, 0.14, 0.08, 0.002, 'paper_white');
  hull(b, 0, 0, -0.02, 0.56, 0.9, 0.44, 'tile');
}

/** Armoire murale: wall cabinet hung at 1.4–2.1 m (1.0 × 0.35 m). */
export function wallCabinet(b: MapBuilder, o: { width?: number; glass?: boolean } = {}): void {
  const w = o.width ?? 1;
  const n = Math.max(1, Math.round(w / 0.5));
  if (o.glass) {
    // open carcass: back, sides, top, bottom, one shelf, a few boxes behind glass doors
    bx(b, 0, 1.4, -0.165, w, 0.7, 0.02, 'plastic_white');
    for (const s of [-1, 1]) bx(b, s * (w / 2 - 0.01), 1.4, 0, 0.02, 0.7, 0.33, 'plastic_white');
    bx(b, 0, 1.4, 0, w - 0.04, 0.02, 0.33, 'plastic_white');
    bx(b, 0, 2.08, 0, w - 0.04, 0.02, 0.33, 'plastic_white');
    bx(b, 0, 1.74, -0.01, w - 0.04, 0.015, 0.3, 'plastic_white');
    for (let i = 0; i < n * 2; i++) {
      const x = -w / 2 + ((i + 0.5) * w) / (n * 2);
      bx(b, x, i % 2 ? 1.755 : 1.42, -0.02, 0.16, 0.12 + (i % 3) * 0.04, 0.2, 'plastic_white', [C.blue, 0xe9d28a, 0xffffff, C.red][i % 4]!);
    }
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + ((i + 0.5) * w) / n;
      bx(b, x, 1.42, 0.17, w / n - 0.03, 0.66, 0.01, 'glass');
      handle(b, x + (i % 2 ? -1 : 1) * (w / n / 2 - 0.05), 1.55, 0.172, 0.12, true);
    }
  } else {
    bx(b, 0, 1.4, -0.01, w, 0.7, 0.33, 'plastic_white');
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + ((i + 0.5) * w) / n;
      bx(b, x, 1.406, 0.164, w / n - 0.02, 0.688, 0.018, 'plastic_white', C.front);
      handle(b, x + (i % 2 ? -1 : 1) * (w / n / 2 - 0.05), 1.5, 0.173, 0.12, true);
    }
  }
  bx(b, 0, 1.385, 0.05, w * 0.7, 0.015, 0.08, 'light_panel'); // under-cabinet light
  hull(b, 0, 1.4, 0, w, 0.7, 0.35, 'wood');
}

export const SAMPLING_PROPS: PropInfo[] = [
  { id: 'phlebotomy_chair', label: 'Fauteuil de prélèvement', family: 'prelevement', footprint: [1, 1.3, 1.42], cover: 'low', mount: 'floor', build: (b) => phlebotomyChair(b) },
  { id: 'stool', label: 'Tabouret à roulettes', family: 'prelevement', footprint: [0.52, 0.52, 0.5], cover: 'none', mount: 'floor', build: (b) => stool(b) },
  { id: 'sampling_trolley', label: 'Chariot de prélèvement', family: 'prelevement', footprint: [0.75, 0.47, 1.05], cover: 'low', mount: 'floor', build: (b) => samplingTrolley(b) },
  { id: 'exam_couch', label: "Lit d'examen", family: 'prelevement', footprint: [1.95, 0.65, 0.85], cover: 'none', mount: 'floor', build: (b) => examCouch(b) },
  { id: 'wash_basin', label: 'Lavabo', family: 'prelevement', footprint: [0.76, 0.48, 1.65], cover: 'none', mount: 'wall', build: (b) => washBasin(b) },
  { id: 'wall_cabinet', label: 'Armoire murale', family: 'prelevement', footprint: [1, 0.35, 2.1], cover: 'none', mount: 'wall', build: (b) => wallCabinet(b) },
  { id: 'wall_cabinet_glass', label: 'Armoire murale vitrée', family: 'prelevement', footprint: [1, 0.35, 2.1], cover: 'none', mount: 'wall', build: (b) => wallCabinet(b, { glass: true }) },
];
