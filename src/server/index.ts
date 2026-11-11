/**
 * BioArd'Aisne Strike — game server.
 * One Node process: serves the built client (dist/client) over HTTP and hosts
 * private rooms over WebSocket (/ws). The Room simulation is authoritative.
 *
 * Environment: PORT (default 8080), HOST (default 0.0.0.0), PUBLIC_DIR.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { LIMITS, PROTOCOL_VERSION, TICK_RATE } from '../shared/constants';
import { normalizeRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type ClientMsg, type ErrorCode, type ServerMsg } from '../shared/protocol';
import { Room, sanitizeConfig } from '../shared/sim/room';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(process.env.PUBLIC_DIR ?? [join(here, '../client'), join(here, '../../dist/client')].find((d) => existsSync(d)) ?? join(here, '../client'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

interface Client {
  ws: WebSocket;
  room: RoomEntry | null;
  id: number;
  alive: boolean;
  /** Message budget (token bucket) against flooding. */
  tokens: number;
}

interface RoomEntry {
  room: Room;
  clients: Map<number, Client>;
  emptySince: number;
  joining: WebSocket | null;
}

const rooms = new Map<string, RoomEntry>();
const started = Date.now();
const now = (): number => performance.now();

function send(ws: WebSocket, msg: ServerMsg): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function fail(ws: WebSocket, code: ErrorCode, msg: string): void {
  send(ws, { t: 'error', code, msg });
  ws.close();
}

function newCode(): string {
  for (;;) {
    let c = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
}

function createRoom(config: unknown): RoomEntry {
  const code = newCode();
  const entry: RoomEntry = { room: null as unknown as Room, clients: new Map(), emptySince: 0, joining: null };
  entry.room = new Room(
    code,
    sanitizeConfig(config as never),
    {
      now,
      send: (id, msg) => {
        const ws = entry.clients.get(id)?.ws ?? entry.joining;
        if (ws) send(ws, msg);
      },
    },
    (Math.random() * 0x7fffffff) | 0,
  );
  rooms.set(code, entry);
  console.log(`[salon ${code}] créé (${entry.room.config.mapId}, ${entry.room.config.mode}) — ${rooms.size} salon(s)`);
  return entry;
}

function onHello(c: Client, msg: Extract<ClientMsg, { t: 'hello' }>): void {
  if (msg.v !== PROTOCOL_VERSION) return fail(c.ws, 'version', 'Version du jeu différente de celle du serveur : rechargez la page.');
  let entry: RoomEntry | undefined;
  if (typeof msg.room === 'string' && msg.room) {
    entry = rooms.get(normalizeRoomCode(msg.room));
    if (!entry) return fail(c.ws, 'room_not_found', 'Salon introuvable : vérifiez le code.');
    if (entry.room.humanCount >= entry.room.config.maxPlayers) return fail(c.ws, 'room_full', 'Ce salon est complet.');
  } else {
    if (rooms.size >= LIMITS.maxRooms) return fail(c.ws, 'server_full', 'Le serveur est complet, réessayez plus tard.');
    entry = createRoom(msg.create);
  }
  c.room = entry;
  // addClient() sends S_Welcome synchronously, before the new id is registered:
  // messages for an unknown id during this call belong to the joining socket.
  entry.joining = c.ws;
  try {
    c.id = entry.room.addClient(typeof msg.name === 'string' ? msg.name : '');
  } finally {
    entry.joining = null;
  }
  entry.clients.set(c.id, c);
  entry.emptySince = 0;
}

function onMessage(c: Client, data: string): void {
  if (data.length > LIMITS.maxMessageBytes) return;
  if (--c.tokens < 0) return;
  let msg: ClientMsg;
  try {
    msg = JSON.parse(data) as ClientMsg;
  } catch {
    return;
  }
  if (!msg || typeof msg !== 'object') return;
  if (!c.room) {
    if (msg.t === 'hello') onHello(c, msg);
    return;
  }
  c.room.room.handleMessage(c.id, msg);
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (url.pathname === '/api/status') {
    let players = 0;
    for (const r of rooms.values()) players += r.room.humanCount;
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ rooms: rooms.size, players, uptime: Math.round((Date.now() - started) / 1000) }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  let file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) file = join(PUBLIC_DIR, 'index.html'); // single-page app
  if (!existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Client non compilé : lancez "npm run build".');
    return;
  }
  const ext = extname(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
}

const server = createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: LIMITS.maxMessageBytes });

wss.on('connection', (ws) => {
  const c: Client = { ws, room: null, id: -1, alive: true, tokens: 300 };
  const helloTimer = setTimeout(() => {
    if (!c.room) ws.close();
  }, 10000);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) onMessage(c, data.toString());
  });
  ws.on('pong', () => {
    c.alive = true;
  });
  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (c.room && c.id >= 0) {
      c.room.clients.delete(c.id);
      c.room.room.removeClient(c.id);
      if (c.room.room.humanCount === 0) c.room.emptySince = Date.now();
    }
  });
  ws.on('error', () => ws.close());
});

// Simulation loop: fixed 64 Hz ticks with catch-up.
const STEP = 1000 / TICK_RATE;
let last = now();
let acc = 0;
setInterval(() => {
  const t = now();
  acc += Math.min(250, t - last);
  last = t;
  let n = 0;
  while (acc >= STEP && n++ < 8) {
    acc -= STEP;
    for (const r of rooms.values()) {
      if (r.room.humanCount === 0) continue;
      try {
        r.room.tick();
      } catch (e) {
        console.error(`[salon ${r.room.code}] erreur de simulation`, e);
      }
    }
  }
}, 4);

// Housekeeping: refill message budgets, drop dead sockets and empty rooms.
setInterval(() => {
  for (const [code, r] of rooms) {
    for (const c of r.clients.values()) {
      c.tokens = Math.min(400, c.tokens + 200);
    }
    if (r.room.humanCount === 0 && r.emptySince && Date.now() - r.emptySince > 120000) {
      rooms.delete(code);
      console.log(`[salon ${code}] fermé (vide) — ${rooms.size} salon(s)`);
    }
  }
}, 1000);

setInterval(() => {
  for (const r of rooms.values()) {
    for (const c of r.clients.values()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }
}, 30000);

server.listen(PORT, HOST, () => {
  console.log(`BioArd'Aisne Strike — serveur prêt sur http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (fichiers : ${PUBLIC_DIR})`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
