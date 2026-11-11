/**
 * Light-map baker: MapData (+ CollisionWorld for the shadow rays) -> one RGBA atlas and
 * an atlas rectangle per light-mapped box face. Pure TypeScript — no DOM, no THREE — so
 * it runs under Node (tests/lightbake.test.ts) and, time-sliced, in the browser.
 *
 *   const baked = bakeLightmap(map, world, { quality: 'high' });              // synchronous
 *   const baked = await bakeLightmapAsync(map, world, { quality }, onProgress); // yields every ~12 ms
 *
 * What gets a rectangle: every visible record (see faces.ts) of a non-detail box whose
 * material is opaque and not emissive, except faces lying on the outer hull of the map and
 * looking outward (never seen from the playable space). Everything else — detail boxes,
 * prims, transparent faces, signs — is lit per vertex by `baked.shader`, which uses the
 * same lighting model (lightmodel.ts).
 *
 * Luxel grid. Luxels sit on a WORLD-ALIGNED grid (multiples of the luxel size along the
 * two axes of the face plane), sampled 1.5 cm in front of the surface. A record stores the
 * grid columns from the one at or before its first edge to the one at or after its last
 * edge, so bilinear filtering inside a record never leaves its own block, and two records
 * that meet in a plane (floor slabs side by side, a wall cut around a doorway) sample the
 * very same world points along their seam: the lighting is continuous across records.
 * One more ring of luxels is computed around the stored block for the blur, then replaced
 * by a copy of the edge luxels (gutter).
 *
 * Per luxel: point lights (one shadow ray; four jittered rays where neighbouring luxels
 * disagree, i.e. in penumbrae), sun (same scheme), ambient occlusion + visible share of
 * the sky (hemisphere rays, four interleaved patterns resolved by the blur), floor bounce.
 * Luxels hidden inside another opaque box (the floor under a wall) are filled from their
 * neighbours; luxels inside an invisible collider (under a desk) get a contact shadow.
 * The result is blurred 3 × 3 inside each block (never across a wall standing on the
 * face), tone-mapped, dithered and stored sRGB-encoded with a range of 0..LIGHTMAP_RANGE.
 */
import { materialInfo } from '../../../shared/maps/materials';
import type { MapData } from '../../../shared/maps/types';
import type { CollisionWorld } from '../../../shared/physics/world';
import { packRects } from './atlas';
import { collectBoxFaces, faceParamS, faceParamT, type BoxFace, type LightmapRect } from './faces';
import { hexToLinear, linearToSrgb, pointFalloff, srgbToLinear, type SurfaceShader } from './lightmath';
import { ESCAPE_NONE, ESCAPE_SELF, HEMI_PHASES, LightModel, NORMAL_PUSH, POINT_WRAP, toneMapLight } from './lightmodel';

export type BakeQuality = 'low' | 'medium' | 'high';

/** Light value of a texel at 255: the atlas stores light / LIGHTMAP_RANGE, sRGB-encoded. */
export const LIGHTMAP_RANGE = 2;

interface QualitySettings {
  /** Luxels per metre. */
  density: number;
  /** Hemisphere rays per luxel for ambient occlusion and sky visibility (0 = none). */
  aoRays: number;
  /** Jittered shadow rays in penumbrae. */
  soft: boolean;
}

const QUALITY: Record<BakeQuality, QualitySettings> = {
  high: { density: 4, aoRays: 12, soft: true },
  medium: { density: 3, aoRays: 8, soft: true },
  low: { density: 2, aoRays: 0, soft: false },
};

/** Stored luxels per side of a block: at least 2, at most 256. */
const MIN_SIDE = 2;
const MAX_SIDE = 256;
/** Largest atlas side; above it the density is lowered for the whole map. */
const MAX_ATLAS = 4096;
/** Ambient-occlusion radius (m), strength, and how much of it also dims direct light. */
const AO_RADIUS = 2.5;
const AO_STRENGTH = 0.85;
const AO_MIN = 0.3;
const AO_DIRECT = 0.35;
/** Ambient occlusion assumed inside the bulk of an invisible collider (under furniture). */
const BULK_AO = 0.5;
/** Rays pointing less than this above the horizon do not count as "sky" rays. */
const SKY_MIN_Y = 0.03;
/** Contributions below this are not worth a shadow ray. */
const MIN_CONTRIBUTION = 0.004;
/** Rays between two progress reports / time checks. */
const RAY_BUDGET = 2500;

const F_VALID = 1;
const F_BULK = 2;
const F_BAR_U = 4;
const F_BAR_V = 8;
const F_SELF = 16;
const F_FILLED = 32;

export interface BakeOptions {
  quality?: BakeQuality;
  /** Luxels per metre (default: from the quality level). */
  density?: number;
  /** Largest atlas side (default 4096). */
  maxAtlasSize?: number;
  /** Skip the in-memory cache (tests, timing). */
  noCache?: boolean;
}

export interface BakeStats {
  /** Visible box-face records / records with a lightmap block. */
  faces: number;
  lightmapped: number;
  /** Luxels computed (blocks including their gutter ring). */
  luxels: number;
  rays: number;
  /** Luxels per metre actually used (lower than requested if the atlas was full). */
  density: number;
  /** Wall-clock time of the bake (ms), excluding time spent yielding. */
  ms: number;
  shadowed: boolean;
}

export interface BakeResult {
  /** Atlas size (texels) and RGBA pixels (sRGB-encoded light / LIGHTMAP_RANGE, alpha 255). */
  width: number;
  height: number;
  data: Uint8Array;
  /** Visible box-face records, in collectBoxFaces() order; `lm` is set on the baked ones. */
  faces: BoxFace[];
  /** Per record: its rectangle in atlas UV space (what BoxFace.lm holds), or null. */
  rects: (LightmapRect | null)[];
  /** Per record: x, y, w, h of its texel block including the 1-texel gutter (-1 = none). */
  blocks: Int32Array;
  /** Atlas UV of a texel holding exactly 1.0: for geometry that is lit per vertex. */
  neutralUv: [number, number];
  /** Value for material.lightMapIntensity (MeshBasicMaterial applies texel × intensity / PI). */
  intensity: number;
  /** Lighting model of the map: light probes (`sample`) and bounce data. */
  model: LightModel;
  /** Per-vertex lighting of everything that is not light-mapped (remembers its results). */
  shader: VertexShader;
  stats: BakeStats;
}

