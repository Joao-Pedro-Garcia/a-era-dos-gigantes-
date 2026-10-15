import type { ItemList } from '../inventory/inventory';

export type Station = 'hand' | 'campfire' | 'workbench' | 'forge' | 'research_bench';
export type RecipeCategory = 'materials' | 'gathering' | 'mining' | 'weapons' | 'ammo' | 'traps' | 'survival' | 'clothing' | 'medical' | 'taming' | 'navigation' | 'research';

export interface Recipe {
  id: string;
  output: string;
  qty: number;
  inputs: ItemList;
  /** Seconds of crafting. */
  time: number;
  station: Station;
  category: RecipeCategory;
  /** Unlock condition id; undefined = known from the start. `skill:<id>` comes from the skill trees. */
  unlock?: string;
  /** A tool that must be in the inventory (any of these ids); it is not consumed. */
  tool?: string[];
}

const KNIFE = ['stone_knife', 'metal_knife'];

export const RECIPES: Recipe[] = [
  // Materials
  { id: 'rope', output: 'rope', qty: 1, inputs: { fiber: 3 }, time: 2, station: 'hand', category: 'materials' },
  { id: 'metal_ingot_ore', output: 'metal_ingot', qty: 1, inputs: { metal_ore: 2, wood: 2 }, time: 10, station: 'forge', category: 'materials', unlock: 'skill:metallurgy' },
  { id: 'metal_ingot_scrap', output: 'metal_ingot', qty: 1, inputs: { metal_scrap: 3, wood: 1 }, time: 8, station: 'forge', category: 'materials', unlock: 'skill:metallurgy' },
  // Tools
  { id: 'stone_axe', output: 'stone_axe', qty: 1, inputs: { wood: 2, flint: 2, fiber: 3 }, time: 4, station: 'hand', category: 'gathering' },
  { id: 'stone_pickaxe', output: 'stone_pickaxe', qty: 1, inputs: { wood: 2, stone: 3, fiber: 3 }, time: 4, station: 'hand', category: 'mining' },
  { id: 'stone_knife', output: 'stone_knife', qty: 1, inputs: { flint: 2, fiber: 2 }, time: 3, station: 'hand', category: 'gathering' },
  { id: 'metal_axe', output: 'metal_axe', qty: 1, inputs: { metal_ingot: 2, wood: 2, rope: 1 }, time: 8, station: 'workbench', category: 'gathering', unlock: 'skill:metallurgy' },
  { id: 'metal_pickaxe', output: 'metal_pickaxe', qty: 1, inputs: { metal_ingot: 3, wood: 2, rope: 1 }, time: 8, station: 'workbench', category: 'mining', unlock: 'skill:metallurgy' },
  { id: 'metal_knife', output: 'metal_knife', qty: 1, inputs: { metal_ingot: 1, wood: 1 }, time: 5, station: 'workbench', category: 'gathering', unlock: 'skill:metallurgy' },
  // Weapons & ammo
  { id: 'spear', output: 'spear', qty: 1, inputs: { wood: 3, flint: 2, fiber: 4 }, time: 5, station: 'hand', category: 'weapons' },
  { id: 'bow', output: 'bow', qty: 1, inputs: { wood: 4, rope: 2, hide: 1 }, time: 8, station: 'workbench', category: 'weapons', tool: KNIFE },
  { id: 'arrow', output: 'arrow', qty: 8, inputs: { wood: 2, flint: 2, fiber: 2 }, time: 4, station: 'workbench', category: 'ammo', tool: KNIFE },
  { id: 'obsidian_spear', output: 'obsidian_spear', qty: 1, inputs: { wood: 3, obsidian: 3, rope: 1, hide: 1 }, time: 8, station: 'workbench', category: 'weapons', unlock: 'found_obsidian' },
  { id: 'metal_spear', output: 'metal_spear', qty: 1, inputs: { metal_ingot: 2, wood: 3, rope: 1 }, time: 9, station: 'workbench', category: 'weapons', unlock: 'skill:metallurgy' },
  // Traps (placed through the build menu)
  { id: 'trap_snare', output: 'trap_snare', qty: 1, inputs: { rope: 3, wood: 2 }, time: 5, station: 'hand', category: 'traps' },
  { id: 'flare', output: 'flare', qty: 2, inputs: { sulfur: 2, fiber: 2, wood: 1 }, time: 5, station: 'workbench', category: 'traps' },
  // Survival
  { id: 'torch', output: 'torch', qty: 1, inputs: { wood: 1, fiber: 3 }, time: 2, station: 'hand', category: 'survival' },
  { id: 'waterskin', output: 'waterskin', qty: 1, inputs: { hide: 2, fiber: 4 }, time: 5, station: 'hand', category: 'survival', tool: KNIFE },
  { id: 'cooked_meat', output: 'cooked_meat', qty: 1, inputs: { raw_meat: 1 }, time: 6, station: 'campfire', category: 'survival' },
  { id: 'cooked_fish', output: 'cooked_meat', qty: 1, inputs: { raw_fish: 1 }, time: 5, station: 'campfire', category: 'survival' },
  { id: 'backpack', output: 'backpack', qty: 1, inputs: { hide: 4, rope: 3, wood: 2 }, time: 10, station: 'workbench', category: 'survival', tool: KNIFE },
  // Clothing
  { id: 'hide_hood', output: 'hide_hood', qty: 1, inputs: { hide: 2, fiber: 4 }, time: 6, station: 'workbench', category: 'clothing', tool: KNIFE },
  { id: 'hide_tunic', output: 'hide_tunic', qty: 1, inputs: { hide: 5, fiber: 8 }, time: 10, station: 'workbench', category: 'clothing', tool: KNIFE },
  { id: 'hide_leggings', output: 'hide_leggings', qty: 1, inputs: { hide: 4, fiber: 6 }, time: 8, station: 'workbench', category: 'clothing', tool: KNIFE },
  { id: 'fur_coat', output: 'fur_coat', qty: 1, inputs: { hide: 8, fiber: 10, bone: 4 }, time: 14, station: 'workbench', category: 'clothing', unlock: 'visited_snow', tool: KNIFE },
  // Medical
  { id: 'bandage', output: 'bandage', qty: 2, inputs: { fiber: 6 }, time: 3, station: 'hand', category: 'medical' },
  { id: 'splint', output: 'splint', qty: 1, inputs: { wood: 2, rope: 1 }, time: 3, station: 'hand', category: 'medical' },
  { id: 'herbal_poultice', output: 'herbal_poultice', qty: 1, inputs: { herb: 4, fiber: 2 }, time: 4, station: 'campfire', category: 'medical' },
  { id: 'antidote', output: 'antidote', qty: 1, inputs: { herb: 3, clay: 1 }, time: 5, station: 'campfire', category: 'medical' },
  // Taming
  { id: 'feed_mix', output: 'feed_mix', qty: 2, inputs: { berries: 3, fern_fronds: 1, cycad_fronds: 1 }, time: 3, station: 'hand', category: 'taming' },
  // Navigation & research
  { id: 'compass', output: 'compass', qty: 1, inputs: { metal_scrap: 2, crystal: 1 }, time: 6, station: 'workbench', category: 'navigation', unlock: 'found_crystal' },
  { id: 'spyglass', output: 'spyglass', qty: 1, inputs: { metal_ingot: 1, crystal: 2, hide: 1 }, time: 8, station: 'workbench', category: 'navigation', unlock: 'skill:metallurgy' },
  { id: 'battery', output: 'battery', qty: 1, inputs: { metal_scrap: 2, sulfur: 2, clay: 1 }, time: 8, station: 'workbench', category: 'research', unlock: 'found_research_site' },
  { id: 'radio_receiver', output: 'radio_receiver', qty: 1, inputs: { metal_scrap: 4, crystal: 1, battery: 1 }, time: 12, station: 'workbench', category: 'research', unlock: 'found_research_site' },
  { id: 'research_scanner', output: 'research_scanner', qty: 1, inputs: { metal_scrap: 6, sulfur: 2, obsidian: 2 }, time: 20, station: 'workbench', category: 'research', unlock: 'found_research_site' },
];

export const RECIPE_BY_ID: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
