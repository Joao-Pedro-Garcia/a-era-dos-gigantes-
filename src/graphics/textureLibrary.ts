import * as THREE from 'three';
import { MATERIAL_GENERATORS, TERRAIN_GENERATORS, TERRAIN_LAYERS, type MaterialTex, type TexImage } from './texgen';
import type { TexRequest, TexResponse } from './texWorker';

/**
 * Owns every procedural texture of the game and upgrades them progressively:
 *  1. tiny (64 px) versions are generated synchronously so the first frame
 *     already has real materials;
 *  2. the full resolution chosen by the quality preset is read from an
 *     IndexedDB cache or generated in a Web Worker, and swapped in as each
 *     texture arrives (no frame hitch, no network).
 * Materials register with `bind`/`terrainUniforms`, so swapping is a pointer
 * change and the old GPU textures are disposed.
 */
// Bump when a generator changes so cached textures are regenerated.
const TEX_VERSION = 'v3';
const BOOT_SIZE = 64;

export interface MaterialMaps {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
}

interface Binding {
  material: THREE.MeshStandardMaterial;
  name: MaterialTex;
  maps: { map: boolean; normal: boolean; rough: boolean };
}

/** Texture arrays (one sampler for many materials, selected per vertex). */
export const TEXTURE_ARRAYS = {
  terrain: [...TERRAIN_LAYERS] as string[],
  /** Vegetation: bark, ringed bark (palms/cycads), leaf atlas, stone (rocks). */
  veg: ['bark', 'barkRinged', 'leaves', 'rock'],
};
export type ArrayName = keyof typeof TEXTURE_ARRAYS;
export interface ArrayUniforms {
  tAlbedo: { value: THREE.DataArrayTexture };
  tNormal: { value: THREE.DataArrayTexture };
}

const ALL_GENERATORS: Record<string, (n: number) => TexImage> = { ...TERRAIN_GENERATORS, ...MATERIAL_GENERATORS };

export class TextureLibrary {
  readonly arrays: Record<ArrayName, ArrayUniforms> = {
    terrain: { tAlbedo: { value: null as unknown as THREE.DataArrayTexture }, tNormal: { value: null as unknown as THREE.DataArrayTexture } },
    veg: { tAlbedo: { value: null as unknown as THREE.DataArrayTexture }, tNormal: { value: null as unknown as THREE.DataArrayTexture } },
  };
  /** Kept for the terrain material. */
  get terrainUniforms(): ArrayUniforms {
    return this.arrays.terrain;
  }
  private mats = new Map<MaterialTex, MaterialMaps>();
  private bindings: Binding[] = [];
  private images = new Map<string, TexImage>();
  private worker: Worker | null = null;
  private requestId = 0;
  private anisotropy = 1;
  /** Size currently shown / requested. */
  size = BOOT_SIZE;
  target = BOOT_SIZE;
  /** Diagnostics (shown by tests and the perf overlay). */
  readonly stats = { bootMs: 0, generatedMs: 0, generated: 0, fromCache: 0, pending: 0 };

  constructor() {
    const t0 = performance.now();
    for (const name of Object.keys(ALL_GENERATORS)) {
      const img = ALL_GENERATORS[name](BOOT_SIZE);
      this.images.set(name, img);
      if (name in MATERIAL_GENERATORS) this.setMaterial(name as MaterialTex, img);
    }
    for (const a of Object.keys(TEXTURE_ARRAYS) as ArrayName[]) this.setArray(a, TEXTURE_ARRAYS[a].map((n) => this.images.get(n)!));
    this.stats.bootMs = performance.now() - t0;
  }

  maps(name: MaterialTex): MaterialMaps {
    return this.mats.get(name)!;
  }

  /** Assigns a material's maps now and keeps them updated as resolution improves. */
  bind(material: THREE.MeshStandardMaterial, name: MaterialTex, maps = { map: true, normal: true, rough: true }): THREE.MeshStandardMaterial {
    const m = this.mats.get(name)!;
    if (maps.map) material.map = m.map;
    if (maps.normal) material.normalMap = m.normalMap;
    if (maps.rough) material.roughnessMap = m.roughnessMap;
    material.needsUpdate = true;
    this.bindings.push({ material, name, maps });
    return material;
  }

  unbind(material: THREE.Material): void {
    this.bindings = this.bindings.filter((b) => b.material !== material);
  }

  setAnisotropy(a: number): void {
    this.anisotropy = a;
    for (const m of this.mats.values()) for (const t of [m.map, m.normalMap, m.roughnessMap]) t.anisotropy = a;
    for (const arr of Object.values(this.arrays)) for (const t of [arr.tAlbedo.value, arr.tNormal.value]) t.anisotropy = a;
  }