/**
 * Per-vertex lighting with a replay log: the geometry of a map is emitted in a fixed
 * order, so when the same map is loaded again the logged values are returned without
 * casting a single ray. Call begin() before each geometry build.
 */
export class VertexShader implements SurfaceShader {
  private readonly model: LightModel;
  /** Per entry: x, y, z, nx, ny, nz, r, g, b. */
  private log = new Float32Array(9 * 1024);
  private count = 0;
  private cursor = 0;

  constructor(model: LightModel) {
    this.model = model;
  }

  begin(): void {
    this.cursor = 0;
  }

  shade(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: Float32Array): void {
    const o = this.cursor * 9;
    let log = this.log;
    if (this.cursor < this.count) {
      if (
        log[o] === Math.fround(x) &&
        log[o + 1] === Math.fround(y) &&
        log[o + 2] === Math.fround(z) &&
        log[o + 3] === Math.fround(nx) &&
        log[o + 4] === Math.fround(ny) &&
        log[o + 5] === Math.fround(nz)
      ) {
        out[0] = log[o + 6]!;
        out[1] = log[o + 7]!;
        out[2] = log[o + 8]!;
        this.cursor++;
        return;
      }
      this.count = this.cursor; // the sequence changed: forget the rest of the log
    }
    this.model.shade(x, y, z, nx, ny, nz, out);
    if (o + 9 > log.length) {
      const next = new Float32Array(log.length * 2);
      next.set(log);
      this.log = log = next;
    }
    log[o] = x;
    log[o + 1] = y;
    log[o + 2] = z;
    log[o + 3] = nx;
    log[o + 4] = ny;
    log[o + 5] = nz;
    log[o + 6] = out[0]!;
    log[o + 7] = out[1]!;
    log[o + 8] = out[2]!;
    this.cursor++;
    this.count = this.cursor;
  }
}

/** Layout of one light-mapped record. */
interface Block {
  /** Index of the record in `faces`. */
  face: number;
  /** Luxel size (m) along U and V. */
  su: number;
  sv: number;
  /** World luxel indices of the first / last STORED column and row. */
  i0: number;
  i1: number;
  j0: number;
  j1: number;
  /** Size of the computed block = stored + 2 (the gutter ring). */
  cw: number;
  ch: number;
  /** Atlas position of the block (gutter included) and offset in the luxel arrays. */
  x: number;
  y: number;
  off: number;
}

const comp = (v: { x: number; y: number; z: number }, a: number): number => (a === 0 ? v.x : a === 1 ? v.y : v.z);

/** World luxel index of column `a` (0 = gutter column) of a block, along U. */
const worldI = (f: BoxFace, bl: Block, a: number): number => (f.uSign > 0 ? bl.i0 - 1 + a : bl.i1 + 1 - a);
const worldJ = (f: BoxFace, bl: Block, b: number): number => (f.vSign > 0 ? bl.j0 - 1 + b : bl.j1 + 1 - b);

/** Should this record get a lightmap block? */
function isLightmapped(face: BoxFace, map: MapData): boolean {
  if (face.detail) return false;
  const info = materialInfo(face.mat);
  if (info.emissive || info.transparent) return false;
  // Faces on the outer hull of the map looking outward (and the underside of the world)
  // can only be seen from outside the playable space: per-vertex lighting is plenty.
  const b = map.bounds;
  const E = 1e-3;
  if (face.axis === 0) {
    if (face.sign > 0 ? face.plane >= b.max.x - E : face.plane <= b.min.x + E) return false;
  } else if (face.axis === 2) {
    if (face.sign > 0 ? face.plane >= b.max.z - E : face.plane <= b.min.z + E) return false;
  } else if (face.sign < 0 && face.plane <= b.min.y + E) {
    return false;
  }
  return true;
}

function layoutBlock(face: BoxFace, index: number, luxel: number): Block {
  let su = luxel;
  let sv = luxel;
  let i0 = 0;
  let i1 = 0;
  let j0 = 0;
  let j1 = 0;
  for (;;) {
    i0 = Math.floor(face.u0 / su + 1e-6);
    i1 = Math.ceil(face.u1 / su - 1e-6);
    if (i1 - i0 + 1 <= MAX_SIDE) break;
    su *= 2;
  }
  for (;;) {
    j0 = Math.floor(face.v0 / sv + 1e-6);
    j1 = Math.ceil(face.v1 / sv - 1e-6);
    if (j1 - j0 + 1 <= MAX_SIDE) break;
    sv *= 2;
  }
  if (i1 - i0 + 1 < MIN_SIDE) i1 = i0 + MIN_SIDE - 1;
  if (j1 - j0 + 1 < MIN_SIDE) j1 = j0 + MIN_SIDE - 1;
  return { face: index, su, sv, i0, i1, j0, j1, cw: i1 - i0 + 3, ch: j1 - j0 + 3, x: 0, y: 0, off: 0 };
}

/** Integer hash -> [0, 1). */
function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The bake as a generator: yields a progress fraction (0..1) every few thousand rays and
 * returns the result. Drive it to completion synchronously or in time slices.
 */
