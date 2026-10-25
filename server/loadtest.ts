/**
 * Load test for the co-op server. Starts the server as a separate process (or targets
 * URL), fills ROOMS rooms with PLAYERS players each, every player sending its state at
 * STATE_HZ and a ping every second, every host sending a snapshot of ANIMALS animals at
 * ANIMALS_HZ, for SECONDS seconds. Reports round-trip latency (p50/p95/p99), messages
 * delivered and the server process's CPU and memory (Linux /proc).
 *
 *   node server/loadtest.ts                       # 25 rooms × 8 players, 30 s
 *   ROOMS=50 PLAYERS=8 SECONDS=60 node server/loadtest.ts
 *   URL=wss://example.com/ws node server/loadtest.ts   # against a deployed server
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { ANIMALS_HZ, PROTOCOL_VERSION, STATE_HZ, type AnimalTuple, type ServerMsg } from '../src/net/protocol.ts';

const env = process.env;
const ROOMS = Number(env.ROOMS) || 25;
const PLAYERS = Number(env.PLAYERS) || 8;
const ANIMALS = Number(env.ANIMALS) || 120;
const SECONDS = Number(env.SECONDS) || 30;
const PORT = Number(env.PORT) || 8790;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  let url = env.URL;
  let server: ReturnType<typeof spawn> | null = null;
  if (!url) {
    server = spawn(process.execPath, ['server/server.ts'], { env: { ...env, PORT: String(PORT), HOST: '127.0.0.1', MAX_CONN_PER_IP: '100000', MAX_ROOMS: '100000' }, stdio: 'ignore' });
    url = `ws://127.0.0.1:${PORT}/ws`;
    await sleep(800);
  }
  const rtts: number[] = [];
  let received = 0;
  let errors = 0;
  const sockets: WebSocket[] = [];
  const timers: NodeJS.Timeout[] = [];

  const connect = (): Promise<WebSocket> =>
    new Promise((ok, fail) => {
      const ws = new WebSocket(url!);
      ws.once('open', () => ok(ws));
      ws.once('error', fail);
    });
  const nextOf = (ws: WebSocket, t: string): Promise<ServerMsg> =>
    new Promise((ok) => {
      const f = (d: WebSocket.RawData) => {
        const m = JSON.parse(d.toString()) as ServerMsg;
        if (m.t === t) {
          ws.off('message', f);
          ok(m);
        }
      };
      ws.on('message', f);
    });

  const t0 = Date.now();
  for (let r = 0; r < ROOMS; r++) {
    const hostWs = await connect();
    const w = nextOf(hostWs, 'welcome');
    hostWs.send(JSON.stringify({ t: 'create', v: PROTOCOL_VERSION, name: `H${r}`, seed: r + 1 }));
    const code = ((await w) as Extract<ServerMsg, { t: 'welcome' }>).code;
    const room = [hostWs];
    for (let p = 1; p < PLAYERS; p++) {
      const ws = await connect();
      const wp = nextOf(ws, 'welcome');
      ws.send(JSON.stringify({ t: 'join', v: PROTOCOL_VERSION, name: `P${r}-${p}`, code }));
      await wp;
      room.push(ws);
    }
    room.forEach((ws, i) => {
      sockets.push(ws);
      ws.on('message', (d) => {
        received++;
        const m = JSON.parse(d.toString()) as ServerMsg;
        if (m.t === 'pong') rtts.push(Date.now() - m.at);
        if (m.t === 'error') errors++;
      });
      let x = r * 50 + i * 3;
      let z = 0;
      let k = 0;
      timers.push(
        setInterval(() => {
          // A player walking a circle at ~4 m/s.
          k++;
          x += Math.cos(k * 0.05) * 0.4;
          z += Math.sin(k * 0.05) * 0.4;
          ws.send(JSON.stringify({ t: 'state', s: { x, y: 10, z, yaw: k * 0.05, speed: 4, flags: 0, held: '', act: 0 } }));
        }, 1000 / STATE_HZ),
      );
      timers.push(setInterval(() => ws.send(JSON.stringify({ t: 'ping', at: Date.now() })), 1000));
      if (i === 0) {
        const list: AnimalTuple[] = [];
        for (let a = 0; a < ANIMALS; a++) list.push([`a${a}`, 'triceratops', a * 3, 10, a * 2, 0.3, 1.2, 'wander', 900, 1, 0]);
        const text = JSON.stringify({ t: 'animals', list });
        timers.push(setInterval(() => ws.send(text), 1000 / ANIMALS_HZ));
      }
    });
  }
  console.log(`${ROOMS * PLAYERS} players in ${ROOMS} rooms connected in ${Date.now() - t0} ms; running ${SECONDS} s…`);

  const cpuOf = (pid: number): number => {
    const f = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return (Number(f[11]) + Number(f[12])) / 100; // utime + stime, in seconds (CLK_TCK = 100)
  };
  const rssOf = (pid: number): number => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))![1]) / 1024;
  const cpu0 = server?.pid ? cpuOf(server.pid) : 0;
  const start = Date.now();
  received = 0;
  rtts.length = 0;
  let peakRss = 0;
  while (Date.now() - start < SECONDS * 1000) {
    await sleep(1000);
    if (server?.pid) peakRss = Math.max(peakRss, rssOf(server.pid));
  }
  const elapsed = (Date.now() - start) / 1000;
  const cpu = server?.pid ? (cpuOf(server.pid) - cpu0) / elapsed : NaN;
  for (const t of timers) clearInterval(t);
  for (const ws of sockets) ws.close();
  server?.kill();

  rtts.sort((a, b) => a - b);
  const q = (p: number) => rtts[Math.min(rtts.length - 1, Math.floor(rtts.length * p))] ?? NaN;
  const report = {
    rooms: ROOMS,
    players: ROOMS * PLAYERS,
    animalsPerSnapshot: ANIMALS,
    seconds: Math.round(elapsed),
    messagesDeliveredPerSec: Math.round(received / elapsed),
    rttMs: { p50: q(0.5), p95: q(0.95), p99: q(0.99), samples: rtts.length },
    errors,
    serverCpuCores: Number.isFinite(cpu) ? Number(cpu.toFixed(3)) : 'n/a (remote server)',
    serverPeakRssMb: server ? Number(peakRss.toFixed(1)) : 'n/a (remote server)',
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

void main();
