import type { Station } from '../crafting/recipes';
import { Inventory, type ItemList, type Stack } from '../inventory/inventory';
import { CollisionWorld, type BoxCollider } from '../world/collision';

/**
 * Hybrid building: "snap" mode aligns pieces to a 4 m grid and to the edges
 * of existing foundations; "free" mode allows any position with 15° rotation
 * steps. Every placement is validated (support, terrain, overlap, water) and
 * materials are consumed atomically.
 */
export type PieceType =
  | 'foundation' | 'floor' | 'wall' | 'door' | 'roof' | 'fence' | 'palisade' | 'platform'
  | 'campfire' | 'workbench' | 'storage' | 'bed' | 'water_collector' | 'crop_plot'
  | 'stairs' | 'stone_foundation' | 'stone_wall' | 'gate' | 'feeding_trough' | 'nest_box' | 'spike_trap' | 'snare_trap'
  | 'forge' | 'wind_generator' | 'lamp' | 'electric_fence' | 'well' | 'torch_post';

export interface PieceDef {
  type: PieceType;
  cost: ItemList;
  /** Width (x), height (y), depth (z) in metres. */
  size: [number, number, number];
  walkable: boolean;
  solid: boolean;
  category: 'structure' | 'defense' | 'facility' | 'animals' | 'utility';
  station?: Station;
  /** Unlock flag needed to build (skills / discoveries). */
  unlock?: string;
  /** Energy produced (>0) or consumed (<0) per tick unit. */
  power?: number;
  /** Storage slots (storage, troughs). */
  slots?: number;
}

export const GRID = 4;
export const WALL_H = 3;

