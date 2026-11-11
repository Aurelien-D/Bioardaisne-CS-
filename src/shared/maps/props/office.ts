/**
 * Office and common-area props: desks, chairs, storage, break room, wall fittings.
 * Local space: origin at floor level, centre of the footprint, front facing +Z.
 * For desks, the FRONT is the user's side (the chair goes on the +Z side, facing −Z).
 * For chairs and sofas, the front is where the sitter looks.
 */
import type { MapBuilder } from '../builder';
import type { MaterialId } from '../materials';
import { hash3, mulberry32 } from '../../math/rng';
import { C, ball, bx, carton, casters, cyl, cylX, cylZ, handle, hull, keyboard, led, monitor, starBase, tilt, type PropInfo } from './kit';
import { cabinetFronts } from './lab';

// ---------------------------------------------------------------------------------
// Desks and seating
// ---------------------------------------------------------------------------------

/** Caisson à tiroirs: three-drawer pedestal on casters (0.42 × 0.55 × 0.6 m). */
export function drawerUnit(b: MapBuilder, o: { collide?: boolean } = {}): void {
  casters(b, 0.38, 0.5, 0.05);
  bx(b, 0, 0.05, -0.01, 0.42, 0.53, 0.53, 'metal_white');
  for (let k = 0; k < 3; k++) {
    const h = k === 0 ? 0.24 : 0.13;
    const y = k === 0 ? 0.06 : 0.06 + 0.25 + (k - 1) * 0.14;
    bx(b, 0, y, 0.262, 0.4, h, 0.014, 'plastic_white', C.front);
    handle(b, 0, y + h - 0.035, 0.269, 0.14);
  }
  bx(b, 0.15, 0.545, 0.27, 0.025, 0.025, 0.006, 'metal_brushed'); // lock
  if (o.collide !== false) hull(b, 0, 0, 0, 0.42, 0.58, 0.55, 'metal');
}

/** Bureau droit: straight desk (1.6 × 0.8 × 0.74 m). The user sits on the +Z side. */
export function desk(b: MapBuilder, o: { width?: number; top?: MaterialId; pedestal?: boolean } = {}): void {
  const w = o.width ?? 1.6;
  bx(b, 0, 0.71, 0, w, 0.03, 0.8, o.top ?? 'laminate_grey');
  for (const s of [-1, 1]) {
    bx(b, s * (w / 2 - 0.04), 0, 0, 0.05, 0.03, 0.72, 'metal_white');
    bx(b, s * (w / 2 - 0.04), 0.03, 0, 0.05, 0.68, 0.06, 'metal_white');
    bx(b, s * (w / 2 - 0.04), 0.68, 0, 0.05, 0.03, 0.7, 'metal_white');
  }
  bx(b, 0, 0.3, -0.36, w - 0.16, 0.38, 0.018, 'laminate_grey', 0xdfe3e6); // modesty panel
  bx(b, 0, 0.64, -0.3, w - 0.2, 0.05, 0.1, 'metal_grate'); // cable tray
  if (o.pedestal !== false) b.at(w / 2 - 0.33, 0, 0.1, 0, () => drawerUnit(b, { collide: false }));
  hull(b, 0, 0, 0, w, 0.74, 0.8, 'wood');
}

/** Bureau d'angle: L-shaped corner desk (1.8 × 1.6 × 0.74 m). The user sits in the inner corner (−X, +Z). */
export function cornerDesk(b: MapBuilder, o: { top?: MaterialId } = {}): void {
  const top = o.top ?? 'laminate_grey';
  bx(b, 0, 0.71, -0.4, 1.8, 0.03, 0.8, top);
  bx(b, 0.5, 0.71, 0.4, 0.8, 0.03, 0.8, top);
  // legs: panel ends + a post at the inner corner
  bx(b, -0.87, 0, -0.4, 0.04, 0.71, 0.72, 'metal_white');
  bx(b, 0.5, 0, 0.77, 0.72, 0.71, 0.04, 'metal_white');
  bx(b, 0.87, 0, -0.76, 0.05, 0.71, 0.05, 'metal_white');
  bx(b, 0.14, 0, -0.04, 0.05, 0.71, 0.05, 'metal_white');
  bx(b, -0.02, 0.3, -0.77, 1.62, 0.38, 0.018, 'laminate_grey', 0xdfe3e6);
  bx(b, 0.875, 0.3, 0.0, 0.018, 0.38, 1.45, 'laminate_grey', 0xdfe3e6);
  b.at(0.62, 0, 0.42, 3, () => drawerUnit(b, { collide: false }));
  hull(b, 0, 0, -0.4, 1.8, 0.74, 0.8, 'wood');
  hull(b, 0.5, 0, 0.4, 0.8, 0.74, 0.8, 'wood');
}

