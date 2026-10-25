import { describe, expect, it } from 'vitest';
import { Progression, SKILLS, TREES, createProgression, sanitizeProgression, xpForLevel } from '../src/progression/skills';

describe('progression', () => {
  it('levels each discipline from its own practice and grants points', () => {
    const p = new Progression(createProgression());
    const ups: string[] = [];
    p.onLevel = (t, l) => ups.push(`${t}${l}`);
    p.gain('crafting', xpForLevel(3));
    expect(p.level('crafting')).toBe(3);
    expect(p.level('combat')).toBe(0);
    expect(p.points('crafting')).toBe(3);
    expect(ups).toEqual(['crafting3']);
    p.gain('crafting', Number.NaN);
    p.gain('crafting', -50);
    expect(p.level('crafting')).toBe(3);
  });
  it('skills require the discipline level and a free point', () => {
    const p = new Progression(createProgression());
    expect(p.learn('artisan')).toBe(false);
    p.gain('crafting', xpForLevel(1));
    expect(p.learn('metallurgy')).toBe(false);
    expect(p.learn('artisan')).toBe(true);
    expect(p.learn('thrifty')).toBe(false);
    p.gain('crafting', xpForLevel(5));
    expect(p.learn('metallurgy')).toBe(true);
    expect(p.unlocks()).toEqual(['skill:metallurgy']);
  });
  it('every skill has a concrete numeric or unlock effect', () => {
    const base = new Progression(createProgression());
    const full = new Progression(createProgression());
    for (const t of TREES) full.gain(t, xpForLevel(10));
    for (const s of SKILLS) full.learn(s.id);
    expect(full.d.learned.length).toBe(SKILLS.length);
    const numeric: (keyof Progression)[] = ['needsRate', 'insulationBonus', 'healMultiplier', 'staminaDrain', 'revealMultiplier', 'slopeLimit', 'craftTime', 'refundChance', 'buildCost', 'meleeDamage', 'arrowDamage', 'damageTaken', 'noise', 'tamingRate', 'tamedNeeds', 'bondRate', 'incubation'];
    for (const k of numeric) expect((full[k] as () => number)(), String(k)).not.toBe((base[k] as () => number)());
    expect(full.unlocks().sort()).toEqual(['skill:engineer', 'skill:mason', 'skill:metallurgy']);
  });
  it('sanitizing drops skills that the saved XP cannot pay for', () => {
    const d = sanitizeProgression({ xp: { crafting: 50 } as never, learned: ['artisan', 'metallurgy', 'nonsense'], daysSurvived: 3.7 });
    expect(d.learned).toEqual(['artisan']);
    expect(d.daysSurvived).toBe(3);
    expect(sanitizeProgression(undefined).learned).toEqual([]);
  });
});
