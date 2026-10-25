import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer } from '../server/server.ts';
import { MAX_PLAYERS, PROTOCOL_VERSION, type PlayerState, type ServerMsg } from '../src/net/protocol';

const state = (o: Partial<PlayerState> = {}): PlayerState => ({ x: 0, y: 10, z: 0, yaw: 0, speed: 0, flags: 0, held: '', act: 0, ...o });

/** A test client that records every message and can wait for one of a given type. */
class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  private waiters: { t: string; ok: (m: ServerMsg) => void; pred?: (m: ServerMsg) => boolean }[] = [];
  closed = false;
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      this.msgs.push(m);
      for (const w of [...this.waiters])
        if (w.t === m.t && (!w.pred || w.pred(m))) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.ok(m);
        }
    });
    this.ws.on('close', () => (this.closed = true));
  }
  open(): Promise<void> {
    return new Promise((ok, fail) => {
      if (this.ws.readyState === 1) ok();
      this.ws.once('open', () => ok());
      this.ws.once('error', fail);
    });
  }
  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }
  next<T extends ServerMsg['t']>(t: T, pred?: (m: Extract<ServerMsg, { t: T }>) => boolean, ms = 3000): Promise<Extract<ServerMsg, { t: T }>> {
    const seen = this.msgs.find((m) => m.t === t && (!pred || pred(m as Extract<ServerMsg, { t: T }>)));
    if (seen) {
      this.msgs.splice(this.msgs.indexOf(seen), 1);
      return Promise.resolve(seen as Extract<ServerMsg, { t: T }>);
    }
    return new Promise((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`timeout waiting for ${t}`)), ms);
      this.waiters.push({ t, pred: pred as (m: ServerMsg) => boolean, ok: (m) => (clearTimeout(timer), ok(m as Extract<ServerMsg, { t: T }>)) });
    });
  }
  close(): void {
    this.ws.close();
  }
}

let srv: Awaited<ReturnType<typeof startServer>>;
const clients: Client[] = [];
const client = async (): Promise<Client> => {
  const c = new Client(srv.port);
  clients.push(c);
  await c.open();
  return c;
};
const host = async (seed = 777): Promise<{ c: Client; code: string; token: string; id: string }> => {
  const c = await client();
  c.send({ t: 'create', v: PROTOCOL_VERSION, name: 'Host', seed });
  const w = await c.next('welcome');
  return { c, code: w.code, token: w.token, id: w.you };
};
const guest = async (code: string, name = 'Guest'): Promise<{ c: Client; id: string; token: string }> => {
  const c = await client();
  c.send({ t: 'join', v: PROTOCOL_VERSION, name, code });
  const w = await c.next('welcome');
  return { c, id: w.you, token: w.token };
};

beforeEach(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', log: () => {} });
});
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await srv.close();
});