export const PIECES: Record<PieceType, PieceDef> = {
  foundation: { type: 'foundation', cost: { wood: 6, stone: 4 }, size: [GRID, 1, GRID], walkable: true, solid: true, category: 'structure' },
  floor: { type: 'floor', cost: { wood: 5 }, size: [GRID, 0.25, GRID], walkable: true, solid: true, category: 'structure' },
  wall: { type: 'wall', cost: { wood: 5, fiber: 2 }, size: [GRID, WALL_H, 0.3], walkable: false, solid: true, category: 'structure' },
  door: { type: 'door', cost: { wood: 6, fiber: 4 }, size: [GRID, WALL_H, 0.3], walkable: false, solid: true, category: 'structure' },
  roof: { type: 'roof', cost: { wood: 5, fiber: 6 }, size: [GRID, 0.3, GRID], walkable: true, solid: true, category: 'structure' },
  fence: { type: 'fence', cost: { wood: 3, fiber: 2 }, size: [GRID, 1.4, 0.2], walkable: false, solid: true, category: 'defense' },
  palisade: { type: 'palisade', cost: { wood: 10, fiber: 4 }, size: [GRID, 3.5, 0.6], walkable: false, solid: true, category: 'defense' },
  platform: { type: 'platform', cost: { wood: 10, fiber: 4 }, size: [GRID, 2.4, GRID], walkable: true, solid: true, category: 'structure' },
  campfire: { type: 'campfire', cost: { wood: 4, stone: 5 }, size: [1.4, 0.5, 1.4], walkable: false, solid: false, category: 'facility', station: 'campfire' },
  workbench: { type: 'workbench', cost: { wood: 10, stone: 4, fiber: 4 }, size: [2, 1, 1], walkable: false, solid: true, category: 'facility', station: 'workbench' },
  storage: { type: 'storage', cost: { wood: 8, fiber: 4 }, size: [1.4, 0.9, 0.9], walkable: false, solid: true, category: 'facility' },
  bed: { type: 'bed', cost: { wood: 4, fiber: 12, hide: 2 }, size: [1.2, 0.5, 2.2], walkable: false, solid: true, category: 'facility' },
  water_collector: { type: 'water_collector', cost: { wood: 6, hide: 3, fiber: 4 }, size: [1.6, 1.2, 1.6], walkable: false, solid: true, category: 'facility' },
  crop_plot: { type: 'crop_plot', cost: { wood: 4, clay: 2 }, size: [2.4, 0.3, 2.4], walkable: false, solid: false, category: 'facility' },
  stairs: { type: 'stairs', cost: { wood: 6, rope: 1 }, size: [2, WALL_H, 4], walkable: true, solid: true, category: 'structure' },
  stone_foundation: { type: 'stone_foundation', cost: { stone: 14, clay: 2 }, size: [GRID, 1, GRID], walkable: true, solid: true, category: 'structure', unlock: 'skill:mason' },
  stone_wall: { type: 'stone_wall', cost: { stone: 12, clay: 2 }, size: [GRID, WALL_H, 0.5], walkable: false, solid: true, category: 'structure', unlock: 'skill:mason' },
  gate: { type: 'gate', cost: { wood: 10, rope: 3 }, size: [GRID, 2.2, 0.3], walkable: false, solid: true, category: 'animals' },
  feeding_trough: { type: 'feeding_trough', cost: { wood: 6, rope: 1 }, size: [2.2, 0.7, 0.9], walkable: false, solid: true, category: 'animals', slots: 10 },
  nest_box: { type: 'nest_box', cost: { wood: 5, fiber: 10, hide: 1 }, size: [1.6, 0.6, 1.6], walkable: false, solid: false, category: 'animals' },
  spike_trap: { type: 'spike_trap', cost: { wood: 6, flint: 4 }, size: [2, 0.4, 2], walkable: false, solid: false, category: 'defense' },
  snare_trap: { type: 'snare_trap', cost: { trap_snare: 1, wood: 1 }, size: [1.2, 0.3, 1.2], walkable: false, solid: false, category: 'defense' },
  forge: { type: 'forge', cost: { stone: 20, clay: 6, wood: 4 }, size: [2, 1.6, 2], walkable: false, solid: true, category: 'facility', station: 'forge', unlock: 'skill:metallurgy' },
  wind_generator: { type: 'wind_generator', cost: { metal_ingot: 4, wood: 10, rope: 2, hide: 3 }, size: [1.4, 7, 1.4], walkable: false, solid: true, category: 'utility', unlock: 'skill:engineer', power: 1 },
  lamp: { type: 'lamp', cost: { metal_scrap: 2, crystal: 1, wood: 2 }, size: [0.4, 2.6, 0.4], walkable: false, solid: false, category: 'utility', unlock: 'skill:engineer', power: -0.15 },
  electric_fence: { type: 'electric_fence', cost: { metal_ingot: 2, wood: 4, rope: 1 }, size: [GRID, 1.8, 0.2], walkable: false, solid: true, category: 'defense', unlock: 'skill:engineer', power: -0.25 },
  well: { type: 'well', cost: { stone: 20, wood: 6, rope: 2 }, size: [1.8, 1, 1.8], walkable: false, solid: true, category: 'utility', unlock: 'skill:mason' },
  torch_post: { type: 'torch_post', cost: { wood: 2, fiber: 3 }, size: [0.3, 2, 0.3], walkable: false, solid: false, category: 'utility' },
};

export type CropType = 'berries' | 'herb' | 'fern_fronds';
export const CROP_SEED: Record<CropType, string> = { berries: 'berries', herb: 'herb', fern_fronds: 'fern_fronds' };

export interface Piece {
  id: string;
  type: PieceType;
  x: number;
  y: number;
  z: number;
  rot: number;
  open?: boolean;
  storage?: (Stack | null)[];
  /** Water collector litres. */
  water?: number;
  /** Crop growth 0..1. */
  growth?: number;
  crop?: CropType | null;
  /** Game time the crop was last watered (rain or player). */
  wateredAt?: number;
  /** Nest box: incubating egg. */
  egg?: { sp: string; progress: number } | null;
  /** Traps: remaining uses / armed state. */
  uses?: number;
  armed?: boolean;
  /** Power consumers: currently supplied. */
  powered?: boolean;
}

export interface BuildTickContext {
  now: number;
  raining: boolean;
  growth: number;
  windSpeed: number;
  /** Is the spot warm enough to incubate (campfire nearby or warm air)? */
  warm(x: number, z: number): boolean;
  /** Incubation duration in seconds for a species (already including skills). */
  incubationSeconds(speciesId: string): number;
}

export interface BuildTickResult {
  hatched: Piece[];
}

export interface Placement {
  type: PieceType;
  x: number;
  y: number;
  z: number;
  rot: number;
  valid: boolean;
  reason?: 'water' | 'slope' | 'blocked' | 'support' | 'overlap' | 'distance' | 'materials' | 'locked';
}