/** Fauteuil de bureau: swivel chair on casters (0.6 × 0.6 × 1.05 m). */
export function officeChair(b: MapBuilder, o: { mat?: MaterialId; tint?: number } = {}): void {
  const mat = o.mat ?? 'fabric_grey';
  const top = starBase(b, 0.29);
  cyl(b, 0, top, 0, 0.05, 0.3, 'metal_brushed', undefined, 8);
  bx(b, 0, 0.41, 0, 0.3, 0.035, 0.3, 'plastic_black');
  bx(b, 0, 0.445, 0.02, 0.48, 0.075, 0.46, mat, o.tint);
  bx(b, 0, 0.44, -0.23, 0.06, 0.24, 0.035, 'plastic_black');
  tilt(b, 0, 0.82, -0.25, 0.44, 0.5, 0.06, -8, mat, o.tint);
  for (const s of [-1, 1]) {
    bx(b, s * 0.265, 0.46, 0.0, 0.03, 0.2, 0.04, 'plastic_black');
    bx(b, s * 0.265, 0.66, 0.03, 0.055, 0.03, 0.26, 'plastic_black');
  }
  hull(b, 0, 0, 0.01, 0.5, 0.52, 0.5, 'fabric');
  hull(b, 0, 0.52, -0.25, 0.44, 0.52, 0.12, 'fabric');
}

/** Chaise visiteur: simple four-legged chair (0.48 × 0.52 × 0.84 m). */
export function visitorChair(b: MapBuilder, o: { mat?: MaterialId; tint?: number; collide?: boolean } = {}): void {
  const mat = o.mat ?? 'fabric_blue';
  for (const sx of [-1, 1]) {
    bx(b, sx * 0.2, 0, 0.2, 0.025, 0.43, 0.025, 'metal_dark');
    bx(b, sx * 0.2, 0, -0.2, 0.025, 0.82, 0.025, 'metal_dark');
  }
  for (const sx of [-1, 1]) bx(b, sx * 0.2, 0.39, 0, 0.02, 0.03, 0.4, 'metal_dark');
  bx(b, 0, 0.43, 0.01, 0.44, 0.05, 0.44, mat, o.tint);
  bx(b, 0, 0.56, -0.2, 0.42, 0.26, 0.03, mat, o.tint);
  if (o.collide !== false) {
    hull(b, 0, 0, 0.01, 0.46, 0.48, 0.46, 'fabric');
    hull(b, 0, 0.48, -0.2, 0.44, 0.35, 0.06, 'fabric');
  }
}

/** Poste informatique: monitor, keyboard, mouse and tower — put it on a desk (bench-top, no collider). */
export function computerSet(b: MapBuilder, o: { screen?: MaterialId } = {}): void {
  monitor(b, 0.05, 0, -0.1, 0.54, 0.33, o.screen ?? 'screen_on');
  keyboard(b, 0.0, 0, 0.12);
  // tower with a power LED and a drive slot
  bx(b, -0.36, 0, -0.03, 0.17, 0.38, 0.4, 'plastic_black');
  bx(b, -0.36, 0.3, 0.171, 0.13, 0.02, 0.004, 'plastic_grey');
  led(b, -0.4, 0.24, 0.171, 'led_blue', 0.014);
  bx(b, -0.36, 0.06, 0.171, 0.11, 0.1, 0.004, 'metal_grate');
}

/** Poste de travail complet: desk + computer + office chair (1.6 × 1.5 × 1.05 m). */
export function workstation(b: MapBuilder, o: { chairTint?: number } = {}): void {
  b.at(0, 0, -0.35, 0, () => {
    desk(b);
    b.at(-0.15, 0.74, -0.08, 0, () => computerSet(b));
    bx(b, 0.52, 0.74, 0.15, 0.22, 0.012, 0.3, 'paper_white'); // paperwork
    cyl(b, 0.6, 0.74, -0.2, 0.08, 0.1, 'plastic_white', C.blue, 8); // mug
  });
  const chairOpts: { tint?: number } = {};
  if (o.chairTint !== undefined) chairOpts.tint = o.chairTint;
  b.at(-0.1, 0, 0.42, 2, () => officeChair(b, chairOpts));
}

/** Canapé: two-seat sofa (1.8 × 0.85 × 0.8 m). */
export function sofa(b: MapBuilder, o: { mat?: MaterialId; tint?: number } = {}): void {
  const mat = o.mat ?? 'fabric_blue';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, sx * 0.8, 0, sz * 0.34, 0.06, 0.1, 0.06, 'wood_dark');
  bx(b, 0, 0.1, 0, 1.8, 0.2, 0.85, mat, o.tint);
  bx(b, 0, 0.3, -0.365, 1.8, 0.48, 0.12, mat, o.tint);
  for (const s of [-1, 1]) {
    bx(b, s * 0.82, 0.3, 0.06, 0.16, 0.26, 0.73, mat, o.tint);
    bx(b, s * 0.37, 0.3, 0.07, 0.72, 0.14, 0.68, mat, 0xe2e8f2);
    tilt(b, s * 0.37, 0.6, -0.25, 0.72, 0.4, 0.15, -12, mat, 0xe2e8f2);
  }
  tilt(b, -0.55, 0.52, 0.0, 0.36, 0.36, 0.1, -25, 'fabric_red', undefined, 20); // cushion
  hull(b, 0, 0, 0, 1.8, 0.45, 0.85, 'fabric');
  hull(b, 0, 0.45, -0.31, 1.8, 0.36, 0.23, 'fabric');
}

