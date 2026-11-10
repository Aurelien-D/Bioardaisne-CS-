/**
 * MapBuilder: small DSL used by map files to produce a MapData.
 *
 * Coordinates: Y up, metres. A local transform stack (translation + quarter turns
 * around Y) lets props be authored once in local space and placed anywhere while
 * every collider stays axis-aligned.
 *
 * Higher-level helpers (walls with door openings, rooms, stairs, props…) live in
 * maps/helpers.ts and maps/props/*.ts and are built on top of these primitives.
 */
import type { Vec3 } from '../math/vec3';
import { MATERIALS, type MaterialId, type SurfaceType } from './materials';
import type {
  BoxPrim,
  EnvDef,
  FaceName,
  LightDef,
  MapData,
  MapMeta,
  PointDef,
  Prim,
  PrimShape,
  SignDef,
  Solid,
  SpawnDef,
  ZoneDef,
} from './types';

export interface BoxOpts {
  tint?: number;
  faces?: Partial<Record<FaceName, MaterialId | null>>;
  /** Detail geometry: not light-mapped (vertex-lit). Use for small prop parts. */
  detail?: boolean;
  /** Create a collider (default true). */
  solid?: boolean;
  /** Override the collider surface type (default: from the material). */
  surf?: SurfaceType;
  noBullets?: boolean;
}

export interface PrimOpts {
  rot?: Vec3;
  tint?: number;
  seg?: number;
  /** Add an axis-aligned collider around the primitive's bounding box (rotation ignored). */
  collide?: boolean;
}

export const DEFAULT_ENV: EnvDef = {
  skyTop: 0x5d8fc9,
  skyHorizon: 0xc9dcec,
  sunDir: { x: 0.45, y: 0.8, z: 0.4 },
  sunColor: 0xfff1d6,
  sunIntensity: 1,
  ambientSky: 0xbcd4f0,
  ambientGround: 0x6a6258,
  ambientIntensity: 0.45,
  fogColor: 0xc9dcec,
  fogNear: 60,
  fogFar: 220,
};

interface Xf {
  x: number;
  y: number;
  z: number;
  /** Quarter turns around Y (0..3), counter-clockwise seen from above. */
  q: number;
}

const FACE_ROT: FaceName[] = ['pz', 'px', 'nz', 'nx']; // index = facing (0=+Z, 1=+X, 2=-Z, 3=-X)

export class MapBuilder {
  readonly meta: MapMeta;
  readonly env: EnvDef;
  readonly solids: Solid[] = [];
  readonly boxes: BoxPrim[] = [];
  readonly prims: Prim[] = [];
  readonly lights: LightDef[] = [];
  readonly signs: SignDef[] = [];
  readonly spawns: SpawnDef[] = [];
  readonly zones: ZoneDef[] = [];
  readonly points: PointDef[] = [];
  killY = -20;

  private stack: Xf[] = [];
  private cur: Xf = { x: 0, y: 0, z: 0, q: 0 };

  constructor(meta: MapMeta, env: Partial<EnvDef> = {}) {
    this.meta = meta;
    this.env = { ...DEFAULT_ENV, ...env };
  }

  // --- Transform stack ---------------------------------------------------------

  /** Enter a local frame placed at (x, y, z) and rotated by `quarterTurns` × 90° around Y. */
  push(x: number, y: number, z: number, quarterTurns = 0): this {
    this.stack.push(this.cur);
    const o = this.pt(x, y, z);
    this.cur = { x: o.x, y: o.y, z: o.z, q: (((this.cur.q + quarterTurns) % 4) + 4) % 4 };
    return this;
  }

  pop(): this {
    const p = this.stack.pop();
    if (!p) throw new Error('MapBuilder.pop(): transform stack is empty');
    this.cur = p;
    return this;
  }

  /** Run `fn` inside a local frame. */
  at(x: number, y: number, z: number, quarterTurns: number, fn: (b: this) => void): this {
    this.push(x, y, z, quarterTurns);
    try {
      fn(this);
    } finally {
      this.pop();
    }
    return this;
  }

  /** Local point -> world point. */
  pt(x: number, y: number, z: number): Vec3 {
    const { q } = this.cur;
    let wx = x;
    let wz = z;
    if (q === 1) {
      wx = z;
      wz = -x;
    } else if (q === 2) {
      wx = -x;
      wz = -z;
    } else if (q === 3) {
      wx = -z;
      wz = x;
    }
    return { x: this.cur.x + wx, y: this.cur.y + y, z: this.cur.z + wz };
  }

  /** Current accumulated quarter turns. */
  get quarter(): number {
    return this.cur.q;
  }

