import { WORLD } from '../core/config';
import { clamp, lerp, smoothstep } from '../core/math';
import { Noise2D } from '../core/noise';
import { Rng, hashString } from '../core/rng';
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

/**
 * Generator version. Version 2 (continent v2) adds temperate forests, lakes,
 * varied coasts (beaches and sea cliffs), organic region outlines and the
 * mesa with its canyon and waterfall. Saves made before it keep version 1, so
 * nothing a player built ends up under water or inside a cliff.
 */
export const TERRAIN_VERSION = 2;

export const VOLCANO = { x: 2300, z: -1600, radius: 950, height: 390 };
/** Mesa (plateau with cliff walls) south of the spawn; v2. */
export const MESA = { x: 520, z: 2350, radius: 620, height: 42 };
/** Gentle side of the mesa (direction from its centre, radians; atan2(dx, dz)). */
export const MESA_RAMP = 2.3;
/** Canyon cutting through the mesa from west to east (polyline); v2. */
export const CANYON: [number, number][] = [[-260, 2580], [180, 2440], [520, 2540], [820, 2390], [1300, 2230]];
const CANYON_HALF = 13;
/** Stream on top of the mesa that falls over its northern rim; v2. */
export const WATERFALL_STREAM: [number, number][] = [[600, 2180], [560, 2000], [530, 1840], [515, 1500]];

