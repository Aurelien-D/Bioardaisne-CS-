/**
 * Laboratory props: benches, analysers, cold storage, consumables.
 * Local space: origin at floor level (or on the bench top for 'bench' props),
 * centre of the footprint, front facing +Z. See props/kit.ts for the authoring rules.
 */
import type { MapBuilder } from '../builder';
import type { MaterialId } from '../materials';
import { hash3, mulberry32 } from '../../math/rng';
import { C, CAP_MATS, ball, bx, carton, casters, cyl, cylX, cylZ, handle, hull, led, screen, tilt, tube, type PropInfo } from './kit';

// ---------------------------------------------------------------------------------
// Benches
// ---------------------------------------------------------------------------------

/**
 * Cupboard / drawer fronts on a vertical face at depth `z` (facing +Z), for a run of
 * width `w` centred on x = 0. Modules are ~0.5 m wide and alternate doors and drawers.
 */
export function cabinetFronts(b: MapBuilder, w: number, z: number, y0: number, h: number, seed = 0, tint: number = C.front): void {
  const n = Math.max(1, Math.round(w / 0.5));
  const mw = w / n;
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + (i + 0.5) * mw;
    const drawers = (i + seed) % 3 === 1;
    if (drawers) {
      const dh = h / 3;
      for (let k = 0; k < 3; k++) {
        bx(b, cx, y0 + k * dh + 0.006, z + 0.009, mw - 0.02, dh - 0.012, 0.018, 'plastic_white', tint);
        handle(b, cx, y0 + (k + 0.72) * dh, z + 0.018, Math.min(0.16, mw * 0.4));
      }
    } else {
      bx(b, cx, y0 + 0.006, z + 0.009, mw - 0.02, h - 0.012, 0.018, 'plastic_white', tint);
      const side = i % 2 === 0 ? 1 : -1;
      handle(b, cx + side * (mw / 2 - 0.06), y0 + h - 0.16, z + 0.018, 0.14, true);
    }
  }
}

export interface LabBenchOpts {
  /** Length of the bench (default 2). Any length ≥ 0.6 works; modules are ~0.5 m wide. */
  width?: number;
  /** 'plain' (default), 'sink' (basin + tap at the +X end) or 'shelf' (overhead reagent shelf). */
  variant?: 'plain' | 'sink' | 'shelf';
  seed?: number;
}

/** Paillasse: lab bench with cupboards and drawers, 0.7 m deep, 0.9 m high (jump-on height). */
export function labBench(b: MapBuilder, o: LabBenchOpts = {}): void {
  const w = o.width ?? 2;
  const variant = o.variant ?? 'plain';
  const d = 0.7;
  const zf = d / 2 - 0.03; // front of the carcass
  bx(b, 0, 0, -0.04, w - 0.04, 0.1, d - 0.12, 'plastic_grey', 0x6a6f75); // recessed plinth
  const sinkW = variant === 'sink' ? 0.5 : 0;
  const mainW = w - sinkW;
  const mainX = -sinkW / 2;
  bx(b, mainX, 0.1, -0.015, mainW, 0.76, d - 0.03, 'plastic_white');
  b.at(mainX, 0, 0, 0, () => cabinetFronts(b, mainW - 0.02, zf, 0.12, 0.72, o.seed ?? 0));
  if (variant === 'sink') {
    const xs0 = w / 2 - sinkW; // the sink module spans xs0 .. w/2
    const sx = w / 2 - sinkW / 2;
    const hz = 0.03; // centre of the basin
    const hw = 0.42; // basin size (square)
    // low carcass under the basin, closed by an apron, with its own door
    bx(b, sx, 0.1, -0.015, sinkW, 0.58, d - 0.03, 'plastic_white');
    bx(b, w / 2 - 0.01, 0.68, -0.015, 0.02, 0.18, d - 0.03, 'plastic_white');
    bx(b, sx - 0.01, 0.68, zf - 0.01, sinkW - 0.02, 0.18, 0.02, 'plastic_white');
    bx(b, sx - 0.01, 0.68, -d / 2 + 0.01, sinkW - 0.02, 0.18, 0.02, 'plastic_white');
    bx(b, sx, 0.126, zf + 0.009, sinkW - 0.02, 0.708, 0.018, 'plastic_white', C.front);
    handle(b, xs0 + 0.07, 0.68, zf + 0.018, 0.14, true);
    // worktop: main run + four strips around the basin
    bx(b, mainX - 0.005, 0.86, 0, mainW + 0.01, 0.04, d + 0.02, 'laminate_white');
    bx(b, sx + 0.005, 0.86, d / 2 - 0.05, sinkW + 0.01, 0.04, 0.12, 'laminate_white');
    bx(b, sx + 0.005, 0.86, -d / 2 + 0.08, sinkW + 0.01, 0.04, 0.18, 'laminate_white');
    bx(b, xs0 + 0.02, 0.86, hz, 0.04, 0.04, hw, 'laminate_white');
    bx(b, w / 2 - 0.015, 0.86, hz, 0.05, 0.04, hw, 'laminate_white');
    // stainless basin
    bx(b, sx, 0.68, hz, hw, 0.02, hw, 'metal_brushed');
    for (const s of [-1, 1]) {
      bx(b, sx + s * (hw / 2 - 0.008), 0.7, hz, 0.016, 0.195, hw, 'metal_brushed');
      bx(b, sx, 0.7, hz + s * (hw / 2 - 0.008), hw - 0.032, 0.195, 0.016, 'metal_brushed');
    }
    cyl(b, sx, 0.7, hz, 0.05, 0.004, 'metal_dark', undefined, 8);
    // swan-neck tap, blue lever, soap bottle
    const zt = -d / 2 + 0.08;
    cyl(b, sx, 0.9, zt, 0.035, 0.3, 'metal_brushed', undefined, 8);
    cylZ(b, sx, 1.185, zt + 0.095, 0.03, 0.2, 'metal_brushed', undefined, 8);
    cyl(b, sx, 1.11, zt + 0.18, 0.028, 0.075, 'metal_brushed', undefined, 8);
    bx(b, sx + 0.08, 0.9, zt, 0.05, 0.035, 0.03, 'plastic_blue');
    cyl(b, sx - 0.15, 0.9, zt, 0.06, 0.13, 'plastic_white', C.light, 8);
    cyl(b, sx - 0.15, 1.03, zt, 0.02, 0.05, 'plastic_blue', undefined, 6);
  } else {
    bx(b, 0, 0.86, 0, w + 0.02, 0.04, d + 0.02, 'laminate_white');
  }
  hull(b, 0, 0, 0, w, 0.9, d, 'wood');

  if (variant === 'shelf') {
    const rng = mulberry32(hash3(o.seed ?? 0, 77));
    const zs = -d / 2 + 0.13;
    for (const sx of [-1, 1]) bx(b, sx * (w / 2 - 0.02), 0.9, zs, 0.03, 0.82, 0.24, 'metal_grey');
    if (w > 2.6) bx(b, 0, 0.9, zs, 0.03, 0.82, 0.24, 'metal_grey');
    bx(b, 0, 1.3, zs, w - 0.04, 0.025, 0.26, 'laminate_white');
    bx(b, 0, 1.7, zs, w - 0.04, 0.025, 0.26, 'laminate_white');
    bx(b, 0, 0.9, -d / 2 + 0.012, w - 0.07, 0.42, 0.012, 'plastic_white', C.light); // splash-back
    // reagents and boxes on the shelves
    const count = Math.max(4, Math.round(w * 3.5));
    for (let i = 0; i < count; i++) {
      const x = -w / 2 + 0.2 + ((w - 0.4) * i) / (count - 1) + (rng() - 0.5) * 0.06;
      const level = i % 2 === 0 ? 1.325 : 1.725;
      const kind = Math.floor(rng() * 3);
      if (kind === 0) {
        cyl(b, x, level, zs, 0.09, 0.2, 'plastic_white', undefined, 8);
        cyl(b, x, level + 0.2, zs, 0.045, 0.04, CAP_MATS[i % CAP_MATS.length]!, undefined, 8);
      } else if (kind === 1) {
        bx(b, x, level, zs, 0.2, 0.12, 0.16, 'cardboard', 0xf2efe6);
        bx(b, x, level + 0.03, zs + 0.081, 0.12, 0.05, 0.003, 'plastic_white', C.blue);
      } else {
        bx(b, x, level, zs, 0.14, 0.18, 0.14, 'plastic_white', i % 3 === 0 ? C.blue : 0xe9d28a);
      }
    }
    hull(b, 0, 0.9, zs, w, 0.85, 0.26, 'wood');
  }
}

