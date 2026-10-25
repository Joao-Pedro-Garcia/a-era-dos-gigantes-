import type { AnimalData } from './animal';

/** Marine animals stay where the sea is at least this deep (terrain height, m). */
export const AQUATIC_MIN_DEPTH = -3;

/**
 * Swimming depth of a marine animal: cruising a little below the surface
 * with slow dives and returns to breathe, never touching the bottom.
 */
export function swimDepth(a: AnimalData, now: number, ground: number): number {
  const ph = (now * 0.05 + (a.id.charCodeAt(a.id.length - 1) % 17)) % (Math.PI * 2);
  const dive = 0.5 + 0.5 * Math.sin(ph);
  return Math.max(ground + 1, -1.2 - dive * 4);
}
