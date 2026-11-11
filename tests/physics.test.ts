import { describe, expect, it } from 'vitest';
import { getMap } from '../src/shared/maps';
import type { Solid } from '../src/shared/maps/types';
import { mulberry32 } from '../src/shared/math/rng';
import type { Vec3 } from '../src/shared/math/vec3';
import { CollisionWorld, MASK, type Trace } from '../src/shared/physics/world';

// --- Helpers -------------------------------------------------------------------------

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

function solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<Solid> = {}): Solid {
  return { min: v(x0, y0, z0), max: v(x1, y1, z1), surf: 'concrete', ...extra };
}

/** Sweep back-off of the implementation (1 mm). */
const BACKOFF = 1e-3;
const PLAYER = v(0.35, 0.9, 0.35);

const moved = (c: Vec3, d: Vec3, tr: Trace): Vec3 => v(c.x + d.x * tr.fraction, c.y + d.y * tr.fraction, c.z + d.z * tr.fraction);

// --- Reference implementations (no broadphase, written independently) --------------------

type V3 = [number, number, number];
const arr = (p: Vec3): V3 => [p.x, p.y, p.z];

interface RefSolid {
  lo: V3;
  hi: V3;
  noPlayers: boolean;
  noBullets: boolean;
  degenerate: boolean;
}

const toRef = (solids: readonly Solid[]): RefSolid[] =>
  solids.map((s) => ({
    lo: arr(s.min),
    hi: arr(s.max),
    noPlayers: !!s.noPlayers,
    noBullets: !!s.noBullets,
    degenerate: !(s.max.x > s.min.x && s.max.y > s.min.y && s.max.z > s.min.z),
  }));

const skipped = (s: RefSolid, mask: number): boolean =>
  s.degenerate || ((mask & MASK.Player) !== 0 && s.noPlayers) || ((mask & MASK.Bullet) !== 0 && s.noBullets);

/** Tie-break priority of the contact axis: Y, then X, then Z. */
const AXES = [1, 0, 2] as const;
const unit = (axis: number, sign: number): Vec3 => v(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);

interface RefSweep {
  hit: boolean;
  startSolid: boolean;
  fraction: number;
  solid: number;
  normal: Vec3;
}

function refSweep(solids: readonly RefSolid[], center: Vec3, half: Vec3, delta: Vec3, mask: number): RefSweep {
  const c = arr(center);
  const h = arr(half);
  const d = arr(delta);
  let best = Infinity;
  let bestSolid = -1;
  let bestAxis = 1;
  let start = -1;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]!;
    if (skipped(s, mask)) continue;
    let tIn = -Infinity;
    let tOut = Infinity;
    let axis = 1;
    let miss = false;
    for (const a of AXES) {
      const e0 = s.lo[a] - h[a];
      const e1 = s.hi[a] + h[a];
      if (d[a] === 0) {
        if (c[a] <= e0 || c[a] >= e1) miss = true;
        continue;
      }
      const tA = ((d[a] > 0 ? e0 : e1) - c[a]) / d[a];
      const tB = ((d[a] > 0 ? e1 : e0) - c[a]) / d[a];
      if (tA > tIn) {
        tIn = tA;
        axis = a;
      }
      if (tB < tOut) tOut = tB;
    }
    if (miss || tIn >= tOut || tOut <= 0 || tIn > 1) continue;
    if (tIn < 0) {
      if (start < 0) start = i;
      continue;
    }
    if (tIn < best) {
      best = tIn;
      bestSolid = i;
      bestAxis = axis;
    }
  }
  if (start >= 0) return { hit: true, startSolid: true, fraction: 0, solid: start, normal: v(0, 0, 0) };
  if (bestSolid < 0) return { hit: false, startSolid: false, fraction: 1, solid: -1, normal: v(0, 0, 0) };
  const along = d[bestAxis]!;
  const fraction = Math.max(0, best - BACKOFF / Math.abs(along));
  return { hit: true, startSolid: false, fraction, solid: bestSolid, normal: unit(bestAxis, along > 0 ? -1 : 1) };
}

function refOverlap(solids: readonly RefSolid[], center: Vec3, half: Vec3, mask: number): boolean {
  const c = arr(center);
  const h = arr(half);
  for (const s of solids) {
    if (skipped(s, mask)) continue;
    if (
      c[0] > s.lo[0] - h[0] &&
      c[0] < s.hi[0] + h[0] &&
      c[1] > s.lo[1] - h[1] &&
      c[1] < s.hi[1] + h[1] &&
      c[2] > s.lo[2] - h[2] &&
      c[2] < s.hi[2] + h[2]
    ) {
      return true;
    }
  }
  return false;
}

interface RefRay {
  dist: number;
  solid: number;
  /** Null when the origin is inside the solid. */
  normal: Vec3 | null;
}

/**
 * Distance by which the reference pushes a ray off a face plane it lies in (see refRay): more
 * than the 1 nm within which the implementation considers a ray to be "in" a plane.
 */
const NUDGE = 1e-7;

/**
 * Reference ray cast. Solids are open boxes and the solid space is the interior of their
 * union. A ray in general position is simply tested against every box. A ray exactly
 * parallel to an axis may lie in a face plane: it is replaced by copies pushed a hair to
 * either side of its position along each parallel axis (2 or 4 copies), and it is blocked
 * from the first point where every copy is inside a solid. So a ray sliding along a wall is
 * free, while a ray inside the seam between two boxes of the same wall is not.
 * Ties: a solid crossed through its interior wins over solids merely alongside the ray,
 * then the lowest index.
 */
