import { Rng } from '../core/rng';
import { clamp } from '../core/math';
import { SPECIES, type SpeciesDef } from './species';

export type AIState =
  | 'ridden'
  | 'idle' | 'wander' | 'graze' | 'drink' | 'rest' | 'follow' | 'alert' | 'investigate'
  | 'flee' | 'hunt' | 'eat' | 'defend' | 'shelter' | 'nest';

export type MemoryKind = 'threat' | 'danger' | 'food' | 'water' | 'peaceful' | 'chaseFailed' | 'chaseWon' | 'injured';

export interface MemoryEntry {
  kind: MemoryKind;
  x: number;
  z: number;
  /** Game time (seconds) when last reinforced. */
  t: number;
  strength: number;
  /** 'player', a species id, or a hazard name. */
  subject?: string;
}

export interface Personality {
  curiosity: number;
  courage: number;
  aggression: number;
  sociability: number;
  tolerance: number;
  flightiness: number;
}

export type TameCommand = 'follow' | 'stay' | 'roam' | 'guard';

/** State of an animal that trusts the player enough to live with them. */
export interface TameState {
  name: string;
  /** 0..1: how reliably it follows commands (grows with training). */
  obedience: number;
  /** 0..1: emotional bond (grows with care, drops with neglect/abuse). */
  bond: number;
  command: TameCommand;
  anchorX: number;
  anchorZ: number;
  imprinted: boolean;
  /** Game time of the last feeding by the player. */
  fedAt: number;
  /** Game time of the last successful command (training). */
  trainedAt: number;
  /** Runtime-only: currently carrying the player. */
  ridden?: boolean;
  /** Game time of last gathered resource delivery. */
  gatheredAt: number;
}

export interface AnimalData {
  id: string;
  speciesId: string;
  sex: 'f' | 'm';
  /** Game time of birth (can be negative for animals seeded as adults). */
  bornAt: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  health: number;
  hunger: number;
  thirst: number;
  fatigue: number;
  stamina: number;
  fear: number;
  disease: number;
  personality: Personality;
  /** -1 hostile … 1 trusting. Only changes through experiences with the player. */
  trustPlayer: number;
  /** Tolerance gained by repeated peaceful presence. */
  habituation: number;
  memory: MemoryEntry[];
  groupId: string;
  parentId: string | null;
  homeX: number;
  homeZ: number;
  state: AIState;
  stateTime: number;
  targetId: string | null;
  tx: number;
  tz: number;
  lastAttackAt: number;
  alive: boolean;
  diedAt: number;
  /** Remaining edible meat when dead (kg-ish units). */
  meat: number;
  cause: string;
  lastBredAt: number;
  /** Pending alarm heard from a group member: when it should be processed. */
  alarmAt: number;
  alarmX: number;
  alarmZ: number;
  /** 0..1 progress toward accepting the player (taming). */
  tameProgress: number;
  tame: TameState | null;
  /** Game time until which a snare holds the animal in place. */
  heldUntil?: number;
}

export type LifeStage = 'juvenile' | 'subadult' | 'adult';

const DAY = 1200; // kept local to avoid a config import cycle in tests; must equal WORLD.dayLengthSeconds

export function ageDays(a: AnimalData, now: number): number {
  return (now - a.bornAt) / DAY;
}

export function lifeStage(a: AnimalData, now: number): LifeStage {
  const sp = SPECIES[a.speciesId];
  const r = ageDays(a, now) / sp.reproduction.maturityDays;
  return r < 0.35 ? 'juvenile' : r < 1 ? 'subadult' : 'adult';
}

/** Linear body scale relative to an adult (juveniles are small, grow over time). */
export function growthScale(a: AnimalData, now: number): number {
  const sp = SPECIES[a.speciesId];
  const r = clamp(ageDays(a, now) / sp.reproduction.maturityDays, 0, 1);
  return 0.18 + 0.82 * Math.pow(r, 0.7);
}

export function effectiveMass(a: AnimalData, now: number): number {
  const s = growthScale(a, now);
  return SPECIES[a.speciesId].massKg * s * s * s;
}

export function maxHealth(a: AnimalData, now: number): number {
  const s = growthScale(a, now);
  return SPECIES[a.speciesId].health * (0.25 + 0.75 * s);
}

export function rollPersonality(rng: Rng, sp: SpeciesDef): Personality {
  const v = (base: number) => clamp(base + rng.gauss(0, 0.15), 0, 1);
  return {
    curiosity: v(sp.temperament.curiosity),
    courage: v(1 - sp.temperament.fearfulness),
    aggression: v(sp.temperament.aggression),
    sociability: v(sp.social.type === 'solitary' ? 0.2 : 0.75),
    tolerance: v(0.5),
    flightiness: clamp(rng.gauss(1, 0.18), 0.6, 1.5),
  };
}

export interface NewAnimalOpts {
  id: string;
  speciesId: string;
  x: number;
  z: number;
  bornAt: number;
  groupId: string;
  parentId?: string | null;
  rng: Rng;
}

export function createAnimal(o: NewAnimalOpts): AnimalData {
  const sp = SPECIES[o.speciesId];
  const a: AnimalData = {
    id: o.id,
    speciesId: o.speciesId,
    sex: o.rng.chance(0.5) ? 'f' : 'm',
    bornAt: o.bornAt,
    x: o.x,
    y: 0,
    z: o.z,
    heading: o.rng.range(0, Math.PI * 2),
    speed: 0,
    health: 1,
    hunger: o.rng.range(0.1, 0.4),
    thirst: o.rng.range(0.1, 0.4),
    fatigue: o.rng.range(0, 0.3),
    stamina: 1,
    fear: 0,
    disease: 0,
    personality: rollPersonality(o.rng, sp),
    trustPlayer: 0,
    habituation: 0,
    memory: [],
    groupId: o.groupId,
    parentId: o.parentId ?? null,
    homeX: o.x,
    homeZ: o.z,
    state: 'idle',
    stateTime: 0,
    targetId: null,
    tx: o.x,
    tz: o.z,
    lastAttackAt: -1e9,
    alive: true,
    diedAt: 0,
    meat: 0,
    cause: '',
    lastBredAt: -1e9,
    alarmAt: -1,
    alarmX: 0,
    alarmZ: 0,
    tameProgress: 0,
    tame: null,
  };
  a.health = maxHealth(a, o.bornAt);
  return a;
}