/** Table de réunion with six chairs (2.4 × 2.3 × 0.85 m). */
export function meetingTable(b: MapBuilder, o: { chairs?: boolean } = {}): void {
  bx(b, 0, 0.7, 0, 2.4, 0.04, 1.1, 'wood_light');
  for (const s of [-1, 1]) {
    bx(b, s * 0.85, 0, 0, 0.08, 0.7, 0.7, 'metal_dark');
    bx(b, s * 0.85, 0, 0, 0.12, 0.03, 0.9, 'metal_dark');
  }
  bx(b, 0, 0.55, 0, 1.62, 0.08, 0.06, 'metal_dark');
  // conference phone, papers, a forgotten mug
  cyl(b, 0, 0.74, 0, 0.22, 0.035, 'plastic_black', undefined, 10);
  tilt(b, -0.6, 0.745, 0.25, 0.21, 0.004, 0.29, 0, 'paper_white', undefined, 12);
  tilt(b, 0.55, 0.745, -0.22, 0.21, 0.004, 0.29, 0, 'paper_white', 0xffe9a8, -20);
  cyl(b, 0.8, 0.74, 0.28, 0.08, 0.1, 'plastic_white', C.red, 8);
  hull(b, 0, 0, 0, 2.4, 0.74, 1.1, 'wood');
  if (o.chairs !== false) {
    for (let i = 0; i < 3; i++) {
      const x = -0.75 + i * 0.75;
      b.at(x, 0, 0.86, 2, () => visitorChair(b, { collide: false }));
      b.at(x, 0, -0.86, 0, () => visitorChair(b, { collide: false }));
    }
    hull(b, 0, 0, 0.87, 2.0, 0.48, 0.5, 'fabric');
    hull(b, 0, 0, -0.87, 2.0, 0.48, 0.5, 'fabric');
  }
}

// ---------------------------------------------------------------------------------
// Storage and equipment
// ---------------------------------------------------------------------------------

/** Armoire de bureau: two-door steel cupboard (1.0 × 0.45 × 1.95 m). */
export function officeCupboard(b: MapBuilder, o: { tint?: number } = {}): void {
  bx(b, 0, 0, -0.01, 0.96, 0.08, 0.4, 'metal_dark');
  bx(b, 0, 0.08, -0.012, 1.0, 1.87, 0.426, 'metal_grey', o.tint);
  for (const s of [-1, 1]) {
    bx(b, s * 0.247, 0.11, 0.208, 0.485, 1.81, 0.016, 'metal_grey', o.tint ?? 0xe6eaed);
    handle(b, s * 0.05, 1.05, 0.214, 0.22, true);
    bx(b, s * 0.25, 1.55, 0.2165, 0.16, 0.06, 0.003, 'paper_white');
  }
  bx(b, 0.05, 0.98, 0.218, 0.02, 0.03, 0.006, 'metal_brushed');
  carton(b, -0.2, 1.95, 0, 0.4, 0.22, 0.32);
  hull(b, 0, 0, 0, 1.0, 1.95, 0.45, 'metal');
}

/** Étagère à classeurs: open bookcase full of binders (1.0 × 0.36 × 1.95 m). */
export function binderShelf(b: MapBuilder, o: { seed?: number } = {}): void {
  for (const s of [-1, 1]) bx(b, s * 0.49, 0, 0, 0.02, 1.95, 0.36, 'wood_light');
  bx(b, 0, 0, -0.172, 0.96, 1.95, 0.012, 'wood_light', 0xe9dcc4);
  const levels = [0.06, 0.44, 0.82, 1.2, 1.58];
  for (const y of [...levels, 1.93]) bx(b, 0, y - 0.02, 0, 0.96, 0.02, 0.35, 'wood_light');
  const rng = mulberry32(hash3(o.seed ?? 0, 811));
  const tints = [C.blue, C.red, 0x2f2f33, 0x58b368, 0xe9c63a, 0xffffff, C.navy];
  for (const y of levels) {
    let x = -0.46;
    let last = -1;
    while (x < 0.34) {
      if (rng() < 0.14) {
        x += 0.09; // a gap where a binder is out on someone's desk
        continue;
      }
      // a block of 1–3 binders of the same colour, with one label band
      const bw = Math.min(0.085 * (1 + Math.floor(rng() * 3)), 0.46 - x);
      let ti = Math.floor(rng() * tints.length);
      if (ti === last) ti = (ti + 1) % tints.length;
      last = ti;
      const hgt = 0.3 + rng() * 0.02;
      bx(b, x + bw / 2, y, 0.02, bw - 0.008, hgt, 0.26, 'plastic_white', tints[ti]!);
      bx(b, x + bw / 2, y + 0.17, 0.151, bw - 0.03, 0.07, 0.003, 'paper_white');
      x += bw;
    }
    if (x < 0.36 && rng() < 0.7) tilt(b, x + 0.055, y + 0.155, 0.02, 0.06, 0.31, 0.26, 0, 'plastic_white', tints[Math.floor(rng() * tints.length)]!, 0, -9);
  }
  hull(b, 0, 0, 0, 1.0, 1.95, 0.36, 'wood');
}

