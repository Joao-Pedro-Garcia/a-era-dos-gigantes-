import type { RareEventState } from '../world/rareEvents';
import { sanitizeGenes } from '../animals/genetics';
import type { EcosystemState } from '../animals/ecosystem';
import type { BuildingState } from '../building/building';
import type { CraftJob } from '../crafting/crafting';
import { Inventory, type InventoryData, type Stack } from '../inventory/inventory';
import { ITEMS } from '../inventory/items';
import type { SurvivalData } from '../survival/survival';
import type { EnvState } from '../world/environment';
import { type ProgressionData, createProgression, sanitizeProgression } from '../progression/skills';
import { type ExplorationData, createExploration } from '../exploration/exploration';
import { type MysteryData, createMysteries, sanitizeMysteries } from '../mysteries/mysteries';
import { SPECIES } from '../animals/species';
import { PIECES } from '../building/building';
import { clamp } from '../core/math';

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
    /** Persistent world flags (opened doors, beacon state…). */
    flags?: string[];
    /** Player is inside this cave interior. */
    inCave?: string | null;
    /** World generator version (see TERRAIN_VERSION); missing in older saves = 1. */
    terrainVersion?: number;
    /** Rare events schedule (missing in older saves). */
    rare?: RareEventState;
    /** The player's compass waypoints. */
    markers?: { x: number; z: number }[];
  };
  progression: ProgressionData;
  exploration: ExplorationData;
  mysteries: MysteryData;
  /** FNV-1a hash of the payload; detects truncated/corrupted data (not tampering protection). */
  checksum?: string;
}

export const SAVE_VERSION = 2;

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
  // v1 → v2: progression, exploration, mysteries and taming fields on animals.
  (d) => {
    const eco = (d.eco ?? {}) as { animals?: Record<string, unknown>[] };
    for (const a of eco.animals ?? []) {
      a.tameProgress ??= 0;
      a.tame ??= null;
    }
    return { ...d, progression: d.progression ?? createProgression(), exploration: d.exploration ?? createExploration(), mysteries: d.mysteries ?? createMysteries(), version: 2 };
  },
];

