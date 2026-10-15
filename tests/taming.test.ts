import { describe, expect, it } from 'vitest';
import { createAnimal, type AnimalData } from '../src/animals/animal';
import { SPECIES } from '../src/animals/species';
import { Building } from '../src/building/building';
import { Rng } from '../src/core/rng';
import { Inventory } from '../src/inventory/inventory';
import { Progression, createProgression } from '../src/progression/skills';
import { TAME_PROFILES } from '../src/taming/profiles';
import { canMount, careTick, hurtByPlayer, issueCommand, makeTame, observeTick, offerFood } from '../src/taming/taming';
import { TamingController } from '../src/taming/tamingController';
import { CollisionWorld } from '../src/world/collision';
import { ctx, dryPlains, makeWorld, player } from './helpers';

const DAY = 1200;
let n = 0;
function animal(speciesId: string, now = 0, adult = true): AnimalData {
  const sp = SPECIES[speciesId];
  const a = createAnimal({ id: `t${n++}`, speciesId, x: 0, z: 0, bornAt: adult ? now - sp.reproduction.maturityDays * DAY * 2 : now, groupId: `g${n}`, rng: new Rng(n) });
  a.hunger = 0.7;
  return a;
}

describe('taming profiles', () => {
  it('covers every species and keeps giants and apex predators untameable', () => {
    for (const id of Object.keys(SPECIES)) expect(TAME_PROFILES[id], id).toBeDefined();
    for (const id of ['tyrannosaurus', 'spinosaurus', 'brachiosaurus', 'allosaurus', 'sarcosuchus']) expect(TAME_PROFILES[id].method).toBe('none');
  });
});

describe('feeding-based taming', () => {
  it('rejects wrong food, untameable species and imprint-only species', () => {
    expect(offerFood(animal('triceratops'), 'raw_meat', 0)).toBe('wrongFood');
    expect(offerFood(animal('tyrannosaurus'), 'raw_meat', 0)).toBe('untameable');
    expect(offerFood(animal('velociraptor'), 'raw_meat', 0)).toBe('imprintOnly');
  });
  it('a scared or sated animal will not accept food', () => {
    const a = animal('triceratops');
    a.state = 'flee';
    expect(offerFood(a, 'berries', 0)).toBe('scared');
    const b = animal('triceratops');
    b.hunger = 0.05;
    expect(offerFood(b, 'berries', 0)).toBe('notHungry');
  });
  it('trust grows over repeated, spaced feedings until the animal is tamed', () => {
    const a = animal('parasaurolophus');
    let now = 0;
    let res = '';
    let feedings = 0;
    while (res !== 'tamed' && feedings < 200) {
      a.hunger = 0.8;
      res = offerFood(a, 'feed_mix', now);
      if (res === 'accepted' || res === 'tamed') feedings++;
      now += 15;
    }
    expect(res).toBe('tamed');
    expect(feedings).toBeGreaterThan(5);
    // `now` is 15 s after the last feeding; 5 s after it the animal is still wary.
    a.hunger = 0.8;
    expect(offerFood(a, 'feed_mix', now - 10)).toBe('tooSoon');
  });
  it('preferred food and the calm voice skill tame faster', () => {
    const run = (food: string, rate: number) => {
      const a = animal('iguanodon');
      a.hunger = 0.8;
      offerFood(a, food, 0, rate);
      return a.tameProgress;
    };
    expect(run('feed_mix', 1)).toBeGreaterThan(run('berries', 1));
    expect(run('feed_mix', 1.5)).toBeGreaterThan(run('feed_mix', 1));
  });
});

describe('observation-based taming', () => {
  it('grows slowly while the player stays calm and drops on hostility', () => {
    const a = animal('gallimimus');
    for (let i = 0; i < 100; i++) observeTick(a, 1, { now: i, dist: 20, perceived: true, quiet: true, hostile: false, rate: 1 });
    const p = a.tameProgress;
    expect(p).toBeGreaterThan(0.1);
    observeTick(a, 1, { now: 101, dist: 20, perceived: true, quiet: true, hostile: true, rate: 1 });
    expect(a.tameProgress).toBeLessThan(p);
    const b = animal('gallimimus');
    for (let i = 0; i < 100; i++) observeTick(b, 1, { now: i, dist: 3, perceived: true, quiet: true, hostile: false, rate: 1 });
    expect(b.tameProgress).toBe(0);
  });
});

