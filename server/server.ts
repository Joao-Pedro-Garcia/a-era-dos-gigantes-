/**
 * Era dos Gigantes co-op server: rooms with invite codes, relay of player states, host
 * snapshots (animals, clock) and requests (hits, building, chat), reconnection with a
 * session token, host migration, and the checks a relay can make without simulating the
 * world (rates, sizes, movement speed, hit range and damage, host-only messages).
 *
 * Runs on Node 22+ directly from TypeScript (type stripping): `node server/server.ts`.
 * Environment: PORT (8787), HOST (0.0.0.0), STATIC_DIR (serve the built game, e.g. dist),
 * ALLOWED_ORIGINS (comma-separated; empty = any), MAX_ROOMS (200), MAX_CONN_PER_IP (16).
 * See docs/multiplayer.md.
 */
import { randomBytes, randomInt } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  ANIMALS_HZ,
  MAX_HITS_PER_SEC,
  MAX_HIT_RANGE,
  MAX_MESSAGE_BYTES,
  MAX_PLAYERS,
  MAX_STRIKES,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  RateLimiter,
  STATE_HZ,
  makeCode,
  parseClientMsg,
  plausibleMove,
  type ClientMsg,
  type ErrorCode,
  type PeerInfo,
  type PlayerState,
  type ServerMsg,
} from '../src/net/protocol.ts';

export interface ServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
  allowedOrigins?: string[];
  maxRooms?: number;
  maxConnPerIp?: number;
  /** Clock (ms), for tests. */
  now?: () => number;
  log?: (msg: string) => void;
}

interface Player {
  id: string;
  name: string;
  token: string;
  room: Room;
  ws: WebSocket | null;
  ip: string;
  state: PlayerState | null;
  stateAt: number;
  dirty: boolean;
  strikes: number;
  limiter: RateLimiter;
  hits: RateLimiter;
  disconnectedAt: number;
  joinedAt: number;
}

interface Room {
  code: string;
  seed: number;
  players: Map<string, Player>;
  hostId: string;
  createdAt: number;
  lastAnimalsAt: number;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

export function startServer(opts: ServerOptions = {}): Promise<{ port: number; close: () => Promise<void>; stats: () => { rooms: number; players: number } }> {
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? ((m: string) => console.log(`[${new Date().toISOString()}] ${m}`));
  const maxRooms = opts.maxRooms ?? 200;
  const maxConnPerIp = opts.maxConnPerIp ?? 16;
  const origins = (opts.allowedOrigins ?? []).filter(Boolean);
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;
  const rooms = new Map<string, Room>();
  const byToken = new Map<string, Player>();
  const connPerIp = new Map<string, number>();
  const started = now();

  const send = (p: Player, m: ServerMsg): void => {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(m));
  };
  const sendWs = (ws: WebSocket, m: ServerMsg): void => {
    if (ws.readyState === 1) ws.send(JSON.stringify(m));
  };
  const broadcast = (room: Room, m: ServerMsg, except?: Player): void => {
    const text = JSON.stringify(m);
    for (const q of room.players.values()) if (q !== except && q.ws && q.ws.readyState === 1) q.ws.send(text);
  };
  const peerInfo = (p: Player): PeerInfo => ({ id: p.id, name: p.name, host: p.room.hostId === p.id, state: p.state, connected: !!p.ws });
  const newId = (): string => randomBytes(6).toString('base64url');

  function newPlayer(room: Room, name: string, ws: WebSocket, ip: string): Player {
    const t = now();
    const p: Player = { id: newId(), name, token: randomBytes(24).toString('base64url'), room, ws, ip, state: null, stateAt: t, dirty: false, strikes: 0, limiter: new RateLimiter(undefined, undefined, t), hits: new RateLimiter(MAX_HITS_PER_SEC, MAX_HITS_PER_SEC, t), disconnectedAt: 0, joinedAt: t };
    room.players.set(p.id, p);
    byToken.set(p.token, p);
    return p;
  }

  function welcome(p: Player): void {
    send(p, { t: 'welcome', you: p.id, token: p.token, code: p.room.code, seed: p.room.seed, host: p.room.hostId === p.id, peers: [...p.room.players.values()].filter((q) => q !== p).map(peerInfo) });
  }

  /** Makes the longest-connected player the host when the current one is gone or offline. */
  function electHost(room: Room): void {
    const cur = room.players.get(room.hostId);
    if (cur && cur.ws) return;
    const next = [...room.players.values()].filter((q) => q.ws).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (!next || next.id === room.hostId) return;
    room.hostId = next.id;
    broadcast(room, { t: 'host', id: next.id });
    log(`room ${room.code}: host is now ${next.id}`);
  }

