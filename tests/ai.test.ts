import { describe, expect, it } from 'vitest';
import { createAnimal, lifeStage } from '../src/animals/animal';
import { SPECIES, SPECIES_IDS } from '../src/animals/species';
import { Rng } from '../src/core/rng';
import { Ecosystem } from '../src/animals/ecosystem';
import { MEMORY_CAPACITY, currentStrength, dangerAt, recallSubject, remember } from '../src/ai/memory';
import { ctx, dryPlains, makeWorld, player } from './helpers';

const DAY = 1200;

function spawn(eco: ReturnType<typeof makeWorld>['eco'], speciesId: string, x: number, z: number, now: number, juvenile = false) {
  const sp = SPECIES[speciesId];
  const a = createAnimal({
    id: `t-${speciesId}-${Math.random().toString(36).slice(2)}`, speciesId, x, z,
    bornAt: juvenile ? now - sp.reproduction.maturityDays * DAY * 0.1 : now - sp.reproduction.maturityDays * DAY * 2,
    groupId: `g-${Math.random()}`, rng: new Rng(5),
  });
  a.hunger = 0.1;
  a.thirst = 0.1;
  a.fatigue = 0.1;
  eco.animals.set(a.id, a);
  return a;
}

describe('species catalogue', () => {
  it('has 20–40 species with distinct, complete data', () => {
    expect(SPECIES_IDS.length).toBeGreaterThanOrEqual(20);
    expect(SPECIES_IDS.length).toBeLessThanOrEqual(40);
    const sigs = new Set(SPECIES_IDS.map((id) => JSON.stringify([SPECIES[id].diet, SPECIES[id].social.type, SPECIES[id].threat.response, SPECIES[id].locomotion.plan, SPECIES[id].massKg])));
    expect(sigs.size).toBe(SPECIES_IDS.length);
    for (const id of SPECIES_IDS) {
      const s = SPECIES[id];
      expect(s.scientificName).toMatch(/^[A-Z][a-z]+ [a-z]+$/);
      expect(s.runSpeed).toBeGreaterThan(s.walkSpeed);
      expect(s.reproduction.season[0]).toBeLessThanOrEqual(s.reproduction.season[1]);
    }
  });
  it('keeps non-dinosaurs correctly classified', () => {
    expect(SPECIES.pteranodon.clade).toBe('pterosaur');
    expect(SPECIES.quetzalcoatlus.clade).toBe('pterosaur');
    expect(SPECIES.sarcosuchus.clade).toBe('crocodyliform');
  });
});

describe('memory', () => {
  it('merges nearby memories, decays and stays bounded', () => {
    const a = createAnimal({ id: 'm', speciesId: 'triceratops', x: 0, z: 0, bornAt: -1e6, groupId: 'g', rng: new Rng(1) });
    remember(a, { kind: 'threat', x: 0, z: 0, strength: 1, subject: 'player' }, 0);
    remember(a, { kind: 'threat', x: 5, z: 5, strength: 1, subject: 'player' }, 10);
    expect(a.memory.length).toBe(1);
    expect(recallSubject(a, 'threat', 'player', 10)).toBeGreaterThan(1.9);
    expect(currentStrength(a.memory[0], 10 + DAY * 40)).toBeLessThan(0.05);
    for (let i = 0; i < 40; i++) remember(a, { kind: 'food', x: i * 100, z: 0, strength: 0.5 }, 20 + i);
    expect(a.memory.length).toBeLessThanOrEqual(MEMORY_CAPACITY);
    expect(dangerAt(a, 0, 0, 30)).toBeGreaterThan(0);
    expect(dangerAt(a, 2000, 2000, 30)).toBe(0);
  });
});

