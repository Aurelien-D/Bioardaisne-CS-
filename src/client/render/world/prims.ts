/**
 * Geometry of the decorative primitives (maps/types.ts `Prim`): box, cyl, sphere, cone,
 * prism, pyramid, wedge. Every shape is centred on `pos` (bounding-box centre), sized by
 * `size`, rotated by `rot` (Euler YXZ) and appended to a GeometryWriter with baked
 * vertex lighting (tint × shader.shade at each vertex, or tint only for emissive materials).
 *
 * UVs: one repeat per MATERIALS[mat].tile metres, measured on the surface (object space):
 * planar on flat faces (U along the bottom edge, V up the face), wrapped an integer number
 * of times around round shapes.
 */
import * as THREE from 'three';
import { materialInfo } from '../../../shared/maps/materials';
import type { Prim } from '../../../shared/maps/types';
import type { GeometryWriter } from './geom';
import { hexToLinear, type SurfaceShader } from './lightmath';

type V3 = readonly [number, number, number];

const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const matrix = new THREE.Matrix4();
const tmpP = new THREE.Vector3();
const tmpN = new THREE.Vector3();
const TINT = new Float32Array(3);
const LIGHT = new Float32Array(3);

/** State of the primitive being emitted (module-level: emission is synchronous). */
let W: GeometryWriter;
let SHADER: SurfaceShader;
let LIT = true;
let TILE = 1;
let NEUTRAL: readonly [number, number] | undefined;

/** Append one vertex given in the primitive's local space. */
function vert(lx: number, ly: number, lz: number, nx: number, ny: number, nz: number, u: number, v: number): number {
  tmpP.set(lx, ly, lz).applyMatrix4(matrix);
  let r = TINT[0]!;
  let g = TINT[1]!;
  let b = TINT[2]!;
  if (LIT) {
    tmpN.set(nx, ny, nz).transformDirection(matrix);
    SHADER.shade(tmpP.x, tmpP.y, tmpP.z, tmpN.x, tmpN.y, tmpN.z, LIGHT);
    r *= LIGHT[0]!;
    g *= LIGHT[1]!;
    b *= LIGHT[2]!;
  }
  W.reserve(1, 0);
  const i = W.vertex(tmpP.x, tmpP.y, tmpP.z, u, v, r, g, b);
  if (NEUTRAL) W.setUv1(i, NEUTRAL[0], NEUTRAL[1]);
  return i;
}

/**
 * Flat polygon (3 or 4 corners, counter-clockwise seen from outside, starting bottom-left).
 * UVs are planar: U along the first edge, V perpendicular to it in the face plane.
 */
function flat(a: V3, b: V3, c: V3, d?: V3): void {
  const e1x = b[0] - a[0];
  const e1y = b[1] - a[1];
  const e1z = b[2] - a[2];
  const e2x = c[0] - a[0];
  const e2y = c[1] - a[1];
  const e2z = c[2] - a[2];
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nl = Math.hypot(nx, ny, nz);
  const el = Math.hypot(e1x, e1y, e1z);
  if (nl < 1e-10 || el < 1e-10) return; // degenerate
  nx /= nl;
  ny /= nl;
  nz /= nl;
  const ux = e1x / el;
  const uy = e1y / el;
  const uz = e1z / el;
  // V = N × U
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;
  const corner = (p: V3): number => {
    const px = p[0] - a[0];
    const py = p[1] - a[1];
    const pz = p[2] - a[2];
    return vert(p[0], p[1], p[2], nx, ny, nz, (px * ux + py * uy + pz * uz) / TILE, (px * vx + py * vy + pz * vz) / TILE);
  };
  const ia = corner(a);
  const ib = corner(b);
  const ic = corner(c);
  W.reserve(0, 6);
  W.tri(ia, ib, ic);
  if (d) W.tri(ia, ic, corner(d));
}

function emitBox(hx: number, hy: number, hz: number): void {
  flat([hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]); // +X
  flat([-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]); // -X
  flat([-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]); // +Z
  flat([hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]); // -Z
  flat([-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]); // +Y
  flat([-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]); // -Y
}