/** Paillasse centrale: double-sided island bench with a central reagent shelf. */
export function islandBench(b: MapBuilder, o: { width?: number; seed?: number } = {}): void {
  const w = o.width ?? 2.4;
  const d = 1.5;
  bx(b, 0, 0, 0, w - 0.06, 0.1, d - 0.16, 'plastic_grey', 0x6a6f75);
  bx(b, 0, 0.1, 0, w, 0.76, d - 0.06, 'plastic_white');
  bx(b, 0, 0.86, 0, w + 0.02, 0.04, d + 0.02, 'laminate_white');
  cabinetFronts(b, w - 0.02, d / 2 - 0.03, 0.12, 0.72, o.seed ?? 0);
  b.at(0, 0, 0, 2, () => cabinetFronts(b, w - 0.02, d / 2 - 0.03, 0.12, 0.72, (o.seed ?? 0) + 1));
  // central riser: uprights, two shelves, power strip
  for (const sx of [-1, 1]) bx(b, sx * (w / 2 - 0.12), 0.9, 0, 0.04, 0.7, 0.3, 'metal_grey');
  bx(b, 0, 1.22, 0, w - 0.2, 0.025, 0.32, 'laminate_white');
  bx(b, 0, 1.58, 0, w - 0.2, 0.025, 0.32, 'laminate_white');
  bx(b, 0, 0.9, 0, w - 0.3, 0.07, 0.08, 'plastic_grey');
  for (let i = 0; i < 4; i++) bx(b, -w / 2 + 0.4 + (i * (w - 0.8)) / 3, 0.92, 0.041, 0.05, 0.035, 0.003, 'plastic_white');
  const rng = mulberry32(hash3(o.seed ?? 0, 91));
  const count = Math.max(4, Math.round(w * 2));
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + 0.35 + ((w - 0.7) * i) / (count - 1);
    const level = i % 2 === 0 ? 1.245 : 1.605;
    if (rng() < 0.5) {
      cyl(b, x, level, 0, 0.09, 0.18, 'plastic_white', undefined, 8);
      cyl(b, x, level + 0.18, 0, 0.045, 0.04, CAP_MATS[(i + 1) % CAP_MATS.length]!, undefined, 8);
    } else {
      bx(b, x, level, 0, 0.22, 0.13, 0.2, 'cardboard', i % 3 === 0 ? 0xf2efe6 : undefined);
    }
  }
  hull(b, 0, 0, 0, w, 0.9, d, 'wood');
  hull(b, 0, 0.9, 0, w - 0.2, 0.72, 0.32, 'wood');
}

// ---------------------------------------------------------------------------------
// Analysers
// ---------------------------------------------------------------------------------

/**
 * Low-detail rack of five capped tubes along X (6 parts). Used wherever racks are part of a
 * bigger prop (loaders, trolleys, fridges); the stand-alone `tubeRack` is the detailed one.
 */
export function miniRack(b: MapBuilder, cx: number, y0: number, cz: number, shift = 0, mat: MaterialId = 'plastic_blue'): void {
  bx(b, cx, y0, cz, 0.25, 0.05, 0.05, mat);
  for (let i = 0; i < 5; i++) cyl(b, cx - 0.094 + i * 0.047, y0 + 0.05, cz, 0.022, 0.045, CAP_MATS[(i + shift) % CAP_MATS.length]!, undefined, 6);
}

/**
 * Automate d'analyses grand modèle: floor-standing analyser (2.2 × 0.9 × 1.4 m) with a
 * sample loader, a smoked hood over the pipetting deck, a screen, status LEDs and a reagent door.
 */
