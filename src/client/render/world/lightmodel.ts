/**
 * Lighting model of a map: everything the light-map baker (bake.ts), the per-vertex
 * shader (prims, detail boxes, signs) and the light probes of dynamic objects have in
 * common. Pure TypeScript: no DOM, no THREE (runs under Node for the unit tests).
 *
 *   light = point lights  (smooth falloff, slightly wrapped Lambert, shadow rays, dimmed in daylight)
 *         + sun           (Lambert, shadow rays toward the sky)
 *         + ambient       (sky part scaled by the visible share of the sky, a neutral "indoor"
 *                          part where the sky is hidden, ground part for downward surfaces)
 *         + bounce        (light landing on floors re-lights the walls / ceilings above)
 *
 * Shadow rays go through CollisionWorld.raycast(MASK.Bullet). Three kinds of solids are
 * told apart once, at construction:
 *  - opaque casters: block light;
 *  - glass (surf 'glass' without an opaque visible box of the same size): light passes,
 *    slightly tinted and attenuated;
 *  - invisible colliders (clip brushes: no visible geometry inside): light passes freely,
 *    so a sealing "sky clip" does not plunge a courtyard into darkness.
 * A ray whose origin lies inside a solid can be allowed to leave it ("escape"): prop
 * parts usually sit inside the bulk collider of their prop.
 *
 * Without a usable CollisionWorld the model degrades to unshadowed lighting (plus a
 * coarse "opaque box overhead" test for the sun and the sky).
 *
 * All light values are linear RGB; 1.0 = the texture at its authored brightness.
 */
import { materialInfo } from '../../../shared/maps/materials';
import type { BoxPrim, MapData, Solid } from '../../../shared/maps/types';
import type { Vec3 } from '../../../shared/math/vec3';
import { MASK, type CollisionWorld, type RayHit } from '../../../shared/physics/world';
import { BoxGrid, type Aabb } from './boxgrid';
import { hexToLinear, pointFalloff, type SurfaceShader } from './lightmath';

// --- Tunables (calibrated by eye on dev_test, dev_kit and the viewer gallery) -----------

/** Overall gains of the three light sources. */
const AMBIENT_GAIN = 1.25;
const SUN_GAIN = 0.95;
const POINT_GAIN = 1.15;
/** Lambert wrap of point lights: surfaces at grazing angles still catch a little light. */
export const POINT_WRAP = 0.15;
/** Radius (m) of the sphere point lights are sampled on for soft shadows. */
const LIGHT_RADIUS = 0.25;
/** Tangent of the angular radius of the sun disc used for soft shadow edges. */
const SUN_SPREAD = 0.045;
/** Ambient where the sky is hidden, as a share of the (desaturated) sky ambient. */
const INDOOR_AMBIENT = 0.5;
const INDOOR_DESATURATION = 0.7;
/** Sunlight bounced off the ground into the lower ambient hemisphere, where the sky is visible. */
const SUN_GROUND_BOUNCE = 0.12;
/** How much point lights fade where daylight dominates (eye adaptation): 0 = not at all. */
const OUTDOOR_DIM = 0.6;
/** Strength of the floor -> wall / ceiling bounce. */
const BOUNCE_GAIN = 0.9;
/** Share of the material colour kept in the bounced light (the rest is neutral grey). */
const BOUNCE_SATURATION = 0.5;
/** Transmission of glass panes (linear RGB). */
const GLASS_TINT: readonly [number, number, number] = [0.8, 0.88, 0.9];
const FROSTED_TINT: readonly [number, number, number] = [0.58, 0.62, 0.64];
/** A non-glass solid casts shadows only if visible geometry fills at least this share of it. */
const MIN_VISUAL_FRACTION = 0.012;

/** Soft shoulder of the tone curve: linear up to KNEE, then compressed toward PEAK. */
const KNEE = 0.85;
export const LIGHT_PEAK = 1.75;
/** Darkest value a surface can take (readability: this is a competitive FPS). */
const MIN_LIGHT = 0.07;

/** Distance (m) sample points are pushed off their surface. */
export const NORMAL_PUSH = 0.015;
const VERTEX_PUSH = 0.02;
/** Cell size (m) of the XZ grid of point lights. */
const LIGHT_CELL = 6;
/** Light-probe lattice spacing (m). */
const PROBE_CELL = 1.5;
const PROBE_CELL_Y = 1.25;
/** Bounce grid: XZ cell size (m) and number of height layers per column. */
const BOUNCE_CELL = 1;
const BOUNCE_LAYERS = 4;

/** Solid kinds. */
export const SOLID_OPAQUE = 0;
export const SOLID_PASS = 1;
export const SOLID_GLASS = 2;
export const SOLID_FROSTED = 3;

/** Ray "escape" modes: which solids containing the ray origin may be left. */
export const ESCAPE_NONE = 0;
/** Solids marked with the current self stamp (the bulk collider a prop part sits in). */
export const ESCAPE_SELF = 1;
/** Any solid containing the origin (vertex lighting of props). */
export const ESCAPE_ANY = 2;

const luma = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Soft tone curve applied to every baked light value (texels and vertices alike). */
export function toneMapLight(v: number): number {
  if (!(v > 0)) v = 0;
  // Smooth lift of the darkest values, then a soft shoulder for the over-bright ones.
  v += MIN_LIGHT * Math.exp(-v / MIN_LIGHT);
  return v <= KNEE ? v : KNEE + (LIGHT_PEAK - KNEE) * (1 - Math.exp(-(v - KNEE) / (LIGHT_PEAK - KNEE)));
}

/** True for boxes that hide whatever is inside them (opaque base material, no hidden / see-through face). */
export function isOpaqueBox(box: BoxPrim): boolean {
  if (materialInfo(box.mat).transparent) return false;
  if (box.faces) {
    for (const k in box.faces) {
      const o = box.faces[k as keyof typeof box.faces];
      if (o === null || (o !== undefined && materialInfo(o).transparent)) return false;
    }
  }
  return true;
}

