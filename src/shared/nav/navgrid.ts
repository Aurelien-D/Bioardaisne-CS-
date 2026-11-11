/**
 * Navigation grid generated automatically from the collision world (no hand-placed
 * waypoints): walkable cells on every floor level, connected across steps/stairs
 * and safe drops, plus A* path-finding. Used by bots and by the map validator.
 * See docs/ARCHITECTURE.md §8.
 */
import { PLAYER_HALF_WIDTH, PLAYER_HEIGHT, STEP_HEIGHT } from '../constants';
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

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DZ = [0, 1, 1, 1, 0, -1, -1, -1];
const MAX_DROP = 2.5;
const LIFT = 0.004; // hull rests slightly above the floor (matches movement)

export class NavGrid {
  readonly stats: NavStats = { nodes: 0, regions: 0, largest: 0, buildMs: 0 };

  private world!: CollisionWorld;
  private cell = 0.5;
  private x0 = 0;
  private z0 = 0;
  private nx = 0;
  private nz = 0;
  /** Node coordinates. */
  private px: number[] = [];
  private py: number[] = [];
  private pz: number[] = [];
  /** First node of each column and next node in the same column (-1 = none). */
  private colHead!: Int32Array;
  private colNext: number[] = [];
  /** Neighbour node per direction (8 per node), -1 = none. */
  private adj!: Int32Array;
  private region!: Int32Array;
  private mainRegion = -1;
  private mainNodes: number[] = [];
  // A* scratch
  private g!: Float32Array;
  private from!: Int32Array;
  private stamp!: Int32Array;
  private closed!: Uint8Array;
  private stampN = 0;
  private heap: number[] = [];
  private heapF: number[] = [];