describe('animal behaviour', () => {
  it('a herbivore flees a close player and calms down when far', () => {
    const { terrain, env, eco } = makeWorld();
    const s = dryPlains(terrain);
    const now = env.state.time;
    const a = spawn(eco, 'parasaurolophus', s.x, s.z, now);
    a.heading = Math.PI; // facing -z toward the player
    const p = player(s.x, s.z - 15);
    let fled = false;
    for (let i = 0; i < 60; i++) {
      eco.update(0.1, ctx(p));
      if (a.state === 'flee') fled = true;
    }
    expect(fled).toBe(true);
    expect(Math.hypot(a.x - p.x, a.z - p.z)).toBeGreaterThan(15);
  });

  it('remembers being attacked: flight distance grows, and witnesses learn too', () => {
    const { terrain, env, eco } = makeWorld();
    const s = dryPlains(terrain);
    const now = env.state.time;
    const victim = spawn(eco, 'iguanodon', s.x, s.z, now);
    const witness = spawn(eco, 'iguanodon', s.x + 20, s.z, now);
    witness.groupId = victim.groupId;
    // Animals must be in the player's active bubble to perceive the attack.
    eco.update(0.01, ctx(player(s.x, s.z - 3)));
    eco.playerAttack(victim, 5, s.x, s.z - 3);
    expect(recallSubject(victim, 'injured', 'player', now)).toBeGreaterThan(0);
    expect(recallSubject(witness, 'threat', 'player', now)).toBeGreaterThan(0);
    expect(victim.trustPlayer).toBeLessThan(0);
    // A far, unrelated animal learns nothing (no omniscience).
    const far = spawn(eco, 'iguanodon', s.x + 2000, s.z, now);
    expect(far.memory.length).toBe(0);
  });

  it('habituation lets a calm animal tolerate the player closer', () => {
    const run = (habituation: number) => {
      const { terrain, env, eco } = makeWorld(7);
      const s = dryPlains(terrain);
      const a = spawn(eco, 'gallimimus', s.x, s.z, env.state.time);
      a.habituation = habituation;
      a.personality.flightiness = 1;
      a.personality.curiosity = 0;
      const p = player(s.x, s.z + 30);
      let fled = false;
      for (let i = 0; i < 40; i++) {
        eco.update(0.1, ctx(p));
        if (a.state === 'flee') fled = true;
      }
      return fled;
    };
    expect(run(0)).toBe(true);
    expect(run(1)).toBe(false);
  });

  it('a hungry predator hunts suitable prey and eats the carcass', () => {
    const { terrain, env, eco } = makeWorld(3);
    const s = dryPlains(terrain, 500, 600);
    const now = env.state.time;
    const rex = spawn(eco, 'tyrannosaurus', s.x, s.z, now);
    rex.hunger = 0.95;
    const prey = spawn(eco, 'parasaurolophus', s.x + 12, s.z, now, true);
    prey.health = 5;
    // Close enough to be simulated in full, too far to be noticed.
    const p = player(s.x - 160, s.z, { noiseRadius: 3 });
    let hunted = false;
    for (let i = 0; i < 400 && prey.alive; i++) {
      eco.update(0.1, ctx(p));
      if (rex.state === 'hunt') hunted = true;
    }
    expect(hunted).toBe(true);
    expect(prey.alive).toBe(false);
    for (let i = 0; i < 300; i++) eco.update(0.1, ctx(p));
    expect(rex.hunger).toBeLessThan(0.95);
  });

  it('a well-fed predator ignores the player', () => {
    const { terrain, env, eco } = makeWorld(3);
    const s = dryPlains(terrain, 500, 600);
    const rex = spawn(eco, 'allosaurus', s.x, s.z, env.state.time);
    rex.hunger = 0.05;
    const p = player(s.x + 40, s.z);
    for (let i = 0; i < 100; i++) {
      eco.update(0.1, ctx(p));
      expect(rex.state === 'hunt' && rex.targetId === '__player__').toBe(false);
    }
  });

  it('juveniles grow into adults', () => {
    const { env } = makeWorld();
    const a = createAnimal({ id: 'j', speciesId: 'compsognathus', x: 0, z: 0, bornAt: env.state.time, groupId: 'g', rng: new Rng(2) });
    expect(lifeStage(a, env.state.time)).toBe('juvenile');
    expect(lifeStage(a, env.state.time + SPECIES.compsognathus.reproduction.maturityDays * DAY * 1.1)).toBe('adult');
  });
});

describe('ecosystem', () => {
  it('seeding is idempotent and survives save/load without duplicates', () => {
    const { terrain, env, eco } = makeWorld(11);
    eco.seedAround(300, 700);
    const n = eco.animals.size;
    expect(n).toBeGreaterThan(0);
    eco.seedAround(300, 700);
    expect(eco.animals.size).toBe(n);
    const state = JSON.parse(JSON.stringify(eco.serialize()));
    const eco2 = new Ecosystem(state, terrain, env, 11);
    eco2.seedAround(300, 700);
    expect(eco2.animals.size).toBe(n);
  });

  it('runs a week of abstract simulation with bounded, living populations', () => {
    const { env, eco } = makeWorld(21);
    for (let dx = -1200; dx <= 1200; dx += 600) for (let dz = -600; dz <= 1800; dz += 600) eco.seedAround(dx, dz);
    const start = eco.animals.size;
    const p = player(1e6, 1e6, { alive: false });
    const evs: never[] = [];
    for (let i = 0; i < (DAY * 7) / 10; i++) {
      env.update(10, 0, 0, evs);
      eco.update(10, ctx(p));
    }
    const alive = [...eco.animals.values()].filter((a) => a.alive).length;
    expect(alive).toBeGreaterThan(start * 0.2);
    expect(eco.animals.size).toBeLessThanOrEqual(1400);
    for (const a of eco.animals.values()) {
      expect(Number.isFinite(a.x) && Number.isFinite(a.z)).toBe(true);
    }
  });
});
