import { WORLD } from '../core/config';
import { growthScale, lifeStage, type AnimalData } from '../animals/animal';
import type { Ecosystem } from '../animals/ecosystem';
import { SPECIES, isPredator } from '../animals/species';
import type { TroughAccess } from '../ai/brain';
import { storageAdd, storageTakeOne, type Building } from '../building/building';
import type { Progression } from '../progression/skills';
import { canUse } from './profiles';
import { careTick, defaultName, gatherYield, observeTick, satiety } from './taming';

/**
 * Game-side glue for domestication: troughs, gatherers, pack animals, scouts,
 * passive (observation) taming, care, breeding in nest boxes and riding.
 */
export interface TamingHost {
  eco: Ecosystem;
  building: Building;
  progression: Progression;
  now: number;
  player: { x: number; z: number; quiet: boolean; hostile: boolean; alive: boolean };
  language: 'pt-BR' | 'en';
  notify(key: string, params?: Record<string, string | number>, kind?: 'info' | 'warn' | 'good'): void;
  xp(tree: 'taming', amount: number): void;
  reveal(x: number, z: number, radius: number): void;
}

const PLANT_FOOD = ['feed_mix', 'berries', 'cycad_fronds', 'fern_fronds', 'herb'];
const MEAT_FOOD = ['raw_meat', 'cooked_meat', 'raw_fish'];
const DAY = WORLD.dayLengthSeconds;

export class TamingController {
  private acc = 0;
  private breedAcc = 0;

  tamed(eco: Ecosystem): AnimalData[] {
    const out: AnimalData[] = [];
    for (const a of eco.animals.values()) if (a.alive && a.tame) out.push(a);
    return out;
  }

  /** Feeding trough access for the brain (nearest trough with suitable food within 60 m). */
  troughFor(building: Building, a: AnimalData): TroughAccess | null {
    const sp = SPECIES[a.speciesId];
    const foods = sp.diet === 'herbivore' ? PLANT_FOOD : sp.diet === 'omnivore' ? [...PLANT_FOOD, ...MEAT_FOOD] : MEAT_FOOD;
    let best: { x: number; z: number; slots: NonNullable<ReturnType<Building['nearest']>>['storage'] } | null = null;
    let bd = 60;
    for (const p of building.pieces.values()) {
      if (p.type !== 'feeding_trough' || !p.storage) continue;
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      if (d < bd && p.storage.some((s) => s && foods.includes(s.id))) {
        bd = d;
        best = { x: p.x, z: p.z, slots: p.storage };
      }
    }
    if (!best) return null;
    const slots = best.slots!;
    return {
      x: best.x,
      z: best.z,
      eat: () => {
        const id = storageTakeOne(slots, foods);
        return id ? satiety(a.speciesId, id) * 1.4 : 0;
      },
    };
  }

  /** Extra carrying capacity from following pack animals near the player. */
  packCapacity(eco: Ecosystem, px: number, pz: number, now: number): number {
    let c = 0;
    for (const a of eco.active) {
      if (!a.tame || !a.alive || a.tame.command !== 'follow' || !canUse(a.speciesId, 'pack')) continue;
      if (lifeStage(a, now) !== 'adult' || Math.hypot(a.x - px, a.z - pz) > 30) continue;
      c += 40;
    }
    return Math.min(80, c);
  }

