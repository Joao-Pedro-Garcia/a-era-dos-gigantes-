import { WORLD } from '../core/config';
import { clamp } from '../core/math';
import { Rng, hash2 } from '../core/rng';
import { AnimalBrain, PLAYER_ID, type AIWorld, type Hazard, type PlayerPercept, type TroughAccess } from '../ai/brain';
import { resolveDamage } from '../combat/combat';
import { hurtByPlayer, makeTame } from '../taming/taming';
import { pruneMemory, remember } from '../ai/memory';
import { BIOMES } from '../world/biomes';
import type { Environment } from '../world/environment';
import { SPAWN, type Terrain } from '../world/terrain';
import { rollAlpha } from './alpha';
import { type AnimalData, createAnimal, effectiveMass, lifeStage, maxHealth } from './animal';
import { SPECIES, SPECIES_IDS, type SpeciesDef, isPredator } from './species';
import { AQUATIC_MIN_DEPTH, swimDepth } from './aquatic';

/**
 * Living ecosystem. Animals near the player run the full AI every frame; the
 * rest of the continent runs a cheap abstract simulation (needs, grazing,
 * predation, migration, reproduction, mortality). Every individual has a
 * stable id in a single registry, so streaming sectors in and out can never
 * duplicate or resurrect animals.
 */
export interface SectorEco {
  forage: number;
  cap: number;
  water: boolean;
  scorchedUntil: number;
}

export interface Nest {
  id: string;
  speciesId: string;
  x: number;
  z: number;
  eggs: number;
  laidAt: number;
  hatchAt: number;
  parentId: string;
  groupId: string;
}

export interface EcosystemState {
  animals: AnimalData[];
  nests: Nest[];
  seeded: string[];
  sectors: Record<string, SectorEco>;
  nextId: number;
  rng: number;
}

export interface EcoContext {
  player: PlayerPercept;
  predatorBoldness: number;
  maxActive: number;
  blocked(x: number, z: number, r: number): boolean;
  damagePlayer(amount: number, a: AnimalData): void;
  wind?: { x: number; z: number };
  playerCalm?: number;
  companionTarget?: string | null;
  troughFood?(a: AnimalData): TroughAccess | null;
}

export type EcoEvent =
  | { type: 'tameLeft'; id: string; speciesId: string; name: string }
  | { type: 'tamedKilled'; id: string; speciesId: string; name: string; by: string };

const DAY = WORLD.dayLengthSeconds;
const ACTIVE_RADIUS = 230;
const SEED_RADIUS_SECTORS = 4;
const MAX_ANIMALS = 1400;
const ABSTRACT_STEP = 2;
const CARCASS_LIFETIME = DAY * 1.5;

export const sectorKey = (sx: number, sz: number): string => `${sx},${sz}`;
export const sectorOf = (x: number): number => Math.floor(x / WORLD.sectorSize);

export function createEcosystemState(seed: number): EcosystemState {
  return { animals: [], nests: [], seeded: [], sectors: {}, nextId: 1, rng: seed ^ 0x5eed };
}

export class Ecosystem {
  readonly animals = new Map<string, AnimalData>();
  readonly nests = new Map<string, Nest>();
  readonly brain = new AnimalBrain();
  active: AnimalData[] = [];
  private seeded: Set<string>;
  private sectors: Record<string, SectorEco>;
  private rng: Rng;
  private nextId: number;
  private abstractAcc = 0;
  private leaders = new Map<string, AnimalData>();
  private sectorIndex = new Map<string, AnimalData[]>();
  private hazards: Hazard[] = [];
  /** Accumulated time for animals updated at a reduced rate (far from the player). */
  private lodAcc = new Map<string, number>();
  private frame = 0;
  onEvent: (e: EcoEvent) => void = () => {};

  constructor(state: EcosystemState, private terrain: Terrain, private env: Environment, private seed: number) {
    for (const a of state.animals) this.animals.set(a.id, a);
    for (const n of state.nests) this.nests.set(n.id, n);
    this.seeded = new Set(state.seeded);
    this.sectors = state.sectors;
    this.rng = new Rng(state.rng);
    this.nextId = state.nextId;
    this.rebuildIndexes();
  }

  serialize(): EcosystemState {
    return {
      animals: [...this.animals.values()],
      nests: [...this.nests.values()],
      seeded: [...this.seeded],
      sectors: this.sectors,
      nextId: this.nextId,
      rng: this.rng.getState(),
    };
  }

