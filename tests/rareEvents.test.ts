import { describe, expect, it } from 'vitest';
import { RARE, createRareEvents, rollRareEvent, sanitizeRareEvents } from '../src/world/rareEvents';
import { Rng } from '../src/core/rng';

describe('rare events', () => {
  it('are rare, never two close together, and depend on day or night', () => {
    const st = createRareEvents(0);
    const rng = new Rng(5);
    const at: number[] = [];
    const kinds = new Set<string>();
    for (let t = 0; t < 1200 * 60; t += 30) {
      const night = (t / 1200) % 1 > 0.6;
      const k = rollRareEvent(st, t, rng, night, false);
      if (k) {
        at.push(t);
        kinds.add(`${k}:${night ? 'n' : 'd'}`);
        if (night) expect(k).not.toBe('stampede');
        else expect(k).not.toBe('meteorShower');
      }
    }
    // 60 days: some events, but on average fewer than one a day.
    expect(at.length).toBeGreaterThan(3);
    expect(at.length).toBeLessThan(60);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(RARE.cooldown);
    expect(kinds.size).toBeGreaterThan(1);
  });

  it('never start inside a cave; bad saved state is repaired', () => {
    const st = createRareEvents(0);
    st.quietUntil = 0;
    const always = Object.assign(new Rng(1), { chance: () => true });
    expect(rollRareEvent(st, 1000, always, false, true)).toBeNull();
    const s2 = sanitizeRareEvents({ nextCheck: 'x' }, 500);
    expect(Number.isFinite(s2.nextCheck)).toBe(true);
    expect(s2.count).toEqual({});
  });
});