export function analyserLarge(b: MapBuilder): void {
  const zf = 0.45;
  bx(b, 0, 0, 0, 2.14, 0.08, 0.84, 'metal_dark');
  bx(b, 0, 0.08, 0, 2.2, 0.71, 0.9, 'metal_white'); // lower cabinet, top at 0.79
  bx(b, 0, 0.7, zf + 0.004, 2.2, 0.05, 0.008, 'plastic_white', C.blue); // brand stripe
  // reagent door (right) with a smoked window, service door (left) with a vent
  bx(b, 0.52, 0.13, zf + 0.008, 1.0, 0.54, 0.016, 'metal_white', 0xdde5ea);
  bx(b, 0.52, 0.3, zf + 0.018, 0.7, 0.26, 0.006, 'glass', C.smoke);
  handle(b, 0.08, 0.42, zf + 0.016, 0.3, true);
  bx(b, -0.6, 0.13, zf + 0.008, 0.92, 0.54, 0.016, 'metal_white', 0xdde5ea);
  bx(b, -0.6, 0.2, zf + 0.018, 0.6, 0.16, 0.006, 'metal_grate');
  handle(b, -0.2, 0.42, zf + 0.016, 0.3, true);
  // upper body: a full-width back unit + the control column on the right
  bx(b, 0, 0.79, -0.3, 2.2, 0.61, 0.3, 'metal_white');
  bx(b, 0.65, 0.79, 0.01, 0.9, 0.61, 0.32, 'metal_white');
  // pipetting deck on the left, under a smoked hood
  bx(b, -0.45, 0.79, 0.01, 1.3, 0.015, 0.32, 'metal_brushed');
  cyl(b, -0.78, 0.805, 0.0, 0.26, 0.04, 'metal_brushed', undefined, 12); // sample carousel
  for (let i = 0; i < 4; i++) cyl(b, -0.78 + 0.09 * Math.cos(i * 1.57), 0.845, 0.09 * Math.sin(i * 1.57), 0.022, 0.07, CAP_MATS[i]!, undefined, 6);
  for (let i = 0; i < 3; i++) bx(b, -0.4 + i * 0.16, 0.805, -0.03, 0.12, 0.1, 0.2, 'plastic_white', i === 1 ? C.blue : 0xe9d28a); // reagent packs
  bx(b, -0.45, 1.2, -0.06, 1.24, 0.04, 0.06, 'metal_dark'); // gantry
  bx(b, -0.2, 1.02, -0.06, 0.08, 0.18, 0.08, 'metal_brushed');
  cyl(b, -0.2, 0.9, -0.06, 0.012, 0.12, 'metal_brushed', undefined, 6);
  bx(b, -0.45, 0.83, 0.164, 1.3, 0.5, 0.012, 'glass', C.smoke);
  bx(b, -0.45, 1.33, 0.01, 1.3, 0.012, 0.32, 'glass', C.smoke);
  bx(b, -1.094, 0.83, 0.01, 0.012, 0.5, 0.32, 'glass', C.smoke);
  bx(b, -0.45, 1.325, 0.158, 1.3, 0.035, 0.03, 'metal_brushed');
  bx(b, -0.45, 0.79, 0.158, 1.3, 0.045, 0.03, 'plastic_grey');
  // sample loader: the shelf in front of the hood, with racks waiting
  bx(b, -0.45, 0.79, 0.31, 1.3, 0.02, 0.26, 'metal_brushed');
  for (let i = 0; i < 3; i++) miniRack(b, -0.86 + i * 0.4, 0.81, 0.33, i);
  bx(b, -0.45, 0.81, 0.435, 1.3, 0.03, 0.02, 'plastic_grey'); // loader lip
  // control column: screen, LEDs, keyboard shelf
  screen(b, 0.65, 0.97, 0.17, 0.52, 0.34);
  led(b, 0.44, 0.92, 0.17, 'led_green');
  led(b, 0.5, 0.92, 0.17, 'led_blue');
  led(b, 0.56, 0.92, 0.17, 'led_red');
  bx(b, 0.65, 0.79, 0.31, 0.8, 0.02, 0.26, 'plastic_grey');
  bx(b, 0.6, 0.81, 0.31, 0.42, 0.015, 0.15, 'plastic_black');
  bx(b, 0.92, 0.81, 0.31, 0.06, 0.02, 0.1, 'plastic_black');
  // top: signal tower, reagent bottles, cable duct
  cyl(b, 0.95, 1.4, -0.3, 0.05, 0.1, 'metal_dark', undefined, 8);
  cyl(b, 0.95, 1.5, -0.3, 0.06, 0.06, 'led_green', undefined, 8);
  cyl(b, 0.95, 1.56, -0.3, 0.06, 0.06, 'plastic_orange', undefined, 8);
  cyl(b, 0.95, 1.62, -0.3, 0.06, 0.06, 'plastic_red', undefined, 8);
  for (let i = 0; i < 3; i++) {
    cyl(b, -0.85 + i * 0.22, 1.4, -0.25, 0.16, 0.2, 'plastic_white', undefined, 10);
    cyl(b, -0.85 + i * 0.22, 1.6, -0.25, 0.06, 0.04, i === 1 ? 'plastic_red' : 'plastic_blue', undefined, 8);
  }
  bx(b, 0.2, 1.4, -0.3, 0.5, 0.04, 0.2, 'metal_grate');
  bx(b, -1.1 - 0.003, 0.25, 0, 0.006, 0.3, 0.5, 'metal_grate'); // side vent
  hull(b, 0, 0, 0, 2.2, 0.8, 0.9, 'metal');
  hull(b, 0, 0.8, -0.14, 2.2, 0.6, 0.62, 'metal');
}

/** Automate de paillasse: bench-top analyser (0.7 × 0.55 × 0.6 m). */
export function analyserBench(b: MapBuilder): void {
  const zf = 0.25;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, sx * 0.29, 0, sz * 0.2, 0.05, 0.02, 0.05, 'rubber_black');
  bx(b, 0, 0.02, -0.01, 0.7, 0.46, 0.5, 'metal_white');
  bx(b, -0.13, 0.48, -0.04, 0.4, 0.09, 0.4, 'plastic_white', C.front); // lid
  bx(b, -0.13, 0.57, 0.1, 0.16, 0.02, 0.04, 'plastic_grey'); // lid grip
  bx(b, 0, 0.4, zf - 0.006, 0.7, 0.035, 0.008, 'plastic_white', C.blue);
  bx(b, -0.13, 0.19, zf - 0.006, 0.38, 0.18, 0.008, 'glass', C.smoke);
  bx(b, -0.13, 0.05, zf, 0.38, 0.1, 0.02, 'plastic_grey'); // sample drawer
  handle(b, -0.13, 0.1, zf + 0.01, 0.14);
  screen(b, 0.21, 0.17, zf - 0.02, 0.22, 0.18);
  led(b, 0.14, 0.1, zf - 0.008, 'led_green');
  led(b, 0.19, 0.1, zf - 0.008, 'led_blue');
  bx(b, 0.27, 0.07, zf - 0.004, 0.06, 0.06, 0.012, 'plastic_grey');
  cyl(b, 0.22, 0.48, -0.12, 0.09, 0.12, 'plastic_white', undefined, 8); // reagent bottle on top
  cyl(b, 0.22, 0.6, -0.12, 0.04, 0.03, 'plastic_blue', undefined, 6);
  hull(b, 0, 0, -0.01, 0.7, 0.56, 0.5, 'metal');
}

/** Chaîne de tri: conveyor segment carrying tubes (2 m long; chain several along X). */
export function conveyor(b: MapBuilder, o: { width?: number } = {}): void {
  const w = o.width ?? 2;
  const n = Math.max(2, Math.round(w / 1.4) + 1);
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + 0.15 + ((w - 0.3) * i) / (n - 1);
    for (const sz of [-1, 1]) {
      bx(b, x, 0.02, sz * 0.17, 0.05, 0.83, 0.05, 'metal_brushed');
      cyl(b, x, 0, sz * 0.17, 0.08, 0.02, 'rubber_black', undefined, 8);
    }
    bx(b, x, 0.3, 0, 0.04, 0.04, 0.3, 'metal_brushed');
  }
  bx(b, 0, 0.5, 0, w - 0.3, 0.025, 0.22, 'metal_grate'); // cable tray
  bx(b, 0, 0.85, 0, w, 0.09, 0.4, 'metal_white'); // track bed
  bx(b, 0, 0.87, 0.201, w, 0.04, 0.004, 'plastic_white', C.blue);
  bx(b, 0, 0.94, 0, w, 0.012, 0.13, 'rubber_black'); // belt
  for (const sz of [-1, 1]) bx(b, 0, 0.94, sz * 0.085, w, 0.05, 0.015, 'metal_brushed'); // guides
  // pucks with tubes
  const pucks = Math.max(3, Math.round(w / 0.33));
  for (let i = 0; i < pucks; i++) {
    const x = -w / 2 + 0.2 + ((w - 0.4) * i) / (pucks - 1);
    if (Math.abs(x - 0.35) < 0.14) continue; // under the scanner
    cyl(b, x, 0.952, 0, 0.055, 0.03, 'plastic_white', undefined, 8);
    tube(b, x, 0.975, 0, CAP_MATS[i % CAP_MATS.length]!, 0.1);
  }
  // scanner gantry + drive unit
  for (const sz of [-1, 1]) bx(b, 0.35, 0.94, sz * 0.185, 0.24, 0.2, 0.03, 'metal_white');
  bx(b, 0.35, 1.14, 0, 0.28, 0.08, 0.42, 'metal_white');
  bx(b, 0.35, 1.16, 0.211, 0.2, 0.04, 0.004, 'plastic_black');
  led(b, 0.29, 1.18, 0.212, 'led_green', 0.018);
  led(b, 0.41, 1.18, 0.212, 'led_red', 0.018);
  bx(b, -w / 2 + 0.3, 0.58, 0, 0.34, 0.27, 0.3, 'metal_grey');
  hull(b, 0, 0, 0, w, 1.0, 0.42, 'metal');
}