function* bakeSteps(map: MapData, world: CollisionWorld | null, opts: BakeOptions): Generator<number, BakeResult, void> {
  const started = now();
  const quality = opts.quality ?? 'high';
  const q = QUALITY[quality];
  const maxAtlas = Math.max(64, Math.min(MAX_ATLAS, opts.maxAtlasSize ?? MAX_ATLAS));
  const model = new LightModel(map, world);
  model.resetBounce();
  const faces = collectBoxFaces(map.boxes);
  for (const f of faces) f.lm = null;

  // --- Layout: blocks, atlas ---------------------------------------------------------
  const picked: number[] = [];
  for (let i = 0; i < faces.length; i++) if (isLightmapped(faces[i]!, map)) picked.push(i);

  let density = Math.max(0.25, opts.density ?? q.density);
  let blocks: Block[] = [];
  let atlasW = 4;
  let atlasH = 4;
  let neutralX = 0;
  let neutralY = 0;
  for (;;) {
    blocks = picked.map((i) => layoutBlock(faces[i]!, i, 1 / density));
    const n = blocks.length;
    const ws = new Int32Array(n + 1);
    const hs = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) {
      ws[i] = blocks[i]!.cw;
      hs[i] = blocks[i]!.ch;
    }
    ws[n] = 4; // neutral block: 2 × 2 texels of 1.0 plus gutter
    hs[n] = 4;
    const packed = packRects(ws, hs, n + 1, maxAtlas);
    if (packed) {
      atlasW = packed.width;
      atlasH = packed.height;
      for (let i = 0; i < n; i++) {
        blocks[i]!.x = packed.pos[i * 2]!;
        blocks[i]!.y = packed.pos[i * 2 + 1]!;
      }
      neutralX = packed.pos[n * 2]!;
      neutralY = packed.pos[n * 2 + 1]!;
      break;
    }
    density *= 0.8;
    if (density < 0.2) throw new Error('Lightmap: the map does not fit in the atlas');
  }

  let total = 0;
  let maxLuxels = 1;
  for (const bl of blocks) {
    bl.off = total;
    const n = bl.cw * bl.ch;
    total += n;
    if (n > maxLuxels) maxLuxels = n;
  }

  // --- Buffers --------------------------------------------------------------------------
  const direct = new Float32Array(total * 3);
  const aoArr = new Float32Array(total);
  const skyArr = new Float32Array(total);
  const flags = new Uint8Array(total);
  // Per-block scratch.
  const gArr = new Float32Array(maxLuxels);
  const cR = new Float32Array(maxLuxels);
  const cG = new Float32Array(maxLuxels);
  const cB = new Float32Array(maxLuxels);
  const wR = new Float32Array(maxLuxels);
  const wG = new Float32Array(maxLuxels);
  const wB = new Float32Array(maxLuxels);
  const tR = new Float32Array(maxLuxels);
  const tG = new Float32Array(maxLuxels);
  const tB = new Float32Array(maxLuxels);
  const cuA = new Float64Array(MAX_SIDE + 2);
  const cvA = new Float64Array(MAX_SIDE + 2);
  const P: [number, number, number] = [0, 0, 0];
  const candidates: number[] = [];
  const faceLights: number[] = [];
  const amb = new Float32Array(3);
  const albedo = new Float32Array(3);
  const tint = new Float32Array(3);
  const pending: number[] = [];
  const fillSrc: number[] = [];

  const shadowed = model.world !== null;
  const aoRays = shadowed ? q.aoRays : 0;
  const soft = shadowed && q.soft;
  const L = model.lights;
  const LS = model.lightSamples;
  let lastRays = 0;
  let doneLuxels = 0;
  const progressA = (): number => 0.02 + 0.9 * (total > 0 ? doneLuxels / total : 1);

  // =======================================================================================
  // Phase A: direct light, ambient occlusion and sky visibility of every block
  // =======================================================================================
  for (let bi = 0; bi < blocks.length; bi++) {
    const bl = blocks[bi]!;
    const f = faces[bl.face]!;
    const box = map.boxes[f.box]!;
    const { cw, ch, off } = bl;
    const n = cw * ch;
    const axis = f.axis;
    const uAxis = f.uAxis;
    const vAxis = f.vAxis;
    const sign = f.sign;
    const nx = axis === 0 ? sign : 0;
    const ny = axis === 1 ? sign : 0;
    const nz = axis === 2 ? sign : 0;
    const planeP = f.plane + sign * NORMAL_PUSH;
    P[axis] = planeP;
    for (let a = 0; a < cw; a++) cuA[a] = worldI(f, bl, a) * bl.su;
    for (let b = 0; b < ch; b++) cvA[b] = worldJ(f, bl, b) * bl.sv;
    const uMin = Math.min(cuA[0]!, cuA[cw - 1]!);
    const uMax = Math.max(cuA[0]!, cuA[cw - 1]!);
    const vMin = Math.min(cvA[0]!, cvA[ch - 1]!);
    const vMax = Math.max(cvA[0]!, cvA[ch - 1]!);
    flags.fill(F_VALID, off, off + n);

    // --- 1. Luxels hidden inside another opaque box; walls standing on the face ---
    {
      const grid = model.opaqueBoxes;
      if (axis === 0) grid.queryRect(planeP, uMin, planeP, uMax, candidates);
      else if (axis === 2) grid.queryRect(uMin, planeP, uMax, planeP, candidates);
      else grid.queryRect(uMin, vMin, uMax, vMax, candidates);
      const EPS = 1e-3;
      for (let c = 0; c < candidates.length; c++) {
        const j = candidates[c]!;
        if (j === f.box) continue;
        const other = map.boxes[j]!;
        const lo = comp(other.min, axis);
        const hi = comp(other.max, axis);
        if (!(lo < planeP && hi > planeP)) continue;
        // Extent of the other box in luxel coordinates of this block.
        const ua0 = f.uSign > 0 ? comp(other.min, uAxis) / bl.su - (bl.i0 - 1) : bl.i1 + 1 - comp(other.max, uAxis) / bl.su;
        const ua1 = f.uSign > 0 ? comp(other.max, uAxis) / bl.su - (bl.i0 - 1) : bl.i1 + 1 - comp(other.min, uAxis) / bl.su;
        const vb0 = f.vSign > 0 ? comp(other.min, vAxis) / bl.sv - (bl.j0 - 1) : bl.j1 + 1 - comp(other.max, vAxis) / bl.sv;
        const vb1 = f.vSign > 0 ? comp(other.max, vAxis) / bl.sv - (bl.j0 - 1) : bl.j1 + 1 - comp(other.min, vAxis) / bl.sv;
        if (ua1 <= EPS || vb1 <= EPS || ua0 >= cw - 1 - EPS || vb0 >= ch - 1 - EPS) continue;
        // Luxels strictly inside.
        const aS = Math.max(0, Math.floor(ua0 + EPS) + 1);
        const aE = Math.min(cw - 1, Math.ceil(ua1 - EPS) - 1);
        const bS = Math.max(0, Math.floor(vb0 + EPS) + 1);
        const bE = Math.min(ch - 1, Math.ceil(vb1 - EPS) - 1);
        for (let b = bS; b <= bE; b++) {
          const row = off + b * cw;
          for (let a = aS; a <= aE; a++) flags[row + a]! &= ~F_VALID;
        }
        // Tall boxes (walls, cupboards) also stop the blur from mixing their two sides.
        const rise = sign > 0 ? hi - f.plane : f.plane - lo;
        if (other.detail || rise < 0.4) continue;
        const laS = Math.max(0, Math.floor(ua0 + EPS));
        const laE = Math.min(cw - 2, Math.ceil(ua1 - EPS) - 1);
        for (let b = bS; b <= bE; b++) {
          const row = off + b * cw;
          for (let a = laS; a <= laE; a++) flags[row + a]! |= F_BAR_U;
        }
        const lbS = Math.max(0, Math.floor(vb0 + EPS));
        const lbE = Math.min(ch - 2, Math.ceil(vb1 - EPS) - 1);
        for (let b = lbS; b <= lbE; b++) {
          const row = off + b * cw;
          for (let a = aS; a <= aE; a++) flags[row + a]! |= F_BAR_V;
        }
      }
    }

    // --- 2. Luxels inside colliders: own bulk collider (escape it) or someone else's ---
    if (shadowed) {
      model.beginSelf((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2);
      for (let b = 0; b < ch; b++) {
        P[vAxis] = cvA[b]!;
        for (let a = 0; a < cw; a++) {
          const k = off + b * cw + a;
          if (!(flags[k]! & F_VALID)) continue;
          P[uAxis] = cuA[a]!;
          const cls = model.classifyPoint(P[0], P[1], P[2]);
          if (cls === 2) flags[k]! |= F_BULK;
          else if (cls === 1) flags[k]! |= F_SELF;
        }
      }
    }

    // --- 3. Ambient occlusion and sky visibility ---
    const hemi = aoRays > 0 ? model.hemisphere(axis * 2 + (sign < 0 ? 1 : 0), aoRays) : null;
    for (let b = 0; b < ch; b++) {
      P[vAxis] = cvA[b]!;
      const gj = worldJ(f, bl, b);
      for (let a = 0; a < cw; a++) {
        const k = off + b * cw + a;
        const fl = flags[k]!;
        aoArr[k] = 1;
        skyArr[k] = 0;
        if (!(fl & F_VALID) || fl & F_BULK) continue;
        P[uAxis] = cuA[a]!;
        const px = P[0];
        const py = P[1];
        const pz = P[2];
        if (hemi) {
          const dirs = hemi[(worldI(f, bl, a) & 1) | ((gj & 1) << 1)]!;
          const escape = fl & F_SELF ? ESCAPE_SELF : ESCAPE_NONE;
          let occ = 0;
          let seen = 0;
          let up = 0;
          for (let r = 0; r < aoRays; r++) {
            const dx = dirs[r * 3]!;
            const dy = dirs[r * 3 + 1]!;
            const dz = dirs[r * 3 + 2]!;
            const toSky = dy > SKY_MIN_Y;
            if (toSky) up++;
            if (model.trace(px, py, pz, dx, dy, dz, toSky ? model.far : AO_RADIUS, escape)) {
              if (toSky) seen += (model.tR + model.tG + model.tB) / 3;
            } else if (model.hitDist < AO_RADIUS) {
              const t = 1 - model.hitDist / AO_RADIUS;
              occ += t * t;
            }
          }
          aoArr[k] = Math.max(AO_MIN, 1 - (AO_STRENGTH * occ) / aoRays);
          skyArr[k] = up > 0 ? seen / up : 0;
        } else if (ny > -0.5) {
          // No hemisphere rays (low quality / no collision world): smoothed probe estimate.
          skyArr[k] = shadowed
            ? model.skyVisibility(px + nx * 0.3, py + ny * 0.3, pz + nz * 0.3)
            : model.coveredAbove(px + nx * 0.3, py, pz + nz * 0.3)
              ? 0
              : 1;
        }
      }
      if (model.rays - lastRays > RAY_BUDGET) {
        lastRays = model.rays;
        yield progressA();
      }
    }

    // --- 4. Point lights ---
    faceLights.length = 0;
    for (let li = 0; li < model.lightCount; li++) {
      const o = li * 7;
      const side = sign * ((axis === 0 ? L[o]! : axis === 1 ? L[o + 1]! : L[o + 2]!) - f.plane);
      if (side <= 0.02) continue;
      const lu = uAxis === 0 ? L[o]! : uAxis === 1 ? L[o + 1]! : L[o + 2]!;
      const lv = vAxis === 0 ? L[o]! : vAxis === 1 ? L[o + 1]! : L[o + 2]!;
      const du = lu < uMin ? uMin - lu : lu > uMax ? lu - uMax : 0;
      const dv = lv < vMin ? vMin - lv : lv > vMax ? lv - vMax : 0;
      const range = L[o + 3]!;
      if (side * side + du * du + dv * dv >= range * range) continue;
      faceLights.push(li);
    }
    for (let fi = 0; fi < faceLights.length; fi++) {
      const li = faceLights[fi]!;
      const o = li * 7;
      const lx = L[o]!;
      const ly = L[o + 1]!;
      const lz = L[o + 2]!;
      const range = L[o + 3]!;
      const lr = L[o + 4]!;
      const lg = L[o + 5]!;
      const lb = L[o + 6]!;
      const strongest = Math.max(lr, lg, lb);
      const buried = model.isLightBuried(li);
      const side = sign * ((axis === 0 ? lx : axis === 1 ? ly : lz) - planeP);
      let any = false;

      // Geometric term and one shadow ray toward the centre of the light.
      for (let b = 0; b < ch; b++) {
        P[vAxis] = cvA[b]!;
        for (let a = 0; a < cw; a++) {
          const kl = b * cw + a;
          const fl = flags[off + kl]!;
          let g = 0;
          if (fl & F_VALID && !(fl & F_BULK)) {
            P[uAxis] = cuA[a]!;
            const dx = lx - P[0];
            const dy = ly - P[1];
            const dz = lz - P[2];
            const d2 = dx * dx + dy * dy + dz * dz;
            const fall = pointFalloff(d2, range);
            if (fall > 0) {
              const lambert = (side / Math.sqrt(d2) + POINT_WRAP) / (1 + POINT_WRAP);
              g = fall * lambert;
              if (g * strongest < MIN_CONTRIBUTION) g = 0;
            }
            if (g > 0) {
              any = true;
              if (buried || model.traceTo(P[0], P[1], P[2], lx, ly, lz, fl & F_SELF ? ESCAPE_SELF : ESCAPE_NONE)) {
                cR[kl] = model.tR;
                cG[kl] = model.tG;
                cB[kl] = model.tB;
              } else {
                cR[kl] = cG[kl] = cB[kl] = 0;
              }
            }
          }
          gArr[kl] = g;
        }
        if (model.rays - lastRays > RAY_BUDGET) {
          lastRays = model.rays;
          yield progressA();
        }
      }
      if (!any) continue;

      // Penumbrae (luxels whose neighbourhood disagrees) get four jittered rays instead.
      for (let b = 0; b < ch; b++) {
        P[vAxis] = cvA[b]!;
        const gj = worldJ(f, bl, b);
        const b0 = b > 1 ? b - 2 : 0;
        const b1 = b < ch - 2 ? b + 2 : ch - 1;
        for (let a = 0; a < cw; a++) {
          const kl = b * cw + a;
          const g = gArr[kl]!;
          if (g === 0) continue;
          let vr = cR[kl]!;
          let vg = cG[kl]!;
          let vb = cB[kl]!;
          if (soft && !buried) {
            const c0 = vr + vg + vb;
            let edge = false;
            const a0 = a > 1 ? a - 2 : 0;
            const a1 = a < cw - 2 ? a + 2 : cw - 1;
            for (let bb = b0; bb <= b1 && !edge; bb++) {
              for (let aa = a0; aa <= a1; aa++) {
                const k2 = bb * cw + aa;
                if (gArr[k2]! > 0 && Math.abs(cR[k2]! + cG[k2]! + cB[k2]! - c0) > 0.1) {
                  edge = true;
                  break;
                }
              }
            }
            if (edge) {
              P[uAxis] = cuA[a]!;
              const escape = flags[off + kl]! & F_SELF ? ESCAPE_SELF : ESCAPE_NONE;
              const s0 = li * 24 + (((worldI(f, bl, a) + gj) & 1) ? 12 : 0);
              vr = vg = vb = 0;
              for (let s = 0; s < 4; s++) {
                const so = s0 + s * 3;
                if (model.traceTo(P[0], P[1], P[2], LS[so]!, LS[so + 1]!, LS[so + 2]!, escape)) {
                  vr += model.tR;
                  vg += model.tG;
                  vb += model.tB;
                }
              }
              vr *= 0.25;
              vg *= 0.25;
              vb *= 0.25;
            }
          }
          if (vr + vg + vb === 0) continue;
          const k = off + kl;
          const scale = g * model.lightScale(skyArr[k]!);
          direct[k * 3]! += lr * scale * vr;
          direct[k * 3 + 1]! += lg * scale * vg;
          direct[k * 3 + 2]! += lb * scale * vb;
        }
        if (model.rays - lastRays > RAY_BUDGET) {
          lastRays = model.rays;
          yield progressA();
        }
      }
    }

    // --- 5. Sun ---
    const sunDot = nx * model.sunX + ny * model.sunY + nz * model.sunZ;
    if (model.hasSun && sunDot > 0.001) {
      const SD = model.sunDirs;
      for (let b = 0; b < ch; b++) {
        P[vAxis] = cvA[b]!;
        for (let a = 0; a < cw; a++) {
          const kl = b * cw + a;
          const fl = flags[off + kl]!;
          if (!(fl & F_VALID) || fl & F_BULK) {
            gArr[kl] = 0;
            continue;
          }
          gArr[kl] = 1;
          P[uAxis] = cuA[a]!;
          if (model.sunVisible(P[0], P[1], P[2], fl & F_SELF ? ESCAPE_SELF : ESCAPE_NONE)) {
            cR[kl] = model.tR;
            cG[kl] = model.tG;
            cB[kl] = model.tB;
          } else {
            cR[kl] = cG[kl] = cB[kl] = 0;
          }
        }
        if (model.rays - lastRays > RAY_BUDGET) {
          lastRays = model.rays;
          yield progressA();
        }
      }
      for (let b = 0; b < ch; b++) {
        P[vAxis] = cvA[b]!;
        const gj = worldJ(f, bl, b);
        const b0 = b > 1 ? b - 2 : 0;
        const b1 = b < ch - 2 ? b + 2 : ch - 1;
        for (let a = 0; a < cw; a++) {
          const kl = b * cw + a;
          if (gArr[kl] === 0) continue;
          let vr = cR[kl]!;
          let vg = cG[kl]!;
          let vb = cB[kl]!;
          if (soft) {
            const c0 = vr + vg + vb;
            let edge = false;
            const a0 = a > 1 ? a - 2 : 0;
            const a1 = a < cw - 2 ? a + 2 : cw - 1;
            for (let bb = b0; bb <= b1 && !edge; bb++) {
              for (let aa = a0; aa <= a1; aa++) {
                const k2 = bb * cw + aa;
                if (gArr[k2]! > 0 && Math.abs(cR[k2]! + cG[k2]! + cB[k2]! - c0) > 0.1) {
                  edge = true;
                  break;
                }
              }
            }
            if (edge) {
              P[uAxis] = cuA[a]!;
              const escape = flags[off + kl]! & F_SELF ? ESCAPE_SELF : ESCAPE_NONE;
              const s0 = ((worldI(f, bl, a) + gj) & 1) ? 12 : 0;
              vr = vg = vb = 0;
              for (let s = 0; s < 4; s++) {
                const so = s0 + s * 3;
                if (model.trace(P[0], P[1], P[2], SD[so]!, SD[so + 1]!, SD[so + 2]!, model.far, escape)) {
                  vr += model.tR;
                  vg += model.tG;
                  vb += model.tB;
                }
              }
              vr *= 0.25;
              vg *= 0.25;
              vb *= 0.25;
            }
          }
          if (vr + vg + vb === 0) continue;
          const k = off + kl;
          direct[k * 3]! += model.sun[0]! * sunDot * vr;
          direct[k * 3 + 1]! += model.sun[1]! * sunDot * vg;
          direct[k * 3 + 2]! += model.sun[2]! * sunDot * vb;
        }
        if (model.rays - lastRays > RAY_BUDGET) {
          lastRays = model.rays;
          yield progressA();
        }
      }
    }

    // --- 6. Light leaving upward faces feeds the bounce grid ---
    if (axis === 1 && sign > 0) {
      hexToLinear(materialInfo(f.mat).color, albedo);
      hexToLinear(f.tint, tint);
      const ar = albedo[0]! * tint[0]!;
      const ag = albedo[1]! * tint[1]!;
      const ab = albedo[2]! * tint[2]!;
      for (let b = 1; b < ch - 1; b++) {
        const cv = cvA[b]!;
        const hv = Math.min(f.v1, cv + bl.sv / 2) - Math.max(f.v0, cv - bl.sv / 2);
        if (hv <= 0) continue;
        for (let a = 1; a < cw - 1; a++) {
          const k = off + b * cw + a;
          const fl = flags[k]!;
          if (!(fl & F_VALID) || fl & F_BULK) continue;
          const cu = cuA[a]!;
          const hu = Math.min(f.u1, cu + bl.su / 2) - Math.max(f.u0, cu - bl.su / 2);
          if (hu <= 0) continue;
          const r = direct[k * 3]!;
          const g = direct[k * 3 + 1]!;
          const bb = direct[k * 3 + 2]!;
          if (r + g + bb <= 0) continue;
          P[uAxis] = cu;
          P[vAxis] = cv;
          model.splatBounce(P[0], f.plane, P[2], r, g, bb, ar, ag, ab, hu * hv);
        }
      }
    }

    doneLuxels += n;
    yield progressA();
  }

  // =======================================================================================
  // Phase B: ambient + bounce, blur, dilation, encoding
  // =======================================================================================
  const data = new Uint8Array(atlasW * atlasH * 4);
  const neutralByte = Math.round(linearToSrgb(1 / LIGHTMAP_RANGE) * 255);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = neutralByte;
    data[i + 3] = 255;
  }
  const rects: (LightmapRect | null)[] = new Array<LightmapRect | null>(faces.length).fill(null);
  const blockInfo = new Int32Array(faces.length * 4).fill(-1);

  for (let bi = 0; bi < blocks.length; bi++) {
    const bl = blocks[bi]!;
    const f = faces[bl.face]!;
    const { cw, ch, off } = bl;
    const n = cw * ch;
    const axis = f.axis;
    const uAxis = f.uAxis;
    const vAxis = f.vAxis;
    const sign = f.sign;
    const nx = axis === 0 ? sign : 0;
    const ny = axis === 1 ? sign : 0;
    const nz = axis === 2 ? sign : 0;
    P[axis] = f.plane + sign * NORMAL_PUSH;
    for (let a = 0; a < cw; a++) cuA[a] = worldI(f, bl, a) * bl.su;
    for (let b = 0; b < ch; b++) cvA[b] = worldJ(f, bl, b) * bl.sv;

    // --- Combine ---
    model.ambient(ny, 0, amb);
    const bulkR = amb[0]! * BULK_AO;
    const bulkG = amb[1]! * BULK_AO;
    const bulkB = amb[2]! * BULK_AO;
    for (let b = 0; b < ch; b++) {
      P[vAxis] = cvA[b]!;
      for (let a = 0; a < cw; a++) {
        const kl = b * cw + a;
        const k = off + kl;
        const fl = flags[k]!;
        if (!(fl & F_VALID)) {
          wR[kl] = wG[kl] = wB[kl] = 0;
          continue;
        }
        if (fl & F_BULK) {
          wR[kl] = bulkR;
          wG[kl] = bulkG;
          wB[kl] = bulkB;
          continue;
        }
        P[uAxis] = cuA[a]!;
        const ao = aoArr[k]!;
        const aoD = 1 - AO_DIRECT * (1 - ao);
        model.ambient(ny, skyArr[k]!, amb);
        const bounce = model.bounce(P[0], P[1], P[2], nx, ny, nz);
        wR[kl] = direct[k * 3]! * aoD + (amb[0]! + bounce[0]!) * ao;
        wG[kl] = direct[k * 3 + 1]! * aoD + (amb[1]! + bounce[1]!) * ao;
        wB[kl] = direct[k * 3 + 2]! * aoD + (amb[2]! + bounce[2]!) * ao;
      }
    }

    // --- Blur: [1 2 1] along U then along V, among visible luxels, never across a wall ---
    for (let b = 0; b < ch; b++) {
      for (let a = 0; a < cw; a++) {
        const kl = b * cw + a;
        const k = off + kl;
        if (!(flags[k]! & F_VALID)) continue;
        let r = wR[kl]! * 2;
        let g = wG[kl]! * 2;
        let bb = wB[kl]! * 2;
        let w = 2;
        if (a > 0 && flags[k - 1]! & F_VALID && !(flags[k - 1]! & F_BAR_U)) {
          r += wR[kl - 1]!;
          g += wG[kl - 1]!;
          bb += wB[kl - 1]!;
          w++;
        }
        if (a < cw - 1 && flags[k + 1]! & F_VALID && !(flags[k]! & F_BAR_U)) {
          r += wR[kl + 1]!;
          g += wG[kl + 1]!;
          bb += wB[kl + 1]!;
          w++;
        }
        tR[kl] = r / w;
        tG[kl] = g / w;
        tB[kl] = bb / w;
      }
    }
    for (let b = 0; b < ch; b++) {
      for (let a = 0; a < cw; a++) {
        const kl = b * cw + a;
        const k = off + kl;
        if (!(flags[k]! & F_VALID)) continue;
        let r = tR[kl]! * 2;
        let g = tG[kl]! * 2;
        let bb = tB[kl]! * 2;
        let w = 2;
        if (b > 0 && flags[k - cw]! & F_VALID && !(flags[k - cw]! & F_BAR_V)) {
          r += tR[kl - cw]!;
          g += tG[kl - cw]!;
          bb += tB[kl - cw]!;
          w++;
        }
        if (b < ch - 1 && flags[k + cw]! & F_VALID && !(flags[k]! & F_BAR_V)) {
          r += tR[kl + cw]!;
          g += tG[kl + cw]!;
          bb += tB[kl + cw]!;
          w++;
        }
        wR[kl] = r / w;
        wG[kl] = g / w;
        wB[kl] = bb / w;
      }
    }

    // --- Dilation: hidden luxels take the darkest lit neighbour (no bright seams) ---
    pending.length = 0;
    for (let kl = 0; kl < n; kl++) if (!(flags[off + kl]! & F_VALID)) pending.push(kl);
    while (pending.length > 0) {
      fillSrc.length = 0;
      let filled = 0;
      for (let p = 0; p < pending.length; p++) {
        const kl = pending[p]!;
        const a = kl % cw;
        const b = (kl - a) / cw;
        let best = -1;
        let bestL = Infinity;
        if (a > 0 && flags[off + kl - 1]! & (F_VALID | F_FILLED)) {
          const l = wR[kl - 1]! + wG[kl - 1]! + wB[kl - 1]!;
          if (l < bestL) {
            bestL = l;
            best = kl - 1;
          }
        }
        if (a < cw - 1 && flags[off + kl + 1]! & (F_VALID | F_FILLED)) {
          const l = wR[kl + 1]! + wG[kl + 1]! + wB[kl + 1]!;
          if (l < bestL) {
            bestL = l;
            best = kl + 1;
          }
        }
        if (b > 0 && flags[off + kl - cw]! & (F_VALID | F_FILLED)) {
          const l = wR[kl - cw]! + wG[kl - cw]! + wB[kl - cw]!;
          if (l < bestL) {
            bestL = l;
            best = kl - cw;
          }
        }
        if (b < ch - 1 && flags[off + kl + cw]! & (F_VALID | F_FILLED)) {
          const l = wR[kl + cw]! + wG[kl + cw]! + wB[kl + cw]!;
          if (l < bestL) {
            bestL = l;
            best = kl + cw;
          }
        }
        fillSrc.push(best);
        if (best >= 0) filled++;
      }
      if (filled === 0) {
        // Nothing visible in this block (or an enclosed pocket): neutral dim ambient.
        for (let p = 0; p < pending.length; p++) {
          const kl = pending[p]!;
          wR[kl] = bulkR;
          wG[kl] = bulkG;
          wB[kl] = bulkB;
        }
        break;
      }
      // Apply the whole ring at once, then keep what is still unfilled.
      let w = 0;
      for (let p = 0; p < pending.length; p++) {
        const kl = pending[p]!;
        const src = fillSrc[p]!;
        if (src >= 0) {
          tR[kl] = wR[src]!;
          tG[kl] = wG[src]!;
          tB[kl] = wB[src]!;
        }
      }
      for (let p = 0; p < pending.length; p++) {
        const kl = pending[p]!;
        if (fillSrc[p]! >= 0) {
          wR[kl] = tR[kl]!;
          wG[kl] = tG[kl]!;
          wB[kl] = tB[kl]!;
          flags[off + kl]! |= F_FILLED;
        } else {
          pending[w++] = kl;
        }
      }
      pending.length = w;
    }

    // --- Encode the stored luxels, then replicate the edges into the gutter ---
    for (let b = 1; b < ch - 1; b++) {
      const ty = bl.y + b;
      for (let a = 1; a < cw - 1; a++) {
        const kl = b * cw + a;
        const tx = bl.x + a;
        const noise = (hash2(tx, ty) + hash2(tx + 57, ty + 113) - 1) * 0.5;
        const o = (ty * atlasW + tx) * 4;
        const r = linearToSrgb(toneMapLight(wR[kl]!) / LIGHTMAP_RANGE) * 255 + noise;
        const g = linearToSrgb(toneMapLight(wG[kl]!) / LIGHTMAP_RANGE) * 255 + noise;
        const bb = linearToSrgb(toneMapLight(wB[kl]!) / LIGHTMAP_RANGE) * 255 + noise;
        data[o] = r < 0 ? 0 : r > 255 ? 255 : Math.round(r);
        data[o + 1] = g < 0 ? 0 : g > 255 ? 255 : Math.round(g);
        data[o + 2] = bb < 0 ? 0 : bb > 255 ? 255 : Math.round(bb);
      }
    }
    for (let b = 0; b < ch; b++) {
      const sb = b < 1 ? 1 : b > ch - 2 ? ch - 2 : b;
      for (let a = 0; a < cw; a++) {
        if (b > 0 && b < ch - 1 && a > 0 && a < cw - 1) continue;
        const sa = a < 1 ? 1 : a > cw - 2 ? cw - 2 : a;
        const src = ((bl.y + sb) * atlasW + bl.x + sa) * 4;
        const dst = ((bl.y + b) * atlasW + bl.x + a) * 4;
        data[dst] = data[src]!;
        data[dst + 1] = data[src + 1]!;
        data[dst + 2] = data[src + 2]!;
      }
    }

    // --- Atlas rectangle of the record (maps its (s, t) parameters to atlas UVs) ---
    const offU = f.uSign > 0 ? f.u0 / bl.su - bl.i0 : bl.i1 - f.u1 / bl.su;
    const offV = f.vSign > 0 ? f.v0 / bl.sv - bl.j0 : bl.j1 - f.v1 / bl.sv;
    const rect: LightmapRect = {
      x: (bl.x + 1.5 + offU) / atlasW,
      y: (bl.y + 1.5 + offV) / atlasH,
      w: (f.u1 - f.u0) / bl.su / atlasW,
      h: (f.v1 - f.v0) / bl.sv / atlasH,
    };
    rects[bl.face] = rect;
    f.lm = rect;
    blockInfo[bl.face * 4] = bl.x;
    blockInfo[bl.face * 4 + 1] = bl.y;
    blockInfo[bl.face * 4 + 2] = cw;
    blockInfo[bl.face * 4 + 3] = ch;

    if ((bi & 15) === 15) yield 0.92 + (0.08 * bi) / blocks.length;
  }

  // Probes computed during the bake (low quality) predate the bounce data: start afresh.
  model.resetProbes();

  const stats: BakeStats = {
    faces: faces.length,
    lightmapped: blocks.length,
    luxels: total,
    rays: model.rays,
    density,
    ms: now() - started,
    shadowed,
  };
  return {
    width: atlasW,
    height: atlasH,
    data,
    faces,
    rects,
    blocks: blockInfo,
    neutralUv: [(neutralX + 2) / atlasW, (neutralY + 2) / atlasH],
    intensity: LIGHTMAP_RANGE * Math.PI,
    model,
    shader: new VertexShader(model),
    stats,
  };
}

