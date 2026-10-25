import type { VegetationKind } from './biomes';

/**
 * Gameplay data for vegetation kinds (collision and harvesting). The 3D
 * models themselves are generated in plants.ts.
 */
/** Collision radius (at scale 1) and whether the player can pass through. */
export const VEG_COLLIDER: Record<VegetationKind, number> = {
  conifer: 0.4, broadleaf: 0.5, palm: 0.3, cycad: 0.45, fern: 0, bush: 0, deadTree: 0.35, rock: 0.75, boulder: 2.3, reeds: 0, grass: 0,
};

/** What a vegetation instance yields when harvested. */
export const VEG_YIELD: Partial<Record<VegetationKind, { tool: 'wood' | 'stone' | 'fiber'; drops: Record<string, number>; hits: number }>> = {
  conifer: { tool: 'wood', drops: { wood: 2 }, hits: 6 },
  broadleaf: { tool: 'wood', drops: { wood: 2 }, hits: 7 },
  palm: { tool: 'wood', drops: { wood: 1, fiber: 1 }, hits: 5 },
  deadTree: { tool: 'wood', drops: { wood: 2 }, hits: 4 },
  cycad: { tool: 'fiber', drops: { cycad_fronds: 1, fiber: 1 }, hits: 3 },
  fern: { tool: 'fiber', drops: { fern_fronds: 1, fiber: 1 }, hits: 2 },
  bush: { tool: 'fiber', drops: { berries: 2, fiber: 1 }, hits: 3 },
  reeds: { tool: 'fiber', drops: { fiber: 3 }, hits: 2 },
  rock: { tool: 'stone', drops: { stone: 2 }, hits: 5 },
  boulder: { tool: 'stone', drops: { stone: 3 }, hits: 12 },
};
