/**
 * Multiplayer without a game server (static hosting such as GitHub Pages): one player's
 * browser hosts the authoritative Room and the others connect to it directly over WebRTC
 * data channels.
 *
 *  - P2PHost : runs the Room in this tab (like solo play) and accepts guests;
 *  - P2PGuest: connects to a host from its room code.
 *
 * Peers find each other through a PeerJS broker (the public PeerJS cloud by default): it
 * only relays the connection offers; game traffic then flows between the players' browsers.
 * The room code is the host's address on the broker. If the host closes its tab, the match
 * ends for everyone (there is no host migration).
 *
 * `?peer=host:port` in the page address selects another broker (self-hosted, tests).
 */
import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { LIMITS, PROTOCOL_VERSION, TICK_RATE } from '../../shared/constants';
import { normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type ClientMsg, type Connection, type ErrorCode, type ServerMsg } from '../../shared/protocol';
import { Room, sanitizeConfig } from '../../shared/sim/room';
import type { RoomConfig } from '../../shared/types';

/**
 * Keep-alive sent by guests every two seconds, swallowed by the host's transport: a guest that
 * is busy loading the map sends no game message for a while and must not be taken for gone.
 */
const KEEP_ALIVE = 'k';
/** A guest silent for this long (closed tab, lost network) is removed from the match. */
const GUEST_TIMEOUT_MS = 30000;
/**
 * A host silent for this long is considered gone (it normally sends 32 snapshots a second;
 * the margin covers a host busy loading a map). A closed tab is noticed at once when the
 * page had time to say goodbye, otherwise only through this watchdog.
 */
const HOST_TIMEOUT_MS = 20000;

/** Address of a room on the broker. */
const peerId = (code: string): string => `bioardaisne-strike-${code}`;

function peerOptions(): PeerOptions {
  const custom = new URLSearchParams(location.search).get('peer');
  if (custom) {
    const [host, port] = custom.split(':');
    return { host: host || 'localhost', port: Number(port) || 9000, path: '/', secure: false, debug: 0 };
  }
  return { debug: 0 };
}

function newCode(): string {
  let c = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  return c;
}

/**
 * Timer that keeps firing when the tab is in the background: page timers are throttled to
 * one per second there, which would freeze the match for every guest. Falls back to a plain
 * interval where workers are not allowed.
 */
function startTicker(fn: () => void, ms: number): () => void {
  try {
    const src = `var t=setInterval(function(){postMessage(0)},${ms});onmessage=function(){clearInterval(t);close()};`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    let fallback = 0;
    worker.onmessage = fn;
    worker.onerror = () => {
      if (!fallback) fallback = window.setInterval(fn, ms);
    };
    return () => {
      worker.postMessage(0);
      worker.terminate();
      URL.revokeObjectURL(url);
      if (fallback) window.clearInterval(fallback);
    };
  } catch {
    const id = window.setInterval(fn, ms);
    return () => window.clearInterval(id);
  }
}

interface Guest {
  conn: DataConnection;
  /** Player id in the Room, -1 until the hello has been accepted. */
  id: number;
  /** Message budget (token bucket) against flooding. */
  tokens: number;
  lastSeen: number;
}

