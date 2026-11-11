/**
 * Weapon state machine: firing, fire-rate, ammo, reloads, weapon switching,
 * recoil (view punch), inaccuracy and sniper zoom. Runs inside stepPlayer on
 * both client (prediction) and server (authority).
 *
 * CONTRACT FILE — see docs/ARCHITECTURE.md §Armes.
 *
 * Everything the machine needs lives in PlayerState (no module-level state), so
 * replaying the same commands from the same state always gives the same result:
 * that is what makes client-side prediction and reconciliation work.
 *
 * Order of operations inside one tick (stepWeapons):
 *   1. timers        fireCd / draw / reload count down, sinceShot counts up;
 *                    a reload whose timer expires transfers the ammo
 *   2. weapon switch cmd.slot
 *   3. reload start  BTN.Reload, or automatically on an empty clip
 *   4. zoom          BTN.AltFire rising edge (weapons with zoomFov)
 *   5. fire          BTN.Fire (held for automatic weapons, rising edge otherwise)
 *   6. recovery      view punch, dynamic inaccuracy and recoil index decay
 *
 * A timer that expires during a tick no longer blocks that tick: the first shot
 * after a draw or a reload leaves on the very tick the animation ends.
 *
 * Behaviour worth knowing when reading or tuning:
 *   - Rate of fire is exact: the part of a tick left over when the cooldown
 *     expires is carried into the next cooldown (see `cd` in stepWeapons), so
 *     `fireCd` right after a shot can be slightly below `fireInterval`.
 *   - Semi-automatic weapons fire on the rising edge of BTN.Fire only: a click
 *     made during the cooldown is not remembered.
 *   - Switching weapons clears the fire cooldown: the draw time alone delays the
 *     first shot of the new weapon. The cooldown of the weapon put away is
 *     therefore forgotten, so a weapon's `drawTime` must not be shorter than its
 *     `fireInterval` (minus the two ticks a swap takes), or "shoot, swap, swap,
 *     shoot" beats its rate of fire. tests/weapons-adversarial.test.ts enforces
 *     this for every weapon of defs.ts.
 *   - `ev.zoomChanged` is raised whenever the zoom level changes, including when
 *     a reload or a weapon switch cancels the zoom.
 *   - An empty slot in hands behaves like the knife (see activeWeapon).
 *   - The machine heals itself: a timer, the recoil index, the view punch or the
 *     inaccuracy found negative, NaN or missing (a snapshot mangled on the wire,
 *     a field added later) is back in range after one tick, and `ev.fired.dirs`
 *     are finite unit vectors whatever the state holds. Ray casts never see a
 *     NaN coming from here.
 *   - A tick on which no shot leaves allocates nothing (once the JIT has
 *     compiled the function); a shot allocates its event and one generator.
 */
import {
  ACTION,
  BTN,
  EYE_TOP_OFFSET,
  MOVE,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  SLOT,
  SLOT_COUNT,
  TICK_DT,
} from '../constants';
import { hash3, mulberry32 } from '../math/rng';
import type { Vec3 } from '../math/vec3';
import type { PlayerState, StepEvents, UserCmd, WeaponSlotState } from '../types';
import { DEFAULT_LOADOUT, WEAPONS, WEAPON_INDEX, type Loadout, type WeaponDef, type WeaponId } from './defs';

const TWO_PI = Math.PI * 2;

/** `PlayerState.sinceShot` stops counting here (seconds). */
const SINCE_SHOT_CAP = 10;
/** Recoil index decay (shots per second) once `shotsResetDelay` has elapsed. */
const SHOTS_DECAY_RATE = 12;
/** Horizontal recoil sway: phase advance per shot and initial phase (radians). */
const SWAY_STEP = 0.62;
const SWAY_PHASE = 0.9;
/** The horizontal sway fades in over this many shots (the first bullet goes straight). */
const SWAY_RAMP_SHOTS = 3;
/**
 * Moving at or below this fraction of the weapon's top speed costs no accuracy.
 * It is the crouch-walk speed, so crouching and (mostly) silent walking stay
 * accurate while running does not.
 */
