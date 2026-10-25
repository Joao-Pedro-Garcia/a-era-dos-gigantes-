import { describe, expect, it } from 'vitest';
import { CANYON, MESA, MESA_RAMP, PLANNED_SITES, SPAWN, Terrain, TERRAIN_VERSION } from '../src/world/terrain';
import { WORLD_LIMIT, applyCurrent, lairs, placeKey, worldPois } from '../src/world/pois';
import { waterfallPath } from '../src/world/landmarks';
import { SAVE_VERSION, sanitize, type SaveData } from '../src/save/saveData';
import { createInventory } from '../src/inventory/inventory';
import { createSurvival } from '../src/survival/survival';
import { createEnvState } from '../src/world/environment';
import { Environment } from '../src/world/environment';
import { Ecosystem, createEcosystemState } from '../src/animals/ecosystem';
import { createProgression } from '../src/progression/skills';
import { createExploration } from '../src/exploration/exploration';
import { createMysteries } from '../src/mysteries/mysteries';
import { WORLD } from '../src/core/config';

const SEEDS = [12345, 7, 99, 424242];

describe('continent v2: generator versions', () => {
  it('new worlds use version 2; version 1 keeps the old continent (no lakes, mesa or forests)', () => {
    expect(TERRAIN_VERSION).toBe(2);
    const v1 = new Terrain(12345, 1);
    expect(v1.lakes).toHaveLength(0);
    expect(v1.mesaMask(MESA.x, MESA.z)).toBe(0);
    expect(worldPois(v1)).toHaveLength(0);
    let forest = 0;
    for (let x = -4000; x <= 4000; x += 250) for (let z = -4000; z <= 4000; z += 250) if (v1.biomeAt(x, z) === 'forest') forest++;
    expect(forest).toBe(0);
  });

  it('saves keep their generator version; invalid values fall back to the old one', () => {
    const save: SaveData = {
      version: SAVE_VERSION, savedAt: 0, seed: 1,
      player: { x: 1, y: 2, z: 3, yaw: 0, survival: createSurvival(), respawn: null, deaths: 0 },
      inventory: createInventory(), crafting: { queue: [], unlocked: [] }, env: createEnvState(1), eco: createEcosystemState(1),
      building: { pieces: [], nextId: 1 }, world: { harvested: {}, bags: [], nextBagId: 1, discovered: [], terrainVersion: 2 },
      progression: createProgression(), exploration: createExploration(), mysteries: createMysteries(),
    };
    sanitize(save);
    expect(save.world.terrainVersion).toBe(2);
    save.world.terrainVersion = 77;
    sanitize(save);
    expect(save.world.terrainVersion).toBe(1);
  });
});