/** Photocopieur: multifunction copier with paper trays and a document feeder (0.75 × 0.65 × 1.15 m). */
export function photocopier(b: MapBuilder): void {
  b.at(0.08, 0, 0, 0, () => photocopierBody(b));
}

function photocopierBody(b: MapBuilder): void {
  casters(b, 0.56, 0.56, 0.06);
  bx(b, 0, 0.06, 0, 0.62, 0.72, 0.62, 'plastic_white', 0xe4e6e3);
  for (let k = 0; k < 3; k++) {
    bx(b, 0, 0.09 + k * 0.2, 0.312, 0.58, 0.18, 0.012, 'plastic_white');
    handle(b, 0, 0.2 + k * 0.2, 0.318, 0.2);
  }
  bx(b, 0, 0.78, 0, 0.64, 0.14, 0.64, 'plastic_grey', 0x5e646b); // scanner body
  bx(b, 0, 0.92, -0.02, 0.62, 0.05, 0.56, 'plastic_white', 0xe4e6e3); // lid
  bx(b, -0.05, 0.97, -0.06, 0.5, 0.09, 0.42, 'plastic_white', 0xe4e6e3); // document feeder
  bx(b, -0.05, 1.06, -0.04, 0.3, 0.004, 0.24, 'paper_white');
  tilt(b, 0.19, 0.97, 0.25, 0.24, 0.02, 0.16, 25, 'plastic_black'); // control panel
  tilt(b, 0.19, 0.981, 0.255, 0.14, 0.004, 0.1, 25, 'screen_on');
  led(b, 0.02, 0.86, 0.321, 'led_green');
  // output tray on the −X side with a few copies
  bx(b, -0.4, 0.66, 0, 0.18, 0.02, 0.4, 'plastic_grey', 0x5e646b);
  bx(b, -0.4, 0.68, 0, 0.14, 0.012, 0.3, 'paper_white');
  hull(b, 0, 0, 0, 0.64, 1.06, 0.64, 'plastic');
}

/** Casiers vestiaire: bank of three lockers (0.9 × 0.5 × 1.9 m). */
export function lockers(b: MapBuilder, o: { doors?: number; tint?: number } = {}): void {
  const n = o.doors ?? 3;
  const w = n * 0.3;
  for (const s of [-1, 1]) bx(b, s * (w / 2 - 0.04), 0, 0, 0.05, 0.1, 0.44, 'metal_dark');
  bx(b, 0, 0.1, -0.01, w, 1.8, 0.48, 'metal_grey');
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * 0.3;
    bx(b, x, 0.12, 0.232, 0.28, 1.76, 0.014, 'metal_white', o.tint ?? C.blue);
    bx(b, x, 1.68, 0.24, 0.16, 0.08, 0.003, 'metal_grate');
    bx(b, x, 0.2, 0.24, 0.16, 0.08, 0.003, 'metal_grate');
    bx(b, x, 1.5, 0.24, 0.12, 0.04, 0.003, 'paper_white');
    bx(b, x + 0.1, 1.0, 0.243, 0.025, 0.07, 0.012, 'metal_brushed');
  }
  bx(b, w / 2 - 0.2, 0.96, 0.262, 0.03, 0.04, 0.02, 'metal_yellow'); // a padlock
  hull(b, 0, 0, 0, w, 1.9, 0.5, 'metal');
}

/** One lab coat hanging from (0, y, 0): shoulders at height y, facing +Z. */
function labCoat(b: MapBuilder, tint?: number): void {
  bx(b, 0, -0.08, 0, 0.44, 0.08, 0.12, 'fabric_white', tint);
  bx(b, 0, -0.95, 0, 0.4, 0.87, 0.1, 'fabric_white', tint);
  for (const s of [-1, 1]) bx(b, s * 0.245, -0.66, 0, 0.09, 0.6, 0.09, 'fabric_white', tint);
  bx(b, 0.1, -0.42, 0.052, 0.11, 0.1, 0.004, 'fabric_white', 0xdcdcd8); // breast pocket
  bx(b, 0.08, -0.36, 0.056, 0.012, 0.07, 0.008, 'plastic_blue'); // pens
  bx(b, 0.11, -0.36, 0.056, 0.012, 0.07, 0.008, 'plastic_red');
}

/** Portemanteau: coat stand carrying two lab coats (0.6 × 0.6 × 1.8 m). */
export function coatRack(b: MapBuilder): void {
  cyl(b, 0, 0, 0, 0.44, 0.03, 'metal_dark', undefined, 12);
  cyl(b, 0, 0.03, 0, 0.045, 1.72, 'metal_dark', undefined, 8);
  ball(b, 0, 1.77, 0, 0.08, 0.08, 0.08, 'metal_dark', undefined, 8);
  for (const s of [-1, 1]) {
    cylZ(b, 0, 1.64, s * 0.1, 0.02, 0.2, 'metal_dark', undefined, 6);
    cylX(b, s * 0.1, 1.56, 0, 0.02, 0.2, 'metal_dark', undefined, 6);
  }
  b.at(0, 1.62, 0.16, 0, () => labCoat(b));
  b.at(0, 1.62, -0.16, 2, () => labCoat(b, 0xe8eef6));
  hull(b, 0, 0, 0, 0.36, 1.75, 0.36, 'fabric');
}