  /** Requests a resolution (cache first, then the worker). Smaller requests keep what is there. */
  request(size: number): void {
    if (size === this.target) return;
    this.target = size;
    if (size <= BOOT_SIZE || typeof Worker === 'undefined') return;
    const names = Object.keys(ALL_GENERATORS);
    const id = ++this.requestId;
    this.stats.pending = names.length;
    void this.loadCached(names, size, id).then((missing) => {
      if (id !== this.requestId || !missing.length) return;
      try {
        this.worker ??= new Worker(new URL('./texWorker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<TexResponse>) => {
          if (e.data.id !== this.requestId) return;
          this.stats.generated++;
          this.stats.generatedMs += e.data.ms;
          this.accept(e.data.name, e.data.image);
          void cachePut(`${TEX_VERSION}:${e.data.name}:${size}`, e.data.image);
        };
        const msg: TexRequest = { id, names: missing, size };
        this.worker.postMessage(msg);
      } catch {
        this.stats.pending = 0; // keep the boot textures
      }
    });
  }

  private async loadCached(names: string[], size: number, id: number): Promise<string[]> {
    const missing: string[] = [];
    for (const name of names) {
      const img = await cacheGet(`${TEX_VERSION}:${name}:${size}`);
      if (id !== this.requestId) return [];
      if (img) {
        this.stats.fromCache++;
        this.accept(name, img);
      } else missing.push(name);
    }
    return missing;
  }

  private accept(name: string, img: TexImage): void {
    this.stats.pending = Math.max(0, this.stats.pending - 1);
    this.images.set(name, img);
    if (name in MATERIAL_GENERATORS) this.setMaterial(name as MaterialTex, img);
    // Swap an array once every layer has the new size (layers must match).
    for (const a of Object.keys(TEXTURE_ARRAYS) as ArrayName[]) {
      const list = TEXTURE_ARRAYS[a];
      if (!list.includes(name)) continue;
      const imgs = list.map((n) => this.images.get(n)!);
      if (imgs.every((t) => t.size === img.size)) this.setArray(a, imgs);
    }
    this.size = img.size;
  }

  private setArray(which: ArrayName, layers: TexImage[]): void {
    const n = layers[0].size;
    const L = layers.length;
    const alb = new Uint8Array(n * n * 4 * L);
    const nor = new Uint8Array(n * n * 4 * L);
    layers.forEach((img, i) => {
      alb.set(img.albedo, i * n * n * 4);
      nor.set(img.normal, i * n * n * 4);
    });
    const mk = (data: Uint8Array, srgb: boolean) => {
      const t = new THREE.DataArrayTexture(data, n, n, L);
      t.format = THREE.RGBAFormat;
      t.type = THREE.UnsignedByteType;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = this.anisotropy;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    const u = this.arrays[which];
    u.tAlbedo.value?.dispose();
    u.tNormal.value?.dispose();
    u.tAlbedo.value = mk(alb, true);
    u.tNormal.value = mk(nor, false);
  }

  private setMaterial(name: MaterialTex, img: TexImage): void {
    const n = img.size;
    const rough = new Uint8Array(n * n * 4);
    for (let i = 0; i < n * n; i++) {
      const r = img.normal[i * 4 + 3];
      rough[i * 4] = r;
      rough[i * 4 + 1] = r;
      rough[i * 4 + 2] = r;
      rough[i * 4 + 3] = 255;
    }
    const mk = (data: Uint8Array, srgb: boolean) => {
      const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true;
      t.anisotropy = this.anisotropy;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    const next: MaterialMaps = { map: mk(img.albedo, true), normalMap: mk(img.normal, false), roughnessMap: mk(rough, false) };
    const prev = this.mats.get(name);
    this.mats.set(name, next);
    for (const b of this.bindings) {
      if (b.name !== name) continue;
      if (b.maps.map) b.material.map = next.map;
      if (b.maps.normal) b.material.normalMap = next.normalMap;
      if (b.maps.rough) b.material.roughnessMap = next.roughnessMap;
    }
    if (prev) for (const t of [prev.map, prev.normalMap, prev.roughnessMap]) t.dispose();
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const m of this.mats.values()) for (const t of [m.map, m.normalMap, m.roughnessMap]) t.dispose();
    for (const arr of Object.values(this.arrays)) {
      arr.tAlbedo.value?.dispose();
      arr.tNormal.value?.dispose();
    }
    this.bindings = [];
  }
}

// ------------------------------------------------------------------ IndexedDB cache (best effort)

const DB = 'edg-texcache';
let dbp: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  dbp ??= new Promise((resolve) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('tex');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

async function cacheGet(key: string): Promise<TexImage | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const r = d.transaction('tex').objectStore('tex').get(key);
      r.onsuccess = () => {
        const v = r.result as TexImage | undefined;
        resolve(v && v.albedo instanceof Uint8Array && v.normal instanceof Uint8Array && v.albedo.length === v.size * v.size * 4 ? v : null);
      };
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function cachePut(key: string, img: TexImage): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    d.transaction('tex', 'readwrite').objectStore('tex').put(img, key);
  } catch {
    /* quota or private mode: the textures are simply regenerated next time */
  }
}
