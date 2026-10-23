import { WORLD } from '../core/config';
import { clamp } from '../core/math';
import type { BiomeId } from './biomes';
import { groundSample, newGroundSample } from './groundShading';
import type { Terrain } from './terrain';
import type { FarTerrainData } from './farTerrain';

/**
 * Pure computation of one terrain sector's mesh data (no three.js), so it
 * runs either on the main thread (tests, fallback) or in a Web Worker.
 */
export interface TerrainMeshData {
  sx: number;
  sz: number;
  res: number;
  position: Float32Array;
  normal: Float32Array;
  color: Float32Array;
  uv: Float32Array;
  splatA: Float32Array;
  splatB: Float32Array;
  index: Uint32Array;
}

const SKIRT = 12;

export function terrainMeshData(terrain: Terrain, biomeAt: (x: number, z: number) => BiomeId, sx: number, sz: number, res: number): TerrainMeshData {
  const S = WORLD.sectorSize;
  const step = S / res;
  const x0 = sx * S;
  const z0 = sz * S;
  const N = res + 1;
  const G = res + 3; // with a 1-vertex border for normals
  const hs = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) hs[j * G + i] = terrain.height(x0 + (i - 1) * step, z0 + (j - 1) * step);

  const vcount = N * N + 4 * N;
  const pos = new Float32Array(vcount * 3);
  const uvs = new Float32Array(vcount * 2);
  const nor = new Float32Array(vcount * 3);
  const col = new Float32Array(vcount * 3);
  const splatA = new Float32Array(vcount * 4);
  const splatB = new Float32Array(vcount * 4);
  const gs = newGroundSample();
  let v = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const gi = (j + 1) * G + (i + 1);
      const h = hs[gi];
      const x = x0 + i * step;
      const z = z0 + j * step;
      pos[v * 3] = x;
      pos[v * 3 + 1] = h;
      pos[v * 3 + 2] = z;
      uvs[v * 2] = x / 7;
      uvs[v * 2 + 1] = z / 7;
      const dx = hs[gi + 1] - hs[gi - 1];
      const dz = hs[gi + G] - hs[gi - G];
      const ny = 2 * step;
      const l = Math.hypot(dx, ny, dz);
      nor[v * 3] = -dx / l;
      nor[v * 3 + 1] = ny / l;
      nor[v * 3 + 2] = -dz / l;
      groundSample(terrain, biomeAt, x, z, h, gs);
      col.set(gs.tint, v * 3);
      // Ambient occlusion from local concavity (hollows and the foot of slopes are darker).
      const lap = (hs[gi + 1] + hs[gi - 1] + hs[gi + G] + hs[gi - G]) * 0.25 - h;
      const ao = clamp(1 - Math.max(0, lap) * (0.9 / Math.max(1, step)) * 2.2, 0.55, 1);
      splatA.set(gs.a, v * 4);
      splatB[v * 4] = gs.b[0];
      splatB[v * 4 + 1] = gs.b[1];
      splatB[v * 4 + 2] = gs.b[2];
      splatB[v * 4 + 3] = ao;
      v++;
    }
  // Skirt vertices hide cracks between neighbouring LODs (slanted inward so they never z-fight).
  const edge = (i: number, j: number) => {
    const src = j * N + i;
    const cx = x0 + S / 2;
    const cz = z0 + S / 2;
    const ex = pos[src * 3];
    const ez = pos[src * 3 + 2];
    const len = Math.hypot(cx - ex, cz - ez) || 1;
    pos[v * 3] = ex + ((cx - ex) / len) * 1.5;
    pos[v * 3 + 1] = pos[src * 3 + 1] - SKIRT;
    pos[v * 3 + 2] = ez + ((cz - ez) / len) * 1.5;
    uvs.copyWithin(v * 2, src * 2, src * 2 + 2);
    nor.copyWithin(v * 3, src * 3, src * 3 + 3);
    col.copyWithin(v * 3, src * 3, src * 3 + 3);
    splatA.copyWithin(v * 4, src * 4, src * 4 + 4);
    splatB.copyWithin(v * 4, src * 4, src * 4 + 4);
    return v++;
  };
  const idx: number[] = [];
  for (let j = 0; j < res; j++)
    for (let i = 0; i < res; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const sides: [number, number][][] = [
    Array.from({ length: N }, (_, i) => [i, 0]),
    Array.from({ length: N }, (_, i) => [N - 1, i]),
    Array.from({ length: N }, (_, i) => [N - 1 - i, N - 1]),
    Array.from({ length: N }, (_, i) => [0, N - 1 - i]),
  ];
  for (const side of sides) {
    const top = side.map(([i, j]) => j * N + i);
    const bottom = side.map(([i, j]) => edge(i, j));
    for (let k = 0; k < N - 1; k++) idx.push(top[k], top[k + 1], bottom[k], top[k + 1], bottom[k + 1], bottom[k]);
  }
  return {
    sx,
    sz,
    res,
    position: pos.slice(0, v * 3),
    normal: nor.slice(0, v * 3),
    color: col.slice(0, v * 3),
    uv: uvs.slice(0, v * 2),
    splatA: splatA.slice(0, v * 4),
    splatB: splatB.slice(0, v * 4),
    index: Uint32Array.from(idx),
  };
}

/** Cached coarse biome lookup (8 m grid), shared by the main thread and the worker. */
export function biomeCache(terrain: Terrain): (x: number, z: number) => BiomeId {
  const cache = new Map<string, BiomeId>();
  return (x: number, z: number) => {
    const k = `${Math.round(x / 8)},${Math.round(z / 8)}`;
    let b = cache.get(k);
    if (!b) {
      b = terrain.biomeAt(Math.round(x / 8) * 8, Math.round(z / 8) * 8);
      if (cache.size > 60000) cache.clear();
      cache.set(k, b);
    }
    return b;
  };
}

/** Builds sector meshes in a Web Worker; resolves with the arrays (transferred, no copy). */
export class TerrainJobs {
  private worker: Worker;
  private next = 1;
  private waiting = new Map<number, (d: never) => void>();

  constructor(seed: number, version: number) {
    this.worker = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<{ id: number; data: never }>) => {
      const cb = this.waiting.get(e.data.id);
      this.waiting.delete(e.data.id);
      cb?.(e.data.data);
    };
    this.worker.postMessage({ type: 'init', seed, version });
  }

  get inFlight(): number {
    return this.waiting.size;
  }

  request(sx: number, sz: number, res: number): Promise<TerrainMeshData> {
    const id = this.next++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve as (d: never) => void);
      this.worker.postMessage({ type: 'build', id, sx, sz, res });
    });
  }

  /** Whole-continent horizon mesh (see farTerrain.ts), in its own worker so sectors are not delayed. */
  far(res: number, seed: number, version: number): Promise<FarTerrainData> {
    return new Promise((resolve) => {
      const w = new Worker(new URL('./terrainWorker.ts', import.meta.url), { type: 'module' });
      this.farWorker = w;
      w.onmessage = (e: MessageEvent<{ id: number; data: FarTerrainData }>) => {
        resolve(e.data.data);
        w.terminate();
        if (this.farWorker === w) this.farWorker = null;
      };
      w.postMessage({ type: 'init', seed, version });
      w.postMessage({ type: 'far', id: 0, res });
    });
  }
  private farWorker: Worker | null = null;

  dispose(): void {
    this.farWorker?.terminate();
    this.worker.terminate();
    this.waiting.clear();
  }
}