  private newId(prefix: string): string {
    return `${prefix}${(this.nextId++).toString(36)}`;
  }

  // ------------------------------------------------------------------ sectors

  sectorEco(x: number, z: number): SectorEco {
    const sx = sectorOf(x);
    const sz = sectorOf(z);
    const key = sectorKey(sx, sz);
    let e = this.sectors[key];
    if (!e) {
      const cx = (sx + 0.5) * WORLD.sectorSize;
      const cz = (sz + 0.5) * WORLD.sectorSize;
      const cap = BIOMES[this.terrain.biomeAt(cx, cz)].forage;
      let water = false;
      for (let i = 0; i < 5 && !water; i++)
        for (let j = 0; j < 5 && !water; j++) {
          const x2 = sx * WORLD.sectorSize + (i + 0.5) * (WORLD.sectorSize / 5);
          const z2 = sz * WORLD.sectorSize + (j + 0.5) * (WORLD.sectorSize / 5);
          if (this.terrain.height(x2, z2) < -0.25 && this.terrain.continentMask(x2, z2) > 0.85) water = true;
        }
      e = this.sectors[key] = { forage: cap, cap, water, scorchedUntil: 0 };
    }
    return e;
  }

  forageAt(x: number, z: number): number {
    const e = this.sectorEco(x, z);
    return e.cap > 0 ? e.forage : 0;
  }

  /** Seeds wildlife into sectors the first time they come near the player. */
  seedAround(px: number, pz: number): void {
    const csx = sectorOf(px);
    const csz = sectorOf(pz);
    for (let dx = -SEED_RADIUS_SECTORS; dx <= SEED_RADIUS_SECTORS; dx++)
      for (let dz = -SEED_RADIUS_SECTORS; dz <= SEED_RADIUS_SECTORS; dz++) {
        const key = sectorKey(csx + dx, csz + dz);
        if (this.seeded.has(key)) continue;
        this.seeded.add(key);
        this.seedSector(csx + dx, csz + dz);
      }
  }

  private seedSector(sx: number, sz: number): void {
    if (this.animals.size >= MAX_ANIMALS) return;
    const rng = new Rng(hash2(this.seed, sx, sz));
    const S = WORLD.sectorSize;
    const cx = (sx + 0.5) * S;
    const cz = (sz + 0.5) * S;
    const h = this.terrain.height(cx, cz);
    if (h < -1) {
      // Open sea: occasionally a marine predator's home range.
      const marine = SPECIES_IDS.filter((id) => SPECIES[id].locomotion.aquatic);
      if (h < -8 && marine.length && rng.chance(0.06)) this.spawnGroup(marine[rng.int(0, marine.length - 1)], cx, cz, rng);
      return;
    }
    const biome = BIOMES[this.terrain.biomeAt(cx, cz, h)];
    const entries = Object.entries(biome.fauna);
    if (!entries.length) return;
    const nearSpawn = Math.hypot(cx - SPAWN.x, cz - SPAWN.z) < 350;
    const groups = rng.chance(0.55) ? 1 : rng.chance(0.25) ? 2 : 0;
    for (let g = 0; g < groups; g++) {
      const pool = entries.filter(([id]) => !(nearSpawn && SPECIES[id].ecology === 'apexPredator'));
      const total = pool.reduce((s, [, w]) => s + w, 0);
      let roll = rng.next() * total;
      let speciesId = pool[0][0];
      for (const [id, w] of pool) {
        roll -= w;
        if (roll <= 0) {
          speciesId = id;
          break;
        }
      }
      this.spawnGroup(speciesId, cx + rng.range(-40, 40), cz + rng.range(-40, 40), rng);
    }
  }

