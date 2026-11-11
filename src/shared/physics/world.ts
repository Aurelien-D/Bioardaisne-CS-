/**
 * Static collision world made of axis-aligned solids, with a uniform-grid broadphase.
 * Used by player movement (swept AABB), hitscan (ray casts), bots (line of sight),
 * the nav grid generator and the light baker.
 *
 * CONTRACT FILE — signatures are fixed (see docs/ARCHITECTURE.md §Physique).
 *
 * Implementation notes
 * --------------------
 *  - Solids are copied into a flat Float64Array (6 numbers per solid) and registered in a
 *    uniform 3D grid of ~2 m cells stored in CSR form (`cellStart` / `cellItems`). Queries
 *    only visit the cells they cross; a per-query stamp avoids testing a solid twice.
 *  - "Touching is not overlapping": every test uses strict inequalities, so a box resting
 *    exactly against a face neither overlaps it nor collides with it when it moves
 *    parallel to that face. This is what makes seams between adjacent coplanar boxes
 *    (tiled floors, walls made of several boxes) invisible to a sliding mover.
 *  - Sweeps find the exact first contact (Minkowski sum + segment slab test) and then back
 *    off by BACKOFF along the contact axis, so a mover normally keeps a 1 mm gap to
 *    whatever it ran into and float rounding can never push it inside.
 *  - Results are canonical (independent of the grid traversal order): on equal contact
 *    times the solid with the lowest index wins, and within a solid the Y face is
 *    preferred over X, then Z.
 *  - Rays follow the same "touching is not hitting" rule, with one exception that keeps
 *    walls and floors made of several boxes watertight: a ray that travels exactly in the
 *    plane shared by solids on both of its sides (the seam between two wall boxes or two
 *    floor tiles, the foot of a wall standing on a floor) is blocked where they meet.
 *  - Queries are not re-entrant (they share scratch fields) but allocate nothing except
 *    the small result object.
 */
import type { Vec3 } from '../math/vec3';
import type { SurfaceType } from '../maps/materials';
import type { Solid } from '../maps/types';

/** Which solids a query considers. */
export const MASK = {
  /** Player hulls: ignores solids flagged `noPlayers`. */
  Player: 1,
  /** Bullets / line of sight: ignores solids flagged `noBullets`. */
  Bullet: 2,
} as const;

export interface Trace {
  /** Fraction of `delta` that can be travelled before touching something (0..1). */
  fraction: number;
  hit: boolean;
  /** The box already overlaps a solid at the start position. */
  startSolid: boolean;
  /** Normal of the surface hit (axis-aligned unit vector). Undefined content when !hit. */
  normal: Vec3;
  /** Index of the solid hit in `world.solids`, -1 when !hit. */
  solid: number;
}

export interface RayHit {
  dist: number;
  point: Vec3;
  normal: Vec3;
  solid: number;
  surf: SurfaceType;
}

/** Distance (m) a sweep stops short of the surface it hits. */
const BACKOFF = 1e-3;
/** Target edge length (m) of a broadphase cell. */
const CELL_SIZE = 2;
/** Upper bound on the number of grid cells; the cell size grows to respect it. */
const MAX_CELLS = 1 << 18;
/** Solids are registered in every cell within this margin (m): absorbs float rounding in cell lookups. */
const GRID_PAD = 1e-4;
/** Sweeps covering more cells than this are walked segment by segment along their path. */
const DIRECT_SWEEP_CELLS = 48;
/** Maximum number of path segments of a long sweep. */
const MAX_SWEEP_SEGMENTS = 1024;
/** Ray direction components smaller than this are treated as exactly parallel. */
const PARALLEL_EPS = 1e-30;
/** groundBelow accepts surfaces up to this far above `pos.y` (feet resting on a floor, float noise). */
const GROUND_TOLERANCE = 0.01;
/** lineOfSight ignores obstacles within this distance of the end point (target lying on a surface). */
const LOS_SLACK = 1e-4;
/**
 * An axis-parallel ray closer than this (m) to a face plane lies "in" that plane: wide enough
 * to absorb the last-bit differences between coordinates that are equal on paper but were
 * computed along different paths (0.1 + 0.2 vs 0.3), far below anything visible.
 */
const SEAM_EPS = 1e-9;
/** Internal flag: malformed solid, never collides. Must not collide with MASK bits. */
const FLAG_IGNORED = 4;

export class CollisionWorld {
  readonly solids: readonly Solid[];

  /** min.x, min.y, min.z, max.x, max.y, max.z for every solid. */
  private readonly box: Float64Array;
  /** Per solid: MASK bits that ignore it (noPlayers -> MASK.Player, noBullets -> MASK.Bullet), or FLAG_IGNORED. */
  private readonly flags: Uint8Array;
  /** CSR grid: solids of cell c are cellItems[cellStart[c] .. cellStart[c + 1]), ascending. */
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  /** Per solid: stamp of the last query that tested it. */
  private readonly marks: Uint32Array;
  private stamp = 0;

  /** Grid origin, far corner, cell counts and cell size. */
  private readonly gx: number;
  private readonly gy: number;
  private readonly gz: number;
  private readonly gx1: number;
  private readonly gy1: number;
  private readonly gz1: number;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly cell: number;
  private readonly invCell: number;

