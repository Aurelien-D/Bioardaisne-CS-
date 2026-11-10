/** Core data types shared by the simulation, the network protocol and the client. */
import type { Vec3 } from './math/vec3';
import type { TeamId } from './constants';
import type { WeaponId } from './weapons/defs';

export type { Vec3 } from './math/vec3';
export type { TeamId } from './constants';

export type GameModeId = 'tdm' | 'defuse' | 'secure';
export type MatchPhase = 'warmup' | 'freeze' | 'live' | 'post' | 'over';

/** One input sample = exactly one simulation tick (TICK_DT) for the player. */
export interface UserCmd {
  /** Monotonic sequence number chosen by the client (starts at 1). */
  seq: number;
  /** Bitmask of BTN.* */
  buttons: number;
  /** View angles in radians (see math/vec3.ts for conventions). */
  yaw: number;
  pitch: number;
  /** Requested weapon slot (SLOT.*), or -1 for "no change". */
  slot: number;
  /**
   * Server time (ms) at which the client was rendering remote players when this
   * command was sampled. Used by the server for lag compensation.
   */
  st: number;
}

export interface WeaponSlotState {
  id: WeaponId;
  clip: number;
  reserve: number;
}

/**
 * Complete, JSON-serialisable state of a player. This is exactly what
 * `stepPlayer` reads and mutates, on the server (authoritative) and on the client
 * (prediction). Anything that affects movement or shooting MUST live here so that
 * prediction and reconciliation stay consistent.
 */
export interface PlayerState {
  /** Feet position (centre of the hull's bottom face). */
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  onGround: boolean;
  /** 0 = standing … 1 = fully crouched (hull height is interpolated). */
  crouch: number;
  /** Movement speed multiplier after landing (1 = none), recovers over time. */
  landSlow: number;

  alive: boolean;
  health: number;
  armor: number;

  /** Inventory, indexed by SLOT.* ; null = empty slot. */
  slots: (WeaponSlotState | null)[];
  /** Index of the weapon in hands. */
  active: number;
  /** Seconds until the next shot is allowed. */
  fireCd: number;
  /** Seconds remaining on the current reload (0 = not reloading). */
  reload: number;
  /** Seconds remaining on the draw animation after a weapon switch (cannot fire). */
  draw: number;
  /** Recoil index: number of recent consecutive shots (float, decays when not firing). */
  shots: number;
  /** Seconds since the last shot (capped at 10). */
  sinceShot: number;
  /** View punch (recoil kick) in radians, added to the view angles for aiming and camera. */
  punchPitch: number;
  punchYaw: number;
  /** Extra dynamic inaccuracy (radians) accumulated by firing. */
  spread: number;
  /** Sniper zoom level: 0 = none, 1, 2. */
  zoom: number;
  /** Buttons of the previous command (edge detection for semi-auto fire, jump, zoom…). */
  prevButtons: number;

  /** Server-authoritative timed action (ACTION.*). While != 0 the player cannot move or shoot. */
  action: number;
  /** Progress of the action, 0..1. */
  actionT: number;
  /** Seconds of spawn protection left (server-authoritative; firing cancels it). */
  protect: number;
  /** Freeze time: the player can look around and switch weapons but not move or shoot (server-authoritative). */
  frozen: boolean;
}

/** Events produced by one `stepPlayer` call. Reused/cleared by the caller. */
export interface StepEvents {
  /** A shot was fired this tick. */
  fired: null | {
    weapon: WeaponId;
    /** Eye position the bullets start from. */
    origin: Vec3;
    /** One normalised direction per pellet (spread and recoil already applied). */
    dirs: Vec3[];
  };
  /** Trigger pulled on an empty clip (click). */
  dryFire: boolean;
  reloadStarted: boolean;
  reloadFinished: boolean;
  /** Weapon switch started (new active slot). */
  switched: boolean;
  jumped: boolean;
  /** Landed this tick with this downward impact speed (m/s), 0 otherwise. */
  landedSpeed: number;
  zoomChanged: boolean;
}