function refRay(solids: readonly RefSolid[], origin: Vec3, dir: Vec3, maxDist: number, mask: number): RefRay | null {
  const o = arr(origin);
  const d = arr(dir);
  const inv: V3 = [1 / d[0], 1 / d[1], 1 / d[2]];
  const parallel = AXES.filter((a) => d[a] === 0);
  const copies = 1 << parallel.length;
  const allCopies = (1 << copies) - 1;
  // Bit masks of the copies pushed toward the low / high side along the k-th parallel axis.
  const lowCopies: number[] = [];
  const highCopies: number[] = [];
  for (let k = 0; k < parallel.length; k++) {
    let high = 0;
    for (let copy = 0; copy < copies; copy++) if (((copy >> k) & 1) === 1) high |= 1 << copy;
    highCopies.push(high);
    lowCopies.push(allCopies & ~high);
  }
  // Intervals [t0, t1) during which copies of the ray (bit mask `inside`) are inside a solid.
  const spans: { t0: number; t1: number; solid: number; axis: number; inside: number }[] = [];
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]!;
    if (skipped(s, mask)) continue;
    // Copies whose pushed origin is strictly inside the solid along every parallel axis.
    let inside = allCopies;
    for (let k = 0; k < parallel.length; k++) {
      const a = parallel[k]!;
      const low = o[a] - NUDGE;
      const high = o[a] + NUDGE;
      if (low <= s.lo[a] || low >= s.hi[a]) inside &= ~lowCopies[k]!;
      if (high <= s.lo[a] || high >= s.hi[a]) inside &= ~highCopies[k]!;
    }
    if (inside === 0) continue;
    let tNear = -Infinity;
    let tFar = Infinity;
    let axis = 1;
    for (const a of AXES) {
      if (d[a] === 0) continue;
      const tA = ((d[a] > 0 ? s.lo[a] : s.hi[a]) - o[a]) * inv[a];
      const tB = ((d[a] > 0 ? s.hi[a] : s.lo[a]) - o[a]) * inv[a];
      if (tA > tNear) {
        tNear = tA;
        axis = a;
      }
      if (tB < tFar) tFar = tB;
    }
    if (tNear >= tFar || tFar <= 0) continue;
    if (tNear < 0) {
      tNear = 0;
      axis = -1;
    }
    if (tNear > maxDist) continue;
    spans.push({ t0: tNear, t1: tFar, solid: i, axis, inside });
  }
  // Earliest point from which every copy is inside some solid.
  spans.sort((a, b) => a.t0 - b.t0);
  let first = -1;
  for (let k = 0; k < spans.length && first < 0; k++) {
    const t = spans[k]!.t0;
    if (k > 0 && spans[k - 1]!.t0 === t) continue;
    let covered = 0;
    for (const other of spans) {
      if (other.t0 > t) break;
      if (t < other.t1) covered |= other.inside;
    }
    if (covered === allCopies) first = k;
  }
  if (first < 0) return null;
  // Among the solids entered at that point: one crossed through its interior (it blocks every
  // copy by itself) wins over solids merely alongside the ray, then the lowest index.
  const t = spans[first]!.t0;
  let best = spans[first]!;
  for (let k = first + 1; k < spans.length && spans[k]!.t0 === t; k++) {
    const sp = spans[k]!;
    const through = sp.inside === allCopies;
    const bestThrough = best.inside === allCopies;
    if ((through && !bestThrough) || (through === bestThrough && sp.solid < best.solid)) best = sp;
  }
  return { dist: best.t0, solid: best.solid, normal: best.axis < 0 ? null : unit(best.axis, d[best.axis]! > 0 ? -1 : 1) };
}

/** 3000 random boxes in a 100 x 20 x 100 m volume (the performance target of the architecture doc). */
function randomSolids(seed: number, count: number, snap = 0): Solid[] {
  const rng = mulberry32(seed);
  const q = (n: number): number => (snap > 0 ? Math.round(n / snap) * snap : n);
  const out: Solid[] = [];
  for (let i = 0; i < count; i++) {
    const cx = q(-50 + rng() * 100);
    const cy = q(rng() * 20);
    const cz = q(-50 + rng() * 100);
    const hx = Math.max(q(0.25 + rng() * 1.75), 0.25);
    const hy = Math.max(q(0.25 + rng() * 1.75), 0.25);
    const hz = Math.max(q(0.25 + rng() * 1.75), 0.25);
    const s = solid(cx - hx, cy - hy, cz - hz, cx + hx, cy + hy, cz + hz);
    const r = rng();
    if (r < 0.05) s.noBullets = true;
    else if (r < 0.1) s.noPlayers = true;
    out.push(s);
  }
  return out;
}

function randomDir(rng: () => number): Vec3 {
  for (;;) {
    const x = rng() * 2 - 1;
    const y = rng() * 2 - 1;
    const z = rng() * 2 - 1;
    const l = Math.hypot(x, y, z);
    if (l > 0.05 && l <= 1) return v(x / l, y / l, z / l);
  }
}

// --- Tests -----------------------------------------------------------------------------

