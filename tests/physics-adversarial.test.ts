/**
 * Adversarial tests of the collision world and of the player movement.
 *
 * tests/physics.test.ts and tests/movement.test.ts check the documented behaviour; this file
 * tries to break it: awkward angles, seams, corners, stairs in every stance and direction,
 * edges, ceilings, exact-fit gaps, corrupted state, long fuzz runs on hostile geometry, and
 * differential tests (independent brute-force reference, subdivided worlds, replays).
 *
 * Conventions used below: the floor top is y = 0, a resting player has its feet SKIN (1 mm)
 * above the ground and its hull sides SKIN away from the wall it ran into.
 */
import { describe, expect, it } from 'vitest';
import {
  BTN,
  MOVE,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  STEP_HEIGHT,
  TICK_DT,
  TICK_RATE,
} from '../src/shared/constants';
import { getMap } from '../src/shared/maps';
import type { Solid } from '../src/shared/maps/types';
import { mulberry32 } from '../src/shared/math/rng';
import { CollisionWorld, MASK } from '../src/shared/physics/world';
import { stepMovement } from '../src/shared/player/movement';
import type { PlayerState, StepEvents, UserCmd } from '../src/shared/types';

// --- Helpers -------------------------------------------------------------------------------

const SKIN = 1e-3;
const RUN: number = MOVE.runSpeed;
const HW: number = PLAYER_HALF_WIDTH;
/** Yaw that makes BTN.Forward move toward each world direction (yaw 0 looks toward -Z). */
const YAW = { negZ: 0, negX: Math.PI / 2, posZ: Math.PI, posX: -Math.PI / 2 } as const;
/** Yaw whose forward vector is (x, z). */
const yawToward = (x: number, z: number): number => Math.atan2(-x, -z);
const MOVE_KEYS = BTN.Forward | BTN.Back | BTN.Left | BTN.Right;

type Vec = { x: number; y: number; z: number };

function solid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Solid {
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, surf: 'concrete' };
}

function makeState(x: number, y: number, z: number): PlayerState {
  return {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    onGround: false,
    crouch: 0,
    landSlow: 1,
    alive: true,
    health: 100,
    armor: 0,
    slots: [null, null, null],
    active: 0,
    fireCd: 0,
    reload: 0,
    draw: 0,
    shots: 0,
    sinceShot: 10,
    punchPitch: 0,
    punchYaw: 0,
    spread: 0,
    zoom: 0,
    prevButtons: 0,
    action: 0,
    actionT: 0,
    protect: 0,
    frozen: false,
  };
}

function makeEvents(): StepEvents {
  return {
    fired: null,
    dryFire: false,
    reloadStarted: false,
    reloadFinished: false,
    switched: false,
    jumped: false,
    landedSpeed: 0,
    zoomChanged: false,
  };
}

const hullHeight = (crouch: number): number => PLAYER_HEIGHT + (PLAYER_CROUCH_HEIGHT - PLAYER_HEIGHT) * crouch;
const speedOf = (s: PlayerState): number => Math.hypot(s.vel.x, s.vel.z);
const seconds = (t: number): number => Math.round(t * TICK_RATE);

/** True if the player's hull overlaps a solid. */
function insideSolid(world: CollisionWorld, s: PlayerState): boolean {
  const hh = hullHeight(s.crouch) / 2;
  return world.boxOverlaps({ x: s.pos.x, y: s.pos.y + hh, z: s.pos.z }, { x: HW, y: hh, z: HW });
}

/** One simulated player: feeds commands to stepMovement the way stepPlayer does. */
class Sim {
  readonly s: PlayerState;
  readonly ev = makeEvents();
  seq = 0;
  jumps = 0;
  landings: number[] = [];
  /** Ticks spent off the ground since creation (the very first tick excluded: spawn settling). */
  airTicks = 0;

  constructor(
    readonly world: CollisionWorld,
    x: number,
    y: number,
    z: number,
    readonly maxSpeed: number = RUN,
  ) {
    this.s = makeState(x, y, z);
  }

  tick(buttons: number, yaw = 0): StepEvents {
    const cmd: UserCmd = { seq: ++this.seq, buttons, yaw, pitch: 0, slot: -1, st: 0 };
    this.s.yaw = yaw;
    stepMovement(this.s, cmd, this.world, this.maxSpeed, this.ev);
    this.s.prevButtons = buttons;
    if (this.ev.jumped) this.jumps++;
    if (this.ev.landedSpeed > 0) this.landings.push(this.ev.landedSpeed);
    if (this.seq > 1 && !this.s.onGround) this.airTicks++;
    if (insideSolid(this.world, this.s)) {
      throw new Error(`tick ${this.seq}: hull inside a solid at ${JSON.stringify(this.s.pos)} (crouch ${this.s.crouch})`);
    }
    return this.ev;
  }

  run(ticks: number, buttons: number, yaw = 0, each?: (sim: Sim, i: number) => void): this {
    for (let i = 0; i < ticks; i++) {
      this.tick(buttons, yaw);
      each?.(this, i);
    }
    return this;
  }
}

/** Large flat floor whose top is at y = 0. */
const flatWorld = (...extra: Solid[]): CollisionWorld => new CollisionWorld([solid(-200, -1, -200, 200, 0, 200), ...extra]);

/** Exact bit pattern of the movement state (distinguishes -0 from 0 and every last bit). */
function stateBits(s: PlayerState, ev: StepEvents): string {
  const f = new Float64Array([s.pos.x, s.pos.y, s.pos.z, s.vel.x, s.vel.y, s.vel.z, s.crouch, s.landSlow, ev.landedSpeed]);
  const u = new BigUint64Array(f.buffer);
  let out = (s.onGround ? 'G' : 'A') + (ev.jumped ? 'J' : '-');
  for (let i = 0; i < u.length; i++) out += ':' + u[i]!.toString(16);
  return out;
}

/** Random but plausible player input: keys held for a while, view turning, jumps, crouch, walk. */
function makeInput(seed: number): () => { buttons: number; yaw: number } {
  const rng = mulberry32(seed);
  let buttons = 0;
  let yaw = rng() * Math.PI * 2;
  let turn = 0;
  let hold = 0;
  return () => {
    if (hold-- <= 0) {
      hold = 1 + Math.floor(rng() * (rng() < 0.2 ? 200 : 40));
      buttons = 0;
      const r = rng();
      if (r < 0.75) buttons |= BTN.Forward;
      else if (r < 0.85) buttons |= BTN.Back;
      const side = rng();
      if (side < 0.2) buttons |= BTN.Left;
      else if (side < 0.4) buttons |= BTN.Right;
      if (rng() < 0.25) buttons |= BTN.Crouch;
      if (rng() < 0.15) buttons |= BTN.Walk;
      turn = rng() < 0.5 ? 0 : (rng() * 2 - 1) * 4;
      if (rng() < 0.3) yaw = rng() * Math.PI * 2;
      // Axis-aligned headings and exact diagonals: head-on hits, exact corner hits, ties.
      if (rng() < 0.2) yaw = (Math.floor(rng() * 8) * Math.PI) / 4;
    }
    let b = buttons;
    if (rng() < 0.06) b |= BTN.Jump;
    yaw += turn * TICK_DT;
    return { buttons: b, yaw };
  };
}

