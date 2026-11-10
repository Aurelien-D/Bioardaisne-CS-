/**
 * Shared vocabulary of the prop library: catalogue entry type, brand colours and tiny
 * drawing helpers that keep prop code short.
 *
 * Authoring rules for a prop (see also docs/ARCHITECTURE.md §15)
 *  - A prop is a function `(b: MapBuilder, opts?) => void` drawn in LOCAL space:
 *    origin at floor level, in the centre of the footprint, front facing +Z, width along X.
 *    Place it with `b.at(x, y, z, quarterTurns, () => prop(b))` or `placeProp(...)`.
 *  - 'bench' props have their origin on the surface they stand on (bench top, desk…).
 *  - 'wall' props are centred on their footprint like the others: their back is at
 *    z = −depth / 2 and their mounting height is built in (origin stays at floor level).
 *  - Visible parts are decorative (no collider). Colliders are declared separately with
 *    `hull()`: one or two boxes matching the bulk. Tiny objects have none.
 */
import type { MapBuilder } from '../builder';
import type { MaterialId, SurfaceType } from '../materials';

export type Cover = 'none' | 'low' | 'high';
export type Mount = 'floor' | 'bench' | 'wall' | 'opening';
export type PropFamily = 'labo' | 'accueil' | 'prelevement' | 'bureau' | 'logistique' | 'ouvertures';

export interface PropInfo {
  /** Unique id, also the key in PROPS. */
  id: string;
  /** French display name. */
  label: string;
  family: PropFamily;
  /** Bounding size [width X, depth Z, height Y] in metres (for 'wall' props the height is the top of the prop above the floor). */
  footprint: [number, number, number];
  /**
   * Protection offered to a player: 'none' (walk-through or lower than ~0.8 m),
   * 'low' (crouch behind it), 'high' (stand behind it).
   */
  cover: Cover;
  /** Where the prop goes: on the floor, on a bench / desk top, on a wall, or in a wall opening. */
  mount: Mount;
  /** Builds the default variant in the current frame of the builder. */
  build: (b: MapBuilder) => void;
}

/** Brand palette and recurring tints (multiplied with the material texture). */
export const C = {
  blue: 0x3182ce,
  blueDark: 0x2b6cb0,
  navy: 0x003f71,
  red: 0xe7343f,
  grey: 0x4a4a49,
  light: 0xeaf6fe,
  /** Soft blue-grey used on cupboard and drawer fronts. */
  front: 0xc9dceb,
  /** Smoked glass / dark tint. */
  smoke: 0x6f8794,
  cream: 0xf3ead2,
  steel: 0xcfd6db,
  dark: 0x2a2d31,
  kraft: 0xcaa574,
} as const;

/** Tube cap colours, in the order every lab technician knows by heart. */
export const CAP_MATS: readonly MaterialId[] = ['plastic_purple', 'plastic_red', 'plastic_green', 'plastic_blue', 'plastic_yellow'];

/**
 * Decorative box from its centre (cx, cz), base height y0 and size (w, h, d). No collider.
 * Small boxes are flagged `detail` automatically (largest face under 0.5 m²).
 */
export function bx(
  b: MapBuilder,
  cx: number,
  y0: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  mat: MaterialId,
  tint?: number,
): void {
  const dims = [w, h, d].sort((p, q) => q - p);
  const detail = dims[0]! * dims[1]! < 0.5;
  const opts: { solid: false; detail?: boolean; tint?: number } = { solid: false };
  if (detail) opts.detail = true;
  if (tint !== undefined) opts.tint = tint;
  b.box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, mat, opts);
}

/** Collider centred on (cx, cz), from y0 up, size (w, h, d). */
export function hull(
  b: MapBuilder,
  cx: number,
  y0: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  surf: SurfaceType = 'plastic',
  noBullets = false,
): void {
  b.collider(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, surf, noBullets ? { noBullets: true } : {});
}

function primOpts(tint: number | undefined, seg: number | undefined, rot?: { x: number; y: number; z: number }) {
  const o: { tint?: number; seg?: number; rot?: { x: number; y: number; z: number } } = {};
  if (tint !== undefined) o.tint = tint;
  if (seg !== undefined) o.seg = seg;
  if (rot) o.rot = rot;
  return o;
}

/** Vertical cylinder standing on y0 (diameter `dia`, height `h`). */
export function cyl(b: MapBuilder, cx: number, y0: number, cz: number, dia: number, h: number, mat: MaterialId, tint?: number, seg?: number): void {
  b.prim('cyl', cx, y0 + h / 2, cz, dia, h, dia, mat, primOpts(tint, seg));
}

/** Horizontal cylinder along X, centred on (cx, cy, cz). */
export function cylX(b: MapBuilder, cx: number, cy: number, cz: number, dia: number, len: number, mat: MaterialId, tint?: number, seg?: number): void {
  b.prim('cyl', cx, cy, cz, dia, len, dia, mat, primOpts(tint, seg, { x: 0, y: 0, z: Math.PI / 2 }));
}

