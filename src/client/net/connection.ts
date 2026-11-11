/**
 * Transports between the client game and a Room:
 *  - WsConnection: WebSocket to the game server (multiplayer);
 *  - LocalConnection: a Room running in this browser tab (solo play against bots).
 */
import { PROTOCOL_VERSION, TICK_RATE } from '../../shared/constants';
import type { ClientMsg, Connection, ServerMsg } from '../../shared/protocol';
import { Room, sanitizeConfig } from '../../shared/sim/room';
import type { RoomConfig } from '../../shared/types';

export interface HelloOptions {
  name: string;
  room?: string;
  create?: Partial<RoomConfig>;
}

export class WsConnection implements Connection {
  readonly local = false;
  onMessage: ((msg: ServerMsg) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private ws: WebSocket;
  private closed = false;

  constructor(url: string, hello: HelloOptions) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.send({ t: 'hello', v: PROTOCOL_VERSION, name: hello.name, room: hello.room, create: hello.create });
    this.ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data) as ServerMsg;
      } catch {
        return;
      }
      this.onMessage?.(msg);
    };
    this.ws.onclose = () => this.finish('Connexion au serveur perdue.');
    this.ws.onerror = () => this.finish('Impossible de joindre le serveur de jeu.');
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.(reason);
  }

  send(msg: ClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.closed = true;
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
  }
}

/** Solo play: the authoritative Room lives in the page and is ticked by a timer. */
export class LocalConnection implements Connection {
  readonly local = true;
  onMessage: ((msg: ServerMsg) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private room: Room;
  private id = -1;
  private timer: number;
  private last = performance.now();
  private acc = 0;

  constructor(config: Partial<RoomConfig>, name: string) {
    this.room = new Room(
      'SOLO',
      sanitizeConfig(config),
      {
        now: () => performance.now(),
        // JSON round-trip: same isolation as the network (no shared mutable state).
        send: (_id, msg) => {
          const copy = JSON.parse(JSON.stringify(msg)) as ServerMsg;
          queueMicrotask(() => this.onMessage?.(copy));
        },
      },
      (Math.random() * 0x7fffffff) | 0,
    );
    // Join on the next task so the caller can attach onMessage first.
    setTimeout(() => {
      this.id = this.room.addClient(name);
    }, 0);
    this.timer = window.setInterval(() => this.pump(), 5);
  }

  private pump(): void {
    const now = performance.now();
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    const step = 1000 / TICK_RATE;
    let n = 0;
    while (this.acc >= step && n++ < 8) {
      this.acc -= step;
      this.room.tick();
    }
    if (this.acc > step * 8) this.acc = 0;
  }

  send(msg: ClientMsg): void {
    if (this.id >= 0) this.room.handleMessage(this.id, msg);
  }

  close(): void {
    window.clearInterval(this.timer);
    if (this.id >= 0) this.room.removeClient(this.id);
    this.id = -1;
  }
}
