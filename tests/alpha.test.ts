import { describe, expect, it } from 'vitest';
import { ALPHA, alphaEligible, makeAlpha, rollAlpha } from '../src/animals/alpha';
import { createAnimal, maxHealth, type AnimalData } from '../src/animals/animal';
import { SPECIES, SPECIES_IDS } from '../src/animals/species';
import { resolveDamage } from '../src/combat/combat';
import { Rng } from '../src/core/rng';
import { SAVE_VERSION, sanitize, type SaveData } from '../src/save/saveData';
import { createInventory } from '../src/inventory/inventory';
import { createSurvival } from '../src/survival/survival';
import { createEnvState } from '../src/world/environment';
import { createEcosystemState } from '../src/animals/ecosystem';
import { createProgression } from '../src/progression/skills';
import { createExploration } from '../src/exploration/exploration';
import { createMysteries } from '../src/mysteries/mysteries';
import { ctx, dryPlains, makeWorld, player } from './helpers';

const DAY = 1200;
/** An Rng whose chance() always succeeds (forces the rare roll). */
const lucky = () => {
  const r = new Rng(1);
  const fair = r.chance.bind(r);
  return Object.assign(r, { chance: (p: number) => p <= ALPHA.chance || fair(p) });
};

function adult(speciesId: string, x = 0, z = 0, sex: 'm' | 'f' = 'm', now = 0, group = `g-${Math.random()}`): AnimalData {
  const sp = SPECIES[speciesId];
  const a = createAnimal({ id: `t-${Math.random().toString(36).slice(2)}`, speciesId, x, z, bornAt: now - sp.reproduction.maturityDays * DAY * 2, groupId: group, rng: new Rng(3) });
  a.sex = sex;
  a.hunger = a.thirst = a.fatigue = 0.05;
  return a;
}

describe('alpha males: rarity and limits', () => {
  it('only adult males of large enough land species can become alphas', () => {
    const small = SPECIES_IDS.find((id) => SPECIES[id].massKg < ALPHA.minMassKg && !SPECIES[id].locomotion.flies)!;
    expect(alphaEligible(SPECIES[small])).toBe(false);
    expect(rollAlpha(adult(small), true, lucky(), [])).toBe(false);
    expect(rollAlpha(adult('tyrannosaurus', 0, 0, 'f'), true, lucky(), [])).toBe(false);
    expect(rollAlpha(adult('tyrannosaurus'), false, lucky(), [])).toBe(false);
    expect(rollAlpha(adult('tyrannosaurus'), true, lucky(), [])).toBe(true);
  });

  it('is rare with the default chance', () => {
    const rng = new Rng(99);
    let n = 0;
    for (let i = 0; i < 4000; i++) if (rollAlpha(adult('triceratops', i * 10000, 0), true, rng, [])) n++;
    expect(n / 4000).toBeGreaterThan(ALPHA.chance * 0.5);
    expect(n / 4000).toBeLessThan(ALPHA.chance * 1.6);
  });

  it('respects one per species and region, and the world-wide cap', () => {
    const first = adult('tyrannosaurus');
    expect(rollAlpha(first, true, lucky(), [])).toBe(true);
    expect(rollAlpha(adult('tyrannosaurus', 100, 0), true, lucky(), [first])).toBe(false);
    expect(rollAlpha(adult('tyrannosaurus', ALPHA.regionRadius + 50, 0), true, lucky(), [first])).toBe(true);
    const many: AnimalData[] = [];
    for (let i = 0; i < ALPHA.maxAlive; i++) {
      const a = adult('triceratops', i * 5000, 9000);
      makeAlpha(a);
      many.push(a);
    }
    expect(rollAlpha(adult('allosaurus', -9000, -9000), true, lucky(), many)).toBe(false);
    many[0].alive = false; // a dead alpha frees a slot
    expect(rollAlpha(adult('allosaurus', -9000, -9000), true, lucky(), many)).toBe(true);
  });

  it('spawned groups never exceed the cap', () => {
    const { terrain, eco } = makeWorld(5);
    const s = dryPlains(terrain);
    const rng = lucky();
    for (let i = 0; i < 40; i++) eco.spawnGroup('iguanodon', s.x + (i % 8) * 700, s.z + Math.floor(i / 8) * 700, rng);
    const alphas = [...eco.animals.values()].filter((a) => a.alpha);
    expect(alphas.length).toBeGreaterThan(0);
    expect(alphas.length).toBeLessThanOrEqual(ALPHA.maxAlive);
    for (const a of alphas) {
      expect(a.sex).toBe('m');
      expect(a.health).toBeCloseTo(maxHealth(a, eco['env'].state.time), 6);
    }
  });
});