export interface BuildEnv {
  height(x: number, z: number): number;
  waterLevel: number;
  collision: CollisionWorld;
}

export interface BuildingState {
  pieces: Piece[];
  nextId: number;
}

const STRUCT_SUPPORT: PieceType[] = ['foundation', 'stone_foundation', 'floor', 'platform'];
const SUPPORTS: PieceType[] = ['foundation', 'stone_foundation', 'floor', 'platform'];
const WALLISH: PieceType[] = ['wall', 'door', 'fence', 'palisade', 'stone_wall', 'gate', 'electric_fence'];
const WALL_SUPPORT: PieceType[] = ['wall', 'door', 'palisade', 'stone_wall', 'gate'];

export class Building {
  readonly pieces = new Map<string, Piece>();
  private nextId: number;

  constructor(state: BuildingState, private collision: CollisionWorld) {
    this.nextId = state.nextId;
    for (const p of state.pieces) {
      this.pieces.set(p.id, p);
      this.addCollider(p);
    }
  }

  serialize(): BuildingState {
    return { pieces: [...this.pieces.values()], nextId: this.nextId };
  }

  colliderFor(p: Piece): BoxCollider | null {
    const def = PIECES[p.type];
    if (!def.solid) return null;
    const [w, h, d] = def.size;
    const found = p.type === 'foundation' || p.type === 'stone_foundation';
    const y0 = found ? p.y - h - 2 : p.type === 'platform' ? p.y - h : p.y;
    const y1 = p.type === 'platform' || found ? p.y : p.y + h;
    return {
      kind: 'box', id: p.id, x: p.x, z: p.z, hx: w / 2, hz: d / 2, rot: p.rot, y0, y1,
      walkable: def.walkable, enabled: !((p.type === 'door' || p.type === 'gate') && p.open),
      ramp: p.type === 'stairs' ? true : undefined,
    };
  }

  private addCollider(p: Piece): void {
    const c = this.colliderFor(p);
    if (c) this.collision.add(c);
  }

  /** Computes a snapped/validated placement for a piece aimed at (ax, az). */
  preview(type: PieceType, ax: number, az: number, rot: number, snap: boolean, env: BuildEnv, playerX: number, playerZ: number): Placement {
    const def = PIECES[type];
    let x = ax;
    let z = az;
    let r = rot;
    let y = env.height(x, z);
    let supported = true;

    if (snap) r = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);

