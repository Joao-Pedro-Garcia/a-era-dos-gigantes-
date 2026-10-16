import * as THREE from 'three';
import type { BiomeId } from './biomes';
import { groundSample, newGroundSample } from './groundShading';
import { decorGeometry, PLANT_VARIANTS, type DecorKind } from './plants';
import type { Terrain } from './terrain';
import type { InstanceHandle, VegetationPools } from './vegetationPools';

/**
 * Dense decorative ground layer around the player: grass tufts, small
 * ferns, pebbles, fallen logs and tree ferns. Purely visual (no colliders,
 * nothing to harvest, nothing saved). It is generated per 12 m cell from a
 * hash of the cell, follows the ground materials (grass only where the
 * terrain shows grass, ferns on forest floors, stones on bare soil, nothing
 * on animal trails) and is rebuilt incrementally as the player moves.
 */
const CELL = 12;

interface CellView {
  handles: InstanceHandle[];
}

export class GroundCover {
  private cells = new Map<string, CellView>();
  private gs = newGroundSample();
  private radius = 40;
  /** 1 = light models (Low preset). */
  private lod = 0;
  private density = 1;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);
  enabled = true;

  constructor(
    private terrain: Terrain,
    private pools: VegetationPools,
    private biomeAt: (x: number, z: number) => BiomeId,
    private waterLevel: () => number,
  ) {}

  setQuality(groundCover: number, light = false): void {
    this.enabled = groundCover > 0.01;
    if ((light ? 1 : 0) !== this.lod) {
      this.lod = light ? 1 : 0;
      this.clear();
    }
    const r = 18 + 28 * groundCover;
    const d = Math.min(1.2, 0.35 + groundCover * 0.6);
    if (Math.abs(r - this.radius) > 0.5 || Math.abs(d - this.density) > 0.01) {
      this.radius = r;
      this.density = d;
      this.clear();
    }
  }

  /** Adds cells entering the radius (a few per frame) and drops the ones left behind. */
  update(px: number, pz: number, budget = 3): void {
    if (!this.enabled) {
      if (this.cells.size) this.clear();
      return;
    }
    const R = this.radius;
    const want = new Set<string>();
    const cx0 = Math.floor((px - R) / CELL);
    const cx1 = Math.floor((px + R) / CELL);
    const cz0 = Math.floor((pz - R) / CELL);
    const cz1 = Math.floor((pz + R) / CELL);
    const todo: [number, number, number][] = [];
    for (let cz = cz0; cz <= cz1; cz++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const mx = (cx + 0.5) * CELL - px;
        const mz = (cz + 0.5) * CELL - pz;
        const d = Math.hypot(mx, mz);
        if (d > R + CELL * 0.7) continue;
        const key = `${cx},${cz}`;
        want.add(key);
        if (!this.cells.has(key)) todo.push([cx, cz, d]);
      }
    for (const [key, v] of this.cells)
      if (!want.has(key)) {
        for (const h of v.handles) h.pool.remove(h);
        this.cells.delete(key);
      }
    todo.sort((a, b) => a[2] - b[2]);
    for (let i = 0; i < Math.min(budget, todo.length); i++) this.build(todo[i][0], todo[i][1]);
  }

  private build(cx: number, cz: number): void {
    const handles: InstanceHandle[] = [];
    let s = (Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ 0x5bd1e995) >>> 0;
    const rnd = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return (s >>> 0) / 4294967296;
    };
    const sea = this.waterLevel();
    const place = (kind: DecorKind, count: number, accept: (x: number, z: number, h: number) => boolean, scale: [number, number], shadow: boolean) => {
      const n = Math.floor(count) + (rnd() < count % 1 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const x = (cx + rnd()) * CELL;
        const z = (cz + rnd()) * CELL;
        const variant = Math.floor(rnd() * PLANT_VARIANTS);
        const sc = scale[0] + rnd() * (scale[1] - scale[0]);
        const rot = rnd() * Math.PI * 2;
        const h = this.terrain.height(x, z);
        if (h < sea + 0.3 || !accept(x, z, h)) continue;
        this.q.setFromAxisAngle(this.up, rot);
        this.m.compose(new THREE.Vector3(x, h - 0.03, z), this.q, new THREE.Vector3(sc, sc, sc));
        const v = 0.85 + rnd() * 0.3;
        const pool = this.pools.pool(`decor:${kind}:${variant}:${this.lod}`, decorGeometry(kind, variant, this.lod), shadow);
        handles.push(pool.add(this.m, this.c.setRGB(v * (1 + (rnd() - 0.5) * 0.1), v, v)));
      }
    };
    // Sample the ground mix at the cell centre to decide what grows here.
    const mx = (cx + 0.5) * CELL;
    const mz = (cz + 0.5) * CELL;
    const mh = this.terrain.height(mx, mz);
    const g = groundSample(this.terrain, this.biomeAt, mx, mz, mh, this.gs);
    const grass = g.a[0];
    const dirt = g.a[1] + g.a[2] * 0.5;
    const litter = g.b[0] + g.b[1] * 0.5;
    const d = this.density;
    const biome = this.biomeAt(mx, mz);
    const notTrail = (x: number, z: number) => this.terrain.trailMask(x, z) < 0.3;
    const gentle = (x: number, z: number) => this.terrain.slope(x, z) < 0.6;
    place('tuft', grass * 34 * d, (x, z) => notTrail(x, z) && gentle(x, z), [0.8, 1.35], false);
    place('smallFern', (litter * 5 + grass * 0.4) * d, (x, z) => notTrail(x, z) && gentle(x, z), [0.7, 1.3], true);
    place('pebble', (dirt * 6 + litter * 1.5 + 0.6) * d, () => true, [0.5, 1.6], false);
    if (biome === 'jungle' || biome === 'swamp' || biome === 'plains') place('log', (biome === 'plains' ? 0.08 : 0.3) * d, gentle, [0.8, 1.2], true);
    if (biome === 'jungle') place('treeFern', 0.7 * d, gentle, [0.8, 1.2], true);
    this.cells.set(`${cx},${cz}`, { handles });
  }

  clear(): void {
    for (const v of this.cells.values()) for (const h of v.handles) h.pool.remove(h);
    this.cells.clear();
  }

  get cellCount(): number {
    return this.cells.size;
  }
}