  // Scratch results of the sweep in progress.
  private bestT = 0;
  private bestSolid = -1;
  private bestAxis = 0;
  private startIdx = -1;
  // Scratch results of the ray cast in progress.
  private rayT = 0;
  private raySolid = -1;
  private rayAxis = 0;
  /**
   * Solids whose face plane contains the ray in progress (only possible for a ray exactly
   * parallel to an axis): entry / exit times, the sectors around the ray they occupy, their
   * index and entry axis. Grown on demand, reused by every ray.
   */
  private readonly grazeT0: number[] = [];
  private readonly grazeT1: number[] = [];
  private readonly grazeSectors: number[] = [];
  private readonly grazeSolid: number[] = [];
  private readonly grazeAxis: number[] = [];

  constructor(solids: readonly Solid[]) {
    this.solids = solids;
    const n = solids.length;
    const box = new Float64Array(n * 6);
    const flags = new Uint8Array(n);

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let valid = 0;
    for (let i = 0; i < n; i++) {
      const s = solids[i]!;
      const x0 = s.min.x;
      const y0 = s.min.y;
      const z0 = s.min.z;
      const x1 = s.max.x;
      const y1 = s.max.y;
      const z1 = s.max.z;
      const sum = x0 + y0 + z0 + x1 + y1 + z1;
      // Non-finite, inverted or zero-thickness boxes can never be hit.
      if (sum - sum !== 0 || !(x1 > x0 && y1 > y0 && z1 > z0)) {
        flags[i] = FLAG_IGNORED;
        continue;
      }
      const o = i * 6;
      box[o] = x0;
      box[o + 1] = y0;
      box[o + 2] = z0;
      box[o + 3] = x1;
      box[o + 4] = y1;
      box[o + 5] = z1;
      flags[i] = (s.noPlayers ? MASK.Player : 0) | (s.noBullets ? MASK.Bullet : 0);
      if (x0 < minX) minX = x0;
      if (y0 < minY) minY = y0;
      if (z0 < minZ) minZ = z0;
      if (x1 > maxX) maxX = x1;
      if (y1 > maxY) maxY = y1;
      if (z1 > maxZ) maxZ = z1;
      valid++;
    }

    // Grid dimensions: ~2 m cells, coarser if the world is huge.
    let cell = CELL_SIZE;
    let nx = 1;
    let ny = 1;
    let nz = 1;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    if (valid > 0) {
      const margin = GRID_PAD * 2;
      gx = minX - margin;
      gy = minY - margin;
      gz = minZ - margin;
      const ex = maxX - minX + margin * 2;
      const ey = maxY - minY + margin * 2;
      const ez = maxZ - minZ + margin * 2;
      for (;;) {
        nx = Math.max(1, Math.ceil(ex / cell));
        ny = Math.max(1, Math.ceil(ey / cell));
        nz = Math.max(1, Math.ceil(ez / cell));
        if (nx * ny * nz <= MAX_CELLS) break;
        cell *= 1.25;
      }
    }
    const invCell = 1 / cell;
    this.gx = gx;
    this.gy = gy;
    this.gz = gz;
    this.gx1 = gx + nx * cell;
    this.gy1 = gy + ny * cell;
    this.gz1 = gz + nz * cell;
    this.nx = nx;
    this.ny = ny;
    this.nz = nz;
    this.cell = cell;
    this.invCell = invCell;

    // Cell range of every solid (padded), then a counting sort into CSR arrays.
    const range = new Int32Array(n * 6);
    const cellStart = new Int32Array(nx * ny * nz + 1);
    const clampCell = (v: number, count: number): number => {
      const c = Math.floor(v);
      return c < 0 ? 0 : c >= count ? count - 1 : c;
    };
    for (let i = 0; i < n; i++) {
      if (flags[i] === FLAG_IGNORED) continue;
      const o = i * 6;
      const ix0 = clampCell((box[o]! - GRID_PAD - gx) * invCell, nx);
      const iy0 = clampCell((box[o + 1]! - GRID_PAD - gy) * invCell, ny);
      const iz0 = clampCell((box[o + 2]! - GRID_PAD - gz) * invCell, nz);
      const ix1 = clampCell((box[o + 3]! + GRID_PAD - gx) * invCell, nx);
      const iy1 = clampCell((box[o + 4]! + GRID_PAD - gy) * invCell, ny);
      const iz1 = clampCell((box[o + 5]! + GRID_PAD - gz) * invCell, nz);
      range[o] = ix0;
      range[o + 1] = iy0;
      range[o + 2] = iz0;
      range[o + 3] = ix1;
      range[o + 4] = iy1;
      range[o + 5] = iz1;
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          const row = (iy * nz + iz) * nx;
          for (let ix = ix0; ix <= ix1; ix++) cellStart[row + ix + 1]!++;
        }
      }
    }
    for (let c = 0, total = nx * ny * nz; c < total; c++) cellStart[c + 1]! += cellStart[c]!;
    const cellItems = new Int32Array(cellStart[nx * ny * nz]!);
    const cursor = cellStart.slice(0, nx * ny * nz);
    for (let i = 0; i < n; i++) {
      if (flags[i] === FLAG_IGNORED) continue;
      const o = i * 6;
      const ix0 = range[o]!;
      const ix1 = range[o + 3]!;
      for (let iy = range[o + 1]!; iy <= range[o + 4]!; iy++) {
        for (let iz = range[o + 2]!; iz <= range[o + 5]!; iz++) {
          const row = (iy * nz + iz) * nx;
          for (let ix = ix0; ix <= ix1; ix++) cellItems[cursor[row + ix]!++] = i;
        }
      }
    }

    this.box = box;
    this.flags = flags;
    this.cellStart = cellStart;
    this.cellItems = cellItems;
    this.marks = new Uint32Array(n);
  }

  /**
   * Sweep an axis-aligned box (centre + half extents) along `delta` against the world.
   * Never returns a position inside a solid: callers move by `delta * fraction`
   * (the implementation backs off by a small epsilon itself).
   *
   * Details:
   *  - the first contact is exact; `fraction` stops 1 mm short of it along the contact axis
   *    (0 if the box is already closer than that and moving toward the surface);
   *  - a box that merely touches a face and moves parallel to it, or away from it, is not blocked;
   *  - if the box overlaps a solid at the start: `startSolid` and `hit` are true, `fraction` is 0
   *    and `normal` is the shortest way out of the lowest-index overlapped solid;
   *  - a zero `delta` is a pure overlap test (fraction 1 when free);
   *  - non-finite input yields fraction 0 with `hit` false;
   *  - a box with a zero half extent (a plate, a segment, a point) is accepted, but touching
   *    still means "not hitting" for it: moving exactly in the plane of a seam it passes
   *    between the two solids. Use `raycast` / `lineOfSight`, which close seams, for
   *    anything without thickness.
   */
  sweepBox(center: Vec3, half: Vec3, delta: Vec3, mask: number = MASK.Player): Trace {
    const cx = center.x;
    const cy = center.y;
    const cz = center.z;
    const hx = half.x < 0 ? -half.x : half.x;
    const hy = half.y < 0 ? -half.y : half.y;
    const hz = half.z < 0 ? -half.z : half.z;
    const dx = delta.x;
    const dy = delta.y;
    const dz = delta.z;
    const check = cx + cy + cz + hx + hy + hz + dx + dy + dz;
    if (check - check !== 0) {
      return { fraction: 0, hit: false, startSolid: false, normal: { x: 0, y: 0, z: 0 }, solid: -1 };
    }

    this.bestT = Infinity;
    this.bestSolid = -1;
    this.bestAxis = 0;
    this.startIdx = -1;

    // Bounds of the whole swept volume.
    const qx0 = cx - hx + (dx < 0 ? dx : 0);
    const qy0 = cy - hy + (dy < 0 ? dy : 0);
    const qz0 = cz - hz + (dz < 0 ? dz : 0);
    const qx1 = cx + hx + (dx > 0 ? dx : 0);
    const qy1 = cy + hy + (dy > 0 ? dy : 0);
    const qz1 = cz + hz + (dz > 0 ? dz : 0);
    if (qx1 >= this.gx && qx0 <= this.gx1 && qy1 >= this.gy && qy0 <= this.gy1 && qz1 >= this.gz && qz0 <= this.gz1) {
      const inv = this.invCell;
      const nx = this.nx;
      const ny = this.ny;
      const nz = this.nz;
      let ix0 = Math.floor((qx0 - this.gx) * inv);
      let iy0 = Math.floor((qy0 - this.gy) * inv);
      let iz0 = Math.floor((qz0 - this.gz) * inv);
      let ix1 = Math.floor((qx1 - this.gx) * inv);
      let iy1 = Math.floor((qy1 - this.gy) * inv);
      let iz1 = Math.floor((qz1 - this.gz) * inv);
      if (ix0 < 0) ix0 = 0;
      if (iy0 < 0) iy0 = 0;
      if (iz0 < 0) iz0 = 0;
      if (ix1 >= nx) ix1 = nx - 1;
      if (iy1 >= ny) iy1 = ny - 1;
      if (iz1 >= nz) iz1 = nz - 1;
      this.nextStamp();
      if ((ix1 - ix0 + 1) * (iy1 - iy0 + 1) * (iz1 - iz0 + 1) <= DIRECT_SWEEP_CELLS) {
        this.sweepCells(cx, cy, cz, hx, hy, hz, dx, dy, dz, mask, ix0, ix1, iy0, iy1, iz0, iz1);
      } else {
        this.sweepSegments(cx, cy, cz, hx, hy, hz, dx, dy, dz, mask);
      }
    }

    // --- Build the result ---------------------------------------------------------
    const box = this.box;
    if (this.startIdx >= 0) {
      // Shortest way out of the overlapped solid (useful to callers that want to recover).
      const o = this.startIdx * 6;
      let depth = box[o + 4]! + hy - cy;
      let nx = 0;
      let ny = 1;
      let nz = 0;
      let d = cx - (box[o]! - hx);
      if (d < depth) {
        depth = d;
        nx = -1;
        ny = 0;
      }
      d = box[o + 3]! + hx - cx;
      if (d < depth) {
        depth = d;
        nx = 1;
        ny = 0;
      }
      d = cz - (box[o + 2]! - hz);
      if (d < depth) {
        depth = d;
        nx = 0;
        ny = 0;
        nz = -1;
      }
      d = box[o + 5]! + hz - cz;
      if (d < depth) {
        depth = d;
        nx = 0;
        ny = 0;
        nz = 1;
      }
      d = cy - (box[o + 1]! - hy);
      if (d < depth) {
        nx = 0;
        ny = -1;
        nz = 0;
      }
      return { fraction: 0, hit: true, startSolid: true, normal: { x: nx, y: ny, z: nz }, solid: this.startIdx };
    }
    if (this.bestSolid < 0) {
      return { fraction: 1, hit: false, startSolid: false, normal: { x: 0, y: 0, z: 0 }, solid: -1 };
    }
    const axis = this.bestAxis;
    const along = axis === 0 ? dx : axis === 1 ? dy : dz;
    let fraction = this.bestT - BACKOFF / (along < 0 ? -along : along);
    if (!(fraction > 0)) fraction = 0;
    const sign = along > 0 ? -1 : 1;
    return {
      fraction,
      hit: true,
      startSolid: false,
      normal: { x: axis === 0 ? sign : 0, y: axis === 1 ? sign : 0, z: axis === 2 ? sign : 0 },
      solid: this.bestSolid,
    };
  }

  /** True if the box overlaps any solid (touching is not overlapping). Non-finite input counts as blocked. */
  boxOverlaps(center: Vec3, half: Vec3, mask: number = MASK.Player): boolean {
    const cx = center.x;
    const cy = center.y;
    const cz = center.z;
    const hx = half.x < 0 ? -half.x : half.x;
    const hy = half.y < 0 ? -half.y : half.y;
    const hz = half.z < 0 ? -half.z : half.z;
    const check = cx + cy + cz + hx + hy + hz;
    if (check - check !== 0) return true;
    if (
      cx + hx < this.gx ||
      cx - hx > this.gx1 ||
      cy + hy < this.gy ||
      cy - hy > this.gy1 ||
      cz + hz < this.gz ||
      cz - hz > this.gz1
    ) {
      return false;
    }
    const inv = this.invCell;
    const nx = this.nx;
    const ny = this.ny;
    const nz = this.nz;
    let ix0 = Math.floor((cx - hx - this.gx) * inv);
    let iy0 = Math.floor((cy - hy - this.gy) * inv);
    let iz0 = Math.floor((cz - hz - this.gz) * inv);
    let ix1 = Math.floor((cx + hx - this.gx) * inv);
    let iy1 = Math.floor((cy + hy - this.gy) * inv);
    let iz1 = Math.floor((cz + hz - this.gz) * inv);
    if (ix0 < 0) ix0 = 0;
    if (iy0 < 0) iy0 = 0;
    if (iz0 < 0) iz0 = 0;
    if (ix1 >= nx) ix1 = nx - 1;
    if (iy1 >= ny) iy1 = ny - 1;
    if (iz1 >= nz) iz1 = nz - 1;
    const box = this.box;
    const flags = this.flags;
    const cellStart = this.cellStart;
    const items = this.cellItems;
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const row = (iy * nz + iz) * nx;
        for (let ix = ix0; ix <= ix1; ix++) {
          const c = row + ix;
          for (let k = cellStart[c]!, end = cellStart[c + 1]!; k < end; k++) {
            const i = items[k]!;
            if ((flags[i]! & mask) !== 0) continue;
            const o = i * 6;
            // Same Minkowski formulation as sweepBox, so both always agree.
            if (
              cx > box[o]! - hx &&
              cx < box[o + 3]! + hx &&
              cy > box[o + 1]! - hy &&
              cy < box[o + 4]! + hy &&
              cz > box[o + 2]! - hz &&
              cz < box[o + 5]! + hz
            ) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  /**
   * Cast a ray (`dir` must be normalised). Returns the nearest hit within `maxDist`, or null.
   * A ray grazing a face or an edge of the solid geometry misses; a ray travelling exactly in
   * the plane where solids touch each other (a seam inside a wall or a floor, the foot of a
   * wall) does not slip between them: it hits where there is solid on every side of it.
   * A ray starting inside a solid hits it at distance 0 (normal = opposite of the dominant ray
   * axis). `maxDist` may be Infinity.
   */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, mask: number = MASK.Bullet): RayHit | null {
    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const dx = dir.x;
    const dy = dir.y;
    const dz = dir.z;
    if (!this.castRay(ox, oy, oz, dx, dy, dz, maxDist, mask)) return null;
    const t = this.rayT;
    const i = this.raySolid;
    let axis = this.rayAxis;
    if (axis < 0) {
      // Started inside the solid: face the ray.
      const ax = dx < 0 ? -dx : dx;
      const ay = dy < 0 ? -dy : dy;
      const az = dz < 0 ? -dz : dz;
      axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    }
    const along = axis === 0 ? dx : axis === 1 ? dy : dz;
    const sign = along > 0 ? -1 : 1;
    return {
      dist: t,
      point: { x: ox + dx * t, y: oy + dy * t, z: oz + dz * t },
      normal: { x: axis === 0 ? sign : 0, y: axis === 1 ? sign : 0, z: axis === 2 ? sign : 0 },
      solid: i,
      surf: this.solids[i]!.surf,
    };
  }

  /**
   * True if no solid blocks the segment a -> b (same rules as `raycast`). An end point lying
   * exactly on a surface is visible from the open side of that surface; a start point inside
   * a solid sees nothing. Two points lying on the same floor see each other along it, but
   * not through a wall standing on that floor.
   */
  lineOfSight(a: Vec3, b: Vec3, mask: number = MASK.Bullet): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len - len !== 0) return false;
    if (len <= LOS_SLACK) return true;
    const inv = 1 / len;
    return !this.castRay(a.x, a.y, a.z, dx * inv, dy * inv, dz * inv, len - LOS_SLACK, mask);
  }

  /**
   * Y of the highest walkable surface under `pos` (looking down at most `maxDrop`),
   * or null if there is none. Uses the Player mask.
   *
   * A surface is the top face of a solid whose footprint contains (pos.x, pos.z). Surfaces up
   * to 1 cm above `pos.y` are accepted, so a feet position resting on a floor finds that floor.
   * Headroom is not checked: use sweepBox / boxOverlaps to know whether a hull fits there.
   */
  groundBelow(pos: Vec3, maxDrop: number): number | null {
    const x = pos.x;
    const y = pos.y;
    const z = pos.z;
    const check = x + y + z;
    if (check - check !== 0 || !(maxDrop >= 0)) return null;
    if (x < this.gx || x > this.gx1 || z < this.gz || z > this.gz1) return null;
    const top = y + GROUND_TOLERANCE;
    const bottom = y - maxDrop;
    if (top < this.gy || bottom > this.gy1) return null;

    const inv = this.invCell;
    const nx = this.nx;
    const ny = this.ny;
    const nz = this.nz;
    let ix = Math.floor((x - this.gx) * inv);
    let iz = Math.floor((z - this.gz) * inv);
    if (ix >= nx) ix = nx - 1;
    if (iz >= nz) iz = nz - 1;
    let iyTop = Math.floor((top - this.gy) * inv);
    if (iyTop >= ny) iyTop = ny - 1;
    let iyBottom = bottom > this.gy ? Math.floor((bottom - this.gy) * inv) : 0;
    if (iyBottom < 0) iyBottom = 0;

    const box = this.box;
    const flags = this.flags;
    const cellStart = this.cellStart;
    const items = this.cellItems;
    let best = -Infinity;
    for (let iy = iyTop; iy >= iyBottom; iy--) {
      const c = (iy * nz + iz) * nx + ix;
      for (let k = cellStart[c]!, end = cellStart[c + 1]!; k < end; k++) {
        const i = items[k]!;
        if ((flags[i]! & MASK.Player) !== 0) continue;
        const o = i * 6;
        const surface = box[o + 4]!;
        if (surface <= best || surface > top || surface < bottom) continue;
        if (x < box[o]! || x > box[o + 3]! || z < box[o + 2]! || z > box[o + 5]!) continue;
        best = surface;
      }
      // Solids not seen yet lie entirely below this layer: they cannot beat a surface inside it.
      if (best >= this.gy + iy * this.cell) break;
    }
    return best === -Infinity ? null : best;
  }

  // --- Internals ---------------------------------------------------------------------

  /** Start a new query: solids are tested at most once per stamp. */
  private nextStamp(): void {
    this.stamp = (this.stamp + 1) >>> 0;
    if (this.stamp === 0) {
      this.marks.fill(0);
      this.stamp = 1;
    }
  }

  /**
   * Long sweep: walk the path in pieces about one cell long and only visit the cells around
   * each piece, stopping as soon as the best contact found lies inside the piece just done.
   * (Every solid first touched during a piece overlaps that piece's bounds, so it has been
   * tested by then.)
   */
  private sweepSegments(
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
    dx: number,
    dy: number,
    dz: number,
    mask: number,
  ): void {
    const ax = dx < 0 ? -dx : dx;
    const ay = dy < 0 ? -dy : dy;
    const az = dz < 0 ? -dz : dz;
    const longest = ax > ay ? (ax > az ? ax : az) : ay > az ? ay : az;
    let segments = Math.ceil(longest * this.invCell);
    if (segments > MAX_SWEEP_SEGMENTS) segments = MAX_SWEEP_SEGMENTS;
    if (segments < 1) segments = 1;
    const inv = this.invCell;
    const nx = this.nx;
    const ny = this.ny;
    const nz = this.nz;
    for (let s = 0; s < segments; s++) {
      const t0 = s / segments;
      const t1 = (s + 1) / segments;
      const x0 = cx + dx * t0;
      const x1 = cx + dx * t1;
      const y0 = cy + dy * t0;
      const y1 = cy + dy * t1;
      const z0 = cz + dz * t0;
      const z1 = cz + dz * t1;
      const lx = (x0 < x1 ? x0 : x1) - hx;
      const ux = (x0 > x1 ? x0 : x1) + hx;
      const ly = (y0 < y1 ? y0 : y1) - hy;
      const uy = (y0 > y1 ? y0 : y1) + hy;
      const lz = (z0 < z1 ? z0 : z1) - hz;
      const uz = (z0 > z1 ? z0 : z1) + hz;
      if (ux >= this.gx && lx <= this.gx1 && uy >= this.gy && ly <= this.gy1 && uz >= this.gz && lz <= this.gz1) {
        let ix0 = Math.floor((lx - this.gx) * inv);
        let iy0 = Math.floor((ly - this.gy) * inv);
        let iz0 = Math.floor((lz - this.gz) * inv);
        let ix1 = Math.floor((ux - this.gx) * inv);
        let iy1 = Math.floor((uy - this.gy) * inv);
        let iz1 = Math.floor((uz - this.gz) * inv);
        if (ix0 < 0) ix0 = 0;
        if (iy0 < 0) iy0 = 0;
        if (iz0 < 0) iz0 = 0;
        if (ix1 >= nx) ix1 = nx - 1;
        if (iy1 >= ny) iy1 = ny - 1;
        if (iz1 >= nz) iz1 = nz - 1;
        this.sweepCells(cx, cy, cz, hx, hy, hz, dx, dy, dz, mask, ix0, ix1, iy0, iy1, iz0, iz1);
      }
      // The first piece contains the start box, so an initial overlap is known by now.
      if (this.startIdx >= 0 || this.bestT <= t1) return;
    }
  }

  /**
   * Test the moving box against every solid registered in a block of cells and keep the
   * earliest contact in bestT / bestSolid / bestAxis (or the lowest overlapped solid in startIdx).
   *
   * Per solid: the solid is grown by the box half extents (Minkowski sum) and the box centre
   * becomes a point moving along `delta`; entry/exit times come from the three axis slabs.
   */
  private sweepCells(
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
    dx: number,
    dy: number,
    dz: number,
    mask: number,
    ix0: number,
    ix1: number,
    iy0: number,
    iy1: number,
    iz0: number,
    iz1: number,
  ): void {
    const box = this.box;
    const flags = this.flags;
    const marks = this.marks;
    const cellStart = this.cellStart;
    const items = this.cellItems;
    const stamp = this.stamp;
    const nx = this.nx;
    const nz = this.nz;
    let bestT = this.bestT;
    let bestSolid = this.bestSolid;
    let bestAxis = this.bestAxis;
    let startIdx = this.startIdx;

    for (let iy = iy0; iy <= iy1; iy++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const row = (iy * nz + iz) * nx;
        for (let ix = ix0; ix <= ix1; ix++) {
          const c = row + ix;
          for (let k = cellStart[c]!, end = cellStart[c + 1]!; k < end; k++) {
            const i = items[k]!;
            if (marks[i] === stamp) continue;
            marks[i] = stamp;
            if ((flags[i]! & mask) !== 0) continue;
            const o = i * 6;

            // Cheap exact rejections, one axis at a time. `a*` is the signed distance from the
            // centre to the entry plane of the grown solid: the solid is out of reach when
            // that plane is farther than the move, or when the centre is already past the exit
            // plane (touching counts as past: no contact when sliding along or away).
            const ey0 = box[o + 1]! - hy;
            const ey1 = box[o + 4]! + hy;
            let ay = 0;
            if (dy > 0) {
              ay = ey0 - cy;
              if (ay > dy || cy >= ey1) continue;
            } else if (dy < 0) {
              ay = ey1 - cy;
              if (ay < dy || cy <= ey0) continue;
            } else if (cy <= ey0 || cy >= ey1) continue;

            const ex0 = box[o]! - hx;
            const ex1 = box[o + 3]! + hx;
            let ax = 0;
            if (dx > 0) {
              ax = ex0 - cx;
              if (ax > dx || cx >= ex1) continue;
            } else if (dx < 0) {
              ax = ex1 - cx;
              if (ax < dx || cx <= ex0) continue;
            } else if (cx <= ex0 || cx >= ex1) continue;

            const ez0 = box[o + 2]! - hz;
            const ez1 = box[o + 5]! + hz;
            let az = 0;
            if (dz > 0) {
              az = ez0 - cz;
              if (az > dz || cz >= ez1) continue;
            } else if (dz < 0) {
              az = ez1 - cz;
              if (az < dz || cz <= ez0) continue;
            } else if (cz <= ez0 || cz >= ez1) continue;

            // Entry = latest slab entry, exit = earliest slab exit. Divisions (not reciprocals)
            // keep the results monotonic, hence consistent with the rejections above.
            let tIn = -Infinity;
            let tOut = Infinity;
            let axis = 1;
            if (dy !== 0) {
              tIn = ay / dy;
              tOut = ((dy > 0 ? ey1 : ey0) - cy) / dy;
            }
            if (dx !== 0) {
              const t = ax / dx;
              if (t > tIn) {
                tIn = t;
                axis = 0;
              }
              const u = ((dx > 0 ? ex1 : ex0) - cx) / dx;
              if (u < tOut) tOut = u;
            }
            if (dz !== 0) {
              const t = az / dz;
              if (t > tIn) {
                tIn = t;
                axis = 2;
              }
              const u = ((dz > 0 ? ez1 : ez0) - cz) / dz;
              if (u < tOut) tOut = u;
            }
            // Misses, and paths that only graze an edge or a corner.
            if (tIn >= tOut) continue;
            if (tIn < 0) {
              // Strictly inside every slab at t = 0: the box starts in this solid.
              if (startIdx < 0 || i < startIdx) startIdx = i;
              continue;
            }
            if (tIn < bestT || (tIn === bestT && i < bestSolid)) {
              bestT = tIn;
              bestSolid = i;
              bestAxis = axis;
            }
          }
        }
      }
    }

    this.bestT = bestT;
    this.bestSolid = bestSolid;
    this.bestAxis = bestAxis;
    this.startIdx = startIdx;
  }

  /**
   * Nearest ray/solid intersection within `maxDist`, walking the grid cell by cell (3D DDA).
   * Fills rayT / raySolid / rayAxis (-1 = origin inside the solid) and returns true on a hit.
   *
   * Rays lying in a face plane. Solids are open sets here: a ray that only touches a solid
   * misses it. Alone, that rule would let a ray exactly parallel to an axis pass between two
   * boxes that share a face (the seams of a tiled floor or of a wall built from several boxes
   * sit on the same round coordinates as spawn points and nav nodes). So for such rays the
   * solids whose face plane contains the ray are remembered together with the side(s) of the
   * ray they lie on (2 sectors around a ray with one parallel axis, 4 quadrants around a ray
   * running along an axis), and the ray is stopped at the first point from which every
   * sector is filled: there it is strictly inside the union of the solids.
   */
  private castRay(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    mask: number,
  ): boolean {
    const check = ox + oy + oz + dx + dy + dz;
    if (check - check !== 0 || !(maxDist > 0)) return false;
    const px = dx > -PARALLEL_EPS && dx < PARALLEL_EPS;
    const py = dy > -PARALLEL_EPS && dy < PARALLEL_EPS;
    const pz = dz > -PARALLEL_EPS && dz < PARALLEL_EPS;
    if (px && py && pz) return false;
    const idx = px ? 0 : 1 / dx;
    const idy = py ? 0 : 1 / dy;
    const idz = pz ? 0 : 1 / dz;
    // Offsets of the near / far plane of each slab inside a solid record.
    const nearX = dx > 0 ? 0 : 3;
    const farX = 3 - nearX;
    const nearY = dy > 0 ? 1 : 4;
    const farY = 5 - nearY;
    const nearZ = dz > 0 ? 2 : 5;
    const farZ = 7 - nearZ;
    // Sector masks (4 bits, one per quadrant around the ray) of a solid lying entirely on the
    // low / high side of the ray along each parallel axis. The first parallel axis splits the
    // quadrants one way (0101 / 1010), the second the other way (0011 / 1100); a ray with a
    // single parallel axis only uses the first split, which still adds up to 1111.
    let lowY = 15;
    let highY = 15;
    let lowX = 15;
    let highX = 15;
    let lowZ = 15;
    let highZ = 15;
    let split = 0;
    if (py) {
      lowY = 5;
      highY = 10;
      split++;
    }
    if (px) {
      lowX = split === 0 ? 5 : 3;
      highX = split === 0 ? 10 : 12;
      split++;
    }
    if (pz) {
      lowZ = split === 0 ? 5 : 3;
      highZ = split === 0 ? 10 : 12;
    }

    // Clip the ray to the grid bounds.
    const gx = this.gx;
    const gy = this.gy;
    const gz = this.gz;
    let tStart = 0;
    let tEnd = maxDist;
    if (px) {
      if (ox < gx || ox > this.gx1) return false;
    } else {
      const a = ((dx > 0 ? gx : this.gx1) - ox) * idx;
      const b = ((dx > 0 ? this.gx1 : gx) - ox) * idx;
      if (a > tStart) tStart = a;
      if (b < tEnd) tEnd = b;
    }
    if (py) {
      if (oy < gy || oy > this.gy1) return false;
    } else {
      const a = ((dy > 0 ? gy : this.gy1) - oy) * idy;
      const b = ((dy > 0 ? this.gy1 : gy) - oy) * idy;
      if (a > tStart) tStart = a;
      if (b < tEnd) tEnd = b;
    }
    if (pz) {
      if (oz < gz || oz > this.gz1) return false;
    } else {
      const a = ((dz > 0 ? gz : this.gz1) - oz) * idz;
      const b = ((dz > 0 ? this.gz1 : gz) - oz) * idz;
      if (a > tStart) tStart = a;
      if (b < tEnd) tEnd = b;
    }
    if (tStart > tEnd) return false;

    // Starting cell and DDA increments.
    const cell = this.cell;
    const inv = this.invCell;
    const nx = this.nx;
    const ny = this.ny;
    const nz = this.nz;
    let ix = Math.floor((ox + dx * tStart - gx) * inv);
    let iy = Math.floor((oy + dy * tStart - gy) * inv);
    let iz = Math.floor((oz + dz * tStart - gz) * inv);
    if (ix < 0) ix = 0;
    else if (ix >= nx) ix = nx - 1;
    if (iy < 0) iy = 0;
    else if (iy >= ny) iy = ny - 1;
    if (iz < 0) iz = 0;
    else if (iz >= nz) iz = nz - 1;
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const tDeltaX = px ? Infinity : cell * (idx < 0 ? -idx : idx);
    const tDeltaY = py ? Infinity : cell * (idy < 0 ? -idy : idy);
    const tDeltaZ = pz ? Infinity : cell * (idz < 0 ? -idz : idz);
    let tMaxX = px ? Infinity : (gx + (dx > 0 ? ix + 1 : ix) * cell - ox) * idx;
    let tMaxY = py ? Infinity : (gy + (dy > 0 ? iy + 1 : iy) * cell - oy) * idy;
    let tMaxZ = pz ? Infinity : (gz + (dz > 0 ? iz + 1 : iz) * cell - oz) * idz;

    const box = this.box;
    const flags = this.flags;
    const marks = this.marks;
    const cellStart = this.cellStart;
    const items = this.cellItems;
    this.nextStamp();
    const stamp = this.stamp;
    let bestT = Infinity;
    let bestSolid = -1;
    let bestAxis = 0;
    let grazeCount = 0;

    for (;;) {
      const c = (iy * nz + iz) * nx + ix;
      for (let k = cellStart[c]!, end = cellStart[c + 1]!; k < end; k++) {
        const i = items[k]!;
        if (marks[i] === stamp) continue;
        marks[i] = stamp;
        if ((flags[i]! & mask) !== 0) continue;
        const o = i * 6;
        let tNear = -Infinity;
        let tFar = Infinity;
        let axis = 1;
        // Sectors around the ray occupied by this solid: all of them unless the ray lies in
        // the plane of one of its faces (then only those on the solid's side of that plane).
        let sectors = 15;
        if (py) {
          const lo = box[o + 1]! + SEAM_EPS;
          const hi = box[o + 4]! - SEAM_EPS;
          if (oy <= lo || oy >= hi) {
            if (oy < lo - 2 * SEAM_EPS || oy > hi + 2 * SEAM_EPS) continue;
            sectors &= oy <= lo ? highY : lowY;
          }
        } else {
          tNear = (box[o + nearY]! - oy) * idy;
          tFar = (box[o + farY]! - oy) * idy;
          if (tFar <= 0) continue;
        }
        if (px) {
          const lo = box[o]! + SEAM_EPS;
          const hi = box[o + 3]! - SEAM_EPS;
          if (ox <= lo || ox >= hi) {
            if (ox < lo - 2 * SEAM_EPS || ox > hi + 2 * SEAM_EPS) continue;
            sectors &= ox <= lo ? highX : lowX;
          }
        } else {
          const a = (box[o + nearX]! - ox) * idx;
          const b = (box[o + farX]! - ox) * idx;
          if (a > tNear) {
            tNear = a;
            axis = 0;
          }
          if (b < tFar) tFar = b;
        }
        if (pz) {
          const lo = box[o + 2]! + SEAM_EPS;
          const hi = box[o + 5]! - SEAM_EPS;
          if (oz <= lo || oz >= hi) {
            if (oz < lo - 2 * SEAM_EPS || oz > hi + 2 * SEAM_EPS) continue;
            sectors &= oz <= lo ? highZ : lowZ;
          }
        } else {
          const a = (box[o + nearZ]! - oz) * idz;
          const b = (box[o + farZ]! - oz) * idz;
          if (a > tNear) {
            tNear = a;
            axis = 2;
          }
          if (b < tFar) tFar = b;
        }
        // Miss or graze, or solid entirely behind the origin.
        if (tNear >= tFar || tFar <= 0) continue;
        if (tNear < 0) {
          // Origin strictly inside the solid (or, for a grazing solid, alongside it).
          tNear = 0;
          axis = -1;
        }
        if (tNear > tEnd) continue;
        if (sectors !== 15) {
          // The ray runs along a face of this solid: not a hit by itself, see below.
          this.grazeT0[grazeCount] = tNear;
          this.grazeT1[grazeCount] = tFar;
          this.grazeSectors[grazeCount] = sectors;
          this.grazeSolid[grazeCount] = i;
          this.grazeAxis[grazeCount] = axis;
          grazeCount++;
          continue;
        }
        if (tNear < bestT || (tNear === bestT && i < bestSolid)) {
          bestT = tNear;
          bestSolid = i;
          bestAxis = axis;
        }
      }

      // Leave the cell through its nearest boundary. A hit located before that boundary
      // cannot be beaten by anything in the cells further along the ray.
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          if (bestT <= tMaxX || tMaxX > tEnd) break;
          ix += stepX;
          if (ix < 0 || ix >= nx) break;
          tMaxX += tDeltaX;
        } else {
          if (bestT <= tMaxZ || tMaxZ > tEnd) break;
          iz += stepZ;
          if (iz < 0 || iz >= nz) break;
          tMaxZ += tDeltaZ;
        }
      } else if (tMaxY < tMaxZ) {
        if (bestT <= tMaxY || tMaxY > tEnd) break;
        iy += stepY;
        if (iy < 0 || iy >= ny) break;
        tMaxY += tDeltaY;
      } else {
        if (bestT <= tMaxZ || tMaxZ > tEnd) break;
        iz += stepZ;
        if (iz < 0 || iz >= nz) break;
        tMaxZ += tDeltaZ;
      }
    }

    if (grazeCount > 1) {
      // Earliest point, before any ordinary hit, from which solids fill every sector around
      // the ray. Full cover can only begin where one of the grazing solids begins; every
      // solid counted must extend beyond that point (two boxes meeting corner to corner
      // leave a pinhole). Ties: lowest solid index, like ordinary hits.
      const t0 = this.grazeT0;
      const t1 = this.grazeT1;
      const sectors = this.grazeSectors;
      const solid = this.grazeSolid;
      let seam = false;
      for (let a = 0; a < grazeCount; a++) {
        const t = t0[a]!;
        if (t > bestT || (t === bestT && (!seam || solid[a]! > bestSolid))) continue;
        let cover = 0;
        for (let b = 0; b < grazeCount; b++) {
          if (t0[b]! <= t && t < t1[b]!) cover |= sectors[b]!;
        }
        if (cover !== 15) continue;
        bestT = t;
        bestSolid = solid[a]!;
        bestAxis = this.grazeAxis[a]!;
        seam = true;
      }
    }

    if (bestSolid < 0) return false;
    this.rayT = bestT;
    this.raySolid = bestSolid;
    this.rayAxis = bestAxis;
    return true;
  }
}