  spawnGroup(speciesId: string, x: number, z: number, rng: Rng): AnimalData[] {
    const sp = SPECIES[speciesId];
    const now = this.env.state.time;
    const size = rng.int(sp.social.size[0], sp.social.size[1]);
    const groupId = this.newId('g');
    const members: AnimalData[] = [];
    for (let i = 0; i < size; i++) {
      const juvenile = i > 0 && sp.social.type !== 'solitary' && rng.chance(0.25);
      const mature = sp.reproduction.maturityDays * DAY;
      const bornAt = juvenile ? now - mature * rng.range(0.1, 0.5) : now - mature * rng.range(1.1, 3);
      const spread = 4 + sp.lengthM * 1.5;
      const ax = x + rng.range(-spread, spread);
      const az = z + rng.range(-spread, spread);
      if (this.terrain.height(ax, az) < -0.5 && !sp.locomotion.swims) continue;
      if (sp.locomotion.aquatic && this.terrain.height(ax, az) > AQUATIC_MIN_DEPTH) continue;
      const parent = juvenile ? members.find((m) => m.sex === 'f' && lifeStage(m, now) === 'adult') : undefined;
      const a = createAnimal({ id: this.newId('a'), speciesId, x: ax, z: az, bornAt, groupId, parentId: parent?.id ?? null, rng });
      if (rollAlpha(a, !juvenile, rng, this.animals.values())) a.health = maxHealth(a, now);
      a.homeX = x;
      a.homeZ = z;
      a.y = sp.locomotion.aquatic ? swimDepth(a, now, this.terrain.height(ax, az)) : this.terrain.height(ax, az);
      this.animals.set(a.id, a);
      members.push(a);
    }
    return members;
  }

  // ------------------------------------------------------------------ queries

  get(id: string): AnimalData | undefined {
    return this.animals.get(id);
  }

  groupLeader(groupId: string): AnimalData | undefined {
    return this.leaders.get(groupId);
  }

  neighbors(a: AnimalData, radius: number): AnimalData[] {
    const out: AnimalData[] = [];
    const r2 = radius * radius;
    for (const o of this.active) {
      const dx = o.x - a.x;
      const dz = o.z - a.z;
      if (dx * dx + dz * dz < r2) out.push(o);
    }
    return out;
  }