/** Stratified cosine-weighted hemisphere directions around +Z (local frame), `phases` interleaved sets of `n`. */
function hemisphereSet(n: number, phases: number): Float32Array[] {
  const sets: Float32Array[] = [];
  const golden = 0.6180339887498949;
  for (let p = 0; p < phases; p++) {
    const out = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const u1 = (k + (p + 0.5) / phases) / n;
      const u2 = ((k * phases + p) * golden + 0.37) % 1;
      const r = Math.sqrt(u1);
      const a = u2 * Math.PI * 2;
      out[k * 3] = r * Math.cos(a);
      out[k * 3 + 1] = r * Math.sin(a);
      out[k * 3 + 2] = Math.sqrt(Math.max(0, 1 - u1));
    }
    sets.push(out);
  }
  return sets;
}

/** Number of interleaved ray patterns (2 × 2 luxels; resolved by the 3 × 3 binomial blur). */
export const HEMI_PHASES = 4;

export class LightModel implements SurfaceShader {
  readonly map: MapData;
  /** Collision world used for the rays, or null in unshadowed mode. */
  readonly world: CollisionWorld | null;

  // --- Environment ---
  /** Direction TO the sun (unit). */
  readonly sunX: number;
  readonly sunY: number;
  readonly sunZ: number;
  /** Linear sun colour × intensity; `hasSun` is false on interior-only maps. */
  readonly sun = new Float32Array(3);
  readonly hasSun: boolean;
  readonly sky = new Float32Array(3);
  readonly ground = new Float32Array(3);
  /** Neutral ambient that stands in for bounced light where the sky is hidden. */
  readonly indoor = new Float32Array(3);
  /** Point-light dimming under an open sky (0 on night / interior maps). */
  readonly outdoorDim: number;
  /** Length (m) of a ray "to the sky". */
  readonly far: number;
  /** Jittered sun directions: 2 groups of 4 (x, y, z each). */
  readonly sunDirs = new Float32Array(24);

  // --- Point lights ---
  readonly lightCount: number;
  /** Per light: x, y, z, range, r, g, b (colour × intensity × gain, linear). */
  readonly lights: Float32Array;
  /** Per light: 8 soft-shadow sample positions (x, y, z each), 2 groups of 4. */
  readonly lightSamples: Float32Array;
  /** Lights whose centre is buried in a solid (authoring slip): they are left unshadowed. */
  private readonly lightBuried: Uint8Array;
  private readonly lightCells: (number[] | undefined)[];
  private readonly lgMinX: number;
  private readonly lgMinZ: number;
  private readonly lgNx: number;
  private readonly lgNz: number;

  // --- Solids ---
  /** Kind of every solid (SOLID_*). */
  readonly solidKind: Uint8Array;
  /** Opaque casters, for "which solids contain this point" queries. */
  readonly casters: BoxGrid<Solid>;
  /** Per solid: stamp of the box whose parts may escape it (see beginSelf). */
  readonly selfStamp: Int32Array;
  private stamp = 0;
  /** Opaque visible boxes (hidden-texel test, overhead cover in unshadowed mode). */
  readonly opaqueBoxes: BoxGrid<BoxPrim>;

  // --- Result of the last trace() ---
  /** Transmittance (linear RGB) along the ray; zero when it was blocked. */
  tR = 1;
  tG = 1;
  tB = 1;
  /** Distance to the opaque surface that stopped the ray (Infinity when it got through). */
  hitDist = Infinity;
  /** Number of rays cast so far (statistics). */
  rays = 0;

  // --- Hemisphere ray sets: [orientation 0..5][phase] -> world directions ---
  private hemiCount = 0;
  private hemi: Float32Array[][] = [];

  // --- Light probes (lazy lattice) ---
  private readonly pOx: number;
  private readonly pOy: number;
  private readonly pOz: number;
  private readonly pNx: number;
  private readonly pNy: number;
  private readonly pNz: number;
  private readonly pCell: number;
  /** Per node: r, g, b (omnidirectional light), sky visibility. */
  private readonly probes: Float32Array;
  /** Per node: 0 = not computed, 1 = valid, 2 = inside a solid. */
  private readonly probeState: Uint8Array;
  private readonly probeOut = new Float32Array(4);
  private readonly probeFallback = new Map<number, Float32Array>();

  // --- Bounce grid ---
  private readonly bOx: number;
  private readonly bOz: number;
  private readonly bNx: number;
  private readonly bNz: number;
  private readonly bCell: number;
  private readonly bounceY: Float32Array;
  private readonly bounceRgb: Float32Array;
  private readonly bounceOut = new Float32Array(3);

  // --- Scratch ---
  private readonly rayO: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly rayD: Vec3 = { x: 0, y: 0, z: 0 };
  private readonly amb = new Float32Array(3);

