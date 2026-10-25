import { clamp } from '../core/math';
import type { Rng } from '../core/rng';
import type { AnimalData, Personality } from './animal';

/**
 * Heredity: each animal carries a few genes (body size, top speed) and a
 * personality. Young born in the wild take the average of their
 * mother and father with some variation, and now and then a mutation; the
 * generation count grows by one. Animals created by the world (seeding) get
 * random genes around 1.
 */
export interface Genes {
  /** Body size multiplier (0.85..1.18). */
  size: number;
  /** Top speed multiplier (0.9..1.1). */
  speed: number;
  /** Generations since the world began (seeded animals are 0). */
  generation: number;
}

export const GENE_RANGE = { size: [0.85, 1.18], speed: [0.9, 1.1] } as const;
export const MUTATION_CHANCE = 0.03;

export function randomGenes(rng: Rng): Genes {
  return {
    size: clamp(rng.gauss(1, 0.04), GENE_RANGE.size[0], GENE_RANGE.size[1]),
    speed: clamp(rng.gauss(1, 0.025), GENE_RANGE.speed[0], GENE_RANGE.speed[1]),
    generation: 0,
  };
}

export function genesOf(a: AnimalData): Genes {
  return a.genes ?? { size: 1, speed: 1, generation: 0 };
}

/** Child genes from both parents (father optional: unknown father = mother's line only). */
export function inherit(mother: AnimalData, father: AnimalData | null, rng: Rng): { genes: Genes; personality: Partial<Personality>; mutated: boolean } {
  const m = genesOf(mother);
  const f = father ? genesOf(father) : m;
  const mix = (x: number, y: number, sd: number) => (x + y) / 2 + rng.gauss(0, sd);
  const mutated = rng.chance(MUTATION_CHANCE);
  const genes: Genes = {
    size: clamp(mix(m.size, f.size, 0.02) + (mutated ? (rng.chance(0.5) ? 0.08 : -0.06) : 0), GENE_RANGE.size[0], GENE_RANGE.size[1]),
    speed: clamp(mix(m.speed, f.speed, 0.015) + (mutated ? rng.range(-0.04, 0.05) : 0), GENE_RANGE.speed[0], GENE_RANGE.speed[1]),
    generation: Math.max(m.generation, f.generation) + 1,
  };
  const pm = mother.personality;
  const pf = father?.personality ?? pm;
  const trait = (a: number, b: number) => clamp((a + b) / 2 + rng.gauss(0, 0.08), 0, 1);
  return {
    genes,
    personality: {
      courage: trait(pm.courage, pf.courage),
      aggression: trait(pm.aggression, pf.aggression),
      curiosity: trait(pm.curiosity, pf.curiosity),
      sociability: trait(pm.sociability, pf.sociability),
    },
    mutated,
  };
}

/** Applies inherited genes and temperament to a newborn. */
export function applyInheritance(child: AnimalData, mother: AnimalData, father: AnimalData | null, rng: Rng): void {
  const r = inherit(mother, father, rng);
  child.genes = r.genes;
  Object.assign(child.personality, r.personality);
  child.fatherId = father?.id ?? null;
}

/**
 * Rank score inside a group: alphas first, then adults over young, then
 * strength (size, courage, aggression), then age. The highest score leads.
 */
export function rankScore(a: AnimalData, adult: boolean): number {
  const g = genesOf(a);
  return (adult ? 100 : 0) + (a.alpha ? 50 : 0) + (a.sex === 'm' ? 3 : 0) + g.size * 10 + a.personality.courage * 5 + a.personality.aggression * 4 - a.bornAt * 1e-7;
}

/** Old age: the last fifth of the lifespan (slower, the body tires). */
export function isElder(a: AnimalData, lifespanSeconds: number, now: number): boolean {
  return now - a.bornAt > lifespanSeconds * 0.8;
}

/** Sanitises loaded genes (old saves have none; bad values fall back to average). */
export function sanitizeGenes(g: unknown): Genes | undefined {
  if (!g || typeof g !== 'object') return undefined;
  const o = g as Record<string, unknown>;
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
  return { size: n(o.size, GENE_RANGE.size[0], GENE_RANGE.size[1], 1), speed: n(o.speed, GENE_RANGE.speed[0], GENE_RANGE.speed[1], 1), generation: Math.round(n(o.generation, 0, 1e6, 0)) };
}
