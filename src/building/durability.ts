import type { ItemList } from '../inventory/inventory';
import { PIECES, type Piece, type PieceType } from './building';

/**
 * Durability and structural integrity of building pieces.
 *
 * - Every piece has hit points by material (wood < metal < stone); a missing
 *   `hp` means undamaged.
 * - Weather wears wood down slowly (rain, storms); stone barely.
 * - Damage from dinosaurs, fire or the player removes hit points; at zero the
 *   piece breaks.
 * - Stability spreads from the ground: a foundation (or anything standing on
 *   the terrain) is fully stable; a piece resting on another gets that piece's
 *   stability minus a loss that depends on its material, and floors can also
 *   lean on a neighbour at the same height (cantilever, bigger loss). Pieces
 *   left below the threshold collapse — so destroying a wall can bring down
 *   the roof above it, and a whole storey can come down in a cascade.
 */
export type Material = 'wood' | 'stone' | 'metal' | 'fiber';

export function materialOf(type: PieceType): Material {
  const cost = PIECES[type].cost;
  if (type === 'stone_foundation' || type === 'stone_wall' || type === 'well' || type === 'forge' || type === 'foundation') return 'stone';
  if (cost.metal_ingot || cost.metal_scrap) return 'metal';
  if (cost.wood) return 'wood';
  return 'fiber';
}

const BASE_HP: Record<Material, number> = { wood: 300, stone: 900, metal: 600, fiber: 90 };
const SPECIAL_HP: Partial<Record<PieceType, number>> = {
  foundation: 700, stone_foundation: 1600, stone_wall: 1100, palisade: 520, fence: 160, door: 260, gate: 320, watchtower: 650, platform: 420,
};

export function maxHp(type: PieceType): number {
  return SPECIAL_HP[type] ?? BASE_HP[materialOf(type)];
}

export function hpOf(p: Piece): number {
  return p.hp ?? maxHp(p.type);
}

/** Wear per game second in the rain (fraction of max hp); a day of rain ≈ 4% for wood. */
const WEAR_RAIN: Record<Material, number> = { wood: 0.04 / 1200, stone: 0.004 / 1200, metal: 0.02 / 1200, fiber: 0.08 / 1200 };
/** Weather alone never takes a piece below this fraction (neglect weakens, it does not demolish). */
export const WEAR_FLOOR = 0.3;

export function wear(p: Piece, dt: number, raining: boolean, storm: boolean): void {
  if (!raining) return;
  const m = maxHp(p.type);
  const floor = m * WEAR_FLOOR;
  const h = hpOf(p);
  if (h <= floor) return;
  p.hp = Math.max(floor, h - m * WEAR_RAIN[materialOf(p.type)] * (storm ? 2.5 : 1) * dt);
}

/** Materials needed to bring a piece back to full health (a quarter of its cost at most). */
export function repairCost(p: Piece): ItemList {
  const missing = 1 - hpOf(p) / maxHp(p.type);
  const out: ItemList = {};
  if (missing <= 0.001) return out;
  for (const [k, q] of Object.entries(PIECES[p.type].cost)) {
    const n = Math.ceil(q * 0.25 * missing);
    if (n > 0) out[k] = n;
  }
  return out;
}

/** Stability lost per step of support by material, and by leaning sideways. */
const LOSS: Record<Material, number> = { wood: 0.14, stone: 0.08, metal: 0.1, fiber: 0.25 };
const SIDE_LOSS = 0.3;
export const COLLAPSE_BELOW = 0.2;

/** Pieces whose own footing is the ground. */
const GROUNDED: PieceType[] = ['foundation', 'stone_foundation', 'platform', 'watchtower'];

function span(p: Piece): [number, number] {
  const h = PIECES[p.type].size[1];
  if (p.type === 'foundation' || p.type === 'stone_foundation') return [p.y - h - 2, p.y];
  if (p.type === 'platform' || p.type === 'watchtower') return [p.y - h, p.y];
  return [p.y, p.y + Math.max(h, 0.05)];
}

function footprintR(p: Piece): number {
  const [w, , d] = PIECES[p.type].size;
  return Math.max(w, d) / 2;
}

/**
 * Stability (0..1) of every piece. `ground(x, z)` is the terrain height.
 * A piece rests on the ground when its base is within 15 cm of the terrain.
 */
export function stability(pieces: Iterable<Piece>, ground: (x: number, z: number) => number): Map<string, number> {
  const list = [...pieces];
  const st = new Map<string, number>();
  for (const p of list) {
    const [y0] = span(p);
    // Only pieces sitting right on the soil count as grounded (a wall 30 cm up on a
    // low foundation needs that foundation).
    const onGround = GROUNDED.includes(p.type) || y0 - ground(p.x, p.z) < 0.15;
    st.set(p.id, onGround ? 1 : 0);
  }
  // Relaxation: each pass lets support travel one more piece; structures are a few storeys at most.
  for (let pass = 0; pass < 12; pass++) {
    let changed = false;
    for (const p of list) {
      const [y0, y1] = span(p);
      const r = footprintR(p);
      let best = st.get(p.id)!;
      for (const q of list) {
        if (q === p) continue;
        const [q0, q1] = span(q);
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        const reach = r + footprintR(q) + 0.1;
        if (d > reach) continue;
        const sq = st.get(q.id)!;
        if (sq <= 0) continue;
        // Resting on q: p's base at q's top.
        if (Math.abs(y0 - q1) < 0.4) best = Math.max(best, sq - LOSS[materialOf(p.type)]);
        // Hanging beside q at the same height (floors, roofs, platforms side by side).
        else if (Math.abs(y1 - q1) < 0.4 && Math.abs(y0 - q0) < 0.6 && PIECES[p.type].walkable && PIECES[q.type].walkable) best = Math.max(best, sq - SIDE_LOSS);
        // A roof or floor carried by walls whose top is at its base (walls around a room).
        else if (Math.abs(y0 - q1) < 0.8 && (p.type === 'roof' || p.type === 'floor')) best = Math.max(best, sq - LOSS[materialOf(p.type)]);
      }
      if (best > st.get(p.id)! + 1e-6) {
        st.set(p.id, Math.min(1, best));
        changed = true;
      }
    }
    if (!changed) break;
  }
  return st;
}

/** Ids of the pieces that can no longer stand. */
export function unsupported(pieces: Iterable<Piece>, ground: (x: number, z: number) => number): string[] {
  const out: string[] = [];
  for (const [id, s] of stability(pieces, ground)) if (s < COLLAPSE_BELOW) out.push(id);
  return out;
}