  /** Living or dead animals within radius of a point (active set only). */
  nearPoint(x: number, z: number, radius: number): AnimalData[] {
    const r2 = radius * radius;
    return this.active.filter((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < r2);
  }

  private rebuildIndexes(): void {
    this.leaders.clear();
    this.sectorIndex.clear();
    const now = this.env.state.time;
    for (const a of this.animals.values()) {
      if (!a.alive) continue;
      const cur = this.leaders.get(a.groupId);
      if (!cur) this.leaders.set(a.groupId, a);
      else {
        // Prefer adults; among equals the oldest leads.
        const aAdult = lifeStage(a, now) === 'adult';
        const cAdult = lifeStage(cur, now) === 'adult';
        if ((aAdult && !cAdult) || (aAdult === cAdult && a.bornAt < cur.bornAt)) this.leaders.set(a.groupId, a);
      }
      const key = sectorKey(sectorOf(a.x), sectorOf(a.z));
      let list = this.sectorIndex.get(key);
      if (!list) this.sectorIndex.set(key, (list = []));
      list.push(a);
    }
  }

  // ------------------------------------------------------------------ player interaction

  /**
   * The player hurt an animal. The victim and only those animals that could
   * plausibly perceive the act remember it.
   */
  playerAttack(target: AnimalData, damage: number, px: number, pz: number): void {
    const now = this.env.state.time;
    if (!target.alive) return;
    target.health -= damage;
    const tame = target.tame;
    if (hurtByPlayer(target, now) === 'left' && tame) this.onEvent({ type: 'tameLeft', id: target.id, speciesId: target.speciesId, name: tame.name });
    this.brain.onHurt(target, px, pz, true, now);
    remember(target, { kind: 'injured', x: px, z: pz, strength: 1, subject: 'player' }, now);
    remember(target, { kind: 'threat', x: px, z: pz, strength: 1, subject: 'player' }, now);
    target.trustPlayer = clamp(target.trustPlayer - 0.35, -1, 1);
    target.habituation *= 0.4;
    target.fear = 1;
    for (const o of this.active) {
      if (o === target || !o.alive) continue;
      const sp = SPECIES[o.speciesId];
      const d = Math.hypot(o.x - target.x, o.z - target.z);
      if (d < sp.senses.hearing * 0.6) {
        const strength = o.groupId === target.groupId ? 0.6 : 0.25;
        remember(o, { kind: 'threat', x: px, z: pz, strength, subject: 'player' }, now);
        o.habituation *= 0.8;
      }
    }
    if (target.health <= 0) this.kill(target, 'player');
  }

  kill(a: AnimalData, cause: string): void {
    if (!a.alive) return;
    if (a.tame) this.onEvent({ type: 'tamedKilled', id: a.id, speciesId: a.speciesId, name: a.tame.name, by: cause });
    a.tame = null;
    a.alive = false;
    a.health = 0;
    a.diedAt = this.env.state.time;
    a.cause = cause;
    a.meat = effectiveMass(a, this.env.state.time) * 0.4;
    a.speed = 0;
  }

  /** Harvests a carcass. Returns kg actually removed (never more than remains). */
  harvestCarcass(a: AnimalData, kg: number): number {
    if (a.alive || a.meat <= 0) return 0;
    const taken = Math.min(a.meat, kg);
    a.meat -= taken;
    return taken;
  }

  /**
   * Takes one egg from a wild nest. Parents that are close enough to notice
   * remember the theft and may come to defend the nest.
   */
  takeEgg(nestId: string, px: number, pz: number): string | null {
    const n = this.nests.get(nestId);
    if (!n || n.eggs <= 0) return null;
    n.eggs--;
    if (n.eggs <= 0) this.nests.delete(nestId);
    const now = this.env.state.time;
    for (const a of this.active) {
      if (!a.alive || a.tame || a.speciesId !== n.speciesId) continue;
      if (Math.hypot(a.x - n.x, a.z - n.z) > SPECIES[a.speciesId].senses.sight * 0.6) continue;
      remember(a, { kind: 'threat', x: px, z: pz, strength: 1.2, subject: 'player' }, now);
      a.trustPlayer = clamp(a.trustPlayer - 0.3, -1, 1);
      if (SPECIES[a.speciesId].reproduction.parentalCare > 0.3 && lifeStage(a, now) === 'adult') {
        a.targetId = PLAYER_ID;
        this.brain.setState(a, 'defend');
      }
    }
    return n.speciesId;
  }

  /** A hatchling raised by the player bonds with them (imprinting). */
  hatchTamed(speciesId: string, x: number, z: number, name: string): AnimalData {
    const now = this.env.state.time;
    const a = createAnimal({ id: this.newId('a'), speciesId, x, z, bornAt: now, groupId: 'tame', rng: this.rng });
    a.y = this.terrain.height(x, z);
    makeTame(a, name, now, true, x, z);
    a.tame!.command = 'stay';
    this.animals.set(a.id, a);
    return a;
  }

  // ------------------------------------------------------------------ simulation

  update(dt: number, ctx: EcoContext): void {
    const now = this.env.state.time;
    this.hazards = this.env.state.fires.map((f) => ({ kind: 'fire' as const, x: f.x, z: f.z, r: f.r }));
    if (this.env.eruptionActive) this.hazards.push({ kind: 'eruption', x: 2300, z: -1600, r: 650 });

    this.selectActive(ctx);

    const world: AIWorld = {
      now,
      isNight: this.env.isNight,
      storm: this.env.state.weather === 'storm',
      terrain: this.terrain,
      player: ctx.player,
      predatorBoldness: ctx.predatorBoldness,
      hazards: this.hazards,
      neighbors: (a, r) => this.neighbors(a, r),
      get: (id) => this.animals.get(id),
      groupLeader: (g) => this.leaders.get(g),
      forageAt: (x, z) => this.forageAt(x, z),
      eatForage: (x, z, amount) => {
        const e = this.sectorEco(x, z);
        if (e.cap <= 0) return 0;
        const eaten = amount * clamp(e.forage / Math.max(0.05, e.cap) * 1.2, 0, 1);
        e.forage = Math.max(0, e.forage - eaten * 0.02);
        return eaten;
      },
      blocked: ctx.blocked,
      damagePlayer: ctx.damagePlayer,
      damageAnimal: (t, dmg, attacker) => {
        t.health -= resolveDamage(t, dmg, 'bite');
        this.brain.onHurt(t, attacker.x, attacker.z, false, now);
        remember(t, { kind: 'injured', x: attacker.x, z: attacker.z, strength: 1, subject: attacker.speciesId }, now);
        t.fear = 1;
        if (t.health <= 0) this.kill(t, attacker.speciesId);
      },
      alarm: (a, x, z, fromPlayer) => this.alarm(a, x, z, fromPlayer),
      random: () => this.rng.next(),
      wind: ctx.wind,
      playerCalm: ctx.playerCalm,
      companionTarget: ctx.companionTarget,
      troughFood: ctx.troughFood,
    };

    // Distant active animals think and move at a reduced rate (accumulated time keeps them consistent).
    this.frame++;
    for (const a of this.active) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - ctx.player.x, a.z - ctx.player.z);
      const every = a.tame?.ridden ? 1 : d > 170 ? 4 : d > 100 ? 2 : 1;
      let step = dt;
      if (every > 1) {
        const acc = (this.lodAcc.get(a.id) ?? 0) + dt;
        if ((this.frame + a.id.length) % every !== 0) {
          this.lodAcc.set(a.id, acc);
          continue;
        }
        step = Math.min(acc, 0.5);
        this.lodAcc.delete(a.id);
      }
      this.brain.update(a, world, step);
      if (!a.alive && a.cause === '') this.kill(a, 'unknown');
    }
    this.separate();

