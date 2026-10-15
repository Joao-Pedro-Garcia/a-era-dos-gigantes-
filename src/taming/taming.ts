import { clamp } from '../core/math';
import { lifeStage, type AnimalData, type TameCommand } from '../animals/animal';
import { SPECIES, isPredator } from '../animals/species';
import { recallSubject, remember } from '../ai/memory';
import { TAME_PROFILES, canUse } from './profiles';

/**
 * Trust-based domestication. Animals are never "captured": they come to
 * accept the player through calm repeated contact (feeding or observation)
 * or by hatching from an egg cared for by the player (imprinting). Tamed
 * animals keep their personality and needs; obedience is trained, not given.
 */
export type FeedResult = 'accepted' | 'tamed' | 'fed' | 'notHungry' | 'scared' | 'wrongFood' | 'tooSoon' | 'untameable' | 'imprintOnly';

const FEED_COOLDOWN = 12;
/** Last feeding per wild animal (runtime only; resets on reload, which only shortens one cooldown). */
const feedTimes = new Map<string, number>();

/** How much an animal likes an offered item (0 = refuses). */
export function foodValue(speciesId: string, itemId: string): number {
  const sp = SPECIES[speciesId];
  if (sp.taming.preferredFood.includes(itemId)) return 1;
  const herb = sp.diet === 'herbivore' || sp.diet === 'omnivore';
  const meat = sp.diet !== 'herbivore';
  if (herb && itemId === 'feed_mix') return 1.4;
  if (herb && ['berries', 'cycad_fronds', 'fern_fronds', 'herb'].includes(itemId)) return 0.45;
  if (meat && ['raw_meat', 'cooked_meat'].includes(itemId)) return sp.diet === 'piscivore' ? 0.6 : 0.8;
  if (meat && itemId === 'raw_fish') return sp.diet === 'piscivore' ? 1.2 : 0.5;
  return 0;
}

/** Hunger relief from one portion of food for this animal. */
export function satiety(speciesId: string, itemId: string): number {
  const v = foodValue(speciesId, itemId);
  return v > 0 ? clamp(0.12 + 0.35 / Math.sqrt(Math.max(1, SPECIES[speciesId].massKg / 50)), 0.02, 0.5) * v : 0;
}

export function isScared(a: AnimalData, now: number): boolean {
  if (a.state === 'flee' || (a.state === 'defend' && a.targetId === '__player__')) return true;
  if (a.fear > 0.6 && !(a.heldUntil && a.heldUntil > now)) return true;
  return a.trustPlayer < -0.3 || recallSubject(a, 'injured', 'player', now) > 1.2;
}

export function offerFood(a: AnimalData, itemId: string, now: number, rate = 1): FeedResult {
  const sp = SPECIES[a.speciesId];
  const prof = TAME_PROFILES[a.speciesId];
  if (!a.alive) return 'untameable';
  const value = foodValue(a.speciesId, itemId);
  if (value <= 0) return 'wrongFood';
  if (a.tame) {
    if (a.hunger < 0.08) return 'notHungry';
    a.hunger = clamp(a.hunger - satiety(a.speciesId, itemId) * 1.5, 0, 1);
    a.tame.bond = clamp(a.tame.bond + 0.04 * value, 0, 1);
    a.tame.fedAt = now;
    return 'fed';
  }
  if (!prof || prof.method === 'none') return 'untameable';
  if (prof.method === 'imprint') return 'imprintOnly';
  if (isScared(a, now)) return 'scared';
  if (a.hunger < 0.15) return 'notHungry';
  const last = feedTimes.get(a.id) ?? -1e9;
  if (now - last < FEED_COOLDOWN) return 'tooSoon';
  feedTimes.set(a.id, now);
  const method = prof.method === 'observation' ? 0.5 : 1;
  const gain = 0.12 * (1 - sp.taming.difficulty * 0.6) * Math.min(1.4, value) * rate * (0.5 + a.hunger) * method;
  a.tameProgress = clamp(a.tameProgress + gain, 0, 1);
  a.hunger = clamp(a.hunger - satiety(a.speciesId, itemId), 0, 1);
  a.trustPlayer = clamp(a.trustPlayer + 0.05, -1, 1);
  a.habituation = clamp(a.habituation + 0.05, 0, 1);
  a.fear = Math.max(0, a.fear - 0.2);
  remember(a, { kind: 'peaceful', x: a.x, z: a.z, strength: 0.5, subject: 'player' }, now);
  return a.tameProgress >= 1 ? 'tamed' : 'accepted';
}

export interface ObserveContext {
  now: number;
  dist: number;
  perceived: boolean;
  quiet: boolean;
  hostile: boolean;
  rate: number;
}

/** Passive trust for observation-tamed species. Returns true when it just became tameable. */
export function observeTick(a: AnimalData, dt: number, c: ObserveContext): boolean {
  if (a.tame || !a.alive || TAME_PROFILES[a.speciesId]?.method !== 'observation') return false;
  if (c.hostile) {
    a.tameProgress = Math.max(0, a.tameProgress - 0.2 * dt);
    return false;
  }
  if (!c.perceived || c.dist < 6 || c.dist > 45 || !c.quiet || isScared(a, c.now)) return false;
  const sp = SPECIES[a.speciesId];
  const before = a.tameProgress;
  a.tameProgress = clamp(a.tameProgress + dt * 0.0045 * (1 - sp.taming.difficulty * 0.6) * c.rate * (0.6 + a.personality.curiosity), 0, 1);
  a.habituation = clamp(a.habituation + dt * 0.002, 0, 1);
  return before < 1 && a.tameProgress >= 1;
}