    const near = this.nearestSupport(ax, az, 7);
    const isFoundation = type === 'foundation' || type === 'stone_foundation';
    if (isFoundation) {
      if (snap) {
        if (near && (near.type === 'foundation' || near.type === 'stone_foundation')) {
          // Align to the neighbour's grid.
          const c = Math.cos(near.rot);
          const s = Math.sin(near.rot);
          const lx = (ax - near.x) * c + (az - near.z) * s;
          const lz = -(ax - near.x) * s + (az - near.z) * c;
          const gx = Math.round(lx / GRID) * GRID;
          const gz = Math.round(lz / GRID) * GRID;
          x = near.x + gx * c - gz * s;
          z = near.z + gx * s + gz * c;
          r = near.rot;
          y = near.y;
        } else {
          x = Math.round(ax / GRID) * GRID;
          z = Math.round(az / GRID) * GRID;
        }
      }
      if (!(snap && near && (near.type === 'foundation' || near.type === 'stone_foundation'))) {
        const hs = this.cornerHeights(x, z, r, GRID / 2, GRID / 2, env);
        y = Math.max(...hs) + 0.3;
        if (Math.max(...hs) - Math.min(...hs) > 2.6) return { type, x, y, z, rot: r, valid: false, reason: 'slope' };
      }
    } else if (WALLISH.includes(type)) {
      const base = snap ? this.nearestSupport(ax, az, 5, SUPPORTS) : null;
      if (base) {
        // Snap to the closest edge of the supporting piece.
        const c = Math.cos(base.rot);
        const s = Math.sin(base.rot);
        const lx = (ax - base.x) * c + (az - base.z) * s;
        const lz = -(ax - base.x) * s + (az - base.z) * c;
        const half = GRID / 2;
        let ex = 0;
        let ez = 0;
        let er = base.rot;
        if (Math.abs(lx) > Math.abs(lz)) {
          ex = Math.sign(lx) * half;
          er = base.rot + Math.PI / 2;
        } else ez = Math.sign(lz) * half;
        x = base.x + ex * c - ez * s;
        z = base.z + ex * s + ez * c;
        r = er;
        y = base.y;
      } else {
        y = env.height(x, z);
        if (type === 'wall' || type === 'door' || type === 'stone_wall') supported = !snap;
      }
    } else if (type === 'roof' || type === 'floor') {
      const base = this.nearestSupport(ax, az, 5, SUPPORTS);
      if (base && snap) {
        x = base.x;
        z = base.z;
        r = base.rot;
        y = base.y + WALL_H;
      } else {
        y = (base?.y ?? env.height(x, z)) + WALL_H;
      }
      supported = this.hasWallsAround(x, z, y - WALL_H, 3.2) >= (type === 'roof' ? 1 : 2);
    } else if (type === 'stairs') {
      const surf = env.collision.surfaceAt(x, z, env.height(x, z) + 50);
      y = Math.max(env.height(x, z), surf === -Infinity ? -Infinity : surf);
      if (snap) {
        x = Math.round(ax * 2) / 2;
        z = Math.round(az * 2) / 2;
      }
    } else if (type === 'platform') {
      if (snap) {
        x = Math.round(ax / GRID) * GRID;
        z = Math.round(az / GRID) * GRID;
      }
      const hs = this.cornerHeights(x, z, r, GRID / 2, GRID / 2, env);
      y = Math.max(Math.max(...hs), env.waterLevel) + def.size[1];
    } else {
      // Facilities sit on the ground or on a walkable surface.
      const surf = env.collision.surfaceAt(x, z, env.height(x, z) + 50);
      y = Math.max(env.height(x, z), surf);
    }

    if (Math.hypot(x - playerX, z - playerZ) > 10) return { type, x, y, z, rot: r, valid: false, reason: 'distance' };
    if (!supported) return { type, x, y, z, rot: r, valid: false, reason: 'support' };
    if (type !== 'platform' && env.height(x, z) < env.waterLevel + 0.2 && y < env.waterLevel + 0.5) return { type, x, y, z, rot: r, valid: false, reason: 'water' };