describe('CollisionWorld.sweepBox', () => {
  // One 2 m cube: x, y, z in [0, 2].
  const world = new CollisionWorld([solid(0, 0, 0, 2, 2, 2)]);
  const half = v(0.5, 0.5, 0.5);

  it('hits the cube from all six directions with the right normal and fraction', () => {
    const cases: { from: Vec3; delta: Vec3; normal: Vec3 }[] = [
      { from: v(-3, 1, 1), delta: v(4, 0, 0), normal: v(-1, 0, 0) },
      { from: v(5, 1, 1), delta: v(-4, 0, 0), normal: v(1, 0, 0) },
      { from: v(1, -3, 1), delta: v(0, 4, 0), normal: v(0, -1, 0) },
      { from: v(1, 5, 1), delta: v(0, -4, 0), normal: v(0, 1, 0) },
      { from: v(1, 1, -3), delta: v(0, 0, 4), normal: v(0, 0, -1) },
      { from: v(1, 1, 5), delta: v(0, 0, -4), normal: v(0, 0, 1) },
    ];
    for (const c of cases) {
      const tr = world.sweepBox(c.from, half, c.delta);
      expect(tr.hit).toBe(true);
      expect(tr.startSolid).toBe(false);
      expect(tr.solid).toBe(0);
      expect(tr.normal).toEqual(c.normal);
      // 2.5 m of free travel out of 4, minus the 1 mm back-off.
      expect(tr.fraction).toBeCloseTo((2.5 - BACKOFF) / 4, 12);
      expect(world.boxOverlaps(moved(c.from, c.delta, tr), half)).toBe(false);
    }
  });

  it('reports the first face reached on a diagonal approach', () => {
    // Reaches the x = 0 face long before the z = 0 face.
    let tr = world.sweepBox(v(-2, 1, -0.4), half, v(3, 0, 0.3));
    expect(tr.hit).toBe(true);
    expect(tr.normal).toEqual(v(-1, 0, 0));
    // Mostly downward: lands on the top face.
    tr = world.sweepBox(v(1.2, 4, 1.1), half, v(0.2, -3, -0.1));
    expect(tr.normal).toEqual(v(0, 1, 0));
    expect(tr.fraction).toBeCloseTo((1.5 - BACKOFF) / 3, 12);
  });

  it('misses when the path stops short or passes beside the cube', () => {
    expect(world.sweepBox(v(-3, 1, 1), half, v(2.4, 0, 0)).hit).toBe(false);
    expect(world.sweepBox(v(-3, 1, 1), half, v(2.4, 0, 0)).fraction).toBe(1);
    expect(world.sweepBox(v(-3, 1, 3.6), half, v(8, 0, 0)).hit).toBe(false);
    expect(world.sweepBox(v(-3, 3.2, 1), half, v(8, 0, 0)).hit).toBe(false);
    expect(world.sweepBox(v(-3, 1, 1), half, v(-5, 0, 0)).hit).toBe(false);
  });

  it('does not collide when touching a face and moving parallel to it or away from it', () => {
    // Resting exactly on the top face (bottom of the box at y = 2).
    const onTop = v(1, 2.5, 1);
    for (const d of [v(3, 0, 0), v(-3, 0, 0), v(0, 0, 3), v(2, 0, -2), v(0, 1, 0), v(1, 0.5, 1)]) {
      const tr = world.sweepBox(onTop, half, d);
      expect(tr.hit).toBe(false);
      expect(tr.fraction).toBe(1);
    }
    // Pressed exactly against the x = 0 face.
    const beside = v(-0.5, 1, 1);
    for (const d of [v(0, 0, 4), v(0, 0, -4), v(0, 3, 0), v(0, -3, 0), v(-1, 0, 2), v(0, 2, 2)]) {
      const tr = world.sweepBox(beside, half, d);
      expect(tr.hit).toBe(false);
      expect(tr.startSolid).toBe(false);
    }
    expect(world.boxOverlaps(onTop, half)).toBe(false);
    expect(world.boxOverlaps(beside, half)).toBe(false);
  });

  it('blocks at fraction 0 when touching a face and moving into it', () => {
    let tr = world.sweepBox(v(1, 2.5, 1), half, v(0.3, -0.2, 0));
    expect(tr.hit).toBe(true);
    expect(tr.startSolid).toBe(false);
    expect(tr.fraction).toBe(0);
    expect(tr.normal).toEqual(v(0, 1, 0));
    tr = world.sweepBox(v(-0.5, 1, 1), half, v(1e-9, 0, 5));
    expect(tr.fraction).toBe(0);
    expect(tr.normal).toEqual(v(-1, 0, 0));
  });

  it('does not collide when the path only grazes an edge or a corner', () => {
    // The corner of the box slides exactly along the top edge x = 0, y = 2.
    expect(world.sweepBox(v(-0.5, 2.5, -3), half, v(0, 0, 8)).hit).toBe(false);
    // Diagonal path whose edge passes exactly through the cube edge (x = 0, y = 2).
    expect(world.sweepBox(v(-1.5, 1.5, 1), half, v(2, 2, 0)).hit).toBe(false);
    // Corner touching corner on the way past.
    expect(world.sweepBox(v(-1.5, 3.5, 0.5), half, v(2, -2, -2)).hit).toBe(false);
    // Same approach but heading into the cube through its corner: a real hit.
    expect(world.sweepBox(v(-1.5, 3.5, -1.5), half, v(2, -2, 2)).hit).toBe(true);
  });

  it('sweeps a degenerate box (a point or a flat plate) like a segment', () => {
    const point = v(0, 0, 0);
    let tr = world.sweepBox(v(-3, 1, 1), point, v(4, 0, 0));
    expect(tr.hit).toBe(true);
    expect(tr.fraction).toBeCloseTo((3 - BACKOFF) / 4, 12);
    expect(tr.normal).toEqual(v(-1, 0, 0));
    expect(world.sweepBox(v(-3, 2, 1), point, v(8, 0, 0)).hit).toBe(false); // along the top face
    expect(world.sweepBox(v(1, 1, 1), point, v(0, 0, 0)).startSolid).toBe(true);
    // Negative half extents are taken as their absolute value.
    tr = world.sweepBox(v(1, 5, 1), v(-0.5, -0.5, -0.5), v(0, -4, 0));
    expect(tr.fraction).toBeCloseTo((2.5 - BACKOFF) / 4, 12);
    expect(world.boxOverlaps(v(1, 2.4, 1), v(-0.5, -0.5, -0.5))).toBe(true);
  });

  it('handles zero deltas', () => {
    let tr = world.sweepBox(v(5, 5, 5), half, v(0, 0, 0));
    expect(tr).toEqual({ fraction: 1, hit: false, startSolid: false, normal: v(0, 0, 0), solid: -1 });
    tr = world.sweepBox(v(1, 2.5, 1), half, v(0, 0, 0)); // touching
    expect(tr.hit).toBe(false);
    tr = world.sweepBox(v(1, 2.4, 1), half, v(0, 0, 0)); // overlapping
    expect(tr.startSolid).toBe(true);
    expect(tr.fraction).toBe(0);
  });

  it('reports startSolid with the shortest way out', () => {
    const cases: { c: Vec3; normal: Vec3 }[] = [
      { c: v(1, 2.4, 1), normal: v(0, 1, 0) },
      { c: v(1, -0.4, 1), normal: v(0, -1, 0) },
      { c: v(-0.4, 1, 1), normal: v(-1, 0, 0) },
      { c: v(2.4, 1, 1), normal: v(1, 0, 0) },
      { c: v(1, 1, -0.4), normal: v(0, 0, -1) },
      { c: v(1, 1, 2.4), normal: v(0, 0, 1) },
    ];
    for (const c of cases) {
      for (const d of [v(0, 0, 0), v(1, 0, 0), v(0, -3, 0), v(-2, 5, 1)]) {
        const tr = world.sweepBox(c.c, half, d);
        expect(tr.startSolid).toBe(true);
        expect(tr.hit).toBe(true);
        expect(tr.fraction).toBe(0);
        expect(tr.solid).toBe(0);
        expect(tr.normal).toEqual(c.normal);
      }
      expect(world.boxOverlaps(c.c, half)).toBe(true);
    }
  });

  it('never ends touching or inside: repeated sweeps toward a wall keep a gap', () => {
    // A blocked sweep stops exactly 1 mm short of the face.
    const first = world.sweepBox(v(-4, 1, 1), half, v(10, 0, 0));
    expect(-0.5 - (-4 + 10 * first.fraction)).toBeCloseTo(BACKOFF, 12);

    // Pushing again and again never closes the gap (it can only shrink while still approaching).
    const rng = mulberry32(7);
    for (let run = 0; run < 20; run++) {
      const c = v(-4 + rng(), 1, 1);
      let previousGap = Infinity;
      let blocked = 0;
      for (let i = 0; i < 200; i++) {
        const d = v(rng() * 0.9, (rng() - 0.5) * 0.01, (rng() - 0.5) * 0.01);
        const tr = world.sweepBox(c, half, d);
        if (tr.hit) blocked++;
        c.x += d.x * tr.fraction;
        c.y += d.y * tr.fraction;
        c.z += d.z * tr.fraction;
        const gap = -0.5 - c.x; // distance between the box face and the cube face x = 0
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThanOrEqual(previousGap);
        expect(world.boxOverlaps(c, half)).toBe(false);
        previousGap = gap;
      }
      expect(blocked).toBeGreaterThan(150);
      expect(previousGap).toBeLessThan(BACKOFF * 1.01);
      expect(previousGap).toBeGreaterThan(1e-7);
    }
  });

  it('stops before thin walls however long the sweep (no tunnelling)', () => {
    const thin = new CollisionWorld([solid(10, -5, -50, 10.02, 5, 50), solid(-200, -6, -200, 200, -5, 200)]);
    for (const len of [1, 5, 50, 500, 5000, 5e6]) {
      const tr = thin.sweepBox(v(9, 0, 0), PLAYER, v(len, 0, 0));
      expect(tr.hit).toBe(true);
      expect(tr.solid).toBe(0);
      expect(9 + len * tr.fraction + PLAYER.x).toBeLessThan(10);
    }
    // Long diagonal sweeps (segmented broadphase walk).
    const tr = thin.sweepBox(v(-150, 0, -40), PLAYER, v(300, 0, 80));
    expect(tr.hit).toBe(true);
    expect(tr.normal).toEqual(v(-1, 0, 0));
    expect(-150 + 300 * tr.fraction + PLAYER.x).toBeLessThan(10);
  });

  it('survives invalid input without producing NaN', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      for (const tr of [
        world.sweepBox(v(bad, 0, 0), half, v(1, 0, 0)),
        world.sweepBox(v(0, 0, 0), v(0.5, bad, 0.5), v(1, 0, 0)),
        world.sweepBox(v(-3, 1, 1), half, v(1, bad, 0)),
      ]) {
        expect(tr.fraction).toBe(0);
        expect(Number.isFinite(tr.normal.x + tr.normal.y + tr.normal.z)).toBe(true);
      }
      expect(world.boxOverlaps(v(bad, 1, 1), half)).toBe(true);
      expect(world.raycast(v(bad, 1, 1), v(1, 0, 0), 10)).toBeNull();
      expect(world.raycast(v(-3, 1, 1), v(bad, 0, 0), 10)).toBeNull();
      expect(world.lineOfSight(v(bad, 1, 1), v(5, 1, 1))).toBe(false);
      expect(world.groundBelow(v(1, bad, 1), 10)).toBeNull();
    }
    expect(world.raycast(v(-3, 1, 1), v(1, 0, 0), NaN)).toBeNull();
    expect(world.raycast(v(-3, 1, 1), v(0, 0, 0), 10)).toBeNull();
    expect(world.groundBelow(v(1, 5, 1), NaN)).toBeNull();
  });
});

