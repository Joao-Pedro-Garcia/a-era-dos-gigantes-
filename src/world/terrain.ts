import { WORLD } from '../core/config';
import { clamp, lerp, smoothstep } from '../core/math';
import { Noise2D } from '../core/noise';
import { hashString } from '../core/rng';
import type { BiomeId } from './biomes';

/**
 * Hybrid continent generator. Major regions (volcano, northern range, swamp,
 * jungle, ruins) are authored landmarks; procedural noise fills in detail.
 * Everything is a pure function of (seed, x, z) so sectors can be rebuilt at
 * any time without storing geometry.
 */
export interface PlannedSite {
  id: string;
  kind: 'ruin' | 'cave' | 'research';
  x: number;
  z: number;
  radius: number;
}

export const VOLCANO = { x: 2300, z: -1600, radius: 950, height: 390 };
const SWAMP = { x: 2100, z: 2000, radius: 1150 };
const JUNGLE = { x: -2000, z: 1700, radius: 1500 };
export const SPAWN = { x: 120, z: 700 };

export const PLANNED_SITES: PlannedSite[] = [
  { id: 'ruin_plains_outpost', kind: 'research', x: 640, z: 260, radius: 70 },
  { id: 'ruin_jungle_lab', kind: 'research', x: -1850, z: 1500, radius: 90 },
  { id: 'ruin_swamp_station', kind: 'research', x: 1800, z: 2150, radius: 80 },
  { id: 'ruin_north_observatory', kind: 'research', x: -400, z: -2600, radius: 80 },
  { id: 'ruin_coast_dock', kind: 'ruin', x: -3300, z: 300, radius: 70 },
  { id: 'ruin_volcano_bunker', kind: 'research', x: 1600, z: -1100, radius: 70 },
  { id: 'cave_spine_east', kind: 'cave', x: -900, z: -900, radius: 30 },
  { id: 'cave_north_ice', kind: 'cave', x: 600, z: -2900, radius: 30 },
  { id: 'cave_volcano_lava', kind: 'cave', x: 2700, z: -1050, radius: 30 },
];

export interface TerrainSample {
  height: number;
  biome: BiomeId;
  /** °C, before weather and time of day. */
  temperature: number;
  moisture: number;
  slope: number;
  freshWater: boolean;
}

export class Terrain {
  private n: Noise2D;
  private n2: Noise2D;
  private n3: Noise2D;

  constructor(readonly seed: number) {
    this.n = new Noise2D(seed);
    this.n2 = new Noise2D(seed ^ 0x51ed27);
    this.n3 = new Noise2D(hashString('rivers') ^ seed);
  }

  /** 1 inland, 0 deep ocean. */
  continentMask(x: number, z: number): number {
    const d = Math.hypot(x, z);
    const warp = this.n2.fbm(x / 1800, z / 1800, 3) * 700;
    return 1 - smoothstep(WORLD.continentRadius * 0.82, WORLD.continentRadius * 1.04, d + warp);
  }

  private mountainMask(x: number, z: number): number {
    // Northern range along the cold latitudes.
    const north = smoothstep(-1700, -2700, z);
    // Diagonal spine from the west towards the centre.
    const t = clamp(((x + 2800) * 0.73 + (z + 2000) * 0.68) / 3300, 0, 1);
    const sx = lerp(-2800, -500, t);
    const sz = lerp(-2000, -150, t);
    const dSpine = Math.hypot(x - sx, z - sz);
    const spine = (1 - smoothstep(250, 700, dSpine)) * (t > 0 && t < 1 ? 1 : 0.4);
    const n = this.n2.fbm(x / 1500, z / 1500, 2) * 0.25;
    return clamp(Math.max(north, spine) + n, 0, 1);
  }

  swampMask(x: number, z: number): number {
    const d = Math.hypot(x - SWAMP.x, z - SWAMP.z) + this.n.fbm(x / 600, z / 600, 2) * 250;
    return 1 - smoothstep(SWAMP.radius * 0.55, SWAMP.radius, d);
  }

  private jungleMask(x: number, z: number): number {
    const d = Math.hypot(x - JUNGLE.x, z - JUNGLE.z) + this.n2.fbm(x / 700, z / 700, 2) * 350;
    return 1 - smoothstep(JUNGLE.radius * 0.5, JUNGLE.radius, d);
  }

  volcanoFactor(x: number, z: number): number {
    const d = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    return clamp(1 - d / VOLCANO.radius, 0, 1);
  }

  /** River channels: zero-crossings of a warped low-frequency noise field. */
  riverMask(x: number, z: number): number {
    const wx = x + this.n2.get(x / 900, z / 900) * 260;
    const wz = z + this.n2.get(z / 900 + 40, x / 900) * 260;
    const r = Math.abs(this.n3.fbm(wx / 2600, wz / 2600, 3));
    return 1 - smoothstep(0.012, 0.03, r);
  }

  private siteBase = new Map<string, number>();

  /**
   * Final height: the procedural field, levelled around authored sites so
   * ruins, stations and cave mouths always sit on usable, dry ground.
   */
  height(x: number, z: number): number {
    let h = this.rawHeight(x, z);
    for (const site of PLANNED_SITES) {
      const r = site.radius * 1.6;
      const dx = x - site.x;
      const dz = z - site.z;
      if (dx * dx + dz * dz > r * r) continue;
      let base = this.siteBase.get(site.id);
      if (base === undefined) {
        base = Math.max(3, this.rawHeight(site.x, site.z));
        this.siteBase.set(site.id, base);
      }
      const w = 1 - smoothstep(site.radius * 0.9, r, Math.sqrt(dx * dx + dz * dz));
      h = lerp(h, base + this.n.get(x / 25, z / 25) * 0.6, w);
    }
    return h;
  }