  constructor(map: MapData, world: CollisionWorld | null) {
    this.map = map;
    this.world = usableWorld(world, map);
    const env = map.env;

    // --- Environment ---
    let sx = env.sunDir.x;
    let sy = env.sunDir.y;
    let sz = env.sunDir.z;
    let sl = Math.hypot(sx, sy, sz);
    if (!(sl > 1e-6)) {
      sx = 0.45;
      sy = 0.8;
      sz = 0.4;
      sl = Math.hypot(sx, sy, sz);
    }
    this.sunX = sx / sl;
    this.sunY = sy / sl;
    this.sunZ = sz / sl;
    hexToLinear(env.sunColor, this.sun);
    hexToLinear(env.ambientSky, this.sky);
    hexToLinear(env.ambientGround, this.ground);
    const sunK = Math.max(0, env.sunIntensity) * SUN_GAIN;
    const ambK = Math.max(0, env.ambientIntensity) * AMBIENT_GAIN;
    for (let i = 0; i < 3; i++) {
      this.sun[i]! *= sunK;
      this.sky[i]! *= ambK;
      this.ground[i]! *= ambK;
    }
    this.hasSun = luma(this.sun[0]!, this.sun[1]!, this.sun[2]!) > 1e-4;
    const skyGrey = (this.sky[0]! + this.sky[1]! + this.sky[2]!) / 3;
    for (let i = 0; i < 3; i++) {
      this.indoor[i] = (this.sky[i]! + (skyGrey - this.sky[i]!) * INDOOR_DESATURATION) * INDOOR_AMBIENT;
    }
    const daylight = Math.min(1, (luma(this.sun[0]!, this.sun[1]!, this.sun[2]!) + luma(this.sky[0]!, this.sky[1]!, this.sky[2]!)) / 1.1);
    this.outdoorDim = OUTDOOR_DIM * daylight;
    const b = map.bounds;
    this.far = Math.hypot(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) + 10;
    this.initSunDirs();

    // --- Solids ---
    this.opaqueBoxes = new BoxGrid(map.boxes, (box) => isOpaqueBox(box));
    this.solidKind = classifySolids(map);
    const kinds = this.solidKind;
    this.casters = new BoxGrid(map.solids, (_s, i) => kinds[i] === SOLID_OPAQUE);
    this.selfStamp = new Int32Array(map.solids.length);

    // --- Point lights ---
    const n = map.lights.length;
    this.lightCount = n;
    this.lights = new Float32Array(n * 7);
    this.lightSamples = new Float32Array(n * 24);
    this.lightBuried = new Uint8Array(n);
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    const rgb = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const l = map.lights[i]!;
      hexToLinear(l.color, rgb);
      const o = i * 7;
      const k = Math.max(0, l.intensity) * POINT_GAIN;
      this.lights[o] = l.pos.x;
      this.lights[o + 1] = l.pos.y;
      this.lights[o + 2] = l.pos.z;
      this.lights[o + 3] = Math.max(0.01, l.range);
      this.lights[o + 4] = rgb[0]! * k;
      this.lights[o + 5] = rgb[1]! * k;
      this.lights[o + 6] = rgb[2]! * k;
      minX = Math.min(minX, l.pos.x - l.range);
      maxX = Math.max(maxX, l.pos.x + l.range);
      minZ = Math.min(minZ, l.pos.z - l.range);
      maxZ = Math.max(maxZ, l.pos.z + l.range);
    }
    if (n === 0) {
      minX = minZ = 0;
      maxX = maxZ = 1;
    }
    this.lgMinX = minX;
    this.lgMinZ = minZ;
    this.lgNx = Math.max(1, Math.min(256, Math.ceil((maxX - minX) / LIGHT_CELL)));
    this.lgNz = Math.max(1, Math.min(256, Math.ceil((maxZ - minZ) / LIGHT_CELL)));
    this.lightCells = new Array<number[] | undefined>(this.lgNx * this.lgNz);
    for (let i = 0; i < n; i++) {
      const l = map.lights[i]!;
      const x0 = this.lightCellX(l.pos.x - l.range);
      const x1 = this.lightCellX(l.pos.x + l.range);
      const z0 = this.lightCellZ(l.pos.z - l.range);
      const z1 = this.lightCellZ(l.pos.z + l.range);
      for (let cz = z0; cz <= z1; cz++) {
        for (let cx = x0; cx <= x1; cx++) (this.lightCells[cz * this.lgNx + cx] ??= []).push(i);
      }
    }
    this.initLightSamples();

    // --- Probe lattice: one layer about 1 m above the most common spawn floor ---
    let floorY = 0;
    if (map.spawns.length) {
      const ys = map.spawns.map((s) => s.pos.y).sort((p, q) => p - q);
      floorY = ys[ys.length >> 1]!;
    }
    let cell = PROBE_CELL;
    let cellY = PROBE_CELL_Y;
    for (;;) {
      const nodes =
        (Math.ceil((b.max.x - b.min.x) / cell) + 3) * (Math.ceil((b.max.z - b.min.z) / cell) + 3) * (Math.ceil((b.max.y - b.min.y + 3) / cellY) + 2);
      if (nodes <= 3_000_000) break;
      cell *= 1.3;
      cellY *= 1.15;
    }
    this.pCell = cell;
    this.pOx = b.min.x - cell;
    this.pOz = b.min.z - cell;
    const layer0 = floorY + 1;
    this.pOy = layer0 - Math.ceil((layer0 - b.min.y) / cellY) * cellY;
    this.pNx = Math.ceil((b.max.x - b.min.x) / cell) + 3;
    this.pNz = Math.ceil((b.max.z - b.min.z) / cell) + 3;
    this.pNy = Math.ceil((b.max.y + 3 - this.pOy) / cellY) + 1;
    this.probeCellY = cellY;
    this.probes = new Float32Array(this.pNx * this.pNy * this.pNz * 4);
    this.probeState = new Uint8Array(this.pNx * this.pNy * this.pNz);

