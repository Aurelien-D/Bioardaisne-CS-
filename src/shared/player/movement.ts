/**
 * Player movement: Source-style ground/air acceleration, friction, jumping,
 * crouching, stair stepping and sliding along walls.
 *
 * CONTRACT FILE — see docs/ARCHITECTURE.md §Mouvement.
 *
 * The hull is an axis-aligned box, PLAYER_HALF_WIDTH wide on each side and
 * hullHeight(crouch) tall, whose bottom centre is `s.pos` (the feet). The feet never move
 * when the hull height changes: crouching lowers the head, standing up raises it.
 *
 * Every solid is an axis-aligned box, so every surface normal is a world axis: walkable
 * ground is always flat (normal +Y), and clipping the velocity against a surface is simply
 * zeroing one component. Velocity on the ground is purely horizontal.
 *
 * One tick:
 *   0. safety      a hull that starts inside a solid is ducked or nudged out of it
 *   1. crouch      s.crouch moves toward 1 (held) or 0 (released, if the standing hull fits)
 *   2. wish        direction from yaw + buttons, speed from maxSpeed and the walk / crouch /
 *                  landing modifiers
 *   3. ground      3 cm downward probe, only while not moving up
 *   4. jump        rising edge of BTN.Jump on the ground
 *   5. velocity    ground: friction then acceleration (never slower to respond than at run
 *                  speed, so that slow stances can overcome friction); air: gravity (half
 *                  before the move, half after: exact parabola) and limited air acceleration
 *   6. move        ground: slide, or "step up / slide / step down" when that goes farther,
 *                  then stick to the ground when walking down stairs; air: slide (obstacles
 *                  low enough to be stepped onto do not kill the speed)
 *   7. landing     ev.landedSpeed + landing slow-down
 */
import {
  BTN,
  CROUCH_TIME,
  MOVE,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HALF_WIDTH,
  PLAYER_HEIGHT,
  STEP_HEIGHT,
  TICK_DT,
} from '../constants';
import type { Vec3 } from '../math/vec3';
import type { CollisionWorld, Trace } from '../physics/world';
import type { PlayerState, StepEvents, UserCmd } from '../types';

/** The player is on the ground when a surface lies within this distance below the feet (m). */
const GROUND_PROBE = 0.03;
/**
 * Gap (m) between the feet and the ground they rest on: the back-off distance of world sweeps.
 * A player placed closer than this (spawn points sit exactly on the floor) is raised to it, so
 * that a standing player is always in the same, well-defined position relative to the floor.
 */
const REST_GAP = 1e-3;
/** Height differences below this (m) are float noise, not movement. */
const REST_GAP_SLACK = 1e-6;
/**
 * After a ground move the player is pulled down onto any surface within this distance (walking
 * down stairs and kerbs without leaving the ground). Measured from the feet, which rest
 * REST_GAP above the ground, so that a drop of exactly STEP_HEIGHT still counts.
 */
const STEP_DOWN = STEP_HEIGHT + 2 * REST_GAP;
/**
 * Horizontal distance (m) probed above a low obstacle hit in the air, to tell a step from a
 * wall with a plinth at its foot.
 */
const STEP_PROBE = 0.03;
/** A surface is walkable when its normal points up at least this much. */
const WALKABLE_NORMAL_Y = 0.7;
/** Collisions resolved per move: with axis-aligned surfaces three are enough to stop dead. */
const MAX_BUMPS = 4;
/** Landing faster than this (m/s) slows the player down (MOVE.landingSlow). */
const LAND_SLOW_MIN_SPEED = 4;
/** Recovery rate of `landSlow` toward 1 (per second). */
const LAND_SLOW_RECOVERY = 1.5;
const INV_SQRT2 = Math.SQRT1_2;

const STAND_HALF_HEIGHT = PLAYER_HEIGHT / 2;
const CROUCH_HALF_HEIGHT = PLAYER_CROUCH_HEIGHT / 2;

/** slideMove result flags. */
const HIT_WALL = 1;
const HIT_STUCK = 2;

/**
 * Escape search for a hull stuck in a solid: distances tried in order, and for each distance
 * the directions below (straight up first, then sideways).
 */