let nameCounter = 0;
export function defaultName(speciesId: string, lang: 'pt-BR' | 'en'): string {
  nameCounter++;
  const base = SPECIES[speciesId].name[lang];
  return `${base} ${nameCounter}`;
}

export function makeTame(a: AnimalData, name: string, now: number, imprinted: boolean, anchorX = a.x, anchorZ = a.z): void {
  a.tame = {
    name, obedience: imprinted ? 0.35 : 0.15, bond: imprinted ? 0.7 : 0.4, command: 'follow', anchorX, anchorZ,
    imprinted, fedAt: now, trainedAt: now, gatheredAt: now,
  };
  a.tameProgress = 1;
  a.groupId = `tame-${a.id}`;
  a.trustPlayer = Math.max(a.trustPlayer, 0.6);
  a.habituation = 1;
  a.fear = 0;
  a.state = 'idle';
  a.targetId = null;
}

/** Chance the animal follows a command right now (personality, needs, training). */
export function obeyChance(a: AnimalData): number {
  if (!a.tame) return 0;
  let p = 0.4 + a.tame.obedience * 0.5 + a.tame.bond * 0.15;
  if (a.hunger > 0.75 || a.thirst > 0.75) p -= 0.3;
  p -= a.fear * 0.4;
  p -= (1 - a.personality.sociability) * 0.1;
  return clamp(p, 0.05, 0.98);
}

export function issueCommand(a: AnimalData, cmd: TameCommand, now: number, roll: number, playerX: number, playerZ: number, bondRate = 1): 'obeyed' | 'ignored' {
  if (!a.tame) return 'ignored';
  if (roll > obeyChance(a)) return 'ignored';
  a.tame.command = cmd;
  if (cmd !== 'follow') {
    a.tame.anchorX = cmd === 'stay' ? a.x : playerX;
    a.tame.anchorZ = cmd === 'stay' ? a.z : playerZ;
  }
  // Training: successful, well-spaced commands raise obedience with diminishing returns.
  if (now - a.tame.trainedAt > 5) {
    a.tame.obedience = clamp(a.tame.obedience + 0.03 * bondRate * (1 - a.tame.obedience), 0, 1);
    a.tame.trainedAt = now;
  }
  return 'obeyed';
}

/** Slow care loop. Returns 'left' if neglect made the animal leave. */
export function careTick(a: AnimalData, dt: number, now: number, bondRate = 1): 'ok' | 'left' {
  const t = a.tame;
  if (!t) return 'ok';
  if (a.hunger > 0.9 || a.thirst > 0.9) t.bond = clamp(t.bond - dt * 0.0004, 0, 1);
  else if (a.hunger < 0.5 && a.thirst < 0.5) t.bond = clamp(t.bond + dt * 0.00005 * bondRate, 0, 1);
  if (t.bond <= 0) {
    release(a, now);
    return 'left';
  }
  return 'ok';
}

/** Harm from the player strains or breaks the bond. */
export function hurtByPlayer(a: AnimalData, now: number): 'ok' | 'left' {
  if (!a.tame) {
    a.tameProgress = Math.max(0, a.tameProgress - 0.4);
    return 'ok';
  }
  a.tame.bond -= 0.3;
  a.tame.obedience = Math.max(0, a.tame.obedience - 0.1);
  if (a.tame.bond <= 0) {
    release(a, now);
    remember(a, { kind: 'threat', x: a.x, z: a.z, strength: 1, subject: 'player' }, now);
    return 'left';
  }
  return 'ok';
}

export function release(a: AnimalData, now: number): void {
  a.tame = null;
  a.tameProgress = 0.3;
  a.groupId = `g-wild-${a.id}`;
  a.homeX = a.x;
  a.homeZ = a.z;
  void now;
}

export function canMount(a: AnimalData, now: number): boolean {
  return !!a.tame && a.alive && canUse(a.speciesId, 'mount') && lifeStage(a, now) === 'adult' && a.tame.obedience >= 0.3 && a.tame.bond >= 0.3;
}

/** Whether a tamed animal will help in a fight. */
export function willDefend(a: AnimalData, now: number): boolean {
  if (!a.tame || lifeStage(a, now) === 'juvenile') return false;
  const fighter = canUse(a.speciesId, 'companion') || canUse(a.speciesId, 'guard');
  return fighter && a.personality.courage + a.tame.bond * 0.3 > 0.4;
}

/** What a gatherer collects for the base. */
export function gatherYield(speciesId: string): Record<string, number> {
  const sp = SPECIES[speciesId];
  if (sp.diet === 'piscivore' || sp.locomotion.flies) return { raw_fish: 1 };
  if (isPredator(sp)) return { bone: 1 };
  return { berries: 2, fiber: 2 };
}