/** The match lives in this tab; guests join it with the room code. */
export class P2PHost implements Connection {
  readonly local = false;
  onMessage: ((msg: ServerMsg) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private room!: Room;
  private peer!: Peer;
  private id = -1;
  private readonly guests = new Map<number, Guest>();
  private readonly pending = new Set<Guest>();
  /** Recipient of the messages the Room sends while a player is being added (its id is not known yet). */
  private joining: Guest | 'self' | null = null;
  private stopTicker: (() => void) | null = null;
  private last = performance.now();
  private acc = 0;
  private housekeeping = 0;
  private closed = false;
  private tries = 0;

  private readonly onPageHide = (): void => this.shutdown();

  constructor(
    private readonly config: Partial<RoomConfig>,
    private readonly name: string,
  ) {
    // Closing or reloading the tab ends the match: tell the guests right away.
    window.addEventListener('pagehide', this.onPageHide);
    this.open();
  }

  private open(): void {
    const code = newCode();
    this.room = new Room(code, sanitizeConfig(this.config), { now: () => performance.now(), send: (id, msg) => this.route(id, msg) }, (Math.random() * 0x7fffffff) | 0);
    const peer = new Peer(peerId(code), peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      if (this.closed || this.id >= 0) return;
      this.joining = 'self';
      try {
        this.id = this.room.addClient(this.name);
      } finally {
        this.joining = null;
      }
      this.last = performance.now();
      this.stopTicker = startTicker(() => this.pump(), 5);
    });
    peer.on('connection', (conn) => this.accept(conn));
    // Broker connection lost: the guests already in keep playing; try to become reachable again.
    peer.on('disconnected', () => {
      if (!this.closed && !peer.destroyed) window.setTimeout(() => !this.closed && !peer.destroyed && peer.reconnect(), 2000);
    });
    peer.on('error', (err) => {
      if (this.closed || this.id >= 0) return; // once the match runs, broker errors are not fatal
      if (err.type === 'unavailable-id' && this.tries++ < 4) {
        // Room code already taken on the broker: draw another one.
        peer.destroy();
        this.open();
        return;
      }
      this.fail('Service de mise en relation injoignable : impossible de créer le salon. Vérifiez la connexion Internet ou le pare-feu.');
    });
  }

  /** Room → player. */
  private route(id: number, msg: ServerMsg): void {
    const guest = this.guests.get(id);
    if (guest) return this.sendTo(guest, msg);
    if (id === this.id || this.joining === 'self') {
      // JSON round-trip: same isolation as the network (no shared mutable state).
      const copy = JSON.parse(JSON.stringify(msg)) as ServerMsg;
      queueMicrotask(() => this.onMessage?.(copy));
      return;
    }
    if (this.joining) this.sendTo(this.joining, msg);
  }

  private sendTo(guest: Guest, msg: ServerMsg): void {
    if (!guest.conn.open) return;
    try {
      guest.conn.send(JSON.stringify(msg));
    } catch {
      /* channel closing: the close handler removes the guest */
    }
  }

  private reject(guest: Guest, code: ErrorCode, msg: string): void {
    this.sendTo(guest, { t: 'error', code, msg });
    window.setTimeout(() => guest.conn.close(), 300);
  }

  private accept(conn: DataConnection): void {
    const guest: Guest = { conn, id: -1, tokens: 300, lastSeen: performance.now() };
    this.pending.add(guest);
    conn.on('data', (data) => {
      if (typeof data !== 'string' || data.length > LIMITS.maxMessageBytes) return;
      if (--guest.tokens < 0) return;
      guest.lastSeen = performance.now();
      if (data === KEEP_ALIVE) return;
      let msg: ClientMsg;
      try {
        msg = JSON.parse(data) as ClientMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (guest.id >= 0) {
        this.room.handleMessage(guest.id, msg);
        return;
      }
      if (msg.t !== 'hello') return;
      if (msg.v !== PROTOCOL_VERSION) return this.reject(guest, 'version', "Version du jeu différente de celle de l'hôte : rechargez la page des deux côtés.");
      if (this.id < 0) return this.reject(guest, 'room_not_found', 'Salon introuvable : vérifiez le code.');
      if (this.room.humanCount >= this.room.config.maxPlayers) return this.reject(guest, 'room_full', 'Ce salon est complet.');
      // addClient() sends the welcome synchronously, before the new id is registered.
      this.joining = guest;
      try {
        guest.id = this.room.addClient(typeof msg.name === 'string' ? msg.name : '');
      } finally {
        this.joining = null;
      }
      this.pending.delete(guest);
      this.guests.set(guest.id, guest);
    });
    const gone = (): void => this.drop(guest);
    conn.on('close', gone);
    conn.on('error', gone);
  }

  private drop(guest: Guest): void {
    this.pending.delete(guest);
    if (guest.id >= 0 && this.guests.get(guest.id) === guest) {
      this.guests.delete(guest.id);
      this.room.removeClient(guest.id);
    }
    guest.id = -1;
    try {
      guest.conn.close();
    } catch {
      /* already closed */
    }
  }

  private pump(): void {
    if (this.closed) return;
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
    // Once a second: refill the message budgets, drop guests that went silent (closed tab, lost network).
    if (now - this.housekeeping < 1000) return;
    this.housekeeping = now;
    for (const g of [...this.guests.values(), ...this.pending]) {
      g.tokens = Math.min(400, g.tokens + 200);
      if (now - g.lastSeen > GUEST_TIMEOUT_MS) this.drop(g);
    }
  }

  private fail(reason: string): void {
    if (this.closed) return;
    this.shutdown();
    this.onClose?.(reason);
  }

  private shutdown(): void {
    this.closed = true;
    window.removeEventListener('pagehide', this.onPageHide);
    this.stopTicker?.();
    this.stopTicker = null;
    for (const g of [...this.guests.values(), ...this.pending]) {
      try {
        g.conn.close();
      } catch {
        /* already closed */
      }
    }
    this.guests.clear();
    this.pending.clear();
    try {
      this.peer.destroy();
    } catch {
      /* already destroyed */
    }
  }

  send(msg: ClientMsg): void {
    if (this.id >= 0 && !this.closed) this.room.handleMessage(this.id, msg);
  }

  close(): void {
    this.shutdown();
  }
}

/** Joins a match hosted in another player's browser. */
export class P2PGuest implements Connection {
  readonly local = false;
  onMessage: ((msg: ServerMsg) => void) | null = null;
  onClose: ((reason: string) => void) | null = null;
  private readonly peer: Peer;
  private conn: DataConnection | null = null;
  private closed = false;
  private welcomed = false;
  private readonly timeout: number;
  private keepAlive = 0;
  private lastHeard = 0;
  private readonly onPageHide = (): void => this.close();

