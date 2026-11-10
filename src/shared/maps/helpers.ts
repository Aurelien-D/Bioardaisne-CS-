/**
 * Level-design helpers built on top of MapBuilder (walls with openings, rooms, slabs,
 * stairs, platforms, railings, doors, windows, lighting, placement utilities).
 *
 * Everything here is pure data generation: helpers only call `b.box`, `b.prim`,
 * `b.collider`, `b.light` … so they work inside any `b.at(x, y, z, quarterTurns, fn)`
 * frame and every collider stays axis-aligned.
 *
 * Conventions shared by all helpers
 *  - Units are metres, Y is up. Coordinates are LOCAL to the current builder frame.
 *  - A rectangle on the ground is `{ x0, z0, x1, z1 }` (any corner order is accepted).
 *  - Sides of a rectangle are named like box faces: `nx` = the −X side, `px` = +X,
 *    `nz` = −Z, `pz` = +Z. On a plan drawn by tools/map-plan.ts, +X points right and
 *    +Z points DOWN (so `nz` is the top edge of the drawing, `px` the right edge).
 *  - A wall runs along the X axis (constant z) or along the Z axis (constant x).
 *    Its "positive" face looks toward +Z (wall along X) or +X (wall along Z).
 *  - Directions (`dir`, `facing`) use the sign convention of the builder:
 *    0 = +Z, 1 = +X, 2 = −Z, 3 = −X.
 *
 * Dimension reminders (docs/ARCHITECTURE.md §15): doors ≥ 1.2 m wide and 2.1–2.4 m high,
 * corridors ≥ 2 m, ceilings 2.8–3.2 m, walls ≥ 0.2 m thick, low cover 0.9–1.1 m.
 */
import { hash3, mulberry32, type Rng } from '../math/rng';
import type { BoxOpts, MapBuilder } from './builder';
import { MATERIALS, type MaterialId } from './materials';
import type { FaceName } from './types';

const EPS = 1e-6;
/** Boxes thinner than this (m) are never emitted (avoids slivers and degenerate boxes). */
const MIN_SIZE = 1e-4;

// =================================================================================
// Basic types
// =================================================================================

/** Axis-aligned rectangle on the ground plane. */
export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Side of a rectangle: nx = −X side, px = +X side, nz = −Z side, pz = +Z side. */
export type Side = 'nx' | 'px' | 'nz' | 'pz';
export const SIDES: readonly Side[] = ['nz', 'pz', 'nx', 'px'];

/** Direction index used across the kit: 0 = +Z, 1 = +X, 2 = −Z, 3 = −X. */
export type Dir = 0 | 1 | 2 | 3;

/** Returns the rectangle with x0 ≤ x1 and z0 ≤ z1. */
export function normRect(r: Rect): Rect {
  return {
    x0: Math.min(r.x0, r.x1),
    z0: Math.min(r.z0, r.z1),
    x1: Math.max(r.x0, r.x1),
    z1: Math.max(r.z0, r.z1),
  };
}

/** Box along a wall axis: `t` runs along the axis, `n` along the wall normal (+Z or +X). */
function axisBox(
  b: MapBuilder,
  axis: 'x' | 'z',
  ox: number,
  oz: number,
  ta: number,
  tb: number,
  ya: number,
  yb: number,
  na: number,
  nb: number,
  mat: MaterialId,
  opts?: BoxOpts,
): void {
  if (Math.abs(tb - ta) < MIN_SIZE || Math.abs(yb - ya) < MIN_SIZE || Math.abs(nb - na) < MIN_SIZE) return;
  if (axis === 'x') b.box(ox + ta, ya, oz + na, ox + tb, yb, oz + nb, mat, opts);
  else b.box(ox + na, ya, oz + ta, ox + nb, yb, oz + tb, mat, opts);
}

const DECO: BoxOpts = { solid: false, detail: true };

// =================================================================================
// Walls
// =================================================================================

export type OpeningFill = 'none' | 'glass' | 'frosted';

/** A door or window cut into a wall. */
export interface Opening {
  /** Distance (m) from the START of the wall to the CENTRE of the opening, measured along the wall. */
  at: number;
  /** Clear width (m). Doors: ≥ 1.2 (double doors 1.8–2.4). */
  width: number;
  /** Clear height (m). Default 2.1. Clamped to the top of the wall (no lintel when it reaches it). */
  height?: number;
  /** Height of the bottom of the opening above the wall base: 0 (default) for doors, e.g. 0.9 for windows. */
  sill?: number;
  /**
   * 'none' (default): free passage. 'glass' / 'frosted': a thin glass pane WITH a collider
   * (players and bullets are stopped) — windows, glazed partitions.
   */
  fill?: OpeningFill;
  /** Adds a simple frame of this material around the opening (decorative, no collider). */
  frame?: MaterialId;
}

export interface WallOpts {
  /** Start point. Opening positions (`at`) are measured from here. */
  x0: number;
  z0: number;
  /** End point. The wall must be axis-aligned: x0 = x1 or z0 = z1. */
  x1: number;
  z1: number;
  /** Base height (default 0). */
  y?: number;
  /** Wall height (default 3). */
  height?: number;
  /** Thickness, centred on the line (default 0.2). */
  thickness?: number;
  /** Material of the wall (all faces unless overridden below). */
  mat: MaterialId;
  /** Material of the face looking toward +Z (wall along X) or +X (wall along Z). */
  matPos?: MaterialId;
  /** Material of the face looking toward −Z (wall along X) or −X (wall along Z). */
  matNeg?: MaterialId;
  openings?: Opening[];
  tint?: number;
  /** Skirting board along the bottom of one or both faces (skips doorways). */
  skirting?: { mat: MaterialId; side?: 'pos' | 'neg' | 'both'; height?: number };
  /** Create colliders (default true). */
  solid?: boolean;
}

export interface OpeningInfo {
  /** Centre of the opening on the wall centre-line (local coordinates). */
  x: number;
  z: number;
  /** Absolute bottom and top of the opening. */
  y0: number;
  y1: number;
  width: number;
}

export interface WallInfo {
  axis: 'x' | 'z';
  length: number;
  /** Number of structural boxes emitted. */
  boxes: number;
  /** One entry per opening, in the order they were given. */
  openings: OpeningInfo[];
}

interface Column {
  t0: number;
  t1: number;
  /** Solid vertical intervals [from, to] relative to the wall base, sorted. */
  solids: [number, number][];
}

/**
 * Splits a wall of length `length` and height `height` into non-overlapping rectangles
 * (in wall space: t along the wall, y up from the base) around the openings.
 * Exposed for tests and for tools that need the 2D layout of a wall.
 */
export function wallLayout(length: number, height: number, openings: readonly Opening[] = []): Column[] {
  const ops = openings.map((op, i) => {
    const t0 = op.at - op.width / 2;
    const t1 = op.at + op.width / 2;
    const sill = op.sill ?? 0;
    let top = sill + (op.height ?? 2.1);
    if (!(op.width > MIN_SIZE)) throw new Error(`wall(): opening #${i} has no width`);
    if (t0 < -1e-4 || t1 > length + 1e-4) {
      throw new Error(
        `wall(): opening #${i} (at ${op.at}, width ${op.width}) does not fit in a wall of length ${length.toFixed(3)}`,
      );
    }
    if (sill < -EPS) throw new Error(`wall(): opening #${i} has a negative sill`);
    if (top > height - 1e-3) top = height;
    if (top - sill < MIN_SIZE) throw new Error(`wall(): opening #${i} has no height`);
    return { t0: Math.max(0, t0), t1: Math.min(length, t1), a: Math.max(0, sill), c: top };
  });

  const cuts = [0, length];
  for (const op of ops) cuts.push(op.t0, op.t1);
  cuts.sort((p, q) => p - q);
  const uniq: number[] = [];
  for (const c of cuts) if (!uniq.length || c - uniq[uniq.length - 1]! > MIN_SIZE) uniq.push(c);
  uniq[uniq.length - 1] = length;

  const cols: Column[] = [];
  for (let i = 0; i + 1 < uniq.length; i++) {
    const t0 = uniq[i]!;
    const t1 = uniq[i + 1]!;
    const mid = (t0 + t1) / 2;
    const free = ops
      .filter((op) => op.t0 < mid && op.t1 > mid)
      .map((op): [number, number] => [op.a, op.c])
      .sort((p, q) => p[0] - q[0]);
    const solids: [number, number][] = [];
    let y = 0;
    for (const [a, c] of free) {
      if (a - y > MIN_SIZE) solids.push([y, a]);
      y = Math.max(y, c);
    }
    if (height - y > MIN_SIZE) solids.push([y, height]);
    const prev = cols[cols.length - 1];
    if (prev && sameProfile(prev.solids, solids)) prev.t1 = t1;
    else cols.push({ t0, t1, solids });
  }
  return cols;
}