    // Overlap with existing pieces of the same kind at the same place.
    for (const p of this.pieces.values()) {
      if (Math.hypot(p.x - x, p.z - z) < 0.6 && Math.abs(p.y - y) < 0.6) {
        const sameClass = PIECES[p.type].category === def.category || (STRUCT_SUPPORT.includes(p.type) && STRUCT_SUPPORT.includes(type));
        if (sameClass && Math.abs(Math.cos(p.rot - r)) > 0.7) return { type, x, y, z, rot: r, valid: false, reason: 'overlap' };
      }
    }
    // Solid world obstacles (trees, rocks) inside the footprint.
    const [w, , d] = def.size;
    const probe: BoxCollider = { kind: 'box', id: '_probe', x, z, hx: w / 2 - 0.15, hz: d / 2 - 0.05, rot: r, y0: y, y1: y + def.size[1], walkable: false, enabled: true };
    for (const c of env.collision.query(x, z, Math.hypot(w, d))) {
      if (c.kind === 'circle' && CollisionWorld.penetration(probe, c.x, c.z, c.r * 0.8)) return { type, x, y, z, rot: r, valid: false, reason: 'blocked' };
    }
    return { type, x, y, z, rot: r, valid: true };
  }

  /** Cost after skill discounts (never below 1 of each material). */
  static cost(type: PieceType, mult = 1): ItemList {
    const out: ItemList = {};
    for (const [k, q] of Object.entries(PIECES[type].cost)) out[k] = Math.max(1, Math.ceil(q * mult));
    return out;
  }

  place(pl: Placement, inv: Inventory, costMult = 1): Piece | null {
    if (!pl.valid) return null;
    const def = PIECES[pl.type];
    if (!inv.removeAll(Building.cost(pl.type, costMult))) return null;
    const p: Piece = { id: `p${this.nextId++}`, type: pl.type, x: pl.x, y: pl.y, z: pl.z, rot: pl.rot };
    if (pl.type === 'storage') p.storage = Array(20).fill(null);
    if (pl.type === 'water_collector') p.water = 0;
    if (pl.type === 'crop_plot') {
      p.growth = 0;
      p.crop = null;
    }
    if (def.slots) p.storage = Array(def.slots).fill(null);
    if (pl.type === 'nest_box') p.egg = null;
    if (pl.type === 'spike_trap') p.uses = 6;
    if (pl.type === 'snare_trap') p.armed = true;
    void def;
    this.pieces.set(p.id, p);
    this.addCollider(p);
    return p;
  }

  /** Removes a piece and refunds half its cost. Storage contents are returned as well. */
  demolish(id: string, inv: Inventory): { refund: ItemList; overflow: Stack[] } | null {
    const p = this.pieces.get(id);
    if (!p) return null;
    const refund: ItemList = {};
    for (const [k, q] of Object.entries(PIECES[p.type].cost)) refund[k] = Math.floor(q / 2);
    const overflow: Stack[] = [];
    for (const [k, q] of Object.entries(refund)) {
      const left = q > 0 ? inv.add(k, q) : 0;
      if (left > 0) overflow.push({ id: k, qty: left });
    }
    for (const s of p.storage ?? []) {
      if (!s) continue;
      const left = inv.add(s.id, s.qty, s.dur);
      if (left > 0) overflow.push({ id: s.id, qty: left, dur: s.dur });
    }
    this.pieces.delete(id);
    this.collision.remove(id);
    return { refund, overflow };
  }

  toggleDoor(id: string): void {
    const p = this.pieces.get(id);
    if (!p || (p.type !== 'door' && p.type !== 'gate')) return;
    p.open = !p.open;
    const c = this.collision.get(id);
    if (c && c.kind === 'box') c.enabled = !p.open;
  }

  stationsNear(x: number, z: number, radius = 6): Set<Station> {
    const out = new Set<Station>(['hand']);
    for (const p of this.pieces.values()) {
      const st = PIECES[p.type].station;
      if (st && Math.hypot(p.x - x, p.z - z) < radius) out.add(st);
    }
    return out;
  }

  nearest(x: number, z: number, radius: number, filter?: (p: Piece) => boolean): Piece | null {
    let best: Piece | null = null;
    let bd = radius;
    for (const p of this.pieces.values()) {
      if (filter && !filter(p)) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Is (x,z) under a roof? Used for shelter (warmth, rain). */
  sheltered(x: number, z: number, y: number): boolean {
    for (const p of this.pieces.values()) {
      if (p.type !== 'roof' || p.y < y + 1 || p.y > y + 6) continue;
      const c = Math.cos(p.rot);
      const s = Math.sin(p.rot);
      const lx = (x - p.x) * c + (z - p.z) * s;
      const lz = -(x - p.x) * s + (z - p.z) * c;
      if (Math.abs(lx) <= GRID / 2 && Math.abs(lz) <= GRID / 2) return true;
    }
    return false;
  }

  /** Slow processes: rain collection and crop growth. */
  /**
   * Slow base processes: rain collection, crops (need water), incubation in
   * nest boxes and the power network. Returns eggs that finished incubating.
   */
  tick(dt: number, c: BuildTickContext): BuildTickResult {
    const hatched: Piece[] = [];
    const DAY = 1200;
    for (const p of this.pieces.values()) {
      if (p.type === 'water_collector') p.water = Math.min(20, (p.water ?? 0) + dt * (c.raining ? 0.02 : 0.001));
      if (p.type === 'crop_plot') {
        if (c.raining) p.wateredAt = c.now;
        if (p.crop) {
          const watered = c.now - (p.wateredAt ?? -1e9) < DAY;
          p.growth = Math.min(1, (p.growth ?? 0) + dt * 0.0005 * Math.max(0.2, c.growth) * (watered ? 1 : 0.25));
        }
      }
      if (p.type === 'nest_box' && p.egg) {
        const rate = c.warm(p.x, p.z) ? 1 : 0.25;
        p.egg.progress = Math.min(1, p.egg.progress + (dt * rate) / Math.max(60, c.incubationSeconds(p.egg.sp)));
        if (p.egg.progress >= 1) hatched.push(p);
      }
    }
    this.updatePower(c.windSpeed);
    return { hatched };
  }

  /** Each generator supplies the consumers nearest to it within 40 m, in order. */
  updatePower(windSpeed: number): void {
    const gens = [...this.pieces.values()].filter((p) => (PIECES[p.type].power ?? 0) > 0);
    const cons = [...this.pieces.values()].filter((p) => (PIECES[p.type].power ?? 0) < 0);
    for (const c of cons) c.powered = false;
    const output = Math.min(1.6, Math.max(0, (windSpeed - 1.5) / 5));
    for (const g of gens) {
      let budget = output * (PIECES[g.type].power ?? 0);
      g.powered = budget > 0;
      const mine = cons.filter((c) => !c.powered && Math.hypot(c.x - g.x, c.z - g.z) < 40).sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z));
      for (const c of mine) {
        const need = -(PIECES[c.type].power ?? 0);
        if (budget >= need) {
          budget -= need;
          c.powered = true;
        }
      }
    }
  }

  /** Plants a crop if the plot is empty. */
  plant(id: string, crop: CropType, now: number): boolean {
    const p = this.pieces.get(id);
    if (!p || p.type !== 'crop_plot' || p.crop) return false;
    p.crop = crop;
    p.growth = 0;
    p.wateredAt = now;
    return true;
  }

  water(id: string, now: number): boolean {
    const p = this.pieces.get(id);
    if (!p || p.type !== 'crop_plot') return false;
    p.wateredAt = now;
    return true;
  }

  /** Harvests a ripe crop; returns produce or null. */
  harvestCrop(id: string): Record<string, number> | null {
    const p = this.pieces.get(id);
    if (!p || p.type !== 'crop_plot' || !p.crop || (p.growth ?? 0) < 1) return null;
    const crop = p.crop;
    p.crop = null;
    p.growth = 0;
    return crop === 'berries' ? { berries: 8 } : crop === 'herb' ? { herb: 6 } : { fern_fronds: 6, fiber: 2 };
  }

  /** Puts a species egg into an empty nest box. */
  incubate(id: string, speciesId: string): boolean {
    const p = this.pieces.get(id);
    if (!p || p.type !== 'nest_box' || p.egg) return false;
    p.egg = { sp: speciesId, progress: 0 };
    return true;
  }

  /** Moves a stack into a storage-like piece; returns quantity that did not fit. */
  deposit(id: string, stack: Stack): number {
    const p = this.pieces.get(id);
    if (!p?.storage) return stack.qty;
    return storageAdd(p.storage, stack);
  }


  private nearestSupport(x: number, z: number, radius: number, types: PieceType[] = ['foundation']): Piece | null {
    return this.nearest(x, z, radius, (p) => types.includes(p.type));
  }

  private hasWallsAround(x: number, z: number, y: number, radius: number): number {
    let n = 0;
    for (const p of this.pieces.values()) {
      if (WALL_SUPPORT.includes(p.type) && Math.abs(p.y - y) < 0.6 && Math.hypot(p.x - x, p.z - z) < radius) n++;
    }
    return n;
  }

  private cornerHeights(x: number, z: number, rot: number, hx: number, hz: number, env: BuildEnv): number[] {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return [
      [-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, 0],
    ].map(([lx, lz]) => env.height(x + lx * c - lz * s, z + lx * s + lz * c));
  }
}

/** Adds a stack into a storage slot array, merging with matching stacks. Returns leftover. */
export function storageAdd(slots: (Stack | null)[], stack: Stack): number {
  let left = stack.qty;
  const max = stack.dur !== undefined ? 1 : 99;
  for (const s of slots) {
    if (left <= 0) break;
    if (s && s.id === stack.id && s.sp === stack.sp && s.dur === undefined && stack.dur === undefined && s.qty < max) {
      const n = Math.min(left, max - s.qty);
      s.qty += n;
      left -= n;
    }
  }
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (slots[i]) continue;
    const n = Math.min(left, max);
    slots[i] = { ...stack, qty: n };
    left -= n;
  }
  return left;
}

/** Takes one unit of any of the given item ids from storage; returns the id taken or null. */
export function storageTakeOne(slots: (Stack | null)[], ids: string[]): string | null {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (s && ids.includes(s.id)) {
      s.qty--;
      if (s.qty <= 0) slots[i] = null;
      return s.id;
    }
  }
  return null;
}
