import { WORLD } from '../core/config';
import { Rng, hashString } from '../core/rng';
import type { BiomeId } from './biomes';
import { CANYON, MESA, PLANNED_SITES, SPAWN, type Terrain } from './terrain';

/**
 * Points of interest of the continent (v2), spread over the whole map so
 * that exploring far pays off: each one has a purpose.
 *
 * - arch / pillars: rock formations visible from afar (landmarks for orientation);
 * - grove: fruit-laden bushes (food);
 * - crystals: rare crystal outcrops in the highlands;
 * - bonebed: several fossils in one place;
 * - lair: a predator's den — dangerous territory where big predators (and alphas) live;
 * - lake / waterfall / canyon: the natural sights of the terrain itself.
 *
 * Everything is a pure function of the seed (no saving needed).
 */
export type PoiKind = 'arch' | 'pillars' | 'grove' | 'crystals' | 'bonebed' | 'lair' | 'lake' | 'waterfall' | 'canyon';

export interface Poi {
  id: string;
  kind: PoiKind;
  x: number;
  z: number;
  /** Discovery radius (m). */
  radius: number;
  /** Facing (radians) for directional formations. */
  rot: number;
}

interface Rule {
  kind: PoiKind;
  count: number;
  biomes: BiomeId[];
  /** Minimum distance from the spawn (m). */
  minSpawn: number;
  radius: number;
}

const RULES: Rule[] = [
  { kind: 'lair', count: 4, biomes: ['plains', 'jungle', 'forest', 'swamp'], minSpawn: 1100, radius: 60 },
  { kind: 'arch', count: 3, biomes: ['plains', 'beach', 'forest', 'mountain'], minSpawn: 500, radius: 40 },
  { kind: 'pillars', count: 3, biomes: ['plains', 'beach', 'volcanic', 'mountain', 'snow'], minSpawn: 600, radius: 45 },
  { kind: 'crystals', count: 3, biomes: ['mountain', 'snow', 'volcanic'], minSpawn: 900, radius: 30 },
  { kind: 'grove', count: 4, biomes: ['forest', 'jungle', 'plains'], minSpawn: 350, radius: 35 },
  { kind: 'bonebed', count: 2, biomes: ['plains', 'beach', 'swamp', 'volcanic'], minSpawn: 800, radius: 35 },
];

/** Edge of the world: currents start past `current` (m from the centre); nobody gets past `hard`. */
export const WORLD_LIMIT = { current: WORLD.continentRadius * 1.1, hard: WORLD.continentRadius * 1.1 + 320 };

/**
 * Open-sea currents past the continent: move a position back toward the
 * coast (stronger the further out) and never beyond the hard limit.
 * Returns whether the current acted.
 */
export function applyCurrent(pos: { x: number; z: number }, dt: number): boolean {
  const d = Math.hypot(pos.x, pos.z);
  if (d <= WORLD_LIMIT.current) return false;
  const push = Math.min(1, (d - WORLD_LIMIT.current) / (WORLD_LIMIT.hard - WORLD_LIMIT.current));
  const k = (push * 4.5 * dt) / d;
  pos.x -= pos.x * k;
  pos.z -= pos.z * k;
  const d2 = Math.hypot(pos.x, pos.z);
  if (d2 > WORLD_LIMIT.hard) {
    pos.x *= WORLD_LIMIT.hard / d2;
    pos.z *= WORLD_LIMIT.hard / d2;
  }
  return true;
}

const cache = new WeakMap<Terrain, Poi[]>();

export function worldPois(terrain: Terrain): Poi[] {
  const hit = cache.get(terrain);
  if (hit) return hit;
  const out: Poi[] = [];
  if (!terrain.v2) {
    cache.set(terrain, out);
    return out;
  }
  // Natural sights.
  for (const l of terrain.lakes) out.push({ id: `poi:${l.id}`, kind: l.id === 'lake_waterfall' ? 'waterfall' : 'lake', x: l.x, z: l.z, radius: Math.max(l.rx, l.rz) + 40, rot: l.rot });
  const mid = CANYON[Math.floor(CANYON.length / 2)];
  out.push({ id: 'poi:canyon', kind: 'canyon', x: mid[0], z: mid[1], radius: 120, rot: 0 });

  const rng = new Rng(hashString('pois') ^ terrain.seed);
  const clear = (x: number, z: number, r: number) => {
    if (Math.hypot(x - MESA.x, z - MESA.z) < MESA.radius + r + 60) return false;
    for (const s of PLANNED_SITES) if (Math.hypot(x - s.x, z - s.z) < s.radius * 1.6 + r + 40) return false;
    for (const l of terrain.lakes) if (Math.hypot(x - l.x, z - l.z) < Math.max(l.rx, l.rz) * 1.3 + r + 20) return false;
    for (const p of out) if (Math.hypot(x - p.x, z - p.z) < p.radius + r + 450) return false;
    return true;
  };
  for (const rule of RULES) {
    let made = 0;
    for (let tries = 0; tries < 1500 && made < rule.count; tries++) {
      const a = rng.next() * Math.PI * 2;
      const d = Math.sqrt(rng.next()) * WORLD.continentRadius * 0.9;
      const x = Math.sin(a) * d;
      const z = Math.cos(a) * d;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < rule.minSpawn) continue;
      const h = terrain.height(x, z);
      if (h < 2 || !rule.biomes.includes(terrain.biomeAt(x, z, h))) continue;
      if (terrain.slope(x, z) > 0.35) continue;
      if (!clear(x, z, rule.radius)) continue;
      out.push({ id: `poi:${rule.kind}:${made}`, kind: rule.kind, x, z, radius: rule.radius, rot: rng.next() * Math.PI });
      made++;
    }
  }
  cache.set(terrain, out);
  return out;
}

/** Predator dens (dangerous territories) of this world. */
export function lairs(terrain: Terrain): Poi[] {
  return worldPois(terrain).filter((p) => p.kind === 'lair');
}

/** Localisation key of a discovered place id (authored sites and points of interest). */
export function placeKey(id: string): string {
  if (!id.startsWith('poi:')) return `site.${id}`;
  const kind = id.split(':')[1];
  return `poi.${kind.startsWith('lake_') ? (kind === 'lake_waterfall' ? 'waterfall' : 'lake') : kind}`;
}