function sameProfile(a: [number, number][], b: [number, number][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]![0] - b[i]![0]) > EPS || Math.abs(a[i]![1] - b[i]![1]) > EPS) return false;
  }
  return true;
}

function covers(solids: [number, number][], a: number, c: number): boolean {
  return solids.some(([p, q]) => p <= a + EPS && q >= c - EPS);
}

/**
 * Axis-aligned wall segment with door / window openings.
 *
 * The wall is split into boxes around the openings (piers, sills, lintels) with no
 * overlap, no gap and no zero-size box, whatever the number of openings (openings may
 * even be stacked, e.g. a door with a window above it).
 *
 * @example
 * // 8 m wall along X at z = 5 with a door and a glazed window, blue on its +Z face:
 * wall(b, {
 *   x0: 0, z0: 5, x1: 8, z1: 5, height: 2.8, mat: 'plaster_white', matPos: 'plaster_blue',
 *   openings: [
 *     { at: 1.5, width: 1.2, height: 2.1, frame: 'door_wood' },                       // door
 *     { at: 5.5, width: 2.0, height: 1.2, sill: 0.9, fill: 'glass', frame: 'metal_white' }, // window
 *   ],
 * });
 *
 * @returns the position of every opening (to place door props, signs…).
 */
export function wall(b: MapBuilder, o: WallOpts): WallInfo {
  const dx = o.x1 - o.x0;
  const dz = o.z1 - o.z0;
  const alongX = Math.abs(dz) < EPS && Math.abs(dx) > MIN_SIZE;
  const alongZ = Math.abs(dx) < EPS && Math.abs(dz) > MIN_SIZE;
  if (!alongX && !alongZ) {
    throw new Error(`wall(): the wall must be axis-aligned and not empty (${o.x0}, ${o.z0}) -> (${o.x1}, ${o.z1})`);
  }
  const axis: 'x' | 'z' = alongX ? 'x' : 'z';
  const length = Math.abs(alongX ? dx : dz);
  const s = (alongX ? dx : dz) > 0 ? 1 : -1;
  const y0 = o.y ?? 0;
  const height = o.height ?? 3;
  const half = (o.thickness ?? 0.2) / 2;
  if (!(height > MIN_SIZE) || !(half > MIN_SIZE / 2)) throw new Error('wall(): height and thickness must be positive');
  const openings = o.openings ?? [];

  // Face names in the wall frame.
  const posFace: FaceName = alongX ? 'pz' : 'px';
  const negFace: FaceName = alongX ? 'nz' : 'nx';
  const lowFace: FaceName = alongX ? (s > 0 ? 'nx' : 'px') : s > 0 ? 'nz' : 'pz';
  const highFace: FaceName = alongX ? (s > 0 ? 'px' : 'nx') : s > 0 ? 'pz' : 'nz';

  const cols = wallLayout(length, height, openings);
  let boxes = 0;
  for (let k = 0; k < cols.length; k++) {
    const col = cols[k]!;
    for (const [a, c] of col.solids) {
      const faces: Partial<Record<FaceName, MaterialId | null>> = {};
      if (o.matPos) faces[posFace] = o.matPos;
      if (o.matNeg) faces[negFace] = o.matNeg;
      // Hide end faces that are completely covered by the neighbouring column.
      if (k > 0 && covers(cols[k - 1]!.solids, a, c)) faces[lowFace] = null;
      if (k + 1 < cols.length && covers(cols[k + 1]!.solids, a, c)) faces[highFace] = null;
      const opts: BoxOpts = {};
      if (Object.keys(faces).length) opts.faces = faces;
      if (o.tint !== undefined) opts.tint = o.tint;
      if (o.solid === false) opts.solid = false;
      axisBox(b, axis, o.x0, o.z0, s * col.t0, s * col.t1, y0 + a, y0 + c, -half, half, o.mat, opts);
      boxes++;
    }
  }

  // Fills and frames.
  const infos: OpeningInfo[] = [];
  for (const op of openings) {
    const sill = Math.max(0, op.sill ?? 0);
    let top = sill + (op.height ?? 2.1);
    if (top > height - 1e-3) top = height;
    const cx = alongX ? o.x0 + s * op.at : o.x0;
    const cz = alongX ? o.z0 : o.z0 + s * op.at;
    infos.push({ x: cx, z: cz, y0: y0 + sill, y1: y0 + top, width: op.width });
    const fill = op.fill ?? 'none';
    if (fill !== 'none' || op.frame) {
      const unit: OpeningUnitOpts = {
        x: cx,
        z: cz,
        y: y0 + sill,
        axis,
        width: op.width,
        height: top - sill,
        wallThickness: half * 2,
        fill,
        bottomBar: sill > 0.01,
      };
      if (op.frame) unit.frame = op.frame;
      openingUnit(b, unit);
    }
  }

  // Skirting boards: continuous runs wherever the wall reaches the floor.
  if (o.skirting) {
    const sk = o.skirting;
    const h = sk.height ?? 0.1;
    const runs: [number, number][] = [];
    for (const col of cols) {
      const first = col.solids[0];
      if (!first || first[0] > EPS || first[1] < h - EPS) continue;
      const last = runs[runs.length - 1];
      if (last && Math.abs(last[1] - col.t0) < EPS) last[1] = col.t1;
      else runs.push([col.t0, col.t1]);
    }
    const side = sk.side ?? 'both';
    for (const [t0, t1] of runs) {
      if (side !== 'neg') axisBox(b, axis, o.x0, o.z0, s * t0, s * t1, y0, y0 + h, half, half + 0.015, sk.mat, DECO);
      if (side !== 'pos') axisBox(b, axis, o.x0, o.z0, s * t0, s * t1, y0, y0 + h, -half - 0.015, -half, sk.mat, DECO);
    }
  }

  return { axis, length, boxes, openings: infos };
}

// =================================================================================
// Frames, glazing, doors
// =================================================================================

export interface OpeningUnitOpts {
  /** Centre of the opening on the wall centre-line. */
  x: number;
  z: number;
  /** Bottom of the opening (floor level for a door, sill height for a window). Default 0. */
  y?: number;
  /** Direction of the wall that contains the opening: 'x' (wall along X) or 'z'. */
  axis: 'x' | 'z';
  /** Clear width and height of the opening. */
  width: number;
  height: number;
  /** Thickness of the wall (default 0.2). */
  wallThickness?: number;
  /** Frame material; omit for no frame. */
  frame?: MaterialId;
  /** Glazing; 'none' (default) leaves the opening free. */
  fill?: OpeningFill;
  /** Add the bottom bar of the frame (windows). Default: true when y > 0. */
  bottomBar?: boolean;
  /** Section of the frame bars (default 0.05). */
  bar?: number;
}

/**
 * Frame and/or glazing for an existing wall opening (the wall helper calls this for
 * `frame` / `fill`; use it directly for openings you cut by hand).
 * The frame is decorative; the glass pane (if any) has a collider.
 */