// --- Cache: one result per (map, quality, shadowed) -----------------------------------------

const CACHE = new WeakMap<MapData, Map<string, BakeResult>>();

function cacheKey(world: CollisionWorld | null, opts: BakeOptions): string {
  return `${opts.quality ?? 'high'}|${opts.density ?? 0}|${opts.maxAtlasSize ?? 0}|${world ? 1 : 0}`;
}

function remember(map: MapData, key: string, result: BakeResult): void {
  let perMap = CACHE.get(map);
  if (!perMap) CACHE.set(map, (perMap = new Map()));
  perMap.set(key, result);
}

/** Drop the cached bakes of a map (or nothing if it has none). */
export function clearBakeCache(map: MapData): void {
  CACHE.delete(map);
}

/** Bake synchronously (blocks until done). Results are cached per map object and quality. */
export function bakeLightmap(map: MapData, world: CollisionWorld | null, opts: BakeOptions = {}): BakeResult {
  const key = cacheKey(world, opts);
  if (!opts.noCache) {
    const hit = CACHE.get(map)?.get(key);
    if (hit) return hit;
  }
  const steps = bakeSteps(map, world, opts);
  for (;;) {
    const step = steps.next();
    if (step.done) {
      if (!opts.noCache) remember(map, key, step.value);
      return step.value;
    }
  }
}

