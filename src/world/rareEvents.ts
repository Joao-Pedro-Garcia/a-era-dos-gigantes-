import type { Rng } from '../core/rng';

/**
 * Rare world events, announced with a warning: a stampede of a big herd, an
 * alpha predator moving into the player's area, and a meteor shower at night
 * (streaks across the sky, fragments with ore and crystal where they fall).
 * At most one event every day and a half; checked once a game minute.
 */
export type RareEventKind = 'stampede' | 'alphaMigration' | 'meteorShower';

export interface RareEventState {
  /** Game time of the next check. */
  nextCheck: number;
  /** No event before this time (cooldown after the last one). */
  quietUntil: number;
  /** Times each event happened (for the journal). */
  count: Partial<Record<RareEventKind, number>>;
}

export const RARE = {
  checkEvery: 60,
  /** Chance per check: about one event every two days on average, never two close together. */
  chance: 0.035,
  cooldown: 1200 * 1.5,
};

export function createRareEvents(now = 0): RareEventState {
  return { nextCheck: now + RARE.checkEvery, quietUntil: now + 600, count: {} };
}

/** Decides whether an event starts now and which one (null most of the time). */
export function rollRareEvent(st: RareEventState, now: number, rng: Rng, night: boolean, inCave: boolean): RareEventKind | null {
  if (now < st.nextCheck) return null;
  st.nextCheck = now + RARE.checkEvery;
  if (inCave || now < st.quietUntil || !rng.chance(RARE.chance)) return null;
  const options: RareEventKind[] = night ? ['meteorShower', 'meteorShower', 'alphaMigration'] : ['stampede', 'stampede', 'alphaMigration'];
  const kind = options[Math.floor(rng.next() * options.length)];
  st.quietUntil = now + RARE.cooldown;
  st.count[kind] = (st.count[kind] ?? 0) + 1;
  return kind;
}

/** Repairs a loaded state (missing in older saves). */
export function sanitizeRareEvents(x: unknown, now: number): RareEventState {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<RareEventState>;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return { nextCheck: n(o.nextCheck, now + RARE.checkEvery), quietUntil: n(o.quietUntil, now + 600), count: o.count && typeof o.count === 'object' ? o.count : {} };
}