/** Patères murales: wall rail with three lab coats (1.42 × 0.22 × 1.7 m). */
export function coatHooks(b: MapBuilder): void {
  const zb = -0.11;
  bx(b, 0, 1.6, zb + 0.01, 1.4, 0.09, 0.02, 'wood_light');
  for (let i = 0; i < 5; i++) cylZ(b, -0.56 + i * 0.28, 1.63, zb + 0.05, 0.02, 0.07, 'metal_brushed', undefined, 6);
  b.at(-0.42, 1.64, zb + 0.1, 0, () => labCoat(b));
  b.at(0, 1.64, zb + 0.1, 0, () => labCoat(b, 0xe8eef6));
  b.at(0.42, 1.64, zb + 0.13, 0, () => labCoat(b, 0xbdd3ee));
}

// ---------------------------------------------------------------------------------
// Break room
// ---------------------------------------------------------------------------------

/** Machine à café: capsule machine with its water tank and a cup (bench-top). */
export function coffeeMachine(b: MapBuilder): void {
  bx(b, 0, 0, -0.02, 0.2, 0.3, 0.3, 'plastic_black');
  bx(b, 0, 0.3, -0.02, 0.2, 0.05, 0.3, 'metal_brushed');
  bx(b, 0, 0.19, 0.16, 0.1, 0.1, 0.08, 'plastic_black'); // spout head
  bx(b, 0, 0, 0.2, 0.18, 0.025, 0.12, 'metal_grate'); // drip tray
  cyl(b, 0, 0.025, 0.2, 0.065, 0.07, 'plastic_white', undefined, 8);
  bx(b, 0, 0.02, -0.21, 0.16, 0.26, 0.08, 'glass', 0x9fd0ff); // water tank
  led(b, -0.05, 0.325, 0.132, 'led_green', 0.016);
  led(b, 0.05, 0.325, 0.132, 'led_red', 0.016);
  tilt(b, 0, 0.37, 0.02, 0.05, 0.02, 0.2, 14, 'metal_brushed'); // lever
}

/** Micro-ondes (bench-top, 0.5 × 0.38 × 0.3 m). */
export function microwave(b: MapBuilder): void {
  bx(b, 0, 0.01, 0, 0.5, 0.28, 0.36, 'metal_white');
  bx(b, -0.07, 0.035, 0.181, 0.33, 0.23, 0.006, 'screen_off');
  bx(b, -0.07, 0.05, 0.185, 0.27, 0.2, 0.004, 'glass', C.smoke);
  handle(b, 0.115, 0.15, 0.184, 0.2, true);
  bx(b, 0.19, 0.035, 0.181, 0.1, 0.23, 0.006, 'plastic_grey', 0x70757b);
  bx(b, 0.19, 0.215, 0.185, 0.07, 0.03, 0.004, 'led_green');
  for (let i = 0; i < 6; i++) bx(b, 0.168 + (i % 2) * 0.044, 0.07 + Math.floor(i / 2) * 0.045, 0.185, 0.03, 0.03, 0.006, 'plastic_white');
  hull(b, 0, 0, 0, 0.5, 0.29, 0.36, 'metal');
}

/** Comptoir de la salle de pause: kitchen counter with microwave, coffee machine and mugs (1.8 × 0.62 × 1.35 m). */
export function kitchenCounter(b: MapBuilder, o: { width?: number } = {}): void {
  const w = o.width ?? 1.8;
  bx(b, 0, 0, -0.04, w - 0.04, 0.1, 0.48, 'plastic_grey', 0x6a6f75);
  bx(b, 0, 0.1, -0.015, w, 0.76, 0.57, 'laminate_white');
  cabinetFronts(b, w - 0.02, 0.27, 0.12, 0.72, 2, 0xf1e3c8);
  bx(b, 0, 0.86, 0, w + 0.02, 0.04, 0.62, 'wood_light');
  bx(b, 0, 0.9, -0.3, w, 0.5, 0.012, 'wall_tile_white'); // splash-back
  b.at(-w / 2 + 0.38, 0.9, -0.05, 0, () => microwave(b));
  b.at(0.15, 0.9, -0.02, 0, () => coffeeMachine(b));
  const mugs = [C.blue, C.red, 0xffffff, 0xe9c63a];
  mugs.forEach((tint, i) => cyl(b, w / 2 - 0.55 + (i % 2) * 0.11, 0.9, -0.12 + Math.floor(i / 2) * 0.11, 0.08, 0.095, 'plastic_white', tint, 8));
  bx(b, w / 2 - 0.2, 0.9, 0.0, 0.2, 0.14, 0.14, 'cardboard', 0xc0392b); // box of capsules
  cyl(b, w / 2 - 0.2, 0.9, -0.2, 0.09, 0.2, 'plastic_white', C.light, 8); // kettle
  hull(b, 0, 0, 0, w, 0.9, 0.6, 'wood');
}

