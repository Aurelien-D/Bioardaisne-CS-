/**
 * Network protocol (JSON over WebSocket, or in-memory loopback for solo play).
 * The server is authoritative for damage, kills, scores and round results.
 */
import type { MatchState, PlayerInfo, PlayerState, RoomConfig, UserCmd } from './types';
import type { WeaponId } from './weapons/defs';

// ---------------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------------

/** First message after connecting. Either join an existing room (`room`) or create one (`create`). */
export interface C_Hello {
  t: 'hello';
  v: number;
  name: string;
  /** Room code to join (case-insensitive). */
  room?: string;
  /** Create a new private room with this configuration (missing fields use defaults). */
  create?: Partial<RoomConfig>;
}

/** Wire form of a UserCmd: [seq, buttons, yaw, pitch, slot, st]. */
export type CmdTuple = [number, number, number, number, number, number];

/** One or more input commands, oldest first. */
export interface C_Cmd {
  t: 'c';
  c: CmdTuple[];
}

/** Choose a team: 0, 1, 2 (spectator) or -1 for auto-assign. */
export interface C_Team {
  t: 'team';
  team: number;
}

/** Choose the loadout used at the next (re)spawn (applied immediately during freeze time). */
export interface C_Loadout {
  t: 'loadout';
  primary: WeaponId;
  secondary: WeaponId;
}

export interface C_Chat {
  t: 'chat';
  text: string;
  /** Team-only message. */
  team: boolean;
}

/** Clock sync / latency probe. `c` = client timestamp (ms). */
export interface C_Ping {
  t: 'ping';
  c: number;
  /** Last round-trip time measured by the client (ms), shown on the scoreboard. */
  rtt?: number;
}

/** Host only: change room settings; `restart` restarts the match (required to change map/mode). */
export interface C_Config {
  t: 'config';
  patch: Partial<RoomConfig>;
  restart: boolean;
}

export type ClientMsg = C_Hello | C_Cmd | C_Team | C_Loadout | C_Chat | C_Ping | C_Config;

// ---------------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------------

export interface S_Welcome {
  t: 'welcome';
  /** Your player id. */
  id: number;
  /** Room code (share it, or the URL `?room=CODE`). */
  room: string;
  config: RoomConfig;
  hostId: number;
  /** Server clock (ms) at the time of sending. */
  time: number;
  players: PlayerInfo[];
  match: MatchState;
}

export type ErrorCode = 'version' | 'room_not_found' | 'room_full' | 'server_full' | 'bad_request' | 'kicked';

export interface S_Error {
  t: 'error';
  code: ErrorCode;
  msg: string;
}

/**
 * Compact state of another player:
 * [id, x, y, z, yaw, pitch, crouch, flags (PFLAG.*), weaponIndex, health]
 */
export type RemoteTuple = [number, number, number, number, number, number, number, number, number, number];

export type GameEvent =
  /** A player other than the receiver fired. `d` = flat pellet directions (x,y,z…), `h` = flat player hits (victimId,x,y,z…). */
  | { e: 'shot'; id: number; w: number; o: [number, number, number]; d: number[]; h?: number[] }
  /** Sent to the attacker only: confirmed damage. */
  | { e: 'hit'; victim: number; dmg: number; hg: number; kill: boolean }
  /** Sent to the victim only. `from` = attacker position. */
  | { e: 'hurt'; attacker: number; dmg: number; hg: number; from: [number, number, number] }
  /** Sent to everyone. `w` = weapon index (-1 = world/fall/objective), `hs` = headshot. */
  | { e: 'kill'; killer: number; victim: number; w: number; hs: boolean }
  /** A player (re)spawned. */
  | { e: 'spawn'; id: number }
  /** Announcer line, key of identity.ANNOUNCE; optional player id for `{name}`. */
  | { e: 'announce'; key: string; id?: number }
  /** Mode-specific objective event (e.g. 'bomb_planted', 'sample_taken'), with optional position / player. */
  | { e: 'obj'; kind: string; id?: number; pos?: [number, number, number] };

export interface S_Snapshot {
  t: 's';
  /** Server tick number. */
  n: number;
  /** Server clock (ms) of this tick. */
  time: number;
  /** Sequence number of the last UserCmd processed for the receiver. */
  ack: number;
  /** Receiver's full authoritative state, or null when not in the world (spectator / dead). */
  you: PlayerState | null;
  /** All other players currently alive. */
  p: RemoteTuple[];
  /** Events since the previous snapshot. */
  ev: GameEvent[];
  /** When dead in a respawn mode: server clock (ms) of the next respawn. */
  rs?: number;
}

export interface S_Roster {
  t: 'roster';
  players: PlayerInfo[];
  hostId: number;
}

export interface S_Match {
  t: 'match';
  match: MatchState;
  /** Present when the room configuration changed. */
  config?: RoomConfig;
}

export interface S_Chat {
  t: 'chat';
  /** Sender id, or -1 for server messages. */
  from: number;
  name: string;
  team: number;
  text: string;
  teamOnly: boolean;
}

export interface S_Pong {
  t: 'pong';
  c: number;
  /** Server clock (ms). */
  s: number;
}

export type ServerMsg = S_Welcome | S_Error | S_Snapshot | S_Roster | S_Match | S_Chat | S_Pong;

// ---------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------

export const cmdToTuple = (c: UserCmd): CmdTuple => [c.seq, c.buttons, c.yaw, c.pitch, c.slot, c.st];
export const tupleToCmd = (t: CmdTuple): UserCmd => ({
  seq: t[0],
  buttons: t[1],
  yaw: t[2],
  pitch: t[3],
  slot: t[4],
  st: t[5],
});

/** Room codes: 5 unambiguous characters, e.g. "K7M2P". */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 5;
export const normalizeRoomCode = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);

/**
 * Transport abstraction used by the client: a WebSocket connection to a real
 * server, or an in-memory loopback to a Room running in the browser (solo play).
 */
export interface Connection {
  send(msg: ClientMsg): void;
  /** Set by the client game. */
  onMessage: ((msg: ServerMsg) => void) | null;
  onClose: ((reason: string) => void) | null;
  close(): void;
  /** True for the in-browser loopback (solo). */
  readonly local: boolean;
}