export interface Lake {
  id: string;
  x: number;
  z: number;
  rx: number;
  rz: number;
  rot: number;
  depth: number;
}
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
  readonly v2: boolean;
  /** Lakes of this world (v2); the plunge pool of the waterfall is the first one. */
  readonly lakes: Lake[] = [];

  constructor(readonly seed: number, readonly version = TERRAIN_VERSION) {
    this.n = new Noise2D(seed);
    this.n2 = new Noise2D(seed ^ 0x51ed27);
    this.n3 = new Noise2D(hashString('rivers') ^ seed);
    this.v2 = version >= 2;
    if (this.v2) this.placeLakes();
  }

  // ------------------------------------------------------------------ v2 features

  /** 0..1 plateau of the mesa; the canyon and the ramp are cut out of it. */
  mesaMask(x: number, z: number): number {
    if (!this.v2) return 0;
    const dx = x - MESA.x;
    const dz = z - MESA.z;
    const d0 = Math.hypot(dx, dz);
    if (d0 > MESA.radius + 450) return 0;
    const d = d0 + this.n2.fbm(x / 260, z / 260, 3) * 110 + this.n.get(x / 70, z / 70) * 14;
    // Steep cliffs all around, except a long ramp on one side.
    const a = Math.atan2(dx, dz);
    const ramp = 1 - smoothstep(0.18, 0.42, Math.abs(Math.atan2(Math.sin(a - MESA_RAMP), Math.cos(a - MESA_RAMP))));
    const edge = lerp(26, 380, ramp);
    return 1 - smoothstep(MESA.radius - edge, MESA.radius, d);
  }

  /** Distance to a polyline (m). */
  private static polyDist(x: number, z: number, pts: [number, number][]): number {
    let best = Infinity;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const vx = bx - ax;
      const vz = bz - az;
      const t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
      best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
    }
    return best;
  }

  /** 0..1 canyon floor (1) fading to the walls; v2. */
  canyonMask(x: number, z: number): number {
    if (!this.v2) return 0;
    if (Math.abs(x - MESA.x) > MESA.radius + 900 || Math.abs(z - MESA.z) > MESA.radius + 600) return 0;
    const w = CANYON_HALF + this.n.get(x / 90, z / 90) * 5;
    const d = Terrain.polyDist(x + this.n2.get(x / 140, z / 140) * 18, z, CANYON);
    return 1 - smoothstep(w, w + 9, d);
  }

  /** 0..1 shallow stream bed on top of the mesa (rendered as running water); v2. */
  streamMask(x: number, z: number): number {
    if (!this.v2) return 0;
    if (Math.abs(x - 560) > 200 || z < 1400 || z > 2300) return 0;
    return 1 - smoothstep(3, 7, Terrain.polyDist(x, z, WATERFALL_STREAM));
  }

  private profile: { x: number; z: number; y: number }[] | null = null;

  /**
   * Water surface along the mesa stream, every 3 m from its source to the
   * rim: never runs uphill (running minimum of the ground), so the water is
   * one smooth ribbon and the bed is carved under it.
   */
  streamProfile(): { x: number; z: number; y: number }[] {
    if (this.profile) return this.profile;
    const out: { x: number; z: number; y: number }[] = [];
    const P = WATERFALL_STREAM;
    let surf = Infinity;
    outer: for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i];
      const [bx, bz] = P[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d < len; d += 3) {
        const x = ax + ((bx - ax) * d) / len;
        const z = az + ((bz - az) * d) / len;
        if (this.mesaMask(x, z) < 0.98) break outer; // reached the rim
        const g = this.rawHeight(x, z, false, false);
        surf = Math.min(surf, g - 0.35);
        out.push({ x, z, y: surf });
      }
    }
    this.profile = out;
    return out;
  }

  /** 0..1 temperate forest patches; v2. */
  forestMask(x: number, z: number): number {
    if (!this.v2) return 0;
    const f = this.n2.fbm(x / 950 + 5.1, z / 950 - 3.7, 3) + this.n.fbm(x / 240, z / 240, 2) * 0.14;
    const nearSpawn = smoothstep(260, 650, Math.hypot(x - SPAWN.x, z - SPAWN.z));
    return smoothstep(0.02, 0.2, f) * nearSpawn;
  }

  /** 0..1 inside a lake basin (1 at the deepest part); v2. */
  lakeMask(x: number, z: number): { w: number; lake: Lake | null; dn: number } {
    let best = { w: 0, lake: null as Lake | null, dn: 9 };
    for (const l of this.lakes) {
      const r = Math.max(l.rx, l.rz) * 1.3;
      if (Math.abs(x - l.x) > r || Math.abs(z - l.z) > r) continue;
      const c = Math.cos(l.rot);
      const s = Math.sin(l.rot);
      const lx = (x - l.x) * c - (z - l.z) * s;
      const lz = (x - l.x) * s + (z - l.z) * c;
      const dn = Math.hypot(lx / l.rx, lz / l.rz) + this.n.get(x / 70 + 3, z / 70) * 0.12;
      const w = 1 - smoothstep(0.85, 1.25, dn);
      if (w > best.w) best = { w, lake: l, dn };
    }
    return best;
  }

  /** Chooses the lakes of this world: the waterfall's plunge pool plus up to 7 lowland lakes. */
  private placeLakes(): void {
    // Plunge pool at the foot of the cliff where the stream falls: follow the
    // stream past the rim to the base of the cliff (the rim moves with the noise).
    const [ax, az] = WATERFALL_STREAM[WATERFALL_STREAM.length - 2];
    const [ex, ez] = WATERFALL_STREAM[WATERFALL_STREAM.length - 1];
    const len = Math.hypot(ex - ax, ez - az);
    const dx = (ex - ax) / len;
    const dz = (ez - az) / len;
    let s = 0;
    while (s < 900 && this.mesaMask(ax + dx * s, az + dz * s) > 0.02) s += 4;
    this.lakes.push({ id: 'lake_waterfall', x: ax + dx * (s + 40), z: az + dz * (s + 40), rx: 70, rz: 85, rot: Math.atan2(dx, dz), depth: 6 });
    const rng = new Rng(hashString('lakes') ^ this.seed);
    const ok = (x: number, z: number, r: number) => {
      const h = this.rawHeight(x, z, false);
      if (h < 2.5 || h > 32 || this.continentMask(x, z) < 0.98) return false;
      if (this.mountainMask(x, z) > 0.05 || this.swampMask(x, z) > 0.05 || this.volcanoFactor(x, z) > 0) return false;
      if (Math.hypot(x - MESA.x, z - MESA.z) < MESA.radius + r + 250) return false;
      if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < r + 220) return false;
      for (const s of PLANNED_SITES) if (Math.hypot(x - s.x, z - s.z) < s.radius * 1.6 + r + 60) return false;
      for (const l of this.lakes) if (Math.hypot(x - l.x, z - l.z) < Math.max(l.rx, l.rz) + r + 500) return false;
      return true;
    };
    // One within a short walk of the spawn, the others spread over the continent.
    for (let tries = 0; tries < 300 && this.lakes.length < 2; tries++) {
      const a = rng.next() * Math.PI * 2;
      const d = rng.range(380, 750);
      const r = rng.range(70, 120);
      const x = SPAWN.x + Math.sin(a) * d;
      const z = SPAWN.z + Math.cos(a) * d;
      if (ok(x, z, r)) this.lakes.push({ id: `lake_${this.lakes.length}`, x, z, rx: r, rz: r * rng.range(0.55, 0.9), rot: rng.next() * Math.PI, depth: rng.range(3, 6) });
    }
    for (let tries = 0; tries < 800 && this.lakes.length < 8; tries++) {
      const a = rng.next() * Math.PI * 2;
      const d = Math.sqrt(rng.next()) * WORLD.continentRadius * 0.78;
      const r = rng.range(90, 230);
      const x = Math.sin(a) * d;
      const z = Math.cos(a) * d;
      if (ok(x, z, r)) this.lakes.push({ id: `lake_${this.lakes.length}`, x, z, rx: r, rz: r * rng.range(0.5, 0.9), rot: rng.next() * Math.PI, depth: rng.range(3.5, 8) });
    }
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
    const d = Math.hypot(x - SWAMP.x, z - SWAMP.z) + this.n.fbm(x / 600, z / 600, 2) * 250 + (this.v2 ? this.n2.fbm(x / 230, z / 230, 2) * 150 : 0);
    return 1 - smoothstep(SWAMP.radius * 0.55, SWAMP.radius, d);
  }

  private jungleMask(x: number, z: number): number {
    const d = Math.hypot(x - JUNGLE.x, z - JUNGLE.z) + this.n2.fbm(x / 700, z / 700, 2) * 350 + (this.v2 ? this.n.fbm(x / 260, z / 260, 2) * 200 : 0);
    return 1 - smoothstep(JUNGLE.radius * 0.5, JUNGLE.radius, d);
  }

  volcanoFactor(x: number, z: number): number {
    let d = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    if (d > VOLCANO.radius * 1.35) return 0;
    // v2: lava-flow lobes instead of a perfect circle (the crater keeps its true distance).
    if (this.v2) d += this.n2.fbm(x / 420, z / 420, 3) * 170 * smoothstep(150, 500, d);
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

  private rawHeight(x: number, z: number, lakes = true, stream = true): number {
    const cont = this.continentMask(x, z);
    const hills = this.n.fbm(x / 700, z / 700, 5) * 22 + this.n.fbm(x / 160, z / 160, 3) * 3.5;
    let h = lerp(-45, 10 + hills, cont);
    if (this.v2 && cont > 0.5 && cont < 1) {
      // Varied coasts: wide sandy shelves along some stretches, sea cliffs along others.
      const kind = this.n3.fbm(x / 1500 + 21, z / 1500 - 8, 2);
      const beach = smoothstep(0.02, 0.18, kind);
      const cliff = smoothstep(-0.08, -0.22, kind);
      if (beach > 0) h = lerp(h, lerp(-6, 2.6, smoothstep(0.7, 0.97, cont)) + hills * 0.08 * cont, beach * smoothstep(0.55, 0.75, cont) * (1 - smoothstep(0.97, 1, cont)));
      if (cliff > 0) h += cliff * smoothstep(0.855, 0.885, cont) * (24 + this.n.ridged(x / 90, z / 90, 3) * 10);
    }

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
    const mesa = this.mesaMask(x, z);
    const river = this.riverMask(x, z) * lowland * smoothstep(0.55, 0.85, cont) * (1 - v) * (1 - mesa);
    if (river > 0) h = lerp(h, -2.2, river);

    if (mesa > 0) {
      // The plateau: flat-topped with rocky terraces; the canyon floor stays at the base level.
      const canyon = this.canyonMask(x, z);
      // Soft terraces: rounded steps that read as rock layers but stay walkable.
      const tv = this.n2.get(x / 55, z / 55) * 2;
      const tf = tv - Math.floor(tv);
      const terrace = (Math.floor(tv) + smoothstep(0.3, 0.7, tf)) * 1.2;
      const top = MESA.height + this.n.fbm(x / 140, z / 140, 3) * 3 + terrace;
      h += mesa * (1 - canyon) * top;
      const st = stream ? this.streamMask(x, z) : 0;
      if (st > 0) {
        // Carve the bed under the (smooth) water surface of the stream.
        let best = Infinity;
        let y = h;
        for (const p of this.streamProfile()) {
          const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
          if (d < best) {
            best = d;
            y = p.y;
          }
        }
        if (best < 400) h = lerp(h, Math.min(h, y - 0.7), st);
      }
    }
    if (this.v2 && lakes && this.lakes.length) {
      const lk = this.lakeMask(x, z);
      if (lk.w > 0 && lk.lake) {
        const bed = lerp(-lk.lake.depth, 1.2, smoothstep(0.15, 1.1, lk.dn));
        h = lerp(h, Math.min(h, bed), lk.w);
      }
    }

    // Small-scale relief on dry lowland ground: hummocks, dips and the slight
    // depression of animal trails. Fades out in water, swamp and highlands.
    const dry = smoothstep(0.5, 3, h) * (1 - smoothstep(60, 140, h)) * (1 - s) * cont * (1 - mesa * 0.7);
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
    if (this.v2 && this.mesaMask(x, z) > 0.5 && this.canyonMask(x, z) < 0.5) return this.slope(x, z) > 0.9 ? 'mountain' : 'plains';
    if (this.v2 && this.forestMask(x, z) > 0.5 && temp > 1.5 && temp < 30) return 'forest';
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