/** Réfrigérateur de cuisine: fridge-freezer with notes stuck on the door (0.6 × 0.66 × 1.8 m). */
export function kitchenFridge(b: MapBuilder): void {
  bx(b, 0, 0, -0.02, 0.56, 0.06, 0.56, 'metal_dark');
  bx(b, 0, 0.06, -0.025, 0.6, 1.74, 0.6, 'metal_white');
  bx(b, 0, 0.08, 0.3, 0.59, 1.18, 0.05, 'metal_white', 0xf4f6f6);
  bx(b, 0, 1.28, 0.3, 0.59, 0.5, 0.05, 'metal_white', 0xf4f6f6);
  handle(b, -0.24, 0.95, 0.327, 0.4, true);
  handle(b, -0.24, 1.5, 0.327, 0.22, true);
  // the usual door literature: planning, post-its, a magnet
  bx(b, 0.08, 0.85, 0.326, 0.21, 0.29, 0.003, 'paper_white');
  bx(b, -0.02, 0.7, 0.3265, 0.075, 0.075, 0.003, 'paper_white', 0xfff27a);
  bx(b, 0.16, 0.62, 0.3265, 0.075, 0.075, 0.003, 'paper_white', 0xffb3c8);
  cylZ(b, 0.08, 1.15, 0.327, 0.035, 0.008, 'plastic_red', undefined, 8);
  cylZ(b, 0.12, 1.45, 0.327, 0.05, 0.008, 'plastic_blue', undefined, 8);
  hull(b, 0, 0, 0, 0.6, 1.8, 0.66, 'metal');
}

// ---------------------------------------------------------------------------------
// Wall fittings
// ---------------------------------------------------------------------------------

/** Tableau blanc: whiteboard with a planning grid, magnets and markers (1.8 × 0.08 m, hung at 0.9–2.1 m). */
export function whiteboard(b: MapBuilder, o: { width?: number; text?: string } = {}): void {
  const w = o.width ?? 1.8;
  const zb = -0.04;
  bx(b, 0, 0.9, zb + 0.008, w, 1.2, 0.016, 'metal_brushed');
  bx(b, 0, 0.93, zb + 0.02, w - 0.06, 1.14, 0.008, 'plastic_white');
  bx(b, 0, 0.9, zb + 0.045, w * 0.6, 0.02, 0.06, 'metal_brushed'); // tray
  ['plastic_blue', 'plastic_red', 'plastic_green'].forEach((m, i) => cylX(b, -0.2 + i * 0.16, 0.932, zb + 0.05, 0.02, 0.13, m as MaterialId, undefined, 6));
  bx(b, 0.3, 0.92, zb + 0.05, 0.12, 0.035, 0.05, 'plastic_grey');
  const zf = zb + 0.0255;
  // planning grid drawn with a blue marker, a red header, a few coloured magnets
  const gw = w * 0.52;
  const gx = -w / 2 + 0.12 + gw / 2;
  for (let i = 0; i < 5; i++) bx(b, gx, 1.2 + i * 0.16, zf, gw, 0.008, 0.002, 'plastic_blue');
  for (let i = 0; i < 6; i++) bx(b, gx - gw / 2 + (i * gw) / 5, 1.2, zf, 0.008, 0.648, 0.002, 'plastic_blue');
  bx(b, gx, 1.9, zf, gw * 0.7, 0.03, 0.002, 'plastic_red');
  const mags: [number, number, MaterialId][] = [
    [0.1, 0.08, 'plastic_red'],
    [0.3, 0.24, 'plastic_green'],
    [0.5, 0.4, 'plastic_yellow'],
    [0.7, 0.08, 'plastic_green'],
    [0.9, 0.56, 'plastic_red'],
  ];
  for (const [fx, dy, m] of mags) cylZ(b, gx - gw / 2 + fx * gw, 1.2 + dy, zf + 0.004, 0.045, 0.008, m, undefined, 8);
  // notes on the right
  bx(b, w / 2 - 0.35, 1.5, zf, 0.21, 0.29, 0.003, 'paper_white', 0xfff7d6);
  bx(b, w / 2 - 0.35, 1.2, zf, 0.3, 0.012, 0.002, 'plastic_green');
  bx(b, w / 2 - 0.4, 1.12, zf, 0.2, 0.012, 0.002, 'plastic_green');
  if (o.text) b.sign({ x: w / 2 - 0.35, y: 1.95, z: zf + 0.002, facing: 0, w: 0.5, h: 0.12, text: o.text, style: 'plaque' });
}