/** Cut every solid into up to 3 x 3 x 3 pieces at random planes (exact partition), then shuffle. */
function subdivide(solids: readonly Solid[], seed: number): Solid[] {
  const rng = mulberry32(seed);
  const cuts = (a: number, b: number): number[] => {
    const planes = [a, b];
    for (let n = Math.floor(rng() * 3); n > 0; n--) {
      const v = a + (b - a) * rng();
      if (v > a && v < b) planes.push(v);
    }
    return planes.sort((p, q) => p - q);
  };
  const out: Solid[] = [];
  for (const s of solids) {
    const xs = cuts(s.min.x, s.max.x);
    const ys = cuts(s.min.y, s.max.y);
    const zs = cuts(s.min.z, s.max.z);
    for (let i = 0; i + 1 < xs.length; i++) {
      for (let j = 0; j + 1 < ys.length; j++) {
        for (let k = 0; k + 1 < zs.length; k++) {
          out.push({ ...s, min: { x: xs[i]!, y: ys[j]!, z: zs[k]! }, max: { x: xs[i + 1]!, y: ys[j + 1]!, z: zs[k + 1]! } });
        }
      }
    }
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

interface TestWorld {
  solids: Solid[];
  world: CollisionWorld;
  /** Playable volume: nothing may ever leave it. */
  bounds: { min: Vec; max: Vec };
}

/**
 * Closed room filled with random boxes: steps, crates, pillars, ceilings at awkward heights,
 * floating shelves, thin walls and staircases. Most boxes are snapped to a lattice so that
 * coplanar faces, seams and exact-width gaps are common.
 */
function randomBoxWorld(seed: number): TestWorld {
  const rng = mulberry32(seed);
  const S = 24;
  const solids: Solid[] = [];
  for (let x = -S; x < S; x += 4) for (let z = -S; z < S; z += 4) solids.push(solid(x, -1, z, x + 4, 0, z + 4));
  for (let a = -S; a < S; a += 6) {
    solids.push(solid(a, 0, -S - 1, a + 6, 8, -S), solid(a, 0, S, a + 6, 8, S + 1));
    solids.push(solid(-S - 1, 0, a, -S, 8, a + 6), solid(S, 0, a, S + 1, 8, a + 6));
  }
  solids.push(solid(-S - 1, 8, -S - 1, S + 1, 9, S + 1));
  const snap = (v: number, q: number): number => Math.round(v / q) * q;
  const pick = (values: readonly number[]): number => values[Math.floor(rng() * values.length)]!;
  const count = 60 + Math.floor(rng() * 120);
  for (let i = 0; i < count; i++) {
    const kind = rng();
    const cx = (rng() * 2 - 1) * (S - 1);
    const cz = (rng() * 2 - 1) * (S - 1);
    let w = 0.2 + rng() * 3;
    let d = 0.2 + rng() * 3;
    let y0 = 0;
    let h: number;
    if (kind < 0.25) h = pick([0.05, 0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.499, 0.501, 0.52]);
    else if (kind < 0.45) h = 0.6 + rng() * 0.9;
    else if (kind < 0.6) h = 2 + rng() * 4;
    else if (kind < 0.8) {
      y0 = pick([1.25, 1.3, 1.302, 1.31, 1.4, 1.6, 1.79, 1.8, 1.801, 1.802, 1.81, 1.9, 2.0, 2.3, 2.5, 3]);
      h = 0.1 + rng() * 0.5;
      w += 1;
      d += 1;
    } else {
      y0 = rng() * 2.5;
      h = 0.05 + rng() * 1.5;
      if (rng() < 0.5) w = 0.05 + rng() * 0.2;
    }
    let x0 = cx - w / 2;
    let z0 = cz - d / 2;
    let x1 = cx + w / 2;
    let z1 = cz + d / 2;
    if (rng() < 0.6) {
      const q = rng() < 0.5 ? 0.5 : 0.35;
      x0 = snap(x0, q);
      z0 = snap(z0, q);
      x1 = Math.max(x0 + q, snap(x1, q));
      z1 = Math.max(z0 + q, snap(z1, q));
    }
    solids.push(solid(x0, y0, z0, x1, y0 + h, z1));
    if (rng() < 0.08) {
      const rise = pick([0.2, 0.25, 0.5]);
      const run = pick([0.3, 0.5, 0.25]);
      const sx = snap(cx, 0.5);
      const sz = snap(cz, 0.5);
      const steps = 3 + Math.floor(rng() * 8);
      for (let k = 0; k < steps; k++) solids.push(solid(sx + k * run, 0, sz, sx + (k + 1) * run, (k + 1) * rise, sz + 1.5));
      solids.push(solid(sx + steps * run, steps * rise - 0.2, sz - 1, sx + steps * run + 3, steps * rise, sz + 2.5));
    }
  }
  return { solids, world: new CollisionWorld(solids), bounds: { min: { x: -S, y: 0, z: -S }, max: { x: S, y: 8, z: S } } };
}

/**
 * Closed room where everything sits on a hull-sized lattice (0.35 m) with 0 / 1 / 2 mm
 * deviations: exact-fit slots, terraces at step height, ceilings at exactly the hull heights.
 */
function latticeWorld(seed: number): TestWorld {
  const rng = mulberry32(seed * 7919 + 13);
  const S = 14;
  const solids: Solid[] = [
    solid(-S, -1, -S, S, 0, S),
    solid(-S - 1, 0, -S - 1, S + 1, 9, -S),
    solid(-S - 1, 0, S, S + 1, 9, S + 1),
    solid(-S - 1, 0, -S, -S, 9, S),
    solid(S, 0, -S, S + 1, 9, S),
    solid(-S - 1, 9, -S - 1, S + 1, 10, S + 1),
  ];
  const pick = (values: readonly number[]): number => values[Math.floor(rng() * values.length)]!;
  const jitter = (): number => pick([0, 0, 0, 0.001, -0.001, 0.002, -0.002, 0.0005, 1e-9, -1e-9]);
  const q = 0.35;
  const count = 150 + Math.floor(rng() * 150);
  for (let i = 0; i < count; i++) {
    const x = Math.round(((rng() * 2 - 1) * (S - 1)) / q) * q;
    const z = Math.round(((rng() * 2 - 1) * (S - 1)) / q) * q;
    const w = (1 + Math.floor(rng() * 5)) * q + jitter();
    const d = (1 + Math.floor(rng() * 5)) * q + jitter();
    const kind = rng();
    let y0 = 0;
    let y1: number;
    if (kind < 0.4) y1 = pick([0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 0.5, 0.5, 1.0, 0.1]) + jitter();
    else if (kind < 0.6) y1 = 2 + rng() * 5;
    else if (kind < 0.85) {
      y0 = pick([1.3, 1.301, 1.302, 1.8, 1.801, 1.802, 2.05, 2.3, 1.55, 2.301, 2.8]) + jitter();
      y1 = y0 + 0.2 + rng();
    } else {
      y0 = pick([0.5, 0.501, 0.502, 0.25, 1.0]);
      y1 = y0 + pick([0.05, 0.25, 0.5, 1.3, 1.8]);
    }
    solids.push(solid(x, y0, z, x + w, y1, z + d));
  }
  return { solids, world: new CollisionWorld(solids), bounds: { min: { x: -S, y: 0, z: -S }, max: { x: S, y: 9, z: S } } };
}

/** Free standing spots (hull does not overlap anything), half of them in the air. */
function freeSpots(tw: TestWorld, seed: number, count: number, lattice = 0): [number, number, number][] {
  const rng = mulberry32(seed);
  const { min, max } = tw.bounds;
  const spots: [number, number, number][] = [];
  for (let guard = 0; spots.length < count && guard < 100000; guard++) {
    let x = min.x + 1 + rng() * (max.x - min.x - 2);
    let z = min.z + 1 + rng() * (max.z - min.z - 2);
    if (lattice > 0 && rng() < 0.5) {
      x = Math.round(x / lattice) * lattice;
      z = Math.round(z / lattice) * lattice;
    }
    const y = rng() < 0.5 ? (rng() < 0.5 ? 0 : SKIN) : 3 + rng() * 4;
    if (!tw.world.boxOverlaps({ x, y: y + PLAYER_HEIGHT / 2, z }, { x: HW, y: PLAYER_HEIGHT / 2, z: HW })) spots.push([x, y, z]);
  }
  return spots;
}

interface FuzzStats {
  ticks: number;
  /** Longest run of consecutive ticks without progress while holding forward in open space. */
  longestStall: number;
  jumps: number;
  travelled: number;
}

/**
 * Drive players with random input (and optional shoves) and check after every tick that:
 *  - the state is finite and inside the playable volume;
 *  - the hull never overlaps a solid (checked by Sim.tick);
 *  - nobody teleports, climbs more than a step or sinks more than a step while on the ground;
 *  - holding only "forward" with 30 cm of free space ahead always produces movement.
 */
function fuzzPlayers(
  tw: TestWorld,
  starts: readonly (readonly [number, number, number])[],
  seed: number,
  ticks: number,
  opts: { shoves?: boolean; shoveUp?: boolean } = {},
): FuzzStats {
  const { world, bounds } = tw;
  const stats: FuzzStats = { ticks: 0, longestStall: 0, jumps: 0, travelled: 0 };
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const center: Vec = { x: 0, y: 0, z: 0 };
  const half: Vec = { x: HW, y: PLAYER_HEIGHT / 2, z: HW };
  const ahead: Vec = { x: 0, y: 0, z: 0 };
  for (let p = 0; p < starts.length; p++) {
    const start = starts[p]!;
    // Every third player carries a heavy weapon.
    const sim = new Sim(world, start[0], start[1], start[2], RUN * (p % 3 === 0 ? 0.82 : 1));
    const input = makeInput(seed * 977 + p);
    const where = (i: number): string => `seed ${seed}, player ${p}, tick ${i}`;
    let stall = 0;
    let shoved = 0;
    for (let i = 0; i < ticks; i++) {
      const { buttons, yaw } = input();
      const s = sim.s;
      const bx = s.pos.x;
      const by = s.pos.y;
      const bz = s.pos.z;
      const wasGround = s.onGround;
      // "Open space": the standing hull (the largest the player can be this tick) can be swept
      // 30 cm along the wish direction without touching anything.
      let open = false;
      if ((buttons & MOVE_KEYS) === BTN.Forward) {
        center.x = bx;
        center.y = by + PLAYER_HEIGHT / 2;
        center.z = bz;
        ahead.x = -Math.sin(yaw) * 0.3;
        ahead.z = -Math.cos(yaw) * 0.3;
        open = !world.sweepBox(center, half, ahead).hit;
      }
      sim.tick(buttons, yaw);
      stats.ticks++;
      const sum = s.pos.x + s.pos.y + s.pos.z + s.vel.x + s.vel.y + s.vel.z + s.crouch + s.landSlow + sim.ev.landedSpeed;
      if (!Number.isFinite(sum)) throw new Error(`${where(i)}: non-finite state ${JSON.stringify(s)}`);
      if (
        s.pos.x < bounds.min.x || s.pos.x > bounds.max.x || s.pos.y < bounds.min.y || s.pos.y > bounds.max.y ||
        s.pos.z < bounds.min.z || s.pos.z > bounds.max.z
      ) {
        throw new Error(`${where(i)}: left the playable volume ${JSON.stringify(s.pos)}`);
      }
      if (s.crouch < 0 || s.crouch > 1 || s.landSlow < MOVE.landingSlow || s.landSlow > 1) {
        throw new Error(`${where(i)}: bad crouch / landSlow ${s.crouch} ${s.landSlow}`);
      }
      if (s.onGround && s.vel.y !== 0) throw new Error(`${where(i)}: vertical speed on the ground`);
      if (s.vel.y < -MOVE.maxFallSpeed || s.vel.y > MOVE.jumpSpeed + 20) throw new Error(`${where(i)}: vertical speed ${s.vel.y}`);
      const moved = Math.hypot(s.pos.x - bx, s.pos.z - bz);
      if (shoved <= 0 && moved > RUN * 1.5 * TICK_DT) throw new Error(`${where(i)}: moved ${moved} m in one tick`);
      if (wasGround && s.onGround) {
        // 1 mm of slack on both: a step of STEP_HEIGHT + SKIN is still (just) climbable.
        if (s.pos.y - by > STEP_HEIGHT + 1.1 * SKIN) throw new Error(`${where(i)}: stepped up ${s.pos.y - by} m`);
        if (by - s.pos.y > STEP_HEIGHT + 3.1 * SKIN) throw new Error(`${where(i)}: snapped down ${by - s.pos.y} m`);
      }
      // Stall detector. From rest the slowest stance still covers 5 mm in its first tick, so
      // less than 1 mm with free space ahead means "not moving". Single ticks are normal in
      // the air (0.76 m/s of air control reversing a small drift).
      if (open && moved < 1e-3) {
        stall++;
        if (stall > stats.longestStall) stats.longestStall = stall;
        if (stall > seconds(2)) throw new Error(`${where(i)}: stuck for 2 s in open space at ${JSON.stringify(s.pos)} yaw ${yaw}`);
      } else stall = 0;
      stats.travelled += moved;
      shoved--;
      if (opts.shoves && rng() < 0.002) {
        const a = rng() * Math.PI * 2;
        const speed = rng() * 30;
        s.vel.x = Math.cos(a) * speed;
        s.vel.z = Math.sin(a) * speed;
        if (rng() < 0.5) s.vel.y = (opts.shoveUp ? rng() * 2 - 1 : -rng()) * 20;
        shoved = seconds(4);
      }
    }
    stats.jumps += sim.jumps;
  }
  return stats;
}

const devMap = getMap('dev_test');
const devWorld = new CollisionWorld(devMap.solids);

// =============================================================================================
// Movement
// =============================================================================================

describe('sliding along walls', () => {
  /** The four wall orientations: unit vector pointing INTO the wall, and the two slide directions. */
  const WALLS = [
    { into: [1, 0], tangent: [0, 1] },
    { into: [1, 0], tangent: [0, -1] },
    { into: [-1, 0], tangent: [0, 1] },
    { into: [-1, 0], tangent: [0, -1] },
    { into: [0, 1], tangent: [1, 0] },
    { into: [0, 1], tangent: [-1, 0] },
    { into: [0, -1], tangent: [1, 0] },
    { into: [0, -1], tangent: [-1, 0] },
  ] as const;
  /** A single long wall whose face is 5 m from the origin, in the direction `into`. */
  const wallWorld = (into: readonly [number, number]): CollisionWorld =>
    into[0] !== 0
      ? flatWorld(solid(into[0] > 0 ? 5 : -5.5, 0, -400, into[0] > 0 ? 5.5 : -5, 4, 400))
      : flatWorld(solid(-400, 0, into[1] > 0 ? 5 : -5.5, 400, 4, into[1] > 0 ? 5.5 : -5));
  const world = wallWorld([1, 0]);
  const limit = 5 - HW;

  it('keeps at least the tangential part of the run speed at shallow angles, on every wall and both ways', () => {
    for (const deg of [5, 10, 20, 30, 45, 60]) {
      const a = (deg * Math.PI) / 180;
      const steady: number[] = [];
      for (const { into, tangent } of WALLS) {
        const dir = [tangent[0] * Math.cos(a) + into[0] * Math.sin(a), tangent[1] * Math.cos(a) + into[1] * Math.sin(a)] as const;
        const yaw = yawToward(dir[0], dir[1]);
        // Start 0.3 m from the wall.
        const sim = new Sim(wallWorld(into), into[0] * (limit - 0.3), 0, into[1] * (limit - 0.3));
        let slowest = Infinity;
        let fastest = 0;
        sim.run(seconds(4), BTN.Forward, yaw, (p, i) => {
          if (i < seconds(2)) return;
          const s = p.s;
          const along = s.vel.x * tangent[0] + s.vel.z * tangent[1];
          slowest = Math.min(slowest, along);
          fastest = Math.max(fastest, along);
          // The speed into the wall is removed exactly, never reflected.
          expect(Math.abs(s.vel.x * into[0] + s.vel.z * into[1])).toBe(0);
          // The hull stays just in front of the wall: never touching, never farther than the skin.
          const gap = limit - (s.pos.x * into[0] + s.pos.z * into[1]);
          expect(gap).toBeGreaterThan(0);
          expect(gap).toBeLessThanOrEqual(SKIN + 1e-9);
          expect(s.onGround).toBe(true);
        });
        // Nothing is lost beyond the projection on the wall. (Like in any Quake-derived engine
        // the wish direction keeps accelerating along the wall: a few percent above run speed.)
        expect(slowest).toBeGreaterThanOrEqual(RUN * Math.cos(a) - 1e-6);
        expect(fastest).toBeLessThan(RUN * 1.07);
        // Perfectly steady: a seam, a snag or jitter would show up as a dip.
        expect(fastest - slowest).toBeLessThan(0.01);
        steady.push(sim.s.vel.x * tangent[0] + sim.s.vel.z * tangent[1]);
      }
      // No axis or direction is favoured.
      for (const v of steady) expect(v).toBeCloseTo(steady[0]!, 5);
    }
  });

  it('nearly head-on, the player creeps along or stops but never jitters, bounces or sinks in', () => {
    for (const deg of [75, 80, 85, 89, 89.9, 90]) {
      const a = (deg * Math.PI) / 180;
      const sim = new Sim(world, limit - 0.3, 0, 0);
      const yaw = yawToward(Math.sin(a), Math.cos(a));
      sim.run(seconds(1), BTN.Forward, yaw);
      let lastZ = sim.s.pos.z;
      sim.run(seconds(3), BTN.Forward, yaw, (p) => {
        expect(p.s.pos.x).toBeLessThan(limit);
        expect(p.s.pos.x).toBeGreaterThanOrEqual(limit - SKIN - 1e-9);
        expect(p.s.vel.x).toBe(0);
        // Monotonic creep along the wall, never backwards.
        expect(p.s.pos.z).toBeGreaterThanOrEqual(lastZ);
        lastZ = p.s.pos.z;
        expect(p.s.pos.y).toBeCloseTo(SKIN, 9);
      });
      // Releasing the keys leaves the player exactly where it is.
      const rest = { ...sim.s.pos };
      sim.run(seconds(1), 0, yaw);
      expect(sim.s.vel).toEqual({ x: 0, y: 0, z: 0 });
      expect(Math.hypot(sim.s.pos.x - rest.x, sim.s.pos.z - rest.z)).toBeLessThan(0.02);
    }
  });

  it('walking along a wall while pushing into it gives the same trajectory whether the wall is one box or 600 bricks', () => {
    const wall = solid(5, 0, -30, 5.6, 4, 30);
    const bricks: Solid[] = [];
    for (let z = -30; z < 30; z += 0.5) {
      for (let y = 0; y < 4; y += 0.8) bricks.push(solid(5, y, z, 5.6, y + 0.8, z + 0.5));
    }
    const whole = flatWorld(wall);
    const tiled = flatWorld(...bricks);
    for (const deg of [3, 15, 45, 70]) {
      const a = (deg * Math.PI) / 180;
      const yaw = yawToward(Math.sin(a), Math.cos(a));
      const one = new Sim(whole, limit - 0.2, 0, -25);
      const many = new Sim(tiled, limit - 0.2, 0, -25);
      for (let i = 0; i < seconds(6); i++) {
        // Jump now and then: seams must be invisible to the feet, the head and in the air.
        const buttons = BTN.Forward | (i % 90 === 40 ? BTN.Jump : 0) | (i % 200 > 150 ? BTN.Crouch : 0);
        one.tick(buttons, yaw);
        many.tick(buttons, yaw);
        if (stateBits(one.s, one.ev) !== stateBits(many.s, many.ev)) {
          throw new Error(`${deg}°: brick wall differs from the monolithic wall at tick ${i}`);
        }
      }
      expect(one.s.pos.z).toBeGreaterThan(-25 + 6 * RUN * Math.cos(a) * 0.8);
    }
  });
});

describe('seams and corners', () => {
  it('walking straight into the seam between two wall boxes stops at the wall plane, at any offset', () => {
    // Two boxes meeting at z = 0, plus a cross seam at chest height (four boxes share an edge).
    const world = flatWorld(
      solid(5, 0, -50, 5.5, 1, 0),
      solid(5, 0, 0, 5.5, 1, 50),
      solid(5, 1, -50, 5.5, 4, 0),
      solid(5, 1, 0, 5.5, 4, 50),
    );
    for (const z of [0, 1e-12, -1e-12, 1e-6, -1e-6, 5e-4, -5e-4, 0.01, HW, -HW, HW + 1e-9, HW - 1e-9, -HW - 1e-9, 0.2]) {
      const sim = new Sim(world, 3, 0, z).run(seconds(2), BTN.Forward, YAW.posX);
      expect(sim.s.pos.x).toBeCloseTo(5 - HW - SKIN, 9);
      // No sideways push from the seam (only the float noise of cos(yaw)).
      expect(Math.abs(sim.s.pos.z - z)).toBeLessThan(1e-9);
      expect(sim.s.vel.x).toBe(0);
      // Still pressed against the wall, strafing across the seam is unhindered in both directions.
      for (const key of [BTN.Left, BTN.Right]) {
        const strafe = new Sim(world, sim.s.pos.x, sim.s.pos.y, sim.s.pos.z);
        strafe.run(seconds(1.5), BTN.Forward | key, YAW.posX);
        expect(Math.abs(strafe.s.pos.z - z)).toBeGreaterThan(4);
        expect(Math.abs(strafe.s.vel.z)).toBeGreaterThan(RUN * Math.SQRT1_2);
      }
    }
  });

  it('comes to a dead, stable rest in an inside corner and leaves it at once', () => {
    // Corner at (+5, -5) made of two walls of two boxes each, on a floor seam.
    const world = new CollisionWorld([
      solid(-50, -1, -50, 5, 0, -5),
      solid(-50, -1, -5, 5, 0, 50),
      solid(5, -1, -50, 50, 0, 50),
      solid(5, 0, -50, 5.5, 2, 50),
      solid(5, 2, -50, 5.5, 4, 50),
      solid(-50, 0, -5.5, 0, 4, -5),
      solid(0, 0, -5.5, 5, 4, -5),
    ]);
    for (const deg of [20, 30, 45, 60, 70]) {
      const a = (deg * Math.PI) / 180;
      const yaw = yawToward(Math.sin(a), -Math.cos(a));
      const sim = new Sim(world, 2, 0, -2).run(seconds(3), BTN.Forward, yaw);
      expect(sim.s.pos.x).toBeCloseTo(5 - HW - SKIN, 9);
      expect(sim.s.pos.z).toBeCloseTo(-5 + HW + SKIN, 9);
      expect(sim.s.vel).toEqual({ x: 0, y: 0, z: 0 });
      // Still pushing: not a single bit moves.
      const rest = stateBits(sim.s, sim.ev);
      sim.run(seconds(2), BTN.Forward, yaw, (p) => expect(stateBits(p.s, p.ev)).toBe(rest));
      // Jumping in the corner goes straight up and comes straight down.
      sim.tick(BTN.Forward | BTN.Jump, yaw);
      sim.run(seconds(1), BTN.Forward, yaw);
      expect(sim.jumps).toBe(1);
      expect(sim.s.pos.x).toBeCloseTo(5 - HW - SKIN, 9);
      expect(sim.s.pos.z).toBeCloseTo(-5 + HW + SKIN, 9);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
      // Backing out responds on the very first tick.
      sim.tick(BTN.Back, yaw);
      expect(speedOf(sim.s)).toBeGreaterThan(0.4);
      sim.run(seconds(0.5), BTN.Back, yaw);
      expect(Math.hypot(sim.s.pos.x - (5 - HW), sim.s.pos.z - (-5 + HW))).toBeGreaterThan(1.5);
    }
  });

  it('slides around an outside corner without stopping', () => {
    // Box with a corner at (5, 0); the player slides along its -X face toward +Z, pushing into it.
    const world = flatWorld(solid(5, 0, -10, 9, 4, 0));
    for (const deg of [20, 45, 70]) {
      const a = (deg * Math.PI) / 180;
      const yaw = yawToward(Math.sin(a), Math.cos(a));
      const sim = new Sim(world, 5 - HW - 0.3, 0, -8);
      let slowest = Infinity;
      let passedAt = -1;
      sim.run(seconds(5), BTN.Forward, yaw, (p, i) => {
        if (i > seconds(1)) slowest = Math.min(slowest, speedOf(p.s));
        if (passedAt < 0 && p.s.pos.x > 5 + HW) passedAt = i;
      });
      // Once past the corner the player heads into the open at full speed.
      expect(passedAt).toBeGreaterThan(0);
      expect(slowest).toBeGreaterThan(RUN * Math.cos(a) - 1e-6);
      // (The small boost gained along the wall decays asymptotically.)
      expect(speedOf(sim.s)).toBeCloseTo(RUN, 3);
      expect(sim.s.pos.z).toBeGreaterThan(HW);
    }
  });

  it('a hull corner meeting a box corner exactly (and every offset around it) never snags', () => {
    // Player moving along an exact diagonal toward the corner (5, -5) of a pillar.
    const world = flatWorld(solid(5, 0, -6, 6, 4, -5));
    const yaw = yawToward(1, 1);
    for (const offset of [0, 1e-12, -1e-12, 1e-9, -1e-9, 1e-6, -1e-6, 5e-4, -5e-4, 1e-3, -1e-3, 2e-3, -2e-3, 0.05, -0.05]) {
      // With offset 0 the hull's (+X, +Z) corner travels exactly through the pillar's (-X, -Z) corner.
      const sim = new Sim(world, 5 - HW - 3 + offset, 0, -6 - HW - 3);
      let slowest = Infinity;
      sim.run(seconds(3), BTN.Forward, yaw, (p, i) => {
        if (i > seconds(1)) slowest = Math.min(slowest, speedOf(p.s));
      });
      // Deflected along one face at worst: the diagonal projection of the run speed.
      expect(slowest).toBeGreaterThan(RUN * Math.SQRT1_2 - 1e-6);
      // And well past the pillar after 3 s (free run would be ~17.5 m along the diagonal).
      expect(sim.s.pos.x + sim.s.pos.z).toBeGreaterThan(8);
    }
  });
});

describe('stairs, every way', () => {
  /**
   * Staircase rising toward +X between x = 3 and x = 3 + steps * run, 3 m wide (z in [-1.5, 1.5]),
   * enclosed by two side walls, with a landing at the top.
   */
  function staircase(rise: number, run: number, steps: number): { world: CollisionWorld; topX: number; topY: number } {
    const solids: Solid[] = [];
    for (let i = 0; i < steps; i++) solids.push(solid(3 + i * run, 0, -1.5, 3 + (i + 1) * run, (i + 1) * rise, 1.5));
    const topX = 3 + steps * run;
    const topY = steps * rise;
    solids.push(solid(topX, 0, -1.5, topX + 12, topY, 1.5));
    solids.push(solid(-12, 0, 1.5, topX + 12, topY + 5, 2), solid(-12, 0, -2, topX + 12, topY + 5, -1.5));
    return { world: flatWorld(...solids), topX, topY };
  }
  const SHAPES = [
    { rise: 0.25, run: 0.5 }, // dev_test
    { rise: 0.2, run: 0.3 },
    { rise: 0.18, run: 0.28 },
    { rise: 0.25, run: 0.3 },
    { rise: 0.1, run: 0.1 }, // finer than one tick of movement
    { rise: 0.5, run: 0.5 }, // the limit
    { rise: 0.5, run: 0.36 }, // steeper than 45°, deeper than... barely more than half a hull
  ] as const;
  const STANCES = [
    { name: 'run', buttons: BTN.Forward, maxSpeed: RUN },
    { name: 'walk', buttons: BTN.Forward | BTN.Walk, maxSpeed: RUN },
    { name: 'crouch', buttons: BTN.Forward | BTN.Crouch, maxSpeed: RUN },
    { name: 'crouch + walk', buttons: BTN.Forward | BTN.Crouch | BTN.Walk, maxSpeed: RUN },
    // Slowest stance of the game: scoped sniper, crouched, walking (about 0.5 m/s).
    { name: 'scoped crouch + walk', buttons: BTN.Forward | BTN.Crouch | BTN.Walk, maxSpeed: RUN * 0.82 * 0.55 },
    { name: 'backwards', buttons: BTN.Back, maxSpeed: RUN },
    { name: 'strafing', buttons: BTN.Right, maxSpeed: RUN },
  ] as const;
  /** Heading relative to the stair axis: straight, slightly off, and pushing hard into a side wall. */
  const HEADINGS = [0, 0.15, -0.15, 0.6, -0.6, 1.1, -1.1];

  /** Yaw such that the given keys move the player along `heading` (0 = +X, toward the top). */
  function yawFor(buttons: number, heading: number): number {
    const base = yawToward(Math.cos(heading), Math.sin(heading));
    if ((buttons & BTN.Back) !== 0) return base + Math.PI;
    if ((buttons & BTN.Right) !== 0) return base + Math.PI / 2;
    return base;
  }

  it('up and down every staircase, in every stance and heading: never airborne, never slowed by the steps', () => {
    let cases = 0;
    for (const { rise, run } of SHAPES) {
      const steps = 8;
      const { world, topX, topY } = staircase(rise, run, steps);
      // The same corridor without the stairs: what the walls alone cost at this heading.
      const flat = staircase(rise, run, 0).world;
      for (const stance of STANCES) {
        for (const heading of HEADINGS) {
          const label = `rise ${rise} run ${run}, ${stance.name}, heading ${heading}`;
          const limit = seconds(60);
          // --- Up: from 1.5 m before the first riser to 1 m past the last one.
          const startX = 3 - HW - 1.5;
          const goalUp = topX + 1;
          const yawUp = yawFor(stance.buttons, heading);
          const ref = new Sim(flat, startX, 0, 0, stance.maxSpeed);
          let refTicks = 0;
          while (ref.s.pos.x < goalUp && refTicks < limit) {
            ref.tick(stance.buttons, yawUp);
            refTicks++;
          }
          const up = new Sim(world, startX, 0, 0, stance.maxSpeed);
          let upTicks = 0;
          let lastY = 0;
          while (up.s.pos.x < goalUp && upTicks < limit) {
            up.tick(stance.buttons, yawUp);
            upTicks++;
            if (up.s.pos.y < lastY - 1e-9) throw new Error(`${label}: went down while climbing at tick ${upTicks}`);
            if (up.s.pos.y - lastY > rise + 1e-6) throw new Error(`${label}: climbed ${up.s.pos.y - lastY} m in one tick`);
            lastY = up.s.pos.y;
          }
          expect(up.s.pos.x, label).toBeGreaterThanOrEqual(goalUp);
          expect(up.s.pos.y, label).toBeCloseTo(topY + SKIN, 6);
          expect(up.airTicks, label).toBe(0);
          expect(up.landings.length, label).toBe(0);
          // Steps cost nothing: at most one tick more than the same run on flat ground
          // (far above the 85 % that would already feel fine).
          expect(upTicks, label).toBeLessThanOrEqual(refTicks + 1);

          // --- Down: from 1.5 m before the top edge back to the foot.
          const down = new Sim(world, topX + HW + 1.5, topY, 0, stance.maxSpeed);
          const yawDown = yawFor(stance.buttons, Math.PI - heading);
          const refDown = new Sim(flat, topX + HW + 1.5, 0, 0, stance.maxSpeed);
          let refDownTicks = 0;
          while (refDown.s.pos.x > 2 && refDownTicks < limit) {
            refDown.tick(stance.buttons, yawDown);
            refDownTicks++;
          }
          let downTicks = 0;
          lastY = topY + 1;
          while (down.s.pos.x > 2 && downTicks < limit) {
            down.tick(stance.buttons, yawDown);
            downTicks++;
            if (down.s.pos.y > lastY + 1e-9) throw new Error(`${label}: went up while descending at tick ${downTicks}`);
            if (downTicks > 1 && lastY - down.s.pos.y > rise + 1e-6) {
              throw new Error(`${label}: dropped ${lastY - down.s.pos.y} m in one tick`);
            }
            lastY = down.s.pos.y;
          }
          expect(down.s.pos.x, label).toBeLessThanOrEqual(2);
          expect(down.s.pos.y, label).toBeCloseTo(SKIN, 6);
          // Glued to the steps all the way: no hops, no landing thumps.
          expect(down.airTicks, label).toBe(0);
          expect(down.landings.length, label).toBe(0);
          expect(downTicks, label).toBeLessThanOrEqual(refDownTicks + 1);
          cases++;
        }
      }
    }
    expect(cases).toBe(SHAPES.length * STANCES.length * HEADINGS.length);
  });

  it('open flights of thin overlapping treads with railings (as the map kit builds them)', () => {
    // Treads 6 cm thick and 0.3 m deep, each reaching 2 cm under the next one; stepped railing
    // colliders on both sides; a slab at the top. Nothing underneath.
    for (const [rise, steps] of [[0.25, 13], [0.2, 16], [3.2 / 13, 13]] as const) {
      const depth = 0.3;
      const solids: Solid[] = [];
      for (let i = 0; i < steps; i++) {
        const top = (i + 1) * rise;
        solids.push(solid(3 + i * depth, top - 0.06, -0.8, 3 + (i + 1) * depth + (i + 1 < steps ? 0.02 : 0), top, 0.8));
        solids.push(solid(3 + i * depth, i * rise, 0.8, 3 + (i + 1) * depth, top + 1, 0.86));
        solids.push(solid(3 + i * depth, i * rise, -0.86, 3 + (i + 1) * depth, top + 1, -0.8));
      }
      const topX = 3 + steps * depth;
      const topY = steps * rise;
      solids.push(solid(topX, topY - 0.2, -3, topX + 10, topY, 3));
      const world = flatWorld(...solids);
      const flat = flatWorld();
      for (const stance of STANCES.slice(0, 5)) {
        const label = `open flight, rise ${rise.toFixed(3)}, ${stance.name}`;
        const timed = (w: CollisionWorld, from: number, y: number, yaw: number, done: (x: number) => boolean): Sim & { ticks: number } => {
          const sim = Object.assign(new Sim(w, from, y, 0, stance.maxSpeed), { ticks: 0 });
          while (!done(sim.s.pos.x) && sim.ticks < seconds(60)) {
            sim.tick(stance.buttons, yaw);
            sim.ticks++;
          }
          return sim;
        };
        const up = timed(world, 1, 0, YAW.posX, (x) => x >= topX + 1);
        const upRef = timed(flat, 1, 0, YAW.posX, (x) => x >= topX + 1);
        expect(up.s.pos.y, label).toBeCloseTo(topY + SKIN, 6);
        expect(up.airTicks, label).toBe(0);
        expect(up.ticks, label).toBeLessThanOrEqual(upRef.ticks + 1);
        const down = timed(world, topX + 2, topY, YAW.negX, (x) => x <= 1.5);
        const downRef = timed(flat, topX + 2, 0, YAW.negX, (x) => x <= 1.5);
        expect(down.s.pos.y, label).toBeCloseTo(SKIN, 6);
        expect(down.airTicks, label).toBe(0);
        expect(down.landings.length, label).toBe(0);
        expect(down.ticks, label).toBeLessThanOrEqual(downRef.ticks + 1);
      }
      // Wandering under and around the flight, jumping and crouching: the treads stop the head
      // and the hull never ends up between two of them (Sim.tick checks every tick).
      const rng = mulberry32(steps);
      const wanderer = new Sim(world, topX - 0.5, 0, -3);
      let yaw = YAW.posZ;
      for (let i = 0; i < seconds(40); i++) {
        if (i % 45 === 0) yaw = rng() * Math.PI * 2;
        wanderer.tick(BTN.Forward | (i % 40 === 0 ? BTN.Jump : 0) | (i % 150 > 100 ? BTN.Crouch : 0), yaw);
        // Pulled back toward the staircase when straying.
        if (Math.hypot(wanderer.s.pos.x - (topX + 3) / 2, wanderer.s.pos.z) > 6) yaw = yawToward((topX + 3) / 2 - wanderer.s.pos.x, -wanderer.s.pos.z);
      }
      expect(wanderer.s.pos.y).toBeLessThan(topY + 1.3);
    }
  });

  it('stops and restarts in the middle of a staircase without sliding down or sinking', () => {
    const { world, topY } = staircase(0.25, 0.5, 8);
    const sim = new Sim(world, 1, 0, 0);
    while (sim.s.pos.y < 0.9) sim.tick(BTN.Forward, YAW.posX);
    sim.run(seconds(1), 0, YAW.posX);
    expect(sim.s.vel).toEqual({ x: 0, y: 0, z: 0 });
    const rest = { ...sim.s.pos };
    sim.run(seconds(2), 0, YAW.posX);
    expect(sim.s.pos).toEqual(rest);
    expect(sim.s.onGround).toBe(true);
    // Crouch and stand up on a step: the feet do not move.
    sim.run(seconds(0.5), BTN.Crouch, YAW.posX);
    sim.run(seconds(0.5), 0, YAW.posX);
    expect(sim.s.pos).toEqual(rest);
    expect(sim.s.crouch).toBe(0);
    sim.run(seconds(2), BTN.Forward, YAW.posX);
    expect(sim.s.pos.y).toBeCloseTo(topY + SKIN, 6);
    expect(sim.airTicks).toBe(0);
  });

  it('rises just above STEP_HEIGHT are walls, with or without a run-up', () => {
    for (const rise of [0.51, 0.55, 0.75]) {
      const { world } = staircase(rise, 0.5, 4);
      const sim = new Sim(world, -6, 0, 0).run(seconds(3), BTN.Forward, YAW.posX);
      expect(sim.s.pos.x).toBeCloseTo(3 - HW - SKIN, 6);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
      expect(sim.s.vel.x).toBe(0);
    }
    // ...and every rise up to STEP_HEIGHT is not, to the millimetre.
    for (const rise of [0.001, 0.0015, 0.003, 0.03, 0.31, 0.499, STEP_HEIGHT]) {
      const { world, topY } = staircase(rise, 0.5, 4);
      const sim = new Sim(world, -1, 0, 0).run(seconds(2), BTN.Forward, YAW.posX);
      expect(sim.s.pos.y).toBeCloseTo(topY + SKIN, 6);
      expect(sim.airTicks).toBe(0);
    }
  });

  it('dev_test stairs: jumping, crouching and turning around half-way never leaves the player hanging', () => {
    const rng = mulberry32(4242);
    for (let run = 0; run < 40; run++) {
      const sim = new Sim(devWorld, 11.6 + rng() * 0.8, 0, -15.5);
      const flipAt = seconds(0.4 + rng() * 0.8);
      const jumpEvery = 5 + Math.floor(rng() * 40);
      // Slightly off the stair axis on odd runs (the staircase is 2 m wide and open on one side).
      const yawUp = YAW.posZ + (run % 2 === 0 ? 0 : run % 4 === 1 ? 0.04 : -0.04);
      let ticks = 0;
      // Stairs span z in [-14, -10]; stop one metre onto the walkway.
      while (sim.s.pos.z < -9 && ticks < seconds(8)) {
        const back = ticks >= flipAt && ticks < flipAt + seconds(0.5);
        let buttons = BTN.Forward | (ticks % jumpEvery === 0 ? BTN.Jump : 0);
        if (run % 3 === 1 && ticks % 50 < 20) buttons |= BTN.Crouch;
        sim.tick(buttons, back ? YAW.negZ : yawUp);
        ticks++;
      }
      // Everybody reaches the walkway, 2 m up, in a few seconds (a clean run takes 1.2 s).
      expect(sim.s.pos.z).toBeGreaterThanOrEqual(-9);
      expect(ticks).toBeLessThan(seconds(5));
      sim.run(seconds(0.8), 0, yawUp);
      expect(sim.s.pos.y).toBeCloseTo(2 + SKIN, 6);
      expect(sim.s.onGround).toBe(true);
    }
  });
});

describe('jumping onto boxes', () => {
  const APEX = (MOVE.jumpSpeed * MOVE.jumpSpeed) / (2 * MOVE.gravity);
  /** Long and wide box in front of the player: x >= 3. */
  const boxWorld = (height: number): CollisionWorld => flatWorld(solid(3, 0, -60, 40, height, 60));

  /** Run toward the box and jump when the hull is `lead` metres from its face. */
  function runningJump(world: CollisionWorld, lead: number, extra = 0, heading = 0): Sim {
    const sim = new Sim(world, -5, 0, 0);
    let jumped = false;
    for (let i = 0; i < seconds(4); i++) {
      const jump = !jumped && 3 - HW - sim.s.pos.x <= lead;
      if (jump) jumped = true;
      sim.tick(BTN.Forward | extra | (jump ? BTN.Jump : 0), YAW.posX + heading);
    }
    return sim;
  }

  it('0.9 m and 1.1 m boxes are reachable from any sensible take-off point', () => {
    for (const height of [0.9, 1.1]) {
      const world = boxWorld(height);
      // The feet are above 1.1 m for 0.22 s of a jump, above 0.9 m for 0.36 s: at run speed
      // every take-off between 5 cm and 2.2 m from the box works, also when the approach is
      // up to 17° off the perpendicular. (Steeper than about 20°, a player that touches the
      // face before its feet clear the top slides along it, as in Source: the sideways speed
      // already exceeds what air control can add toward the box.)
      for (let lead = 0.05; lead <= 2.2; lead += 0.05) {
        for (const heading of [0, 0.3, -0.3]) {
          const sim = runningJump(world, lead, 0, heading);
          expect(sim.jumps).toBe(1);
          if (Math.abs(sim.s.pos.y - (height + SKIN)) > 1e-6) {
            throw new Error(`box ${height}, take-off ${lead.toFixed(2)} m away, heading ${heading}: ended at y = ${sim.s.pos.y}`);
          }
          expect(sim.s.onGround).toBe(true);
        }
      }
      // Standing against the box: jump and hold forward.
      const standing = new Sim(world, 2, 0, 0).run(seconds(1), BTN.Forward, YAW.posX);
      expect(standing.s.pos.x).toBeCloseTo(3 - HW - SKIN, 6);
      standing.run(seconds(0.5), 0, YAW.posX);
      standing.tick(BTN.Forward | BTN.Jump, YAW.posX);
      standing.run(seconds(1), BTN.Forward, YAW.posX);
      expect(standing.s.pos.y).toBeCloseTo(height + SKIN, 6);
      // Crouching in the air neither helps nor hurts.
      const ducked = runningJump(world, 0.6, BTN.Crouch);
      expect(ducked.s.pos.y).toBeCloseTo(height + SKIN, 6);
      // A steep diagonal approach works when the jump starts early enough to clear the top
      // before reaching the box (here 0.32 s before, 1.6 m away at 34° off the perpendicular).
      for (const heading of [0.6, -0.6]) {
        const diagonal = runningJump(world, 1.6, 0, heading);
        expect(diagonal.s.pos.y).toBeCloseTo(height + SKIN, 6);
      }
    }
  });

  it('a 1.4 m box is out of reach whatever the player tries', () => {
    const world = boxWorld(1.4);
    let highest = 0;
    const watch = (sim: Sim): void => {
      highest = Math.max(highest, sim.s.pos.y);
    };
    for (let lead = 0; lead <= 3; lead += 0.05) {
      for (const extra of [0, BTN.Crouch]) {
        const sim = new Sim(world, -5, 0, 0);
        let jumped = false;
        for (let i = 0; i < seconds(3); i++) {
          const jump = !jumped && 3 - HW - sim.s.pos.x <= lead;
          if (jump) jumped = true;
          sim.tick(BTN.Forward | (jumped ? extra : 0) | (jump ? BTN.Jump : 0), YAW.posX);
          watch(sim);
        }
        expect(sim.s.pos.x).toBeLessThan(3 - HW);
      }
    }
    // Jumping again on every landing (perfect bunny-hop timing), crouch spam, wiggling.
    for (const period of [2, 3, 5, 9, 46]) {
      const sim = new Sim(world, 0, 0, 0);
      for (let i = 0; i < seconds(8); i++) {
        let buttons = BTN.Forward | (i % period === 0 ? BTN.Jump : 0);
        if (i % 7 < 3) buttons |= BTN.Crouch;
        sim.tick(buttons, YAW.posX + Math.sin(i * 0.3) * 0.4);
        watch(sim);
      }
      expect(sim.s.pos.x).toBeLessThan(3 - HW);
    }
    // The feet never get higher than one jump above the floor.
    expect(highest).toBeLessThan(SKIN + APEX + 1e-9);
    expect(highest).toBeGreaterThan(APEX - 0.01);
  });

  it('the reachable height is exactly the jump apex (1.2 m, not 1.3 m)', () => {
    for (const height of [1.15, 1.2, 1.21]) {
      const sim = new Sim(boxWorld(height), 2, 0, 0).run(seconds(1), BTN.Forward, YAW.posX);
      sim.tick(BTN.Forward | BTN.Jump, YAW.posX);
      sim.run(seconds(1), BTN.Forward, YAW.posX);
      expect(sim.s.pos.y).toBeCloseTo(height + SKIN, 6);
    }
    for (const height of [1.24, 1.3]) {
      const sim = new Sim(boxWorld(height), 2, 0, 0).run(seconds(1), BTN.Forward, YAW.posX);
      sim.tick(BTN.Forward | BTN.Jump, YAW.posX);
      sim.run(seconds(1), BTN.Forward, YAW.posX);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 6);
    }
  });
});

describe('landing on box edges', () => {
  // 1 m box occupying x in [0, 2].
  const world = flatWorld(solid(0, 0, -2, 2, 1, 2));

  it('any overlap with the top face, however small, is a landing; none is a miss', () => {
    for (const overlap of [1e-12, 1e-9, 1e-6, 5e-4, 1e-3, 2e-3, 0.01, 0.2, HW, 2 * HW]) {
      // Hull falling with its +X side `overlap` past the box edge.
      const sim = new Sim(world, overlap - HW, 3, 0).run(seconds(2), 0);
      expect(sim.s.pos.y).toBeCloseTo(1 + SKIN, 9);
      expect(sim.s.onGround).toBe(true);
      expect(sim.landings.length).toBe(1);
      // Perched on the edge, perfectly still.
      const rest = stateBits(sim.s, sim.ev);
      sim.run(seconds(1), 0, 0, (p) => expect(stateBits(p.s, p.ev)).toBe(rest));
    }
    for (const overlap of [0, -1e-12, -1e-9, -1e-6, -1e-3, -0.2]) {
      // Touching or beside: slides down the face to the floor without catching on the edge.
      const sim = new Sim(world, overlap - HW, 3, 0).run(seconds(2), 0);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
      expect(sim.s.pos.x).toBe(overlap - HW);
      expect(sim.landings.length).toBe(1);
    }
  });

  it('flying at the edge from any height and speed ends on the box or on the floor, never in between', () => {
    let onTop = 0;
    let onFloor = 0;
    for (const vx of [0.5, 2, 6, 20]) {
      for (const y0 of [1.05, 1.2, 1.5, 2, 3, 5]) {
        for (let x0 = -3; x0 < -HW; x0 += 0.0371) {
          const sim = new Sim(world, x0, y0, 0);
          sim.s.vel.x = vx;
          sim.run(seconds(2.5), 0);
          const y = sim.s.pos.y;
          if (Math.abs(y - (1 + SKIN)) < 1e-6) onTop++;
          else if (Math.abs(y - SKIN) < 1e-6) onFloor++;
          else throw new Error(`vx ${vx}, from (${x0}, ${y0}): hanging at y = ${y}`);
          expect(sim.s.onGround).toBe(true);
          expect(sim.s.vel).toEqual({ x: 0, y: 0, z: 0 });
        }
      }
    }
    expect(onTop).toBeGreaterThan(100);
    expect(onFloor).toBeGreaterThan(100);
  });

  it('walking off the edge: supported until the last millimetre, then a clean fall', () => {
    const sim = new Sim(world, 1, 1, 0).run(seconds(0.5), 0);
    let fellAt = Infinity;
    for (let i = 0; i < seconds(6) && sim.s.pos.y > 0.5; i++) {
      sim.tick(BTN.Forward | BTN.Walk | BTN.Crouch, YAW.negX);
      if (!sim.s.onGround && fellAt === Infinity) fellAt = sim.s.pos.x;
    }
    // Left the box when the hull's +X side passed the edge at x = 0 (one tick of travel at most).
    expect(fellAt).toBeLessThanOrEqual(-HW);
    expect(fellAt).toBeGreaterThan(-HW - 0.02);
    sim.run(seconds(1), 0);
    expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
    // One landing: the 1 m fall (sqrt(2 g h) = 6.3 m/s, reported within a tick of gravity).
    expect(sim.landings.length).toBe(1);
    expect(sim.landings[0]!).toBeGreaterThan(6.0);
    expect(sim.landings[0]!).toBeLessThan(6.4);
  });
});

describe('ceilings', () => {
  it('a jump under a low ceiling stops at the ceiling and comes back down', () => {
    const fullAir = Math.round((2 * MOVE.jumpSpeed) / MOVE.gravity / TICK_DT);
    for (const ceiling of [1.9, 2.0, 2.3, 2.5, 3.0]) {
      const world = flatWorld(solid(-5, ceiling, -5, 5, ceiling + 0.3, 5));
      const sim = new Sim(world, 0, 0, 0).run(4, 0);
      sim.tick(BTN.Jump, 0);
      let top = sim.s.pos.y + PLAYER_HEIGHT;
      let air = 1;
      while (!sim.s.onGround && air < 200) {
        sim.tick(0, 0);
        air++;
        top = Math.max(top, sim.s.pos.y + PLAYER_HEIGHT);
      }
      // The head ends the ascent exactly one skin below the ceiling.
      expect(top).toBeCloseTo(ceiling - SKIN, 9);
      expect(air).toBeLessThan(fullAir);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
      // Falling back from the ceiling, not from a full jump.
      expect(sim.landings.length).toBe(1);
      // Free fall from the ceiling: sqrt(2 g h), reported within half a tick of gravity; the
      // landing is detected up to 3 cm above the ground.
      const drop = ceiling - PLAYER_HEIGHT - 2 * SKIN;
      expect(sim.landings[0]!).toBeLessThan(Math.sqrt(2 * MOVE.gravity * drop) + 0.2);
      expect(sim.landings[0]!).toBeGreaterThan(Math.sqrt(2 * MOVE.gravity * (drop - 0.03)) - 0.2);
    }
    // Headroom of one skin only: the jump is a no-op (one airborne tick at most, no height gained).
    const tight = flatWorld(solid(-5, PLAYER_HEIGHT + 2 * SKIN, -5, 5, 3, 5));
    const sim = new Sim(tight, 0, 0, 0).run(4, 0);
    sim.tick(BTN.Jump, 0);
    sim.tick(0, 0);
    expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
    expect(sim.s.onGround).toBe(true);
    expect(sim.landings.length).toBe(0);
  });

  it('bumping the head during a running jump does not cost any horizontal speed', () => {
    const world = flatWorld(solid(-50, 2.3, -5, 50, 2.6, 5));
    const sim = new Sim(world, -20, 0, 0).run(seconds(1.5), BTN.Forward, YAW.posX);
    sim.tick(BTN.Forward | BTN.Jump, YAW.posX);
    let ticks = 1;
    while (!sim.s.onGround && ticks++ < 100) {
      sim.tick(BTN.Forward, YAW.posX);
      expect(sim.s.vel.x).toBeGreaterThanOrEqual(RUN - 1e-9);
      expect(sim.s.pos.y + PLAYER_HEIGHT).toBeLessThanOrEqual(2.3 - SKIN + 1e-9);
    }
    // Shorter hop than a free jump (0.7 s).
    expect(ticks * TICK_DT).toBeLessThan(0.5);
  });

  it('jumping into the edge of a lintel blocks the head, not the feet, and never traps the player', () => {
    // Doorway 2.1 m high in a 0.2 m wall at x = 3.
    const world = flatWorld(solid(3, 2.1, -1, 3.2, 3, 1), solid(3, 0, -10, 3.2, 3, -1), solid(3, 0, 1, 3.2, 3, 10));
    for (let lead = 0.1; lead < 3; lead += 0.1) {
      const sim = new Sim(world, -5, 0, 0);
      let jumped = false;
      for (let i = 0; i < seconds(3); i++) {
        const jump = !jumped && 3 - HW - sim.s.pos.x <= lead;
        if (jump) jumped = true;
        sim.tick(BTN.Forward | (jump ? BTN.Jump : 0), YAW.posX);
      }
      // Through the door within three seconds, whether or not the head hit the lintel.
      expect(sim.s.pos.x).toBeGreaterThan(5);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
    }
  });

  it('low ceilings combined with steps', () => {
    const cases: { step: number; ceiling: number; standing: boolean; crouched: boolean }[] = [
      // 0.25 m step, ceiling 2.04 m above the lower floor: 1.79 m left on top, not enough to stand.
      { step: 0.25, ceiling: 2.04, standing: false, crouched: true },
      // 1.81 m left on top: fits (hull + skin = 1.801).
      { step: 0.25, ceiling: 2.06, standing: true, crouched: true },
      { step: 0.25, ceiling: 2.3, standing: true, crouched: true },
      // Full-height step needs 0.5 + 1.8 m.
      { step: 0.5, ceiling: 2.29, standing: false, crouched: true },
      { step: 0.5, ceiling: 2.31, standing: true, crouched: true },
      // Crawl space: 1.31 m left on top of the step.
      { step: 0.25, ceiling: 1.56, standing: false, crouched: true },
      { step: 0.25, ceiling: 1.54, standing: false, crouched: false },
      { step: 0.5, ceiling: 1.79, standing: false, crouched: false },
    ];
    for (const c of cases) {
      const label = `step ${c.step} under a ceiling at ${c.ceiling}`;
      const world = flatWorld(solid(3, 0, -5, 30, c.step, 5), solid(-10, c.ceiling, -5, 30, c.ceiling + 0.3, 5));
      const blockedX = 3 - HW - SKIN;
      const standing = new Sim(world, 0, 0, 0);
      // A standing player that does not fit under the ceiling at all starts ducked by the safety.
      standing.run(seconds(3), BTN.Forward, YAW.posX);
      if (c.standing) {
        expect(standing.s.pos.x, label).toBeGreaterThan(10);
        expect(standing.s.pos.y, label).toBeCloseTo(c.step + SKIN, 6);
        expect(standing.s.crouch, label).toBe(0);
      } else if (c.ceiling > PLAYER_HEIGHT + 2 * SKIN) {
        expect(standing.s.pos.x, label).toBeCloseTo(blockedX, 6);
        expect(standing.s.pos.y, label).toBeCloseTo(SKIN, 9);
      }
      const crouched = new Sim(world, 0, 0, 0).run(seconds(8), BTN.Forward | BTN.Crouch, YAW.posX);
      if (c.crouched) {
        expect(crouched.s.pos.x, label).toBeGreaterThan(6);
        expect(crouched.s.pos.y, label).toBeCloseTo(c.step + SKIN, 6);
        // Releasing crouch up there: stands up only where the standing hull fits.
        crouched.run(seconds(1), BTN.Forward, YAW.posX);
        expect(crouched.s.crouch, label).toBe(c.standing ? 0 : 1);
      } else {
        expect(crouched.s.pos.x, label).toBeCloseTo(blockedX, 6);
      }
      // Hammering jump against the step gains nothing that walking does not.
      const hopper = new Sim(world, 2, 0, 0);
      for (let i = 0; i < seconds(4); i++) hopper.tick(BTN.Forward | (i % 3 === 0 ? BTN.Jump : 0), YAW.posX);
      if (!c.standing && c.ceiling > PLAYER_HEIGHT + 2 * SKIN) expect(hopper.s.pos.x, label).toBeLessThan(3 - HW);
    }
  });

  it('a stairwell whose ceiling follows the steps needs 2.3 m of headroom, not 1.8 m', () => {
    // 0.25 x 0.5 m steps toward +X; above each tread a ceiling slab `headroom` higher. The
    // 0.7 m hull also stands under the slab of the tread behind it, which is 0.25 m lower, and
    // has to rise by one step before moving forward: 1.8 + 0.25 + 0.25 m plus the skins.
    const stairwell = (headroom: number): CollisionWorld => {
      const solids: Solid[] = [solid(-10, headroom, -1, 3, 8, 1)];
      for (let i = 0; i < 8; i++) {
        solids.push(solid(3 + i * 0.5, 0, -1, 3.5 + i * 0.5, (i + 1) * 0.25, 1));
        solids.push(solid(3 + i * 0.5, (i + 1) * 0.25 + headroom, -1, 3.5 + i * 0.5, 8, 1));
      }
      solids.push(solid(7, 0, -1, 20, 2, 1), solid(7, 2 + headroom, -1, 20, 8, 1));
      return flatWorld(...solids);
    };
    for (const headroom of [2.31, 2.5]) {
      const world = stairwell(headroom);
      const up = new Sim(world, 0, 0, 0).run(seconds(2.5), BTN.Forward, YAW.posX);
      expect(up.s.pos.y).toBeCloseTo(2 + SKIN, 6);
      expect(up.s.pos.x).toBeGreaterThan(8);
      expect(up.airTicks).toBe(0);
      expect(speedOf(up.s)).toBeCloseTo(RUN, 6);
      const down = new Sim(world, 10, 2, 0).run(seconds(2.5), BTN.Forward, YAW.negX);
      expect(down.s.pos.y).toBeCloseTo(SKIN, 6);
      expect(down.airTicks).toBe(0);
    }
    // 2.25 m: too low standing, in both directions (the head meets the lower slab before the
    // feet can change level)...
    const low = stairwell(2.25);
    const stuckUp = new Sim(low, 0, 0, 0).run(seconds(3), BTN.Forward, YAW.posX);
    expect(stuckUp.s.pos.y).toBeLessThan(0.6);
    expect(stuckUp.s.vel.x).toBe(0);
    const stuckDown = new Sim(low, 10, 2, 0).run(seconds(3), BTN.Forward, YAW.negX);
    expect(stuckDown.s.pos.y).toBeGreaterThan(1.7);
    expect(stuckDown.s.vel.x).toBe(0);
    // ...but fine crouched, both ways.
    const duckedUp = new Sim(low, 0, 0, 0).run(seconds(6), BTN.Forward | BTN.Crouch, YAW.posX);
    expect(duckedUp.s.pos.y).toBeCloseTo(2 + SKIN, 6);
    expect(duckedUp.airTicks).toBe(0);
    const duckedDown = new Sim(low, 10, 2, 0).run(seconds(8), BTN.Forward | BTN.Crouch, YAW.negX);
    expect(duckedDown.s.pos.y).toBeCloseTo(SKIN, 6);
    expect(duckedDown.airTicks).toBe(0);
  });
});

describe('crouch transitions', () => {
  it('standing up is all or nothing: allowed exactly where the standing hull fits', () => {
    for (const ceiling of [1.302, 1.35, 1.5, 1.79, 1.8, 1.8015, 1.9, 2.5]) {
      const world = flatWorld(solid(0, ceiling, -5, 10, ceiling + 0.3, 5));
      const sim = new Sim(world, -3, 0, 0);
      sim.run(seconds(4), BTN.Crouch | BTN.Forward, YAW.posX);
      expect(sim.s.pos.x).toBeGreaterThan(2);
      expect(sim.s.pos.x).toBeLessThan(8);
      sim.run(seconds(1), 0, YAW.posX);
      const fits = ceiling >= PLAYER_HEIGHT + SKIN;
      expect(sim.s.crouch).toBe(fits ? 0 : 1);
      // Jumping while held down by the ceiling changes nothing.
      sim.tick(BTN.Jump, YAW.posX);
      sim.run(seconds(1), 0, YAW.posX);
      expect(sim.s.crouch).toBe(fits ? 0 : 1);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
      // Walking out from under it (no crouch key): stands up as soon as there is room.
      sim.run(seconds(4), BTN.Forward, YAW.posX);
      expect(sim.s.pos.x).toBeGreaterThan(10 + HW);
      expect(sim.s.crouch).toBe(0);
    }
  });

  it('a half-risen player cannot walk back under the ceiling it just left', () => {
    const world = flatWorld(solid(0, 1.4, -5, 10, 1.7, 5));
    const sim = new Sim(world, 5, 0, 0).run(seconds(0.5), BTN.Crouch, YAW.posX);
    // Leave toward +X, release crouch as soon as the hull is clear, immediately reverse.
    while (sim.s.pos.x < 10 + HW + 0.02) sim.tick(BTN.Crouch | BTN.Forward, YAW.posX);
    sim.run(3, 0, YAW.posX);
    expect(sim.s.crouch).toBeLessThan(1);
    expect(sim.s.crouch).toBeGreaterThan(0);
    sim.run(seconds(2), BTN.Forward, YAW.negX);
    // The taller hull is stopped by the edge of the ceiling.
    expect(sim.s.crouch).toBe(0);
    expect(sim.s.pos.x).toBeCloseTo(10 + HW + SKIN, 6);
    // Crouching again lets it back in.
    sim.run(seconds(2), BTN.Forward | BTN.Crouch, YAW.negX);
    expect(sim.s.pos.x).toBeLessThan(9);
  });

  it('crouching and standing up in the air never moves the feet off their parabola', () => {
    const world = flatWorld();
    const plain = new Sim(world, 0, 0, 0).run(4, 0);
    const busy = new Sim(world, 0, 0, 0).run(4, 0);
    plain.tick(BTN.Jump, 0);
    busy.tick(BTN.Jump, 0);
    for (let i = 0; i < 60; i++) {
      plain.tick(0, 0);
      // Crouch on the way up, stand on the way down, crouch again before landing.
      busy.tick(i < 15 || (i > 30 && i < 50) ? BTN.Crouch : 0, 0);
      expect(busy.s.pos.y).toBe(plain.s.pos.y);
      expect(busy.s.vel.y).toBe(plain.s.vel.y);
      expect(busy.s.onGround).toBe(plain.s.onGround);
    }
    expect(busy.landings).toEqual(plain.landings);
  });

  it('standing up in the air under a ceiling is refused, then granted once below it', () => {
    // Ceiling 2.6 m up: a crouched jump tops out with the head at 2.53 m, a standing hull
    // would need 3.03 m.
    const world = flatWorld(solid(-5, 2.6, -5, 5, 3, 5));
    const sim = new Sim(world, 0, 0, 0).run(seconds(0.5), BTN.Crouch);
    sim.tick(BTN.Crouch | BTN.Jump, 0);
    let heldAtTop = false;
    for (let i = 0; i < 60; i++) {
      sim.tick(0, 0);
      const headroom = 2.6 - (sim.s.pos.y + PLAYER_HEIGHT);
      if (headroom < 0 && sim.s.crouch > 0) heldAtTop = true;
      expect(sim.s.pos.y + hullHeight(sim.s.crouch)).toBeLessThanOrEqual(2.6 + 1e-9);
    }
    expect(heldAtTop).toBe(true);
    expect(sim.s.crouch).toBe(0);
    expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
  });
});

describe('narrow gaps', () => {
  /** Wall in the plane x = 3 (1 m thick) with an opening for z in [0, width]. */
  const gapSolids = (width: number): Solid[] => [solid(3, 0, -20, 4, 3, 0), solid(3, 0, width, 4, 3, 20)];

  it('a 0.71 m gap lets the 0.70 m hull through: centred, funnelled along a wall, or shoved', () => {
    const width = 0.71;
    const centred = new Sim(flatWorld(...gapSolids(width)), 0, 0, width / 2).run(seconds(2), BTN.Forward, YAW.posX);
    expect(centred.s.pos.x).toBeGreaterThan(6);
    expect(speedOf(centred.s)).toBeCloseTo(RUN, 6);
    // A guide wall flush with one side of the opening: pushing diagonally into the corner
    // lines the hull up and slides it in, whichever side the guide is on.
    for (const side of [-1, 1]) {
      const guide = side < 0 ? solid(-10, 0, -1, 3, 3, 0) : solid(-10, 0, width, 3, 3, width + 1);
      const world = flatWorld(...gapSolids(width), guide);
      const startZ = side < 0 ? 3 : width - 3;
      const yaw = yawToward(1, side < 0 ? -1 : 1);
      const funnelled = new Sim(world, 0, 0, startZ).run(seconds(3), BTN.Forward, yaw);
      expect(funnelled.s.pos.x).toBeGreaterThan(4 + HW);
      // Shoved in at 60 m/s.
      const shoved = new Sim(world, 0, 0, startZ);
      for (let i = 0; i < seconds(1); i++) {
        if (i % 8 === 0) {
          shoved.s.vel.x = 42;
          shoved.s.vel.z = side < 0 ? -42 : 42;
        }
        shoved.tick(BTN.Forward, yaw);
      }
      expect(shoved.s.pos.x).toBeGreaterThan(4 + HW);
    }
    // Inside the slot the player can stop, turn around and come back out.
    const inside = new Sim(flatWorld(...gapSolids(width)), 0, 0, width / 2);
    while (inside.s.pos.x < 3.4) inside.tick(BTN.Forward | BTN.Walk, YAW.posX);
    inside.run(seconds(0.5), 0, YAW.posX);
    expect(inside.s.pos.x).toBeGreaterThan(3.4);
    expect(inside.s.pos.x).toBeLessThan(4);
    expect(inside.s.vel).toEqual({ x: 0, y: 0, z: 0 });
    // Strafing against either side of the slot does nothing; backing out diagonally works.
    const before = inside.s.pos.x;
    inside.run(seconds(0.5), BTN.Left, YAW.posX);
    inside.run(seconds(0.5), BTN.Right, YAW.posX);
    expect(inside.s.pos.x).toBeCloseTo(before, 6);
    inside.run(seconds(1), BTN.Left | BTN.Back, YAW.posX);
    inside.run(seconds(1), BTN.Right | BTN.Back, YAW.posX);
    expect(inside.s.pos.x).toBeLessThan(2);
  });

  it('a 0.69 m gap never does, at any angle, offset or speed', () => {
    const width = 0.69;
    const world = flatWorld(...gapSolids(width), solid(-10, 0, -1, 3, 3, 0));
    const rng = mulberry32(31337);
    for (let attempt = 0; attempt < 300; attempt++) {
      const sim = new Sim(world, 3 - HW - rng() * 1.5, 0, rng() * 2);
      const yaw = yawToward(1, -rng() * 1.5);
      const shove = attempt % 3 === 0;
      for (let i = 0; i < seconds(2); i++) {
        if (shove && i % 6 === 0) {
          const a = rng() * 1.2 - 0.9;
          sim.s.vel.x = Math.cos(a) * 80;
          sim.s.vel.z = Math.sin(a) * 80;
        }
        sim.tick(BTN.Forward | (i % 37 === 0 ? BTN.Jump : 0) | (attempt % 2 === 0 ? BTN.Crouch : 0), yaw);
        if (sim.s.pos.x > 3 - HW) throw new Error(`attempt ${attempt}, tick ${i}: squeezed into the gap at ${JSON.stringify(sim.s.pos)}`);
      }
    }
  });

  it('crawl spaces: 1.31 m fits a crouched player, 1.29 m does not; 1.81 m fits a standing one, 1.79 m does not', () => {
    const tunnel = (height: number): CollisionWorld => flatWorld(solid(3, height, -5, 8, height + 0.5, 5));
    const through = (height: number, buttons: number): boolean => {
      const sim = new Sim(tunnel(height), 0, 0, 0).run(seconds(8), BTN.Forward | buttons, YAW.posX);
      if (sim.s.pos.x <= 8 + HW) expect(sim.s.pos.x).toBeCloseTo(3 - HW - SKIN, 6);
      return sim.s.pos.x > 8 + HW;
    };
    expect(through(1.31, BTN.Crouch)).toBe(true);
    expect(through(1.29, BTN.Crouch)).toBe(false);
    expect(through(1.81, 0)).toBe(true);
    expect(through(1.79, 0)).toBe(false);
    // The design rule of the maps: a crouched player passes under 1.4 m.
    expect(through(1.4, BTN.Crouch)).toBe(true);
    expect(through(1.4, 0)).toBe(false);
  });
});

describe('recovery from bad positions', () => {
  it('a hull overlapping a wall comes back out on the side it is on, by the shortest nudge', () => {
    for (const thickness of [0.2, 1, 3]) {
      const world = flatWorld(solid(5, 0, -50, 5 + thickness, 4, 50));
      for (const depth of [1e-9, 1e-6, 1e-4, 0.0015, 0.005, 0.02, 0.05, 0.09]) {
        const sim = new Sim(world, 5 - HW + depth, SKIN, 0);
        sim.s.vel.x = 3;
        sim.tick(0, YAW.posX);
        expect(sim.s.pos.x).toBeLessThan(5 - HW);
        // Not thrown far away: less than 4 cm beyond the overlap.
        expect(5 - HW - sim.s.pos.x).toBeLessThan(0.04);
        expect(sim.s.pos.z).toBe(0);
        // The tick that frees the player does not move it otherwise.
        expect(sim.s.vel).toEqual({ x: 0, y: 0, z: 0 });
        // And it carries on normally afterwards.
        sim.run(seconds(1), BTN.Forward, YAW.negX);
        expect(sim.s.pos.x).toBeLessThan(2);
      }
    }
  });

  it('feet sunk into the floor are lifted back onto it', () => {
    const world = flatWorld();
    for (const depth of [1e-9, 1e-6, 5e-4, 0.002, 0.02, 0.3, 0.9]) {
      const sim = new Sim(world, 1, -depth, 2);
      sim.run(seconds(1), 0);
      expect(sim.s.pos.y).toBeCloseTo(SKIN, 9);
      expect(sim.s.pos.x).toBe(1);
      expect(sim.s.pos.z).toBe(2);
      expect(sim.s.onGround).toBe(true);
    }
  });

  it('garbage in, finite out: corrupted states, commands and speeds', () => {
    const world = devWorld;
    const bad = [NaN, Infinity, -Infinity, 1e308, -1e308, 1e-320, -0];
    const rng = mulberry32(99);
    const pick = (): number => bad[Math.floor(rng() * bad.length)]!;
    for (let round = 0; round < 400; round++) {
      const sim = new Sim(world, 0, 0, 5);
      sim.run(10, BTN.Forward, 0);
      const s = sim.s;
      const field = round % 12;
      if (field === 0) s.pos.x = pick();
      else if (field === 1) s.pos.y = pick();
      else if (field === 2) s.pos.z = pick();
      else if (field === 3) s.vel.x = pick();
      else if (field === 4) s.vel.y = pick();
      else if (field === 5) s.vel.z = pick();
      else if (field === 6) s.crouch = pick();
      else if (field === 7) s.landSlow = pick();
      else if (field === 8) s.prevButtons = pick();
      const ev = makeEvents();
      for (let i = 0; i < 30; i++) {
        const cmd: UserCmd = {
          seq: i,
          buttons: field === 9 ? pick() : BTN.Forward | BTN.Jump,
          yaw: field === 10 ? pick() : 1,
          pitch: 0,
          slot: -1,
          st: 0,
        };
        stepMovement(s, cmd, world, field === 11 ? pick() : RUN, ev);
        const sum = s.pos.x + s.pos.y + s.pos.z + s.vel.x + s.vel.y + s.vel.z + s.crouch + s.landSlow + ev.landedSpeed;
        if (!Number.isFinite(sum)) throw new Error(`round ${round} (field ${field}), tick ${i}: ${JSON.stringify(s.pos)} ${JSON.stringify(s.vel)}`);
        expect(s.crouch).toBeGreaterThanOrEqual(0);
        expect(s.crouch).toBeLessThanOrEqual(1);
        expect(typeof s.onGround).toBe('boolean');
      }
    }
  });
});

// =============================================================================================
// Collision world
// =============================================================================================

describe('CollisionWorld against an independent brute-force reference', () => {
  /** Valid solids only, as plain arrays (index = position in the original list). */
  interface RefBox {
    index: number;
    lo: [number, number, number];
    hi: [number, number, number];
    noPlayers: boolean;
    noBullets: boolean;
  }
  const toRefBoxes = (solids: readonly Solid[]): RefBox[] =>
    solids.flatMap((s, index) => {
      const lo: [number, number, number] = [s.min.x, s.min.y, s.min.z];
      const hi: [number, number, number] = [s.max.x, s.max.y, s.max.z];
      const valid = [...lo, ...hi].every(Number.isFinite) && hi[0] > lo[0] && hi[1] > lo[1] && hi[2] > lo[2];
      return valid ? [{ index, lo, hi, noPlayers: !!s.noPlayers, noBullets: !!s.noBullets }] : [];
    });
  const ignored = (b: RefBox, mask: number): boolean => ((mask & MASK.Player) !== 0 && b.noPlayers) || ((mask & MASK.Bullet) !== 0 && b.noBullets);
  /** Contact axis priority on ties: Y, then X, then Z. */
  const AXIS_ORDER = [1, 0, 2] as const;

  /** Per-axis interval formulation, written independently of world.ts. */
  function refSweep(boxes: readonly RefBox[], c: Vec, h: Vec, d: Vec, mask: number): { t: number; solid: number; axis: number; start: number } {
    let bestT = Infinity;
    let bestSolid = -1;
    let bestAxis = -1;
    let start = -1;
    const C = [c.x, c.y, c.z];
    const H = [h.x, h.y, h.z];
    const D = [d.x, d.y, d.z];
    for (const b of boxes) {
      if (ignored(b, mask)) continue;
      let enter = -Infinity;
      let exit = Infinity;
      let axis = -1;
      let miss = false;
      for (const a of AXIS_ORDER) {
        const e0 = b.lo[a] - H[a]!;
        const e1 = b.hi[a] + H[a]!;
        if (D[a] === 0) {
          if (!(C[a]! > e0 && C[a]! < e1)) miss = true;
        } else {
          const ta = (e0 - C[a]!) / D[a]!;
          const tb = (e1 - C[a]!) / D[a]!;
          if (Math.min(ta, tb) > enter) {
            enter = Math.min(ta, tb);
            axis = a;
          }
          exit = Math.min(exit, Math.max(ta, tb));
        }
      }
      if (miss || !(enter < exit) || exit <= 0) continue;
      if (enter < 0) {
        if (start < 0) start = b.index;
        continue;
      }
      if (enter <= 1 && enter < bestT) {
        bestT = enter;
        bestSolid = b.index;
        bestAxis = axis;
      }
    }
    return { t: bestT, solid: bestSolid, axis: bestAxis, start };
  }

  /**
   * Reference ray cast. Solids are open boxes; solid space is the interior of their union.
   * A ray exactly parallel to an axis is replaced by copies shifted 0.1 µm to either side along
   * each such axis (so that no copy lies in a face plane), and is blocked from the first
   * point where all copies are inside solids at once. Returns that distance and the solids
   * entered there.
   */
  function refRay(boxes: readonly RefBox[], o: Vec, d: Vec, maxDist: number, mask: number): { t: number; entered: number[] } | null {
    const O = [o.x, o.y, o.z];
    const D = [d.x, d.y, d.z];
    const parallel = [0, 1, 2].filter((a) => D[a] === 0);
    const copies = 1 << parallel.length;
    const all = (1 << copies) - 1;
    // Time spans spent inside a solid, with the set of copies (bit mask) that are inside it.
    const spans: { t0: number; t1: number; solid: number; copies: number }[] = [];
    for (const b of boxes) {
      if (ignored(b, mask)) continue;
      let within = all;
      for (let k = 0; k < parallel.length; k++) {
        const a = parallel[k]!;
        for (let copy = 0; copy < copies; copy++) {
          const p = O[a]! + (((copy >> k) & 1) === 1 ? 1e-7 : -1e-7);
          if (!(p > b.lo[a]! && p < b.hi[a]!)) within &= ~(1 << copy);
        }
      }
      if (within === 0) continue;
      let enter = -Infinity;
      let exit = Infinity;
      for (let a = 0; a < 3; a++) {
        if (D[a] === 0) continue;
        const ta = (b.lo[a]! - O[a]!) / D[a]!;
        const tb = (b.hi[a]! - O[a]!) / D[a]!;
        enter = Math.max(enter, Math.min(ta, tb));
        exit = Math.min(exit, Math.max(ta, tb));
      }
      if (!(enter < exit) || exit <= 0) continue;
      spans.push({ t0: Math.max(enter, 0), t1: exit, solid: b.index, copies: within });
    }
    spans.sort((p, q) => p.t0 - q.t0);
    for (const candidate of spans) {
      const t = candidate.t0;
      if (t > maxDist) break;
      let covered = 0;
      for (const sp of spans) {
        if (sp.t0 > t) break;
        if (t < sp.t1) covered |= sp.copies;
      }
      if (covered !== all) continue;
      const tolerance = 1e-9 * Math.max(1, t);
      return { t, entered: spans.filter((sp) => Math.abs(sp.t0 - t) <= tolerance).map((sp) => sp.solid) };
    }
    return null;
  }

  /** Boxes of all sizes (some far larger than a grid cell), flags, degenerate entries, far outliers. */
  function messyWorld(seed: number, count: number, span: number, lattice: boolean, outliers: boolean): Solid[] {
    const rng = mulberry32(seed);
    const solids: Solid[] = [];
    const q = (v: number): number => (lattice ? Math.round(v * 2) / 2 : v);
    for (let i = 0; i < count; i++) {
      const x = q((rng() * 2 - 1) * span);
      const y = q((rng() * 2 - 1) * span * 0.3);
      const z = q((rng() * 2 - 1) * span);
      const size = (): number => Math.max(lattice ? 0.5 : 0.05, q(0.1 + rng() * (rng() < 0.1 ? 30 : 4)));
      const s: Solid = { min: { x, y, z }, max: { x: x + size(), y: y + size(), z: z + size() }, surf: 'concrete' };
      const r = rng();
      if (r < 0.1) s.noBullets = true;
      else if (r < 0.2) s.noPlayers = true;
      else if (r < 0.23) s.max.x = s.min.x;
      else if (r < 0.25) s.max.y = NaN;
      else if (r < 0.27) s.min.z = s.max.z + 1;
      solids.push(s);
    }
    if (outliers) {
      solids.push(solid(4000, 0, 4000, 4010, 10, 4010), solid(-6000, -300, -100, -5990, 900, 100));
      solids.push(solid(-7000, -1, -7000, 7000, 0, 7000)); // one floor far bigger than everything else
    }
    return solids;
  }

  const VARIANTS = [
    { name: 'dense random boxes', count: 500, span: 8, lattice: false, outliers: false },
    { name: 'lattice-aligned boxes (ties everywhere)', count: 500, span: 20, lattice: true, outliers: false },
    { name: 'sparse world with far outliers and a huge floor (coarse cells)', count: 300, span: 40, lattice: true, outliers: true },
    { name: 'a single solid', count: 1, span: 5, lattice: false, outliers: false },
    { name: 'no solid at all', count: 0, span: 5, lattice: false, outliers: false },
  ];

  for (const [index, v] of VARIANTS.entries()) {
    it(`sweepBox, boxOverlaps, raycast and lineOfSight agree with it (${v.name})`, () => {
      const solids = messyWorld(100 + index, v.count, v.span, v.lattice, v.outliers);
      const boxes = toRefBoxes(solids);
      const world = new CollisionWorld(solids);
      const rng = mulberry32(999 + index);
      const q = (x: number): number => (v.lattice && rng() < 0.5 ? Math.round(x * 2) / 2 : x);
      const pickMask = (): number => (rng() < 0.6 ? MASK.Player : rng() < 0.5 ? MASK.Bullet : rng() < 0.5 ? 0 : MASK.Player | MASK.Bullet);
      for (let k = 0; k < 12000; k++) {
        // --- Sweep: from a few centimetres to 20 km, any axis may be exactly zero.
        const c = { x: q((rng() * 2 - 1) * v.span * 1.3), y: q((rng() * 2 - 1) * v.span * 0.4), z: q((rng() * 2 - 1) * v.span * 1.3) };
        const h = rng() < 0.5 ? { x: HW, y: 0.9, z: HW } : { x: 0.05 + rng() * 2, y: 0.05 + rng() * 2, z: 0.05 + rng() * 2 };
        if (rng() < 0.05) h.x = 0;
        const len = rng() < 0.3 ? rng() * 0.2 : rng() < 0.6 ? rng() * 5 : rng() < 0.9 ? rng() * 200 : rng() * 20000;
        const dir = { x: rng() * 2 - 1, y: (rng() * 2 - 1) * 0.5, z: rng() * 2 - 1 };
        const zero = rng();
        if (zero < 0.15) dir.x = 0;
        else if (zero < 0.3) dir.y = 0;
        else if (zero < 0.45) dir.z = 0;
        else if (zero < 0.55) dir.x = dir.z = 0;
        else if (zero < 0.6) dir.x = dir.y = 0;
        else if (zero < 0.62) dir.x = dir.y = dir.z = 0;
        const d = { x: q(dir.x * len), y: q(dir.y * len), z: q(dir.z * len) };
        const mask = pickMask();
        const tr = world.sweepBox(c, h, d, mask);
        const ref = refSweep(boxes, c, h, d, mask);
        const context = (): string => JSON.stringify({ c, h, d, mask, tr, ref });
        expect(world.boxOverlaps(c, h, mask)).toBe(ref.start >= 0);
        if (ref.start >= 0) {
          if (!tr.startSolid || !tr.hit || tr.fraction !== 0 || tr.solid !== ref.start) throw new Error(`startSolid mismatch ${context()}`);
        } else if (ref.solid < 0) {
          if (tr.hit || tr.startSolid || tr.fraction !== 1 || tr.solid !== -1) throw new Error(`phantom hit ${context()}`);
        } else {
          const D = [d.x, d.y, d.z];
          const expected = Math.max(0, ref.t - 1e-3 / Math.abs(D[ref.axis]!));
          const n = [tr.normal.x, tr.normal.y, tr.normal.z];
          if (!tr.hit || tr.startSolid || tr.solid !== ref.solid) throw new Error(`wrong solid ${context()}`);
          if (Math.abs(tr.fraction - expected) > 1e-12) throw new Error(`wrong fraction ${context()}`);
          if (n[ref.axis] !== (D[ref.axis]! > 0 ? -1 : 1) || Math.abs(n[0]!) + Math.abs(n[1]!) + Math.abs(n[2]!) !== 1) {
            throw new Error(`wrong normal ${context()}`);
          }
          // The end position never overlaps anything.
          const end = { x: c.x + d.x * tr.fraction, y: c.y + d.y * tr.fraction, z: c.z + d.z * tr.fraction };
          if (world.boxOverlaps(end, h, mask)) throw new Error(`sweep ends inside a solid ${context()}`);
        }

        // --- Ray: any length including Infinity, origins inside solids and outside the grid.
        const o = { x: q((rng() * 2 - 1) * v.span * 1.5), y: q((rng() * 2 - 1) * v.span * 0.5), z: q((rng() * 2 - 1) * v.span * 1.5) };
        let rd = { x: rng() * 2 - 1, y: rng() * 2 - 1, z: rng() * 2 - 1 };
        const special = rng();
        if (special < 0.1) rd = { x: 1, y: 0, z: 0 };
        else if (special < 0.2) rd = { x: 0, y: -1, z: 0 };
        else if (special < 0.3) rd = { x: 0, y: 0, z: -1 };
        else if (special < 0.4) rd.y = 0;
        const norm = Math.hypot(rd.x, rd.y, rd.z);
        rd = { x: rd.x / norm, y: rd.y / norm, z: rd.z / norm };
        const maxDist = rng() < 0.2 ? Infinity : rng() < 0.5 ? rng() * 10 : rng() * 20000;
        const rayMask = pickMask();
        const hit = world.raycast(o, rd, maxDist, rayMask);
        const rayRef = refRay(boxes, o, rd, maxDist, rayMask);
        const rayContext = (): string => JSON.stringify({ o, rd, maxDist, rayMask, hit, rayRef });
        if (!rayRef) {
          if (hit) throw new Error(`phantom ray hit ${rayContext()}`);
        } else {
          if (!hit) throw new Error(`missed ray hit ${rayContext()}`);
          if (Math.abs(hit.dist - rayRef.t) > 1e-9 * Math.max(1, rayRef.t)) throw new Error(`wrong ray distance ${rayContext()}`);
          // One of the solids entered at that distance (several when faces coincide).
          if (!rayRef.entered.includes(hit.solid)) throw new Error(`wrong ray solid ${rayContext()}`);
          expect(hit.surf).toBe(solids[hit.solid]!.surf);
          const n = hit.normal;
          expect(Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z)).toBe(1);
          // The normal faces the ray.
          expect(n.x * rd.x + n.y * rd.y + n.z * rd.z).toBeLessThanOrEqual(0);
          if (rayRef.t === 0) {
            // Origin inside (or entering exactly on a face): the hit point is the origin.
            expect(Math.abs(hit.point.x - o.x) + Math.abs(hit.point.y - o.y) + Math.abs(hit.point.z - o.z)).toBe(0);
          }
        }

        // --- Line of sight between two points that often share exact coordinates.
        const b = { x: q(o.x + (rng() - 0.5) * 30), y: rng() < 0.5 ? o.y : q(o.y + (rng() - 0.5) * 6), z: rng() < 0.3 ? o.z : q(o.z + (rng() - 0.5) * 30) };
        const span = Math.hypot(b.x - o.x, b.y - o.y, b.z - o.z);
        if (span > 0.01) {
          const dir = { x: (b.x - o.x) / span, y: (b.y - o.y) / span, z: (b.z - o.z) / span };
          const sees = world.lineOfSight(o, b, rayMask);
          // The end point is given 0.1 mm of slack; skip the rare obstacle within 1 nm of that limit.
          const blockedAt = refRay(boxes, o, dir, Infinity, rayMask)?.t ?? Infinity;
          const reach = span - 1e-4;
          if (Math.abs(blockedAt - reach) > 1e-9 && sees !== blockedAt > reach) {
            throw new Error(`wrong line of sight ${JSON.stringify({ o, b, rayMask, sees, blockedAt })}`);
          }
        }
      }
    });
  }

  it('a ray lying exactly in a seam does not slip through the wall or the floor', () => {
    const world = new CollisionWorld([
      // Floor of four tiles meeting at (4, 8).
      solid(0, -1, 0, 4, 0, 8),
      solid(4, -1, 0, 8, 0, 8),
      solid(0, -1, 8, 4, 0, 16),
      solid(4, -1, 8, 8, 0, 16),
      // Wall in the plane z = 5 made of two boxes meeting at x = 2, with a lintel over a doorway
      // for x in [6, 7] (boxes meeting at x = 6, x = 7 and y = 2.1).
      solid(0, 0, 5, 2, 3, 5.2),
      solid(2, 0, 5, 6, 3, 5.2),
      solid(6, 2.1, 5, 7, 3, 5.2),
      solid(7, 0, 5, 8, 3, 5.2),
    ]);
    const down = { x: 0, y: -1, z: 0 };
    // Straight down onto a tile seam, and onto the corner shared by the four tiles.
    for (const [x, z] of [[4, 3], [2, 8], [4, 8], [4, 12]] as const) {
      const hit = world.raycast({ x, y: 2, z }, down, 100);
      expect(hit?.dist).toBe(2);
      expect(hit?.normal).toEqual({ x: 0, y: 1, z: 0 });
      expect(hit?.point).toEqual({ x, y: 0, z });
    }
    // Along the seam plane x = 2 of the wall, at eye height: blocked at the wall face, both ways.
    const through = world.raycast({ x: 2, y: 1.6, z: 1 }, { x: 0, y: 0, z: 1 }, 100);
    expect(through?.dist).toBe(4);
    expect(through?.normal).toEqual({ x: 0, y: 0, z: -1 });
    expect([4, 5]).toContain(through?.solid);
    expect(world.raycast({ x: 2, y: 1.6, z: 9 }, { x: 0, y: 0, z: -1 }, 100)?.dist).toBeCloseTo(3.8, 12);
    expect(world.lineOfSight({ x: 2, y: 1.6, z: 1 }, { x: 2, y: 1.6, z: 9 })).toBe(false);
    // The seams around the lintel (x = 6, x = 7, y = 2.1) are just as tight...
    expect(world.lineOfSight({ x: 6, y: 2.5, z: 1 }, { x: 6, y: 2.5, z: 9 })).toBe(false);
    expect(world.lineOfSight({ x: 7, y: 2.5, z: 1 }, { x: 7, y: 2.5, z: 9 })).toBe(false);
    // ...while the doorway below stays open, even along its jambs and under the lintel face.
    expect(world.lineOfSight({ x: 6.5, y: 1.6, z: 1 }, { x: 6.5, y: 1.6, z: 9 })).toBe(true);
    expect(world.lineOfSight({ x: 6, y: 1.6, z: 1 }, { x: 6, y: 1.6, z: 9 })).toBe(true);
    expect(world.lineOfSight({ x: 7, y: 2, z: 1 }, { x: 7, y: 2, z: 9 })).toBe(true);
    expect(world.lineOfSight({ x: 6.5, y: 2.1, z: 1 }, { x: 6.5, y: 2.1, z: 9 })).toBe(true);
    // A ray starting inside the seam, in the thickness of the wall, is "inside a solid".
    expect(world.raycast({ x: 2, y: 1, z: 5.1 }, { x: 0, y: 0, z: 1 }, 100)?.dist).toBe(0);
    expect(world.raycast({ x: 2, y: 1, z: 5.1 }, { x: 1, y: 0, z: 0 }, 100)?.dist).toBe(0);
  });

  it('a seam whose two sides disagree in the last bit is just as tight', () => {
    // The "same" coordinate reached along two paths, as nested map frames do.
    const a = 0.1 + 0.2;
    const b = 0.3;
    expect(a).not.toBe(b);
    // [a, b]: the two boxes overlap by one unit in the last place; [b, a]: they leave a crack that wide.
    for (const [left, right] of [[a, b], [b, a]] as const) {
      const world = new CollisionWorld([
        solid(-2, 0, 5, left, 3, 5.2),
        solid(right, 0, 5, 4, 3, 5.2),
        solid(-2, -1, 0, left, 0, 9),
        solid(right, -1, 0, 4, 0, 9),
      ]);
      for (const x of [a, b]) {
        expect(world.lineOfSight({ x, y: 1.6, z: 1 }, { x, y: 1.6, z: 8 })).toBe(false);
        expect(world.raycast({ x, y: 1.6, z: 1 }, { x: 0, y: 0, z: 1 }, 50)?.dist).toBe(4);
        expect(world.raycast({ x, y: 2, z: 2 }, { x: 0, y: -1, z: 0 }, 50)?.dist).toBe(2);
        expect(world.groundBelow({ x, y: 2, z: 2 }, 50)).toBe(0);
      }
    }
  });

  it('points lying on a floor see each other along it, but not through a wall standing on it', () => {
    const world = new CollisionWorld([
      solid(0, -1, 0, 4, 0, 8),
      solid(4, -1, 0, 8, 0, 8),
      // Wall across the floor seam, standing on both tiles, with a gap for x in [6, 7].
      solid(0, 0, 5, 6, 3, 5.2),
      solid(7, 0, 5, 8, 3, 5.2),
    ]);
    // Feet-level points (y = 0 exactly, like spawn points and nav nodes).
    expect(world.lineOfSight({ x: 1, y: 0, z: 1 }, { x: 7.5, y: 0, z: 4 })).toBe(true);
    expect(world.lineOfSight({ x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 7 })).toBe(false);
    expect(world.lineOfSight({ x: 1, y: 0, z: 1 }, { x: 5, y: 0, z: 7 })).toBe(false);
    expect(world.lineOfSight({ x: 6.5, y: 0, z: 1 }, { x: 6.5, y: 0, z: 7 })).toBe(true);
    expect(world.lineOfSight({ x: 4, y: 0, z: 1 }, { x: 4, y: 0, z: 7 })).toBe(false);
    const hit = world.raycast({ x: 1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, 100);
    expect(hit?.dist).toBe(4);
    expect(hit?.normal).toEqual({ x: 0, y: 0, z: -1 });
    // Along the foot of the wall, in the corner between wall and floor: touching both, inside neither.
    expect(world.lineOfSight({ x: 0.5, y: 0, z: 5 }, { x: 5.5, y: 0, z: 5 })).toBe(true);
    // Along the top of the wall and along its faces.
    expect(world.lineOfSight({ x: 0.5, y: 3, z: 5.1 }, { x: 5.5, y: 3, z: 5.1 })).toBe(true);
    expect(world.lineOfSight({ x: 0.5, y: 1, z: 5 }, { x: 5.5, y: 1, z: 5 })).toBe(true);
    expect(world.lineOfSight({ x: 0.5, y: 1, z: 5.2 }, { x: 5.5, y: 1, z: 5.2 })).toBe(true);
  });

  it('grazing the outside of the geometry is still a miss: faces, edges, corner-to-corner pinholes', () => {
    // Two boxes touching only along the vertical edge x = 2, z = 2 (diagonal neighbours), a
    // third one sharing a face with the first.
    const world = new CollisionWorld([solid(0, 0, 0, 2, 2, 2), solid(2, 0, 2, 4, 2, 4), solid(0, 0, 2, 2, 1, 4)]);
    const up = { x: 0, y: 1, z: 0 };
    // Along the shared vertical edge: boxes 0 and 1 (diagonal) and box 2 fill three quadrants
    // out of four up to y = 1, two above.
    expect(world.raycast({ x: 2, y: -1, z: 2 }, up, 100)).toBeNull();
    // Through the pinhole between the diagonal boxes, in their common face planes.
    expect(world.raycast({ x: 2, y: 1.5, z: -3 }, { x: 0, y: 0, z: 1 }, 100)).toBeNull();
    expect(world.raycast({ x: -3, y: 1.5, z: 2 }, { x: 1, y: 0, z: 0 }, 100)).toBeNull();
    // Lower down, box 2 closes the plane z = 2 on the x < 2 side: boxes 0 and 2 form a wall there.
    const blocked = world.raycast({ x: -3, y: 0.5, z: 2 }, { x: 1, y: 0, z: 0 }, 100);
    expect(blocked?.dist).toBe(3);
    expect(blocked?.solid).toBe(0);
    expect(blocked?.normal).toEqual({ x: -1, y: 0, z: 0 });
    // The same ray from the other end runs along the free face of box 1 first (not a hit), then
    // meets the seam between boxes 0 and 2 at x = 2.
    const reverse = world.raycast({ x: 7, y: 0.5, z: 2 }, { x: -1, y: 0, z: 0 }, 100);
    expect(reverse?.dist).toBe(5);
    expect(reverse?.normal).toEqual({ x: 1, y: 0, z: 0 });
    // A fourth box completes the ring around the vertical edge: now it is inside solid matter.
    const ring = new CollisionWorld([solid(0, 0, 0, 2, 2, 2), solid(2, 0, 2, 4, 2, 4), solid(0, 0, 2, 2, 1, 4), solid(2, 0.5, 0, 4, 2, 2)]);
    const edge = ring.raycast({ x: 2, y: -1, z: 2 }, up, 100);
    expect(edge?.dist).toBe(1.5);
    expect(edge?.normal).toEqual({ x: 0, y: -1, z: 0 });
    expect(edge?.solid).toBe(3);
    // From above: three boxes down to y = 1 (still a concave edge), the fourth from there on.
    const fromAbove = ring.raycast({ x: 2, y: 5, z: 2 }, { x: 0, y: -1, z: 0 }, 100);
    expect(fromAbove?.dist).toBe(4);
    expect(fromAbove?.solid).toBe(2);
    expect(fromAbove?.normal).toEqual({ x: 0, y: 1, z: 0 });
    expect(ring.lineOfSight({ x: 2, y: -1, z: 2 }, { x: 2, y: 0.4, z: 2 })).toBe(true);
    expect(ring.lineOfSight({ x: 2, y: -1, z: 2 }, { x: 2, y: 0.6, z: 2 })).toBe(false);
  });

  it('seam rule and masks: a solid the query ignores does not close a seam', () => {
    const glass: Solid = { ...solid(2, 0, 5, 6, 3, 5.2), noBullets: true };
    const world = new CollisionWorld([solid(0, 0, 5, 2, 3, 5.2), glass]);
    const from = { x: 2, y: 1.6, z: 1 };
    const to = { x: 2, y: 1.6, z: 9 };
    // Bullets ignore the second box: the ray merely runs along the face of the first one.
    expect(world.lineOfSight(from, to, MASK.Bullet)).toBe(true);
    // Players (and mask 0) collide with both.
    expect(world.lineOfSight(from, to, MASK.Player)).toBe(false);
    expect(world.lineOfSight(from, to, 0)).toBe(false);
  });

  it('a stamp counter about to wrap around does not make solids invisible', () => {
    const world = new CollisionWorld(devMap.solids);
    const probe = (): string =>
      JSON.stringify([
        world.sweepBox({ x: 0, y: 3, z: 8 }, { x: HW, y: 0.9, z: HW }, { x: 0, y: -10, z: 0 }),
        world.raycast({ x: 0, y: 1, z: 10 }, { x: 0, y: 0, z: -1 }, 100),
        world.sweepBox({ x: 0, y: 1, z: 8 }, { x: HW, y: 0.9, z: HW }, { x: 300, y: 0, z: 0 }),
      ]);
    const before = probe();
    // Private field: force the per-query stamp to the end of its 32-bit range.
    (world as unknown as { stamp: number }).stamp = 0xffffffff - 3;
    for (let i = 0; i < 12; i++) expect(probe()).toBe(before);
  });

  it('queries far outside the world, or absurdly long, stay exact and cheap', () => {
    const world = new CollisionWorld(devMap.solids);
    const hull = { x: HW, y: 0.9, z: HW };
    // From 5 km away straight at the arena: stops at the outer face of the perimeter wall (x = -16.5).
    const far = world.sweepBox({ x: -5000, y: 1, z: 0 }, hull, { x: 10000, y: 0, z: 0 });
    expect(far.hit).toBe(true);
    expect(-5000 + 10000 * far.fraction).toBeCloseTo(-16.5 - HW - SKIN, 6);
    expect(far.normal).toEqual({ x: -1, y: 0, z: 0 });
    // Entirely outside: nothing.
    expect(world.sweepBox({ x: 500, y: 1, z: 500 }, hull, { x: 1e6, y: 0, z: 1e6 }).hit).toBe(false);
    expect(world.raycast({ x: 500, y: 1, z: 500 }, { x: 0, y: 0, z: 1 }, Infinity)).toBeNull();
    // A ray entering the grid from far away finds the wall; one leaving it finds nothing.
    const ray = world.raycast({ x: 0, y: 1, z: 9000 }, { x: 0, y: 0, z: -1 }, Infinity);
    expect(ray?.dist).toBeCloseTo(9000 - 16.5, 6);
    expect(world.raycast({ x: 0, y: 6, z: 0 }, { x: 0, y: 1, z: 0 }, Infinity)).toBeNull();
    // Cost: 2000 sweeps of 1000 km and 2000 unbounded rays in well under a second.
    const rng = mulberry32(5);
    const t0 = performance.now();
    let hits = 0;
    for (let i = 0; i < 2000; i++) {
      const a = rng() * Math.PI * 2;
      const delta = { x: Math.cos(a) * 1e6, y: (rng() - 0.5) * 1e5, z: Math.sin(a) * 1e6 };
      if (world.sweepBox({ x: rng() * 10 - 5, y: 1.5, z: rng() * 6 + 8 }, hull, delta).hit) hits++;
      if (world.raycast({ x: rng() * 10 - 5, y: 1.5, z: rng() * 6 + 8 }, { x: Math.cos(a), y: 0, z: Math.sin(a) }, Infinity)) hits++;
    }
    const ms = performance.now() - t0;
    expect(hits).toBe(4000);
    expect(ms).toBeLessThan(1000);
  });
});

// =============================================================================================
// Fuzz, differential and determinism
// =============================================================================================

describe('fuzz: random input for minutes on hostile geometry', () => {
  it('dev_test: 12 players, 3 minutes each, with shoves', () => {
    const tw: TestWorld = { solids: devMap.solids, world: devWorld, bounds: { min: { ...devMap.bounds.min, y: 0 }, max: devMap.bounds.max } };
    let total: FuzzStats = { ticks: 0, longestStall: 0, jumps: 0, travelled: 0 };
    for (const seed of [11, 12, 13]) {
      const starts = devMap.spawns.slice(0, 4).map((sp) => [sp.pos.x, sp.pos.y, sp.pos.z] as const);
      const stats = fuzzPlayers(tw, starts, seed, seconds(180), { shoves: true });
      total = {
        ticks: total.ticks + stats.ticks,
        longestStall: Math.max(total.longestStall, stats.longestStall),
        jumps: total.jumps + stats.jumps,
        travelled: total.travelled + stats.travelled,
      };
    }
    console.log(
      `[fuzz] dev_test: ${total.ticks} player-ticks, ${total.travelled.toFixed(0)} m, ${total.jumps} jumps, ` +
        `longest stall in open space ${total.longestStall} tick(s)`,
    );
    expect(total.travelled).toBeGreaterThan(3000);
    expect(total.longestStall).toBeLessThanOrEqual(3);
  });

  it('30 random box worlds: 6 players, 1 minute each, with shoves in every direction', () => {
    let ticks = 0;
    let longestStall = 0;
    let travelled = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const tw = randomBoxWorld(seed);
      const stats = fuzzPlayers(tw, freeSpots(tw, seed + 12345, 6), seed, seconds(60), { shoves: true, shoveUp: true });
      ticks += stats.ticks;
      travelled += stats.travelled;
      longestStall = Math.max(longestStall, stats.longestStall);
    }
    console.log(`[fuzz] random box worlds: ${ticks} player-ticks, ${travelled.toFixed(0)} m, longest stall in open space ${longestStall} tick(s)`);
    expect(travelled).toBeGreaterThan(20000);
    expect(longestStall).toBeLessThanOrEqual(3);
  });

  it('20 hull-lattice worlds (exact-fit slots, terraces, ceilings at hull height)', () => {
    let ticks = 0;
    let longestStall = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const tw = latticeWorld(seed);
      const stats = fuzzPlayers(tw, freeSpots(tw, seed + 4242, 6, 0.35), seed, seconds(60), { shoves: true, shoveUp: true });
      ticks += stats.ticks;
      longestStall = Math.max(longestStall, stats.longestStall);
    }
    console.log(`[fuzz] hull-lattice worlds: ${ticks} player-ticks, longest stall in open space ${longestStall} tick(s)`);
    expect(longestStall).toBeLessThanOrEqual(3);
  });

  it('cutting every solid into random pieces changes nothing, to the last bit', () => {
    const worlds: { name: string; solids: readonly Solid[]; starts: readonly (readonly [number, number, number])[] }[] = [
      { name: 'dev_test', solids: devMap.solids, starts: devMap.spawns.slice(0, 6).map((sp) => [sp.pos.x, sp.pos.y, sp.pos.z] as const) },
    ];
    for (let seed = 40; seed < 48; seed++) {
      const tw = randomBoxWorld(seed);
      worlds.push({ name: `random world ${seed}`, solids: tw.solids, starts: freeSpots(tw, seed, 4) });
    }
    let ticks = 0;
    for (const [w, { name, solids, starts }] of worlds.entries()) {
      const whole = new CollisionWorld(solids);
      const pieces = subdivide(solids, 500 + w);
      expect(pieces.length).toBeGreaterThan(solids.length * 2);
      const cut = new CollisionWorld(pieces);
      for (const [p, start] of starts.entries()) {
        const a = new Sim(whole, start[0], start[1], start[2]);
        const b = new Sim(cut, start[0], start[1], start[2]);
        const input = makeInput(7000 + w * 100 + p);
        for (let i = 0; i < seconds(45); i++) {
          const { buttons, yaw } = input();
          a.tick(buttons, yaw);
          b.tick(buttons, yaw);
          ticks++;
          if (stateBits(a.s, a.ev) !== stateBits(b.s, b.ev)) {
            throw new Error(
              `${name}, player ${p}, tick ${i}: a seam is visible\n whole: ${JSON.stringify([a.s.pos, a.s.vel])}\n cut:   ${JSON.stringify([b.s.pos, b.s.vel])}`,
            );
          }
        }
      }
    }
    expect(ticks).toBeGreaterThan(100000);
  });
});