/** Centrifugeuse au sol (0.65 × 0.75 × 0.95 m). */
export function centrifugeFloor(b: MapBuilder): void {
  casters(b, 0.6, 0.68, 0.07);
  bx(b, 0, 0.07, 0, 0.65, 0.75, 0.72, 'metal_white');
  bx(b, 0, 0.72, 0.361, 0.65, 0.04, 0.004, 'plastic_white', C.blue);
  bx(b, 0, 0.14, 0.362, 0.45, 0.12, 0.004, 'metal_grate');
  cyl(b, 0, 0.82, 0.04, 0.54, 0.06, 'plastic_white', C.front, 16); // lid
  cyl(b, 0, 0.88, 0.04, 0.22, 0.012, 'glass', C.smoke, 12); // lid window
  bx(b, 0, 0.84, 0.31, 0.16, 0.035, 0.05, 'plastic_grey'); // lid handle
  // rear console
  bx(b, 0, 0.82, -0.3, 0.65, 0.13, 0.12, 'plastic_grey', 0x7c8288);
  screen(b, -0.1, 0.84, -0.245, 0.26, 0.09, 'screen_on', 0.008);
  cylZ(b, 0.16, 0.885, -0.228, 0.05, 0.025, 'plastic_black', undefined, 8);
  led(b, 0.25, 0.9, -0.24, 'led_green');
  led(b, 0.25, 0.86, -0.24, 'led_red');
  hull(b, 0, 0, 0, 0.65, 0.9, 0.75, 'metal');
}

/** Centrifugeuse de paillasse (0.42 × 0.5 × 0.32 m), to put on a bench. */
export function centrifugeBench(b: MapBuilder): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, sx * 0.17, 0, sz * 0.2, 0.04, 0.015, 0.04, 'rubber_black');
  bx(b, 0, 0.015, 0, 0.42, 0.2, 0.48, 'metal_white');
  ball(b, 0, 0.215, -0.03, 0.38, 0.2, 0.38, 'plastic_white', C.front, 12); // domed lid
  cyl(b, 0, 0.3, -0.03, 0.12, 0.012, 'glass', C.smoke, 10);
  bx(b, 0, 0.215, 0.17, 0.12, 0.03, 0.04, 'plastic_grey');
  bx(b, 0, 0.04, 0.241, 0.38, 0.11, 0.006, 'plastic_black');
  bx(b, -0.08, 0.06, 0.245, 0.14, 0.06, 0.004, 'screen_on');
  cylZ(b, 0.07, 0.095, 0.25, 0.04, 0.02, 'plastic_grey', undefined, 8);
  cylZ(b, 0.14, 0.095, 0.25, 0.04, 0.02, 'plastic_grey', undefined, 8);
  led(b, 0.105, 0.055, 0.244, 'led_green', 0.015);
  hull(b, 0, 0, 0, 0.42, 0.28, 0.48, 'metal');
}

/** Microscope (bench-top, no collider). */
export function microscope(b: MapBuilder): void {
  const body = 0xe9e7e0;
  bx(b, 0, 0, 0.02, 0.2, 0.035, 0.28, 'plastic_white', body);
  bx(b, 0, 0.035, -0.09, 0.07, 0.25, 0.07, 'plastic_white', body);
  bx(b, 0, 0.27, -0.02, 0.08, 0.06, 0.2, 'plastic_white', body);
  bx(b, 0, 0.14, 0.03, 0.16, 0.012, 0.14, 'plastic_black'); // stage
  bx(b, 0, 0.152, 0.03, 0.075, 0.003, 0.025, 'glass');
  bx(b, 0, 0.035, 0.035, 0.05, 0.012, 0.05, 'light_warm');
  cyl(b, 0, 0.225, 0.045, 0.075, 0.045, 'metal_dark', undefined, 10); // turret
  cyl(b, -0.018, 0.168, 0.05, 0.022, 0.06, 'metal_brushed', undefined, 6);
  cyl(b, 0.02, 0.185, 0.035, 0.02, 0.045, 'metal_brushed', undefined, 6);
  bx(b, 0, 0.33, 0.04, 0.11, 0.05, 0.09, 'plastic_white', body); // head
  for (const sx of [-1, 1]) {
    b.prim('cyl', sx * 0.03, 0.4, 0.1, 0.03, 0.1, 0.03, 'plastic_black', { rot: { x: 0.9, y: 0, z: 0 }, seg: 8 });
    cylX(b, sx * 0.045, 0.1, -0.09, 0.05, 0.025, 'plastic_black', undefined, 8); // focus knobs
  }
}

/** Portoir de tubes: rack of ten capped tubes (purple, red, green, blue, yellow). */
export function tubeRack(b: MapBuilder, o: { mat?: MaterialId; shift?: number } = {}): void {
  const mat = o.mat ?? 'plastic_white';
  bx(b, 0, 0, 0, 0.26, 0.012, 0.1, mat);
  bx(b, 0, 0.055, 0, 0.26, 0.008, 0.1, mat);
  for (const sx of [-1, 1]) bx(b, sx * 0.125, 0.012, 0, 0.01, 0.043, 0.1, mat);
  for (let i = 0; i < 5; i++) {
    tube(b, -0.1 + i * 0.05, 0.012, -0.025, CAP_MATS[(i + (o.shift ?? 0)) % CAP_MATS.length]!, 0.11);
    tube(b, -0.1 + i * 0.05, 0.012, 0.025, CAP_MATS[(i + (o.shift ?? 0) + 2) % CAP_MATS.length]!, 0.11);
  }
}