export function openingUnit(b: MapBuilder, o: OpeningUnitOpts): void {
  const y = o.y ?? 0;
  const half = (o.wallThickness ?? 0.2) / 2;
  const w2 = o.width / 2;
  const bar = Math.min(o.bar ?? 0.05, o.width / 4, o.height / 4);
  const fill = o.fill ?? 'none';
  const bottom = o.bottomBar ?? y > 0.01;
  const inset = o.frame ? bar : 0;

  if (o.frame) {
    const p = half + 0.02; // frame is slightly proud of both wall faces
    axisBox(b, o.axis, o.x, o.z, -w2, -w2 + bar, y, y + o.height, -p, p, o.frame, DECO);
    axisBox(b, o.axis, o.x, o.z, w2 - bar, w2, y, y + o.height, -p, p, o.frame, DECO);
    axisBox(b, o.axis, o.x, o.z, -w2 + bar, w2 - bar, y + o.height - bar, y + o.height, -p, p, o.frame, DECO);
    if (bottom) {
      // window board: a little deeper than the frame
      axisBox(b, o.axis, o.x, o.z, -w2 + bar, w2 - bar, y, y + bar * 0.8, -p - 0.03, p + 0.03, o.frame, DECO);
    }
  }
  if (fill !== 'none') {
    const mat: MaterialId = fill === 'frosted' ? 'glass_frosted' : 'glass';
    const g = Math.min(0.02, half * 0.6);
    const yb = y + (o.frame && bottom ? bar * 0.8 : 0);
    const yt = y + o.height - inset;
    axisBox(b, o.axis, o.x, o.z, -w2 + inset, w2 - inset, yb, yt, -g, g, mat, { detail: true, surf: 'glass' });
    if (o.frame) {
      // Mullions: keep panes narrower than ~1.5 m.
      const panes = Math.max(1, Math.ceil((o.width - 2 * bar) / 1.5 - 1e-6));
      for (let i = 1; i < panes; i++) {
        const t = -w2 + (o.width * i) / panes;
        axisBox(b, o.axis, o.x, o.z, t - bar / 2, t + bar / 2, yb, yt, -g - 0.015, g + 0.015, o.frame, DECO);
      }
      // Transom on tall glazed openings (full-height partitions).
      if (o.height > 2.3 && y < 0.01) {
        axisBox(b, o.axis, o.x, o.z, -w2 + bar, w2 - bar, y + 2.1, y + 2.1 + bar, -g - 0.015, g + 0.015, o.frame, DECO);
      }
    }
  }
}

/**
 * Door frame (two jambs and a head) around a doorway. Decorative, no collider.
 *
 * @example
 * doorFrame(b, { x: 4, z: 5, axis: 'x', width: 1.2, height: 2.1, mat: 'door_wood' });
 */
export function doorFrame(
  b: MapBuilder,
  o: { x: number; z: number; y?: number; axis: 'x' | 'z'; width: number; height?: number; wallThickness?: number; mat: MaterialId },
): void {
  const unit: OpeningUnitOpts = {
    x: o.x,
    z: o.z,
    y: o.y ?? 0,
    axis: o.axis,
    width: o.width,
    height: o.height ?? 2.1,
    frame: o.mat,
    bottomBar: false,
  };
  if (o.wallThickness !== undefined) unit.wallThickness = o.wallThickness;
  openingUnit(b, unit);
}

/**
 * Window: frame + glass pane (with a collider) in an existing opening.
 *
 * @example
 * // 1.6 × 1.2 m window whose sill is 0.9 m above the floor, in a wall along Z at x = 10:
 * windowUnit(b, { x: 10, z: 3, y: 0.9, axis: 'z', width: 1.6, height: 1.2 });
 */
export function windowUnit(
  b: MapBuilder,
  o: {
    x: number;
    z: number;
    /** Sill height (bottom of the opening). */
    y: number;
    axis: 'x' | 'z';
    width: number;
    height: number;
    wallThickness?: number;
    /** Frame material (default 'metal_white'). */
    frame?: MaterialId;
    /** Default 'glass'. */
    fill?: 'glass' | 'frosted';
  },
): void {
  const unit: OpeningUnitOpts = {
    x: o.x,
    z: o.z,
    y: o.y,
    axis: o.axis,
    width: o.width,
    height: o.height,
    frame: o.frame ?? 'metal_white',
    fill: o.fill ?? 'glass',
    bottomBar: true,
  };
  if (o.wallThickness !== undefined) unit.wallThickness = o.wallThickness;
  openingUnit(b, unit);
}

export interface DoorLeafOpts {
  /** Centre of the doorway on the wall centre-line. */
  x: number;
  z: number;
  /** Floor level (default 0). */
  y?: number;
  /** Direction of the wall that contains the doorway. */
  axis: 'x' | 'z';
  /** Width of the leaf (= clear width of the doorway for a single door). */
  width: number;
  /** Leaf height (default 2.05). */
  height?: number;
  wallThickness?: number;
  /** Jamb carrying the hinges: 'low' = the jamb with the smaller coordinate along the wall, 'high' = the other one. */
  hinge?: 'low' | 'high';
  /** Side of the wall the leaf opens toward: 'pos' = +Z (wall along X) or +X (wall along Z). */
  swing?: 'pos' | 'neg';
  /**
   * Opening angle in degrees (default 90).
   *  - 90: leaf perpendicular to the wall, with a thin collider (it really is in the way);
   *  - 180: folded flat against the wall, no collider;
   *  - 0: closed, with a collider (a decorative locked door);
   *  - anything else: decorative rotated leaf "left ajar", no collider — keep it for doors nobody walks through.
   */
  open?: number;
  /** Leaf material (default 'door_white'). */
  mat?: MaterialId;
  tint?: number;
  /** Glazed upper panel (porte vitrée). */
  glazed?: boolean;
}

/**
 * Door leaf hinged on a jamb of a doorway.
 *
 * @example
 * // Leaf of the door at (4, 5) in a wall along X, hinged on the low-x jamb, open at 90° toward +Z:
 * doorLeaf(b, { x: 4, z: 5, axis: 'x', width: 1.2, hinge: 'low', swing: 'pos', mat: 'door_wood' });
 */
export function doorLeaf(b: MapBuilder, o: DoorLeafOpts): void {
  const y = o.y ?? 0;
  const h = o.height ?? 2.05;
  const half = (o.wallThickness ?? 0.2) / 2;
  const mat = o.mat ?? 'door_white';
  const hs = (o.hinge ?? 'low') === 'low' ? -1 : 1; // hinge side along the wall
  const ns = (o.swing ?? 'pos') === 'pos' ? 1 : -1; // swing side along the normal
  const open = o.open ?? 90;
  const lt = 0.045; // leaf thickness
  const w = o.width;
  const ht = hs * (w / 2); // hinge position along the wall
  const hn = ns * half; // hinge position along the normal (wall face)
  const lo = (p: number, q: number): [number, number] => (p < q ? [p, q] : [q, p]);
  const leafOpts: BoxOpts = { detail: false, solid: false };
  if (o.tint !== undefined) leafOpts.tint = o.tint;
  const surf = MATERIALS[mat].surf;
  const handle = (t0: number, t1: number, n0: number, n1: number): void => {
    const [ta, tb] = lo(t0, t1);
    const [na, nb] = lo(n0, n1);
    axisBox(b, o.axis, o.x, o.z, ta, tb, y + 1.0, y + 1.05, na, nb, 'metal_brushed', DECO);
  };

  if (Math.abs(open - 90) < 0.5) {
    // Perpendicular to the wall, standing just outside the clear width.
    const [ta, tb] = lo(ht, ht + hs * lt);
    const [na, nb] = lo(hn, hn + ns * w);
    leafPanel(b, o, ta, tb, na, nb, y, h, mat, leafOpts, 'n');
    if (o.axis === 'x') b.collider(o.x + ta, y, o.z + na, o.x + tb, y + h, o.z + nb, surf);
    else b.collider(o.x + na, y, o.z + ta, o.x + nb, y + h, o.z + tb, surf);
    // Handle through the leaf, near its free edge.
    handle(ta - 0.045, tb + 0.045, hn + ns * (w - 0.2), hn + ns * (w - 0.08));
  } else if (Math.abs(open - 180) < 0.5) {
    // Folded back against the wall face, beside the doorway.
    const [ta, tb] = lo(ht, ht + hs * w);
    const [na, nb] = lo(hn + ns * 0.005, hn + ns * (0.005 + lt));
    leafPanel(b, o, ta, tb, na, nb, y, h, mat, leafOpts, 't');
    handle(ht + hs * (w - 0.2), ht + hs * (w - 0.08), hn + ns * (0.005 + lt), hn + ns * (0.05 + lt));
  } else if (Math.abs(open) < 0.5) {
    // Closed: fills the doorway.
    const [ta, tb] = lo(-w / 2, w / 2);
    leafPanel(b, o, ta, tb, -lt / 2, lt / 2, y, h, mat, leafOpts, 't');
    if (o.axis === 'x') b.collider(o.x + ta, y, o.z - half, o.x + tb, y + h, o.z + half, surf);
    else b.collider(o.x - half, y, o.z + ta, o.x + half, y + h, o.z + tb, surf);
    handle(-hs * (w / 2 - 0.2), -hs * (w / 2 - 0.08), -lt / 2 - 0.045, lt / 2 + 0.045);
  } else {
    // Ajar: decorative rotated leaf (no collider).
    const ang = (open * Math.PI) / 180;
    // Direction of the leaf from the hinge: starts along the wall toward the other jamb, rotates toward the swing side.
    const dt = -hs * Math.cos(ang);
    const dn = ns * Math.sin(ang);
    const ct = ht + (dt * w) / 2;
    const cn = hn + (dn * w) / 2;
    const px = o.axis === 'x' ? o.x + ct : o.x + cn;
    const pz = o.axis === 'x' ? o.z + cn : o.z + ct;
    const vx = o.axis === 'x' ? dt : dn;
    const vz = o.axis === 'x' ? dn : dt;
    // A box prim whose local X axis (length w) points along (vx, vz): rotation about Y.
    const popts: { rot: { x: number; y: number; z: number }; tint?: number } = { rot: { x: 0, y: Math.atan2(-vz, vx), z: 0 } };
    if (o.tint !== undefined) popts.tint = o.tint;
    b.prim('box', px, y + h / 2, pz, w, h, lt, mat, popts);
  }
}