describe('determinism', () => {
  it('replays are bit-identical, whatever else the world was asked in between', () => {
    for (const seed of [3, 17]) {
      const tw = seed === 3 ? randomBoxWorld(seed) : latticeWorld(seed);
      const starts = freeSpots(tw, seed + 1, 3);
      const record = (noise: boolean): string[] => {
        // A fresh world for the noisy run: the broadphase must not carry state between queries.
        const world = noise ? new CollisionWorld(tw.solids) : tw.world;
        const rng = mulberry32(seed * 3 + 1);
        const out: string[] = [];
        const sims = starts.map((st) => new Sim(world, st[0], st[1], st[2]));
        const inputs = starts.map((_, p) => makeInput(seed * 50 + p));
        for (let i = 0; i < seconds(40); i++) {
          for (let p = 0; p < sims.length; p++) {
            const { buttons, yaw } = inputs[p]!();
            sims[p]!.tick(buttons, yaw);
            out.push(stateBits(sims[p]!.s, sims[p]!.ev));
            if (noise) {
              // Bullets, line-of-sight checks, bot probes and another player in between.
              const o = { x: rng() * 20 - 10, y: rng() * 3, z: rng() * 20 - 10 };
              world.raycast(o, { x: 0.6, y: 0, z: 0.8 }, 50);
              world.lineOfSight(o, { x: -o.x, y: 1, z: -o.z });
              world.sweepBox(o, { x: 0.3, y: 0.3, z: 0.3 }, { x: rng() * 30, y: -1, z: rng() * 30 });
              world.groundBelow(o, 5);
            }
          }
        }
        return out;
      };
      const first = record(false);
      const second = record(true);
      expect(second.length).toBe(first.length);
      for (let i = 0; i < first.length; i++) {
        if (first[i] !== second[i]) throw new Error(`seed ${seed}: replay diverges at step ${i}\n${first[i]}\n${second[i]}`);
      }
    }
  });

  it('resuming from a JSON snapshot at any tick reproduces the rest of the run exactly (reconciliation)', () => {
    const tw = randomBoxWorld(21);
    const [start] = freeSpots(tw, 5, 1);
    const sim = new Sim(tw.world, start![0], start![1], start![2]);
    const input = makeInput(2024);
    const cmds: { buttons: number; yaw: number }[] = [];
    for (let i = 0; i < seconds(30); i++) cmds.push(input());
    const snapshots: string[] = [];
    const trace: string[] = [];
    for (const c of cmds) {
      snapshots.push(JSON.stringify(sim.s));
      sim.tick(c.buttons, c.yaw);
      trace.push(stateBits(sim.s, sim.ev));
    }
    const rng = mulberry32(8);
    for (let k = 0; k < 40; k++) {
      const from = Math.floor(rng() * cmds.length);
      const replay = new Sim(tw.world, 0, 50, 0);
      Object.assign(replay.s, JSON.parse(snapshots[from]!) as PlayerState);
      for (let i = from; i < Math.min(cmds.length, from + 200); i++) {
        replay.tick(cmds[i]!.buttons, cmds[i]!.yaw);
        if (stateBits(replay.s, replay.ev) !== trace[i]) throw new Error(`replay from tick ${from} diverges at tick ${i}`);
      }
    }
  });
});