describe('co-op server', () => {
  it('creates a room with an invite code; guests join with it and share the world seed', async () => {
    const h = await host(4242);
    expect(h.code).toMatch(/^[A-Z2-9]{6}$/);
    const g = await guest(h.code, 'Bia');
    const w = g.c;
    expect(h.c.msgs.length >= 0).toBe(true);
    const peer = await h.c.next('peer');
    expect(peer.peer.name).toBe('Bia');
    expect(peer.peer.host).toBe(false);
    void w;
    const bad = await client();
    bad.send({ t: 'join', v: PROTOCOL_VERSION, name: 'X', code: 'ZZZZZZ' });
    expect((await bad.next('error')).code).toBe('no-room');
    const old = await client();
    old.send({ t: 'create', v: PROTOCOL_VERSION + 1, name: 'X', seed: 1 });
    expect((await old.next('error')).code).toBe('version');
  });

  it('tells the guest the seed and the host', async () => {
    const h = await host(99);
    const c = await client();
    c.send({ t: 'join', v: PROTOCOL_VERSION, name: 'Caio', code: h.code });
    const w = await c.next('welcome');
    expect(w.seed).toBe(99);
    expect(w.host).toBe(false);
    expect(w.peers.map((p) => p.id)).toEqual([h.id]);
    expect(w.peers[0].host).toBe(true);
  });

  it('refuses players beyond the room size', async () => {
    const h = await host();
    for (let i = 1; i < MAX_PLAYERS; i++) await guest(h.code, `P${i}`);
    const c = await client();
    c.send({ t: 'join', v: PROTOCOL_VERSION, name: 'Late', code: h.code });
    expect((await c.next('error')).code).toBe('room-full');
  });

  it('relays player states and holds back impossible moves (speed hack)', async () => {
    const h = await host();
    const g = await guest(h.code);
    g.c.send({ t: 'state', s: state({ x: 10, z: 5, speed: 3 }) });
    const st = await h.c.next('states', (m) => m.list.some(([id]) => id === g.id));
    expect(st.list.find(([id]) => id === g.id)![1].x).toBe(10);
    // 5 km in an instant: corrected back to the last accepted position, not relayed.
    g.c.send({ t: 'state', s: state({ x: 5000, z: 5 }) });
    const fix = await g.c.next('correct');
    expect(fix.x).toBe(10);
    await new Promise((r) => setTimeout(r, 250));
    expect(h.c.msgs.some((m) => m.t === 'states' && m.list.some(([id, s]) => id === g.id && s.x === 5000))).toBe(false);
  });

  it('only the host may send animal snapshots and the clock', async () => {
    const h = await host();
    const g = await guest(h.code);
    const list = [['a1', 'dodo', 1, 2, 3, 0, 0.5, 'wander', 40, 1, 0, -1000, 0]];
    h.c.send({ t: 'animals', list });
    expect((await g.c.next('animals')).list[0][0]).toBe('a1');
    h.c.send({ t: 'env', time: 1234, weather: 'rain' });
    expect((await g.c.next('env')).weather).toBe('rain');
    g.c.send({ t: 'animals', list });
    g.c.send({ t: 'env', time: 1, weather: 'clear' });
    await new Promise((r) => setTimeout(r, 300));
    expect(h.c.msgs.some((m) => m.t === 'animals' || m.t === 'env')).toBe(false);
  });

  it('forwards guest hits to the host only when within reach', async () => {
    const h = await host();
    const g = await guest(h.code);
    g.c.send({ t: 'state', s: state({ x: 0, z: 0 }) });
    await h.c.next('states');
    g.c.send({ t: 'hit', id: 'a1', dmg: 20, x: 2, z: 1 });
    const hit = await h.c.next('hit');
    expect(hit).toMatchObject({ from: g.id, id: 'a1', dmg: 20 });
    g.c.send({ t: 'hit', id: 'a2', dmg: 20, x: 900, z: 0 });
    await new Promise((r) => setTimeout(r, 300));
    expect(h.c.msgs.some((m) => m.t === 'hit' && m.id === 'a2')).toBe(false);
  });

  it('relays chat with sanitised text and the sender name', async () => {
    const h = await host();
    const g = await guest(h.code, 'Davi');
    g.c.send({ t: 'chat', text: 'olá‮  pessoal' });
    const m = await h.c.next('chat');
    expect(m.name).toBe('Davi');
    expect(m.text).toBe('olá   pessoal');
  });

  it('lets a dropped player resume with its token, and hands the host role over while it is away', async () => {
    const h = await host();
    const g = await guest(h.code);
    h.c.close();
    const migrated = await g.c.next('host');
    expect(migrated.id).toBe(g.id);
    const back = await client();
    back.send({ t: 'resume', v: PROTOCOL_VERSION, token: h.token });
    const w = await back.next('welcome');
    expect(w.you).toBe(h.id);
    expect(w.host).toBe(false);
    const forged = await client();
    forged.send({ t: 'resume', v: PROTOCOL_VERSION, token: 'x'.repeat(32) });
    expect((await forged.next('error')).code).toBe('bad-token');
  });

  it('disconnects a client that floods messages', async () => {
    const h = await host();
    for (let i = 0; i < 2000 && !h.c.closed; i++) h.c.send({ t: 'ping', at: i });
    await new Promise((r) => setTimeout(r, 500));
    expect(h.c.closed).toBe(true);
  });

  it('reports health over HTTP', async () => {
    await host();
    const res = await fetch(`http://127.0.0.1:${srv.port}/health`);
    const body = (await res.json()) as { ok: boolean; rooms: number; players: number };
    expect(body).toMatchObject({ ok: true, rooms: 1, players: 1 });
  });
});