    // --- Bounce grid ---
    let bc = BOUNCE_CELL;
    while ((Math.ceil((b.max.x - b.min.x) / bc) + 2) * (Math.ceil((b.max.z - b.min.z) / bc) + 2) > 1_500_000) bc *= 1.5;
    this.bCell = bc;
    this.bOx = b.min.x - bc;
    this.bOz = b.min.z - bc;
    this.bNx = Math.ceil((b.max.x - b.min.x) / bc) + 2;
    this.bNz = Math.ceil((b.max.z - b.min.z) / bc) + 2;
    this.bounceY = new Float32Array(this.bNx * this.bNz * BOUNCE_LAYERS).fill(NaN);
    this.bounceRgb = new Float32Array(this.bNx * this.bNz * BOUNCE_LAYERS * 3);
  }

  private readonly probeCellY: number;

  private lightCellX(x: number): number {
    const c = Math.floor((x - this.lgMinX) / LIGHT_CELL);
    return c < 0 ? 0 : c >= this.lgNx ? this.lgNx - 1 : c;
  }

  private lightCellZ(z: number): number {
    const c = Math.floor((z - this.lgMinZ) / LIGHT_CELL);
    return c < 0 ? 0 : c >= this.lgNz ? this.lgNz - 1 : c;
  }

  /** Indices of the point lights that may reach (x, z). */
  lightsNear(x: number, z: number): readonly number[] | undefined {
    const cx = Math.floor((x - this.lgMinX) / LIGHT_CELL);
    const cz = Math.floor((z - this.lgMinZ) / LIGHT_CELL);
    if (cx < 0 || cz < 0 || cx >= this.lgNx || cz >= this.lgNz) return undefined;
    return this.lightCells[cz * this.lgNx + cx];
  }

  private initSunDirs(): void {
    // Orthonormal basis around the sun direction.
    const sx = this.sunX;
    const sy = this.sunY;
    const sz = this.sunZ;
    let ux = -sz;
    let uy = 0;
    let uz = sx;
    let ul = Math.hypot(ux, uy, uz);
    if (ul < 1e-4) {
      ux = 1;
      uy = 0;
      uz = 0;
      ul = 1;
    }
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const vx = sy * uz - sz * uy;
    const vy = sz * ux - sx * uz;
    const vz = sx * uy - sy * ux;
    for (let i = 0; i < 8; i++) {
      // Two interleaved rings of four: group 0 = indices 0..3, group 1 = indices 4..7.
      const group = i >> 2;
      const a = ((i & 3) + group * 0.5) * (Math.PI / 2) + 0.4;
      const r = SUN_SPREAD * (group === 0 ? 0.85 : 0.5);
      let dx = sx + (ux * Math.cos(a) + vx * Math.sin(a)) * r;
      let dy = sy + (uy * Math.cos(a) + vy * Math.sin(a)) * r;
      let dz = sz + (uz * Math.cos(a) + vz * Math.sin(a)) * r;
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl;
      dy /= dl;
      dz /= dl;
      this.sunDirs[i * 3] = dx;
      this.sunDirs[i * 3 + 1] = dy;
      this.sunDirs[i * 3 + 2] = dz;
    }
  }

  /** Soft-shadow sample points around every light, pulled back where geometry is in the way. */
  private initLightSamples(): void {
    // Corners of a cube (two interleaved tetrahedra), turned so that no axis is favoured.
    const base: number[] = [];
    const corners = [
      [1, 1, 1],
      [1, -1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [-1, -1, -1],
      [-1, 1, 1],
      [1, -1, 1],
      [1, 1, -1],
    ];
    const ca = Math.cos(0.5);
    const sa = Math.sin(0.5);
    const cb = Math.cos(0.3);
    const sb = Math.sin(0.3);
    for (const c of corners) {
      const k = 1 / Math.sqrt(3);
      const x0 = c[0]! * k;
      const y0 = c[1]! * k;
      const z0 = c[2]! * k;
      // Rotate around Y, then around X.
      const x1 = x0 * ca + z0 * sa;
      const z1 = -x0 * sa + z0 * ca;
      const y2 = y0 * cb - z1 * sb;
      const z2 = y0 * sb + z1 * cb;
      base.push(x1, y2, z2);
    }
    for (let i = 0; i < this.lightCount; i++) {
      const o = i * 7;
      const lx = this.lights[o]!;
      const ly = this.lights[o + 1]!;
      const lz = this.lights[o + 2]!;
      if (this.world && this.pointInsideCaster(lx, ly, lz)) this.lightBuried[i] = 1;
      for (let s = 0; s < 8; s++) {
        const dx = base[s * 3]!;
        const dy = base[s * 3 + 1]!;
        const dz = base[s * 3 + 2]!;
        let radius = LIGHT_RADIUS;
        if (this.world && !this.lightBuried[i] && !this.trace(lx, ly, lz, dx, dy, dz, LIGHT_RADIUS + 0.03, ESCAPE_NONE)) {
          radius = Math.max(0, this.hitDist * 0.75 - 0.01);
        }
        const q = i * 24 + s * 3;
        this.lightSamples[q] = lx + dx * radius;
        this.lightSamples[q + 1] = ly + dy * radius;
        this.lightSamples[q + 2] = lz + dz * radius;
      }
    }
  }

  /** True when the light's shadow rays must be skipped (its centre is inside a solid). */
  isLightBuried(i: number): boolean {
    return this.lightBuried[i] === 1;
  }

  // --- Rays ---------------------------------------------------------------------------

  /** True when (x, y, z) lies strictly inside an opaque caster. */
  pointInsideCaster(x: number, y: number, z: number): boolean {
    const list = this.casters.query(x, z);
    const solids = this.casters.boxes;
    for (let i = 0; i < list.length; i++) {
      const s = solids[list[i]!]!;
      if (x > s.min.x && x < s.max.x && y > s.min.y && y < s.max.y && z > s.min.z && z < s.max.z) return true;
    }
    return false;
  }

  /**
   * Mark the solids that contain (cx, cy, cz) — the centre of a box — as "self" for the
   * following ESCAPE_SELF traces: rays born inside them (prop parts wrapped in their bulk
   * collider) may leave them. Returns the number of such solids.
   */
  beginSelf(cx: number, cy: number, cz: number): number {
    const stamp = ++this.stamp;
    const list = this.casters.query(cx, cz);
    const solids = this.casters.boxes;
    let count = 0;
    for (let i = 0; i < list.length; i++) {
      const si = list[i]!;
      const s = solids[si]!;
      if (cx > s.min.x && cx < s.max.x && cy > s.min.y && cy < s.max.y && cz > s.min.z && cz < s.max.z) {
        this.selfStamp[si] = stamp;
        count++;
      }
    }
    return count;
  }

  /**
   * Classify a sample point against the opaque casters: 0 = in the open, 1 = only inside
   * "self" solids (trace with ESCAPE_SELF), 2 = inside another solid (under a piece of
   * furniture, in the bulk of a collider).
   */
  classifyPoint(x: number, y: number, z: number): 0 | 1 | 2 {
    const list = this.casters.query(x, z);
    const solids = this.casters.boxes;
    let result: 0 | 1 | 2 = 0;
    for (let i = 0; i < list.length; i++) {
      const si = list[i]!;
      const s = solids[si]!;
      if (x > s.min.x && x < s.max.x && y > s.min.y && y < s.max.y && z > s.min.z && z < s.max.z) {
        if (this.selfStamp[si] !== this.stamp) return 2;
        result = 1;
      }
    }
    return result;
  }

  /**
   * Cast a ray from (ox, oy, oz) along the unit direction (dx, dy, dz) over `maxDist`.
   * Returns true when light gets through; `tR/tG/tB` then hold the transmittance (glass).
   * Returns false when an opaque solid stops it; `hitDist` then holds the distance.
   */
  trace(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, escape: number): boolean {
    const world = this.world;
    this.tR = this.tG = this.tB = 1;
    this.hitDist = Infinity;
    if (!world) return true;
    this.rays++;
    const o = this.rayO;
    const d = this.rayD;
    o.x = ox;
    o.y = oy;
    o.z = oz;
    d.x = dx;
    d.y = dy;
    d.z = dz;
    let travelled = 0;
    for (let iter = 0; iter < 12; iter++) {
      const hit: RayHit | null = world.raycast(o, d, maxDist - travelled, MASK.Bullet);
      if (!hit) return true;
      const si = hit.solid;
      const kind = this.solidKind[si]!;
      const s = world.solids[si]!;
      if (kind === SOLID_OPAQUE) {
        // Opaque: stop, unless the ORIGIN of the ray lies inside this solid and may leave it.
        const mayEscape =
          escape !== ESCAPE_NONE &&
          hit.dist === 0 &&
          ox > s.min.x &&
          ox < s.max.x &&
          oy > s.min.y &&
          oy < s.max.y &&
          oz > s.min.z &&
          oz < s.max.z &&
          (escape === ESCAPE_ANY || this.selfStamp[si] === this.stamp);
        if (!mayEscape) {
          this.tR = this.tG = this.tB = 0;
          this.hitDist = travelled + hit.dist;
          return false;
        }
      } else if (kind === SOLID_GLASS) {
        this.tR *= GLASS_TINT[0];
        this.tG *= GLASS_TINT[1];
        this.tB *= GLASS_TINT[2];
      } else if (kind === SOLID_FROSTED) {
        this.tR *= FROSTED_TINT[0];
        this.tG *= FROSTED_TINT[1];
        this.tB *= FROSTED_TINT[2];
      }
      // Continue behind the solid: distance at which the ray leaves its box.
      let exit = Infinity;
      if (dx > 1e-12) exit = Math.min(exit, (s.max.x - o.x) / dx);
      else if (dx < -1e-12) exit = Math.min(exit, (s.min.x - o.x) / dx);
      if (dy > 1e-12) exit = Math.min(exit, (s.max.y - o.y) / dy);
      else if (dy < -1e-12) exit = Math.min(exit, (s.min.y - o.y) / dy);
      if (dz > 1e-12) exit = Math.min(exit, (s.max.z - o.z) / dz);
      else if (dz < -1e-12) exit = Math.min(exit, (s.min.z - o.z) / dz);
      if (!(exit >= hit.dist)) exit = hit.dist;
      const step = exit + 2e-4;
      travelled += step;
      if (travelled >= maxDist) return true;
      o.x += dx * step;
      o.y += dy * step;
      o.z += dz * step;
    }
    this.tR = this.tG = this.tB = 0;
    this.hitDist = travelled;
    return false;
  }

  /** trace() toward a target point; returns true when the target is reached. */
  traceTo(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number, escape: number): boolean {
    const dx = tx - ox;
    const dy = ty - oy;
    const dz = tz - oz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (!(len > 1e-6)) {
      this.tR = this.tG = this.tB = 1;
      this.hitDist = Infinity;
      return true;
    }
    const inv = 1 / len;
    return this.trace(ox, oy, oz, dx * inv, dy * inv, dz * inv, len - 1e-4, escape);
  }

  /** True when an opaque visible box lies above the point (unshadowed mode only). */
  coveredAbove(x: number, y: number, z: number): boolean {
    const list = this.opaqueBoxes.query(x, z);
    const boxes = this.opaqueBoxes.boxes;
    for (let i = 0; i < list.length; i++) {
      const b = boxes[list[i]!]!;
      if (b.min.y > y - 0.01 && x >= b.min.x - 0.01 && x <= b.max.x + 0.01 && z >= b.min.z - 0.01 && z <= b.max.z + 0.01) return true;
    }
    return false;
  }

  // --- Hemisphere rays -------------------------------------------------------------------

  /**
   * World-space ray directions around a face normal: `count` cosine-weighted directions
   * per phase, HEMI_PHASES phases. `orientation` = axis × 2 + (sign < 0 ? 1 : 0).
   */
  hemisphere(orientation: number, count: number): Float32Array[] {
    if (this.hemiCount !== count) {
      this.hemiCount = count;
      this.hemi = [];
      const local = hemisphereSet(count, HEMI_PHASES);
      for (let o = 0; o < 6; o++) {
        const axis = o >> 1;
        const sign = o & 1 ? -1 : 1;
        const ua = (axis + 1) % 3;
        const va = (axis + 2) % 3;
        const sets: Float32Array[] = [];
        for (let p = 0; p < HEMI_PHASES; p++) {
          const src = local[p]!;
          const dst = new Float32Array(count * 3);
          for (let k = 0; k < count; k++) {
            dst[k * 3 + ua] = src[k * 3]!;
            dst[k * 3 + va] = src[k * 3 + 1]!;
            dst[k * 3 + axis] = src[k * 3 + 2]! * sign;
          }
          sets.push(dst);
        }
        this.hemi.push(sets);
      }
    }
    return this.hemi[orientation]!;
  }

  // --- Ambient ---------------------------------------------------------------------------

  /**
   * Ambient light for a surface whose normal has the vertical component `ny`, given the
   * visible share of the sky `vis` (0 = deep indoors, 1 = open sky). Result in `out`.
   */
  ambient(ny: number, vis: number, out: Float32Array): void {
    const h = 0.5 + 0.5 * ny;
    const skyK = h * vis;
    const inK = (1 - vis) * (0.62 + 0.38 * h);
    const gK = 1 - h;
    const bounceK = gK * vis * SUN_GROUND_BOUNCE;
    out[0] = this.sky[0]! * skyK + this.indoor[0]! * inK + this.ground[0]! * gK + this.sun[0]! * bounceK;
    out[1] = this.sky[1]! * skyK + this.indoor[1]! * inK + this.ground[1]! * gK + this.sun[1]! * bounceK;
    out[2] = this.sky[2]! * skyK + this.indoor[2]! * inK + this.ground[2]! * gK + this.sun[2]! * bounceK;
  }

  /** Point-light scale for a surface that sees the share `vis` of the sky. */
  lightScale(vis: number): number {
    return 1 - this.outdoorDim * vis;
  }

  // --- Bounce ----------------------------------------------------------------------------

  /** Forget the cached light probes (they are recomputed on demand). */
  resetProbes(): void {
    this.probeState.fill(0);
    this.probeFallback.clear();
  }

  /** Forget every splat (a new bake starts). */
  resetBounce(): void {
    this.bounceY.fill(NaN);
    this.bounceRgb.fill(0);
  }

  /**
   * Record light leaving an upward-facing surface at (x, y, z): `r, g, b` = received direct
   * light, `ar, ag, ab` = surface colour, `area` = surface (m²) the sample stands for.
   */
  splatBounce(x: number, y: number, z: number, r: number, g: number, b: number, ar: number, ag: number, ab: number, area: number): void {
    const weight = area / (this.bCell * this.bCell);
    const cx = Math.floor((x - this.bOx) / this.bCell);
    const cz = Math.floor((z - this.bOz) / this.bCell);
    if (cx < 0 || cz < 0 || cx >= this.bNx || cz >= this.bNz) return;
    const col = (cz * this.bNx + cx) * BOUNCE_LAYERS;
    let slot = -1;
    for (let l = 0; l < BOUNCE_LAYERS; l++) {
      const ly = this.bounceY[col + l]!;
      if (ly !== ly) {
        slot = l;
        this.bounceY[col + l] = y;
        break;
      }
      if (Math.abs(ly - y) < 0.3) {
        slot = l;
        break;
      }
    }
    if (slot < 0) return; // more stacked floors than layers: ignore the extra ones
    const grey = (ar + ag + ab) / 3;
    const o = (col + slot) * 3;
    this.bounceRgb[o]! += r * (grey + (ar - grey) * BOUNCE_SATURATION) * weight;
    this.bounceRgb[o + 1]! += g * (grey + (ag - grey) * BOUNCE_SATURATION) * weight;
    this.bounceRgb[o + 2]! += b * (grey + (ab - grey) * BOUNCE_SATURATION) * weight;
  }

  /**
   * Light bounced off the floors below / next to a surface point (zero for upward faces).
   * The result is valid until the next call.
   */
  bounce(x: number, y: number, z: number, nx: number, ny: number, nz: number): Float32Array {
    const out = this.bounceOut;
    out[0] = out[1] = out[2] = 0;
    if (ny > 0.7) return out;
    // Walls look at the floor in front of them, ceilings straight down.
    const horiz = 1 - Math.abs(ny);
    const fx = (x + nx * 0.75 * horiz - this.bOx) / this.bCell - 0.5;
    const fz = (z + nz * 0.75 * horiz - this.bOz) / this.bCell - 0.5;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const facing = ny <= 0 ? 0.5 - 0.3 * ny : 0.5 * (1 - ny / 0.7);
    for (let j = 0; j < 2; j++) {
      const cz = iz + j;
      if (cz < 0 || cz >= this.bNz) continue;
      const wz = j === 0 ? 1 - tz : tz;
      for (let i = 0; i < 2; i++) {
        const cx = ix + i;
        if (cx < 0 || cx >= this.bNx) continue;
        const w = wz * (i === 0 ? 1 - tx : tx);
        const col = (cz * this.bNx + cx) * BOUNCE_LAYERS;
        // Highest recorded floor that is not above the point.
        let best = -1;
        let bestY = -Infinity;
        for (let l = 0; l < BOUNCE_LAYERS; l++) {
          const ly = this.bounceY[col + l]!;
          if (ly !== ly) break;
          if (ly <= y + 0.3 && ly > bestY) {
            bestY = ly;
            best = l;
          }
        }
        if (best < 0) continue;
        const hgt = Math.max(0, y - bestY) / 3.5;
        const k = (w * facing * BOUNCE_GAIN) / (1 + hgt * hgt);
        const o = (col + best) * 3;
        out[0]! += this.bounceRgb[o]! * k;
        out[1]! += this.bounceRgb[o + 1]! * k;
        out[2]! += this.bounceRgb[o + 2]! * k;
      }
    }
    return out;
  }

  // --- Direct light at a point (one ray per source) --------------------------------------

  /**
   * Unblurred direct + ambient + bounce light at a surface point, one shadow ray per light.
   * This is the per-vertex path (prims, detail boxes, transparent faces, signs).
   */
  shade(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: Float32Array): void {
    const px = x + nx * VERTEX_PUSH;
    const py = y + ny * VERTEX_PUSH;
    const pz = z + nz * VERTEX_PUSH;
    const vis = this.skyVisibility(px + nx * 0.12, py + ny * 0.12, pz + nz * 0.12);
    const amb = this.amb;
    this.ambient(ny, vis, amb);
    let r = amb[0]!;
    let g = amb[1]!;
    let b = amb[2]!;

    const near = this.lightsNear(x, z);
    if (near) {
      const L = this.lights;
      const scale = this.lightScale(vis);
      for (let i = 0; i < near.length; i++) {
        const li = near[i]!;
        const o = li * 7;
        const dx = L[o]! - px;
        const dy = L[o + 1]! - py;
        const dz = L[o + 2]! - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const f = pointFalloff(d2, L[o + 3]!);
        if (f <= 0) continue;
        const inv = d2 > 1e-8 ? 1 / Math.sqrt(d2) : 0;
        const lambert = ((nx * dx + ny * dy + nz * dz) * inv + POINT_WRAP) / (1 + POINT_WRAP);
        if (lambert <= 0) continue;
        const k = f * lambert * scale;
        if (k < 0.004) continue;
        if (!this.lightBuried[li] && !this.traceTo(px, py, pz, L[o]!, L[o + 1]!, L[o + 2]!, ESCAPE_ANY)) continue;
        r += L[o + 4]! * k * this.tR;
        g += L[o + 5]! * k * this.tG;
        b += L[o + 6]! * k * this.tB;
      }
    }

    if (this.hasSun) {
      const ndl = nx * this.sunX + ny * this.sunY + nz * this.sunZ;
      if (ndl > 0 && this.sunVisible(px, py, pz, ESCAPE_ANY)) {
        r += this.sun[0]! * ndl * this.tR;
        g += this.sun[1]! * ndl * this.tG;
        b += this.sun[2]! * ndl * this.tB;
      }
    }

    const bounce = this.bounce(px, py, pz, nx, ny, nz);
    out[0] = toneMapLight(r + bounce[0]!);
    out[1] = toneMapLight(g + bounce[1]!);
    out[2] = toneMapLight(b + bounce[2]!);
  }

  /** One shadow ray toward the centre of the sun; transmittance in tR / tG / tB. */
  sunVisible(px: number, py: number, pz: number, escape: number): boolean {
    if (!this.world) {
      this.tR = this.tG = this.tB = 1;
      return !this.coveredAbove(px, py, pz);
    }
    return this.trace(px, py, pz, this.sunX, this.sunY, this.sunZ, this.far, escape);
  }

  // --- Light probes ----------------------------------------------------------------------

  /** Directions (and weights) used to estimate how much sky a point sees. */
  private static readonly SKY_DIRS: readonly number[] = (() => {
    const out: number[] = [0, 1, 0, 1];
    for (let ring = 0; ring < 2; ring++) {
      const elev = ring === 0 ? 0.96 : 0.44; // radians above the horizon
      for (let i = 0; i < 4; i++) {
        const a = (i + ring * 0.5) * (Math.PI / 2) + 0.3;
        out.push(Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev), Math.sin(elev));
      }
    }
    return out;
  })();

  /** Fill `out` (r, g, b, sky visibility) with the omnidirectional light at a free point. */
  private computeProbe(x: number, y: number, z: number, out: Float32Array, o: number): void {
    // Sky visibility.
    let vis = 1;
    if (this.world) {
      const D = LightModel.SKY_DIRS;
      let seen = 0;
      let total = 0;
      for (let i = 0; i < D.length; i += 4) {
        const w = D[i + 3]!;
        total += w;
        if (this.trace(x, y, z, D[i]!, D[i + 1]!, D[i + 2]!, this.far, ESCAPE_NONE)) seen += w * luma(this.tR, this.tG, this.tB);
      }
      vis = seen / total;
    } else if (this.coveredAbove(x, y, z)) {
      vis = 0;
    }

    // Ambient seen by an object: mostly from above, a little from below.
    let r = this.sky[0]! * 0.7 * vis + this.indoor[0]! * 0.85 * (1 - vis) + this.ground[0]! * 0.3;
    let g = this.sky[1]! * 0.7 * vis + this.indoor[1]! * 0.85 * (1 - vis) + this.ground[1]! * 0.3;
    let b = this.sky[2]! * 0.7 * vis + this.indoor[2]! * 0.85 * (1 - vis) + this.ground[2]! * 0.3;

    if (this.hasSun && this.sunVisible(x, y, z, ESCAPE_NONE)) {
      r += this.sun[0]! * 0.6 * this.tR;
      g += this.sun[1]! * 0.6 * this.tG;
      b += this.sun[2]! * 0.6 * this.tB;
    }

    const near = this.lightsNear(x, z);
    if (near) {
      const L = this.lights;
      const scale = this.lightScale(vis) * 0.8;
      for (let i = 0; i < near.length; i++) {
        const li = near[i]!;
        const q = li * 7;
        const dx = L[q]! - x;
        const dy = L[q + 1]! - y;
        const dz = L[q + 2]! - z;
        const f = pointFalloff(dx * dx + dy * dy + dz * dz, L[q + 3]!) * scale;
        if (f < 0.004) continue;
        if (!this.lightBuried[li] && !this.traceTo(x, y, z, L[q]!, L[q + 1]!, L[q + 2]!, ESCAPE_NONE)) continue;
        r += L[q + 4]! * f * this.tR;
        g += L[q + 5]! * f * this.tG;
        b += L[q + 6]! * f * this.tB;
      }
    }
    const bounce = this.bounce(x, y, z, 0, -0.2, 0);
    out[o] = r + bounce[0]!;
    out[o + 1] = g + bounce[1]!;
    out[o + 2] = b + bounce[2]!;
    out[o + 3] = vis;
  }

  /**
   * Trilinear lookup in the probe lattice (nodes are computed on first use; nodes inside
   * solids are skipped). Fills probeOut with r, g, b, sky visibility.
   */
  private probeAt(x: number, y: number, z: number): Float32Array {
    const out = this.probeOut;
    const cell = this.pCell;
    let fx = (x - this.pOx) / cell;
    let fy = (y - this.pOy) / this.probeCellY;
    let fz = (z - this.pOz) / cell;
    let ix = Math.floor(fx);
    let iy = Math.floor(fy);
    let iz = Math.floor(fz);
    if (ix < 0) ix = 0;
    else if (ix > this.pNx - 2) ix = this.pNx - 2;
    if (iy < 0) iy = 0;
    else if (iy > this.pNy - 2) iy = this.pNy - 2;
    if (iz < 0) iz = 0;
    else if (iz > this.pNz - 2) iz = this.pNz - 2;
    fx -= ix;
    fy -= iy;
    fz -= iz;
    fx = fx < 0 ? 0 : fx > 1 ? 1 : fx;
    fy = fy < 0 ? 0 : fy > 1 ? 1 : fy;
    fz = fz < 0 ? 0 : fz > 1 ? 1 : fz;

    let r = 0;
    let g = 0;
    let b = 0;
    let v = 0;
    let wsum = 0;
    for (let c = 0; c < 8; c++) {
      const cx = ix + (c & 1);
      const cy = iy + ((c >> 1) & 1);
      const cz = iz + (c >> 2);
      const w = (c & 1 ? fx : 1 - fx) * ((c >> 1) & 1 ? fy : 1 - fy) * (c >> 2 ? fz : 1 - fz);
      if (w <= 1e-4) continue;
      const node = (cy * this.pNz + cz) * this.pNx + cx;
      let state = this.probeState[node]!;
      if (state === 0) {
        const nxp = this.pOx + cx * cell;
        const nyp = this.pOy + cy * this.probeCellY;
        const nzp = this.pOz + cz * cell;
        if (this.pointInsideCaster(nxp, nyp, nzp)) {
          state = 2;
        } else {
          this.computeProbe(nxp, nyp, nzp, this.probes, node * 4);
          state = 1;
        }
        this.probeState[node] = state;
      }
      if (state !== 1) continue;
      const o = node * 4;
      r += this.probes[o]! * w;
      g += this.probes[o + 1]! * w;
      b += this.probes[o + 2]! * w;
      v += this.probes[o + 3]! * w;
      wsum += w;
    }
    if (wsum > 1e-3) {
      const k = 1 / wsum;
      out[0] = r * k;
      out[1] = g * k;
      out[2] = b * k;
      out[3] = v * k;
      return out;
    }
    // Every surrounding node is buried (narrow gap between thick walls): probe the spot
    // itself, cached on a finer grid.
    const key = (Math.floor(x / 0.75) & 1023) | ((Math.floor(z / 0.75) & 1023) << 10) | ((Math.floor(y / 0.75) & 1023) << 20);
    let cached = this.probeFallback.get(key);
    if (!cached) {
      cached = new Float32Array(4);
      this.computeProbe(x, y, z, cached, 0);
      this.probeFallback.set(key, cached);
    }
    return cached;
  }

  /** Share of the sky visible around a point (0 = deep indoors, 1 = open air), smoothed. */
  skyVisibility(x: number, y: number, z: number): number {
    return this.probeAt(x, y, z)[3]!;
  }

  /**
   * Light colour for a dynamic object standing at `pos` (feet): avatars and the weapon
   * multiply their colours by it. About 0.9 in open daylight or under a ceiling light,
   * lower in dark corridors; clamped to 0.3 … 1.35.
   */
  sample<T extends { r: number; g: number; b: number }>(pos: Vec3, out: T): T {
    const p = this.probeAt(pos.x, pos.y + 1, pos.z);
    out.r = Math.min(1.35, Math.max(0.3, p[0]!));
    out.g = Math.min(1.35, Math.max(0.3, p[1]!));
    out.b = Math.min(1.35, Math.max(0.3, p[2]!));
    return out;
  }
}

