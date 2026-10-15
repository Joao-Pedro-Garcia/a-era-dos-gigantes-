import type { EcosystemState } from '../animals/ecosystem';
import type { BuildingState } from '../building/building';
import type { CraftJob } from '../crafting/crafting';
import { Inventory, type InventoryData, type Stack } from '../inventory/inventory';
import { ITEMS } from '../inventory/items';
import type { SurvivalData } from '../survival/survival';
import type { EnvState } from '../world/environment';

/** A container of items left in the world (death drop or overflow). */
export interface ItemBag {
  id: string;
  x: number;
  y: number;
  z: number;
  items: Stack[];
  createdAt: number;
  reason: 'death' | 'drop';
}

export interface SaveData {
  version: number;
  savedAt: number;
  seed: number;
  player: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    survival: SurvivalData;
    respawn: { x: number; z: number; pieceId?: string } | null;
    deaths: number;
  };
  inventory: InventoryData;
  crafting: { queue: CraftJob[]; unlocked: string[] };
  env: EnvState;
  eco: EcosystemState;
  building: BuildingState;
  world: {
    /** Harvested resource node id → game time when it regrows. */
    harvested: Record<string, number>;
    bags: ItemBag[];
    nextBagId: number;
    discovered: string[];
    /** Species the player has observed (field journal). */
    seen?: string[];
  };
}

export const SAVE_VERSION = 1;

type Migration = (d: Record<string, unknown>) => Record<string, unknown>;

/** Ordered migrations: index i upgrades version i → i+1. */
const MIGRATIONS: Migration[] = [
  // v0 → v1: early prototype saves had no world.bags / discovered.
  (d) => {
    const world = (d.world ?? {}) as Record<string, unknown>;
    world.bags ??= [];
    world.nextBagId ??= 1;
    world.discovered ??= [];
    world.harvested ??= {};
    return { ...d, world, version: 1 };
  },
];

export function migrate(raw: unknown): SaveData {
  if (!raw || typeof raw !== 'object') throw new Error('Save inválido');
  let d = raw as Record<string, unknown>;
  let v = typeof d.version === 'number' ? d.version : 0;
  if (v > SAVE_VERSION) throw new Error(`Save de versão futura (${v})`);
  while (v < SAVE_VERSION) {
    d = MIGRATIONS[v](d);
    v++;
  }
  return d as unknown as SaveData;
}

/**
 * Validates and repairs a save so the game never starts from an inconsistent
 * state (unknown items, NaN positions, duplicated animals). Returns issues found.
 */
export function sanitize(save: SaveData): string[] {
  const issues: string[] = [];
  const p = save.player;
  for (const k of ['x', 'y', 'z', 'yaw'] as const) {
    if (!Number.isFinite(p[k])) {
      issues.push(`player.${k}`);
      p[k] = 0;
    }
  }
  issues.push(...Inventory.sanitize(save.inventory));
  save.world.bags = save.world.bags.filter((b) => {
    b.items = b.items.filter((s) => s && ITEMS[s.id] && Number.isFinite(s.qty) && s.qty > 0);
    return b.items.length > 0;
  });
  const seen = new Set<string>();
  save.eco.animals = save.eco.animals.filter((a) => {
    if (seen.has(a.id) || !Number.isFinite(a.x) || !Number.isFinite(a.z)) {
      issues.push(`animal ${a.id}`);
      return false;
    }
    seen.add(a.id);
    return true;
  });
  const pieceIds = new Set<string>();
  save.building.pieces = save.building.pieces.filter((pc) => {
    if (pieceIds.has(pc.id)) return false;
    pieceIds.add(pc.id);
    return true;
  });
  return issues;
}