/** Boîte de tubes: open carton of fresh tubes, all the same cap colour. */
export function tubeBox(b: MapBuilder, o: { cap?: MaterialId } = {}): void {
  const cap = o.cap ?? 'plastic_purple';
  bx(b, 0, 0, 0, 0.3, 0.075, 0.22, 'cardboard', 0xf2efe6);
  bx(b, 0, 0.075, 0, 0.27, 0.004, 0.19, 'paper_white');
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) cyl(b, -0.11 + i * 0.044, 0.079, -0.066 + j * 0.044, 0.03, 0.018, cap, undefined, 6);
  bx(b, 0, 0.018, 0.111, 0.17, 0.04, 0.002, 'paper_white');
  bx(b, 0.11, 0.022, 0.1115, 0.035, 0.032, 0.002, cap);
  // lid leaning against the back
  tilt(b, 0, 0.1, -0.135, 0.3, 0.2, 0.012, -14, 'cardboard', 0xf2efe6);
}

/** Portoir de pipettes: carousel stand with four pipettes. */
export function pipetteStand(b: MapBuilder): void {
  cyl(b, 0, 0, 0, 0.2, 0.02, 'plastic_grey', undefined, 12);
  cyl(b, 0, 0.02, 0, 0.025, 0.36, 'metal_brushed', undefined, 8);
  cyl(b, 0, 0.36, 0, 0.19, 0.02, 'plastic_grey', undefined, 12);
  const pos: [number, number][] = [
    [0.075, 0],
    [-0.075, 0],
    [0, 0.075],
    [0, -0.075],
  ];
  pos.forEach(([x, z], i) => {
    cyl(b, x, 0.19, z, 0.03, 0.2, 'plastic_white', undefined, 8);
    cyl(b, x, 0.39, z, 0.022, 0.04, CAP_MATS[(i + 1) % CAP_MATS.length]!, undefined, 6);
    cyl(b, x, 0.09, z, 0.01, 0.1, 'plastic_white', C.light, 6);
  });
}

// ---------------------------------------------------------------------------------
// Hood, cold storage, cabinets
// ---------------------------------------------------------------------------------

/** Hotte / PSM: microbiological safety cabinet with a glass sash (1.5 × 0.8 × 2.3 m). */
export function fumeHood(b: MapBuilder): void {
  const w = 1.5;
  bx(b, 0, 0, -0.03, w - 0.06, 0.1, 0.66, 'metal_dark');
  bx(b, 0, 0.1, -0.02, w, 0.75, 0.74, 'metal_white');
  cabinetFronts(b, w - 0.04, 0.35, 0.13, 0.69, 0, 0xdde5ea);
  bx(b, 0, 0.85, 0, w, 0.05, 0.8, 'metal_brushed'); // work surface
  bx(b, 0, 0.9, -0.375, w, 0.95, 0.05, 'metal_white');
  for (const sx of [-1, 1]) bx(b, sx * (w / 2 - 0.025), 0.9, 0.0, 0.05, 0.95, 0.7, 'metal_white');
  bx(b, 0, 1.85, 0, w, 0.45, 0.8, 'metal_white'); // fan / filter unit
  bx(b, 0, 1.87, 0.402, w, 0.06, 0.006, 'plastic_white', C.blue);
  bx(b, 0, 2.02, 0.402, 0.9, 0.2, 0.006, 'metal_grate');
  screen(b, 0.55, 2.0, 0.396, 0.24, 0.14, 'screen_on', 0.01);
  led(b, -0.62, 2.1, 0.402, 'led_green');
  led(b, -0.56, 2.1, 0.402, 'led_blue');
  bx(b, 0, 1.825, -0.02, w - 0.2, 0.025, 0.5, 'light_panel'); // inner light
  // glass sash (leaves a working slot above the surface) + its bottom rail
  bx(b, 0, 1.2, 0.365, w - 0.1, 0.65, 0.012, 'glass');
  bx(b, 0, 1.18, 0.365, w - 0.1, 0.035, 0.03, 'metal_brushed');
  // work in progress inside
  cyl(b, -0.45, 0.9, -0.15, 0.1, 0.18, 'plastic_white', undefined, 8);
  cyl(b, -0.45, 1.08, -0.15, 0.05, 0.03, 'plastic_blue', undefined, 6);
  miniRack(b, 0.1, 0.9, -0.1, 1);
  cyl(b, 0.5, 0.9, -0.2, 0.12, 0.14, 'plastic_yellow', undefined, 8);
  bx(b, 0.4, 0.9, 0.12, 0.2, 0.01, 0.14, 'paper_white');
  hull(b, 0, 0, 0, w, 2.3, 0.8, 'metal');
}

/** Réfrigérateur de laboratoire: glass door showing shelves of reagents (0.75 × 0.7 × 1.95 m). */
export function labFridge(b: MapBuilder, o: { seed?: number } = {}): void {
  const w = 0.75;
  bx(b, 0, 0, -0.01, w - 0.04, 0.1, 0.64, 'metal_dark');
  bx(b, 0, 0.1, -0.33, w, 1.6, 0.04, 'metal_white'); // back
  for (const sx of [-1, 1]) bx(b, sx * (w / 2 - 0.02), 0.1, 0, 0.04, 1.6, 0.7, 'metal_white');
  bx(b, 0, 0.1, 0, w - 0.08, 0.04, 0.62, 'metal_white');
  bx(b, 0, 1.7, 0, w, 0.25, 0.7, 'metal_white'); // head unit
  bx(b, 0, 1.72, 0.352, w, 0.04, 0.006, 'plastic_white', C.blue);
  bx(b, -0.14, 1.8, 0.352, 0.22, 0.09, 0.006, 'screen_off');
  bx(b, -0.14, 1.82, 0.356, 0.13, 0.05, 0.003, 'led_blue');
  led(b, 0.2, 1.845, 0.352, 'led_green');
  bx(b, 0, 1.66, -0.1, w - 0.12, 0.015, 0.3, 'light_panel');
  // wire shelves with reagents
  const rng = mulberry32(hash3(o.seed ?? 0, 311));
  const tints = [0xffffff, C.blue, 0xe9d28a, C.red, 0xbfe3c6, C.light];
  [0.42, 0.74, 1.06, 1.36].forEach((y, k) => {
    bx(b, 0, y, -0.02, w - 0.09, 0.012, 0.56, 'metal_brushed');
    for (let i = 0; i < 3; i++) {
      const x = -0.2 + i * 0.2;
      const r = rng();
      if (r < 0.4) bx(b, x, y + 0.012, 0.02, 0.15, 0.1 + rng() * 0.08, 0.2, 'plastic_white', tints[Math.floor(rng() * tints.length)]!);
      else if (r < 0.7) {
        cyl(b, x, y + 0.012, 0.04, 0.1, 0.17, 'plastic_white', undefined, 8);
        cyl(b, x, y + 0.182, 0.04, 0.05, 0.03, CAP_MATS[(i + k) % CAP_MATS.length]!, undefined, 6);
      } else bx(b, x, y + 0.012, 0.0, 0.16, 0.07, 0.24, 'cardboard', 0xf2efe6);
    }
  });
  miniRack(b, -0.1, 0.14, 0.08, 0, 'plastic_white');
  miniRack(b, 0.12, 0.14, -0.06, 2, 'plastic_white');
  // glass door in a white frame + handle
  bx(b, 0, 0.14, 0.34, w - 0.1, 1.52, 0.016, 'glass');
  for (const sx of [-1, 1]) bx(b, sx * (w / 2 - 0.03), 0.11, 0.34, 0.06, 1.58, 0.03, 'metal_white', 0xdde5ea);
  bx(b, 0, 0.11, 0.34, w - 0.12, 0.04, 0.03, 'metal_white', 0xdde5ea);
  bx(b, 0, 1.65, 0.34, w - 0.12, 0.04, 0.03, 'metal_white', 0xdde5ea);
  handle(b, w / 2 - 0.03, 1.0, 0.355, 0.5, true);
  hull(b, 0, 0, 0, w, 1.95, 0.7, 'metal');
}