  constructor(code: string, name: string) {
    const target = peerId(normalizeRoomCode(code));
    window.addEventListener('pagehide', this.onPageHide);
    this.peer = new Peer(peerOptions());
    this.timeout = window.setTimeout(() => {
      if (!this.welcomed) this.finish("Connexion à l'hôte impossible (pare-feu ou réseau d'entreprise ?). Réessayez, ou essayez depuis un autre réseau.");
    }, 25000);
    this.peer.on('open', () => {
      if (this.closed) return;
      const conn = this.peer.connect(target, { reliable: true, serialization: 'raw' });
      this.conn = conn;
      conn.on('open', () => {
        this.send({ t: 'hello', v: PROTOCOL_VERSION, name, room: code });
        this.lastHeard = performance.now();
        this.keepAlive = window.setInterval(() => {
          if (this.closed) return;
          if (conn.open) conn.send(KEEP_ALIVE);
          if (this.welcomed && performance.now() - this.lastHeard > HOST_TIMEOUT_MS) this.finish("L'hôte ne répond plus : la partie est terminée.");
        }, 2000);
      });
      conn.on('data', (data) => {
        if (typeof data !== 'string') return;
        this.lastHeard = performance.now();
        let msg: ServerMsg;
        try {
          msg = JSON.parse(data) as ServerMsg;
        } catch {
          return;
        }
        if (msg.t === 'welcome') this.welcomed = true;
        this.onMessage?.(msg);
      });
      conn.on('close', () => this.finish(this.welcomed ? "La partie est terminée : l'hôte a quitté ou la connexion a été perdue." : 'Connexion refusée par le salon.'));
      conn.on('error', () => this.finish("Connexion à l'hôte perdue."));
    });
    this.peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') return this.finish("Salon introuvable : vérifiez le code. L'hôte doit garder sa page ouverte.");
      if (!this.welcomed) this.finish('Service de mise en relation injoignable. Vérifiez la connexion Internet ou le pare-feu.');
    });
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.close();
    this.onClose?.(reason);
  }

  send(msg: ClientMsg): void {
    const conn = this.conn;
    if (!conn || !conn.open || this.closed) return;
    try {
      conn.send(JSON.stringify(msg));
    } catch {
      /* channel closing */
    }
  }

  close(): void {
    this.closed = true;
    window.removeEventListener('pagehide', this.onPageHide);
    window.clearTimeout(this.timeout);
    window.clearInterval(this.keepAlive);
    try {
      this.conn?.close();
    } catch {
      /* already closed */
    }
    try {
      this.peer.destroy();
    } catch {
      /* already destroyed */
    }
  }
}
