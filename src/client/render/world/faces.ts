/**
 * Box faces: the single place where the visible faces of the map boxes are listed
 * (collectBoxFaces) and turned into triangles (emitBoxFaces).
 *
 * Every visible piece of a box face is described by a BoxFace record: source box, face
 * name, world-space rectangle, material and texture-mapping mode. Faces completely
 * buried in (or pressed against) another opaque box are dropped; faces whose border runs
 * into another box are trimmed, so one box face can yield several records (rectangles).
 *
 * Lighting systems work from these records:
 *  - phase 1 (now): emitBoxFaces cuts lit faces into ~2 m quads on a WORLD-ALIGNED grid
 *    and bakes `shader.shade()` into vertex colours;
 *  - light-mapping (next): set `face.lm` to the atlas rectangle of the record before
 *    emitting; emitBoxFaces then writes the second UV set (uv1) from the (s, t) parameters
 *    of the record and leaves the vertex colour to the tint only. `faceParamS/T()` and
 *    `facePoint()` convert between (s, t) in [0, 1]² and world positions.
 *
 * Watertightness: where two records of the same plane meet along a border (a wall split
 * around a doorway, floor slabs side by side, the pieces of a trimmed face), each one
 * receives the border vertices of the other, and the cells along that border are
 * triangulated as fans. Neighbours therefore share their border vertices exactly: no
 * T-junctions, hence no sparkling cracks along the seams, and the vertex lighting is
 * continuous from one box to the next.
 *
 * Face frames (texture U runs toward the viewer's right, V upward, U × V = normal):
 *   px: U = -Z, V = +Y      nx: U = +Z, V = +Y
 *   pz: U = +X, V = +Y      nz: U = -X, V = +Y
 *   py: U = +X, V = -Z      ny: U = +X, V = +Z
 */
import { materialInfo, type MaterialId } from '../../../shared/maps/materials';
import type { BoxPrim, FaceName } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math/vec3';
import { BoxGrid } from './boxgrid';
import type { GeometryWriter } from './geom';
import { hexToLinear, type SurfaceShader } from './lightmath';

export type Axis = 0 | 1 | 2;

/** Rectangle in lightmap-atlas UV space (0..1). */
export interface LightmapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How a face is textured:
 *  - 'world': planar projection of world coordinates, one repeat per MATERIALS[id].tile metres
 *             (textures line up across adjacent boxes);
 *  - 'fit':   the texture is stretched over the whole box face, `repU` × `repV` times
 *             (object-like materials: doors, windows, screens, shutters, light panels);
 *  - 'edge':  thin side of an object-like box: samples the border of the texture.
 */
export type FaceUvMode = 'world' | 'fit' | 'edge';

export interface BoxFace {
  /** Index of the source box in map.boxes. */
  box: number;
  name: FaceName;
  mat: MaterialId;
  /** Multiplicative tint 0xRRGGBB (0xffffff = none). */
  tint: number;
  /** Copied from BoxPrim.detail: small box that should stay vertex-lit. */
  detail: boolean;
  /** Axis of the outward normal (0 = X, 1 = Y, 2 = Z) and its sign. */
  axis: Axis;
  sign: 1 | -1;
  /** World coordinate of the face plane along `axis`. */
  plane: number;
  /** Tangent axes: texture U runs along uAxis × uSign, V along vAxis × vSign. */
  uAxis: Axis;
  uSign: 1 | -1;
  vAxis: Axis;
  vSign: 1 | -1;
  /** World rectangle of this record: coordinate range along uAxis and vAxis (min < max). */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** Rectangle of the whole box face (equal to the above unless the face was clipped). */
  bu0: number;
  bu1: number;
  bv0: number;
  bv1: number;
  uvMode: FaceUvMode;
  /** Texture repeats over the whole box face in 'fit' mode. */
  repU: number;
  repV: number;
  /** Lightmap atlas rectangle of the record, or null when it is vertex-lit. */
  lm: LightmapRect | null;
}

interface FaceFrame {
  name: FaceName;
  axis: Axis;
  sign: 1 | -1;
  uAxis: Axis;
  uSign: 1 | -1;
  vAxis: Axis;
  vSign: 1 | -1;
}

