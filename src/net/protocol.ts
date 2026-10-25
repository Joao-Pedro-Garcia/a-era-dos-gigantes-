/**
 * Co-op protocol shared by the browser client and the Node server (server/server.ts).
 * Pure data and validation, no DOM or Node APIs. Messages are JSON objects with a
 * `t` (type) field; anything that fails validation is dropped by the receiver.
 *
 * Authority: the room's host simulates the animals and the clock; guests send their own
 * position and requests (hits, building, chat). The server relays, and checks what it can
 * without simulating the world: message size and rate, movement speed, hit distance and
 * damage, and who may send host-only data.
 */
export const PROTOCOL_VERSION = 1;
export const MAX_PLAYERS = 8;
/** Largest message accepted (bytes of JSON text). */
export const MAX_MESSAGE_BYTES = 48 * 1024;
/** Token bucket per connection: sustained messages per second and burst. */
export const RATE_PER_SEC = 40;
export const RATE_BURST = 80;
/** Fastest legitimate horizontal speed (m/s): sprinting, riding the fastest animal, falling. */
export const MAX_SPEED = 32;
/** Extra distance allowed per update on top of MAX_SPEED × elapsed time (jitter, lag). */
export const MOVE_SLACK = 6;
/** Strikes (rejected moves or hits) before a player is disconnected. */
export const MAX_STRIKES = 12;
/** Melee/throw reach checked on hits, from the hitter's last accepted position (m). */
export const MAX_HIT_RANGE = 40;
export const MAX_HIT_DAMAGE = 250;
export const MAX_HITS_PER_SEC = 6;
/** A disconnected player's slot (and host role) is kept this long for reconnection (ms). */
export const RECONNECT_GRACE_MS = 60_000;
/** Client send rates (Hz). */
export const STATE_HZ = 10;
export const ANIMALS_HZ = 5;
export const MAX_NAME = 16;
export const MAX_CHAT = 200;
export const MAX_ANIMALS_PER_SNAPSHOT = 160;
/** Room codes: 6 characters from an alphabet without look-alikes (0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
/** World coordinates are kept inside this square (m). */
export const WORLD_LIMIT = 20_000;

/** Bit flags of a player's state. */
export const F_CROUCH = 1;
export const F_SPRINT = 2;
export const F_SWIM = 4;
export const F_MOUNTED = 8;
export const F_DEAD = 16;

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  /** Body facing (rad). */
  yaw: number;
  /** Horizontal speed (m/s), for the gait. */
  speed: number;
  flags: number;
  /** Item shown in hand ('' = bare hands). */
  held: string;
  /** Increments each time the player starts an attack/action (remote views play it). */
  act: number;
}

/**
 * One animal in a host snapshot: [id, species, x, y, z, heading, speed, state, health, alive,
 * altitude, bornAt (game time), flags (A_ALPHA | A_TAME)].
 */
export type AnimalTuple = [string, string, number, number, number, number, number, string, number, 0 | 1, number, number, number];
export const A_ALPHA = 1;
export const A_TAME = 2;

export interface PeerInfo {
  id: string;
  name: string;
  host: boolean;
  state: PlayerState | null;
  connected: boolean;
}

export type ClientMsg =
  | { t: 'create'; v: number; name: string; seed: number }
  | { t: 'join'; v: number; name: string; code: string }
  | { t: 'resume'; v: number; token: string }
  | { t: 'state'; s: PlayerState }
  | { t: 'animals'; list: AnimalTuple[] }
  | { t: 'env'; time: number; weather: string }
  | { t: 'hit'; id: string; dmg: number; x: number; z: number }
  | { t: 'damage'; to: string; amount: number; species: string; x: number; z: number; knock: [number, number, number] | null }
  | { t: 'build'; op: 'place' | 'remove'; data: unknown }
  | { t: 'chat'; text: string }
  | { t: 'ping'; at: number }
  | { t: 'leave' };

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string; code: string; seed: number; host: boolean; peers: PeerInfo[] }
  | { t: 'peer'; peer: PeerInfo }
  | { t: 'gone'; id: string }
  | { t: 'states'; list: [string, PlayerState][] }
  | { t: 'animals'; list: AnimalTuple[] }
  | { t: 'env'; time: number; weather: string }
  | { t: 'hit'; from: string; id: string; dmg: number; x: number; z: number }
  | { t: 'damage'; amount: number; species: string; x: number; z: number; knock: [number, number, number] | null }
  | { t: 'build'; from: string; op: 'place' | 'remove'; data: unknown }
  | { t: 'chat'; from: string; name: string; text: string }
  | { t: 'host'; id: string }
  | { t: 'correct'; x: number; y: number; z: number }
  | { t: 'pong'; at: number }
  | { t: 'error'; code: ErrorCode };

export type ErrorCode = 'version' | 'bad-request' | 'no-room' | 'room-full' | 'bad-token' | 'rate' | 'cheat' | 'too-big';

const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Control, zero-width and bidirectional-override characters (spoofed or invisible text). */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

/** Player names: printable characters only, trimmed, 1–MAX_NAME long. */
export function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(INVISIBLE, '').trim().slice(0, MAX_NAME);
  return s.length ? s : null;
}

export function cleanChat(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(INVISIBLE, ' ').trim().slice(0, MAX_CHAT);
  return s.length ? s : null;
}

export function validCode(v: unknown): v is string {
  return typeof v === 'string' && v.length === CODE_LENGTH && [...v].every((c) => CODE_ALPHABET.includes(c));
}

