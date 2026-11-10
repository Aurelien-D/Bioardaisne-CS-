/**
 * Global gameplay constants shared by client prediction, server simulation and bots.
 * Units: metres, seconds, radians. Tuned for a Counter-Strike: Source–like feel.
 */

export const PROTOCOL_VERSION = 1;

// --- Simulation timing -------------------------------------------------------
/** Player simulation rate. Every UserCmd advances a player by exactly one tick. */
export const TICK_RATE = 64;
export const TICK_DT = 1 / TICK_RATE;
/** The server sends one snapshot every N ticks (32 Hz). */
export const SNAPSHOT_EVERY = 2;
/** Remote entities are rendered this far in the past (ms) and interpolated. */
export const INTERP_DELAY_MS = 90;
/** Maximum lag compensation rewind (ms). */
export const MAX_LAG_COMP_MS = 350;

// --- Player hull ---------------------------------------------------------------
/** Half width of the axis-aligned player hull (hull is 0.7 m wide). */
export const PLAYER_HALF_WIDTH = 0.35;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_CROUCH_HEIGHT = 1.3;
/** Eye position = feet.y + currentHullHeight - EYE_TOP_OFFSET. */
export const EYE_TOP_OFFSET = 0.16;
/** Maximum ledge height that can be walked up without jumping. */
export const STEP_HEIGHT = 0.5;
/** Time (s) to go from standing to fully crouched (and back). */
export const CROUCH_TIME = 0.18;

// --- Movement (Source-style acceleration / friction model) ---------------------
export const MOVE = {
  /** Base run speed (m/s) with the fastest weapon; multiplied by WeaponDef.moveSpeed. */
  runSpeed: 6.0,
  /** Multiplier while holding WALK (silent walk). */
  walkMul: 0.52,
  /** Multiplier when fully crouched. */
  crouchMul: 0.34,
  /** Ground acceleration factor (Source sv_accelerate). */
  accel: 5.5,
  /** Air acceleration factor (Source sv_airaccelerate). */
  airAccel: 10,
  /** Max wish speed while airborne (limits air control, enables light air-strafing). */
  airMaxWishSpeed: 0.76,
  /** Ground friction (Source sv_friction). */
  friction: 4.8,
  /** Below this speed friction uses stopSpeed as control speed (crisp stops). */
  stopSpeed: 1.9,
  gravity: 20,
  /** Initial vertical speed of a jump (apex ≈ 1.2 m). */
  jumpSpeed: 7.0,
  /** Speed multiplier applied on landing after a jump (anti bunny-hop), recovers quickly. */
  landingSlow: 0.75,
  /** Terminal fall speed. */
  maxFallSpeed: 40,
} as const;

// --- Combat --------------------------------------------------------------------
export const MAX_HEALTH = 100;
export const MAX_ARMOR = 100;
export const HITGROUP = { None: 0, Head: 1, Chest: 2, Stomach: 3, Legs: 4 } as const;
export type HitGroup = (typeof HITGROUP)[keyof typeof HITGROUP];
/** Damage multipliers per hit group (head uses WeaponDef.headMul). */
export const HITGROUP_MUL: Record<number, number> = { 0: 1, 1: 4, 2: 1, 3: 1.25, 4: 0.75 };
/** Falling: damage starts above this landing speed (m/s) and scales linearly. */
export const FALL_DAMAGE_MIN_SPEED = 13;
export const FALL_DAMAGE_PER_MS = 9;

// --- Inventory slots -----------------------------------------------------------
export const SLOT = { Primary: 0, Secondary: 1, Melee: 2 } as const;
export const SLOT_COUNT = 3;

// --- Input buttons (UserCmd.buttons bitmask) -------------------------------------
export const BTN = {
  Forward: 1 << 0,
  Back: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Jump: 1 << 4,
  Crouch: 1 << 5,
  Walk: 1 << 6,
  Fire: 1 << 7,
  AltFire: 1 << 8,
  Reload: 1 << 9,
  Use: 1 << 10,
} as const;

// --- Teams -----------------------------------------------------------------------
export const TEAM = { Labo: 0, Audit: 1, Spectator: 2 } as const;
export type TeamId = 0 | 1 | 2;

// --- Remote entity flags (snapshot) ------------------------------------------------
export const PFLAG = {
  OnGround: 1 << 0,
  Reloading: 1 << 1,
  Zoomed: 1 << 2,
  Carrying: 1 << 3,
  Acting: 1 << 4,
  Protected: 1 << 5,
} as const;

// --- Player actions (server-authoritative, e.g. plant / defuse) -----------------------
export const ACTION = { None: 0, Plant: 1, Defuse: 2, Secure: 3 } as const;

// --- Server limits ---------------------------------------------------------------
export const LIMITS = {
  maxPlayersPerRoom: 16,
  maxBots: 15,
  maxRooms: 50,
  maxNameLength: 20,
  maxChatLength: 160,
  maxMessageBytes: 16 * 1024,
  /** Max buffered UserCmds per player (anti speed-hack / burst after lag spike). */
  maxCmdBacklog: 24,
} as const;
