/**
 * Box faces: the single place where the visible faces of the map boxes are listed
 * (collectBoxFaces) and turned into triangles (emitBoxFace).
 *
 * Every visible face is described by a BoxFace record: source box, face name, the
 * world-space rectangle, the material and the texture-mapping mode. Lighting systems
 * work from these records:
 *  - phase 1 (now): emitBoxFace cuts lit faces into ~2 m quads on a WORLD-ALIGNED grid
 *    and bakes `shader.shade()` into vertex colours;
 *  - light-mapping (next): set `face.lm` to the atlas rectangle of the face before
 *    emitting; emitBoxFace then writes the second UV set (uv1) from the same (s, t)
 *    face parameters and leaves the vertex colour to the tint only. `faceParam()` /
 *    `facePoint()` convert between (s, t) in [0, 1]² and world positions.
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
import { hexToLinear, type SurfaceShader } from './lighting';

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
 *  - 'fit':   the texture is stretched over the face, `repU` × `repV` times (object-like
 *             materials: doors, windows, screens, shutters, light panels);
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
  /** World rectangle: coordinate range along uAxis and along vAxis (min < max). */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  uvMode: FaceUvMode;
  /** Texture repeats over the face in 'fit' mode. */
  repU: number;
  repV: number;
  /** Lightmap atlas rectangle of the face, or null for a vertex-lit face. */
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
const EPS = 1e-4;

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

/**
 * List every visible face of the map boxes, in box order then FACE_FRAMES order.
 * Skipped: faces overridden with `null`, and faces completely buried in (or pressed
 * against) another opaque box.
 */
export function collectBoxFaces(boxes: readonly BoxPrim[]): BoxFace[] {
  const kinds = new Uint8Array(boxes.length);
  for (let i = 0; i < boxes.length; i++) kinds[i] = occluderKind(boxes[i]!);
  const grid = new BoxGrid(boxes, (_b, i) => kinds[i] !== 0);
  const faces: BoxFace[] = [];
  const probe: [number, number, number] = [0, 0, 0];

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

      // --- Hidden-face test: is the whole rectangle inside one occluding box? ---
      const q = plane + f.sign * PROBE;
      probe[f.axis] = q;
      probe[f.uAxis] = (u0 + u1) * 0.5;
      probe[f.vAxis] = (v0 + v1) * 0.5;
      const candidates = grid.query(probe[0], probe[2]);
      let hidden = false;
      for (let c = 0; c < candidates.length; c++) {
        const j = candidates[c]!;
        if (j === bi) continue;
        const other = boxes[j]!;
        if (kinds[j] === 2 && other.mat !== mat) continue;
        if (
          comp(other.min, f.axis) <= q &&
          comp(other.max, f.axis) >= q &&
          comp(other.min, f.uAxis) <= u0 + EPS &&
          comp(other.max, f.uAxis) >= u1 - EPS &&
          comp(other.min, f.vAxis) <= v0 + EPS &&
          comp(other.max, f.vAxis) >= v1 - EPS
        ) {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;

      // --- Texture mapping mode ---
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
        u0,
        u1,
        v0,
        v1,
        uvMode,
        repU,
        repV,
        lm: null,
      });
    }
  }
  return faces;
}

/** Face parameter s (0..1 along texture U) of a world coordinate on the face's uAxis. */
export const faceParamS = (face: BoxFace, coord: number): number =>
  face.uSign > 0 ? (coord - face.u0) / (face.u1 - face.u0) : (face.u1 - coord) / (face.u1 - face.u0);

/** Face parameter t (0..1 along texture V) of a world coordinate on the face's vAxis. */
export const faceParamT = (face: BoxFace, coord: number): number =>
  face.vSign > 0 ? (coord - face.v0) / (face.v1 - face.v0) : (face.v1 - coord) / (face.v1 - face.v0);