/** The world if it can be used for ray casts, else null (unshadowed mode). */
function usableWorld(world: CollisionWorld | null | undefined, map: MapData): CollisionWorld | null {
  if (!world || typeof world.raycast !== 'function' || !Array.isArray(world.solids)) return null;
  try {
    const b = map.bounds;
    world.raycast({ x: b.min.x, y: b.max.y + 1, z: b.min.z }, { x: 0, y: -1, z: 0 }, 1, MASK.Bullet);
    return world;
  } catch {
    return null;
  }
}

/** Axis-aligned bounds of a (possibly rotated) decorative primitive. */
function primBounds(prim: MapData['prims'][number]): Aabb {
  const rx = prim.rot?.x ?? 0;
  const ry = prim.rot?.y ?? 0;
  const rz = prim.rot?.z ?? 0;
  const a = Math.cos(rx);
  const b = Math.sin(rx);
  const c = Math.cos(ry);
  const d = Math.sin(ry);
  const e = Math.cos(rz);
  const f = Math.sin(rz);
  // Rotation matrix of an Euler YXZ rotation (same convention as the renderer).
  const m00 = c * e + d * f * b;
  const m01 = d * e * b - c * f;
  const m02 = a * d;
  const m10 = a * f;
  const m11 = a * e;
  const m12 = -b;
  const m20 = c * f * b - d * e;
  const m21 = d * f + c * e * b;
  const m22 = a * c;
  const hx = prim.size.x / 2;
  const hy = prim.size.y / 2;
  const hz = prim.size.z / 2;
  const ex = Math.abs(m00) * hx + Math.abs(m01) * hy + Math.abs(m02) * hz;
  const ey = Math.abs(m10) * hx + Math.abs(m11) * hy + Math.abs(m12) * hz;
  const ez = Math.abs(m20) * hx + Math.abs(m21) * hy + Math.abs(m22) * hz;
  return {
    min: { x: prim.pos.x - ex, y: prim.pos.y - ey, z: prim.pos.z - ez },
    max: { x: prim.pos.x + ex, y: prim.pos.y + ey, z: prim.pos.z + ez },
  };
}