  update(dt: number, h: TamingHost): void {
    const eco = h.eco;
    // Passive trust for observation species near the player (every frame, cheap).
    for (const a of eco.active) {
      if (a.tame || !a.alive) continue;
      const d = Math.hypot(a.x - h.player.x, a.z - h.player.z);
      if (d > 50) continue;
      const became = observeTick(a, dt, { now: h.now, dist: d, perceived: a.state === 'alert' || a.state === 'investigate' || d < 30, quiet: h.player.quiet, hostile: h.player.hostile, rate: h.progression.tamingRate() });
      if (became) h.notify('tame.ready', { what: SPECIES[a.speciesId].name[h.language] }, 'good');
    }
    // Scouting flyers reveal the map around them.
    for (const a of eco.active) {
      if (a.tame && a.alive && a.tame.command === 'follow' && canUse(a.speciesId, 'scout')) h.reveal(a.x, a.z, 220);
    }

    this.acc += dt;
    if (this.acc < 2) return;
    const step = this.acc;
    this.acc = 0;
    for (const a of this.tamed(eco)) {
      // Caretaker skill slows needs of tamed animals (partially undoes the drift).
      const relief = 1 - h.progression.tamedNeeds();
      if (relief > 0) {
        a.hunger = Math.max(0, a.hunger - (step / (DAY * 1.2)) * relief);
        a.thirst = Math.max(0, a.thirst - (step / (DAY * 0.8)) * relief);
      }
      // Animals at the base eat from troughs even when not simulated in detail.
      if (a.hunger > 0.55 && !eco.active.includes(a)) {
        const tr = this.troughFor(h.building, a);
        if (tr) a.hunger = Math.max(0, a.hunger - tr.eat());
      }
      const name = a.tame!.name;
      if (careTick(a, step, h.now, h.progression.bondRate()) === 'left') h.notify('tame.left', { name }, 'warn');
      else this.gather(a, h);
    }
    this.breedAcc += step;
    if (this.breedAcc >= 10) {
      this.breedAcc = 0;
      this.breed(h);
    }
  }

  private gather(a: AnimalData, h: TamingHost): void {
    const t = a.tame!;
    if (!canUse(a.speciesId, 'gatherer') || t.command === 'follow' || lifeStage(a, h.now) === 'juvenile') return;
    if (h.now - t.gatheredAt < 300) return;
    t.gatheredAt = h.now;
    const box = h.building.nearest(a.x, a.z, 40, (p) => (p.type === 'storage' || p.type === 'feeding_trough') && !!p.storage);
    if (!box?.storage) return;
    for (const [id, q] of Object.entries(gatherYield(a.speciesId))) storageAdd(box.storage, { id, qty: q });
    h.xp('taming', 2);
  }

  /** Tamed adult pairs near an empty nest box may produce an egg. */
  private breed(h: TamingHost): void {
    const tamed = this.tamed(h.eco).filter((a) => lifeStage(a, h.now) === 'adult' && a.tame!.bond > 0.5 && a.hunger < 0.5 && a.thirst < 0.6);
    for (const f of tamed) {
      if (f.sex !== 'f' || h.now - f.lastBredAt < DAY * 2) continue;
      const sp = SPECIES[f.speciesId];
      const doy = Math.floor(h.now / DAY) % WORLD.daysPerYear;
      const inSeason = doy >= sp.reproduction.season[0] && doy <= sp.reproduction.season[1];
      if (!inSeason && !h.progression.has('breeder')) continue;
      const mate = tamed.find((m) => m.sex === 'm' && m.speciesId === f.speciesId && Math.hypot(m.x - f.x, m.z - f.z) < 20);
      if (!mate) continue;
      const box = h.building.nearest(f.x, f.z, 25, (p) => p.type === 'nest_box' && !p.egg);
      if (!box) continue;
      if (Math.random() > 0.25) continue;
      f.lastBredAt = h.now;
      h.building.incubate(box.id, f.speciesId);
      h.notify('tame.egg', { what: sp.name[h.language] }, 'good');
      h.xp('taming', 30);
    }
  }

  /** Called for nest boxes whose egg finished incubating. */
  hatch(h: TamingHost, boxId: string): AnimalData | null {
    const box = h.building.pieces.get(boxId);
    if (!box?.egg) return null;
    const sp = box.egg.sp;
    box.egg = null;
    const a = h.eco.hatchTamed(sp, box.x + 1, box.z, defaultName(sp, h.language));
    h.notify('tame.hatched', { what: SPECIES[sp].name[h.language] }, 'good');
    h.xp('taming', 50);
    return a;
  }

  /** Ride speed for the mount given the rider's input. */
  static mountSpeed(a: AnimalData, forward: number, sprint: boolean, mountMul: number, now: number): number {
    const sp = SPECIES[a.speciesId];
    if (forward <= 0.05) return 0;
    const g = growthScale(a, now);
    return (sprint ? sp.runSpeed * mountMul : Math.max(sp.walkSpeed * 1.6, 3)) * forward * (0.6 + 0.4 * g);
  }

  static isCarnivore(a: AnimalData): boolean {
    return isPredator(SPECIES[a.speciesId]);
  }
}