describe('alpha males: stats', () => {
  it('more health, less damage taken, personality boosted exactly once', () => {
    const a = adult('triceratops');
    const base = maxHealth(a, 0);
    const hit = resolveDamage(a, 100, 'cut');
    const courage = a.personality.courage;
    makeAlpha(a);
    makeAlpha(a);
    expect(maxHealth(a, 0)).toBeCloseTo(base * ALPHA.health, 6);
    expect(resolveDamage(a, 100, 'cut')).toBeCloseTo(hit * ALPHA.damageTaken, 6);
    expect(a.personality.courage).toBeCloseTo(Math.min(1, courage + ALPHA.courage), 6);
  });

  it('the status survives saving; missing or invalid values load as ordinary animals', () => {
    const save: SaveData = {
      version: SAVE_VERSION, savedAt: 0, seed: 1,
      player: { x: 1, y: 2, z: 3, yaw: 0, survival: createSurvival(), respawn: null, deaths: 0 },
      inventory: createInventory(), crafting: { queue: [], unlocked: [] }, env: createEnvState(1), eco: createEcosystemState(1),
      building: { pieces: [], nextId: 1 }, world: { harvested: {}, bags: [], nextBagId: 1, discovered: [] },
      progression: createProgression(), exploration: createExploration(), mysteries: createMysteries(),
    };
    const al = adult('tyrannosaurus');
    makeAlpha(al);
    const plain = adult('tyrannosaurus', 50);
    const odd = { ...adult('tyrannosaurus', 90), alpha: 'yes' };
    save.eco.animals = JSON.parse(JSON.stringify([al, plain, odd]));
    sanitize(save);
    expect(save.eco.animals.map((a) => a.alpha)).toEqual([true, false, false]);
  });
});

describe('alpha males: dominance behaviour', () => {
  const setup = () => {
    const { terrain, env, eco } = makeWorld(3);
    const s = dryPlains(terrain);
    const now = env.state.time;
    // The player is far enough to keep the animals simulated but unnoticed.
    const p = player(s.x + 150, s.z, { visibility: 0, noiseRadius: 0 });
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        env.update(0.1, 0, 0, []);
        eco.update(0.1, ctx(p));
      }
    };
    return { eco, s, now, p, step };
  };

  it('two cautious alphas display, then exactly one gives way; nobody is hurt', () => {
    const { eco, s, now, step } = setup();
    const a = adult('tyrannosaurus', s.x, s.z, 'm', now);
    const b = adult('tyrannosaurus', s.x + 12, s.z, 'm', now);
    for (const x of [a, b]) {
      makeAlpha(x);
      x.health = maxHealth(x, now);
      // Not bold enough to come to blows (bold pairs fight: see below).
      x.personality.aggression = 0.3;
      eco.animals.set(x.id, x);
    }
    a.health *= 0.7; // the weaker one
    const ha = a.health;
    const hb = b.health;
    let displayed = false;
    for (let i = 0; i < 300; i++) {
      step(1);
      if (a.state === 'alert' && b.state === 'alert') displayed = true;
    }
    expect(displayed).toBe(true);
    const ra = eco.brain.runtime(a);
    const rb = eco.brain.runtime(b);
    expect(ra.yieldUntil > 0).not.toBe(rb.yieldUntil > 0);
    expect(ra.yieldFrom).toBe(b.id); // the injured one retreats
    // It walked away from the winner, who stood on its +x side.
    expect(s.x - a.x).toBeGreaterThan(10);
    expect(a.health).toBeGreaterThanOrEqual(ha * 0.99);
    expect(b.health).toBeGreaterThanOrEqual(hb * 0.99);
    expect(a.alive && b.alive).toBe(true);
  });

  it('an ordinary rival male gives way to an alpha', () => {
    const { eco, s, now, step } = setup();
    const al = adult('triceratops', s.x, s.z, 'm', now);
    makeAlpha(al);
    al.health = maxHealth(al, now);
    const rival = adult('triceratops', s.x + 10, s.z + 4, 'm', now);
    eco.animals.set(al.id, al);
    eco.animals.set(rival.id, rival);
    const d0 = Math.hypot(rival.x - al.x, rival.z - al.z);
    step(200);
    expect(eco.brain.runtime(rival).yieldFrom).toBe(al.id);
    expect(Math.hypot(rival.x - al.x, rival.z - al.z)).toBeGreaterThan(d0 + 5);
  });

  it('females and males of the same group are left alone', () => {
    const { eco, s, now, step } = setup();
    const al = adult('triceratops', s.x, s.z, 'm', now, 'herd');
    makeAlpha(al);
    const mate = adult('triceratops', s.x + 6, s.z, 'f', now);
    const brother = adult('triceratops', s.x - 6, s.z, 'm', now, 'herd');
    for (const x of [al, mate, brother]) eco.animals.set(x.id, x);
    step(100);
    expect(eco.brain.runtime(mate).yieldFrom).toBeNull();
    expect(eco.brain.runtime(brother).yieldFrom).toBeNull();
  });
});