describe('tamed animals', () => {
  it('training raises obedience; neglect and abuse break the bond', () => {
    const a = animal('triceratops');
    makeTame(a, 'Tri', 0, false);
    const ob = a.tame!.obedience;
    let now = 0;
    let obeyed = 0;
    for (let i = 0; i < 40; i++) {
      now += 10;
      a.hunger = 0.2;
      if (issueCommand(a, i % 2 ? 'stay' : 'follow', now, 0.01, 0, 0) === 'obeyed') obeyed++;
    }
    expect(obeyed).toBe(40);
    expect(a.tame!.obedience).toBeGreaterThan(ob);
    a.hunger = 1;
    a.thirst = 1;
    expect(issueCommand(a, 'stay', now + 10, 0.99, 0, 0)).toBe('ignored');
    let r = 'ok';
    for (let i = 0; i < 2000 && r === 'ok'; i++) r = careTick(a, 10, now + i * 10);
    expect(r).toBe('left');
    expect(a.tame).toBeNull();
    const b = animal('triceratops');
    makeTame(b, 'B', 0, false);
    b.tame!.bond = 0.2;
    expect(hurtByPlayer(b, 0)).toBe('left');
  });
  it('only adult, trained mount species can be ridden', () => {
    const a = animal('parasaurolophus');
    makeTame(a, 'P', 0, false);
    expect(canMount(a, 0)).toBe(false);
    a.tame!.obedience = 0.5;
    expect(canMount(a, 0)).toBe(true);
    const juv = animal('parasaurolophus', 0, false);
    makeTame(juv, 'J', 0, true);
    juv.tame!.obedience = 0.9;
    expect(canMount(juv, 0)).toBe(false);
    const ank = animal('ankylosaurus');
    makeTame(ank, 'A', 0, false);
    ank.tame!.obedience = 0.9;
    expect(canMount(ank, 0)).toBe(false);
  });

  it('a tamed animal following the player moves toward them; on "stay" it holds position', () => {
    const { terrain, env, eco } = makeWorld(5);
    const s = dryPlains(terrain);
    const a = animal('protoceratops', env.state.time);
    a.x = s.x;
    a.z = s.z;
    a.hunger = 0.1;
    a.thirst = 0.1;
    a.fatigue = 0.1;
    makeTame(a, 'Pro', env.state.time, false);
    eco.animals.set(a.id, a);
    const p = player(s.x + 30, s.z);
    for (let i = 0; i < 200; i++) eco.update(0.1, ctx(p));
    expect(Math.hypot(a.x - p.x, a.z - p.z)).toBeLessThan(15);
    issueCommand(a, 'stay', env.state.time + 100, 0, p.x, p.z);
    const [sx, sz] = [a.x, a.z];
    const far = player(s.x - 60, s.z);
    for (let i = 0; i < 100; i++) eco.update(0.1, ctx(far));
    expect(Math.hypot(a.x - sx, a.z - sz)).toBeLessThan(5);
  });

  it('hungry tamed animals eat from a stocked feeding trough', () => {
    const { terrain, env, eco } = makeWorld(6);
    const s = dryPlains(terrain);
    const env2 = { height: (x: number, z: number) => terrain.height(x, z), waterLevel: env.waterLevel, collision: new CollisionWorld() };
    const b = new Building({ pieces: [], nextId: 1 }, env2.collision);
    const inv = new Inventory();
    inv.addAll({ wood: 20, rope: 5 });
    const trough = b.place(b.preview('feeding_trough', s.x + 5, s.z, 0, false, env2, s.x, s.z), inv)!;
    expect(trough).toBeTruthy();
    trough.storage![0] = { id: 'berries', qty: 20 };
    const a = animal('parasaurolophus', env.state.time);
    a.x = s.x;
    a.z = s.z;
    a.hunger = 0.9;
    a.thirst = 0.1;
    makeTame(a, 'P', env.state.time, false);
    a.tame!.command = 'stay';
    eco.animals.set(a.id, a);
    const ctl = new TamingController();
    for (let i = 0; i < 400; i++) eco.update(0.1, ctx(player(s.x + 10, s.z), { troughFood: (x) => ctl.troughFor(b, x) }));
    expect(a.hunger).toBeLessThan(0.5);
    expect(trough.storage![0]?.qty ?? 0).toBeLessThan(20);
  });

  it('tamed pairs lay eggs in a nest box; warm eggs hatch into imprinted juveniles', () => {
    const { terrain, env, eco } = makeWorld(8);
    const s = dryPlains(terrain);
    const env2 = { height: (x: number, z: number) => terrain.height(x, z), waterLevel: env.waterLevel, collision: new CollisionWorld() };
    const b = new Building({ pieces: [], nextId: 1 }, env2.collision);
    const inv = new Inventory();
    inv.addAll({ wood: 20, fiber: 20, hide: 2 });
    const box = b.place(b.preview('nest_box', s.x + 3, s.z, 0, false, env2, s.x, s.z), inv)!;
    const prog = new Progression(createProgression());
    prog.d.xp.taming = 1e5;
    prog.learn('calm_voice');
    prog.learn('caretaker');
    prog.learn('breeder');
    const mk = (sex: 'f' | 'm') => {
      const a = animal('protoceratops', env.state.time);
      a.sex = sex;
      a.x = s.x;
      a.z = s.z;
      a.hunger = 0.1;
      a.thirst = 0.1;
      makeTame(a, sex, env.state.time, false);
      a.tame!.bond = 0.9;
      eco.animals.set(a.id, a);
      return a;
    };
    mk('f');
    mk('m');
    const ctl = new TamingController();
    const notes: string[] = [];
    const host = {
      eco, building: b, progression: prog, now: env.state.time, player: { x: s.x, z: s.z, quiet: true, hostile: false, alive: true },
      language: 'pt-BR' as const, notify: (k: string) => notes.push(k), xp: () => {}, reveal: () => {},
    };
    for (let i = 0; i < 200 && !box.egg; i++) {
      host.now += 10;
      ctl.update(10, host);
    }
    expect(box.egg?.sp).toBe('protoceratops');
    const res = b.tick(1e6, { now: host.now, raining: false, growth: 1, windSpeed: 3, warm: () => true, incubationSeconds: () => 100 });
    expect(res.hatched).toContain(box);
    const before = eco.animals.size;
    const baby = ctl.hatch(host, box.id)!;
    expect(eco.animals.size).toBe(before + 1);
    expect(baby.tame?.imprinted).toBe(true);
    expect(box.egg).toBeNull();
  });

  it('pack animals following the player add carrying capacity', () => {
    const { env, eco } = makeWorld(9);
    const a = animal('iguanodon', env.state.time);
    makeTame(a, 'I', env.state.time, false);
    eco.animals.set(a.id, a);
    eco.update(0.01, ctx(player(a.x + 5, a.z)));
    expect(new TamingController().packCapacity(eco, a.x + 5, a.z, env.state.time)).toBe(40);
  });
});

describe('herd behaviour while taming', () => {
  it("herd-mates panicking at the player don't stampede an individual that trusts them", () => {
    const { terrain, env, eco } = makeWorld(21);
    const s = dryPlains(terrain);
    const now = env.state.time;
    const mk = (dx: number, progress: number) => {
      const a = animal('parasaurolophus', now);
      a.x = s.x + dx;
      a.z = s.z;
      a.groupId = 'herd';
      a.hunger = a.thirst = a.fatigue = 0.1;
      a.tameProgress = progress;
      a.personality.flightiness = 1;
      eco.animals.set(a.id, a);
      return a;
    };
    const trusting = mk(0, 0.9);
    const wild = mk(6, 0);
    const p = player(s.x, s.z - 4);
    let trustingFled = false;
    let wildFled = false;
    for (let i = 0; i < 80; i++) {
      eco.update(0.1, ctx(p));
      if (trusting.state === 'flee') trustingFled = true;
      if (wild.state === 'flee') wildFled = true;
    }
    expect(wildFled).toBe(true);
    expect(trustingFled).toBe(false);
  });
});