// =============================================================================================
// Feel
// =============================================================================================

describe('movement feel (Counter-Strike: Source reference)', () => {
  it('acceleration: 90 % of run speed in about a third of a second', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0);
    let t90 = 0;
    let tFull = 0;
    for (let i = 1; i <= seconds(1); i++) {
      sim.tick(BTN.Forward, 0);
      if (t90 === 0 && speedOf(sim.s) >= 0.9 * RUN) t90 = i * TICK_DT;
      if (tFull === 0 && speedOf(sim.s) >= RUN - 1e-9) tFull = i * TICK_DT;
    }
    console.log(`[feel] 0 -> 90 % of run speed: ${t90.toFixed(3)} s; 0 -> 100 %: ${tFull.toFixed(3)} s (CS:S: about 0.33 s / 0.41 s)`);
    expect(t90).toBeGreaterThanOrEqual(0.25);
    expect(t90).toBeLessThanOrEqual(0.4);
    expect(tFull).toBeLessThanOrEqual(0.5);
    expect(speedOf(sim.s)).toBeCloseTo(RUN, 9);
  });

  it('stopping: under half a second and about one metre from full speed', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0).run(seconds(1.5), BTN.Forward, 0);
    const z0 = sim.s.pos.z;
    let stop = 0;
    let accurate = 0;
    for (let i = 1; i <= seconds(1); i++) {
      sim.tick(0, 0);
      // 34 % of the run speed is where weapons become accurate again.
      if (accurate === 0 && speedOf(sim.s) <= 0.34 * RUN) accurate = i * TICK_DT;
      if (stop === 0 && speedOf(sim.s) === 0) stop = i * TICK_DT;
    }
    const distance = z0 - sim.s.pos.z;
    const counter = new Sim(flatWorld(), 0, 0, 0).run(seconds(1.5), BTN.Forward, 0);
    let counterTicks = 0;
    while (counter.s.vel.z < 0 && counterTicks < 64) {
      counter.tick(BTN.Back, 0);
      counterTicks++;
    }
    console.log(
      `[feel] stop from run speed: ${stop.toFixed(3)} s over ${distance.toFixed(3)} m, accurate again after ${accurate.toFixed(3)} s; ` +
        `counter-strafe: ${(counterTicks * TICK_DT).toFixed(3)} s (CS:S: about 0.55 s over 1.35 m)`,
    );
    expect(stop).toBeGreaterThanOrEqual(0.3);
    expect(stop).toBeLessThanOrEqual(0.55);
    expect(distance).toBeGreaterThan(0.7);
    expect(distance).toBeLessThan(1.2);
    expect(accurate).toBeLessThanOrEqual(0.25);
    expect(counterTicks * TICK_DT).toBeLessThanOrEqual(0.15);
  });

  it('jump: 1.22 m apex, 0.70 s in the air, 4.2 m long at run speed', () => {
    const sim = new Sim(flatWorld(), 0, 0, 0).run(seconds(1.5), BTN.Forward, 0);
    const y0 = sim.s.pos.y;
    const z0 = sim.s.pos.z;
    sim.tick(BTN.Forward | BTN.Jump, 0);
    let apex = 0;
    let air = 1;
    while (!sim.s.onGround && air < 200) {
      apex = Math.max(apex, sim.s.pos.y - y0);
      sim.tick(BTN.Forward, 0);
      air++;
    }
    const length = z0 - sim.s.pos.z;
    console.log(
      `[feel] jump: apex ${apex.toFixed(4)} m, air time ${(air * TICK_DT).toFixed(3)} s, length ${length.toFixed(2)} m, ` +
        `landing at ${sim.landings[0]!.toFixed(2)} m/s (CS:S: 1.14 m, 0.67 s)`,
    );
    expect(apex).toBeGreaterThan(1.2);
    expect(apex).toBeLessThanOrEqual((MOVE.jumpSpeed * MOVE.jumpSpeed) / (2 * MOVE.gravity) + 1e-9);
    expect(air * TICK_DT).toBeGreaterThan(0.67);
    expect(air * TICK_DT).toBeLessThan(0.73);
    expect(length).toBeGreaterThan(4);
    expect(length).toBeLessThan(4.4);
    // Forward speed is untouched in the air; the landing then slows the player for a moment.
    expect(speedOf(sim.s)).toBeCloseTo(RUN, 6);
    expect(sim.s.landSlow).toBe(MOVE.landingSlow);
    let slowest = RUN;
    sim.run(seconds(0.5), BTN.Forward, 0, (p) => (slowest = Math.min(slowest, speedOf(p.s))));
    expect(slowest).toBeLessThan(RUN * 0.95);
    expect(slowest).toBeGreaterThan(RUN * MOVE.landingSlow);
    expect(speedOf(sim.s)).toBeCloseTo(RUN, 6);
  });

  it('air control: 0.76 m/s from rest, air-strafing gains about 1 to 2.5 m/s per second', () => {
    const sky = new CollisionWorld([]);
    const still = new Sim(sky, 0, 100, 0).run(seconds(1), BTN.Forward, 0);
    expect(speedOf(still.s)).toBeCloseTo(MOVE.airMaxWishSpeed, 9);
    const gains: string[] = [];
    let best = 0;
    for (const rate of [0, 1, 2, 4, 6, 8]) {
      // Falling at run speed, holding "strafe left" while turning the view left at `rate` rad/s.
      const sim = new Sim(sky, 0, 100, 0);
      sim.s.vel.z = -RUN;
      let yaw = 0;
      for (let i = 0; i < seconds(1); i++) {
        yaw += rate * TICK_DT;
        sim.tick(BTN.Left, yaw);
      }
      const gain = speedOf(sim.s) - RUN;
      gains.push(`${rate} rad/s: +${gain.toFixed(2)}`);
      best = Math.max(best, gain);
      if (rate === 0) expect(gain).toBeLessThan(0.1);
      // Holding forward (no strafe) in the air never gains anything.
      const forward = new Sim(sky, 0, 100, 0);
      forward.s.vel.z = -RUN;
      forward.run(seconds(1), BTN.Forward, 0);
      expect(speedOf(forward.s)).toBeCloseTo(RUN, 9);
    }
    console.log(`[feel] air-strafe gain over 1 s by turn rate: ${gains.join(', ')} m/s (CS:S at its best: about +3 m/s)`);
    expect(best).toBeGreaterThan(1);
    expect(best).toBeLessThan(3.5);
  });

  it('dev_test stairs cost nothing: well above 85 % of the flat-ground speed in every stance', () => {
    const report: string[] = [];
    for (const [name, buttons] of [
      ['run', BTN.Forward],
      ['walk', BTN.Forward | BTN.Walk],
      ['crouch', BTN.Forward | BTN.Crouch],
    ] as const) {
      // From a standstill at the perimeter wall up to the walkway (stairs: z from -14 to -10).
      const sim = new Sim(devWorld, 12, 0, -15.6);
      const flat = new Sim(flatWorld(), 12, 0, -15.6);
      let stairTicks = 0;
      let flatTicks = 0;
      let slowestOnStairs = Infinity;
      for (let i = 0; i < seconds(10) && sim.s.pos.z < -10 + HW; i++) {
        sim.tick(buttons, YAW.posZ);
        stairTicks++;
        if (sim.s.pos.y > 1) slowestOnStairs = Math.min(slowestOnStairs, sim.s.vel.z);
      }
      for (let i = 0; i < seconds(10) && flat.s.pos.z < -10 + HW; i++) {
        flat.tick(buttons, YAW.posZ);
        flatTicks++;
      }
      // Steady speed of this stance on flat ground.
      const top = speedOf(flat.run(seconds(2), buttons, YAW.posZ).s);
      const ratio = flatTicks / stairTicks;
      report.push(`${name} ${(ratio * 100).toFixed(1)} % (${(stairTicks * TICK_DT).toFixed(2)} s vs ${(flatTicks * TICK_DT).toFixed(2)} s on flat ground)`);
      expect(sim.s.pos.y).toBeCloseTo(2 + SKIN, 6);
      expect(sim.airTicks).toBe(0);
      expect(ratio).toBeGreaterThan(0.85);
      // The horizontal speed on the upper half of the staircase is the full stance speed.
      expect(slowestOnStairs).toBeGreaterThan(0.99 * top);
    }
    console.log(`[feel] dev_test stairs, horizontal speed relative to flat ground: ${report.join('; ')}`);
  });
});
