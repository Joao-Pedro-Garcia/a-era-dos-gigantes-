import * as THREE from 'three';
import { WORLD } from '../core/config';
import type { BiomeId } from './biomes';
import { groundSample, newGroundSample } from './groundShading';
import type { Terrain } from './terrain';

/**
 * A single coarse mesh of the whole continent (and its surrounding sea
 * floor) drawn behind the streamed sectors, so mountains, coasts and the
 * volcano are visible all the way to the horizon instead of the world ending
 * at the load radius. The terrain material sinks it under the detailed area
 * (uniforms uHoleCenter/uHoleRadius), so it never covers nearby ground.
 * The data is computed in the terrain worker (pure function below).
 */
export interface FarTerrainData {
  position: Float32Array;
  color: Float32Array;
  splatA: Float32Array;
  splatB: Float32Array;
  index: Uint32Array;
}

export function farTerrainData(terrain: Terrain, biomeAt: (x: number, z: number) => BiomeId, res = 160): FarTerrainData {
  const half = WORLD.worldHalfSize * 1.25;
  const N = res + 1;
  const step = (half * 2) / res;
  const pos = new Float32Array(N * N * 3);
  const col = new Float32Array(N * N * 3);
  const splatA = new Float32Array(N * N * 4);
  const splatB = new Float32Array(N * N * 4);
  const gs = newGroundSample();
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const h = terrain.height(x, z);
      const k = j * N + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      groundSample(terrain, biomeAt, x, z, h, gs);
      col.set(gs.tint, k * 3);
      splatA.set(gs.a, k * 4);
      splatB[k * 4] = gs.b[0];
      splatB[k * 4 + 1] = gs.b[1];
      splatB[k * 4 + 2] = gs.b[2];
      splatB[k * 4 + 3] = 1;
    }
  const index = new Uint32Array(res * res * 6);
  let o = 0;
  for (let j = 0; j < res; j++)
    for (let i = 0; i < res; i++) {
      const a = j * N + i;
      index.set([a, a + N, a + 1, a + 1, a + N, a + N + 1], o);
      o += 6;
    }
  return { position: pos, color: col, splatA, splatB, index };
}

export function farTerrainGeometry(d: FarTerrainData): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(d.color, 3));
  geo.setAttribute('splatA', new THREE.BufferAttribute(d.splatA, 4));
  geo.setAttribute('splatB', new THREE.BufferAttribute(d.splatB, 4));
  geo.setIndex(new THREE.BufferAttribute(d.index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Synchronous build (tests, or browsers without workers). */
export function buildFarTerrain(terrain: Terrain, biomeAt: (x: number, z: number) => BiomeId, res = 160): THREE.BufferGeometry {
  return farTerrainGeometry(farTerrainData(terrain, biomeAt, res));
}