/** Leaf body: plain, or a frame with a glass panel when `glazed`. `thin` = which local axis is the leaf thickness. */
function leafPanel(
  b: MapBuilder,
  o: DoorLeafOpts,
  ta: number,
  tb: number,
  na: number,
  nb: number,
  y: number,
  h: number,
  mat: MaterialId,
  opts: BoxOpts,
  thin: 't' | 'n',
): void {
  if (!o.glazed) {
    axisBox(b, o.axis, o.x, o.z, ta, tb, y + 0.01, y + h, na, nb, mat, opts);
    return;
  }
  const st = 0.1; // stile width
  const d: BoxOpts = { ...opts, detail: true };
  const glassOpts: BoxOpts = { solid: false, detail: true };
  if (thin === 't') {
    // leaf length runs along t
    axisBox(b, o.axis, o.x, o.z, ta, ta + st, y + 0.01, y + h, na, nb, mat, d);
    axisBox(b, o.axis, o.x, o.z, tb - st, tb, y + 0.01, y + h, na, nb, mat, d);
    axisBox(b, o.axis, o.x, o.z, ta + st, tb - st, y + 0.01, y + 0.9, na, nb, mat, d);
    axisBox(b, o.axis, o.x, o.z, ta + st, tb - st, y + h - st, y + h, na, nb, mat, d);
    const m = (na + nb) / 2;
    axisBox(b, o.axis, o.x, o.z, ta + st, tb - st, y + 0.9, y + h - st, m - 0.008, m + 0.008, 'glass', glassOpts);
  } else {
    axisBox(b, o.axis, o.x, o.z, ta, tb, y + 0.01, y + h, na, na + st, mat, d);
    axisBox(b, o.axis, o.x, o.z, ta, tb, y + 0.01, y + h, nb - st, nb, mat, d);
    axisBox(b, o.axis, o.x, o.z, ta, tb, y + 0.01, y + 0.9, na + st, nb - st, mat, d);
    axisBox(b, o.axis, o.x, o.z, ta, tb, y + h - st, y + h, na + st, nb - st, mat, d);
    const m = (ta + tb) / 2;
    axisBox(b, o.axis, o.x, o.z, m - 0.008, m + 0.008, y + 0.9, y + h - st, na + st, nb - st, 'glass', glassOpts);
  }
}

// =================================================================================
// Slabs: floors and ceilings (with holes)
// =================================================================================

/**
 * Tiles `rect` minus `holes` with non-overlapping rectangles (holes may overlap each
 * other or stick out of the rectangle). Used for stairwells and skylights.
 */
export function rectMinusHoles(rect: Rect, holes: readonly Rect[] = []): Rect[] {
  const r = normRect(rect);
  const hs = holes
    .map(normRect)
    .map((h) => ({ x0: Math.max(h.x0, r.x0), z0: Math.max(h.z0, r.z0), x1: Math.min(h.x1, r.x1), z1: Math.min(h.z1, r.z1) }))
    .filter((h) => h.x1 - h.x0 > MIN_SIZE && h.z1 - h.z0 > MIN_SIZE);
  if (!hs.length) return r.x1 - r.x0 > MIN_SIZE && r.z1 - r.z0 > MIN_SIZE ? [r] : [];
  const cut = (vals: number[]): number[] => {
    vals.sort((p, q) => p - q);
    const out: number[] = [];
    for (const v of vals) if (!out.length || v - out[out.length - 1]! > MIN_SIZE) out.push(v);
    return out;
  };
  const xs = cut([r.x0, r.x1, ...hs.flatMap((h) => [h.x0, h.x1])]);
  const zs = cut([r.z0, r.z1, ...hs.flatMap((h) => [h.z0, h.z1])]);
  const out: Rect[] = [];
  // Row by row (along Z); merge free cells along X, then merge identical spans of consecutive rows.
  let open: Rect[] = [];
  for (let j = 0; j + 1 < zs.length; j++) {
    const z0 = zs[j]!;
    const z1 = zs[j + 1]!;
    const zm = (z0 + z1) / 2;
    const spans: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      const xm = (x0 + x1) / 2;
      if (hs.some((h) => xm > h.x0 && xm < h.x1 && zm > h.z0 && zm < h.z1)) continue;
      const last = spans[spans.length - 1];
      if (last && Math.abs(last[1] - x0) < EPS) last[1] = x1;
      else spans.push([x0, x1]);
    }
    const next: Rect[] = [];
    for (const [x0, x1] of spans) {
      const prev = open.find((p) => Math.abs(p.x0 - x0) < EPS && Math.abs(p.x1 - x1) < EPS && Math.abs(p.z1 - z0) < EPS);
      if (prev) {
        prev.z1 = z1;
        next.push(prev);
      } else {
        const nr = { x0, z0, x1, z1 };
        out.push(nr);
        next.push(nr);
      }
    }
    open = next;
  }
  return out;
}

export interface SlabOpts extends Rect {
  /** floor(): height of the walking surface (default 0). ceiling(): height of the underside. */
  y?: number;
  /** Default 0.2. */
  thickness?: number;
  mat: MaterialId;
  /** Rectangular holes (stairwells, skylights). */
  holes?: Rect[];
  /** Material of the opposite face (underside of a floor / top of a ceiling). */
  otherMat?: MaterialId;
  tint?: number;
  solid?: boolean;
}

function slab(b: MapBuilder, o: SlabOpts, ya: number, yb: number, otherFace: FaceName): number {
  const opts: BoxOpts = {};
  if (o.otherMat) opts.faces = { [otherFace]: o.otherMat };
  if (o.tint !== undefined) opts.tint = o.tint;
  if (o.solid === false) opts.solid = false;
  const parts = rectMinusHoles(o, o.holes);
  for (const p of parts) b.box(p.x0, ya, p.z0, p.x1, yb, p.z1, o.mat, opts);
  return parts.length;
}

/**
 * Floor slab whose TOP surface is at `y` (default 0).
 *
 * @example
 * floor(b, { x0: 0, z0: 0, x1: 12, z1: 8, mat: 'lino_grey' });
 * // upper floor with a stairwell, ceiling tiles underneath:
 * floor(b, { x0: 0, z0: 0, x1: 12, z1: 8, y: 3.2, mat: 'carpet_blue', otherMat: 'ceiling_tile',
 *            holes: [{ x0: 9, z0: 1, x1: 11, z1: 5 }] });
 */
export function floor(b: MapBuilder, o: SlabOpts): number {
  const y = o.y ?? 0;
  return slab(b, o, y - (o.thickness ?? 0.2), y, 'ny');
}

/**
 * Ceiling slab whose UNDERSIDE is at `y`.
 *
 * @example
 * ceiling(b, { x0: 0, z0: 0, x1: 12, z1: 8, y: 2.8, mat: 'ceiling_tile' });
 */
export function ceiling(b: MapBuilder, o: SlabOpts & { y: number }): number {
  return slab(b, o, o.y, o.y + (o.thickness ?? 0.2), 'py');
}

// =================================================================================
// Rooms
// =================================================================================

export interface RoomWallOpts {
  /** Openings; `at` is measured from the room's x0 (walls nz / pz) or z0 (walls nx / px) corner line. */
  openings?: Opening[];
  /** Material of the inner face of this wall (default: the room's wallMat). */
  mat?: MaterialId;
  /** Material of the outer face of this wall (default: the room's outerMat). */
  outer?: MaterialId;
}

