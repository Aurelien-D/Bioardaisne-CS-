/**
 * Weapon state machine: firing, fire-rate, ammo, reloads, weapon switching,
 * recoil (view punch), inaccuracy and sniper zoom. Runs inside stepPlayer on
 * both client (prediction) and server (authority).
 *
 * CONTRACT FILE — see docs/ARCHITECTURE.md §Armes.
 */
import type { PlayerState, StepEvents, UserCmd, WeaponSlotState } from '../types';
import type { Loadout, WeaponDef, WeaponId } from './defs';

/** Definition of the weapon currently in hands (falls back to the knife). */
export function activeWeapon(s: PlayerState): WeaponDef {
  void s;
  throw new Error('not implemented');
}

/** Inventory for a fresh spawn: [primary, secondary, knife] with full ammo. */
export function createSlots(loadout: Loadout): (WeaponSlotState | null)[] {
  void loadout;
  throw new Error('not implemented');
}

/**
 * Current total inaccuracy (cone half-angle, radians) for the weapon in hands,
 * given stance, speed, airborne state, zoom and accumulated firing inaccuracy.
 * Used for bullets AND for the dynamic crosshair.
 */
export function currentSpread(s: PlayerState): number {
  void s;
  throw new Error('not implemented');
}

/**
 * Deterministic seed for the random spread of a shot. Both sides must use this
 * so that predicted tracers match the server's bullets.
 */
export function shotSeed(cmdSeq: number, weapon: WeaponId): number {
  void cmdSeq, weapon;
  throw new Error('not implemented');
}

/**
 * Advance the weapon state by one tick. Handles: slot switching (cmd.slot),
 * draw timer, reload (BTN.Reload, auto-reload on empty), fire (BTN.Fire, auto vs
 * semi-auto edge), zoom (BTN.AltFire edge), recoil/inaccuracy accumulation and
 * recovery. When a shot is fired, fills `ev.fired` with origin and pellet directions.
 * Does nothing harmful when `s.frozen` or `s.action !== 0` (no firing).
 */
export function stepWeapons(s: PlayerState, cmd: UserCmd, ev: StepEvents): void {
  void s, cmd, ev;
  throw new Error('stepWeapons: not implemented');
}