describe('CollisionWorld construction', () => {
  it('works with no solids at all', () => {
    const empty = new CollisionWorld([]);
    expect(empty.sweepBox(v(0, 0, 0), PLAYER, v(10, -3, 2)).fraction).toBe(1);
    expect(empty.boxOverlaps(v(0, 0, 0), PLAYER)).toBe(false);
    expect(empty.raycast(v(0, 0, 0), v(1, 0, 0), 100)).toBeNull();
    expect(empty.lineOfSight(v(0, 0, 0), v(10, 3, 4))).toBe(true);
    expect(empty.groundBelow(v(0, 0, 0), 100)).toBeNull();
  });

  it('ignores degenerate solids', () => {
    const world = new CollisionWorld([
      solid(0, 0, 0, 0, 2, 2), // zero thickness
      solid(0, 0, 0, 2, -1, 2), // inverted
      solid(0, 0, 0, NaN, 2, 2),
      solid(-Infinity, 0, 0, 2, 2, 2),
      solid(4, 0, 0, 6, 2, 2), // the only real one
    ]);
    expect(world.solids.length).toBe(5);
    expect(world.sweepBox(v(-3, 1, 1), v(0.5, 0.5, 0.5), v(5, 0, 0)).hit).toBe(false);
    const tr = world.sweepBox(v(-3, 1, 1), v(0.5, 0.5, 0.5), v(10, 0, 0));
    expect(tr.solid).toBe(4);
    expect(world.boxOverlaps(v(1, 1, 1), v(0.5, 0.5, 0.5))).toBe(false);
    expect(world.raycast(v(-3, 1, 1), v(1, 0, 0), 100)?.solid).toBe(4);
    expect(world.groundBelow(v(1, 5, 1), 10)).toBeNull();
    expect(world.groundBelow(v(5, 5, 1), 10)).toBe(2);
  });

  it('copes with a huge world by using coarser cells', () => {
    const world = new CollisionWorld([solid(-1e5, -1, -1e5, 1e5, 0, 1e5), solid(5e4, 0, 5e4, 5e4 + 1, 3, 5e4 + 1)]);
    expect(world.groundBelow(v(123, 2, -456), 10)).toBe(0);
    const tr = world.sweepBox(v(5e4 - 10, 1, 5e4 + 0.5), PLAYER, v(20, 0, 0));
    expect(tr.solid).toBe(1);
    expect(world.raycast(v(0, 50, 0), v(0, -1, 0), 100)?.dist).toBeCloseTo(50, 9);
  });
});