export interface RoomOpts extends Rect {
  /** Floor level (default 0). */
  y?: number;
  /** Clear height between floor and ceiling (default 2.8). */
  height?: number;
  /** Wall thickness (default 0.2). The rectangle x0..x1 / z0..z1 is given on the wall CENTRE-LINES. */
  thickness?: number;
  /** Wall material (inner faces, reveals). */
  wallMat: MaterialId;
  /** Material of the outer faces (default: wallMat). */
  outerMat?: MaterialId;
  /** Floor material; omit (or `null`) for no floor slab, e.g. when a shared building floor already exists. */
  floorMat?: MaterialId | null;
  /** Ceiling material; omit (or `null`) for no ceiling slab. */
  ceilingMat?: MaterialId | null;
  floorThickness?: number;
  ceilingThickness?: number;
  /** Material of the top of the ceiling slab (roof, or the floor of the storey above). */
  roofMat?: MaterialId;
  /**
   * Per-side options. `false` omits the wall: use it for the side shared with a neighbouring
   * room that already built it (walls are never doubled), or for an open side.
   */
  walls?: Partial<Record<Side, RoomWallOpts | false>>;
  /** Skirting board material along the inner faces; omit for none. */
  skirting?: MaterialId;
  floorHoles?: Rect[];
  ceilingHoles?: Rect[];
}

export interface RoomInfo {
  /** Clear interior rectangle (inner faces of the walls). */
  inner: Rect;
  /** Centre of the room. */
  cx: number;
  cz: number;
  /** Clear interior width (X) and depth (Z). */
  width: number;
  depth: number;
  floorY: number;
  /** Underside of the ceiling. */
  ceilingY: number;
  /** Centre of every opening, per side (local coordinates). */
  openings: Record<Side, OpeningInfo[]>;
}

/**
 * Rectangular room: floor, ceiling and up to four walls with openings.
 *
 * The rectangle is given on the wall centre-lines, so two neighbouring rooms share a
 * line; build the shared wall in ONE of them and pass `false` for that side in the other.
 * Walls along X (`nz`, `pz`) own the corner squares; walls along Z (`nx`, `px`) run between them.
 * Floor and ceiling slabs stop on the centre-lines, so neighbouring slabs never overlap.
 *
 * @example
 * // Office 5 × 4 m with a door on its +Z wall and a window on its −X wall…
 * const office = room(b, {
 *   x0: 0, z0: 0, x1: 5, z1: 4, wallMat: 'plaster_white', floorMat: 'carpet_blue', ceilingMat: 'ceiling_tile',
 *   skirting: 'wood_light',
 *   walls: {
 *     pz: { openings: [{ at: 1.2, width: 1.2, frame: 'door_wood' }] },
 *     nx: { openings: [{ at: 2, width: 1.6, height: 1.2, sill: 0.9, fill: 'glass', frame: 'metal_white' }] },
 *   },
 * });
 * // …and its neighbour on the +X side, which reuses the wall at x = 5:
 * room(b, { x0: 5, z0: 0, x1: 9, z1: 4, wallMat: 'plaster_white', floorMat: 'lino_grey', ceilingMat: 'ceiling_tile',
 *           walls: { nx: false, pz: { openings: [{ at: 2, width: 1.2 }] } } });
 * ceilingLights(b, office.inner, 2.5, office.ceilingY);
 */
export function room(b: MapBuilder, o: RoomOpts): RoomInfo {
  const r = normRect(o);
  const y = o.y ?? 0;
  const h = o.height ?? 2.8;
  const t = o.thickness ?? 0.2;
  const half = t / 2;
  if (r.x1 - r.x0 < t * 2 || r.z1 - r.z0 < t * 2) throw new Error('room(): the room is smaller than its walls');
  const walls = o.walls ?? {};
  const has = (s: Side): boolean => walls[s] !== false;
  const info: RoomInfo = {
    inner: { x0: r.x0 + half, z0: r.z0 + half, x1: r.x1 - half, z1: r.z1 - half },
    cx: (r.x0 + r.x1) / 2,
    cz: (r.z0 + r.z1) / 2,
    width: r.x1 - r.x0 - t,
    depth: r.z1 - r.z0 - t,
    floorY: y,
    ceilingY: y + h,
    openings: { nx: [], px: [], nz: [], pz: [] },
  };

  if (o.floorMat) {
    const f: SlabOpts = { ...r, y, mat: o.floorMat };
    if (o.floorThickness !== undefined) f.thickness = o.floorThickness;
    if (o.floorHoles) f.holes = o.floorHoles;
    floor(b, f);
  }
  if (o.ceilingMat) {
    const c: SlabOpts & { y: number } = { ...r, y: y + h, mat: o.ceilingMat };
    if (o.ceilingThickness !== undefined) c.thickness = o.ceilingThickness;
    if (o.ceilingHoles) c.holes = o.ceilingHoles;
    if (o.roofMat) c.otherMat = o.roofMat;
    ceiling(b, c);
  }

  for (const side of SIDES) {
    const w = walls[side];
    if (w === false) continue;
    const inner = w?.mat ?? o.wallMat;
    const outer = w?.outer ?? o.outerMat ?? o.wallMat;
    const alongX = side === 'nz' || side === 'pz';
    // Inner face looks toward the room centre.
    const innerIsPos = side === 'nz' || side === 'nx';
    let start: number;
    let end: number;
    if (alongX) {
      start = has('nx') ? r.x0 - half : r.x0 + half;
      end = has('px') ? r.x1 + half : r.x1 - half;
    } else {
      start = r.z0 + half;
      end = r.z1 - half;
    }
    const origin = alongX ? r.x0 : r.z0;
    const wo: WallOpts = {
      x0: alongX ? start : side === 'nx' ? r.x0 : r.x1,
      z0: alongX ? (side === 'nz' ? r.z0 : r.z1) : start,
      x1: alongX ? end : side === 'nx' ? r.x0 : r.x1,
      z1: alongX ? (side === 'nz' ? r.z0 : r.z1) : end,
      y,
      height: h,
      thickness: t,
      mat: o.wallMat,
      openings: (w?.openings ?? []).map((op) => ({ ...op, at: op.at - (start - origin) })),
    };
    if (inner !== o.wallMat) {
      if (innerIsPos) wo.matPos = inner;
      else wo.matNeg = inner;
    }
    if (outer !== o.wallMat) {
      if (innerIsPos) wo.matNeg = outer;
      else wo.matPos = outer;
    }
    if (o.skirting) wo.skirting = { mat: o.skirting, side: innerIsPos ? 'pos' : 'neg' };
    info.openings[side] = wall(b, wo).openings;
  }
  return info;
}

// =================================================================================
// Stairs, platforms, pillars, railings
// =================================================================================

export interface StairsOpts {
  /** Centre of the bottom edge of the first step, at the lower floor level. */
  x: number;
  y?: number;
  z: number;
  /** Direction of ascent: 0 = +Z, 1 = +X, 2 = −Z, 3 = −X. */
  dir: Dir;
  /** Clear width (≥ 1.2 recommended). */
  width: number;
  /** Total height to climb. */
  rise: number;
  /** Depth of one step (default 0.3, minimum 0.3). */
  stepDepth?: number;
  mat: MaterialId;
  /** Material of the treads (top faces); default: `mat`. */
  treadMat?: MaterialId;
  /** `false` (default): solid underneath. `true`: open flight — thin treads on two stringers, you can walk under it. */
  open?: boolean;
  /**
   * Protection on each side, seen while CLIMBING: 'rail' = handrail (players blocked, bullets pass),
   * 'wall' = stepped solid parapet, 'none' (default). They are added outside the clear width.
   */
  left?: 'none' | 'rail' | 'wall';
  right?: 'none' | 'rail' | 'wall';
  /** Material of rails and posts (default 'metal_dark'). */
  railMat?: MaterialId;
}

export interface StairsInfo {
  steps: number;
  /** Height of each step (0.2–0.25 m whenever the rise allows it). */
  stepHeight: number;
  stepDepth: number;
  /** Horizontal length of the flight. */
  run: number;
  /** Centre of the top edge (where the upper floor must start), in the caller's frame. */
  top: { x: number; y: number; z: number };
}

