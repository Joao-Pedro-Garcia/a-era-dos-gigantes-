import type { AnimalData } from '../animals/animal';
import { SPECIES } from '../animals/species';

/**
 * Combat rules shared by the player, traps and companions: species armour,
 * weapon types and wound reactions. Damage is resolved here so every source
 * of harm follows the same rules.
 */
export type DamageKind = 'blunt' | 'cut' | 'pierce' | 'arrow' | 'trap' | 'shock' | 'bite';

/** Fraction of damage absorbed by hide, armour plates, scutes or sheer bulk. */
export const SPECIES_ARMOR: Record<string, number> = {
  ankylosaurus: 0.6, sarcosuchus: 0.45, stegosaurus: 0.3, triceratops: 0.35, pachyrhinosaurus: 0.3, brachiosaurus: 0.25,
  tyrannosaurus: 0.25, spinosaurus: 0.2, allosaurus: 0.15, carnotaurus: 0.15, therizinosaurus: 0.15, iguanodon: 0.15,
  parasaurolophus: 0.1, mosasaurus: 0.2, baryonyx: 0.15, pachycephalosaurus: 0.2, protoceratops: 0.15,
};

/** How much of the armour a damage kind ignores. */
const PENETRATION: Record<DamageKind, number> = { blunt: 0.4, cut: 0, pierce: 0.35, arrow: 0.25, trap: 0.5, shock: 1, bite: 0.2 };

export function armorOf(speciesId: string): number {
  return SPECIES_ARMOR[speciesId] ?? 0.05;
}

export function resolveDamage(target: AnimalData, raw: number, kind: DamageKind): number {
  const armor = armorOf(target.speciesId) * (1 - PENETRATION[kind]);
  return Math.max(0, raw * (1 - armor));
}

/** Weapon damage kind from the held item id. */
export function weaponKind(itemId: string | null | undefined): DamageKind {
  if (!itemId) return 'blunt';
  if (itemId.includes('spear')) return 'pierce';
  if (itemId.includes('knife') || itemId.includes('axe')) return 'cut';
  if (itemId === 'arrow' || itemId === 'bow') return 'arrow';
  return 'blunt';
}

/** Small animals that a snare can hold. */
export const snareable = (a: AnimalData): boolean => SPECIES[a.speciesId].massKg <= 150 && !SPECIES[a.speciesId].locomotion.flies;