export const FACE_FRAMES: readonly FaceFrame[] = [
  { name: 'px', axis: 0, sign: 1, uAxis: 2, uSign: -1, vAxis: 1, vSign: 1 },
  { name: 'nx', axis: 0, sign: -1, uAxis: 2, uSign: 1, vAxis: 1, vSign: 1 },
  { name: 'py', axis: 1, sign: 1, uAxis: 0, uSign: 1, vAxis: 2, vSign: -1 },
  { name: 'ny', axis: 1, sign: -1, uAxis: 0, uSign: 1, vAxis: 2, vSign: 1 },
  { name: 'pz', axis: 2, sign: 1, uAxis: 0, uSign: 1, vAxis: 1, vSign: 1 },
  { name: 'nz', axis: 2, sign: -1, uAxis: 0, uSign: -1, vAxis: 1, vSign: 1 },
];

/**
 * Object-like materials: their texture shows ONE object (a door leaf, a window, a
 * screen…) and is therefore fitted to the face instead of tiled in world space.
 *  - 'fit':   exactly one repeat over the face;
 *  - 'row':   one repeat vertically, repeated horizontally on wide faces (rows of windows);
 *  - 'cells': square cells (a long light strip shows several panels).
 */
type FitMode = 'fit' | 'row' | 'cells';
const FIT_MATERIALS: Partial<Record<MaterialId, FitMode>> = {
  door_wood: 'fit',
  door_white: 'fit',
  door_metal: 'fit',
  shutter: 'fit',
  screen_on: 'fit',
  screen_off: 'fit',
  window_facade: 'row',
  window_lit: 'row',
  light_panel: 'cells',
};

/** True when the texture of this material is fitted to box faces (see FIT_MATERIALS). */
export const isFittedMaterial = (id: MaterialId): boolean => FIT_MATERIALS[id] !== undefined;

const comp = (v: Vec3, a: Axis): number => (a === 0 ? v.x : a === 1 ? v.y : v.z);

/** Distance (m) in front of a face at which "is it buried in another box?" is tested. */
const PROBE = 0.001;
/** Smallest overlap / leftover (m) worth cutting or keeping. */
const MIN_CUT = 0.001;
/** A face is never cut into more pieces than this (the rest stays buried, harmlessly). */
const MAX_PIECES = 96;

/**
 * Occluder class of a box: 0 = hides nothing (it has a hidden or see-through face),
 * 1 = fully opaque, 2 = uniform transparent box (hides faces of the same material only,
 * which removes the inner faces between adjacent glass / water boxes).
 */
function occluderKind(box: BoxPrim): 0 | 1 | 2 {
  const baseTransparent = materialInfo(box.mat).transparent === true;
  if (box.faces) {
    for (const f of FACE_FRAMES) {
      const o = box.faces[f.name];
      if (o === undefined) continue;
      if (o === null) return 0;
      if ((materialInfo(o).transparent === true) !== baseTransparent || (baseTransparent && o !== box.mat)) return 0;
    }
  }
  return baseTransparent ? 2 : 1;
}

interface Rect {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/** Remove `cut` from every rectangle of `pieces` (guillotine split), in place. */
function subtract(pieces: Rect[], cut: Rect): void {
  const n = pieces.length;
  for (let i = 0; i < n; i++) {
    const p = pieces[i]!;
    const iu0 = Math.max(p.u0, cut.u0);
    const iu1 = Math.min(p.u1, cut.u1);
    const iv0 = Math.max(p.v0, cut.v0);
    const iv1 = Math.min(p.v1, cut.v1);
    if (iu1 - iu0 < MIN_CUT || iv1 - iv0 < MIN_CUT) continue; // no real overlap
    // Left / right strips keep the full height; bottom / top strips only span the cut.
    if (iu0 - p.u0 >= MIN_CUT) pieces.push({ u0: p.u0, u1: iu0, v0: p.v0, v1: p.v1 });
    if (p.u1 - iu1 >= MIN_CUT) pieces.push({ u0: iu1, u1: p.u1, v0: p.v0, v1: p.v1 });
    if (iv0 - p.v0 >= MIN_CUT) pieces.push({ u0: iu0, u1: iu1, v0: p.v0, v1: iv0 });
    if (p.v1 - iv1 >= MIN_CUT) pieces.push({ u0: iu0, u1: iu1, v0: iv1, v1: p.v1 });
    p.u1 = p.u0; // mark the original as consumed
  }
  let w = 0;
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    if (p.u1 > p.u0) pieces[w++] = p;
  }
  pieces.length = w;
}