/** Number and size of the steps for a given rise (steps of 0.2–0.25 m whenever possible). */
export function stairSteps(rise: number, stepDepth = 0.3): { steps: number; stepHeight: number; stepDepth: number; run: number } {
  if (!(rise > MIN_SIZE)) throw new Error('stairs(): rise must be positive');
  let steps = Math.max(1, Math.ceil(rise / 0.25 - 1e-9));
  // Very small rises cannot honour both bounds: prefer fewer, taller steps (still ≤ the 0.5 m step-up).
  if (rise / steps < 0.2 - 1e-9) steps = Math.max(1, Math.floor(rise / 0.2 + 1e-9));
  const depth = Math.max(0.3, stepDepth);
  return { steps, stepHeight: rise / steps, stepDepth: depth, run: steps * depth };
}

const DIR_VEC: readonly [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

/**
 * Straight flight of stairs (steps only: there are no ramps in this game).
 * The number of steps is derived from the rise so that every step is 0.2–0.25 m high
 * and at least 0.3 m deep, which the player walks up without jumping.
 *
 * @example
 * // Climb 3.2 m toward +X, starting at (10, 0, 4), 1.6 m wide, railing on both sides:
 * const st = stairs(b, { x: 10, z: 4, dir: 1, width: 1.6, rise: 3.2, mat: 'concrete', left: 'rail', right: 'rail' });
 * // st.top = centre of the top edge → start the landing / mezzanine there.
 */
export function stairs(b: MapBuilder, o: StairsOpts): StairsInfo {
  const { steps, stepHeight: sh, stepDepth: sd, run } = stairSteps(o.rise, o.stepDepth);
  const y = o.y ?? 0;
  const w2 = o.width / 2;
  const railMat = o.railMat ?? 'metal_dark';
  const slope = Math.atan2(o.rise, run);
  const slopeLen = Math.hypot(o.rise, run);

  b.at(o.x, y, o.z, o.dir, () => {
    // Local frame: ascent toward +Z, width along X. Climber's left = +X, right = −X.
    for (let i = 0; i < steps; i++) {
      const top = (i + 1) * sh;
      const faces: Partial<Record<FaceName, MaterialId | null>> = {};
      if (o.treadMat) faces.py = o.treadMat;
      if (o.open) {
        b.box(-w2, top - 0.06, i * sd, w2, top, (i + 1) * sd + (i + 1 < steps ? 0.02 : 0), o.mat, { faces });
      } else {
        if (i + 1 < steps) faces.pz = null; // hidden by the next (taller) step
        b.box(-w2, 0, i * sd, w2, top, (i + 1) * sd, o.mat, { faces });
      }
    }
    if (o.open) {
      // Two decorative stringers under the treads.
      for (const sx of [-w2 + 0.04, w2 - 0.04]) {
        b.prim('box', sx, o.rise / 2 - 0.13, run / 2, 0.06, 0.22, slopeLen, railMat, { rot: { x: -slope, y: 0, z: 0 } });
      }
    }
    const sideOf = (kind: 'none' | 'rail' | 'wall' | undefined, sign: number): void => {
      if (!kind || kind === 'none') return;
      if (kind === 'wall') {
        const xa = sign > 0 ? w2 : -w2 - 0.12;
        for (let i = 0; i < steps; i++) {
          b.box(xa, o.open ? i * sh : 0, i * sd, xa + 0.12, (i + 1) * sh + 0.95, (i + 1) * sd, o.mat);
        }
        return;
      }
      const xr = sign * (w2 + 0.03);
      // Posts every few steps + at both ends.
      const every = Math.max(1, Math.round(1.2 / sd));
      for (let i = 0; i < steps; i += every) {
        b.box(xr - 0.02, (i + 1) * sh, (i + 0.5) * sd - 0.02, xr + 0.02, (i + 1) * sh + 0.95, (i + 0.5) * sd + 0.02, railMat, DECO);
      }
      if ((steps - 1) % every !== 0) {
        const i = steps - 1;
        b.box(xr - 0.02, (i + 1) * sh, (i + 0.5) * sd - 0.02, xr + 0.02, (i + 1) * sh + 0.95, (i + 0.5) * sd + 0.02, railMat, DECO);
      }
      // Sloped handrail and mid rail (decorative).
      const midZ = run / 2;
      const midY = o.rise / 2 + sh / 2;
      b.prim('box', xr, midY + 0.95, midZ, 0.05, 0.05, slopeLen, railMat, { rot: { x: -slope, y: 0, z: 0 } });
      b.prim('box', xr, midY + 0.5, midZ, 0.03, 0.03, slopeLen, railMat, { rot: { x: -slope, y: 0, z: 0 } });
      // Stepped colliders: players are stopped, bullets pass.
      for (let i = 0; i < steps; i++) {
        b.collider(xr - 0.03, i * sh, i * sd, xr + 0.03, (i + 1) * sh + 1.0, (i + 1) * sd, 'metal', { noBullets: true });
      }
    };
    sideOf(o.left, 1);
    sideOf(o.right, -1);
  });

  const [vx, vz] = DIR_VEC[o.dir]!;
  return { steps, stepHeight: sh, stepDepth: sd, run, top: { x: o.x + vx * run, y: y + o.rise, z: o.z + vz * run } };
}

export interface RailingOpts extends Rect {
  /** Base height (floor the railing stands on). Default 0. */
  y?: number;
  /** Default 1.0. */
  height?: number;
  /** Default 'metal_dark'. */
  mat?: MaterialId;
  /**
   * 'bars' (default): posts + rails; the collider stops players but lets bullets through.
   * 'glass': glass infill; stops bullets too.
   */
  style?: 'bars' | 'glass';
  /** Maximum distance between posts (default 1.5). */
  postSpacing?: number;
}

/**
 * Guard railing between two points (axis-aligned).
 *
 * @example
 * railing(b, { x0: 0, z0: 6, x1: 8, z1: 6, y: 3.2 });               // edge of a mezzanine
 * railing(b, { x0: 8, z0: 0, x1: 8, z1: 6, y: 3.2, style: 'glass' }); // glazed balustrade
 */
export function railing(b: MapBuilder, o: RailingOpts): void {
  const dx = o.x1 - o.x0;
  const dz = o.z1 - o.z0;
  const alongX = Math.abs(dz) < EPS && Math.abs(dx) > MIN_SIZE;
  const alongZ = Math.abs(dx) < EPS && Math.abs(dz) > MIN_SIZE;
  if (!alongX && !alongZ) throw new Error('railing(): must be axis-aligned and not empty');
  const axis: 'x' | 'z' = alongX ? 'x' : 'z';
  const len = Math.abs(alongX ? dx : dz);
  const s = (alongX ? dx : dz) > 0 ? 1 : -1;
  const y = o.y ?? 0;
  const h = o.height ?? 1.0;
  const mat = o.mat ?? 'metal_dark';
  const style = o.style ?? 'bars';
  const n = Math.max(1, Math.ceil(len / (o.postSpacing ?? 1.5) - 1e-6));
  const put = (ta: number, tb: number, ya: number, yb: number, hn: number, m: MaterialId): void =>
    axisBox(b, axis, o.x0, o.z0, s * ta, s * tb, y + ya, y + yb, -hn, hn, m, DECO);

  for (let i = 0; i <= n; i++) {
    const t = Math.min(len - 0.02, Math.max(0.02, (len * i) / n));
    put(t - 0.02, t + 0.02, 0, h, 0.02, mat);
  }
  put(0, len, h - 0.05, h, 0.03, mat); // handrail
  if (style === 'bars') {
    put(0, len, h * 0.5 - 0.015, h * 0.5 + 0.015, 0.012, mat);
    put(0, len, 0.02, 0.12, 0.008, mat); // kick plate
  } else {
    put(0.03, len - 0.03, 0.08, h - 0.07, 0.008, 'glass');
  }
  const [ta, tb] = s > 0 ? [0, len] : [-len, 0];
  const surf = style === 'glass' ? 'glass' : 'metal';
  const copts = style === 'glass' ? {} : { noBullets: true };
  if (axis === 'x') b.collider(o.x0 + ta, y, o.z0 - 0.03, o.x0 + tb, y + h, o.z0 + 0.03, surf, copts);
  else b.collider(o.x0 - 0.03, y, o.z0 + ta, o.x0 + 0.03, y + h, o.z0 + tb, surf, copts);
}

export interface PillarOpts {
  /** Centre of the pillar. */
  x: number;
  z: number;
  /** Base height (default 0). */
  y?: number;
  height: number;
  /** Side (square) or diameter (round). Default 0.4. */
  size?: number;
  mat: MaterialId;
  /** Round column (cylinder with a square collider slightly inside it). */
  round?: boolean;
  /** Adds a small base and capital. */
  trim?: boolean;
  tint?: number;
}

/**
 * Structural pillar / column.
 *
 * @example
 * pillar(b, { x: 6, z: 6, height: 3, mat: 'concrete' });
 * pillar(b, { x: 12, z: 6, height: 5, size: 0.6, mat: 'stone_white', round: true, trim: true });
 */
export function pillar(b: MapBuilder, o: PillarOpts): void {
  const y = o.y ?? 0;
  const s = (o.size ?? 0.4) / 2;
  const tintOpts = o.tint !== undefined ? { tint: o.tint } : {};
  if (o.round) {
    b.prim('cyl', o.x, y + o.height / 2, o.z, s * 2, o.height, s * 2, o.mat, { seg: 16, ...tintOpts });
    const c = s * 0.86;
    b.collider(o.x - c, y, o.z - c, o.x + c, y + o.height, o.z + c, 'concrete');
  } else {
    b.box(o.x - s, y, o.z - s, o.x + s, y + o.height, o.z + s, o.mat, tintOpts);
  }
  if (o.trim) {
    const e = s + 0.05;
    b.box(o.x - e, y, o.z - e, o.x + e, y + 0.12, o.z + e, o.mat, { ...DECO, ...tintOpts });
    b.box(o.x - e, y + o.height - 0.12, o.z - e, o.x + e, y + o.height, o.z + e, o.mat, { ...DECO, ...tintOpts });
  }
}

export interface PlatformOpts extends Rect {
  /** Height of the walking surface. */
  y: number;
  /** Slab thickness (default 0.2). */
  thickness?: number;
  mat: MaterialId;
  /** Underside material (default: mat). */
  underMat?: MaterialId;
  /** Level the support pillars stand on (default 0). */
  groundY?: number;
  /** Support pillars under the slab: material, or `false` for none (default). Placed at the corners and every ≤ 5 m. */
  pillars?: MaterialId | false;
  pillarSize?: number;
  /**
   * Railings on the edges. For each side: `true` = whole edge, or a list of [from, to] spans
   * (distances from the x0 / z0 end of that edge) to leave gaps for stairs.
   */
  rails?: Partial<Record<Side, boolean | [number, number][]>>;
  railStyle?: 'bars' | 'glass';
  railMat?: MaterialId;
  holes?: Rect[];
}

/**
 * Raised platform / mezzanine: slab, optional pillars and edge railings.
 *
 * @example
 * // Mezzanine 3.2 m up; railing along its +Z edge except a 1.6 m gap where the stairs arrive:
 * platform(b, { x0: 0, z0: 0, x1: 10, z1: 4, y: 3.2, mat: 'concrete', pillars: 'concrete',
 *               rails: { pz: [[0, 6], [7.6, 10]] } });
 */
export function platform(b: MapBuilder, o: PlatformOpts): void {
  const r = normRect(o);
  const f: SlabOpts = { ...r, y: o.y, mat: o.mat };
  if (o.thickness !== undefined) f.thickness = o.thickness;
  if (o.underMat) f.otherMat = o.underMat;
  if (o.holes) f.holes = o.holes;
  floor(b, f);
  const t = o.thickness ?? 0.2;
  if (o.pillars) {
    const g = o.groundY ?? 0;
    const ps = o.pillarSize ?? 0.3;
    const xs = spread(r.x0 + ps / 2, r.x1 - ps / 2, Math.max(2, Math.ceil((r.x1 - r.x0) / 5) + 1));
    const zs = spread(r.z0 + ps / 2, r.z1 - ps / 2, Math.max(2, Math.ceil((r.z1 - r.z0) / 5) + 1));
    for (const x of xs) {
      for (const z of zs) {
        const edge = x === xs[0] || x === xs[xs.length - 1] || z === zs[0] || z === zs[zs.length - 1];
        if (!edge) continue;
        if (o.y - t - g > 0.05) pillar(b, { x, z, y: g, height: o.y - t - g, size: ps, mat: o.pillars });
      }
    }
  }
  if (o.rails) {
    const inset = 0.05;
    for (const side of SIDES) {
      const spec = o.rails[side];
      if (!spec) continue;
      const alongX = side === 'nz' || side === 'pz';
      const a0 = alongX ? r.x0 : r.z0;
      const a1 = alongX ? r.x1 : r.z1;
      const spans: [number, number][] = spec === true ? [[0, a1 - a0]] : spec;
      for (const [from, to] of spans) {
        if (to - from < 0.05) continue;
        const ro: RailingOpts = alongX
          ? { x0: a0 + from, x1: a0 + to, z0: side === 'nz' ? r.z0 + inset : r.z1 - inset, z1: side === 'nz' ? r.z0 + inset : r.z1 - inset, y: o.y }
          : { z0: a0 + from, z1: a0 + to, x0: side === 'nx' ? r.x0 + inset : r.x1 - inset, x1: side === 'nx' ? r.x0 + inset : r.x1 - inset, y: o.y };
        if (o.railStyle) ro.style = o.railStyle;
        if (o.railMat) ro.mat = o.railMat;
        railing(b, ro);
      }
    }
  }
}

// =================================================================================
// Lighting
// =================================================================================

export interface CeilingLightOpts {
  /** Panel size [along X, along Z] in metres (default 1.2 × 0.6; use [0.6, 0.6] for small rooms). */
  panel?: [number, number];
  /** Light colour (default neutral white 0xfff8ee). */
  color?: number;
  /** LightDef intensity (default: derived from the spacing for an evenly lit office, ≈ 1). */
  intensity?: number;
  /** LightDef range (default: derived from the spacing, 7–14 m). */
  range?: number;
  /** Emit a LightDef only for every n-th panel in each direction (default 1). Panels stay visible everywhere. */
  lightEvery?: number;
  /** Panel material (default 'light_panel'; 'light_warm' for cosy rooms). */
  mat?: MaterialId;
}

/**
 * Grid of recessed ceiling light panels + matching LightDefs over a rectangular area.
 * Panels are centred in a regular grid whose pitch is as close as possible to `spacing`.
 *
 * @param area    rectangle to light (typically `room(...).inner`)
 * @param spacing wanted distance between panels (2.5–4 m gives an evenly lit office)
 * @param y       height of the ceiling underside
 * @returns the position of every panel (useful to hang something else from the same grid)
 *
 * @example
 * ceilingLights(b, { x0: 0, z0: 0, x1: 12, z1: 8 }, 3, 2.8);
 * ceilingLights(b, corridor, 4, 2.8, { panel: [0.6, 0.6], color: 0xffe9c8 });
 */
export function ceilingLights(b: MapBuilder, area: Rect, spacing: number, y: number, opts: CeilingLightOpts = {}): { x: number; z: number }[] {
  const r = normRect(area);
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  const sp = Math.max(0.8, spacing);
  const nx = Math.max(1, Math.round(w / sp));
  const nz = Math.max(1, Math.round(d / sp));
  const pitch = Math.max(w / nx, d / nz);
  let [pw, pd] = opts.panel ?? [1.2, 0.6];
  // Lay long panels along the long side of narrow areas (corridors).
  if (w / nx < pw + 0.3 && d / nz > w / nx) [pw, pd] = [pd, pw];
  pw = Math.min(pw, (w / nx) * 0.8);
  pd = Math.min(pd, (d / nz) * 0.8);
  const color = opts.color ?? 0xfff8ee;
  const every = Math.max(1, Math.floor(opts.lightEvery ?? 1));
  const intensity = opts.intensity ?? Math.min(1.6, Math.max(0.8, 0.7 + 0.1 * pitch)) * (every > 1 ? 1 + 0.35 * (every - 1) : 1);
  const range = opts.range ?? Math.min(14, Math.max(7, pitch * 2.4)) * (every > 1 ? 1.3 : 1);
  const mat = opts.mat ?? 'light_panel';
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = r.x0 + ((i + 0.5) * w) / nx;
      const z = r.z0 + ((j + 0.5) * d) / nz;
      out.push({ x, z });
      b.box(x - pw / 2, y - 0.025, z - pd / 2, x + pw / 2, y, z + pd / 2, mat, { solid: false, detail: true, faces: { py: null } });
      if (i % every === Math.floor((every - 1) / 2) % every && j % every === Math.floor((every - 1) / 2) % every) {
        b.light(x, y - 0.2, z, color, intensity, range);
      }
    }
  }
  return out;
}

