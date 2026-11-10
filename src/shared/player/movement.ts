/**
 * Player movement: Source-style ground/air acceleration, friction, jumping,
 * crouching, stair stepping and sliding along walls.
 *
 * CONTRACT FILE — see docs/ARCHITECTURE.md §Mouvement.
 */
import type { CollisionWorld } from '../physics/world';
import type { PlayerState, StepEvents, UserCmd } from '../types';

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
  void s, cmd, world, maxSpeed, ev;
  throw new Error('stepMovement: not implemented');
}