/** FNV-1a 32-bit hash of the JSON payload (without the checksum field). */
export function checksumOf(data: SaveData): string {
  const { checksum: _omit, savedAt: _t, ...rest } = data;
  void _omit;
  void _t;
  const str = JSON.stringify(rest);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function withChecksum(data: SaveData): SaveData {
  return { ...data, checksum: checksumOf(data) };
}

export class SaveError extends Error {
  constructor(public code: 'notObject' | 'future' | 'structure' | 'checksum' | 'json', detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
  }
}

/** Structural validation before migrating: catches files that are not saves at all. */
export function validateStructure(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SaveError('notObject');
  const d = raw as Record<string, unknown>;
  const need = ['seed', 'player', 'inventory', 'env', 'eco', 'building', 'world'];
  const missing = need.filter((k) => !(k in d));
  if (missing.length) throw new SaveError('structure', missing.join(','));
  if (typeof d.seed !== 'number' || !Number.isFinite(d.seed)) throw new SaveError('structure', 'seed');
  const p = d.player as Record<string, unknown>;
  if (!p || typeof p !== 'object' || typeof p.survival !== 'object') throw new SaveError('structure', 'player');
  const eco = d.eco as Record<string, unknown>;
  if (!Array.isArray(eco?.animals)) throw new SaveError('structure', 'eco.animals');
  const b = d.building as Record<string, unknown>;
  if (!Array.isArray(b?.pieces)) throw new SaveError('structure', 'building.pieces');
}

export function migrate(raw: unknown): SaveData {
  validateStructure(raw);
  let d = raw as Record<string, unknown>;
  let v = typeof d.version === 'number' ? d.version : 0;
  if (v > SAVE_VERSION) throw new SaveError('future', String(v));
  if (typeof d.checksum === 'string' && v === SAVE_VERSION && checksumOf(d as unknown as SaveData) !== d.checksum) throw new SaveError('checksum');
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
  if (save.world.terrainVersion !== undefined && ![1, 2].includes(save.world.terrainVersion)) save.world.terrainVersion = 1;
  const issues: string[] = [];
  const p = save.player;
  const half = 5200;
  for (const k of ['x', 'y', 'z', 'yaw'] as const) {
    if (!Number.isFinite(p[k])) {
      issues.push(`player.${k}`);
      p[k] = 0;
    }
  }
  p.x = clamp(p.x, -half, half);
  p.z = clamp(p.z, -half, half);
  p.y = clamp(p.y, -700, 1000);
  const sv = p.survival as unknown as Record<string, number>;
  for (const k of ['health', 'food', 'water', 'energy', 'stamina']) {
    if (!Number.isFinite(sv[k])) {
      issues.push(`survival.${k}`);
      sv[k] = 60;
    }
    sv[k] = clamp(sv[k], 0, 100);
  }
  for (const k of ['bleeding', 'fracture', 'sickness']) sv[k] = Number.isFinite(sv[k]) ? clamp(sv[k], 0, 1) : 0;
  sv.bodyTemp = Number.isFinite(sv.bodyTemp) ? clamp(sv.bodyTemp, 30, 43) : 37;
  if (save.player.respawn && !(Number.isFinite(save.player.respawn.x) && Number.isFinite(save.player.respawn.z))) save.player.respawn = null;
  issues.push(...Inventory.sanitize(save.inventory));
  save.world.bags = save.world.bags.filter((b) => {
    b.items = b.items.filter((s) => s && ITEMS[s.id] && Number.isFinite(s.qty) && s.qty > 0);
    return b.items.length > 0;
  });
  const seen = new Set<string>();
  save.eco.animals = save.eco.animals.filter((a) => {
    if (!a || typeof a.id !== 'string' || !SPECIES[a.speciesId]) {
      issues.push('animal species');
      return false;
    }
    for (const k of ['hunger', 'thirst', 'fatigue', 'stamina', 'fear', 'disease', 'habituation'] as const) a[k] = Number.isFinite(a[k]) ? clamp(a[k], 0, 1) : 0.3;
    a.trustPlayer = Number.isFinite(a.trustPlayer) ? clamp(a.trustPlayer, -1, 1) : 0;
    a.tameProgress = Number.isFinite(a.tameProgress) ? clamp(a.tameProgress, 0, 1) : 0;
    a.alpha = a.alpha === true;
    const genes = sanitizeGenes(a.genes);
    if (genes) a.genes = genes;
    else delete a.genes;
    if (!Array.isArray(a.memory)) a.memory = [];
    a.memory = a.memory.slice(0, 12);
    if (a.tame) {
      const t = a.tame;
      if (typeof t !== 'object' || typeof t.name !== 'string' || !['follow', 'stay', 'roam', 'guard'].includes(t.command)) a.tame = null;
      else {
        t.name = t.name.slice(0, 40);
        t.obedience = Number.isFinite(t.obedience) ? clamp(t.obedience, 0, 1) : 0.2;
        t.bond = Number.isFinite(t.bond) ? clamp(t.bond, 0, 1) : 0.4;
        t.ridden = false;
        if (!Number.isFinite(t.anchorX) || !Number.isFinite(t.anchorZ)) {
          t.anchorX = a.x;
          t.anchorZ = a.z;
        }
      }
    }
    if (seen.has(a.id) || !Number.isFinite(a.x) || !Number.isFinite(a.z)) {
      issues.push(`animal ${a.id}`);
      return false;
    }
    seen.add(a.id);
    return true;
  });
  const pieceIds = new Set<string>();
  save.building.pieces = save.building.pieces.filter((pc) => {
    if (!pc || pieceIds.has(pc.id) || !PIECES[pc.type] || ![pc.x, pc.y, pc.z, pc.rot].every(Number.isFinite)) {
      issues.push(`piece ${pc?.id}`);
      return false;
    }
    if (pc.storage) {
      const tmp = { slots: pc.storage, equipment: {}, hotbar: [] };
      Inventory.sanitize(tmp);
      pc.storage = tmp.slots.slice(0, pc.storage.length);
    }
    if (pc.egg && (!SPECIES[pc.egg.sp] || !Number.isFinite(pc.egg.progress))) pc.egg = null;
    pieceIds.add(pc.id);
    return true;
  });
  save.progression = sanitizeProgression(save.progression);
  save.mysteries = sanitizeMysteries(save.mysteries);
  if (!save.exploration || typeof save.exploration !== 'object') save.exploration = createExploration();
  const ex = save.exploration;
  if (typeof ex.cells !== 'string') ex.cells = '';
  ex.trail = Array.isArray(ex.trail) ? ex.trail.filter((t) => Array.isArray(t) && t.every(Number.isFinite)).slice(-3000) : [];
  ex.markers = Array.isArray(ex.markers) ? ex.markers.filter((m) => m && Number.isFinite(m.x) && Number.isFinite(m.z)).slice(0, 40) : [];
  ex.fossilsFound = Array.isArray(ex.fossilsFound) ? ex.fossilsFound.filter((x) => typeof x === 'string') : [];
  ex.fossilSpecies = Array.isArray(ex.fossilSpecies) ? ex.fossilSpecies.filter((x) => typeof x === 'string' && SPECIES[x]) : [];
  ex.biomeCells ??= {};
  ex.nextMarker = Number.isFinite(ex.nextMarker) ? ex.nextMarker : 1;
  save.world.flags = Array.isArray(save.world.flags) ? save.world.flags.filter((x) => typeof x === 'string') : [];
  if (typeof save.world.inCave !== 'string') save.world.inCave = null;
  return issues;
}