const boundsKey = (b: Aabb): string =>
  `${Math.round(b.min.x * 500)},${Math.round(b.min.y * 500)},${Math.round(b.min.z * 500)},${Math.round(b.max.x * 500)},${Math.round(b.max.y * 500)},${Math.round(b.max.z * 500)}`;

/**
 * Decide how every solid treats light (see the file header): opaque caster, glass, or
 * invisible collider.
 */
function classifySolids(map: MapData): Uint8Array {
  const solids = map.solids;
  const kinds = new Uint8Array(solids.length);

  // Visible, non-transparent geometry (boxes and prims).
  const visuals: Aabb[] = [];
  for (const box of map.boxes) if (!materialInfo(box.mat).transparent) visuals.push(box);
  for (const prim of map.prims) if (!materialInfo(prim.mat).transparent) visuals.push(primBounds(prim));
  const grid = new BoxGrid(visuals, () => true);
  const candidates: number[] = [];

  // Boxes by bounds, to recognise the solid that MapBuilder.box() created with a box.
  let byBounds: Map<string, BoxPrim> | null = null;

  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]!;
    const ex = s.max.x - s.min.x;
    const ey = s.max.y - s.min.y;
    const ez = s.max.z - s.min.z;
    if (s.noBullets || !(ex > 0 && ey > 0 && ez > 0)) {
      kinds[i] = SOLID_PASS;
      continue;
    }
    if (s.surf === 'glass') {
      if (!byBounds) {
        byBounds = new Map();
        for (const box of map.boxes) byBounds.set(boundsKey(box), box);
      }
      const twin = byBounds.get(boundsKey(s));
      if (twin && !materialInfo(twin.mat).transparent) kinds[i] = SOLID_OPAQUE; // opaque façade window, screen…
      else kinds[i] = twin && twin.mat === 'glass_frosted' ? SOLID_FROSTED : SOLID_GLASS;
      continue;
    }
    // Opaque caster only if visible geometry fills a real share of the solid.
    const need = ex * ey * ez * MIN_VISUAL_FRACTION;
    let filled = 0;
    grid.queryRect(s.min.x, s.min.z, s.max.x, s.max.z, candidates);
    for (let c = 0; c < candidates.length && filled < need; c++) {
      const v = visuals[candidates[c]!]!;
      const ox = Math.min(s.max.x, v.max.x) - Math.max(s.min.x, v.min.x);
      const oy = Math.min(s.max.y, v.max.y) - Math.max(s.min.y, v.min.y);
      const oz = Math.min(s.max.z, v.max.z) - Math.max(s.min.z, v.min.z);
      if (ox > 1e-4 && oy > 1e-4 && oz > 1e-4) filled += ox * oy * oz;
    }
    kinds[i] = filled >= need ? SOLID_OPAQUE : SOLID_PASS;
  }
  return kinds;
}