  private rawHeight(x: number, z: number): number {
    const cont = this.continentMask(x, z);
    const hills = this.n.fbm(x / 700, z / 700, 5) * 22 + this.n.fbm(x / 160, z / 160, 3) * 3.5;
    let h = lerp(-45, 10 + hills, cont);

    const m = this.mountainMask(x, z) * cont;
    if (m > 0.001) {
      const ridge = this.n.ridged(x / 950, z / 950, 5);
      h += m * (ridge * 430 + this.n.fbm(x / 120, z / 120, 3) * 8 * m);
    }

    const v = this.volcanoFactor(x, z);
    if (v > 0) {
      h += VOLCANO.height * Math.pow(v, 1.7) + this.n.ridged(x / 200, z / 200, 3) * 18 * v;
      const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
      if (dv < 140) h -= (1 - dv / 140) * 85; // crater
    }

    const s = this.swampMask(x, z) * cont;
    if (s > 0) h = lerp(h, 0.6 + this.n.fbm(x / 90, z / 90, 3) * 1.6, s);

    // Lowland rivers carve down to just below sea level and fade out in highlands.
    const lowland = 1 - smoothstep(35, 75, h);
    const river = this.riverMask(x, z) * lowland * smoothstep(0.55, 0.85, cont) * (1 - v);
    if (river > 0) h = lerp(h, -2.2, river);

    // Small-scale relief on dry lowland ground: hummocks, dips and the slight
    // depression of animal trails. Fades out in water, swamp and highlands.
    const dry = smoothstep(0.5, 3, h) * (1 - smoothstep(60, 140, h)) * (1 - s) * cont;
    if (dry > 0) {
      h += (this.n2.fbm(x / 24, z / 24, 3) * 0.85 + this.n.get(x / 6.5, z / 6.5) * 0.14) * dry;
      h -= this.trailMask(x, z) * 0.22 * dry;
    }

    return h;
  }

  /**
   * 0..1 network of narrow winding paths worn by herds (zero-crossings of a
   * warped noise field). Purely deterministic, so trails line up between
   * sectors and are also used to thin vegetation.
   */
  trailMask(x: number, z: number): number {
    const wx = x + this.n.get(x / 300 + 11, z / 300) * 90;
    const wz = z + this.n.get(z / 300 - 7, x / 300) * 90;
    const v = Math.abs(this.n3.fbm(wx / 420 + 17.3, wz / 420 - 9.1, 2));
    return 1 - smoothstep(0.0025, 0.0075, v);
  }

  temperatureBase(x: number, z: number, h: number): number {
    const lat = smoothstep(-1000, -3300, z) * 32; // colder to the north (-z)
    const altitude = Math.max(0, h) * 0.045;
    const volcanic = this.volcanoFactor(x, z) * 14;
    return 27 - lat - altitude + volcanic;
  }

  moisture(x: number, z: number): number {
    return clamp(
      0.45 + this.n2.fbm(x / 1300, z / 1300, 3) * 0.3 + this.jungleMask(x, z) * 0.45 + this.swampMask(x, z) * 0.5 - this.volcanoFactor(x, z) * 0.5,
      0,
      1,
    );
  }

  /** 0..1 patchiness used to vary ground colour (meadows, dirt, moss). */
  groundNoise(x: number, z: number): number {
    return clamp(0.5 + this.n2.fbm(x / 45, z / 45, 3) * 0.6 + this.n.get(x / 7, z / 7) * 0.15, 0, 1);
  }

  slope(x: number, z: number): number {
    const e = 1.5;
    const dx = this.height(x + e, z) - this.height(x - e, z);
    const dz = this.height(x, z + e) - this.height(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }

  nearSite(x: number, z: number): PlannedSite | null {
    for (const s of PLANNED_SITES) {
      if (s.kind !== 'cave' && Math.hypot(x - s.x, z - s.z) < s.radius) return s;
    }
    return null;
  }

  biomeAt(x: number, z: number, h = this.height(x, z)): BiomeId {
    const cont = this.continentMask(x, z);
    if (h < -0.4) return cont > 0.85 ? (this.swampMask(x, z) > 0.4 ? 'swamp' : 'plains') : 'ocean';
    if (this.nearSite(x, z)) return 'ruins';
    const temp = this.temperatureBase(x, z, h);
    if (this.volcanoFactor(x, z) > 0.18 && h > 15) return 'volcanic';
    if (temp < 1.5) return 'snow';
    if (h < 3.2 && cont < 0.97) return 'beach';
    if (h > 135) return 'mountain';
    if (this.swampMask(x, z) > 0.5 && h < 9) return 'swamp';
    if (this.moisture(x, z) > 0.7) return 'jungle';
    return 'plains';
  }

  sample(x: number, z: number): TerrainSample {
    const h = this.height(x, z);
    const biome = this.biomeAt(x, z, h);
    return {
      height: h,
      biome,
      temperature: this.temperatureBase(x, z, h),
      moisture: this.moisture(x, z),
      slope: this.slope(x, z),
      freshWater: h < -0.2 && this.continentMask(x, z) > 0.85,
    };
  }

  /** Finds a dry, gentle spawn location near (x,z). */
  findDryGround(x: number, z: number, maxRadius = 400): { x: number; z: number } {
    for (let r = 0; r <= maxRadius; r += 8) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        const h = this.height(px, pz);
        if (h > 1.5 && this.slope(px, pz) < 0.5) return { x: px, z: pz };
        if (r === 0) break;
      }
    }
    return { x, z };
  }
}
