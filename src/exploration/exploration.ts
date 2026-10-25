import { WORLD } from '../core/config';
import { Rng, hash2 } from '../core/rng';
import type { BiomeId } from '../world/biomes';
import type { Terrain } from '../world/terrain';

/**
 * Progressive map knowledge. The continent is divided into 64 m cells that
 * become "explored" when seen; the map only shows explored cells. Also keeps
 * the player's trail, custom markers and fossil finds.
 */
export const CELL = 64;
export const GRID_N = Math.ceil((WORLD.worldHalfSize * 2) / CELL);

export interface Marker {
  id: number;
  x: number;
  z: number;
  icon: 'pin' | 'star' | 'danger' | 'water' | 'nest';
}

export interface ExplorationData {
  /** Base64 of one byte per cell (0 unknown, 1 explored). */
  cells: string;
  trail: [number, number][];
  markers: Marker[];
  nextMarker: number;
  fossilsFound: string[];
  /** Species ids identified through fossils. */
  fossilSpecies: string[];
  biomeCells: Partial<Record<BiomeId, number>>;
}

export function createExploration(): ExplorationData {
  return { cells: '', trail: [], markers: [], nextMarker: 1, fossilsFound: [], fossilSpecies: [], biomeCells: {} };
}

const toB64 = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b: string, n: number): Uint8Array => {
  const out = new Uint8Array(n);
  try {
    const s = atob(b);
    for (let i = 0; i < Math.min(n, s.length); i++) out[i] = s.charCodeAt(i) ? 1 : 0;
  } catch {
    /* corrupted: start unexplored */
  }
  return out;
};

export class Exploration {
  readonly grid: Uint8Array;
  private lastTrail: [number, number] | null = null;
  /** Called with the number of newly revealed cells. */
  onReveal: (n: number) => void = () => {};

  constructor(public d: ExplorationData, private terrain: Terrain) {
    this.grid = fromB64(d.cells, GRID_N * GRID_N);
    if (!Array.isArray(d.trail)) d.trail = [];
    if (!Array.isArray(d.markers)) d.markers = [];
    this.lastTrail = d.trail[d.trail.length - 1] ?? null;
  }

  serialize(): ExplorationData {
    this.d.cells = toB64(this.grid);
    return this.d;
  }

  static cellIndex(x: number, z: number): number {
    const cx = Math.floor((x + WORLD.worldHalfSize) / CELL);
    const cz = Math.floor((z + WORLD.worldHalfSize) / CELL);
    if (cx < 0 || cz < 0 || cx >= GRID_N || cz >= GRID_N) return -1;
    return cz * GRID_N + cx;
  }

  isExplored(x: number, z: number): boolean {
    const i = Exploration.cellIndex(x, z);
    return i >= 0 && this.grid[i] === 1;
  }

  /** Reveals cells within `radius` (optionally only inside a view cone). Returns how many were new. */
  reveal(x: number, z: number, radius: number, cone?: { yaw: number; halfAngle: number }): number {
    let n = 0;
    const r2 = radius * radius;
    for (let dz = -radius; dz <= radius; dz += CELL / 2) {
      for (let dx = -radius; dx <= radius; dx += CELL / 2) {
        if (dx * dx + dz * dz > r2) continue;
        if (cone && (dx || dz)) {
          const a = Math.atan2(dx, dz);
          let d = a - cone.yaw;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          if (Math.abs(d) > cone.halfAngle) continue;
        }
        const i = Exploration.cellIndex(x + dx, z + dz);
        if (i >= 0 && this.grid[i] === 0) {
          this.grid[i] = 1;
          n++;
          const b = this.terrain.biomeAt(x + dx, z + dz);
          this.d.biomeCells[b] = (this.d.biomeCells[b] ?? 0) + 1;
        }
      }
    }
    if (n) this.onReveal(n);
    return n;
  }

  /** Records a breadcrumb every 40 m (bounded). */
  track(x: number, z: number): void {
    if (this.lastTrail && Math.hypot(x - this.lastTrail[0], z - this.lastTrail[1]) < 40) return;
    const p: [number, number] = [Math.round(x), Math.round(z)];
    this.d.trail.push(p);
    if (this.d.trail.length > 3000) this.d.trail.splice(0, this.d.trail.length - 3000);
    this.lastTrail = p;
  }

  /** Adds a marker, or removes one already within 60 m. Returns true if added. */
  toggleMarker(x: number, z: number, icon: Marker['icon'] = 'pin'): boolean {
    const i = this.d.markers.findIndex((m) => Math.hypot(m.x - x, m.z - z) < 60);
    if (i >= 0) {
      this.d.markers.splice(i, 1);
      return false;
    }
    if (this.d.markers.length >= 40) this.d.markers.shift();
    this.d.markers.push({ id: this.d.nextMarker++, x: Math.round(x), z: Math.round(z), icon });
    return true;
  }

  exploredFraction(): number {
    let n = 0;
    for (const v of this.grid) n += v;
    return n / this.grid.length;
  }
}

/** Deterministic fossil sites: rare, in eroded or rocky ground. */
export function fossilSite(seed: number, sx: number, sz: number, terrain: Terrain): { id: string; x: number; z: number } | null {
  const rng = new Rng(hash2(seed ^ 0xf055, sx, sz));
  if (!rng.chance(0.07)) return null;
  const S = WORLD.sectorSize;
  const x = sx * S + rng.range(10, S - 10);
  const z = sz * S + rng.range(10, S - 10);
  const h = terrain.height(x, z);
  if (h < 1) return null;
  const b = terrain.biomeAt(x, z, h);
  if (!['mountain', 'volcanic', 'plains', 'beach', 'snow'].includes(b)) return null;
  return { id: `fossil:${sx},${sz}`, x, z };
}