/** Panneau d'affichage: cork board covered with notices (1.2 × 0.05 m, hung at 1.0–1.9 m). */
export function noticeBoard(b: MapBuilder, o: { seed?: number } = {}): void {
  const zb = -0.025;
  bx(b, 0, 1.0, zb + 0.01, 1.2, 0.9, 0.02, 'wood_light');
  bx(b, 0, 1.04, zb + 0.024, 1.12, 0.82, 0.008, 'cardboard');
  const rng = mulberry32(hash3(o.seed ?? 0, 131));
  const tints = [0xffffff, 0xfff27a, 0xcfe6ff, 0xffd0dc, 0xd8f0c8, 0xffffff];
  const cols = 4;
  for (let i = 0; i < 8; i++) {
    const cx = -0.42 + (i % cols) * 0.28 + (rng() - 0.5) * 0.05;
    const cy = 1.26 + Math.floor(i / cols) * 0.38 + (rng() - 0.5) * 0.05;
    const big = rng() < 0.6;
    const pw = big ? 0.21 : 0.15;
    const ph = big ? 0.29 : 0.11;
    tilt(b, cx, cy, zb + 0.03 + i * 0.0006, pw, ph, 0.002, 0, 'paper_white', tints[Math.floor(rng() * tints.length)]!, 0, (rng() - 0.5) * 14);
    cylZ(b, cx, cy + ph / 2 - 0.02, zb + 0.036, 0.018, 0.008, i % 3 === 0 ? 'plastic_red' : 'plastic_blue', undefined, 6);
  }
}

/** Extincteur: wall-mounted fire extinguisher with its sign. */
export function fireExtinguisher(b: MapBuilder): void {
  const zb = -0.09;
  bx(b, 0, 0.55, zb + 0.01, 0.08, 0.5, 0.02, 'metal_dark'); // bracket
  cyl(b, 0, 0.45, 0, 0.15, 0.46, 'metal_red', undefined, 10);
  ball(b, 0, 0.91, 0, 0.15, 0.12, 0.15, 'metal_red', undefined, 10);
  cyl(b, 0, 0.95, 0, 0.05, 0.06, 'metal_brushed', undefined, 8);
  bx(b, 0, 1.0, 0.02, 0.03, 0.03, 0.14, 'plastic_black'); // lever
  bx(b, 0, 1.04, 0.03, 0.025, 0.02, 0.12, 'plastic_black');
  tilt(b, 0.085, 0.75, 0.02, 0.025, 0.42, 0.025, 0, 'rubber_black', undefined, 0, 6); // hose
  cyl(b, 0, 0.6, 0, 0.154, 0.16, 'paper_white', undefined, 10); // label
  cylZ(b, -0.04, 0.99, 0.03, 0.035, 0.012, 'metal_white', undefined, 8); // gauge
  bx(b, 0, 1.4, zb + 0.004, 0.2, 0.2, 0.008, 'plastic_red');
  bx(b, 0, 1.44, zb + 0.009, 0.07, 0.12, 0.003, 'paper_white');
}

/** Radiateur: panel radiator under a window (1.0 × 0.1 × 0.76 m). */
export function radiator(b: MapBuilder, o: { width?: number } = {}): void {
  const w = o.width ?? 1;
  bx(b, 0, 0.15, -0.01, w, 0.6, 0.05, 'metal_white');
  const n = Math.max(4, Math.round(w / 0.08));
  for (let i = 0; i < n; i++) bx(b, -w / 2 + ((i + 0.5) * w) / n, 0.17, 0.02, 0.022, 0.56, 0.012, 'metal_white', 0xe2e5e4);
  bx(b, 0, 0.75, -0.005, w, 0.012, 0.08, 'metal_white', 0xd5d9d8);
  for (const s of [-1, 1]) {
    cyl(b, s * (w / 2 - 0.06), 0, -0.01, 0.022, 0.16, 'metal_white', undefined, 6);
    bx(b, s * (w / 2 - 0.15), 0.4, -0.042, 0.04, 0.3, 0.016, 'metal_white');
  }
  cylX(b, w / 2 + 0.03, 0.22, -0.01, 0.045, 0.07, 'plastic_white', undefined, 8); // thermostatic valve
  cylX(b, w / 2 + 0.07, 0.22, -0.01, 0.047, 0.012, 'plastic_blue', undefined, 8);
}

/** Horloge murale: round wall clock stuck at ten past ten, centred 2.3 m above the floor. */
export function wallClock(b: MapBuilder): void {
  const y = 2.3;
  cylZ(b, 0, y, 0, 0.36, 0.045, 'plastic_black', undefined, 16);
  cylZ(b, 0, y, 0.02, 0.32, 0.012, 'plastic_white', undefined, 16);
  const zf = 0.028;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    const major = i % 3 === 0;
    b.prim('box', Math.sin(a) * 0.135, y + Math.cos(a) * 0.135, zf, major ? 0.012 : 0.006, major ? 0.035 : 0.02, 0.003, 'plastic_black', { rot: { x: 0, y: 0, z: -a } });
  }
  const hand = (deg: number, len: number, wid: number, mat: MaterialId, z: number): void => {
    const a = (deg * Math.PI) / 180;
    b.prim('box', (Math.sin(a) * len) / 2, y + (Math.cos(a) * len) / 2, z, wid, len, 0.003, mat, { rot: { x: 0, y: 0, z: -a } });
  };
  hand(305, 0.085, 0.014, 'plastic_black', zf + 0.002); // hours
  hand(60, 0.125, 0.01, 'plastic_black', zf + 0.004); // minutes
  hand(200, 0.13, 0.004, 'plastic_red', zf + 0.006); // seconds
  cylZ(b, 0, y, zf + 0.006, 0.022, 0.008, 'plastic_red', undefined, 8);
}