export function normalizeCode(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return validCode(s) ? s : null;
}

export function validState(s: unknown): s is PlayerState {
  if (!s || typeof s !== 'object') return false;
  const p = s as Record<string, unknown>;
  return (
    num(p.x, -WORLD_LIMIT, WORLD_LIMIT) &&
    num(p.y, -2000, 5000) &&
    num(p.z, -WORLD_LIMIT, WORLD_LIMIT) &&
    num(p.yaw, -1e4, 1e4) &&
    num(p.speed, 0, MAX_SPEED * 2) &&
    num(p.flags, 0, 255) &&
    Number.isInteger(p.flags) &&
    str(p.held, 40) &&
    num(p.act, 0, 1e9)
  );
}

export function validAnimal(a: unknown): a is AnimalTuple {
  if (!Array.isArray(a) || a.length !== 13) return false;
  return (
    str(a[0], 40) &&
    str(a[1], 40) &&
    num(a[2], -WORLD_LIMIT, WORLD_LIMIT) &&
    num(a[3], -2000, 5000) &&
    num(a[4], -WORLD_LIMIT, WORLD_LIMIT) &&
    num(a[5], -1e4, 1e4) &&
    num(a[6], 0, 100) &&
    str(a[7], 24) &&
    num(a[8], -1e6, 1e6) &&
    (a[9] === 0 || a[9] === 1) &&
    num(a[10], 0, 2000) &&
    num(a[11], -1e12, 1e12) &&
    num(a[12], 0, 255)
  );
}

/**
 * Parses and validates one message from a client. Returns null for anything malformed
 * (unknown type, wrong field types, out-of-range numbers, oversized strings).
 */
export function parseClientMsg(text: string): ClientMsg | null {
  if (text.length > MAX_MESSAGE_BYTES) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'create': {
      const name = cleanName(m.name);
      return num(m.v, 0, 1e6) && name && num(m.seed, 0, 2 ** 32) && Number.isInteger(m.seed) ? { t: 'create', v: m.v as number, name, seed: m.seed as number } : null;
    }
    case 'join': {
      const name = cleanName(m.name);
      const code = normalizeCode(m.code);
      return num(m.v, 0, 1e6) && name && code ? { t: 'join', v: m.v as number, name, code } : null;
    }
    case 'resume':
      return num(m.v, 0, 1e6) && typeof m.token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(m.token) ? { t: 'resume', v: m.v as number, token: m.token } : null;
    case 'state':
      return validState(m.s) ? { t: 'state', s: m.s } : null;
    case 'animals':
      return Array.isArray(m.list) && m.list.length <= MAX_ANIMALS_PER_SNAPSHOT && m.list.every(validAnimal) ? { t: 'animals', list: m.list as AnimalTuple[] } : null;
    case 'env':
      return num(m.time, -1e12, 1e12) && str(m.weather, 24) ? { t: 'env', time: m.time as number, weather: m.weather as string } : null;
    case 'hit':
      return str(m.id, 40) && num(m.dmg, 0, MAX_HIT_DAMAGE) && num(m.x, -WORLD_LIMIT, WORLD_LIMIT) && num(m.z, -WORLD_LIMIT, WORLD_LIMIT) ? { t: 'hit', id: m.id as string, dmg: m.dmg as number, x: m.x as number, z: m.z as number } : null;
    case 'damage': {
      const k = m.knock;
      const knockOk = k === null || (Array.isArray(k) && k.length === 3 && num(k[0], -1.01, 1.01) && num(k[1], -1.01, 1.01) && num(k[2], 0, 60));
      return str(m.to, 16) && num(m.amount, 0, 1000) && str(m.species, 40) && num(m.x, -WORLD_LIMIT, WORLD_LIMIT) && num(m.z, -WORLD_LIMIT, WORLD_LIMIT) && knockOk
        ? { t: 'damage', to: m.to as string, amount: m.amount as number, species: m.species as string, x: m.x as number, z: m.z as number, knock: (k ?? null) as [number, number, number] | null }
        : null;
    }
    case 'build':
      return (m.op === 'place' || m.op === 'remove') && m.data !== undefined && JSON.stringify(m.data).length <= 4096 ? { t: 'build', op: m.op, data: m.data } : null;
    case 'chat': {
      const text = cleanChat(m.text);
      return text ? { t: 'chat', text } : null;
    }
    case 'ping':
      return num(m.at, 0, 1e15) ? { t: 'ping', at: m.at as number } : null;
    case 'leave':
      return { t: 'leave' };
    default:
      return null;
  }
}

/** Server-side movement check: can a player have gone from `a` to `b` in `dtMs`? */
export function plausibleMove(a: { x: number; z: number }, b: { x: number; z: number }, dtMs: number): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  return d <= MAX_SPEED * Math.max(0, dtMs) / 1000 + MOVE_SLACK;
}

/** Token bucket: returns false when the sender is over its rate. */
export class RateLimiter {
  private tokens: number;
  private last: number;
  private readonly perSec: number;
  private readonly burst: number;
  constructor(perSec = RATE_PER_SEC, burst = RATE_BURST, now = 0) {
    this.perSec = perSec;
    this.burst = burst;
    this.tokens = burst;
    this.last = now;
  }
  take(now: number, cost = 1): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** A random room code (crypto-quality randomness supplied by the caller: values in [0, 1)). */
export function makeCode(random: () => number): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  return s;
}