/** Congélateur −80 °C (0.8 × 0.8 × 1.95 m). */
export function freezer(b: MapBuilder): void {
  casters(b, 0.74, 0.7, 0.08);
  bx(b, 0, 0.08, -0.03, 0.8, 1.87, 0.72, 'metal_white');
  bx(b, 0, 0.12, 0.335, 0.7, 0.3, 0.008, 'metal_grate'); // compressor grille
  bx(b, 0, 0.47, 0.36, 0.78, 1.46, 0.06, 'metal_white', 0xe1e8ec); // thick door
  bx(b, 0, 1.2, 0.392, 0.78, 0.05, 0.006, 'plastic_white', C.blue);
  bx(b, -0.1, 1.68, 0.392, 0.42, 0.16, 0.006, 'plastic_black');
  bx(b, -0.17, 1.72, 0.396, 0.16, 0.07, 0.004, 'led_red'); // "−80"
  led(b, 0.0, 1.78, 0.394, 'led_green');
  led(b, 0.05, 1.78, 0.394, 'led_blue');
  bx(b, 0.31, 0.75, 0.42, 0.06, 0.5, 0.06, 'metal_dark'); // lever handle
  bx(b, 0.31, 0.95, 0.4, 0.1, 0.1, 0.03, 'metal_brushed');
  for (const y of [0.7, 1.6]) bx(b, -0.4, y, 0.37, 0.03, 0.12, 0.05, 'metal_brushed'); // hinges
  hull(b, 0, 0, 0, 0.8, 1.95, 0.8, 'metal');
}

/** Armoire à réactifs: yellow safety cabinet (1.0 × 0.5 × 1.95 m). */
export function reagentCabinet(b: MapBuilder): void {
  bx(b, 0, 0, -0.01, 0.96, 0.1, 0.44, 'metal_dark');
  bx(b, 0, 0.1, -0.012, 1.0, 1.85, 0.476, 'metal_yellow', 0xdcdcdc);
  for (const sx of [-1, 1]) {
    bx(b, sx * 0.247, 0.14, 0.234, 0.48, 1.77, 0.016, 'metal_yellow');
    handle(b, sx * 0.07, 1.05, 0.24, 0.3, true);
    // hazard diamond + label
    tilt(b, sx * 0.25, 1.52, 0.2435, 0.16, 0.16, 0.004, 0, 'plastic_red', undefined, 0, 45);
    bx(b, sx * 0.25, 1.49, 0.2445, 0.05, 0.06, 0.003, 'paper_white');
    bx(b, sx * 0.25, 1.2, 0.243, 0.26, 0.08, 0.003, 'paper_white');
    bx(b, sx * 0.25, 0.2, 0.243, 0.3, 0.05, 0.003, 'metal_grate');
  }
  bx(b, 0, 1.95, 0, 0.12, 0.05, 0.12, 'metal_dark'); // vent spigot
  hull(b, 0, 0, 0, 1.0, 1.95, 0.5, 'metal');
}

/** Étagère de stockage: metal shelving loaded with cartons and consumables (1.2 × 0.5 × 2.0 m). */
export function storageShelf(b: MapBuilder, o: { width?: number; seed?: number } = {}): void {
  const w = o.width ?? 1.2;
  const d = 0.5;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, sx * (w / 2 - 0.02), 0, sz * (d / 2 - 0.02), 0.04, 2.0, 0.04, 'metal_grey');
  const levels = [0.12, 0.58, 1.04, 1.5, 1.94];
  for (const y of levels) bx(b, 0, y, 0, w - 0.02, 0.03, d - 0.02, 'metal_grey', 0xdfe3e6);
  const rng = mulberry32(hash3(o.seed ?? 0, 523));
  const binTints = [C.blue, C.red, 0xe9c63a, 0xffffff];
  for (let k = 0; k < 4; k++) {
    const y = levels[k]! + 0.03;
    let x = -w / 2 + 0.08;
    while (x < w / 2 - 0.2) {
      const iw = Math.min(0.26 + rng() * 0.24, w / 2 - 0.06 - x);
      const r = rng();
      if (iw < 0.14) break;
      if (r < 0.55) carton(b, x + iw / 2, y, (rng() - 0.5) * 0.04, iw, 0.2 + rng() * 0.18, 0.34 + rng() * 0.08, rng() < 0.3 ? 0xf2efe6 : undefined);
      else if (r < 0.85) {
        bx(b, x + iw / 2, y, 0.02, iw, 0.16, 0.36, 'plastic_white', binTints[Math.floor(rng() * binTints.length)]!);
        bx(b, x + iw / 2, y + 0.05, 0.201, iw * 0.5, 0.06, 0.003, 'paper_white');
      } else {
        const nb = Math.max(1, Math.floor(iw / 0.11));
        for (let i = 0; i < nb; i++) {
          cyl(b, x + 0.06 + i * 0.11, y, 0.05, 0.09, 0.22, 'plastic_white', undefined, 8);
          cyl(b, x + 0.06 + i * 0.11, y + 0.22, 0.05, 0.045, 0.035, 'plastic_blue', undefined, 6);
        }
      }
      x += iw + 0.03 + rng() * 0.05;
    }
  }
  hull(b, 0, 0, 0, w, 2.0, d, 'metal');
}

/** Chariot: three-tray stainless trolley (0.8 × 0.5 × 0.95 m). */
export function trolley(b: MapBuilder, o: { loaded?: boolean } = {}): void {
  casters(b, 0.74, 0.44, 0.09);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, sx * 0.37, 0.09, sz * 0.22, 0.03, 0.8, 0.03, 'metal_brushed');
  for (const y of [0.2, 0.52, 0.85]) {
    bx(b, 0, y, 0, 0.78, 0.02, 0.48, 'metal_brushed');
    for (const sz of [-1, 1]) bx(b, 0, y + 0.02, sz * 0.235, 0.78, 0.03, 0.012, 'metal_brushed');
  }
  cylZ(b, -0.43, 0.93, 0, 0.028, 0.48, 'metal_brushed', undefined, 8);
  for (const sz of [-1, 1]) bx(b, -0.41, 0.86, sz * 0.22, 0.05, 0.085, 0.025, 'metal_brushed');
  if (o.loaded !== false) {
    carton(b, 0.14, 0.22, 0, 0.36, 0.22, 0.3);
    bx(b, -0.12, 0.54, 0, 0.4, 0.2, 0.32, 'plastic_blue');
    bx(b, -0.12, 0.74, 0, 0.42, 0.025, 0.34, 'plastic_blue', 0xd0d8e0);
    miniRack(b, 0.2, 0.87, 0.08, 0, 'plastic_white');
    miniRack(b, 0.2, 0.87, -0.06, 3, 'plastic_white');
    bx(b, -0.16, 0.87, 0, 0.3, 0.08, 0.22, 'cardboard', 0xf2efe6);
    bx(b, -0.16, 0.9, 0.111, 0.17, 0.04, 0.002, 'plastic_purple');
  }
  hull(b, 0, 0, 0, 0.8, 0.9, 0.5, 'metal');
}