describe('CollisionWorld.raycast', () => {
  const solids = [solid(0, 0, 0, 2, 2, 2, { surf: 'metal' }), solid(10, 0, 0, 12, 2, 2, { surf: 'wood' })];
  const world = new CollisionWorld(solids);

  it('hits the nearest face from all six directions', () => {
    const cases: { o: Vec3; d: Vec3; n: Vec3; p: Vec3 }[] = [
      { o: v(-3, 1, 1), d: v(1, 0, 0), n: v(-1, 0, 0), p: v(0, 1, 1) },
      { o: v(5, 1, 1), d: v(-1, 0, 0), n: v(1, 0, 0), p: v(2, 1, 1) },
      { o: v(1, -3, 1), d: v(0, 1, 0), n: v(0, -1, 0), p: v(1, 0, 1) },
      { o: v(1, 5, 1), d: v(0, -1, 0), n: v(0, 1, 0), p: v(1, 2, 1) },
      { o: v(1, 1, -3), d: v(0, 0, 1), n: v(0, 0, -1), p: v(1, 1, 0) },
      { o: v(1, 1, 5), d: v(0, 0, -1), n: v(0, 0, 1), p: v(1, 1, 2) },
    ];
    for (const c of cases) {
      const hit = world.raycast(c.o, c.d, 100);
      expect(hit).not.toBeNull();
      expect(hit!.dist).toBeCloseTo(3, 12);
      expect(hit!.normal).toEqual(c.n);
      expect(hit!.point.x).toBeCloseTo(c.p.x, 12);
      expect(hit!.point.y).toBeCloseTo(c.p.y, 12);
      expect(hit!.point.z).toBeCloseTo(c.p.z, 12);
      expect(hit!.solid).toBe(0);
      expect(hit!.surf).toBe('metal');
    }
  });

  it('returns the nearest of several solids and its surface', () => {
    const hit = world.raycast(v(20, 1, 1), v(-1, 0, 0), 100);
    expect(hit!.solid).toBe(1);
    expect(hit!.surf).toBe('wood');
    expect(hit!.dist).toBeCloseTo(8, 12);
    // Oblique ray through the top face of the first cube.
    const d = v(1, -1, 0);
    const l = Math.hypot(d.x, d.y, d.z);
    const oblique = world.raycast(v(0, 3, 1), v(d.x / l, d.y / l, d.z / l), 100);
    expect(oblique!.normal).toEqual(v(0, 1, 0));
    expect(oblique!.point.x).toBeCloseTo(1, 12);
    expect(oblique!.point.y).toBeCloseTo(2, 12);
  });

  it('misses beside, behind and beyond maxDist', () => {
    expect(world.raycast(v(-3, 2.5, 1), v(1, 0, 0), 100)).toBeNull();
    expect(world.raycast(v(-3, 1, 1), v(-1, 0, 0), 100)).toBeNull();
    expect(world.raycast(v(-3, 1, 1), v(1, 0, 0), 2.99)).toBeNull();
    expect(world.raycast(v(-3, 1, 1), v(1, 0, 0), 3)!.dist).toBeCloseTo(3, 12);
    expect(world.raycast(v(-3, 1, 1), v(1, 0, 0), Infinity)!.dist).toBeCloseTo(3, 12);
    expect(world.raycast(v(-3, 1, 1), v(1, 0, 0), 0)).toBeNull();
    // Far outside the grid, pointing away / pointing at it.
    expect(world.raycast(v(-500, 1, 1), v(-1, 0, 0), 1e9)).toBeNull();
    expect(world.raycast(v(-500, 1, 1), v(1, 0, 0), 1e9)!.dist).toBeCloseTo(500, 9);
  });

  it('treats grazing rays as misses', () => {
    expect(world.raycast(v(-3, 2, 1), v(1, 0, 0), 100)).toBeNull(); // along the top face
    expect(world.raycast(v(-3, 1, 0), v(1, 0, 0), 100)).toBeNull(); // along a side face
    expect(world.raycast(v(-1, 1, 1), v(Math.SQRT1_2, Math.SQRT1_2, 0), 100)).toBeNull(); // touching an edge
    expect(world.raycast(v(-1, 3, 1), v(Math.SQRT1_2, -Math.SQRT1_2, 0), 100)).not.toBeNull(); // entering through it
  });

  it('starting on a face: hits going in, free going out', () => {
    const into = world.raycast(v(0, 1, 1), v(1, 0, 0), 100);
    expect(into!.dist).toBe(0);
    expect(into!.normal).toEqual(v(-1, 0, 0));
    expect(world.raycast(v(0, 1, 1), v(-1, 0, 0), 100)).toBeNull();
    expect(world.raycast(v(2, 1, 1), v(1, 0, 0), 7.9)).toBeNull();
  });

  it('starting inside a solid hits at distance 0, facing the ray', () => {
    const hit = world.raycast(v(1, 1, 1), v(0, 0, -1), 100);
    expect(hit!.dist).toBe(0);
    expect(hit!.solid).toBe(0);
    expect(hit!.point).toEqual(v(1, 1, 1));
    expect(hit!.normal).toEqual(v(0, 0, 1));
  });
});

describe('collision masks', () => {
  // A railing (players collide, bullets pass) and a "bullet blocker" (the reverse), then a wall.
  const solids = [
    solid(2, 0, -5, 2.1, 1, 5, { noBullets: true }),
    solid(4, 0, -5, 4.1, 3, 5, { noPlayers: true }),
    solid(6, 0, -5, 6.2, 3, 5),
    solid(-20, -1, -20, 20, 0, 20),
  ];
  const world = new CollisionWorld(solids);
  const from = v(0, 0.95, 0);

  it('MASK.Player ignores noPlayers solids, MASK.Bullet ignores noBullets solids', () => {
    expect(world.sweepBox(from, PLAYER, v(10, 0, 0)).solid).toBe(0);
    expect(world.sweepBox(from, PLAYER, v(10, 0, 0), MASK.Player).solid).toBe(0);
    expect(world.sweepBox(v(3, 0.95, 0), PLAYER, v(10, 0, 0)).solid).toBe(2);
    expect(world.sweepBox(from, PLAYER, v(10, 0, 0), MASK.Bullet).solid).toBe(1);

    expect(world.raycast(v(0, 0.5, 0), v(1, 0, 0), 100)!.solid).toBe(1);
    expect(world.raycast(v(0, 0.5, 0), v(1, 0, 0), 100, MASK.Bullet)!.solid).toBe(1);
    expect(world.raycast(v(0, 0.5, 0), v(1, 0, 0), 100, MASK.Player)!.solid).toBe(0);
    expect(world.raycast(v(4.5, 0.5, 0), v(1, 0, 0), 100)!.solid).toBe(2);

    expect(world.boxOverlaps(v(2.05, 0.5, 0), v(0.2, 0.2, 0.2))).toBe(true);
    expect(world.boxOverlaps(v(2.05, 0.5, 0), v(0.2, 0.2, 0.2), MASK.Bullet)).toBe(false);
    expect(world.boxOverlaps(v(4.05, 0.5, 0), v(0.2, 0.2, 0.2))).toBe(false);
    expect(world.boxOverlaps(v(4.05, 0.5, 0), v(0.2, 0.2, 0.2), MASK.Bullet)).toBe(true);

    expect(world.lineOfSight(v(0, 0.5, 0), v(3, 0.5, 0))).toBe(true); // through the railing
    expect(world.lineOfSight(v(0, 0.5, 0), v(3, 0.5, 0), MASK.Player)).toBe(false);
    expect(world.lineOfSight(v(3, 0.5, 0), v(5, 0.5, 0))).toBe(false);
    expect(world.lineOfSight(v(3, 0.5, 0), v(5, 0.5, 0), MASK.Player)).toBe(true);
  });

  it('a mask of 0 collides with everything', () => {
    expect(world.sweepBox(v(3, 0.95, 0), PLAYER, v(10, 0, 0), 0).solid).toBe(1);
    expect(world.raycast(v(0, 0.5, 0), v(1, 0, 0), 100, 0)!.solid).toBe(0);
  });

  it('groundBelow uses the Player mask', () => {
    expect(world.groundBelow(v(2.05, 5, 0), 10)).toBe(1); // top of the railing
    expect(world.groundBelow(v(4.05, 5, 0), 10)).toBe(0); // noPlayers solid is ignored
  });
});