  private aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): { min: Vec3; max: Vec3 } {
    const a = this.pt(x0, y0, z0);
    const b = this.pt(x1, y1, z1);
    return {
      min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
      max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
    };
  }

  private rotFaces(
    faces: Partial<Record<FaceName, MaterialId | null>> | undefined,
  ): Partial<Record<FaceName, MaterialId | null>> | undefined {
    if (!faces || this.cur.q === 0) return faces;
    const out: Partial<Record<FaceName, MaterialId | null>> = {};
    for (const k of Object.keys(faces) as FaceName[]) {
      const i = FACE_ROT.indexOf(k);
      const nk = i < 0 ? k : FACE_ROT[(i + this.cur.q) % 4]!;
      out[nk] = faces[k];
    }
    return out;
  }

  // --- Geometry ------------------------------------------------------------------

  /**
   * Visible axis-aligned box between two opposite corners (any order), solid by default.
   * This is the basic building block for floors, walls, ceilings and furniture.
   */
  box(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    mat: MaterialId,
    opts: BoxOpts = {},
  ): this {
    const { min, max } = this.aabb(x0, y0, z0, x1, y1, z1);
    if (max.x - min.x < 1e-6 || max.y - min.y < 1e-6 || max.z - min.z < 1e-6) {
      throw new Error(`MapBuilder.box(): degenerate box in map ${this.meta.id} (${[x0, y0, z0, x1, y1, z1].join(', ')})`);
    }
    const b: BoxPrim = { min, max, mat };
    if (opts.tint !== undefined) b.tint = opts.tint;
    const faces = this.rotFaces(opts.faces);
    if (faces) b.faces = faces;
    if (opts.detail) b.detail = true;
    this.boxes.push(b);
    if (opts.solid !== false) {
      const s: Solid = { min: { ...min }, max: { ...max }, surf: opts.surf ?? MATERIALS[mat].surf };
      if (opts.noBullets) s.noBullets = true;
      this.solids.push(s);
    }
    return this;
  }

  /** Invisible collider ("clip brush"). */
  collider(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    surf: SurfaceType = 'concrete',
    opts: { noBullets?: boolean; noPlayers?: boolean } = {},
  ): this {
    const { min, max } = this.aabb(x0, y0, z0, x1, y1, z1);
    const s: Solid = { min, max, surf };
    if (opts.noBullets) s.noBullets = true;
    if (opts.noPlayers) s.noPlayers = true;
    this.solids.push(s);
    return this;
  }

  /** Decorative primitive centred on (cx, cy, cz) with local size (sx, sy, sz). See maps/types.ts `Prim`. */
  prim(
    shape: PrimShape,
    cx: number,
    cy: number,
    cz: number,
    sx: number,
    sy: number,
    sz: number,
    mat: MaterialId,
    opts: PrimOpts = {},
  ): this {
    const pos = this.pt(cx, cy, cz);
    const rot = { x: opts.rot?.x ?? 0, y: (opts.rot?.y ?? 0) + (this.cur.q * Math.PI) / 2, z: opts.rot?.z ?? 0 };
    const p: Prim = { shape, pos, size: { x: sx, y: sy, z: sz }, mat };
    if (rot.x !== 0 || rot.y !== 0 || rot.z !== 0) p.rot = rot;
    if (opts.tint !== undefined) p.tint = opts.tint;
    if (opts.seg !== undefined) p.seg = opts.seg;
    this.prims.push(p);
    if (opts.collide) {
      this.collider(cx - sx / 2, cy - sy / 2, cz - sz / 2, cx + sx / 2, cy + sy / 2, cz + sz / 2, MATERIALS[mat].surf);
    }
    return this;
  }

  // --- Lights, signs, gameplay ------------------------------------------------------

  light(x: number, y: number, z: number, color = 0xffffff, intensity = 1, range = 9): this {
    this.lights.push({ pos: this.pt(x, y, z), color, intensity, range });
    return this;
  }

  /** Text panel. `facing` is in local space (0 = +Z, 1 = +X, 2 = -Z, 3 = -X, 4 = up, 5 = down). */
  sign(def: Omit<SignDef, 'pos'> & { x: number; y: number; z: number }): this {
    const { x, y, z, ...rest } = def;
    const facing = rest.facing < 4 ? (rest.facing + this.cur.q) % 4 : rest.facing;
    this.signs.push({ ...rest, facing, pos: this.pt(x, y, z) });
    return this;
  }

  /** Spawn point; `yawDeg` in degrees, 0 = facing -Z, 90 = facing -X (turning left). */
  spawn(team: 0 | 1, x: number, y: number, z: number, yawDeg = 0): this {
    this.spawns.push({ team, pos: this.pt(x, y, z), yaw: (yawDeg * Math.PI) / 180 + (this.cur.q * Math.PI) / 2 });
    return this;
  }

  zone(
    kind: ZoneDef['kind'],
    id: string,
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    label?: string,
  ): this {
    const { min, max } = this.aabb(x0, y0, z0, x1, y1, z1);
    const zdef: ZoneDef = { kind, id, min, max };
    if (label) zdef.label = label;
    this.zones.push(zdef);
    return this;
  }

  point(kind: PointDef['kind'], id: string, x: number, y: number, z: number, label?: string): this {
    const p: PointDef = { kind, id, pos: this.pt(x, y, z) };
    if (label) p.label = label;
    this.points.push(p);
    return this;
  }

  // --- Output ----------------------------------------------------------------------

  build(): MapData {
    if (this.stack.length) throw new Error(`MapBuilder.build(): unbalanced push/pop in map ${this.meta.id}`);
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    const grow = (a: Vec3, b: Vec3): void => {
      min.x = Math.min(min.x, a.x);
      min.y = Math.min(min.y, a.y);
      min.z = Math.min(min.z, a.z);
      max.x = Math.max(max.x, b.x);
      max.y = Math.max(max.y, b.y);
      max.z = Math.max(max.z, b.z);
    };
    for (const s of this.solids) grow(s.min, s.max);
    for (const b of this.boxes) grow(b.min, b.max);
    if (!Number.isFinite(min.x)) throw new Error(`MapBuilder.build(): map ${this.meta.id} is empty`);
    const len = Math.hypot(this.env.sunDir.x, this.env.sunDir.y, this.env.sunDir.z) || 1;
    return {
      meta: this.meta,
      bounds: { min, max },
      solids: this.solids,
      boxes: this.boxes,
      prims: this.prims,
      lights: this.lights,
      signs: this.signs,
      spawns: this.spawns,
      zones: this.zones,
      points: this.points,
      env: {
        ...this.env,
        sunDir: { x: this.env.sunDir.x / len, y: this.env.sunDir.y / len, z: this.env.sunDir.z / len },
      },
      killY: Math.min(this.killY, min.y - 5),
    };
  }
}