/** Give the event loop a turn (rendering, input) without the 4 ms clamp of nested timers. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(0);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Bake in time slices of about `sliceMs` (default 12 ms), reporting progress (0..1) before
 * each pause. `shouldCancel` is polled at every pause; when it returns true the promise
 * resolves with null. Results are cached per map object and quality: a second call returns at once.
 */
export async function bakeLightmapAsync(
  map: MapData,
  world: CollisionWorld | null,
  opts: BakeOptions = {},
  onProgress?: (fraction: number) => void,
  shouldCancel?: () => boolean,
  sliceMs = 12,
): Promise<BakeResult | null> {
  const key = cacheKey(world, opts);
  if (!opts.noCache) {
    const hit = CACHE.get(map)?.get(key);
    if (hit) {
      onProgress?.(1);
      return hit;
    }
  }
  const steps = bakeSteps(map, world, opts);
  let sliceStart = now();
  let paused = 0;
  for (;;) {
    const step = steps.next();
    if (step.done) {
      step.value.stats.ms -= paused;
      if (!opts.noCache) remember(map, key, step.value);
      onProgress?.(1);
      return step.value;
    }
    const t = now();
    if (t - sliceStart >= sliceMs) {
      onProgress?.(step.value);
      await yieldToEventLoop();
      if (shouldCancel?.()) return null;
      sliceStart = now();
      paused += sliceStart - t;
    }
  }
}