export interface RoomConfig {
  mapId: string;
  mode: GameModeId;
  /** Target number of players (humans + bots). Bots leave as humans join. 0 = no bots. */
  botFill: number;
  /** 0 = facile, 1 = normal, 2 = difficile, 3 = expert. */
  botDifficulty: number;
  /** Maximum number of human players. */
  maxPlayers: number;
  friendlyFire: boolean;
  /** Round duration in seconds. */
  roundTime: number;
  /** Rounds needed to win the match. */
  roundsToWin: number;
  /** TDM: team kills needed to win a round (0 = time only). */
  killLimit: number;
  /** TDM: seconds before respawn. */
  respawnDelay: number;
  /** Seconds of frozen "freeze time" at the start of each round. */
  freezeTime: number;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  mapId: 'de_labo_charleville',
  mode: 'tdm',
  botFill: 8,
  botDifficulty: 1,
  maxPlayers: 12,
  friendlyFire: false,
  roundTime: 240,
  roundsToWin: 2,
  killLimit: 25,
  respawnDelay: 3,
  freezeTime: 4,
};

/** Per-mode default overrides applied on top of DEFAULT_ROOM_CONFIG. */
export const MODE_DEFAULTS: Record<GameModeId, Partial<RoomConfig>> = {
  tdm: { roundTime: 240, roundsToWin: 2, killLimit: 25, freezeTime: 4 },
  defuse: { roundTime: 135, roundsToWin: 5, killLimit: 0, freezeTime: 6 },
  secure: { roundTime: 150, roundsToWin: 4, killLimit: 0, freezeTime: 6 },
};

export const MODE_INFO: Record<GameModeId, { name: string; description: string }> = {
  tdm: {
    name: 'Match à mort par équipe',
    description: 'Deux équipes, réapparition après élimination. La première équipe au quota d’éliminations valide la série.',
  },
  defuse: {
    name: 'Audit surprise (désamorçage)',
    description:
      'Les Auditeurs doivent déposer un écart critique sur un site A ou B. Le Labo doit lever l’écart avant la fin du délai. Pas de réapparition.',
  },
  secure: {
    name: 'Sécurisation du laboratoire',
    description:
      'Le Labo protège ses glacières d’échantillons. Les Auditeurs tentent de les saisir et de les extraire. Pas de réapparition.',
  },
};

/** Roster entry (scoreboard). */
export interface PlayerInfo {
  id: number;
  name: string;
  team: TeamId;
  bot: boolean;
  kills: number;
  deaths: number;
  /** Points (kills + objectives). */
  score: number;
  ping: number;
  alive: boolean;
}

// --- Objective state per mode ----------------------------------------------------

export interface TdmObjective {
  kind: 'tdm';
  /** Kills of each team in the current round. */
  kills: [number, number];
  killLimit: number;
}

export interface DefuseObjective {
  kind: 'defuse';
  /** Player id carrying the "écart critique" dossier, -1 if none. */
  carrier: number;
  /** Position of the dossier when lying on the ground. */
  dropped: Vec3 | null;
  planted: null | { site: string; pos: Vec3; explodeAt: number };
  defused: boolean;
  exploded: boolean;
}

export interface SampleState {
  id: number;
  state: 'home' | 'carried' | 'dropped' | 'extracted';
  pos: Vec3;
  /** Carrier player id or -1. */
  carrier: number;
}

export interface SecureObjective {
  kind: 'secure';
  samples: SampleState[];
  /** Number of samples the attackers must extract to win the round. */
  needed: number;
  extracted: number;
}

export type ObjectiveState = TdmObjective | DefuseObjective | SecureObjective;

export interface MatchState {
  mapId: string;
  mode: GameModeId;
  phase: MatchPhase;
  /** Server time (ms) at which the current phase ends; 0 = no timer. */
  phaseEnd: number;
  /** 1-based round number. */
  round: number;
  /** Rounds won by each team. */
  score: [number, number];
  roundsToWin: number;
  /** Winner of the last finished round: 0, 1, or -1 for a draw / none yet. */
  lastWinner: number;
  /** Machine-readable reason of the last round end (e.g. 'kills', 'time', 'elimination', 'defused', 'exploded', 'extracted'). */
  lastReason: string;
  obj: ObjectiveState;
}