/** World position of the face point with parameters (s, t) in [0, 1]². */
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
  /** Vertex-lighting provider (ignored for emissive materials and light-mapped faces). */
  shader: SurfaceShader;
  /** Largest quad size (m) a vertex-lit face is cut into; 0 = one quad per face. */
  subdivide: number;
  /**
   * Lightmap UV given to vertex-lit faces when the target writer carries a uv1 set
   * (a texel of the atlas that leaves the vertex colour unchanged).
   */
  neutralLightmapUv?: readonly [number, number];
}

const MAX_CELLS = 64;
const US = new Float64Array(MAX_CELLS + 2);
const VS = new Float64Array(MAX_CELLS + 2);
const P: [number, number, number] = [0, 0, 0];
const N: [number, number, number] = [0, 0, 0];
const TINT = new Float32Array(3);
const LIGHT = new Float32Array(3);

/**
 * Cut [a0, a1] at the multiples of `step` (world-aligned, so that neighbouring and
 * overlapping coplanar faces share the same grid), avoiding slivers near the ends.
 */
function splits(a0: number, a1: number, step: number, out: Float64Array): number {
  let n = 0;
  out[n++] = a0;
  if (step > 0 && a1 - a0 > step * 1.3) {
    let s = step;
    if ((a1 - a0) / s > MAX_CELLS - 2) s = (a1 - a0) / (MAX_CELLS - 2);
    const gap = s * 0.3;
    let k = Math.ceil((a0 + gap) / s);
    for (let c = k * s; c < a1 - gap && n < MAX_CELLS; c = ++k * s) out[n++] = c;
  }
  out[n++] = a1;
  return n;
}

/**
 * Append the triangles of one face to a writer.
 * Vertex colour = tint × light (vertex-lit), tint only (emissive or light-mapped).
 */
export function emitBoxFace(w: GeometryWriter, face: BoxFace, opts: FaceEmitOptions): void {
  const info = materialInfo(face.mat);
  const lit = !info.emissive && face.lm === null;
  const tile = info.tile ?? 1;
  const nu = splits(face.u0, face.u1, lit ? opts.subdivide : 0, US);
  const nv = splits(face.v0, face.v1, lit ? opts.subdivide : 0, VS);

  hexToLinear(face.tint, TINT);
  N[0] = N[1] = N[2] = 0;
  N[face.axis] = face.sign;
  P[face.axis] = face.plane;

  w.reserve(nu * nv, (nu - 1) * (nv - 1) * 6);
  const base = w.vertexCount;
  const lm = face.lm;
  const neutral = opts.neutralLightmapUv;

  for (let j = 0; j < nv; j++) {
    const cv = VS[j]!;
    P[face.vAxis] = cv;
    const t = faceParamT(face, cv);
    for (let i = 0; i < nu; i++) {
      const cu = US[i]!;
      P[face.uAxis] = cu;
      const s = faceParamS(face, cu);

      let u: number;
      let v: number;
      if (face.uvMode === 'world') {
        u = (face.uSign * cu) / tile;
        v = (face.vSign * cv) / tile;
      } else if (face.uvMode === 'fit') {
        u = s * face.repU;
        v = t * face.repV;
      } else {
        u = 0.004 + s * 0.012;
        v = 0.004 + t * 0.012;
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
      const vi = w.vertex(P[0], P[1], P[2], u, v, r, g, b);
      if (lm) w.setUv1(vi, lm.x + s * lm.w, lm.y + t * lm.h);
      else if (neutral) w.setUv1(vi, neutral[0], neutral[1]);
    }
  }

  // Rows / columns ascend in world coordinates; the winding depends on the frame handedness.
  const ccw = face.uSign * face.vSign > 0;
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = base + j * nu + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = a + nu;
      // Same world diagonal (a-c) whatever the facing: coplanar faces triangulate alike.
      if (ccw) w.quad(a, b, c, d);
      else w.quad(a, d, c, b);
    }
  }
}