/** Glue back rectangles that share a whole side (undoes needless guillotine splits). */
function mergePieces(pieces: Rect[]): void {
  const E = 1e-6;
  let merged = true;
  while (merged && pieces.length > 1) {
    merged = false;
    outer: for (let i = 0; i < pieces.length; i++) {
      const a = pieces[i]!;
      for (let j = i + 1; j < pieces.length; j++) {
        const b = pieces[j]!;
        const sameV = Math.abs(a.v0 - b.v0) < E && Math.abs(a.v1 - b.v1) < E;
        const sameU = Math.abs(a.u0 - b.u0) < E && Math.abs(a.u1 - b.u1) < E;
        if (sameV && (Math.abs(a.u1 - b.u0) < E || Math.abs(b.u1 - a.u0) < E)) {
          a.u0 = Math.min(a.u0, b.u0);
          a.u1 = Math.max(a.u1, b.u1);
        } else if (sameU && (Math.abs(a.v1 - b.v0) < E || Math.abs(b.v1 - a.v0) < E)) {
          a.v0 = Math.min(a.v0, b.v0);
          a.v1 = Math.max(a.v1, b.v1);
        } else {
          continue;
        }
        pieces.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
}

/**
 * List the visible parts of every face of the map boxes, in box order then FACE_FRAMES
 * order. Skipped: faces overridden with `null` and faces completely buried in (or pressed
 * against) another opaque box. A face whose border runs into another box is trimmed to
 * the rectangles that stay visible: besides saving fill-rate, this removes the buried
 * strip that would otherwise end flush with (and flicker through) the other box's surface.
 * A box that only covers the middle of a face (a crate on the floor, a ceiling panel)
 * hides that part without cutting the face.
 */
export function collectBoxFaces(boxes: readonly BoxPrim[]): BoxFace[] {
  const kinds = new Uint8Array(boxes.length);
  for (let i = 0; i < boxes.length; i++) kinds[i] = occluderKind(boxes[i]!);
  const grid = new BoxGrid(boxes, (_b, i) => kinds[i] !== 0);
  const faces: BoxFace[] = [];
  const candidates: number[] = [];
  const pieces: Rect[] = [];
  const cut: Rect = { u0: 0, u1: 0, v0: 0, v1: 0 };

  for (let bi = 0; bi < boxes.length; bi++) {
    const box = boxes[bi]!;
    const ex = box.max.x - box.min.x;
    const ey = box.max.y - box.min.y;
    const ez = box.max.z - box.min.z;
    const minExtent = Math.min(ex, ey, ez);

    for (const f of FACE_FRAMES) {
      const override = box.faces?.[f.name];
      if (override === null) continue;
      const mat = override ?? box.mat;
      const plane = f.sign > 0 ? comp(box.max, f.axis) : comp(box.min, f.axis);
      const u0 = comp(box.min, f.uAxis);
      const u1 = comp(box.max, f.uAxis);
      const v0 = comp(box.min, f.vAxis);
      const v1 = comp(box.max, f.vAxis);

      // --- Cut away what lies inside other boxes ---
      const q = plane + f.sign * PROBE;
      if (f.axis === 0) grid.queryRect(q, u0, q, u1, candidates);
      else if (f.axis === 2) grid.queryRect(u0, q, u1, q, candidates);
      else grid.queryRect(u0, v0, u1, v1, candidates);
      pieces.length = 0;
      pieces.push({ u0, u1, v0, v1 });
      for (let c = 0; c < candidates.length && pieces.length > 0 && pieces.length < MAX_PIECES; c++) {
        const j = candidates[c]!;
        if (j === bi) continue;
        const other = boxes[j]!;
        if (kinds[j] === 2 && other.mat !== mat) continue;
        if (comp(other.min, f.axis) > q || comp(other.max, f.axis) < q) continue;
        cut.u0 = comp(other.min, f.uAxis);
        cut.u1 = comp(other.max, f.uAxis);
        cut.v0 = comp(other.min, f.vAxis);
        cut.v1 = comp(other.max, f.vAxis);
        // Only boxes reaching a border of the face cut it (see the function comment).
        if (cut.u0 > u0 + MIN_CUT && cut.u1 < u1 - MIN_CUT && cut.v0 > v0 + MIN_CUT && cut.v1 < v1 - MIN_CUT) continue;
        subtract(pieces, cut);
      }
      if (pieces.length === 0) continue;
      mergePieces(pieces);

      // --- Texture mapping mode (decided on the whole box face) ---
      let uvMode: FaceUvMode = 'world';
      let repU = 1;
      let repV = 1;
      const fit = FIT_MATERIALS[mat];
      if (fit) {
        const depth = f.axis === 0 ? ex : f.axis === 1 ? ey : ez;
        if (override === undefined && depth > minExtent * 1.01 + 1e-6) {
          uvMode = 'edge';
        } else {
          uvMode = 'fit';
          const w = u1 - u0;
          const h = v1 - v0;
          if (fit === 'row') {
            if (f.axis !== 1) repU = Math.max(1, Math.round(w / Math.max(h * 0.9, 0.4)));
            else if (w >= h) repU = Math.max(1, Math.round(w / h));
            else repV = Math.max(1, Math.round(h / w));
          } else if (fit === 'cells') {
            const m = Math.min(w, h);
            repU = Math.max(1, Math.round(w / m));
            repV = Math.max(1, Math.round(h / m));
          }
        }
      }

      for (const p of pieces) {
        faces.push({
          box: bi,
          name: f.name,
          mat,
          tint: box.tint ?? 0xffffff,
          detail: box.detail === true,
          axis: f.axis,
          sign: f.sign,
          plane,
          uAxis: f.uAxis,
          uSign: f.uSign,
          vAxis: f.vAxis,
          vSign: f.vSign,
          u0: p.u0,
          u1: p.u1,
          v0: p.v0,
          v1: p.v1,
          bu0: u0,
          bu1: u1,
          bv0: v0,
          bv1: v1,
          uvMode,
          repU,
          repV,
          lm: null,
        });
      }
    }
  }
  return faces;
}

/** Parameter s (0..1 along texture U, within the record) of a world coordinate on uAxis. */
export const faceParamS = (face: BoxFace, coord: number): number =>
  face.uSign > 0 ? (coord - face.u0) / (face.u1 - face.u0) : (face.u1 - coord) / (face.u1 - face.u0);

/** Parameter t (0..1 along texture V, within the record) of a world coordinate on vAxis. */
export const faceParamT = (face: BoxFace, coord: number): number =>
  face.vSign > 0 ? (coord - face.v0) / (face.v1 - face.v0) : (face.v1 - coord) / (face.v1 - face.v0);

const P: [number, number, number] = [0, 0, 0];

/** World position of the record point with parameters (s, t) in [0, 1]². */
export function facePoint(face: BoxFace, s: number, t: number, out: Vec3): Vec3 {
  const cu = face.uSign > 0 ? face.u0 + s * (face.u1 - face.u0) : face.u1 - s * (face.u1 - face.u0);
  const cv = face.vSign > 0 ? face.v0 + t * (face.v1 - face.v0) : face.v1 - t * (face.v1 - face.v0);
  P[face.axis] = face.plane;
  P[face.uAxis] = cu;
  P[face.vAxis] = cv;
  out.x = P[0];
  out.y = P[1];
  out.z = P[2];
  return out;
}

/** Outward unit normal of a face. */
export function faceNormal(face: BoxFace, out: Vec3): Vec3 {
  out.x = face.axis === 0 ? face.sign : 0;
  out.y = face.axis === 1 ? face.sign : 0;
  out.z = face.axis === 2 ? face.sign : 0;
  return out;
}

export interface FaceEmitOptions {
  /** Vertex-lighting provider (ignored for emissive materials and light-mapped records). */
  shader: SurfaceShader;
  /** Largest quad size (m) a vertex-lit face is cut into; 0 = no subdivision. */
  subdivide: number;
  /**
   * Lightmap UV given to vertex-lit records when the target writer carries a uv1 set
   * (a texel of the atlas that leaves the vertex colour unchanged).
   */
  neutralLightmapUv?: readonly [number, number];
}

const MAX_CELLS = 96;
/** Two coordinates closer than this (m) are the same vertex. */
const WELD = 1e-4;
const N: [number, number, number] = [0, 0, 0];
const TINT = new Float32Array(3);
const LIGHT = new Float32Array(3);

/** True when the record gets its light from vertex colours (and is therefore subdivided). */
const isVertexLit = (face: BoxFace): boolean => !materialInfo(face.mat).emissive && face.lm === null;

/**
 * Cut coordinates of [a0, a1]: both ends plus the multiples of `step` in between.
 * The grid is world-aligned, so adjacent records cut their common border at the same places.
 */
function ownCuts(a0: number, a1: number, step: number): number[] {
  const out = [a0];
  if (step > 0 && a1 - a0 > step + WELD) {
    let s = step;
    if ((a1 - a0) / s > MAX_CELLS) s = (a1 - a0) / MAX_CELLS;
    let k = Math.floor(a0 / s) + 1;
    for (let c = k * s; c < a1 - WELD; c = ++k * s) {
      if (c > a0 + WELD) out.push(c);
    }
  }
  out.push(a1);
  return out;
}

/** Border slots of a record: vertices to add on its u0 / u1 / v0 / v1 side. */
const SIDE_U0 = 0;
const SIDE_U1 = 1;
const SIDE_V0 = 2;
const SIDE_V1 = 3;

/** Add to `extra[slot]` the coordinates of `from` lying strictly inside ]lo, hi[. */
function importCuts(extra: (number[] | undefined)[], slot: number, from: readonly number[], lo: number, hi: number): void {
  let list = extra[slot];
  for (let i = 0; i < from.length; i++) {
    const c = from[i]!;
    if (c > lo + WELD && c < hi - WELD) {
      if (!list) extra[slot] = list = [];
      list.push(c);
    }
  }
}

/**
 * Find the seams between records of the same plane and, for each seam, hand the border
 * vertices of one record to the other (`extra[index * 4 + side]`).
 */
function findSeams(
  faces: readonly BoxFace[],
  cutsU: readonly number[][],
  cutsV: readonly number[][],
  extra: (number[] | undefined)[],
): void {
  const planes = new Map<string, number[]>();
  for (let i = 0; i < faces.length; i++) {
    const f = faces[i]!;
    const key = `${f.axis}|${f.sign}|${Math.round(f.plane * 2000)}`;
    let list = planes.get(key);
    if (!list) planes.set(key, (list = []));
    list.push(i);
  }
  for (const list of planes.values()) {
    if (list.length < 2) continue;
    // Sweep along U: only records whose U ranges meet can touch.
    list.sort((a, b) => faces[a]!.u0 - faces[b]!.u0);
    for (let i = 0; i < list.length; i++) {
      const ia = list[i]!;
      const a = faces[ia]!;
      for (let j = i + 1; j < list.length; j++) {
        const ib = list[j]!;
        const b = faces[ib]!;
        if (b.u0 > a.u1 + WELD) break;
        const overlapU = Math.min(a.u1, b.u1) - Math.max(a.u0, b.u0);
        const overlapV = Math.min(a.v1, b.v1) - Math.max(a.v0, b.v0);
        if (overlapU < -WELD || overlapV < -WELD) continue; // apart
        const touchU = overlapU <= WELD;
        const touchV = overlapV <= WELD;
        if (touchU === touchV) continue; // corner contact, or overlapping twins: no seam
        if (touchU) {
          // Seam along V: a's u1 border against b's u0 border (a starts first in the sweep).
          importCuts(extra, ia * 4 + SIDE_U1, cutsV[ib]!, a.v0, a.v1);
          importCuts(extra, ib * 4 + SIDE_U0, cutsV[ia]!, b.v0, b.v1);
        } else if (a.v1 <= b.v0 + WELD) {
          // Seam along U: a below b.
          importCuts(extra, ia * 4 + SIDE_V1, cutsU[ib]!, a.u0, a.u1);
          importCuts(extra, ib * 4 + SIDE_V0, cutsU[ia]!, b.u0, b.u1);
        } else {
          importCuts(extra, ia * 4 + SIDE_V0, cutsU[ib]!, a.u0, a.u1);
          importCuts(extra, ib * 4 + SIDE_V1, cutsU[ia]!, b.u0, b.u1);
        }
      }
    }
  }
}

/** Sort, drop duplicates and drop the values that coincide with one of `own` (sorted). */
function cleanExtras(values: number[] | undefined, own: readonly number[]): number[] | null {
  if (!values || values.length === 0) return null;
  values.sort((a, b) => a - b);
  let w = 0;
  let o = 0;
  for (let i = 0; i < values.length; i++) {
    const c = values[i]!;
    if (w > 0 && c - values[w - 1]! <= WELD) continue;
    while (o < own.length && own[o]! < c - WELD) o++;
    if (o < own.length && Math.abs(own[o]! - c) <= WELD) continue;
    values[w++] = c;
  }
  values.length = w;
  return w > 0 ? values : null;
}

/** Index of the first value greater than `x` in a sorted list. */
function upperBound(list: readonly number[], x: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Triangulate records into writers (`writerFor` picks the target of each record).
 * Vertex colour = tint × light (vertex-lit), tint only (emissive or light-mapped).
 * Records meeting in a plane share their border vertices, see the file header.
 */
export function emitBoxFaces(
  faces: readonly BoxFace[],
  opts: FaceEmitOptions,
  writerFor: (face: BoxFace) => GeometryWriter,
): void {
  const n = faces.length;
  const cutsU: number[][] = new Array<number[]>(n);
  const cutsV: number[][] = new Array<number[]>(n);
  for (let i = 0; i < n; i++) {
    const face = faces[i]!;
    const step = isVertexLit(face) ? opts.subdivide : 0;
    cutsU[i] = ownCuts(face.u0, face.u1, step);
    cutsV[i] = ownCuts(face.v0, face.v1, step);
  }
  const extra: (number[] | undefined)[] = new Array<number[] | undefined>(n * 4);
  findSeams(faces, cutsU, cutsV, extra);
  for (let i = 0; i < n; i++) {
    const us = cutsU[i]!;
    const vs = cutsV[i]!;
    emitRecord(
      writerFor(faces[i]!),
      faces[i]!,
      us,
      vs,
      cleanExtras(extra[i * 4 + SIDE_U0], vs),
      cleanExtras(extra[i * 4 + SIDE_U1], vs),
      cleanExtras(extra[i * 4 + SIDE_V0], us),
      cleanExtras(extra[i * 4 + SIDE_V1], us),
      opts,
    );
  }
}

const RING: number[] = [];

/**
 * Append one record: a grid of quads on its own cut coordinates; the cells that carry
 * extra border vertices (seams) become triangle fans around their centre.
 */
function emitRecord(
  w: GeometryWriter,
  face: BoxFace,
  us: readonly number[],
  vs: readonly number[],
  exU0: readonly number[] | null,
  exU1: readonly number[] | null,
  exV0: readonly number[] | null,
  exV1: readonly number[] | null,
  opts: FaceEmitOptions,
): void {
  const info = materialInfo(face.mat);
  const lit = isVertexLit(face);
  const tile = info.tile ?? 1;
  const nu = us.length;
  const nv = vs.length;
  const lm = face.lm;
  const neutral = opts.neutralLightmapUv;
  const fitW = face.bu1 - face.bu0;
  const fitH = face.bv1 - face.bv0;

  hexToLinear(face.tint, TINT);
  N[0] = N[1] = N[2] = 0;
  N[face.axis] = face.sign;
  P[face.axis] = face.plane;

  /** Append the vertex at world coordinates (cu, cv) of the face plane. */
  const vertex = (cu: number, cv: number): number => {
    P[face.uAxis] = cu;
    P[face.vAxis] = cv;
    let u: number;
    let v: number;
    if (face.uvMode === 'world') {
      u = (face.uSign * cu) / tile;
      v = (face.vSign * cv) / tile;
    } else {
      // Position within the whole box face, along the texture axes.
      const fs = face.uSign > 0 ? (cu - face.bu0) / fitW : (face.bu1 - cu) / fitW;
      const ft = face.vSign > 0 ? (cv - face.bv0) / fitH : (face.bv1 - cv) / fitH;
      if (face.uvMode === 'fit') {
        u = fs * face.repU;
        v = ft * face.repV;
      } else {
        u = 0.004 + fs * 0.012;
        v = 0.004 + ft * 0.012;
      }
    }
    let r = TINT[0]!;
    let g = TINT[1]!;
    let b = TINT[2]!;
    if (lit) {
      opts.shader.shade(P[0], P[1], P[2], N[0], N[1], N[2], LIGHT);
      r *= LIGHT[0]!;
      g *= LIGHT[1]!;
      b *= LIGHT[2]!;
    }
    w.reserve(1, 0);
    const vi = w.vertex(P[0], P[1], P[2], u, v, r, g, b);
    if (lm) w.setUv1(vi, lm.x + faceParamS(face, cu) * lm.w, lm.y + faceParamT(face, cv) * lm.h);
    else if (neutral) w.setUv1(vi, neutral[0], neutral[1]);
    return vi;
  };

  w.reserve(nu * nv, (nu - 1) * (nv - 1) * 6);
  const base = w.vertexCount;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) vertex(us[i]!, vs[j]!);
  }

  // Rows / columns ascend in world coordinates; the winding depends on the frame handedness.
  const ccw = face.uSign * face.vSign > 0;
  const seams = exU0 !== null || exU1 !== null || exV0 !== null || exV1 !== null;
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = base + j * nu + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = a + nu;

      if (seams) {
        // Extra vertices on the outer edges of this cell, if it lies on a seam.
        const bottom = j === 0 ? exV0 : null;
        const top = j === nv - 2 ? exV1 : null;
        const left = i === 0 ? exU0 : null;
        const right = i === nu - 2 ? exU1 : null;
        const b0 = bottom ? upperBound(bottom, us[i]!) : 0;
        const b1 = bottom ? upperBound(bottom, us[i + 1]! - WELD) : 0;
        const t0 = top ? upperBound(top, us[i]!) : 0;
        const t1 = top ? upperBound(top, us[i + 1]! - WELD) : 0;
        const l0 = left ? upperBound(left, vs[j]!) : 0;
        const l1 = left ? upperBound(left, vs[j + 1]! - WELD) : 0;
        const r0 = right ? upperBound(right, vs[j]!) : 0;
        const r1 = right ? upperBound(right, vs[j + 1]! - WELD) : 0;
        if (b1 > b0 || t1 > t0 || l1 > l0 || r1 > r0) {
          // Boundary ring a -> b -> c -> d with the extra vertices in between, then a fan.
          RING.length = 0;
          RING.push(a);
          for (let k = b0; k < b1; k++) RING.push(vertex(bottom![k]!, vs[j]!));
          RING.push(b);
          for (let k = r0; k < r1; k++) RING.push(vertex(us[i + 1]!, right![k]!));
          RING.push(c);
          for (let k = t1 - 1; k >= t0; k--) RING.push(vertex(top![k]!, vs[j + 1]!));
          RING.push(d);
          for (let k = l1 - 1; k >= l0; k--) RING.push(vertex(us[i]!, left![k]!));
          const centre = vertex((us[i]! + us[i + 1]!) * 0.5, (vs[j]! + vs[j + 1]!) * 0.5);
          w.reserve(0, RING.length * 3);
          for (let k = 0; k < RING.length; k++) {
            const p = RING[k]!;
            const q = RING[(k + 1) % RING.length]!;
            if (ccw) w.tri(centre, p, q);
            else w.tri(centre, q, p);
          }
          continue;
        }
      }

      // Same world diagonal (a-c) whatever the facing: coplanar faces triangulate alike.
      w.reserve(0, 6);
      if (ccw) w.quad(a, b, c, d);
      else w.quad(a, d, c, b);
    }
  }
}
