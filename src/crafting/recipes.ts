import type { ItemList } from '../inventory/inventory';

export type Station = 'hand' | 'campfire' | 'workbench' | 'research_bench';
export type RecipeCategory = 'gathering' | 'mining' | 'weapons' | 'ammo' | 'traps' | 'survival' | 'clothing' | 'medical' | 'research';

export interface Recipe {
  id: string;
  output: string;
  qty: number;
  inputs: ItemList;
  /** Seconds of crafting. */
  time: number;
  station: Station;
  category: RecipeCategory;
  /** Unlock condition id; undefined = known from the start. */
  unlock?: string;
}

export const RECIPES: Recipe[] = [
  { id: 'stone_axe', output: 'stone_axe', qty: 1, inputs: { wood: 2, flint: 2, fiber: 3 }, time: 4, station: 'hand', category: 'gathering' },
  { id: 'stone_pickaxe', output: 'stone_pickaxe', qty: 1, inputs: { wood: 2, stone: 3, fiber: 3 }, time: 4, station: 'hand', category: 'mining' },
  { id: 'stone_knife', output: 'stone_knife', qty: 1, inputs: { flint: 2, fiber: 2 }, time: 3, station: 'hand', category: 'gathering' },
  { id: 'spear', output: 'spear', qty: 1, inputs: { wood: 3, flint: 2, fiber: 4 }, time: 5, station: 'hand', category: 'weapons' },
  { id: 'torch', output: 'torch', qty: 1, inputs: { wood: 1, fiber: 3 }, time: 2, station: 'hand', category: 'survival' },
  { id: 'bandage', output: 'bandage', qty: 2, inputs: { fiber: 6 }, time: 3, station: 'hand', category: 'medical' },
  { id: 'waterskin', output: 'waterskin', qty: 1, inputs: { hide: 2, fiber: 4 }, time: 5, station: 'hand', category: 'survival' },
  { id: 'trap_snare', output: 'trap_snare', qty: 1, inputs: { fiber: 8, wood: 2 }, time: 5, station: 'hand', category: 'traps' },
  { id: 'cooked_meat', output: 'cooked_meat', qty: 1, inputs: { raw_meat: 1 }, time: 6, station: 'campfire', category: 'survival' },
  { id: 'cooked_fish', output: 'cooked_meat', qty: 1, inputs: { raw_fish: 1 }, time: 5, station: 'campfire', category: 'survival' },
  { id: 'herbal_poultice', output: 'herbal_poultice', qty: 1, inputs: { herb: 4, fiber: 2 }, time: 4, station: 'campfire', category: 'medical' },
  { id: 'bow', output: 'bow', qty: 1, inputs: { wood: 4, fiber: 10, hide: 1 }, time: 8, station: 'workbench', category: 'weapons' },
  { id: 'arrow', output: 'arrow', qty: 8, inputs: { wood: 2, flint: 2, fiber: 2 }, time: 4, station: 'workbench', category: 'ammo' },
  { id: 'obsidian_spear', output: 'obsidian_spear', qty: 1, inputs: { wood: 3, obsidian: 3, fiber: 4, hide: 1 }, time: 8, station: 'workbench', category: 'weapons', unlock: 'found_obsidian' },
  { id: 'hide_hood', output: 'hide_hood', qty: 1, inputs: { hide: 2, fiber: 4 }, time: 6, station: 'workbench', category: 'clothing' },
  { id: 'hide_tunic', output: 'hide_tunic', qty: 1, inputs: { hide: 5, fiber: 8 }, time: 10, station: 'workbench', category: 'clothing' },
  { id: 'hide_leggings', output: 'hide_leggings', qty: 1, inputs: { hide: 4, fiber: 6 }, time: 8, station: 'workbench', category: 'clothing' },
  { id: 'fur_coat', output: 'fur_coat', qty: 1, inputs: { hide: 8, fiber: 10, bone: 4 }, time: 14, station: 'workbench', category: 'clothing', unlock: 'visited_snow' },
  { id: 'backpack', output: 'backpack', qty: 1, inputs: { hide: 4, fiber: 10, wood: 2 }, time: 10, station: 'workbench', category: 'survival' },
  { id: 'research_scanner', output: 'research_scanner', qty: 1, inputs: { metal_scrap: 6, sulfur: 2, obsidian: 2 }, time: 20, station: 'workbench', category: 'research', unlock: 'found_research_site' },
];

export const RECIPE_BY_ID: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));