// --- Reading the atlas back (tests, debugging) ---------------------------------------------

/** Index of the first record of face `name` of box `box`, or -1. */
export function findFaceRecord(result: BakeResult, box: number, name: BoxFace['name']): number {
  for (let i = 0; i < result.faces.length; i++) {
    const f = result.faces[i]!;
    if (f.box === box && f.name === name) return i;
  }
  return -1;
}

/**
 * Baked light (linear RGB, 1.0 = authored brightness) of a light-mapped record at a world
 * position on its plane, filtered bilinearly like the GPU does. Returns null if the record
 * has no lightmap.
 */
export function lightmapLightAt(result: BakeResult, record: number, x: number, y: number, z: number): [number, number, number] | null {
  const f = result.faces[record];
  const lm = f ? result.rects[record] : null;
  if (!f || !lm) return null;
  const p = { x, y, z };
  const s = Math.min(1, Math.max(0, faceParamS(f, comp(p, f.uAxis))));
  const t = Math.min(1, Math.max(0, faceParamT(f, comp(p, f.vAxis))));
  const fx = (lm.x + s * lm.w) * result.width - 0.5;
  const fy = (lm.y + t * lm.h) * result.height - 0.5;
  const x0 = Math.max(0, Math.min(result.width - 1, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(result.height - 1, Math.floor(fy)));
  const x1 = Math.min(result.width - 1, x0 + 1);
  const y1 = Math.min(result.height - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0));
  const ty = Math.min(1, Math.max(0, fy - y0));
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const at = (px: number, py: number): number => srgbToLinear(result.data[(py * result.width + px) * 4 + c]! / 255) * LIGHTMAP_RANGE;
    out[c] = (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
  }
  return out;
}