describe('lineOfSight and groundBelow on dev_test', () => {
  const map = getMap('dev_test');
  const world = new CollisionWorld(map.solids);

  it('sees across open ground, not through crates or walls', () => {
    expect(world.lineOfSight(v(-4, 1.6, 10), v(4, 1.6, 10))).toBe(true);
    expect(world.lineOfSight(v(4, 1.6, 10), v(-4, 1.6, 10))).toBe(true);
    // The central crate stack (2.2 m high in the middle) blocks eye-level sight lines.
    expect(world.lineOfSight(v(0, 1.6, -5), v(0, 1.6, 5))).toBe(false);
    // ...but not over the top of the 1.2 m part.
    expect(world.lineOfSight(v(1.2, 1.6, -5), v(1.2, 1.6, 5))).toBe(true);
    // Hut walls: from outside to inside through the wall / through the doorway.
    expect(world.lineOfSight(v(-6, 1.6, 2.5), v(-11.5, 1.6, 2.5))).toBe(false);
    expect(world.lineOfSight(v(-6, 1.6, 0), v(-11.5, 1.6, 0))).toBe(true);
    // Nothing is visible beyond the perimeter wall.
    expect(world.lineOfSight(v(0, 1.6, 10), v(0, 1.6, 30))).toBe(false);
    // Degenerate segment.
    expect(world.lineOfSight(v(3, 1, 3), v(3, 1, 3))).toBe(true);
  });

  it('a target lying exactly on a surface is visible from the open side', () => {
    expect(world.lineOfSight(v(0, 3, 10), v(0, 0, 10))).toBe(true); // point on the floor
    expect(world.lineOfSight(v(0, 3, 10), v(0, -0.1, 10))).toBe(false); // point inside the floor
    expect(world.lineOfSight(v(0, -0.1, 10), v(0, 3, 10))).toBe(false); // from inside
  });

  it('finds the ground under a point', () => {
    expect(world.groundBelow(v(5, 1, 10), 5)).toBe(0);
    expect(world.groundBelow(v(5, 0, 10), 5)).toBe(0); // feet exactly on the floor
    expect(world.groundBelow(v(5, 0.001, 10), 0.002)).toBe(0);
    expect(world.groundBelow(v(5, 0.001, 10), 0)).toBeNull(); // not allowed to look down at all
    expect(world.groundBelow(v(5, -0.005, 10), 0)).toBe(0); // surface within the 1 cm tolerance above
    expect(world.groundBelow(v(5, -0.02, 10), 5)).toBeNull(); // below the floor surface
    expect(world.groundBelow(v(5, 3, 10), 2.5)).toBeNull(); // too far down
    expect(world.groundBelow(v(5, 3, 10), 3)).toBe(0);
    expect(world.groundBelow(v(5, 3, 10), Infinity)).toBe(0);
    expect(world.groundBelow(v(0, 5, 0), 10)).toBeCloseTo(2.2, 12); // top of the crate stack
    expect(world.groundBelow(v(1.2, 5, 0), 10)).toBeCloseTo(1.2, 12); // lower crate
    expect(world.groundBelow(v(1.2, 1, 0), 10)).toBe(0); // from inside the crate: what lies below
    expect(world.groundBelow(v(13.5, 3, 0), 10)).toBe(2); // walkway
    expect(world.groundBelow(v(13.5, 1.5, 0), 10)).toBe(0); // under the walkway
    expect(world.groundBelow(v(12, 4, -12.25), 10)).toBeCloseTo(1, 12); // 4th stair
    expect(world.groundBelow(v(40, 1, 0), 10)).toBeNull(); // outside the map
    expect(world.groundBelow(v(0, 30, 10), 100)).toBe(0); // far above the world
    expect(world.groundBelow(v(0, -30, 10), 100)).toBeNull(); // far below
  });

  it('sweeps a player hull against the perimeter walls from inside', () => {
    const reach = 16 - PLAYER.x - BACKOFF;
    // Lane along the +Z wall, clear of the stairs and the walkway.
    const c = v(0, 0.9 + BACKOFF, 15);
    let tr = world.sweepBox(c, PLAYER, v(40, 0, 0));
    expect(c.x + 40 * tr.fraction).toBeCloseTo(reach, 9);
    expect(tr.normal).toEqual(v(-1, 0, 0));
    tr = world.sweepBox(c, PLAYER, v(-40, 0, 0));
    expect(c.x - 40 * tr.fraction).toBeCloseTo(-reach, 9);
    expect(tr.normal).toEqual(v(1, 0, 0));
    tr = world.sweepBox(v(0, 0.9 + BACKOFF, 10), PLAYER, v(0, 0, 40));
    expect(10 + 40 * tr.fraction).toBeCloseTo(reach, 9);
    expect(tr.normal).toEqual(v(0, 0, -1));
    // The 1.8 m hull does not fit under the walkway (underside at 1.8 m) once it stands 1 mm above the floor.
    tr = world.sweepBox(v(0, 0.9 + BACKOFF, 8), PLAYER, v(40, 0, 0));
    expect(40 * tr.fraction + PLAYER.x).toBeCloseTo(11 - BACKOFF, 9);
    // Falling from the sky lands on the floor.
    tr = world.sweepBox(v(5, 10, 10), PLAYER, v(0, -20, 0));
    expect(10 - 20 * tr.fraction - PLAYER.y).toBeCloseTo(BACKOFF, 9);
    expect(tr.normal).toEqual(v(0, 1, 0));
  });
});

