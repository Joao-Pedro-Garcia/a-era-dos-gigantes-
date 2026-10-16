import { Terrain } from './terrain';
import { biomeCache, terrainMeshData, type TerrainMeshData } from './terrainMesh';
import { farTerrainData } from './farTerrain';

/**
 * Off-thread terrain sector builder: the world is a pure function of the
 * seed, so the worker rebuilds its own Terrain and answers mesh requests.
 */
let terrain: Terrain | null = null;
let biomeAt: ((x: number, z: number) => ReturnType<Terrain['biomeAt']>) | null = null;

type Msg = { type: 'init'; seed: number } | { type: 'build'; id: number; sx: number; sz: number; res: number } | { type: 'far'; id: number; res: number };

self.onmessage = (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === 'init') {
    terrain = new Terrain(m.seed);
    biomeAt = biomeCache(terrain);
    return;
  }
  if (!terrain || !biomeAt) return;
  if (m.type === 'far') {
    const far = farTerrainData(terrain, biomeAt, m.res);
    (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage({ id: m.id, data: far }, [far.position.buffer, far.color.buffer, far.splatA.buffer, far.splatB.buffer, far.index.buffer]);
    return;
  }
  const data: TerrainMeshData = terrainMeshData(terrain, biomeAt, m.sx, m.sz, m.res);
  const transfer = [data.position.buffer, data.normal.buffer, data.color.buffer, data.uv.buffer, data.splatA.buffer, data.splatB.buffer, data.index.buffer];
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage({ id: m.id, data }, transfer);
};