export const OFFICE_PROPS: PropInfo[] = [
  { id: 'desk', label: 'Bureau droit', family: 'bureau', footprint: [1.6, 0.8, 0.74], cover: 'none', mount: 'floor', build: (b) => desk(b) },
  { id: 'corner_desk', label: "Bureau d'angle", family: 'bureau', footprint: [1.8, 1.6, 0.74], cover: 'none', mount: 'floor', build: (b) => cornerDesk(b) },
  { id: 'workstation', label: 'Poste de travail complet', family: 'bureau', footprint: [1.6, 1.5, 1.1], cover: 'none', mount: 'floor', build: (b) => workstation(b) },
  { id: 'office_chair', label: 'Fauteuil de bureau', family: 'bureau', footprint: [0.62, 0.62, 1.07], cover: 'none', mount: 'floor', build: (b) => officeChair(b) },
  { id: 'visitor_chair', label: 'Chaise visiteur', family: 'bureau', footprint: [0.48, 0.48, 0.84], cover: 'none', mount: 'floor', build: (b) => visitorChair(b) },
  { id: 'computer_set', label: 'Poste informatique', family: 'bureau', footprint: [0.9, 0.48, 0.45], cover: 'none', mount: 'bench', build: (b) => computerSet(b) },
  { id: 'drawer_unit', label: 'Caisson à tiroirs', family: 'bureau', footprint: [0.42, 0.55, 0.6], cover: 'none', mount: 'floor', build: (b) => drawerUnit(b) },
  { id: 'office_cupboard', label: 'Armoire de bureau', family: 'bureau', footprint: [1, 0.45, 2.17], cover: 'high', mount: 'floor', build: (b) => officeCupboard(b) },
  { id: 'binder_shelf', label: 'Étagère à classeurs', family: 'bureau', footprint: [1, 0.36, 1.95], cover: 'high', mount: 'floor', build: (b) => binderShelf(b) },
  { id: 'photocopier', label: 'Photocopieur', family: 'bureau', footprint: [0.82, 0.65, 1.1], cover: 'low', mount: 'floor', build: (b) => photocopier(b) },
  { id: 'meeting_table', label: 'Table de réunion', family: 'bureau', footprint: [2.4, 2.2, 0.84], cover: 'none', mount: 'floor', build: (b) => meetingTable(b) },
  { id: 'sofa', label: 'Canapé', family: 'bureau', footprint: [1.8, 0.85, 0.82], cover: 'none', mount: 'floor', build: (b) => sofa(b) },
  { id: 'kitchen_counter', label: 'Comptoir de la salle de pause', family: 'bureau', footprint: [1.82, 0.62, 1.4], cover: 'low', mount: 'floor', build: (b) => kitchenCounter(b) },
  { id: 'coffee_machine', label: 'Machine à café', family: 'bureau', footprint: [0.2, 0.5, 0.4], cover: 'none', mount: 'bench', build: (b) => coffeeMachine(b) },
  { id: 'microwave', label: 'Micro-ondes', family: 'bureau', footprint: [0.5, 0.38, 0.3], cover: 'none', mount: 'bench', build: (b) => microwave(b) },
  { id: 'kitchen_fridge', label: 'Réfrigérateur de cuisine', family: 'bureau', footprint: [0.6, 0.66, 1.8], cover: 'high', mount: 'floor', build: (b) => kitchenFridge(b) },
  { id: 'lockers', label: 'Casiers vestiaire', family: 'bureau', footprint: [0.9, 0.5, 1.9], cover: 'high', mount: 'floor', build: (b) => lockers(b) },
  { id: 'coat_rack', label: 'Portemanteau et blouses', family: 'bureau', footprint: [0.6, 0.55, 1.82], cover: 'none', mount: 'floor', build: (b) => coatRack(b) },
  { id: 'coat_hooks', label: 'Patères et blouses', family: 'bureau', footprint: [1.42, 0.22, 1.7], cover: 'none', mount: 'wall', build: (b) => coatHooks(b) },
  { id: 'whiteboard', label: 'Tableau blanc', family: 'bureau', footprint: [1.8, 0.08, 2.1], cover: 'none', mount: 'wall', build: (b) => whiteboard(b) },
  { id: 'notice_board', label: "Panneau d'affichage", family: 'bureau', footprint: [1.2, 0.05, 1.9], cover: 'none', mount: 'wall', build: (b) => noticeBoard(b) },
  { id: 'fire_extinguisher', label: 'Extincteur', family: 'bureau', footprint: [0.2, 0.18, 1.6], cover: 'none', mount: 'wall', build: (b) => fireExtinguisher(b) },
  { id: 'radiator', label: 'Radiateur', family: 'bureau', footprint: [1.1, 0.1, 0.77], cover: 'none', mount: 'wall', build: (b) => radiator(b) },
  { id: 'wall_clock', label: 'Horloge murale', family: 'bureau', footprint: [0.36, 0.05, 2.48], cover: 'none', mount: 'wall', build: (b) => wallClock(b) },
];
