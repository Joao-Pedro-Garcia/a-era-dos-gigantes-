import { describe, expect, it } from 'vitest';
import { createAnimal } from '../src/animals/animal';
import { GENE_RANGE, inherit, isElder, randomGenes, rankScore, sanitizeGenes } from '../src/animals/genetics';
import { makeAlpha } from '../src/animals/alpha';
import { SPECIES } from '../src/animals/species';
import { Rng } from '../src/core/rng';
import { ctx, dryPlains, makeWorld, player } from './helpers';

const DAY = 1200;
const mk = (sp: string, sex: 'm' | 'f', size = 1) => {
  const a = createAnimal({ id: `g-${Math.random()}`, speciesId: sp, x: 0, z: 0, bornAt: -1e7, groupId: 'g', rng: new Rng(4) });
  a.sex = sex;
  a.genes = { size, speed: 1, generation: 2 };
  return a;
};

describe('heredity', () => {
  it('young take after both parents, one generation later, within limits', () => {
    const rng = new Rng(9);
    const big = mk('triceratops', 'm', 1.15);
    const small = mk('triceratops', 'f', 0.9);
    let sum = 0;
    for (let i = 0; i < 200; i++) {
      const r = inherit(small, big, rng);
      expect(r.genes.generation).toBe(3);
      expect(r.genes.size).toBeGreaterThanOrEqual(GENE_RANGE.size[0]);
      expect(r.genes.size).toBeLessThanOrEqual(GENE_RANGE.size[1]);
      sum += r.genes.size;
    }
    expect(sum / 200).toBeGreaterThan(0.99);
    expect(sum / 200).toBeLessThan(1.06);
  });

  it('bold parents tend to have bold young', () => {
    const rng = new Rng(3);
    const m = mk('allosaurus', 'm');
    const f = mk('allosaurus', 'f');
    m.personality.aggression = f.personality.aggression = 0.95;
    let s = 0;
    for (let i = 0; i < 100; i++) s += inherit(f, m, rng).personality.aggression!;
    expect(s / 100).toBeGreaterThan(0.85);
  });

  it('world animals get random genes; bad saved genes are repaired', () => {
    const g = randomGenes(new Rng(1));
    expect(g.generation).toBe(0);
    expect(sanitizeGenes({ size: 99, speed: 'x', generation: -3 })).toEqual({ size: GENE_RANGE.size[1], speed: 1, generation: 0 });
    expect(sanitizeGenes(null)).toBeUndefined();
  });

  it('old age is the last fifth of the lifespan', () => {
    const a = mk('dodo', 'f');
    const life = SPECIES.dodo.reproduction.maturityDays * DAY * 6;
    a.bornAt = 0;
    expect(isElder(a, life, life * 0.5)).toBe(false);
    expect(isElder(a, life, life * 0.85)).toBe(true);
  });
});

describe('group hierarchy', () => {
  it('alphas outrank, adults outrank the young', () => {
    const al = mk('triceratops', 'm');
    makeAlpha(al);
    const ad = mk('triceratops', 'f');
    expect(rankScore(al, true)).toBeGreaterThan(rankScore(ad, true));
    expect(rankScore(ad, true)).toBeGreaterThan(rankScore(mk('triceratops', 'm', 1.18), false));
  });

  it('every group has a ranking from 1 (the leader) to its size', () => {
    const { terrain, eco } = makeWorld(41);
    const s = dryPlains(terrain);
    eco.seedAround(s.x, s.z);
    // Ranks are refreshed with the slow (2 s) ecosystem step.
    for (let i = 0; i < 60; i++) eco.update(0.05, ctx(player(s.x, s.z)));
    const byGroup = new Map<string, number[]>();
    for (const a of eco.animals.values()) {
      if (!a.alive || a.tame) continue;
      const r = eco.rankOf(a);
      if (!byGroup.has(a.groupId)) byGroup.set(a.groupId, []);
      byGroup.get(a.groupId)!.push(r.rank);
    }
    let checked = 0;
    for (const ranks of byGroup.values()) {
      if (ranks.length < 2) continue;
      expect([...ranks].sort((x, y) => x - y)).toEqual(ranks.map((_, i) => i + 1));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
