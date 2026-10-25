import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, MAX_NAME, RateLimiter, cleanChat, cleanName, makeCode, normalizeCode, parseClientMsg, plausibleMove, validCode, type PlayerState } from '../src/net/protocol';

const state = (o: Partial<PlayerState> = {}): PlayerState => ({ x: 0, y: 10, z: 0, yaw: 0, speed: 0, flags: 0, held: '', act: 0, ...o });

describe('co-op protocol', () => {
  it('cleans player names and chat (control, zero-width and bidi-override characters, length)', () => {
    expect(cleanName('  Ana  ')).toBe('Ana');
    expect(cleanName('a​b‮c\u0007')).toBe('abc');
    expect(cleanName('x'.repeat(40))!.length).toBe(MAX_NAME);
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(42)).toBeNull();
    expect(cleanChat('oi\nalguém aí?')).toBe('oi alguém aí?');
  });

  it('makes and normalizes room codes without look-alike characters', () => {
    let i = 0;
    const code = makeCode(() => (i++ * 0.137) % 1);
    expect(code).toHaveLength(CODE_LENGTH);
    expect(validCode(code)).toBe(true);
    expect(code).not.toMatch(/[01OIL]/);
    expect(normalizeCode(` ${code.toLowerCase().slice(0, 3)}-${code.slice(3)} `)).toBe(code);
    expect(normalizeCode('ABC')).toBeNull();
  });

  it('accepts well-formed messages and drops malformed ones', () => {
    expect(parseClientMsg(JSON.stringify({ t: 'create', v: 1, name: 'Bia', seed: 12345 }))).toEqual({ t: 'create', v: 1, name: 'Bia', seed: 12345 });
    expect(parseClientMsg(JSON.stringify({ t: 'join', v: 1, name: 'Caio', code: 'abc-de0' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'state', s: state({ x: 5 }) }))).toEqual({ t: 'state', s: state({ x: 5 }) });
    expect(parseClientMsg(JSON.stringify({ t: 'state', s: { ...state(), x: Infinity } }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'state', s: { ...state(), x: 1e9 } }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'state', s: { ...state(), held: 'x'.repeat(200) } }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'hit', id: 'a1', dmg: 1e6, x: 0, z: 0 }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'animals', list: [['a1', 'dodo', 1, 2, 3, 0, 1, 'wander', 50, 1, 0]] }))).not.toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'animals', list: [['a1', 'dodo', 1, 2, 3, 0, 1, 'wander', 50, 2, 0]] }))).toBeNull();
    expect(parseClientMsg('{not json')).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'nope' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'chat', text: 'x'.repeat(60000) }))).toBeNull();
  });

  it('flags impossible movement but allows sprinting, riding and lag', () => {
    expect(plausibleMove({ x: 0, z: 0 }, { x: 3, z: 0 }, 100)).toBe(true);
    expect(plausibleMove({ x: 0, z: 0 }, { x: 25, z: 0 }, 1000)).toBe(true);
    expect(plausibleMove({ x: 0, z: 0 }, { x: 50, z: 0 }, 1500)).toBe(true);
    expect(plausibleMove({ x: 0, z: 0 }, { x: 500, z: 0 }, 100)).toBe(false);
  });

  it('rate-limits with a token bucket', () => {
    const r = new RateLimiter(10, 5, 0);
    let ok = 0;
    for (let i = 0; i < 20; i++) if (r.take(0)) ok++;
    expect(ok).toBe(5);
    expect(r.take(1000)).toBe(true);
  });
});