    this.abstractAcc += dt;
    if (this.abstractAcc >= ABSTRACT_STEP) {
      const step = this.abstractAcc;
      this.abstractAcc = 0;
      this.abstractTick(step, ctx);
    }
  }

  private selectActive(ctx: EcoContext): void {
    const px = ctx.player.x;
    const pz = ctx.player.z;
    const r2 = ACTIVE_RADIUS * ACTIVE_RADIUS;
    const living: [number, AnimalData][] = [];
    const dead: AnimalData[] = [];
    for (const a of this.animals.values()) {
      const d2 = (a.x - px) ** 2 + (a.z - pz) ** 2;
      if (d2 > r2) continue;
      // Tamed animals near the player are always simulated first.
      if (a.alive) living.push([a.tame ? d2 * 0.01 : d2, a]);
      else dead.push(a);
    }
    living.sort((p, q) => p[0] - q[0]);
    const prev = new Set(this.active);
    this.active = living.slice(0, ctx.maxActive).map((p) => p[1]).concat(dead);
    const now = new Set(this.active);
    for (const a of prev)
      if (!now.has(a)) {
        this.brain.forget(a.id);
        this.lodAcc.delete(a.id);
      }
  }

  /** Gentle push so bodies don't interpenetrate. */
  private separate(): void {
    const list = this.active;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      const ra = SPECIES[a.speciesId].lengthM * 0.22;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const rb = SPECIES[b.speciesId].lengthM * 0.22;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = ra + rb;
        if (d > 0.001 && d < min && Math.abs(a.y - b.y) < 4) {
          const push = (min - d) * 0.5;
          const ma = SPECIES[a.speciesId].massKg;
          const mb = SPECIES[b.speciesId].massKg;
          const wa = mb / (ma + mb);
          a.x -= (dx / d) * push * wa;
          a.z -= (dz / d) * push * wa;
          b.x += (dx / d) * push * (1 - wa);
          b.z += (dz / d) * push * (1 - wa);
        }
      }
    }
  }

  private alarm(a: AnimalData, x: number, z: number, fromPlayer = false): void {
    const sp = SPECIES[a.speciesId];
    const now = this.env.state.time;
    const radius = sp.senses.hearing * 0.8;
    for (const o of this.active) {
      if (o === a || !o.alive || o.alarmAt > 0 || o.state === 'flee') continue;
      // Group members and same-species herds react to alarm calls; others may too if close.
      const sameGroup = o.groupId === a.groupId;
      const d = Math.hypot(o.x - a.x, o.z - a.z);
      if (d > radius * (sameGroup ? 1 : 0.4)) continue;
      // Individual reaction time: distance plus personality, so herds don't move in lockstep.
      o.alarmAt = now + 0.15 + d / 340 + this.rng.next() * 0.9 * (1.2 - o.personality.flightiness * 0.5);
      o.alarmX = x;
      o.alarmZ = z;
      o.alarmPlayer = fromPlayer;
    }
  }

  private abstractTick(dt: number, ctx: EcoContext): void {
    const env = this.env;
    const now = env.state.time;
    const activeSet = new Set(this.active);
    this.rebuildIndexes();

    // Vegetation regrowth and fire damage.
    const growth = env.growthFactor;
    for (const e of Object.values(this.sectors)) {
      const cap = now < e.scorchedUntil ? e.cap * 0.1 : e.cap;
      e.forage += (cap - e.forage) * Math.min(1, 0.0004 * dt * growth);
      if (e.forage > cap) e.forage = cap;
    }
    for (const f of env.state.fires) {
      const e = this.sectorEco(f.x, f.z);
      e.forage *= 0.9;
      e.scorchedUntil = now + DAY * 3;
    }

    // Disease outbreak: assign to the most common species in the area.
    const outbreak = env.state.disease;
    if (outbreak && !outbreak.speciesId) {
      const counts = new Map<string, number>();
      for (const a of this.animals.values())
        if (a.alive && Math.hypot(a.x - outbreak.x, a.z - outbreak.z) < outbreak.r) counts.set(a.speciesId, (counts.get(a.speciesId) ?? 0) + 1);
      let best = '';
      let bc = 2;
      counts.forEach((c, id) => {
        if (c > bc) {
          bc = c;
          best = id;
        }
      });
      outbreak.speciesId = best || 'none';
    }

    for (const a of [...this.animals.values()]) {
      if (!a.alive) {
        if (now - a.diedAt > CARCASS_LIFETIME || a.meat <= 0.5) {
          this.animals.delete(a.id);
          this.brain.forget(a.id);
        }
        continue;
      }
      const sp = SPECIES[a.speciesId];
      if (outbreak && outbreak.speciesId === a.speciesId && Math.hypot(a.x - outbreak.x, a.z - outbreak.z) < outbreak.r)
        a.disease = clamp(a.disease + dt * 0.0006, 0, 0.6);
      if (this.rng.next() < 0.02) pruneMemory(a, now);

      if (!activeSet.has(a)) this.abstractAnimal(a, sp, dt, ctx);
      if (!a.alive) continue;
      this.maybeBreed(a, sp, now);
      this.maybeAgeDeath(a, sp, now, dt);
    }

    for (const n of [...this.nests.values()]) {
      if (now < n.hatchAt) continue;
      this.nests.delete(n.id);
      const sp = SPECIES[n.speciesId];
      const parent = this.animals.get(n.parentId);
      const survival = 0.35 + sp.reproduction.parentalCare * 0.5 * (parent?.alive ? 1 : 0.3);
      const groupId = parent?.alive ? n.groupId : this.newId('g');
      for (let i = 0; i < n.eggs; i++) {
        if (this.animals.size >= MAX_ANIMALS || !this.rng.chance(survival)) continue;
        const a = createAnimal({
          id: this.newId('a'), speciesId: n.speciesId, x: n.x + this.rng.range(-2, 2), z: n.z + this.rng.range(-2, 2),
          bornAt: now, groupId, parentId: parent?.alive ? parent.id : null, rng: this.rng,
        });
        a.y = this.terrain.height(a.x, a.z);
        this.animals.set(a.id, a);
      }
    }
  }

  private abstractAnimal(a: AnimalData, sp: SpeciesDef, dt: number, ctx: EcoContext): void {
    const now = this.env.state.time;
    AnimalBrain.updateNeeds(a, sp, dt, 0);
    const eco = this.sectorEco(a.x, a.z);
    if (a.tame) {
      // Tamed animals left at the base: drink if water is near, graze/rest, stay around their anchor.
      if (a.thirst > 0.45 && eco.water) a.thirst = Math.max(0, a.thirst - 0.4);
      if (a.hunger > 0.45 && !isPredator(sp) && eco.cap > 0) a.hunger = Math.max(0, a.hunger - 0.2 * (eco.forage / eco.cap));
      const t = a.tame;
      if (t.command !== 'follow' && Math.hypot(a.x - t.anchorX, a.z - t.anchorZ) > 20) {
        a.x += (t.anchorX - a.x) * 0.2;
        a.z += (t.anchorZ - a.z) * 0.2;
        a.y = this.terrain.height(a.x, a.z);
      }
      a.state = a.fatigue > 0.7 ? 'rest' : 'idle';
      return;
    }

    // Thirst: water in this or adjacent sectors.
    if (a.thirst > 0.45) {
      if (eco.water || sp.locomotion.flies) a.thirst = Math.max(0, a.thirst - 0.4);
      else this.migrateHome(a, sp, true);
    }
    // Hunger.
    if (a.hunger > 0.4) {
      if (!isPredator(sp)) {
        const ratio = eco.cap > 0 ? eco.forage / eco.cap : 0;
        a.hunger = Math.max(0, a.hunger - 0.25 * ratio);
        eco.forage = Math.max(0, eco.forage - 0.004 * Math.sqrt(sp.massKg / 1000) * sp.foodNeed);
        if (ratio < 0.25) this.migrateHome(a, sp, false);
      } else if (this.rng.chance(0.06)) {
        const prey = this.findAbstractPrey(a, sp);
        if (prey) {
          this.kill(prey, a.speciesId);
          a.hunger = 0.1;
          remember(a, { kind: 'chaseWon', x: prey.x, z: prey.z, strength: 0.6, subject: prey.speciesId }, now);
        } else if (a.hunger > 0.75) this.migrateHome(a, sp, false);
      }
    }
    // Health bookkeeping (starvation, thirst, recovery).
    const mh = maxHealth(a, now);
    if (a.hunger >= 1 || a.thirst >= 1) a.health -= mh * 0.002 * dt;
    else a.health = Math.min(mh, a.health + mh * 0.001 * dt);
    a.health -= a.disease * mh * 0.0008 * dt;
    if (a.health <= 0) {
      this.kill(a, a.disease > 0.3 ? 'disease' : a.thirst >= 1 ? 'thirst' : 'starvation');
      return;
    }
    // Hazards push animals out of the area.
    for (const h of this.hazards) {
      if (Math.hypot(a.x - h.x, a.z - h.z) < h.r + 80) {
        const ang = Math.atan2(a.x - h.x, a.z - h.z);
        a.homeX = h.x + Math.sin(ang) * (h.r + 250);
        a.homeZ = h.z + Math.cos(ang) * (h.r + 250);
      }
    }
    // Coarse movement: followers stay with the leader, leaders wander around home.
    const leader = this.leaders.get(a.groupId);
    let tx = a.homeX;
    let tz = a.homeZ;
    if (leader && leader !== a) {
      tx = leader.x;
      tz = leader.z;
      a.homeX = leader.homeX;
      a.homeZ = leader.homeZ;
    }
    const d = Math.hypot(tx - a.x, tz - a.z);
    const step = Math.min(d, sp.walkSpeed * dt * 0.6);
    if (d > 0.1) {
      const ang = Math.atan2(tx - a.x, tz - a.z) + this.rng.gauss(0, 0.6);
      const nx = a.x + Math.sin(ang) * step;
      const nz = a.z + Math.cos(ang) * step;
      const h = this.terrain.height(nx, nz);
      if (sp.locomotion.aquatic) {
        if (h < AQUATIC_MIN_DEPTH) {
          a.x = nx;
          a.z = nz;
          a.heading = ang;
          a.y = swimDepth(a, this.env.state.time, h);
        }
      } else if (h > -0.5 || sp.locomotion.swims || sp.locomotion.flies) {
        a.x = nx;
        a.z = nz;
        a.heading = ang;
        a.y = Math.max(h, sp.locomotion.swims ? -sp.hipHeightM * 0.8 : h);
      }
    }
    // Abstract animals far from the player never wander into the player's active bubble faster than real-time
    if (Math.hypot(a.x - ctx.player.x, a.z - ctx.player.z) < ACTIVE_RADIUS * 0.6) {
      /* will become active next frame; nothing special needed */
    }
    a.state = a.fatigue > 0.7 ? 'rest' : 'wander';
  }

  private findAbstractPrey(a: AnimalData, sp: SpeciesDef): AnimalData | null {
    const now = this.env.state.time;
    const myMass = effectiveMass(a, now);
    const sx = sectorOf(a.x);
    const sz = sectorOf(a.z);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const list = this.sectorIndex.get(sectorKey(sx + dx, sz + dz));
        if (!list) continue;
        for (const o of list) {
          if (!o.alive || o.groupId === a.groupId || o.speciesId === a.speciesId) continue;
          const osp = SPECIES[o.speciesId];
          if (isPredator(osp) || osp.locomotion.flies || o.tame) continue;
          const om = effectiveMass(o, now);
          const pack = sp.social.type === 'pack' ? 3 : 1;
          if (om < myMass * 1.1 * pack && om > myMass * 0.004) {
            // Vulnerable individuals are much more likely to be caught.
            const vuln = (lifeStage(o, now) === 'juvenile' ? 0.6 : 0.15) + (1 - o.health / maxHealth(o, now)) * 0.5;
            if (this.rng.chance(vuln)) return o;
          }
        }
      }
    return null;
  }

  /** Moves an animal's home range to a better neighbouring sector (only local knowledge). */
  private migrateHome(a: AnimalData, sp: SpeciesDef, needWater: boolean): void {
    const S = WORLD.sectorSize;
    const sx = sectorOf(a.homeX);
    const sz = sectorOf(a.homeZ);
    let best: [number, number] | null = null;
    let bs = -Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const x = (sx + dx + 0.5) * S;
        const z = (sz + dz + 0.5) * S;
        if (this.terrain.height(x, z) < -1 && !sp.locomotion.swims && !sp.locomotion.flies) continue;
        if (sp.locomotion.aquatic && this.terrain.height(x, z) > AQUATIC_MIN_DEPTH) continue;
        const e = this.sectorEco(x, z);
        let s = needWater ? (e.water ? 2 : 0) : isPredator(sp) ? (this.sectorIndex.get(sectorKey(sx + dx, sz + dz))?.length ?? 0) : e.forage;
        if (!sp.habitat.includes(this.terrain.biomeAt(x, z))) s -= 0.3;
        s += this.rng.next() * 0.2;
        if (s > bs) {
          bs = s;
          best = [x, z];
        }
      }
    if (best) {
      a.homeX = best[0];
      a.homeZ = best[1];
    }
  }

  private maybeBreed(a: AnimalData, sp: SpeciesDef, now: number): void {
    if (a.tame || a.sex !== 'f' || lifeStage(a, now) !== 'adult') return;
    const doy = this.env.dayOfYear;
    const [s0, s1] = sp.reproduction.season;
    if (doy < s0 || doy > s1) return;
    if (a.hunger > 0.5 || a.thirst > 0.6 || a.health < maxHealth(a, now) * 0.7) return;
    if (now - a.lastBredAt < DAY * WORLD.daysPerYear * 0.6) return;
    if (this.animals.size > MAX_ANIMALS * 0.85) return;
    // Needs a mate of the same species nearby and local population below carrying capacity.
    let mates = 0;
    let local = 0;
    for (const o of this.sectorIndex.get(sectorKey(sectorOf(a.x), sectorOf(a.z))) ?? []) {
      if (o.speciesId !== a.speciesId || !o.alive) continue;
      local++;
      if (o.sex === 'm' && lifeStage(o, now) === 'adult') mates++;
    }
    if (!mates || local > sp.social.size[1] * 2.5) return;
    if (!this.rng.chance(0.08)) return;
    a.lastBredAt = now;
    if (sp.locomotion.aquatic) {
      // Mosasaurs were viviparous (embryos are known inside mothers): live young, no nest.
      const n = this.rng.int(sp.reproduction.clutch[0], sp.reproduction.clutch[1]);
      for (let i = 0; i < n; i++) {
        const c = createAnimal({ id: this.newId('a'), speciesId: a.speciesId, x: a.x + this.rng.range(-3, 3), z: a.z + this.rng.range(-3, 3), bornAt: now, groupId: a.groupId, parentId: a.id, rng: this.rng });
        c.homeX = a.homeX;
        c.homeZ = a.homeZ;
        c.y = a.y;
        this.animals.set(c.id, c);
      }
      return;
    }
    const n: Nest = {
      id: this.newId('n'), speciesId: a.speciesId, x: a.x, z: a.z,
      eggs: this.rng.int(sp.reproduction.clutch[0], sp.reproduction.clutch[1]),
      laidAt: now, hatchAt: now + sp.reproduction.incubationDays * DAY, parentId: a.id, groupId: a.groupId,
    };
    this.nests.set(n.id, n);
    a.homeX = n.x;
    a.homeZ = n.z;
  }

  private maybeAgeDeath(a: AnimalData, sp: SpeciesDef, now: number, dt: number): void {
    const lifespan = sp.reproduction.maturityDays * DAY * 6;
    const age = now - a.bornAt;
    if (age > lifespan && this.rng.chance(dt / (DAY * 4))) this.kill(a, 'age');
  }

  /** Population counts per species (for diagnostics and the field journal). */
  census(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.animals.values()) if (a.alive) out[a.speciesId] = (out[a.speciesId] ?? 0) + 1;
    return out;
  }
}

export { PLAYER_ID };