/** Poubelle DASRI: yellow clinical-waste pedal bin (0.4 × 0.4 × 0.72 m). */
export function clinicalWasteBin(b: MapBuilder): void {
  bx(b, 0, 0.02, 0, 0.38, 0.6, 0.36, 'plastic_yellow');
  bx(b, 0, 0.62, 0, 0.42, 0.05, 0.4, 'plastic_yellow', 0xd8d8d8);
  bx(b, 0, 0.67, 0.02, 0.3, 0.03, 0.3, 'plastic_yellow', 0xd8d8d8);
  bx(b, 0, 0.0, 0.2, 0.14, 0.03, 0.1, 'plastic_black'); // pedal
  bx(b, 0, 0.26, 0.181, 0.17, 0.17, 0.003, 'plastic_black'); // biohazard sticker
  cylZ(b, 0, 0.345, 0.184, 0.1, 0.004, 'plastic_yellow', undefined, 10);
  bx(b, 0, 0.48, 0.181, 0.28, 0.06, 0.003, 'paper_white');
  for (const sx of [-1, 1]) cylX(b, sx * 0.17, 0.04, -0.17, 0.08, 0.03, 'rubber_black', undefined, 8);
  hull(b, 0, 0, 0, 0.4, 0.7, 0.4, 'plastic');
}

/** Collecteur d'aiguilles: sharps container (bench-top, no collider). */
export function sharpsBox(b: MapBuilder): void {
  bx(b, 0, 0, 0, 0.15, 0.17, 0.15, 'plastic_yellow');
  bx(b, 0, 0.17, 0, 0.16, 0.03, 0.16, 'plastic_yellow', 0xd8d8d8);
  cyl(b, 0, 0.2, 0, 0.09, 0.012, 'plastic_red', undefined, 10);
  cyl(b, 0, 0.212, 0, 0.055, 0.004, 'plastic_black', undefined, 10);
  bx(b, 0, 0.06, 0.076, 0.1, 0.07, 0.002, 'plastic_black');
  bx(b, 0, 0.135, 0.076, 0.12, 0.02, 0.002, 'paper_white');
}

/** Distributeur de gel hydroalcoolique, wall-mounted at hand height. */
export function gelDispenser(b: MapBuilder): void {
  const zb = -0.055;
  bx(b, 0, 1.05, zb + 0.006, 0.13, 0.3, 0.012, 'plastic_white');
  bx(b, 0, 1.1, zb + 0.05, 0.09, 0.17, 0.075, 'plastic_white', 0xbcdcf5); // bottle
  bx(b, 0, 1.27, zb + 0.055, 0.11, 0.06, 0.09, 'plastic_grey');
  bx(b, 0, 1.25, zb + 0.105, 0.07, 0.015, 0.03, 'plastic_grey', 0x7c8288); // lever
  bx(b, 0, 1.055, zb + 0.05, 0.12, 0.012, 0.09, 'plastic_grey');
  bx(b, 0, 1.15, zb + 0.089, 0.06, 0.06, 0.003, 'plastic_white', C.blue);
}

/** Distributeur de gel sur pied: free-standing sanitiser station. */
export function gelStand(b: MapBuilder): void {
  bx(b, 0, 0, 0, 0.36, 0.025, 0.36, 'metal_dark');
  bx(b, 0, 0.025, 0, 0.05, 1.3, 0.05, 'metal_brushed');
  bx(b, 0, 1.32, 0.0, 0.3, 0.32, 0.02, 'plastic_white', C.blue); // info panel
  bx(b, 0, 1.4, 0.012, 0.2, 0.14, 0.004, 'paper_white');
  bx(b, 0, 0.95, 0.07, 0.1, 0.17, 0.08, 'plastic_white', 0xbcdcf5);
  bx(b, 0, 1.12, 0.07, 0.12, 0.06, 0.1, 'plastic_grey');
  bx(b, 0, 0.9, 0.07, 0.14, 0.012, 0.12, 'plastic_grey');
  hull(b, 0, 0, 0, 0.3, 1.6, 0.3, 'metal');
}

/** Glacière d'échantillons: blue sample cooler with a light lid carrying the logo colours. */
export function sampleCooler(b: MapBuilder): void {
  bx(b, 0, 0, 0, 0.44, 0.26, 0.29, 'plastic_blue');
  bx(b, 0, 0.26, 0, 0.46, 0.06, 0.31, 'plastic_white', C.light);
  bx(b, -0.03, 0.32, 0, 0.18, 0.004, 0.12, 'plastic_white', C.blue); // logo patch
  bx(b, 0.09, 0.32, 0, 0.05, 0.005, 0.05, 'plastic_white', C.red);
  bx(b, 0, 0.32, 0.125, 0.3, 0.018, 0.028, 'plastic_white', C.red); // folded handle
  for (const sx of [-1, 1]) bx(b, sx * 0.232, 0.2, 0, 0.012, 0.1, 0.05, 'plastic_white', C.red);
  bx(b, 0, 0.19, 0.147, 0.06, 0.09, 0.01, 'plastic_white', C.red); // latch
  bx(b, -0.1, 0.06, 0.1455, 0.16, 0.1, 0.002, 'paper_white');
  tilt(b, 0.12, 0.11, 0.146, 0.075, 0.075, 0.003, 0, 'plastic_orange', undefined, 0, 45); // transport diamond
  hull(b, 0, 0, 0, 0.45, 0.32, 0.3, 'plastic');
}

/** Bonbonne: gas cylinder chained to its wall bracket (0.28 × 0.3 × 1.55 m). */
export function gasCylinder(b: MapBuilder, o: { tint?: number } = {}): void {
  cyl(b, 0, 0, 0, 0.25, 0.03, 'metal_dark', undefined, 12);
  cyl(b, 0, 0.03, 0, 0.23, 1.2, 'metal_grey', undefined, 12);
  ball(b, 0, 1.23, 0, 0.23, 0.22, 0.23, 'metal_white', o.tint ?? C.light, 12);
  cyl(b, 0, 0.7, 0, 0.236, 0.2, 'paper_white', undefined, 12); // label
  cyl(b, 0, 1.3, 0, 0.07, 0.1, 'metal_brushed', undefined, 8);
  bx(b, 0, 1.4, 0, 0.05, 0.06, 0.05, 'metal_brushed');
  cyl(b, 0, 1.46, 0, 0.1, 0.02, 'plastic_black', undefined, 8);
  cylZ(b, 0.07, 1.42, 0.04, 0.06, 0.025, 'metal_white', undefined, 8); // gauge
  bx(b, 0, 0.95, -0.125, 0.3, 0.05, 0.05, 'metal_dark'); // bracket
  bx(b, 0, 0.965, 0.118, 0.26, 0.02, 0.006, 'metal_brushed'); // chain
  for (const sx of [-1, 1]) bx(b, sx * 0.13, 0.965, 0, 0.006, 0.02, 0.24, 'metal_brushed');
  hull(b, 0, 0, 0, 0.26, 1.5, 0.26, 'metal');
}

