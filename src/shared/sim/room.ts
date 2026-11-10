/**
 * Room: the authoritative game simulation for one match (players, bots, weapons,
 * damage, rounds, objectives). It is environment-agnostic: the Node server hosts
 * many Rooms behind WebSockets, and the browser hosts one Room for solo play
 * through a loopback connection.
 *
 * CONTRACT FILE — see docs/ARCHITECTURE.md §Room.
 */
import type { ClientMsg, ServerMsg } from '../protocol';
import type { RoomConfig } from '../types';

export interface RoomHost {
  /** Deliver a message to a connected client. */
  send(clientId: number, msg: ServerMsg): void;
  /** Monotonic clock in milliseconds (the "server time" used in snapshots). */
  now(): number;
}

export class Room {
  readonly code: string;

  /**
   * @param code   room code shown to players
   * @param config room configuration (already validated with `sanitizeConfig`)
   * @param host   message delivery + clock
   * @param seed   RNG seed (spawn selection, bots…)
   */
  constructor(code: string, config: RoomConfig, host: RoomHost, seed = 1) {
    this.code = code;
    void config, host, seed;
    throw new Error('Room: not implemented');
  }

  get config(): RoomConfig {
    throw new Error('not implemented');
  }

  /** Number of connected human players. */
  get humanCount(): number {
    throw new Error('not implemented');
  }

  /**
   * Register a human client. Returns its player id and immediately sends
   * S_Welcome (then roster/match updates to the others). The first client is the host.
   */
  addClient(name: string): number {
    void name;
    throw new Error('not implemented');
  }

  /** Remove a client (disconnect). Handles host migration and bot back-fill. */
  removeClient(id: number): void {
    void id;
    throw new Error('not implemented');
  }

  /** Handle a message from a client (never throws on malformed input). */
  handleMessage(id: number, msg: ClientMsg): void {
    void id, msg;
    throw new Error('not implemented');
  }

  /**
   * Advance the simulation by exactly one tick (TICK_DT). The caller is
   * responsible for calling it TICK_RATE times per second (with catch-up).
   */
  tick(): void {
    throw new Error('not implemented');
  }
}

/** Clamp / validate a (possibly partial, untrusted) config into a full RoomConfig. */
export function sanitizeConfig(partial: Partial<RoomConfig> | undefined): RoomConfig {
  void partial;
  throw new Error('sanitizeConfig: not implemented');
}
