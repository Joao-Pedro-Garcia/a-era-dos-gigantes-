import { clamp } from '../core/math';
import { type Rng } from '../core/rng';
import { type AnimalData } from './animal';
import { SPECIES, type SpeciesDef } from './species';

/**
 * Alpha males: rare, larger and stronger adult males that dominate their
 * species. Their status is decided once, when the animal is created, and is
 * saved with it; the multipliers are applied where the stats are read (never
 * stacked onto the stored values), so loading a game cannot buff them twice.
 */
export const ALPHA = {
  /** Chance for each adult male created by a spawning group. */
  chance: 0.03,
  /** At most this many living alphas in the whole world. */
  maxAlive: 6,
  /** At most one alpha of a species within this radius (m). */
  regionRadius: 600,
  /** Tiny animals never become alphas. */
  minMassKg: 150,
  health: 1.8,
  damage: 1.45,
  /** Multiplier on damage taken (thicker hide, sheer bulk). */
  damageTaken: 0.8,
  speed: 1.06,
  size: 1.12,
  /** Personality boost given once, at creation. */
  courage: 0.2,
  aggression: 0.15,
  /** Distance at which alphas display to rival males (m, plus body length). */
  rivalRange: 22,
  /** Seconds two alphas display to each other before the weaker one gives way. */
  displayTime: 5,
  /** Seconds a beaten or yielding male keeps away from the alpha. */
  yieldTime: 60,
};

export function alphaEligible(sp: SpeciesDef): boolean {
  return sp.massKg >= ALPHA.minMassKg && !sp.locomotion.aquatic && !sp.locomotion.flies;
}

/** Multiplier for a stat of this individual (1 for ordinary animals). */
export function alphaMul(a: AnimalData, stat: 'health' | 'damage' | 'damageTaken' | 'speed' | 'size'): number {
  return a.alpha ? ALPHA[stat] : 1;
}

/**
 * Decides whether a newly created adult male becomes an alpha, honouring the
 * world-wide and per-region limits. Applies the one-time personality boost.
 */
export function rollAlpha(a: AnimalData, adult: boolean, rng: Rng, others: Iterable<AnimalData>): boolean {
  const sp = SPECIES[a.speciesId];
  if (!adult || a.sex !== 'm' || a.alpha || !alphaEligible(sp)) return false;
  if (!rng.chance(ALPHA.chance)) return false;
  let alive = 0;
  for (const o of others) {
    if (!o.alpha || !o.alive || o === a) continue;
    if (++alive >= ALPHA.maxAlive) return false;
    if (o.speciesId === a.speciesId && Math.hypot(o.x - a.x, o.z - a.z) < ALPHA.regionRadius) return false;
  }
  makeAlpha(a);
  return true;
}

/** Turns an animal into an alpha (once). Health is set to the new maximum by the caller. */
export function makeAlpha(a: AnimalData): void {
  if (a.alpha) return;
  a.alpha = true;
  a.personality.courage = clamp(a.personality.courage + ALPHA.courage, 0, 1);
  a.personality.aggression = clamp(a.personality.aggression + ALPHA.aggression, 0, 1);
}

/** Dominance strength used to settle displays between two alphas (no fight to the death). */
export function dominance(a: AnimalData, maxHp: number): number {
  return (a.health / Math.max(1, maxHp)) * 0.6 + a.personality.courage * 0.25 + a.personality.aggression * 0.15;
}