describe('seams between adjacent coplanar boxes', () => {
  // Floor of 1 m tiles (top at y = 0) and a wall of 1 m bricks in the plane x = 0 (solid for x < 0).
  const solids: Solid[] = [];
  for (let x = -5; x < 15; x++) for (let z = -5; z < 15; z++) solids.push(solid(x, -0.25, z, x + 1, 0, z + 1));
  for (let y = 0; y < 3; y++) for (let z = -5; z < 15; z++) solids.push(solid(-0.3, y, z, 0, y + 1, z + 1));
  const world = new CollisionWorld(solids);

  it('a box resting on the tiles slides across every seam', () => {
    for (const gap of [0, BACKOFF, 1e-9]) {
      const c = v(2.5, PLAYER.y + gap, 2.5);
      for (const d of [v(9.3, 0, 0), v(0, 0, 9.3), v(7.7, 0, 7.1), v(-1.9, 0, 3.3)]) {
        const tr = world.sweepBox(c, PLAYER, d);
        expect(tr.hit).toBe(false);
        expect(tr.fraction).toBe(1);
      }
    }
  });

  it('landing on the tiles always reports the floor, whatever the seam underneath', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 2000; i++) {
      const c = v(1 + rng() * 10, PLAYER.y + 0.001 + rng() * 2, 1 + rng() * 10);
      const d = v((rng() - 0.5) * 6, -(0.01 + rng() * 4), (rng() - 0.5) * 6);
      const tr = world.sweepBox(c, PLAYER, d);
      if (!tr.hit) continue;
      if (c.x + d.x * tr.fraction - PLAYER.x > BACKOFF * 2) {
        // Away from the wall: only the floor can be hit.
        expect(tr.normal).toEqual(v(0, 1, 0));
      } else {
        expect(tr.normal.z).toBe(0);
      }
      expect(world.boxOverlaps(moved(c, d, tr), PLAYER)).toBe(false);
    }
  });

  it('a box against the wall slides along it across every brick', () => {
    for (const gap of [0, BACKOFF, 1e-9]) {
      const c = v(PLAYER.x + gap, PLAYER.y + BACKOFF, 0.5);
      for (const d of [v(0, 0, 11.7), v(0, 0, -4), v(0, 1.05, 9.9), v(0.5, 0, 12)]) {
        const tr = world.sweepBox(c, PLAYER, d);
        expect(tr.hit).toBe(false);
      }
    }
  });

  it('running into the wall at an angle always reports the wall plane, never a brick side', () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 2000; i++) {
      const c = v(PLAYER.x + 0.001 + rng() * 2, PLAYER.y + BACKOFF, rng() * 10);
      const d = v(-(0.01 + rng() * 4), 0, (rng() - 0.5) * 8);
      const tr = world.sweepBox(c, PLAYER, d);
      if (!tr.hit) continue;
      expect(tr.normal).toEqual(v(1, 0, 0));
      expect(world.boxOverlaps(moved(c, d, tr), PLAYER)).toBe(false);
    }
  });
});

describe('broadphase agrees with brute force', () => {
  const variants: { name: string; solids: Solid[]; snap: number; span: number }[] = [
    { name: 'random boxes', solids: randomSolids(1234, 3000), snap: 0, span: 55 },
    // Coordinates on a 0.25 m lattice: lots of exact contacts, shared planes and ties.
    { name: 'lattice-aligned boxes', solids: randomSolids(4321, 3000, 0.25), snap: 0.25, span: 55 },
    // A real map, probed on a 5 cm lattice (walls, floors and props are on round coordinates).
    { name: 'dev_test', solids: getMap('dev_test').solids, snap: 0.05, span: 18 },
  ];

  for (const variant of variants) {
    const world = new CollisionWorld(variant.solids);
    const ref = toRef(variant.solids);
    const span = variant.span;
    const q = (n: number): number => (variant.snap > 0 ? Math.round(n / variant.snap) * variant.snap : n);

    it(`sweepBox / boxOverlaps (${variant.name})`, () => {
      const rng = mulberry32(42);
      let hits = 0;
      let starts = 0;
      for (let i = 0; i < 4000; i++) {
        const c = v(q((rng() * 2 - 1) * span), q(-3 + rng() * 26), q((rng() * 2 - 1) * span));
        const h = i % 3 === 0 ? PLAYER : v(q(0.25 + rng() * 2), q(0.25 + rng() * 2), q(0.25 + rng() * 2));
        // Mix of short moves, long sweeps (segmented walk) and axis-parallel moves.
        const len = i % 5 === 0 ? 60 : i % 5 === 1 ? 8 : 1;
        const d = v(q((rng() - 0.5) * len), q((rng() - 0.5) * len * 0.5), q((rng() - 0.5) * len));
        if (i % 7 === 0) d.y = 0;
        if (i % 11 === 0) d.x = 0;
        if (i % 97 === 0) d.x = d.y = d.z = 0;
        const mask = i % 4 === 0 ? MASK.Bullet : MASK.Player;

        const tr = world.sweepBox(c, h, d, mask);
        const expected = refSweep(ref, c, h, d, mask);
        expect(tr.hit).toBe(expected.hit);
        expect(tr.startSolid).toBe(expected.startSolid);
        expect(tr.solid).toBe(expected.solid);
        expect(tr.fraction).toBe(expected.fraction);
        if (expected.hit && !expected.startSolid) expect(tr.normal).toEqual(expected.normal);
        const overlapping = refOverlap(ref, c, h, mask);
        expect(world.boxOverlaps(c, h, mask)).toBe(overlapping);
        expect(tr.startSolid).toBe(overlapping);
        // The end position is never inside a solid.
        if (!tr.startSolid) expect(refOverlap(ref, moved(c, d, tr), h, mask)).toBe(false);
        if (tr.hit) hits++;
        if (tr.startSolid) starts++;
      }
      expect(hits).toBeGreaterThan(800);
      expect(starts).toBeGreaterThan(80);
    });

    it(`raycast / lineOfSight (${variant.name})`, () => {
      const rng = mulberry32(43);
      let hits = 0;
      for (let i = 0; i < 4000; i++) {
        const o = v(q((rng() * 2 - 1) * (span + 5)), q(-5 + rng() * 30), q((rng() * 2 - 1) * (span + 5)));
        let d = randomDir(rng);
        if (i % 6 === 0) d = v(0, i % 12 === 0 ? -1 : 1, 0);
        else if (i % 6 === 1) d = v(i % 12 === 1 ? 1 : -1, 0, 0);
        else if (i % 6 === 2) d = v(Math.SQRT1_2, 0, i % 12 === 2 ? Math.SQRT1_2 : -Math.SQRT1_2);
        const maxDist = i % 3 === 0 ? 5 + rng() * 20 : 300;
        const mask = i % 4 === 0 ? MASK.Player : MASK.Bullet;

        const hit = world.raycast(o, d, maxDist, mask);
        const expected = refRay(ref, o, d, maxDist, mask);
        expect(hit === null).toBe(expected === null);
        if (hit && expected) {
          expect(hit.solid).toBe(expected.solid);
          expect(hit.dist).toBe(expected.dist);
          if (expected.normal) expect(hit.normal).toEqual(expected.normal);
          else expect(Math.abs(hit.normal.x) + Math.abs(hit.normal.y) + Math.abs(hit.normal.z)).toBe(1);
          expect(hit.surf).toBe(variant.solids[hit.solid]!.surf);
          hits++;
        }

        const b = v(q(o.x + (rng() - 0.5) * 30), q(o.y + (rng() - 0.5) * 10), q(o.z + (rng() - 0.5) * 30));
        const len = Math.hypot(b.x - o.x, b.y - o.y, b.z - o.z);
        if (len > 0.01) {
          const inv = 1 / len;
          const dir = v((b.x - o.x) * inv, (b.y - o.y) * inv, (b.z - o.z) * inv);
          const blocked = refRay(ref, o, dir, len - 1e-4, mask) !== null;
          expect(world.lineOfSight(o, b, mask)).toBe(!blocked);
        }
      }
      expect(hits).toBeGreaterThan(400);
    });

    it(`groundBelow (${variant.name})`, () => {
      const rng = mulberry32(44);
      let found = 0;
      for (let i = 0; i < 4000; i++) {
        const p = v(q((rng() * 2 - 1) * span), q(-3 + rng() * 28), q((rng() * 2 - 1) * span));
        const maxDrop = i % 3 === 0 ? rng() * 3 : 40;
        let best: number | null = null;
        for (const s of variant.solids) {
          if (s.noPlayers) continue;
          if (p.x < s.min.x || p.x > s.max.x || p.z < s.min.z || p.z > s.max.z) continue;
          if (s.max.y > p.y + 0.01 || s.max.y < p.y - maxDrop) continue;
          if (best === null || s.max.y > best) best = s.max.y;
        }
        expect(world.groundBelow(p, maxDrop)).toBe(best);
        if (best !== null) found++;
      }
      expect(found).toBeGreaterThan(500);
    });
  }
});