  function removePlayer(p: Player): void {
    const room = p.room;
    room.players.delete(p.id);
    byToken.delete(p.token);
    broadcast(room, { t: 'gone', id: p.id });
    if (room.players.size === 0) {
      rooms.delete(room.code);
      log(`room ${room.code} closed`);
    } else electHost(room);
  }

  function strike(p: Player, ws: WebSocket, reason: ErrorCode): void {
    p.strikes++;
    if (p.strikes >= MAX_STRIKES) {
      sendWs(ws, { t: 'error', code: reason });
      log(`room ${p.room.code}: ${p.id} disconnected (${reason})`);
      ws.close(4003, reason);
    }
  }

  function handle(ws: WebSocket, ip: string, me: Player | null, m: ClientMsg): Player | null {
    const t = now();
    if (!me) {
      if (m.t === 'create' || m.t === 'join' || m.t === 'resume') {
        if (m.v !== PROTOCOL_VERSION) {
          sendWs(ws, { t: 'error', code: 'version' });
          return null;
        }
      }
      if (m.t === 'create') {
        if (rooms.size >= maxRooms) {
          sendWs(ws, { t: 'error', code: 'room-full' });
          return null;
        }
        let code = makeCode(() => randomInt(0, 1 << 30) / (1 << 30));
        while (rooms.has(code)) code = makeCode(() => randomInt(0, 1 << 30) / (1 << 30));
        const room: Room = { code, seed: m.seed, players: new Map(), hostId: '', createdAt: t, lastAnimalsAt: 0 };
        rooms.set(code, room);
        const p = newPlayer(room, m.name, ws, ip);
        room.hostId = p.id;
        welcome(p);
        log(`room ${code} created by ${p.id}`);
        return p;
      }
      if (m.t === 'join') {
        const room = rooms.get(m.code);
        if (!room) {
          sendWs(ws, { t: 'error', code: 'no-room' });
          return null;
        }
        if (room.players.size >= MAX_PLAYERS) {
          sendWs(ws, { t: 'error', code: 'room-full' });
          return null;
        }
        const p = newPlayer(room, m.name, ws, ip);
        welcome(p);
        broadcast(room, { t: 'peer', peer: peerInfo(p) }, p);
        electHost(room);
        return p;
      }
      if (m.t === 'resume') {
        const p = byToken.get(m.token);
        if (!p) {
          sendWs(ws, { t: 'error', code: 'bad-token' });
          return null;
        }
        if (p.ws && p.ws !== ws) p.ws.close(4001, 'replaced');
        p.ws = ws;
        p.ip = ip;
        p.disconnectedAt = 0;
        p.stateAt = t;
        welcome(p);
        broadcast(p.room, { t: 'peer', peer: peerInfo(p) }, p);
        electHost(p.room);
        return p;
      }
      sendWs(ws, { t: 'error', code: 'bad-request' });
      return null;
    }

    const room = me.room;
    const isHost = room.hostId === me.id;
    switch (m.t) {
      case 'state': {
        if (me.state && !plausibleMove(me.state, m.s, t - me.stateAt)) {
          // Too fast: hold the player at the last accepted position.
          send(me, { t: 'correct', x: me.state.x, y: me.state.y, z: me.state.z });
          me.stateAt = t;
          strike(me, ws, 'cheat');
          break;
        }
        me.state = m.s;
        me.stateAt = t;
        me.dirty = true;
        break;
      }
      case 'animals':
        if (!isHost) {
          strike(me, ws, 'cheat');
          break;
        }
        // At most ANIMALS_HZ snapshots a second are relayed.
        if (t - room.lastAnimalsAt < 1000 / ANIMALS_HZ - 20) break;
        room.lastAnimalsAt = t;
        broadcast(room, { t: 'animals', list: m.list }, me);
        break;
      case 'env':
        if (!isHost) {
          strike(me, ws, 'cheat');
          break;
        }
        broadcast(room, { t: 'env', time: m.time, weather: m.weather }, me);
        break;
      case 'hit': {
        if (!me.hits.take(t)) {
          strike(me, ws, 'rate');
          break;
        }
        if (!me.state || Math.hypot(m.x - me.state.x, m.z - me.state.z) > MAX_HIT_RANGE) {
          strike(me, ws, 'cheat');
          break;
        }
        const host = room.players.get(room.hostId);
        if (host && host !== me) send(host, { t: 'hit', from: me.id, id: m.id, dmg: m.dmg, x: m.x, z: m.z });
        break;
      }
      case 'build':
        broadcast(room, { t: 'build', from: me.id, op: m.op, data: m.data }, me);
        break;
      case 'chat':
        broadcast(room, { t: 'chat', from: me.id, name: me.name, text: m.text }, me);
        break;
      case 'ping':
        send(me, { t: 'pong', at: m.at });
        break;
      case 'leave':
        removePlayer(me);
        ws.close(1000, 'left');
        return null;
      default:
        break;
    }
    return me;
  }