const ACCURATE_SPEED_FRACTION = MOVE.crouchMul;
/** View punch / dynamic inaccuracy below this magnitude (radians) snap to exactly 0. */
const ANGLE_EPSILON = 1e-6;
/** Timers within this distance of 0 (seconds) are considered expired. */
const TIME_EPSILON = 1e-9;
/** Salt mixed into the shot seed so it does not collide with other users of hash3. */
const SHOT_SEED_SALT = 0x51a7;
/** Buttons ignored during freeze time and timed actions (same rule as stepPlayer). */
const LOCKED_BUTTONS = BTN.Fire | BTN.AltFire | BTN.Reload;
/**
 * Widest cone a shot may have (radians). Several times the worst real case
 * (a sniper fired in mid-air); it only exists so that a corrupt state cannot
 * push tan() to its pole or send bullets backwards.
 */
const MAX_CONE = Math.PI / 3;

/** Clamp a crouch fraction to 0..1; anything that is not a number counts as standing. */
function crouchFraction(crouch: number): number {
  return crouch > 0 ? (crouch < 1 ? crouch : 1) : 0;
}

/** Definition for an inventory entry; an empty or unknown entry behaves like the knife. */
function defOf(slot: WeaponSlotState | null | undefined): WeaponDef {
  return (slot && WEAPONS[slot.id]) || WEAPONS.knife;
}

/** Definition of the weapon currently in hands (falls back to the knife). */
export function activeWeapon(s: PlayerState): WeaponDef {
  return defOf(s.slots[s.active]);
}

/** Inventory for a fresh spawn: [primary, secondary, knife] with full ammo. */
export function createSlots(loadout: Loadout): (WeaponSlotState | null)[] {
  const slots: (WeaponSlotState | null)[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) slots.push(null);
  slots[SLOT.Primary] = fullSlot(weaponForSlot(loadout?.primary, SLOT.Primary, DEFAULT_LOADOUT.primary));
  slots[SLOT.Secondary] = fullSlot(weaponForSlot(loadout?.secondary, SLOT.Secondary, DEFAULT_LOADOUT.secondary));
  slots[SLOT.Melee] = fullSlot('knife');
  return slots;
}

/**
 * `id` if it is a known weapon that belongs in `slot`, otherwise `fallback`.
 * Keeps the invariant "slots[i] holds a weapon of slot i" even if an unchecked
 * loadout reaches this point, so nobody ever spawns without a gun.
 */
function weaponForSlot(id: WeaponId | undefined, slot: number, fallback: WeaponId): WeaponId {
  const def = id === undefined ? undefined : (WEAPONS[id] as WeaponDef | undefined);
  return def && def.slot === slot ? def.id : fallback;
}

function fullSlot(id: WeaponId): WeaponSlotState {
  const def = WEAPONS[id];
  return { id, clip: def.clip, reserve: def.reserve };
}

/**
 * Current total inaccuracy (cone half-angle, radians) for the weapon in hands,
 * given stance, speed, airborne state, zoom and accumulated firing inaccuracy.
 * Used for bullets AND for the dynamic crosshair.
 */
export function currentSpread(s: PlayerState): number {
  return spreadOf(s, activeWeapon(s));
}

function spreadOf(s: PlayerState, w: WeaponDef): number {
  const zoomed = s.zoom > 0;
  let spread = zoomed && w.zoomSpread !== undefined ? w.zoomSpread : w.spread;

  if (s.onGround) {
    // Crouch bonus, proportional to how far down the player already is.
    spread *= 1 + (w.spreadCrouchMul - 1) * crouchFraction(s.crouch);
  } else {
    spread += w.spreadAir;
  }

  if (w.spreadMove > 0) {
    // Movement penalty: f = clamp((speed / maxSpeed - 0.34) / 0.66, 0, 1), i.e.
    // nothing up to `accurate`, everything at `maxSpeed`, linear in between.
    // Same top speed as maxSpeedFor() in player/step.ts (not imported: it imports this file).
    let maxSpeed = MOVE.runSpeed * w.moveSpeed;
    if (zoomed && w.zoomMoveMul) maxSpeed *= w.zoomMoveMul;
    const accurate = maxSpeed * ACCURATE_SPEED_FRACTION;
    const speedSq = s.vel.x * s.vel.x + s.vel.z * s.vel.z; // horizontal only
    // Squared comparison first: a player standing still costs no square root.
    if (speedSq > accurate * accurate && maxSpeed > accurate) {
      const f = (Math.sqrt(speedSq) - accurate) / (maxSpeed - accurate);
      spread += w.spreadMove * (f < 1 ? f : 1);
    }
  }

  return spread + s.spread;
}