  /** Build the grid for a map. `cell` = horizontal resolution in metres. */
  static build(world: CollisionWorld, map: MapData, cell = 0.5): NavGrid {
    const nav = new NavGrid();
    nav.world = world;
    nav.cell = cell;
    const b = map.bounds;
    nav.x0 = Math.floor(b.min.x / cell) * cell;
    nav.z0 = Math.floor(b.min.z / cell) * cell;
    nav.nx = Math.ceil((b.max.x - nav.x0) / cell) + 1;
    nav.nz = Math.ceil((b.max.z - nav.z0) / cell) + 1;
    nav.colHead = new Int32Array(nav.nx * nav.nz).fill(-1);

    // Standing room is tested above knee height: anything lower than STEP_HEIGHT can be
    // stepped over, which is what makes staircases walkable for a 0.7 m wide hull.
    const half = { x: PLAYER_HALF_WIDTH, y: (PLAYER_HEIGHT - STEP_HEIGHT) / 2, z: PLAYER_HALF_WIDTH };
    const RAISE = STEP_HEIGHT + LIFT + half.y;
    const tiny = { x: 0.04, y: 0.04, z: 0.04 };
    const c = { x: 0, y: 0, z: 0 };
    // 1. Nodes: tops of solids where a standing hull fits.
    for (const s of world.solids) {
      if (s.noPlayers) continue;
      if (s.max.x - s.min.x < 1e-4 || s.max.z - s.min.z < 1e-4) continue;
      const top = s.max.y;
      if (top < map.killY || top > b.max.y) continue;
      const ix0 = Math.max(0, Math.ceil((s.min.x - nav.x0) / cell - 1e-6));
      const ix1 = Math.min(nav.nx - 1, Math.floor((s.max.x - nav.x0) / cell + 1e-6));
      const iz0 = Math.max(0, Math.ceil((s.min.z - nav.z0) / cell - 1e-6));
      const iz1 = Math.min(nav.nz - 1, Math.floor((s.max.z - nav.z0) / cell + 1e-6));
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const col = iz * nav.nx + ix;
          // Skip duplicates (two solids with the same top in this column).
          let dup = false;
          for (let n = nav.colHead[col]!; n >= 0; n = nav.colNext[n]!) {
            if (Math.abs(nav.py[n]! - top) < 0.05) {
              dup = true;
              break;
            }
          }
          if (dup) continue;
          c.x = nav.x0 + ix * cell;
          c.z = nav.z0 + iz * cell;
          c.y = top + 0.06;
          if (world.boxOverlaps(c, tiny)) continue; // buried under another solid
          c.y = top + RAISE;
          if (world.boxOverlaps(c, half)) continue;
          const id = nav.px.length;
          nav.px.push(c.x);
          nav.py.push(top);
          nav.pz.push(c.z);
          nav.colNext.push(nav.colHead[col]!);
          nav.colHead[col] = id;
        }
      }
    }
    const count = nav.px.length;

    // 2. Edges.
    nav.adj = new Int32Array(count * 8).fill(-1);
    const delta = { x: 0, y: 0, z: 0 };
    const down = { x: 0, y: 0, z: 0 };
    for (let n = 0; n < count; n++) {
      const ix = Math.round((nav.px[n]! - nav.x0) / cell);
      const iz = Math.round((nav.pz[n]! - nav.z0) / cell);
      const y = nav.py[n]!;
      for (let d = 0; d < 8; d++) {
        const jx = ix + DX[d]!;
        const jz = iz + DZ[d]!;
        if (jx < 0 || jz < 0 || jx >= nav.nx || jz >= nav.nz) continue;
        // Best candidate in the neighbour column: highest node reachable.
        let best = -1;
        for (let m = nav.colHead[jz * nav.nx + jx]!; m >= 0; m = nav.colNext[m]!) {
          const dy = nav.py[m]! - y;
          if (dy > STEP_HEIGHT + 1e-3 || dy < -MAX_DROP) continue;
          if (best < 0 || nav.py[m]! > nav.py[best]!) best = m;
        }
        if (best < 0) continue;
        const dy = nav.py[best]! - y;
        // The hull must be able to slide horizontally at the higher of the two floors…
        c.x = nav.px[n]!;
        c.z = nav.pz[n]!;
        c.y = Math.max(y, nav.py[best]!) + RAISE;
        if (dy > 0.01 && world.boxOverlaps(c, half)) continue; // no headroom to step up
        delta.x = DX[d]! * cell;
        delta.z = DZ[d]! * cell;
        if (world.sweepBox(c, half, delta).hit) continue;
        // …and, for a drop, fall freely onto the lower floor.
        if (dy < -STEP_HEIGHT) {
          c.x = nav.px[best]!;
          c.z = nav.pz[best]!;
          down.y = dy;
          const tr = world.sweepBox(c, half, down);
          if (tr.hit && tr.fraction < 0.98) continue;
        }
        nav.adj[n * 8 + d] = best;
      }
    }

    // 3. Regions (two-way connectivity only), largest = main.
    nav.region = new Int32Array(count).fill(-1);
    let regions = 0;
    let largest = 0;
    const stack: number[] = [];
    for (let n = 0; n < count; n++) {
      if (nav.region[n]! >= 0) continue;
      const id = regions++;
      let size = 0;
      stack.push(n);
      nav.region[n] = id;
      while (stack.length) {
        const a = stack.pop()!;
        size++;
        for (let d = 0; d < 8; d++) {
          const m = nav.adj[a * 8 + d]!;
          if (m < 0 || nav.region[m]! >= 0) continue;
          if (nav.adj[m * 8 + ((d + 4) & 7)]! !== a) continue; // one-way (drop)
          nav.region[m] = id;
          stack.push(m);
        }
      }
      if (size > largest) {
        largest = size;
        nav.mainRegion = id;
      }
    }
    // The main region is the one the players spawn in (roofs can be larger than the playable floor).
    const votes = new Map<number, number>();
    for (const sp of map.spawns) {
      const n = nav.nodeAt(sp.pos, 1.5, false);
      if (n >= 0) votes.set(nav.region[n]!, (votes.get(nav.region[n]!) ?? 0) + 1);
    }
    let bestVotes = 0;
    for (const [id, v] of votes) {
      if (v > bestVotes) {
        bestVotes = v;
        nav.mainRegion = id;
      }
    }
    for (let n = 0; n < count; n++) if (nav.region[n] === nav.mainRegion) nav.mainNodes.push(n);

    nav.g = new Float32Array(count);
    nav.from = new Int32Array(count);
    nav.stamp = new Int32Array(count);
    nav.closed = new Uint8Array(count);
    nav.stats.nodes = count;
    nav.stats.regions = regions;
    nav.stats.largest = largest;
    return nav;
  }

  // ------------------------------------------------------------------ queries

  /** Node closest to `p` (same column first, then growing rings). */
  private nodeAt(p: Vec3, maxDist: number, mainOnly: boolean): number {
    const ix = Math.round((p.x - this.x0) / this.cell);
    const iz = Math.round((p.z - this.z0) / this.cell);
    const rings = Math.ceil(maxDist / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r <= rings; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const jx = ix + dx;
          const jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= this.nx || jz >= this.nz) continue;
          for (let n = this.colHead[jz * this.nx + jx]!; n >= 0; n = this.colNext[n]!) {
            if (mainOnly && this.region[n] !== this.mainRegion) continue;
            const ddx = this.px[n]! - p.x;
            const ddy = (this.py[n]! - p.y) * 2; // prefer the same floor
            const ddz = this.pz[n]! - p.z;
            const d = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d < bestD) {
              bestD = d;
              best = n;
            }
          }
        }
      }
      if (best >= 0 && r * this.cell > Math.sqrt(bestD)) break;
    }
    return best >= 0 && bestD <= maxDist * maxDist * 4 ? best : -1;
  }

  private nodePos(n: number): Vec3 {
    return { x: this.px[n]!, y: this.py[n]!, z: this.pz[n]! };
  }

  /** Closest walkable position to `p` within `maxDist` (default 3 m), or null. */
  nearest(p: Vec3, maxDist = 3): Vec3 | null {
    const n = this.nodeAt(p, maxDist, true);
    return n < 0 ? null : this.nodePos(n);
  }

  /** True if both points snap to the same connected region. */
  reachable(a: Vec3, b: Vec3): boolean {
    const na = this.nodeAt(a, 3, false);
    const nb = this.nodeAt(b, 3, false);
    return na >= 0 && nb >= 0 && this.region[na] === this.region[nb];
  }

  /** Random walkable point in the main region (uniform over nodes). */
  randomPoint(rng: () => number): Vec3 {
    if (!this.mainNodes.length) return { x: 0, y: 0, z: 0 };
    return this.nodePos(this.mainNodes[Math.floor(rng() * this.mainNodes.length)]!);
  }

  /** Random walkable point within `radius` of `center` (falls back to nearest). */
  randomPointNear(center: Vec3, radius: number, rng: () => number): Vec3 {
    for (let i = 0; i < 12; i++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * radius;
      const n = this.nodeAt({ x: center.x + Math.cos(a) * r, y: center.y, z: center.z + Math.sin(a) * r }, 1, true);
      if (n >= 0) return this.nodePos(n);
    }
    return this.nearest(center, radius + 3) ?? this.randomPoint(rng);
  }

  /** True if a player hull can walk in a straight line from a to b on (nearly) flat ground. */
  walkable(a: Vec3, b: Vec3): boolean {
    if (Math.abs(a.y - b.y) > 0.3) return false;
    const half = { x: PLAYER_HALF_WIDTH, y: PLAYER_HEIGHT / 2 - 0.15, z: PLAYER_HALF_WIDTH };
    const y = Math.max(a.y, b.y) + 0.3 + half.y;
    const d = { x: b.x - a.x, y: 0, z: b.z - a.z };
    if (this.world.sweepBox({ x: a.x, y, z: a.z }, half, d).hit) return false;
    // No hole along the way.
    const len = Math.hypot(d.x, d.z);
    const steps = Math.ceil(len / 0.5);
    const p = { x: 0, y: 0, z: 0 };
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      p.x = a.x + d.x * t;
      p.z = a.z + d.z * t;
      p.y = a.y + (b.y - a.y) * t + 0.3;
      const g = this.world.groundBelow(p, 0.3 + STEP_HEIGHT);
      if (g === null) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ A*

  private push(n: number, f: number): void {
    const h = this.heap;
    const hf = this.heapF;
    let i = h.length;
    h.push(n);
    hf.push(f);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (hf[parent]! <= f) break;
      h[i] = h[parent]!;
      hf[i] = hf[parent]!;
      i = parent;
    }
    h[i] = n;
    hf[i] = f;
  }

  private pop(): number {
    const h = this.heap;
    const hf = this.heapF;
    const top = h[0]!;
    const last = h.pop()!;
    const lf = hf.pop()!;
    const len = h.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= len) break;
        if (c + 1 < len && hf[c + 1]! < hf[c]!) c++;
        if (hf[c]! >= lf) break;
        h[i] = h[c]!;
        hf[i] = hf[c]!;
        i = c;
      }
      h[i] = last;
      hf[i] = lf;
    }
    return top;
  }

  /**
   * Shortest walkable path between two points (feet positions). Returns smoothed
   * waypoints (excluding `from`, ending at/near `to`), or null if unreachable.
   */
  findPath(from: Vec3, to: Vec3): Vec3[] | null {
    const start = this.nodeAt(from, 3, false);
    const goal = this.nodeAt(to, 3, false);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [this.nodePos(goal)];
    const st = ++this.stampN;
    this.heap.length = 0;
    this.heapF.length = 0;
    const gx = this.px[goal]!;
    const gy = this.py[goal]!;
    const gz = this.pz[goal]!;
    const h = (n: number): number => Math.hypot(this.px[n]! - gx, (this.py[n]! - gy) * 1.5, this.pz[n]! - gz);
    this.stamp[start] = st;
    this.g[start] = 0;
    this.from[start] = -1;
    this.closed[start] = 0;
    this.push(start, h(start));
    let expanded = 0;
    let found = false;
    while (this.heap.length) {
      const n = this.pop();
      if (this.closed[n]) continue;
      this.closed[n] = 1;
      if (n === goal) {
        found = true;
        break;
      }
      if (++expanded > 80000) break;
      const gn = this.g[n]!;
      for (let d = 0; d < 8; d++) {
        const m = this.adj[n * 8 + d]!;
        if (m < 0) continue;
        const dy = this.py[m]! - this.py[n]!;
        let cost = (d & 1 ? 1.4142 : 1) * this.cell + Math.abs(dy) * 1.5;
        if (dy < -STEP_HEIGHT) cost += 1.5; // drops are a little discouraged
        const g = gn + cost;
        if (this.stamp[m] !== st) {
          this.stamp[m] = st;
          this.closed[m] = 0;
        } else if (this.closed[m] || g >= this.g[m]!) continue;
        this.g[m] = g;
        this.from[m] = n;
        this.push(m, g + h(m));
      }
    }
    if (!found) return null;
    const raw: Vec3[] = [];
    for (let n = goal; n >= 0 && n !== start; n = this.from[n]!) raw.push(this.nodePos(n));
    raw.reverse();
    // String pulling on flat stretches.
    const out: Vec3[] = [];
    let anchor: Vec3 = { x: from.x, y: this.py[start]!, z: from.z };
    let i = 0;
    while (i < raw.length) {
      let j = i;
      const limit = Math.min(raw.length - 1, i + 24);
      for (let k = limit; k > i; k--) {
        if (this.walkable(anchor, raw[k]!)) {
          j = k;
          break;
        }
      }
      out.push(raw[j]!);
      anchor = raw[j]!;
      i = j + 1;
    }
    return out;
  }
}
