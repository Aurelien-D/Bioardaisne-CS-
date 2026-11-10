/**
 * Static collision world made of axis-aligned solids, with a uniform-grid broadphase.
 * Used by player movement (swept AABB), hitscan (ray casts), bots (line of sight),
 * the nav grid generator and the light baker.
 *
 * CONTRACT FILE — signatures are fixed (see docs/ARCHITECTURE.md §Physique).
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

export class CollisionWorld {
  readonly solids: readonly Solid[];

  constructor(solids: readonly Solid[]) {
    this.solids = solids;
    throw new Error('CollisionWorld: not implemented');
  }

  /**
   * Sweep an axis-aligned box (centre + half extents) along `delta` against the world.
   * Never returns a position inside a solid: callers move by `delta * fraction`
   * (the implementation backs off by a small epsilon itself).
   */
  sweepBox(center: Vec3, half: Vec3, delta: Vec3, mask: number = MASK.Player): Trace {
    void center, half, delta, mask;
    throw new Error('not implemented');
  }

  /** True if the box overlaps any solid. */
  boxOverlaps(center: Vec3, half: Vec3, mask: number = MASK.Player): boolean {
    void center, half, mask;
    throw new Error('not implemented');
  }

  /** Cast a ray (`dir` must be normalised). Returns the nearest hit within `maxDist`, or null. */
  raycast(origin: Vec3, dir: Vec3, maxDist: number, mask: number = MASK.Bullet): RayHit | null {
    void origin, dir, maxDist, mask;
    throw new Error('not implemented');
  }

  /** True if no solid blocks the segment a -> b. */
  lineOfSight(a: Vec3, b: Vec3, mask: number = MASK.Bullet): boolean {
    void a, b, mask;
    throw new Error('not implemented');
  }

  /**
   * Y of the highest walkable surface under `pos` (looking down at most `maxDrop`),
   * or null if there is none. Uses the Player mask.
   */
  groundBelow(pos: Vec3, maxDrop: number): number | null {
    void pos, maxDrop;
    throw new Error('not implemented');
  }
}