/** Imprimante d'étiquettes: label printer with a strip of barcodes coming out (bench-top). */
export function labelPrinter(b: MapBuilder): void {
  bx(b, 0, 0, 0, 0.2, 0.15, 0.25, 'plastic_grey', 0x6f747a);
  bx(b, 0, 0.15, -0.02, 0.19, 0.025, 0.2, 'plastic_grey');
  bx(b, 0, 0.176, -0.02, 0.1, 0.004, 0.12, 'glass', C.smoke);
  bx(b, 0, 0.055, 0.126, 0.13, 0.014, 0.004, 'plastic_black');
  bx(b, 0, 0.06, 0.16, 0.1, 0.002, 0.07, 'paper_white');
  for (let i = 0; i < 3; i++) bx(b, -0.025 + i * 0.025, 0.0621, 0.165, 0.012, 0.001, 0.04, 'plastic_black');
  led(b, 0.07, 0.12, 0.125, 'led_green', 0.014);
  bx(b, 0.07, 0.085, 0.126, 0.025, 0.014, 0.004, 'plastic_white');
}

// ---------------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------------

export const LAB_PROPS: PropInfo[] = [
  { id: 'lab_bench', label: 'Paillasse', family: 'labo', footprint: [2, 0.7, 0.9], cover: 'low', mount: 'floor', build: (b) => labBench(b) },
  { id: 'lab_bench_sink', label: 'Paillasse avec évier', family: 'labo', footprint: [2, 0.7, 1.2], cover: 'low', mount: 'floor', build: (b) => labBench(b, { variant: 'sink' }) },
  { id: 'lab_bench_shelf', label: 'Paillasse avec étagère', family: 'labo', footprint: [2, 0.7, 1.97], cover: 'low', mount: 'floor', build: (b) => labBench(b, { variant: 'shelf' }) },
  { id: 'island_bench', label: 'Paillasse centrale', family: 'labo', footprint: [2.4, 1.5, 1.82], cover: 'low', mount: 'floor', build: (b) => islandBench(b) },
  { id: 'analyser_large', label: "Automate d'analyses (grand modèle)", family: 'labo', footprint: [2.2, 0.95, 1.68], cover: 'low', mount: 'floor', build: (b) => analyserLarge(b) },
  { id: 'analyser_bench', label: 'Automate de paillasse', family: 'labo', footprint: [0.7, 0.55, 0.6], cover: 'none', mount: 'bench', build: (b) => analyserBench(b) },
  { id: 'conveyor', label: 'Chaîne de tri (convoyeur de tubes)', family: 'labo', footprint: [2, 0.45, 1.22], cover: 'low', mount: 'floor', build: (b) => conveyor(b) },
  { id: 'centrifuge_floor', label: 'Centrifugeuse au sol', family: 'labo', footprint: [0.65, 0.75, 0.95], cover: 'low', mount: 'floor', build: (b) => centrifugeFloor(b) },
  { id: 'centrifuge_bench', label: 'Centrifugeuse de paillasse', family: 'labo', footprint: [0.42, 0.5, 0.32], cover: 'none', mount: 'bench', build: (b) => centrifugeBench(b) },
  { id: 'microscope', label: 'Microscope', family: 'labo', footprint: [0.22, 0.32, 0.45], cover: 'none', mount: 'bench', build: (b) => microscope(b) },
  { id: 'tube_rack', label: 'Portoir de tubes', family: 'labo', footprint: [0.26, 0.1, 0.12], cover: 'none', mount: 'bench', build: (b) => tubeRack(b) },
  { id: 'tube_box', label: 'Boîte de tubes', family: 'labo', footprint: [0.3, 0.28, 0.2], cover: 'none', mount: 'bench', build: (b) => tubeBox(b) },
  { id: 'pipette_stand', label: 'Portoir de pipettes', family: 'labo', footprint: [0.2, 0.2, 0.43], cover: 'none', mount: 'bench', build: (b) => pipetteStand(b) },
  { id: 'fume_hood', label: 'Poste de sécurité microbiologique', family: 'labo', footprint: [1.5, 0.8, 2.3], cover: 'high', mount: 'floor', build: (b) => fumeHood(b) },
  { id: 'lab_fridge', label: 'Réfrigérateur de laboratoire', family: 'labo', footprint: [0.75, 0.7, 1.95], cover: 'high', mount: 'floor', build: (b) => labFridge(b) },
  { id: 'freezer', label: 'Congélateur −80 °C', family: 'labo', footprint: [0.82, 0.85, 1.95], cover: 'high', mount: 'floor', build: (b) => freezer(b) },
  { id: 'reagent_cabinet', label: 'Armoire à réactifs', family: 'labo', footprint: [1, 0.5, 2], cover: 'high', mount: 'floor', build: (b) => reagentCabinet(b) },
  { id: 'storage_shelf', label: 'Étagère de stockage', family: 'labo', footprint: [1.2, 0.5, 2], cover: 'high', mount: 'floor', build: (b) => storageShelf(b) },
  { id: 'trolley', label: 'Chariot', family: 'labo', footprint: [0.85, 0.5, 1], cover: 'low', mount: 'floor', build: (b) => trolley(b) },
  { id: 'clinical_waste_bin', label: 'Poubelle DASRI', family: 'labo', footprint: [0.42, 0.4, 0.7], cover: 'none', mount: 'floor', build: (b) => clinicalWasteBin(b) },
  { id: 'sharps_box', label: "Collecteur d'aiguilles", family: 'labo', footprint: [0.16, 0.16, 0.22], cover: 'none', mount: 'bench', build: (b) => sharpsBox(b) },
  { id: 'gel_dispenser', label: 'Distributeur de gel hydroalcoolique', family: 'labo', footprint: [0.13, 0.11, 1.35], cover: 'none', mount: 'wall', build: (b) => gelDispenser(b) },
  { id: 'gel_stand', label: 'Distributeur de gel sur pied', family: 'labo', footprint: [0.36, 0.36, 1.64], cover: 'none', mount: 'floor', build: (b) => gelStand(b) },
  { id: 'sample_cooler', label: "Glacière d'échantillons", family: 'labo', footprint: [0.46, 0.31, 0.34], cover: 'none', mount: 'floor', build: (b) => sampleCooler(b) },
  { id: 'gas_cylinder', label: 'Bonbonne de gaz', family: 'labo', footprint: [0.3, 0.3, 1.5], cover: 'none', mount: 'floor', build: (b) => gasCylinder(b) },
  { id: 'label_printer', label: "Imprimante d'étiquettes", family: 'labo', footprint: [0.2, 0.3, 0.18], cover: 'none', mount: 'bench', build: (b) => labelPrinter(b) },
];