describe('micro-benchmarks (3000 random boxes)', () => {
  const solids = randomSolids(2024, 3000);
  const world = new CollisionWorld(solids);
  const POOL = 4096;

  /** Random point of the volume where a box of half extents `half` is free. */
  function freePoint(rng: () => number, half: Vec3): Vec3 {
    for (;;) {
      const p = v(-50 + rng() * 100, rng() * 20, -50 + rng() * 100);
      if (!world.boxOverlaps(p, half, 0)) return p;
    }
  }

  it('raycast throughput', () => {
    const rng = mulberry32(1);
    const N = 400_000;
    const origins: Vec3[] = [];
    const dirs: Vec3[] = [];
    for (let i = 0; i < POOL; i++) {
      origins.push(freePoint(rng, v(0.01, 0.01, 0.01)));
      dirs.push(randomDir(rng));
    }
    let hits = 0;
    let total = 0;
    for (let i = 0; i < 50_000; i++) world.raycast(origins[i % POOL]!, dirs[(i * 7) % POOL]!, 100); // warm-up
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const hit = world.raycast(origins[i % POOL]!, dirs[(i * 7) % POOL]!, 100);
      if (hit) {
        hits++;
        total += hit.dist;
      }
    }
    const ms = performance.now() - t0;
    const perSecond = (N / ms) * 1000;
    console.log(
      `[bench] raycast: ${(perSecond / 1e6).toFixed(2)} M/s (${N} rays in ${ms.toFixed(0)} ms, ` +
        `${((hits / N) * 100).toFixed(0)} % hits, mean hit distance ${(total / Math.max(hits, 1)).toFixed(1)} m)`,
    );
    expect(hits).toBeGreaterThan(N / 4);
    // Target: >= 1 M/s. The assertion is deliberately loose so that a busy machine cannot fail it.
    expect(perSecond).toBeGreaterThan(150_000);
  });

  it('sweepBox throughput (player hull, one tick of movement)', () => {
    const rng = mulberry32(2);
    const N = 300_000;
    const centers: Vec3[] = [];
    const deltas: Vec3[] = [];
    for (let i = 0; i < POOL; i++) {
      centers.push(freePoint(rng, PLAYER));
      const d = randomDir(rng);
      const len = 0.02 + rng() * 0.6;
      deltas.push(v(d.x * len, d.y * len, d.z * len));
    }
    let hits = 0;
    for (let i = 0; i < 50_000; i++) world.sweepBox(centers[i % POOL]!, PLAYER, deltas[(i * 7) % POOL]!); // warm-up
    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      if (world.sweepBox(centers[i % POOL]!, PLAYER, deltas[(i * 7) % POOL]!).hit) hits++;
    }
    const ms = performance.now() - t0;
    const perSecond = (N / ms) * 1000;
    console.log(
      `[bench] sweepBox (2-62 cm): ${(perSecond / 1e6).toFixed(2)} M/s (${N} sweeps in ${ms.toFixed(0)} ms, ` +
        `${((hits / N) * 100).toFixed(0)} % blocked)`,
    );
    // Target: >= 300 k/s (loose assertion, see above).
    expect(perSecond).toBeGreaterThan(50_000);
  });

  it('sweepBox throughput (long sweeps) and boxOverlaps', () => {
    const rng = mulberry32(3);
    const centers: Vec3[] = [];
    const deltas: Vec3[] = [];
    for (let i = 0; i < POOL; i++) {
      centers.push(freePoint(rng, PLAYER));
      const d = randomDir(rng);
      const len = 5 + rng() * 40;
      deltas.push(v(d.x * len, d.y * len * 0.2, d.z * len));
    }
    const N = 100_000;
    let hits = 0;
    let t0 = performance.now();
    for (let i = 0; i < N; i++) if (world.sweepBox(centers[i % POOL]!, PLAYER, deltas[(i * 7) % POOL]!).hit) hits++;
    let ms = performance.now() - t0;
    console.log(
      `[bench] sweepBox (5-45 m): ${(((N / ms) * 1000) / 1e6).toFixed(2)} M/s (${((hits / N) * 100).toFixed(0)} % blocked)`,
    );

    const M = 400_000;
    const probes: Vec3[] = [];
    for (let i = 0; i < POOL; i++) probes.push(v(-50 + rng() * 100, rng() * 20, -50 + rng() * 100));
    let overlaps = 0;
    t0 = performance.now();
    for (let i = 0; i < M; i++) if (world.boxOverlaps(probes[i % POOL]!, PLAYER)) overlaps++;
    ms = performance.now() - t0;
    console.log(
      `[bench] boxOverlaps: ${(((M / ms) * 1000) / 1e6).toFixed(2)} M/s (${((overlaps / M) * 100).toFixed(0)} % overlapping)`,
    );
    expect(overlaps).toBeGreaterThan(0);
  });

  it('builds quickly', () => {
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) new CollisionWorld(solids);
    const ms = (performance.now() - t0) / 10;
    console.log(`[bench] CollisionWorld construction (3000 solids): ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(200);
  });
});