describe('continent v2: geography', () => {
  it('has varied biomes: plains no longer dominate, forests are common', () => {
    for (const seed of SEEDS) {
      const t = new Terrain(seed);
      const cnt: Record<string, number> = {};
      let land = 0;
      for (let x = -4800; x <= 4800; x += 120)
        for (let z = -4800; z <= 4800; z += 120) {
          const b = t.biomeAt(x, z);
          if (b === 'ocean') continue;
          land++;
          cnt[b] = (cnt[b] ?? 0) + 1;
        }
      expect(cnt.plains / land).toBeLessThan(0.5);
      expect(cnt.forest / land).toBeGreaterThan(0.1);
      for (const b of ['beach', 'jungle', 'swamp', 'mountain', 'snow', 'volcanic']) expect(cnt[b] ?? 0).toBeGreaterThan(0);
    }
  });

  it('places lakes of real water, one within a short walk of the start', () => {
    for (const seed of SEEDS) {
      const t = new Terrain(seed);
      expect(t.lakes.length).toBeGreaterThanOrEqual(5);
      for (const l of t.lakes) expect(t.height(l.x, l.z)).toBeLessThan(-2);
      expect(t.lakes.some((l) => l.id !== 'lake_waterfall' && Math.hypot(l.x - SPAWN.x, l.z - SPAWN.z) < 900)).toBe(true);
      // The start and the authored sites stay on dry ground.
      const sp = t.findDryGround(SPAWN.x, SPAWN.z);
      expect(t.height(sp.x, sp.z)).toBeGreaterThan(1.5);
      for (const s of PLANNED_SITES) expect(t.height(s.x, s.z)).toBeGreaterThan(1);
    }
  });

  it('the mesa has cliffs, a walkable ramp and a canyon you can walk through', () => {
    for (const seed of SEEDS) {
      const t = new Terrain(seed);
      const inside = t.height(MESA.x + 150, MESA.z + 150);
      const outside = t.height(MESA.x - Math.sin(0) * (MESA.radius + 250), MESA.z - Math.cos(0) * (MESA.radius + 250));
      expect(inside - outside).toBeGreaterThan(20);
      // Ramp: from the plain up onto the plateau without exceeding a walkable slope.
      let maxSlope = 0;
      for (let r = MESA.radius + 150; r > MESA.radius * 0.4; r -= 4) {
        const x = MESA.x + Math.sin(MESA_RAMP) * r;
        const z = MESA.z + Math.cos(MESA_RAMP) * r;
        const x2 = MESA.x + Math.sin(MESA_RAMP) * (r - 4);
        const z2 = MESA.z + Math.cos(MESA_RAMP) * (r - 4);
        // Only the ramp itself (a river may cross its foot: that one you swim across).
        if (t.mesaMask(x, z) < 0.25) continue;
        maxSlope = Math.max(maxSlope, Math.abs(t.height(x2, z2) - t.height(x, z)) / 4);
      }
      expect(maxSlope).toBeLessThan(1.1);
      // Canyon floor: well below the plateau and gentle all the way through.
      let canyonSlope = 0;
      let deepest = Infinity;
      for (let i = 0; i + 1 < CANYON.length; i++) {
        const [ax, az] = CANYON[i];
        const [bx, bz] = CANYON[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        for (let d = 0; d + 4 < len; d += 4) {
          const h0 = t.height(ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len);
          const h1 = t.height(ax + ((bx - ax) * (d + 4)) / len, az + ((bz - az) * (d + 4)) / len);
          canyonSlope = Math.max(canyonSlope, Math.abs(h1 - h0) / 4);
          deepest = Math.min(deepest, h0);
        }
      }
      expect(canyonSlope).toBeLessThan(1.1);
      const mid = CANYON[2];
      const wall = t.height(mid[0], mid[1] + 60);
      expect(wall - t.height(mid[0], mid[1])).toBeGreaterThan(20);
    }
  });

  it('the waterfall: a stream that never runs uphill falls from the rim into the pool', () => {
    for (const seed of SEEDS) {
      const t = new Terrain(seed);
      const prof = t.streamProfile();
      expect(prof.length).toBeGreaterThan(20);
      for (let i = 1; i < prof.length; i++) expect(prof[i].y).toBeLessThanOrEqual(prof[i - 1].y + 1e-9);
      // The water surface lies above the carved bed everywhere.
      for (const p of prof) expect(t.height(p.x, p.z)).toBeLessThan(p.y);
      const path = waterfallPath(t)!;
      expect(path).not.toBeNull();
      expect(path.info.top.y).toBeGreaterThan(30);
      const pool = t.lakes.find((l) => l.id === 'lake_waterfall')!;
      expect(Math.hypot(path.info.top.x - pool.x, path.info.top.z - pool.z)).toBeLessThan(160);
    }
  });
});

describe('continent v2: points of interest and limits', () => {
  it('spreads every kind of point of interest over dry land, deterministically', () => {
    for (const seed of SEEDS) {
      const t = new Terrain(seed);
      const pois = worldPois(t);
      expect(worldPois(new Terrain(seed)).map((p) => p.id)).toEqual(pois.map((p) => p.id));
      const kinds = new Set(pois.map((p) => p.kind));
      for (const k of ['arch', 'pillars', 'grove', 'crystals', 'lair', 'bonebed', 'lake', 'waterfall', 'canyon']) expect(kinds.has(k as never)).toBe(true);
      for (const p of pois) {
        if (p.kind === 'lake' || p.kind === 'waterfall' || p.kind === 'canyon') continue;
        expect(t.height(p.x, p.z)).toBeGreaterThan(1.5);
      }
      for (const l of lairs(t)) expect(Math.hypot(l.x - SPAWN.x, l.z - SPAWN.z)).toBeGreaterThan(1000);
      // Not everything sits near the start.
      const far = pois.filter((p) => Math.hypot(p.x - SPAWN.x, p.z - SPAWN.z) > 2000).length;
      expect(far).toBeGreaterThan(pois.length * 0.3);
    }
  });

  it('names places for the journal and map', () => {
    expect(placeKey('ruin_plains_outpost')).toBe('site.ruin_plains_outpost');
    expect(placeKey('poi:arch:1')).toBe('poi.arch');
    expect(placeKey('poi:lake_3')).toBe('poi.lake');
    expect(placeKey('poi:lake_waterfall')).toBe('poi.waterfall');
    expect(placeKey('poi:canyon')).toBe('poi.canyon');
  });

  it('open-sea currents carry swimmers back and nobody passes the hard limit', () => {
    const pos = { x: WORLD_LIMIT.current - 10, z: 0 };
    expect(applyCurrent(pos, 1)).toBe(false);
    pos.x = WORLD_LIMIT.current + 200;
    const before = pos.x;
    expect(applyCurrent(pos, 1)).toBe(true);
    expect(pos.x).toBeLessThan(before);
    const far = { x: 9000, z: 9000 };
    applyCurrent(far, 0.016);
    expect(Math.hypot(far.x, far.z)).toBeLessThanOrEqual(WORLD_LIMIT.hard + 1e-6);
    // Past every coast of the continent.
    const t = new Terrain(12345);
    for (let a = 0; a < Math.PI * 2; a += 0.2) expect(t.biomeAt(Math.sin(a) * WORLD_LIMIT.current, Math.cos(a) * WORLD_LIMIT.current)).toBe('ocean');
  });
});

describe('continent v2: ecosystem', () => {
  it('predator dens are seeded with a big predator group living in the den', () => {
    const seed = 12345;
    const t = new Terrain(seed);
    const env = new Environment(createEnvState(seed), t);
    const eco = new Ecosystem(createEcosystemState(seed), t, env, seed);
    const lair = lairs(t)[0];
    eco.seedAround(lair.x, lair.z);
    const near = [...eco.animals.values()].filter((a) => Math.hypot(a.x - lair.x, a.z - lair.z) < 120);
    const big = near.filter((a) => ['tyrannosaurus', 'allosaurus', 'carnotaurus', 'spinosaurus', 'baryonyx'].includes(a.speciesId));
    expect(big.length).toBeGreaterThan(0);
    expect(big.every((a) => Math.hypot(a.homeX - lair.x, a.homeZ - lair.z) < 1)).toBe(true);
  });

  it('forests have their own fauna, and species are not spread evenly everywhere', async () => {
    const { BIOMES } = await import('../src/world/biomes');
    expect(Object.keys(BIOMES.forest.fauna).length).toBeGreaterThan(4);
    const everywhere = Object.keys(BIOMES.plains.fauna).filter((id) => (['jungle', 'swamp', 'mountain', 'snow', 'forest'] as const).every((b) => BIOMES[b].fauna[id]));
    expect(everywhere).toHaveLength(0);
    expect(WORLD.continentRadius).toBeGreaterThan(3000);
  });
});