  // ---------------------------------------------------------------- HTTP

  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/health') {
      let players = 0;
      for (const r of rooms.values()) players += r.players.size;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, version: PROTOCOL_VERSION, rooms: rooms.size, players, uptimeS: Math.round((now() - started) / 1000) }));
      return;
    }
    if (!staticRoot || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404).end();
      return;
    }
    // Static files of the built game, never outside the root.
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(staticRoot, rel));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const st = statSync(file);
      if (!st.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': st.size, 'cache-control': rel.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });

  // ---------------------------------------------------------------- WebSocket

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  http.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const origin = req.headers.origin ?? '';
    if (url.pathname !== '/ws' || (origins.length && !origins.includes(origin))) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const ip = (req.headers['x-forwarded-for']?.toString().split(',')[0].trim() || req.socket.remoteAddress || '?').slice(0, 64);
    if ((connPerIp.get(ip) ?? 0) >= maxConnPerIp) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, ip));
  });

  wss.on('connection', (ws: WebSocket, ip: string) => {
    connPerIp.set(ip, (connPerIp.get(ip) ?? 0) + 1);
    let me: Player | null = null;
    let alive = true;
    const pre = new RateLimiter(10, 20, now());
    ws.on('pong', () => (alive = true));
    const beat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      ws.ping();
    }, 15_000);
    ws.on('message', (data, isBinary) => {
      const t = now();
      if (isBinary) return;
      const limiter = me ? me.limiter : pre;
      if (!limiter.take(t)) {
        if (me) strike(me, ws, 'rate');
        else ws.close(4029, 'rate');
        return;
      }
      const text = data.toString();
      const m = parseClientMsg(text);
      if (!m) {
        if (me) strike(me, ws, 'bad-request');
        else sendWs(ws, { t: 'error', code: 'bad-request' });
        return;
      }
      me = handle(ws, ip, me, m);
    });
    ws.on('close', () => {
      clearInterval(beat);
      connPerIp.set(ip, Math.max(0, (connPerIp.get(ip) ?? 1) - 1));
      if (connPerIp.get(ip) === 0) connPerIp.delete(ip);
      if (!me || me.ws !== ws) return;
      me.ws = null;
      me.disconnectedAt = now();
      broadcast(me.room, { t: 'peer', peer: peerInfo(me) }, me);
      electHost(me.room);
    });
    ws.on('error', () => ws.terminate());
  });

  // Player states to everyone at STATE_HZ; expired disconnected players are removed.
  const tick = setInterval(() => {
    const t = now();
    for (const room of [...rooms.values()]) {
      const list: [string, PlayerState][] = [];
      for (const p of room.players.values()) {
        if (p.dirty && p.state) list.push([p.id, p.state]);
        p.dirty = false;
      }
      if (list.length) broadcast(room, { t: 'states', list });
      for (const p of [...room.players.values()]) if (!p.ws && t - p.disconnectedAt > RECONNECT_GRACE_MS) removePlayer(p);
    }
  }, 1000 / STATE_HZ);

  return new Promise((ok) => {
    http.listen(opts.port ?? 8787, opts.host ?? '0.0.0.0', () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port ?? 8787;
      log(`listening on ${opts.host ?? '0.0.0.0'}:${port}${staticRoot ? ` (serving ${staticRoot})` : ''}`);
      ok({
        port,
        stats: () => {
          let players = 0;
          for (const r of rooms.values()) players += r.players.size;
          return { rooms: rooms.size, players };
        },
        close: () =>
          new Promise<void>((done) => {
            clearInterval(tick);
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}

// Run directly: `node server/server.ts`.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('server.ts')) {
  const env = process.env;
  void startServer({
    port: Number(env.PORT) || 8787,
    host: env.HOST || '0.0.0.0',
    staticDir: env.STATIC_DIR || undefined,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()),
    maxRooms: Number(env.MAX_ROOMS) || undefined,
    maxConnPerIp: Number(env.MAX_CONN_PER_IP) || undefined,
  });
}
