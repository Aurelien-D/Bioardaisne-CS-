/**
 * Bot AI. A bot is a pure "input generator": each tick it looks at the world
 * through BotEnv and returns a UserCmd that the Room feeds to stepPlayer exactly
 * like a human player's input. Bots therefore obey the same movement, recoil and
 * line-of-sight rules as humans.
 *
 * CONTRACT FILE — see docs/ARCHITECTURE.md §Bots.
 */
import type { Vec3 } from '../math/vec3';
import type { MapData } from '../maps/types';
import type { NavGrid } from '../nav/navgrid';
import type { CollisionWorld } from '../physics/world';
import type { MatchPhase, PlayerState, TeamId, UserCmd } from '../types';

export interface BotPlayerView {
  id: number;
  team: TeamId;
  alive: boolean;
  state: Readonly<PlayerState>;
}

/** A place the mode wants a team's bots to go to. */
export interface BotGoal {
  kind: 'roam' | 'attack' | 'defend' | 'objective';
  pos: Vec3;
  /** Relative priority (higher = more attractive). */
  weight: number;
  /** Hold BTN.Use once within `radius` of `pos` (plant / defuse / secure). */
  use?: boolean;
  radius?: number;
}

export interface BotEnv {
  world: CollisionWorld;
  nav: NavGrid;
  map: MapData;
  /** Seconds since the room was created (monotonic simulation time). */
  time: number;
  phase: MatchPhase;
  friendlyFire: boolean;
  /** Every player in the room (including the bot itself and dead players). */
  players: readonly BotPlayerView[];
  /** Mode-specific goals for a team (may be empty: the bot then roams / hunts). */
  goals(team: TeamId, botId: number): BotGoal[];
}

export interface Bot {
  readonly id: number;
  /** Called every tick while alive. `seq` is the sequence number to put in the returned cmd. */
  think(self: BotPlayerView, env: BotEnv, seq: number): UserCmd;
  /** Called when the bot (re)spawns. */
  onSpawn(): void;
  /** Called when the bot takes damage from `from` (attacker position). */
  onHurt(attackerId: number, from: Vec3): void;
  /** Called when a gunshot is fired at `pos` by a player of `team` (hearing). */
  onSound(pos: Vec3, team: TeamId): void;
}

/**
 * Create a bot brain.
 * @param difficulty 0 = facile, 1 = normal, 2 = difficile, 3 = expert
 * @param seed       deterministic personality / randomness seed
 */
export function createBot(id: number, difficulty: number, seed: number): Bot {
  void id, difficulty, seed;
  throw new Error('createBot: not implemented');
}
