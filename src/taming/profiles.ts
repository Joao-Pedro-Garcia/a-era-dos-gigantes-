/**
 * How each species can come to trust the player and what a tamed individual
 * is good for. Kept separate from the species catalogue so behavioural data
 * and domestication design can evolve independently.
 *
 * - feeding: approach calmly and offer preferred food repeatedly.
 * - observation: stay nearby, quiet and non-threatening; trust grows passively.
 * - imprint: only hatchlings raised from eggs bond with the player.
 * - none: cannot be tamed (large apex predators, giants).
 */
export type TameMethod = 'feeding' | 'observation' | 'imprint' | 'none';
export type TameUse = 'companion' | 'mount' | 'guard' | 'pack' | 'gatherer' | 'scout';

export interface TameProfile {
  method: TameMethod;
  uses: TameUse[];
  /** Mounted top speed multiplier relative to the species' run speed. */
  mountSpeed?: number;
}

export const TAME_PROFILES: Record<string, TameProfile> = {
  tyrannosaurus: { method: 'none', uses: [] },
  velociraptor: { method: 'imprint', uses: ['companion'] },
  triceratops: { method: 'feeding', uses: ['mount', 'guard'], mountSpeed: 0.85 },
  brachiosaurus: { method: 'none', uses: [] },
  ankylosaurus: { method: 'feeding', uses: ['guard'] },
  spinosaurus: { method: 'none', uses: [] },
  pteranodon: { method: 'imprint', uses: ['scout', 'gatherer'] },
  quetzalcoatlus: { method: 'imprint', uses: ['scout'] },
  parasaurolophus: { method: 'feeding', uses: ['mount', 'pack', 'gatherer'], mountSpeed: 0.9 },
  stegosaurus: { method: 'feeding', uses: ['guard'] },
  dilophosaurus: { method: 'imprint', uses: ['companion', 'guard'] },
  compsognathus: { method: 'feeding', uses: ['companion'] },
  archaeopteryx: { method: 'observation', uses: ['scout'] },
  microraptor: { method: 'observation', uses: ['scout'] },
  gallimimus: { method: 'observation', uses: ['mount'], mountSpeed: 0.95 },
  pachycephalosaurus: { method: 'feeding', uses: ['guard'] },
  iguanodon: { method: 'feeding', uses: ['mount', 'pack', 'gatherer'], mountSpeed: 0.85 },
  allosaurus: { method: 'none', uses: [] },
  carnotaurus: { method: 'none', uses: [] },
  therizinosaurus: { method: 'observation', uses: ['guard', 'gatherer'] },
  baryonyx: { method: 'imprint', uses: ['companion', 'gatherer'] },
  sarcosuchus: { method: 'none', uses: [] },
  protoceratops: { method: 'feeding', uses: ['companion', 'gatherer'] },
  pachyrhinosaurus: { method: 'feeding', uses: ['mount', 'guard'], mountSpeed: 0.85 },
  troodon: { method: 'observation', uses: ['companion'] },
  mosasaurus: { method: 'none', uses: [] },
  // Expanded fauna.
  deinosuchus: { method: 'none', uses: [] },
  megatherium: { method: 'feeding', uses: ['mount', 'pack', 'guard'], mountSpeed: 0.7 },
  smilodon: { method: 'imprint', uses: ['companion', 'guard'] },
  dodo: { method: 'feeding', uses: ['companion'] },
  anaconda: { method: 'none', uses: [] },
};

export const canUse = (speciesId: string, use: TameUse): boolean => TAME_PROFILES[speciesId]?.uses.includes(use) ?? false;