/**
 * Wall lamp: a small fixture on a wall with a warm light in front of it.
 *
 * @param x,y,z  point ON the wall face, at the height of the lamp
 * @param facing direction the lamp faces, away from the wall (0 = +Z, 1 = +X, 2 = −Z, 3 = −X)
 *
 * @example
 * wallLamp(b, 4, 2.1, 0.1, 0);   // on a wall whose face is at z = 0.1, shining toward +Z
 */
export function wallLamp(
  b: MapBuilder,
  x: number,
  y: number,
  z: number,
  facing: Dir,
  opts: { color?: number; intensity?: number; range?: number; mat?: MaterialId } = {},
): void {
  b.at(x, y, z, facing, () => {
    b.box(-0.06, -0.09, 0, 0.06, 0.09, 0.03, 'metal_brushed', DECO);
    b.box(-0.11, -0.06, 0.03, 0.11, 0.1, 0.13, opts.mat ?? 'light_warm', DECO);
    b.box(-0.12, 0.1, 0.02, 0.12, 0.12, 0.14, 'metal_brushed', DECO);
    b.light(0, 0, 0.35, opts.color ?? 0xffe2b0, opts.intensity ?? 0.7, opts.range ?? 6);
  });
}

export interface SkylightOpts extends Rect {
  /** Underside of the ceiling slab the skylight is cut into. */
  y: number;
  /** Thickness of that slab (default 0.2). */
  thickness?: number;
  /** Frame material (default 'metal_white'). */
  frame?: MaterialId;
  /** Daylight colour, intensity and range of the LightDef under the skylight. */
  color?: number;
  intensity?: number;
  range?: number;
}