describe('alphas: special moves, duels and rewards', () => {
  it('only alphas roar, and only at a distance while facing the enemy', async () => {
    const { chooseMove } = await import('../src/combat/dinoAttacks');
    const rex = SPECIES.tyrannosaurus;
    const pick = (alpha: boolean) => chooseMove(rex, 1, 0, 0, 0, 0, 15, 0.4, () => 0.99, undefined, alpha)?.kind;
    expect(pick(false)).not.toBe('roar');
    const kinds = new Set<string>();
    for (let i = 0; i < 20; i++) kinds.add(chooseMove(rex, 1, 0, 0, 0, 0, 15, 0.4, () => i / 20, undefined, true)?.kind ?? 'none');
    expect(kinds.has('roar')).toBe(true);
    // Behind it: no roar.
    expect(chooseMove(rex, 1, 0, 0, 0, 0, -15, 0.4, () => 0.99, undefined, true)?.kind).not.toBe('roar');
  });

  it('two bold alphas fight until one gives way; nobody dies', () => {
    const { terrain, env, eco } = makeWorld(31);
    const s = dryPlains(terrain);
    const now = env.state.time;
    const a = adult('triceratops', s.x, s.z, 'm', now, 'ga');
    const b = adult('triceratops', s.x + 8, s.z, 'm', now, 'gb');
    for (const x of [a, b]) {
      makeAlpha(x);
      x.health = maxHealth(x, now);
      x.personality.aggression = 0.9;
      x.personality.courage = 0.9;
      eco.animals.set(x.id, x);
    }
        const events: string[] = [];
    const c = ctx(player(s.x + 150, s.z, { visibility: 0, noiseRadius: 0 }), { alphaDuel: (_x, _y, ended) => events.push(ended ? 'end' : 'start') });
    for (let i = 0; i < 4000 && !events.includes('end'); i++) {
      env.update(0.05, 0, 0, []);
      eco.update(0.05, c);
    }
    expect(events[0]).toBe('start');
    expect(events).toContain('end');
    expect(a.alive && b.alive).toBe(true);
    expect(Math.min(a.health / maxHealth(a, env.state.time), b.health / maxHealth(b, env.state.time))).toBeLessThan(0.5);
  });

  it('killing an alpha raises an event for the reward', () => {
    const { terrain, env, eco } = makeWorld(32);
    const s = dryPlains(terrain);
    const a = adult('allosaurus', s.x, s.z, 'm', env.state.time);
    makeAlpha(a);
    eco.animals.set(a.id, a);
    const got: string[] = [];
    eco.onEvent = (e) => got.push(e.type);
    eco.kill(a, 'player');
    expect(got).toContain('alphaKilled');
  });
});