/** Approximate perimeter of an ellipse (Ramanujan). */
function ellipsePerimeter(rx: number, rz: number): number {
  const h = ((rx - rz) * (rx - rz)) / ((rx + rz) * (rx + rz) || 1);
  return Math.PI * (rx + rz) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Disc cap at height y (fan), facing up (dir = 1) or down (dir = -1). */
function emitCap(rx: number, rz: number, y: number, seg: number, dir: 1 | -1): void {
  const centre = vert(0, y, 0, 0, dir, 0, 0, 0);
  let prev = -1;
  let first = -1;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const z = Math.sin(a) * rz;
    const cur = vert(x, y, z, 0, dir, 0, x / TILE, (-dir * z) / TILE);
    if (i === 0) first = cur;
    else {
      W.reserve(0, 3);
      if (dir > 0) W.tri(centre, cur, prev);
      else W.tri(centre, prev, cur);
    }
    prev = cur;
  }
  W.reserve(0, 3);
  if (dir > 0) W.tri(centre, first, prev);
  else W.tri(centre, prev, first);
}

function emitCylinder(rx: number, hy: number, rz: number, seg: number): void {
  const reps = Math.max(1, Math.round(ellipsePerimeter(rx, rz) / TILE));
  const vTop = (2 * hy) / TILE;
  let pb = -1;
  let pt = -1;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Normal of an ellipse: gradient of x²/rx² + z²/rz².
    let nx = c / rx;
    let nz = s / rz;
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl;
    nz /= nl;
    const u = -(i / seg) * reps;
    const b = vert(c * rx, -hy, s * rz, nx, 0, nz, u, 0);
    const t = vert(c * rx, hy, s * rz, nx, 0, nz, u, vTop);
    if (i > 0) {
      W.reserve(0, 6);
      W.quad(pb, pt, t, b);
    }
    pb = b;
    pt = t;
  }
  emitCap(rx, rz, hy, seg, 1);
  emitCap(rx, rz, -hy, seg, -1);
}

function emitCone(rx: number, hy: number, rz: number, seg: number): void {
  const reps = Math.max(1, Math.round(ellipsePerimeter(rx, rz) / TILE));
  const slant = Math.hypot((rx + rz) * 0.5, 2 * hy);
  const normalAt = (a: number, out: number[]): void => {
    let nx = Math.cos(a) / rx;
    let ny = 1 / (2 * hy);
    let nz = Math.sin(a) / rz;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    out[0] = nx;
    out[1] = ny;
    out[2] = nz;
  };
  const n = [0, 1, 0];
  let prev = -1;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    normalAt(a, n);
    const base = vert(Math.cos(a) * rx, -hy, Math.sin(a) * rz, n[0]!, n[1]!, n[2]!, -(i / seg) * reps, 0);
    if (i > 0) {
      normalAt(((i - 0.5) / seg) * Math.PI * 2, n);
      const apex = vert(0, hy, 0, n[0]!, n[1]!, n[2]!, -((i - 0.5) / seg) * reps, slant / TILE);
      W.reserve(0, 3);
      W.tri(prev, apex, base);
    }
    prev = base;
  }
  emitCap(rx, rz, -hy, seg, -1);
}

function emitSphere(rx: number, ry: number, rz: number, seg: number): void {
  const rings = Math.max(3, Math.round(seg / 2));
  const repsU = Math.max(1, Math.round(ellipsePerimeter(rx, rz) / TILE));
  const repsV = Math.max(1, Math.round(ellipsePerimeter((rx + rz) * 0.5, ry) / 2 / TILE));
  const stride = seg + 1;
  const first = W.vertexCount;
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      const x = sp * Math.cos(th);
      const z = sp * Math.sin(th);
      let nx = x / rx;
      let ny = cp / ry;
      let nz = z / rz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      vert(x * rx, cp * ry, z * rz, nx, ny, nz, -(i / seg) * repsU, (1 - j / rings) * repsV);
    }
  }
  W.reserve(0, rings * seg * 6);
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const t0 = first + j * stride + i;
      const t1 = t0 + 1;
      const b0 = t0 + stride;
      const b1 = b0 + 1;
      if (j > 0) W.tri(b0, t0, t1);
      if (j < rings - 1) W.tri(b0, t1, b1);
    }
  }
}