const UNSTUCK_DISTANCES = [0.002, 0.01, 0.03, 0.06, 0.125, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5];
const UNSTUCK_DIRS = [
  [0, 1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
  [INV_SQRT2, 0, INV_SQRT2],
  [-INV_SQRT2, 0, INV_SQRT2],
  [INV_SQRT2, 0, -INV_SQRT2],
  [-INV_SQRT2, 0, -INV_SQRT2],
] as const;

// Working copy of the player being moved and scratch vectors for world queries. Module-level
// on purpose (no allocation per tick); stepMovement is synchronous and never re-entered.
let px = 0;
let py = 0;
let pz = 0;
let vx = 0;
let vy = 0;
let vz = 0;
/** Half of the current hull height. */
let hh = STAND_HALF_HEIGHT;
const boxCenter: Vec3 = { x: 0, y: 0, z: 0 };
const boxHalf: Vec3 = { x: PLAYER_HALF_WIDTH, y: STAND_HALF_HEIGHT, z: PLAYER_HALF_WIDTH };
const boxDelta: Vec3 = { x: 0, y: 0, z: 0 };

/** Same formula as `hullHeight` in player/step.ts (not imported: step.ts imports this module). */
const hullHeightOf = (crouch: number): number => PLAYER_HEIGHT + (PLAYER_CROUCH_HEIGHT - PLAYER_HEIGHT) * crouch;

const finiteOr = (v: number, fallback: number): number => (v - v === 0 ? v : fallback);

/** Sweep the current hull from the working position along (dx, dy, dz). */
function sweepHull(world: CollisionWorld, dx: number, dy: number, dz: number): Trace {
  boxCenter.x = px;
  boxCenter.y = py + hh;
  boxCenter.z = pz;
  boxHalf.y = hh;
  boxDelta.x = dx;
  boxDelta.y = dy;
  boxDelta.z = dz;
  return world.sweepBox(boxCenter, boxHalf, boxDelta);
}

/** True if a hull of half height `halfHeight` standing at the working position overlaps a solid. */
function hullBlocked(world: CollisionWorld, halfHeight: number): boolean {
  boxCenter.x = px;
  boxCenter.y = py + halfHeight;
  boxCenter.z = pz;
  boxHalf.y = halfHeight;
  return world.boxOverlaps(boxCenter, boxHalf);
}

/**
 * Move the working position to the closest free spot found around it (smallest distance
 * first, straight up before sideways, never down). Returns false if there is none.
 */
function unstuck(world: CollisionWorld): boolean {
  const ox = px;
  const oy = py;
  const oz = pz;
  for (let i = 0; i < UNSTUCK_DISTANCES.length; i++) {
    const dist = UNSTUCK_DISTANCES[i]!;
    for (let j = 0; j < UNSTUCK_DIRS.length; j++) {
      const dir = UNSTUCK_DIRS[j]!;
      px = ox + dir[0] * dist;
      py = oy + dir[1] * dist;
      pz = oz + dir[2] * dist;
      if (!hullBlocked(world, hh)) return true;
    }
  }
  px = ox;
  py = oy;
  pz = oz;
  return false;
}

/**
 * Downward probe: true if a walkable surface lies within `dist` below the hull, in which case
 * the hull is brought to rest on it (REST_GAP above the surface).
 */
function settleOnGround(world: CollisionWorld, dist: number): boolean {
  const tr = sweepHull(world, 0, -dist, 0);
  if (!tr.hit || tr.startSolid || tr.normal.y <= WALKABLE_NORMAL_Y) return false;
  const drop = dist * tr.fraction;
  if (drop > REST_GAP_SLACK) {
    py -= drop;
  } else {
    // Already resting (the height is left untouched: no float jitter while standing or
    // walking), or closer to the surface than the usual gap: restore it if there is headroom.
    const rest = world.solids[tr.solid]!.max.y + REST_GAP;
    if (py < rest - REST_GAP_SLACK) {
      const y = py;
      py = rest;
      if (hullBlocked(world, hh)) py = y;
    }
  }
  return true;
}

/**
 * Move the working position by velocity * dt, sliding along whatever is hit: sweep, advance,
 * remove the velocity component going into the surface, continue with the remaining time.
 */
function slideMove(world: CollisionWorld, dt: number): number {
  let flags = 0;
  let time = dt;
  for (let bump = 0; bump < MAX_BUMPS; bump++) {
    const dx = vx * time;
    const dy = vy * time;
    const dz = vz * time;
    if (dx === 0 && dy === 0 && dz === 0) break;
    const tr = sweepHull(world, dx, dy, dz);
    if (tr.startSolid) {
      // Cannot happen after the safety pass; never tunnel if it somehow does.
      vx = 0;
      vy = 0;
      vz = 0;
      return flags | HIT_STUCK;
    }
    const f = tr.fraction;
    if (f > 0) {
      px += dx * f;
      py += dy * f;
      pz += dz * f;
    }
    if (!tr.hit) break;
    time *= 1 - f;
    const n = tr.normal;
    if (n.y !== 0) {
      vy = 0;
    } else {
      flags |= HIT_WALL;
      if (n.x !== 0) vx = 0;
      else vz = 0;
    }
  }
  return flags;
}

/**
 * Ground move. Slide first; if a wall got in the way, also try "step up by STEP_HEIGHT,
 * slide, step back down" from the same start and keep that result when it lands on a
 * walkable surface and travels farther (stairs, kerbs, low ledges).
 */
function stepSlideMove(world: CollisionWorld, dt: number): void {
  const sx = px;
  const sy = py;
  const sz = pz;
  const svx = vx;
  const svz = vz;

  const flags = slideMove(world, dt);
  if ((flags & HIT_WALL) === 0 || (flags & HIT_STUCK) !== 0) return;

  // Result of the direct move.
  const ax = px;
  const az = pz;
  const avx = vx;
  const avz = vz;

  px = sx;
  py = sy;
  pz = sz;
  vx = svx;
  vy = 0;
  vz = svz;
  const up = sweepHull(world, 0, STEP_HEIGHT, 0);
  if (!up.startSolid) {
    py += STEP_HEIGHT * up.fraction;
    const raised = py - sy;
    if (raised > 0 && (slideMove(world, dt) & HIT_STUCK) === 0) {
      const down = sweepHull(world, 0, -raised, 0);
      if (down.hit && !down.startSolid && down.normal.y > WALKABLE_NORMAL_Y) {
        py -= raised * down.fraction;
        const direct = (ax - sx) * (ax - sx) + (az - sz) * (az - sz);
        const stepped = (px - sx) * (px - sx) + (pz - sz) * (pz - sz);
        if (stepped > direct) {
          vy = 0;
          return;
        }
      }
    }
  }

  // Stepping did not help: keep the direct move.
  px = ax;
  py = sy;
  pz = az;
  vx = avx;
  vy = 0;
  vz = avz;
}

/**
 * Air move. Slide; then, if a wall stopped the player close to the ground, check whether that
 * "wall" is something a player standing there would simply step onto (a stair, a kerb). If it
 * is, the speed toward it is kept: the position is still blocked for now, but the player
 * carries on as soon as the feet clear the obstacle or touch the ground (where stepSlideMove
 * climbs it). Without this, jumping on a staircase would kill all momentum at every riser.
 * Only the velocity differs from a plain slide: where the player can go is unchanged.
 */
function airSlideMove(world: CollisionWorld, dt: number): void {
  const svx = vx;
  const svz = vz;
  const flags = slideMove(world, dt);
  if ((flags & HIT_WALL) === 0 || (flags & HIT_STUCK) !== 0) return;

  // Is there ground within stepping distance below the blocked position?
  const below = sweepHull(world, 0, -STEP_DOWN, 0);
  if (!below.hit || below.startSolid || below.normal.y <= WALKABLE_NORMAL_Y) return;
  // Raise the hull as high as a step taken from that ground would (no higher than a ceiling allows)...
  const raise = STEP_HEIGHT - STEP_DOWN * below.fraction;
  if (raise <= 0) return;
  const up = sweepHull(world, 0, raise, 0);
  if (up.startSolid) return;
  const lift = raise * up.fraction;
  if (lift <= 0) return;
  const y = py;
  py += lift;
  // ...and see whether the way is clear from up there on each axis that was blocked.
  if (vx === 0 && svx !== 0 && !sweepHull(world, svx > 0 ? STEP_PROBE : -STEP_PROBE, 0, 0).hit) vx = svx;
  if (vz === 0 && svz !== 0 && !sweepHull(world, 0, 0, svz > 0 ? STEP_PROBE : -STEP_PROBE).hit) vz = svz;
  py = y;
}

/**
 * Advance the movement part of `s` by exactly one tick (TICK_DT) using `cmd`.
 * `maxSpeed` is the run speed allowed by the weapon in hands (m/s).
 * Must be fully deterministic: same inputs => same outputs on client and server.
 * Sets `ev.jumped` / `ev.landedSpeed`.
 */
export function stepMovement(
  s: PlayerState,
  cmd: UserCmd,
  world: CollisionWorld,
  maxSpeed: number,
  ev: StepEvents,
): void {
  const dt = TICK_DT;
  ev.jumped = false;
  ev.landedSpeed = 0;

  // --- Load the state; garbage (NaN / Infinity) is replaced so it can never spread ----------
  px = finiteOr(s.pos.x, 0);
  py = finiteOr(s.pos.y, 0);
  pz = finiteOr(s.pos.z, 0);
  vx = finiteOr(s.vel.x, 0);
  vy = finiteOr(s.vel.y, 0);
  vz = finiteOr(s.vel.z, 0);
  let crouch = finiteOr(s.crouch, 0);
  crouch = crouch < 0 ? 0 : crouch > 1 ? 1 : crouch;
  let landSlow = finiteOr(s.landSlow, 1);
  landSlow = landSlow < 0 ? 0 : landSlow > 1 ? 1 : landSlow;
  const buttons = cmd.buttons | 0;
  const yaw = finiteOr(cmd.yaw, finiteOr(s.yaw, 0));
  const speedLimit = maxSpeed > 0 && maxSpeed - maxSpeed === 0 ? maxSpeed : 0;
  hh = hullHeightOf(crouch) / 2;

  // --- 0. Safety: free a hull that starts inside a solid -------------------------------------
  if (hullBlocked(world, hh)) {
    if (crouch < 1 && !hullBlocked(world, CROUCH_HALF_HEIGHT)) {
      // Only the head is in the way (ceiling): duck.
      crouch = 1;
      hh = CROUCH_HALF_HEIGHT;
    } else {
      vx = 0;
      vy = 0;
      vz = 0;
      if (!unstuck(world)) {
        // Entombed: stay put rather than move through solids.
        s.pos.x = px;
        s.pos.y = py;
        s.pos.z = pz;
        s.vel.x = 0;
        s.vel.y = 0;
        s.vel.z = 0;
        s.crouch = crouch;
        s.landSlow = landSlow;
        s.onGround = false;
        return;
      }
    }
  }

  // The landing slow-down wears off.
  if (landSlow < 1) {
    landSlow += LAND_SLOW_RECOVERY * dt;
    if (landSlow > 1) landSlow = 1;
  }

  // --- 1. Crouch -----------------------------------------------------------------------------
  const crouchStep = dt / CROUCH_TIME;
  if ((buttons & BTN.Crouch) !== 0) {
    if (crouch < 1) {
      crouch += crouchStep;
      if (crouch > 1) crouch = 1;
    }
  } else if (crouch > 0 && !hullBlocked(world, STAND_HALF_HEIGHT)) {
    // Standing up needs room for the whole standing hull; otherwise the stance is held.
    crouch -= crouchStep;
    if (crouch < 0) crouch = 0;
  }
  hh = hullHeightOf(crouch) / 2;

  // --- 2. Wish direction and speed -----------------------------------------------------------
  const fwd = ((buttons & BTN.Forward) !== 0 ? 1 : 0) - ((buttons & BTN.Back) !== 0 ? 1 : 0);
  const side = ((buttons & BTN.Right) !== 0 ? 1 : 0) - ((buttons & BTN.Left) !== 0 ? 1 : 0);
  let wishX = 0;
  let wishZ = 0;
  if (fwd !== 0 || side !== 0) {
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    // forward = (-sin, -cos), right = (cos, -sin) in the XZ plane (see math/vec3.ts).
    wishX = -sin * fwd + cos * side;
    wishZ = -cos * fwd - sin * side;
    if (fwd !== 0 && side !== 0) {
      wishX *= INV_SQRT2;
      wishZ *= INV_SQRT2;
    }
  }
  const hasWish = wishX !== 0 || wishZ !== 0;
  const wishSpeed =
    speedLimit *
    ((buttons & BTN.Walk) !== 0 ? MOVE.walkMul : 1) *
    (1 + (MOVE.crouchMul - 1) * crouch) *
    landSlow;

  // --- 3. Ground check -----------------------------------------------------------------------
  let grounded = vy <= 0 && settleOnGround(world, GROUND_PROBE);
  // Normally landings are detected at the end of the tick that hits the floor; this only
  // triggers when something else moved the player (spawn, teleport).
  let impact = grounded && !s.onGround ? -vy : 0;

  // --- 4. Jump (rising edge only: holding the key does not bunny-hop) --------------------------
  if (grounded && (buttons & BTN.Jump) !== 0 && (s.prevButtons & BTN.Jump) === 0) {
    vy = MOVE.jumpSpeed;
    grounded = false;
    ev.jumped = true;
  }

  if (grounded) {
    // --- 5a. Ground: friction, then acceleration ----------------------------------------------
    vy = 0;
    const speed = Math.sqrt(vx * vx + vz * vz);
    if (speed > 0) {
      const control = speed < MOVE.stopSpeed ? MOVE.stopSpeed : speed;
      const remaining = speed - control * MOVE.friction * dt;
      if (remaining > 0) {
        const k = remaining / speed;
        vx *= k;
        vz *= k;
      } else {
        vx = 0;
        vz = 0;
      }
    }
    if (hasWish) {
      const addSpeed = wishSpeed - (vx * wishX + vz * wishZ);
      if (addSpeed > 0) {
        // Quake / Source formula, except that the acceleration is scaled by at least the run
        // speed (as later Counter-Strike versions do). With the plain `accel * dt * wishSpeed`,
        // slow targets (crouching with a heavy weapon, scoped, crouch + walk) gain less speed
        // per tick than the stopSpeed friction removes and the player could not move at all.
        let accelSpeed = MOVE.accel * dt * (wishSpeed > MOVE.runSpeed ? wishSpeed : MOVE.runSpeed);
        if (accelSpeed > addSpeed) accelSpeed = addSpeed;
        vx += accelSpeed * wishX;
        vz += accelSpeed * wishZ;
      }
    }

    // --- 6a. Move, climbing steps, then stay glued to the ground going down stairs ------------
    if (vx !== 0 || vz !== 0) {
      stepSlideMove(world, dt);
      grounded = settleOnGround(world, STEP_DOWN);
    }
  } else {
    // --- 5b. Air: gravity and limited air control ---------------------------------------------
    const halfGravity = MOVE.gravity * dt * 0.5;
    vy -= halfGravity;
    if (vy < -MOVE.maxFallSpeed) vy = -MOVE.maxFallSpeed;
    if (hasWish) {
      const airWish = wishSpeed < MOVE.airMaxWishSpeed ? wishSpeed : MOVE.airMaxWishSpeed;
      const addSpeed = airWish - (vx * wishX + vz * wishZ);
      if (addSpeed > 0) {
        let accelSpeed = MOVE.airAccel * dt * wishSpeed;
        if (accelSpeed > addSpeed) accelSpeed = addSpeed;
        vx += accelSpeed * wishX;
        vz += accelSpeed * wishZ;
      }
    }

    // --- 6b. Move -----------------------------------------------------------------------------
    const fallSpeed = vy < 0 ? -vy : 0;
    airSlideMove(world, dt);
    vy -= halfGravity;
    if (vy < -MOVE.maxFallSpeed) vy = -MOVE.maxFallSpeed;

    // --- 7. Landing ---------------------------------------------------------------------------
    if (vy <= 0 && settleOnGround(world, GROUND_PROBE)) {
      grounded = true;
      vy = 0;
      impact = fallSpeed;
    }
  }

  if (impact > 0) {
    ev.landedSpeed = impact;
    if (impact > LAND_SLOW_MIN_SPEED) landSlow = MOVE.landingSlow;
  }

  // --- Store ---------------------------------------------------------------------------------
  s.pos.x = px;
  s.pos.y = py;
  s.pos.z = pz;
  s.vel.x = vx;
  s.vel.y = vy;
  s.vel.z = vz;
  s.crouch = crouch;
  s.landSlow = landSlow;
  s.onGround = grounded;
}
