/**
 * stepPlayer: the single entry point that advances a player by one tick.
 * Shared by the server (authoritative), the client (prediction + replay during
 * reconciliation) and bots.
 */
import {
  ACTION,
  BTN,
  EYE_TOP_OFFSET,
  MAX_ARMOR,
  MAX_HEALTH,
  MOVE,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
} from '../constants';
import { clamp, wrapAngle, type Vec3 } from '../math/vec3';
import type { CollisionWorld } from '../physics/world';
import type { PlayerState, StepEvents, UserCmd } from '../types';
import { DEFAULT_LOADOUT, type Loadout } from '../weapons/defs';
import { activeWeapon, createSlots, stepWeapons } from '../weapons/logic';
import { stepMovement } from './movement';

export const MAX_PITCH = (89 * Math.PI) / 180;

/** Current hull height for a crouch fraction (0 standing … 1 crouched). */
export const hullHeight = (crouch: number): number => PLAYER_HEIGHT + (PLAYER_CROUCH_HEIGHT - PLAYER_HEIGHT) * crouch;

/** Eye height above the feet. */
export const eyeHeight = (crouch: number): number => hullHeight(crouch) - EYE_TOP_OFFSET;

export const eyePosition = (s: PlayerState): Vec3 => ({ x: s.pos.x, y: s.pos.y + eyeHeight(s.crouch), z: s.pos.z });

/** Max ground speed for the current weapon / zoom (before walk and crouch modifiers). */
export function maxSpeedFor(s: PlayerState): number {
  const w = activeWeapon(s);
  let speed = MOVE.runSpeed * w.moveSpeed;
  if (s.zoom > 0 && w.zoomMoveMul) speed *= w.zoomMoveMul;
  return speed;
}

export function newStepEvents(): StepEvents {
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

export function clearStepEvents(ev: StepEvents): void {
  ev.fired = null;
  ev.dryFire = false;
  ev.reloadStarted = false;
  ev.reloadFinished = false;
  ev.switched = false;
  ev.jumped = false;
  ev.landedSpeed = 0;
  ev.zoomChanged = false;
}

/** Fresh, alive player state at a spawn position with a full loadout. */
export function createPlayerState(pos: Vec3, yaw = 0, loadout: Loadout = DEFAULT_LOADOUT): PlayerState {
  return {
    pos: { x: pos.x, y: pos.y, z: pos.z },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    onGround: false,
    crouch: 0,
    landSlow: 1,
    alive: true,
    health: MAX_HEALTH,
    armor: MAX_ARMOR,
    slots: createSlots(loadout),
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
    action: ACTION.None,
    actionT: 0,
    protect: 0,
    frozen: false,
  };
}

/** Deep copy (PlayerState is plain JSON data). */
export function clonePlayerState(s: PlayerState): PlayerState {
  return {
    ...s,
    pos: { ...s.pos },
    vel: { ...s.vel },
    slots: s.slots.map((w) => (w ? { ...w } : null)),
  };
}

const MOVE_BUTTONS = BTN.Forward | BTN.Back | BTN.Left | BTN.Right | BTN.Jump;
const FIRE_BUTTONS = BTN.Fire | BTN.AltFire | BTN.Reload;

/**
 * Advance `s` by exactly one tick using `cmd`. Mutates `s`, fills `ev`.
 * Dead players are left untouched (apart from view angles).
 */
export function stepPlayer(s: PlayerState, cmd: UserCmd, world: CollisionWorld, ev: StepEvents): void {
  clearStepEvents(ev);
  s.yaw = wrapAngle(cmd.yaw);
  s.pitch = clamp(cmd.pitch, -MAX_PITCH, MAX_PITCH);
  if (!s.alive) {
    s.prevButtons = cmd.buttons;
    return;
  }
  let buttons = cmd.buttons;
  // Freeze time: look around and switch weapons only. Timed actions (plant / defuse): fully locked.
  if (s.frozen) buttons &= ~(MOVE_BUTTONS | FIRE_BUTTONS);
  if (s.action !== ACTION.None) buttons &= ~(MOVE_BUTTONS | FIRE_BUTTONS);
  const locked = s.action !== ACTION.None;
  const eff: UserCmd = buttons === cmd.buttons && !locked ? cmd : { ...cmd, buttons, slot: locked ? -1 : cmd.slot };

  stepMovement(s, eff, world, maxSpeedFor(s), ev);
  stepWeapons(s, eff, ev);
  s.prevButtons = cmd.buttons;
}