/**
 * Skylight: frame + glass pane (with a collider, so the map stays sealed) closing a hole
 * of a ceiling slab, plus a daylight-coloured light underneath.
 * Cut the hole with the `holes` option of ceiling() / room().
 *
 * @example
 * const sky = { x0: 4, z0: 3, x1: 8, z1: 5 };
 * ceiling(b, { x0: 0, z0: 0, x1: 12, z1: 8, y: 5, mat: 'plaster_white', holes: [sky] });
 * skylight(b, { ...sky, y: 5 });
 */
export function skylight(b: MapBuilder, o: SkylightOpts): void {
  const r = normRect(o);
  const t = o.thickness ?? 0.2;
  const frame = o.frame ?? 'metal_white';
  const bar = 0.06;
  const w = r.x1 - r.x0;
  const d = r.z1 - r.z0;
  // Glass at the top of the hole.
  b.box(r.x0, o.y + t - 0.04, r.z0, r.x1, o.y + t, r.z1, 'glass', { detail: true, surf: 'glass' });
  // Frame lining the hole, slightly below the ceiling.
  b.box(r.x0, o.y - 0.03, r.z0, r.x1, o.y + t - 0.04, r.z0 + bar, frame, DECO);
  b.box(r.x0, o.y - 0.03, r.z1 - bar, r.x1, o.y + t - 0.04, r.z1, frame, DECO);
  b.box(r.x0, o.y - 0.03, r.z0 + bar, r.x0 + bar, o.y + t - 0.04, r.z1 - bar, frame, DECO);
  b.box(r.x1 - bar, o.y - 0.03, r.z0 + bar, r.x1, o.y + t - 0.04, r.z1 - bar, frame, DECO);
  // Glazing bars across the longest side.
  const alongX = w >= d;
  const n = Math.max(1, Math.round((alongX ? w : d) / 1.2));
  for (let i = 1; i < n; i++) {
    if (alongX) {
      const x = r.x0 + (w * i) / n;
      b.box(x - 0.025, o.y + t - 0.1, r.z0 + bar, x + 0.025, o.y + t - 0.04, r.z1 - bar, frame, DECO);
    } else {
      const z = r.z0 + (d * i) / n;
      b.box(r.x0 + bar, o.y + t - 0.1, z - 0.025, r.x1 - bar, o.y + t - 0.04, z + 0.025, frame, DECO);
    }
  }
  const size = Math.max(w, d);
  b.light((r.x0 + r.x1) / 2, o.y - 0.3, (r.z0 + r.z1) / 2, o.color ?? 0xe4f0ff, o.intensity ?? 1.3, o.range ?? Math.max(9, size * 2.5));
}

// =================================================================================
// Placement utilities
// =================================================================================

/** Position + orientation of something placed with `b.at(x, y, z, q, …)`. */
export interface Placement {
  x: number;
  y?: number;
  z: number;
  /** Quarter turns (0 = front toward +Z, 1 = +X, 2 = −Z, 3 = −X). */
  q?: number;
}

/**
 * `count` values evenly spread from `from` to `to` inclusive (count = 1 → the middle).
 * @example spread(0, 10, 3) // [0, 5, 10]
 */
export function spread(from: number, to: number, count: number): number[] {
  if (count <= 1) return [(from + to) / 2];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(from + ((to - from) * i) / (count - 1));
  return out;
}

/**
 * Centres of an `nx` × `nz` grid of equal cells covering a rectangle.
 * @example
 * for (const p of gridCells({ x0: 0, z0: 0, x1: 12, z1: 6 }, 4, 2)) b.at(p.x, 0, p.z, 0, () => desk(b));
 */
export function gridCells(area: Rect, nx: number, nz: number): { x: number; z: number; i: number; j: number }[] {
  const r = normRect(area);
  const out: { x: number; z: number; i: number; j: number }[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      out.push({ x: r.x0 + ((i + 0.5) * (r.x1 - r.x0)) / nx, z: r.z0 + ((j + 0.5) * (r.z1 - r.z0)) / nz, i, j });
    }
  }
  return out;
}

/**
 * Positions along a line, `spacing` apart, centred between the two ends.
 * @example alongLine(0, 0, 10, 0, 2.5) // 4 points on the X axis: x = 1.25, 3.75, 6.25, 8.75
 */
export function alongLine(x0: number, z0: number, x1: number, z1: number, spacing: number): { x: number; z: number }[] {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.floor(len / spacing + 1e-6));
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    out.push({ x: x0 + (x1 - x0) * f, z: z0 + (z1 - z0) * f });
  }
  return out;
}

/**
 * Mirror placements across the plane x = `cx` (orientations are mirrored too: a prop facing
 * +X now faces −X). Props themselves are not flipped, only moved and turned.
 * @example const all = [...left, ...mirrorX(left, 20)]; // symmetric layout around x = 20
 */
export function mirrorX<T extends Placement>(list: readonly T[], cx = 0): T[] {
  return list.map((p) => ({ ...p, x: 2 * cx - p.x, q: [0, 3, 2, 1][(((p.q ?? 0) % 4) + 4) % 4]! }));
}

/** Mirror placements across the plane z = `cz` (a prop facing +Z now faces −Z). */
export function mirrorZ<T extends Placement>(list: readonly T[], cz = 0): T[] {
  return list.map((p) => ({ ...p, z: 2 * cz - p.z, q: [2, 1, 0, 3][(((p.q ?? 0) % 4) + 4) % 4]! }));
}

/** Runs `fn` in the frame of every placement. */
export function placeAll<T extends Placement>(b: MapBuilder, list: readonly T[], fn: (b: MapBuilder, p: T, index: number) => void): void {
  list.forEach((p, i) => b.at(p.x, p.y ?? 0, p.z, p.q ?? 0, () => fn(b, p, i)));
}

/**
 * Deterministic random generator for decoration variants (never use Math.random in maps).
 * @example const rng = seeded(12, 7); if (rng() < 0.3) …
 */
export function seeded(a: number, b = 0, c = 0): Rng {
  return mulberry32(hash3(Math.round(a * 16), Math.round(b * 16), Math.round(c * 16)));
}

/**
 * Deterministic pick in a list, from a seed (number) or an existing generator.
 * @example const colour = pick(i, ['fabric_blue', 'fabric_grey', 'fabric_red'] as const);
 */
export function pick<T>(seed: number | Rng, items: readonly T[]): T {
  if (!items.length) throw new Error('pick(): empty list');
  const r = typeof seed === 'number' ? mulberry32(hash3(seed, 0x51ed))() : seed();
  return items[Math.min(items.length - 1, Math.floor(r * items.length))]!;
}