/** Gable roof: ridge along local Z at the top. */
function emitPrism(hx: number, hy: number, hz: number): void {
  const A: V3 = [-hx, -hy, -hz];
  const B: V3 = [hx, -hy, -hz];
  const C: V3 = [hx, -hy, hz];
  const D: V3 = [-hx, -hy, hz];
  const R0: V3 = [0, hy, -hz];
  const R1: V3 = [0, hy, hz];
  flat(C, B, R0, R1); // slope facing +X
  flat(A, D, R1, R0); // slope facing -X
  flat(D, C, R1); // gable +Z
  flat(B, A, R0); // gable -Z
  flat(A, B, C, D); // underside
}

/** Hip roof / pavilion: apex above the centre of the base. */
function emitPyramid(hx: number, hy: number, hz: number): void {
  const A: V3 = [-hx, -hy, -hz];
  const B: V3 = [hx, -hy, -hz];
  const C: V3 = [hx, -hy, hz];
  const D: V3 = [-hx, -hy, hz];
  const P: V3 = [0, hy, 0];
  flat(C, B, P);
  flat(A, D, P);
  flat(D, C, P);
  flat(B, A, P);
  flat(A, B, C, D);
}

/** Ramp rising along +Z from the base (z = -hz) to the full height (z = +hz). */
function emitWedge(hx: number, hy: number, hz: number): void {
  const A: V3 = [-hx, -hy, -hz];
  const B: V3 = [hx, -hy, -hz];
  const C: V3 = [hx, -hy, hz];
  const D: V3 = [-hx, -hy, hz];
  const E: V3 = [hx, hy, hz];
  const F: V3 = [-hx, hy, hz];
  flat(B, A, F, E); // slope
  flat(D, C, E, F); // back (+Z)
  flat(C, B, E); // side +X
  flat(A, D, F); // side -X
  flat(A, B, C, D); // underside
}

/** Append one primitive to `w`. */
export function emitPrim(
  w: GeometryWriter,
  prim: Prim,
  shader: SurfaceShader,
  neutralLightmapUv?: readonly [number, number],
): void {
  const info = materialInfo(prim.mat);
  W = w;
  SHADER = shader;
  LIT = !info.emissive;
  TILE = info.tile ?? 1;
  NEUTRAL = neutralLightmapUv;
  hexToLinear(prim.tint ?? 0xffffff, TINT);
  euler.set(prim.rot?.x ?? 0, prim.rot?.y ?? 0, prim.rot?.z ?? 0, 'YXZ');
  matrix.makeRotationFromEuler(euler);
  matrix.setPosition(prim.pos.x, prim.pos.y, prim.pos.z);

  const hx = Math.max(prim.size.x, 1e-4) * 0.5;
  const hy = Math.max(prim.size.y, 1e-4) * 0.5;
  const hz = Math.max(prim.size.z, 1e-4) * 0.5;
  const seg = Math.max(3, Math.min(64, Math.round(prim.seg ?? 12)));

  switch (prim.shape) {
    case 'box':
      emitBox(hx, hy, hz);
      break;
    case 'cyl':
      emitCylinder(hx, hy, hz, seg);
      break;
    case 'sphere':
      emitSphere(hx, hy, hz, seg);
      break;
    case 'cone':
      emitCone(hx, hy, hz, seg);
      break;
    case 'prism':
      emitPrism(hx, hy, hz);
      break;
    case 'pyramid':
      emitPyramid(hx, hy, hz);
      break;
    case 'wedge':
      emitWedge(hx, hy, hz);
      break;
  }
}