/**
 * Deterministic seed for the random spread of a shot. Both sides must use this
 * so that predicted tracers match the server's bullets.
 */
export function shotSeed(cmdSeq: number, weapon: WeaponId): number {
  return hash3(cmdSeq, WEAPON_INDEX[weapon] ?? 0, SHOT_SEED_SALT);
}

/**
 * Advance the weapon state by one tick. Handles: slot switching (cmd.slot),
 * draw timer, reload (BTN.Reload, auto-reload on empty), fire (BTN.Fire, auto vs
 * semi-auto edge), zoom (BTN.AltFire edge), recoil/inaccuracy accumulation and
 * recovery. When a shot is fired, fills `ev.fired` with origin and pellet directions.
 * Does nothing harmful when `s.frozen` or `s.action !== 0` (no firing).
 *
 * Reads `s.yaw` / `s.pitch` (set from the command by stepPlayer) for the aim and
 * `s.prevButtons` for edge detection; the caller updates `prevButtons` afterwards.
 * Only ever raises flags in `ev`: clearing it is the caller's job.
 */
export function stepWeapons(s: PlayerState, cmd: UserCmd, ev: StepEvents): void {
  if (!s.alive) return;

  // Freeze time: no trigger, zoom or manual reload, but switching is allowed.
  // Timed actions (plant / defuse / secure): fully locked.
  const acting = s.action !== ACTION.None;
  const buttons = acting || s.frozen ? cmd.buttons & ~LOCKED_BUTTONS : cmd.buttons;
  const pressed = buttons & ~s.prevButtons;

  let slot: WeaponSlotState | null = s.slots[s.active] ?? null;
  let w = defOf(slot);

  // --- 1. Timers ---------------------------------------------------------------
  // `cd` is the fire cooldown left after this tick. When it expires during the
  // tick it is <= 0 and its (negative) value is the part of the tick that was
  // not needed: a shot fired right now carries it into the next cooldown, so a
  // held trigger fires at exactly 1 / fireInterval on average instead of being
  // rounded up to a whole number of ticks (600 rpm would otherwise become 549).
  //
  // All the tests below are written `> 0` / `>= 0` on purpose: a timer that is
  // negative or not a number fails them, reads as expired and is written back
  // as a clean value (see "heals itself" in the header).
  //
  // The countdowns are written out in place rather than through a helper: a
  // helper returning a number makes the JIT box it whenever the call is not
  // inlined, i.e. garbage on every tick of every draw and reload.
  let cd = s.fireCd > 0 ? s.fireCd - TICK_DT : 0;
  if (s.draw > 0) {
    const left = s.draw - TICK_DT;
    if (left > TIME_EPSILON) s.draw = left;
    else s.draw = 0;
  } else {
    s.draw = 0;
  }
  const since = s.sinceShot + TICK_DT;
  s.sinceShot = since >= 0 && since < SINCE_SHOT_CAP ? since : SINCE_SHOT_CAP;
  if (s.reload > 0) {
    const left = s.reload - TICK_DT;
    if (left > TIME_EPSILON) {
      s.reload = left;
    } else {
      s.reload = 0;
      fillClip(slot, w);
      ev.reloadFinished = true;
    }
  } else {
    s.reload = 0;
  }

  // --- 2. Weapon switch --------------------------------------------------------
  // Requested slot: a valid index (integer, in range), not the one in hands, not empty.
  const want = cmd.slot;
  if (want >= 0 && want < s.slots.length && want === (want | 0) && want !== s.active && !acting) {
    const target = s.slots[want];
    if (target) {
      s.active = want;
      slot = target;
      w = defOf(target);
      s.draw = w.drawTime;
      s.reload = 0; // an interrupted reload is lost
      // The draw time is the only delay before the new weapon can fire; the
      // cooldown of the weapon that was put away must not carry over.
      cd = 0;
      s.shots = 0;
      if (s.zoom !== 0) {
        s.zoom = 0;
        ev.zoomChanged = true;
      }
      ev.switched = true;
    }
  }

  // --- 3. Reload start ---------------------------------------------------------
  if (
    slot !== null &&
    s.reload <= 0 &&
    s.draw <= 0 &&
    slot.clip < w.clip &&
    slot.reserve > 0 &&
    ((buttons & BTN.Reload) !== 0 || slot.clip <= 0)
  ) {
    if (s.zoom !== 0) {
      s.zoom = 0;
      ev.zoomChanged = true;
    }
    ev.reloadStarted = true;
    if (w.reloadTime > 0) {
      s.reload = w.reloadTime;
    } else {
      // Instant reload (no weapon uses it today): never leave a zero-length timer pending.
      fillClip(slot, w);
      ev.reloadFinished = true;
    }
  }

  // --- 4. Zoom -----------------------------------------------------------------
  if (w.zoomFov) {
    if ((pressed & BTN.AltFire) !== 0 && s.reload <= 0 && s.draw <= 0) {
      // 0 -> 1 -> ... -> last level -> 0. Anything that is not a level counts as unzoomed.
      s.zoom = s.zoom >= 1 ? (s.zoom >= w.zoomFov.length ? 0 : s.zoom + 1) : 1;
      ev.zoomChanged = true;
    }
  } else if (s.zoom !== 0) {
    // Defensive: a zoom level left over on a weapon without a scope.
    s.zoom = 0;
    ev.zoomChanged = true;
  }

  // --- 5. Fire -----------------------------------------------------------------
  let fired = false;
  if ((buttons & BTN.Fire) !== 0 && cd <= TIME_EPSILON && s.draw <= 0 && s.reload <= 0) {
    const edge = (pressed & BTN.Fire) !== 0;
    if (w.kind === 'melee') {
      fired = w.auto || edge;
    } else if (slot !== null && slot.clip > 0) {
      if (w.auto || edge) {
        slot.clip--;
        fired = true;
      }
    } else if (edge) {
      // Only reachable with an empty reserve too (otherwise the reload has started).
      ev.dryFire = true;
    }
  }
  if (fired) {
    fireShot(s, cmd, w, ev);
    const next = w.fireInterval + (cd < 0 ? cd : 0);
    s.fireCd = next > 0 ? next : 0;
  } else {
    s.fireCd = cd > TIME_EPSILON ? cd : 0;
  }

  // --- 6. Recovery -------------------------------------------------------------
  if (s.punchPitch !== 0 || s.punchYaw !== 0) {
    const k = Math.exp(-w.recoilRecovery * TICK_DT);
    const pitch = s.punchPitch * k;
    const yaw = s.punchYaw * k;
    s.punchPitch = pitch > ANGLE_EPSILON || pitch < -ANGLE_EPSILON ? pitch : 0;
    s.punchYaw = yaw > ANGLE_EPSILON || yaw < -ANGLE_EPSILON ? yaw : 0;
  }
  if (s.spread !== 0) {
    const spread = s.spread * Math.exp(-w.spreadRecovery * TICK_DT);
    s.spread = spread > ANGLE_EPSILON ? spread : 0;
  }
  if (s.shots > 0) {
    if (s.sinceShot > w.shotsResetDelay) {
      const shots = s.shots - SHOTS_DECAY_RATE * TICK_DT;
      s.shots = shots > 0 ? shots : 0;
    }
  } else if (s.shots !== 0) {
    s.shots = 0; // negative or not a number
  }
}

