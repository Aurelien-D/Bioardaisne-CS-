/**
 * Navigation grid generated automatically from the collision world (no hand-placed
 * waypoints): walkable cells on every floor level, connected across steps/stairs
 * and safe drops, plus A* path-finding. Used by bots and by the map validator.
 *
 * CONTRACT FILE — see docs/ARCHITECTURE.md §Navigation.
 */
import type { Vec3 } from '../math/vec3';
import type { MapData } from '../maps/types';
import type { CollisionWorld } from '../physics/world';

export interface NavStats {
  /** Number of walkable nodes. */
  nodes: number;
  /** Number of connected regions (after ignoring tiny islands). */
  regions: number;
  /** Size (node count) of the largest region. */
  largest: number;
  buildMs: number;
}

export class NavGrid {
  readonly stats: NavStats = { nodes: 0, regions: 0, largest: 0, buildMs: 0 };

  /** Build the grid for a map. `cell` = horizontal resolution in metres. */
  static build(world: CollisionWorld, map: MapData, cell = 0.5): NavGrid {
    void world, map, cell;
    throw new Error('NavGrid.build: not implemented');
  }

  /**
   * Shortest walkable path between two points (feet positions). Returns smoothed
   * waypoints (feet positions, excluding `from`, ending at/near `to`), or null if unreachable.
   */
  findPath(from: Vec3, to: Vec3): Vec3[] | null {
    void from, to;
    throw new Error('not implemented');
  }

  /** Closest walkable position to `p` within `maxDist` (default 3 m), or null. */
  nearest(p: Vec3, maxDist?: number): Vec3 | null {
    void p, maxDist;
    throw new Error('not implemented');
  }

  /** True if both points snap to the same connected region. */
  reachable(a: Vec3, b: Vec3): boolean {
    void a, b;
    throw new Error('not implemented');
  }

  /** Random walkable point in the main region (uniform over nodes). */
  randomPoint(rng: () => number): Vec3 {
    void rng;
    throw new Error('not implemented');
  }

  /** Random walkable point within `radius` of `center` (falls back to nearest). */
  randomPointNear(center: Vec3, radius: number, rng: () => number): Vec3 {
    void center, radius, rng;
    throw new Error('not implemented');
  }

  /** True if a player hull can walk in a straight line from a to b (used for path smoothing / strafing checks). */
  walkable(a: Vec3, b: Vec3): boolean {
    void a, b;
    throw new Error('not implemented');
  }
}