/** Horizontal cylinder along Z, centred on (cx, cy, cz). */
export function cylZ(b: MapBuilder, cx: number, cy: number, cz: number, dia: number, len: number, mat: MaterialId, tint?: number, seg?: number): void {
  b.prim('cyl', cx, cy, cz, dia, len, dia, mat, primOpts(tint, seg, { x: Math.PI / 2, y: 0, z: 0 }));
}

/** Ellipsoid centred on (cx, cy, cz) with diameters (sx, sy, sz). */
export function ball(b: MapBuilder, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: MaterialId, tint?: number, seg?: number): void {
  b.prim('sphere', cx, cy, cz, sx, sy, sz, mat, primOpts(tint, seg));
}

/** Upright cone standing on y0 (apex up). */
export function cone(b: MapBuilder, cx: number, y0: number, cz: number, dia: number, h: number, mat: MaterialId, tint?: number, seg?: number): void {
  b.prim('cone', cx, y0 + h / 2, cz, dia, h, dia, mat, primOpts(tint, seg));
}

/**
 * Box prim centred on (cx, cy, cz) and rotated (degrees). `rx` > 0 leans the top toward +Z
 * (the front), `rx` < 0 leans it back; `ry` turns it counter-clockwise seen from above;
 * `rz` > 0 lifts its +X end.
 */
export function tilt(
  b: MapBuilder,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  rx: number,
  mat: MaterialId,
  tint?: number,
  ry = 0,
  rz = 0,
): void {
  const k = Math.PI / 180;
  b.prim('box', cx, cy, cz, w, h, d, mat, primOpts(tint, undefined, { x: rx * k, y: ry * k, z: rz * k }));
}

/** Four legs of section `t` at the corners of a w × d rectangle (inset by `inset`), from y0 to y0 + h. */
export function legs(b: MapBuilder, w: number, d: number, h: number, t: number, mat: MaterialId, tint?: number, y0 = 0, inset = 0): void {
  const x = w / 2 - t / 2 - inset;
  const z = d / 2 - t / 2 - inset;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(b, sx * x, y0, sz * z, t, h, t, mat, tint);
}

/** Four small caster wheels at the corners of a w × d rectangle; returns their height. */
export function casters(b: MapBuilder, w: number, d: number, dia = 0.08): number {
  const x = w / 2 - dia * 0.6;
  const z = d / 2 - dia * 0.6;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylX(b, sx * x, dia / 2, sz * z, dia, 0.035, 'rubber_black', undefined, 8);
  return dia;
}

/** Horizontal bar handle (front of a drawer / door) centred on (cx, cy) at depth z, protruding toward +Z. */
export function handle(b: MapBuilder, cx: number, cy: number, z: number, len: number, vertical = false): void {
  if (vertical) bx(b, cx, cy - len / 2, z + 0.015, 0.02, len, 0.03, 'metal_brushed');
  else bx(b, cx, cy - 0.01, z + 0.015, len, 0.02, 0.03, 'metal_brushed');
}

/** Small glowing status LED on a front face (z = face depth). */
export function led(b: MapBuilder, cx: number, cy: number, z: number, mat: MaterialId = 'led_green', size = 0.02): void {
  bx(b, cx, cy - size / 2, z + 0.004, size, size, 0.008, mat);
}

/**
 * Flat screen: dark bezel + lit panel on its +Z face. (cx, y0) = bottom centre, z = back of the bezel.
 */
export function screen(b: MapBuilder, cx: number, y0: number, z: number, w: number, h: number, mat: MaterialId = 'screen_on', thick = 0.03): void {
  bx(b, cx, y0, z + thick / 2, w, h, thick, 'plastic_black');
  bx(b, cx, y0 + 0.015, z + thick + 0.003, w - 0.03, h - 0.03, 0.006, mat);
}

/** One blood-collection tube standing at (cx, y0, cz): glass body + coloured cap. */
export function tube(b: MapBuilder, cx: number, y0: number, cz: number, cap: MaterialId, h = 0.1): void {
  cyl(b, cx, y0, cz, 0.016, h - 0.02, 'paper_white', 0xd9c9c4, 6);
  cyl(b, cx, y0 + h - 0.022, cz, 0.02, 0.022, cap, undefined, 6);
}

/** A cardboard box with a strip of tape, centred on (cx, cz), standing on y0. */
export function carton(b: MapBuilder, cx: number, y0: number, cz: number, w: number, h: number, d: number, tint?: number): void {
  bx(b, cx, y0, cz, w, h, d, 'cardboard', tint);
  bx(b, cx, y0 + h - 0.002, cz, Math.min(0.06, w / 4), 0.004, d + 0.004, 'paper_white', 0xe8dcc0);
}