/** Move as many rounds as possible from the reserve into the clip. */
function fillClip(slot: WeaponSlotState | null, w: WeaponDef): void {
  if (slot === null) return;
  const missing = w.clip - slot.clip;
  const moved = missing < slot.reserve ? missing : slot.reserve;
  if (moved > 0) {
    slot.clip += moved;
    slot.reserve -= moved;
  }
}

/**
 * Emit one shot: fill `ev.fired`, then apply recoil, inaccuracy growth and the
 * bookkeeping of a shot. Ammo and the fire cooldown are handled by the caller.
 */
function fireShot(s: PlayerState, cmd: UserCmd, w: WeaponDef, ev: StepEvents): void {
  // Never shoot from a corrupt state: the directions go straight into ray
  // casts, where a NaN does far more harm than a bullet without recoil. The
  // recovery step would fix these fields at the end of the tick anyway; a shot
  // needs them right now.
  if (!Number.isFinite(s.punchPitch)) s.punchPitch = 0;
  if (!Number.isFinite(s.punchYaw)) s.punchYaw = 0;
  if (!(s.spread >= 0)) s.spread = 0;
  if (!(s.shots >= 0)) s.shots = 0;

  // Bullets go where the camera looks: view angles plus the current view punch.
  // Commands are validated upstream; the fallback is a last line of defence so
  // that a non-finite angle can never turn into NaN rays in the hit detection.
  const aimYaw = s.yaw + s.punchYaw;
  const aimPitch = s.pitch + s.punchPitch;
  const yaw = Number.isFinite(aimYaw) ? aimYaw : 0;
  const pitch = Number.isFinite(aimPitch) ? aimPitch : 0;
  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  // Orthonormal basis around the aim direction, in closed form (see math/vec3.ts):
  //   forward = (-sy*cp, sp, -cy*cp)   right = (cy, 0, -sy)   up = right x forward = (sy*sp, cp, cy*sp)
  const fx = -sy * cp;
  const fy = sp;
  const fz = -cy * cp;
  const ux = sy * sp;
  const uz = cy * sp;

  // One generator per shot, seeded from the command: the client's predicted
  // tracers and the server's bullets use the same numbers. Draw order matters:
  // two numbers per pellet first, then the recoil jitter.
  const rng = mulberry32(shotSeed(cmd.seq, w.id));

  const dirs: Vec3[] = [];
  if (w.kind === 'melee') {
    // A stab goes straight down the view axis; the Room applies the short range.
    dirs.push({ x: fx, y: fy, z: fz });
  } else {
    const raw = spreadOf(s, w);
    const cone = raw > 0 ? (raw < MAX_CONE ? raw : MAX_CONE) : 0;
    const pellets = w.pellets > 1 ? w.pellets : 1;
    for (let p = 0; p < pellets; p++) {
      // Uniform over the cone's cross-section: radius ~ sqrt(u), angle ~ v.
      const t = Math.tan(cone * Math.sqrt(rng()));
      const theta = TWO_PI * rng();
      const a = t * Math.cos(theta); // offset along `right`
      const b = t * Math.sin(theta); // offset along `up`
      // |forward + a*right + b*up| = sqrt(1 + t*t) because the basis is orthonormal.
      const inv = 1 / Math.sqrt(1 + t * t);
      dirs.push({
        x: (fx + cy * a + ux * b) * inv,
        y: (fy + cp * b) * inv,
        z: (fz - sy * a + uz * b) * inv,
      });
    }
  }

  // Same formula as eyeHeight() in player/step.ts (not imported: it imports this file).
  const eyeHeight = PLAYER_HEIGHT + (PLAYER_CROUCH_HEIGHT - PLAYER_HEIGHT) * crouchFraction(s.crouch) - EYE_TOP_OFFSET;
  ev.fired = { weapon: w.id, origin: { x: s.pos.x, y: s.pos.y + eyeHeight, z: s.pos.z }, dirs };

  // Recoil. Upward kick: full strength from rest, fading linearly to nothing as
  // the accumulated punch reaches recoilMax (which it can therefore never exceed).
  if (w.recoilMax > 0) {
    let k = 1 - s.punchPitch / w.recoilMax;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const up = s.punchPitch + w.recoilUp * k;
    s.punchPitch = up < w.recoilMax ? up : w.recoilMax;
  }
  // Sideways kick: a fixed sway indexed by the number of recent shots (the
  // learnable part of the spray pattern) plus a small seeded jitter.
  const i = Math.floor(s.shots);
  const ramp = i < SWAY_RAMP_SHOTS ? i / SWAY_RAMP_SHOTS : 1;
  s.punchYaw += w.recoilSide * Math.sin(SWAY_STEP * i + SWAY_PHASE) * ramp + w.recoilJitter * (rng() * 2 - 1);

  s.shots += 1;
  const spread = s.spread + w.spreadShot;
  s.spread = spread < w.spreadShotMax ? spread : w.spreadShotMax;
  s.sinceShot = 0;
  s.protect = 0; // shooting gives up spawn protection
}
