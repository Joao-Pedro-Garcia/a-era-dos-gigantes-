import * as THREE from 'three';
import { WORLD, type QualityProfile } from '../core/config';
import { clamp } from '../core/math';
import { Rng, hash2 } from '../core/rng';
import { BIOMES, type BiomeId, type VegetationKind } from './biomes';
import { CollisionWorld } from './collision';
import { PLANNED_SITES, type PlannedSite, type Terrain } from './terrain';
import { fossilSite } from '../exploration/exploration';
import { DOCS } from '../mysteries/mysteries';
import { VEG_COLLIDER, VEG_YIELD } from './vegetationModels';
import { PLANT_VARIANTS, plantGeometry } from './plants';
import { VegetationPools, type InstanceHandle } from './vegetationPools';
import { terrainMeshData, type TerrainJobs, type TerrainMeshData } from './terrainMesh';

/**
 * Streams the continent around the player. Sectors close to the player get
 * high-resolution terrain, vegetation, colliders and harvestable nodes; far
 * sectors get coarse terrain only. Geometry is regenerated deterministically
 * from the seed; only harvested state is persisted, so reloading a sector can
 * never duplicate resources.
 */
export interface ResourceNode {
  id: string;
  kind: VegetationKind | 'crate' | 'scrap' | 'fossil' | 'crystal' | 'rubble';
  x: number;
  y: number;
  z: number;
  scale: number;
  biome: BiomeId;
  /** Vegetation instance (removed when depleted). */
  inst: InstanceHandle | null;
  colliderId: string | null;
}

interface SectorView {
  sx: number;
  sz: number;
  lod: number;
  detail: boolean;
  group: THREE.Group;
  nodes: ResourceNode[];
  colliders: string[];
  interactables: Interactable[];
  /** Vegetation instances owned by this sector (released on unload). */
  handles: InstanceHandle[];
  /** Terrain mesh present at the requested detail (false while the worker builds it). */
  terrainReady: boolean;
  /** Distance from the player when it was built (readiness of the area near the player). */
  d: number;
}

/** Depth of cave interiors below the surface (separate playable chambers). */
export const CAVE_Y = -600;
export const CAVE_RADIUS = 15;

/** Non-resource things the player can use: documents, pickups, doors, cave mouths… */
export interface Interactable {
  id: string;
  kind: 'doc' | 'pickup' | 'door' | 'beacon' | 'cache' | 'cave_enter' | 'cave_exit';
  /** Document id, item id or site id depending on kind. */
  ref: string;
  site: string;
  x: number;
  y: number;
  z: number;
  object: THREE.Object3D | null;
  colliderId?: string;
}

/** LOD resolutions relative to the quality preset's finest terrain resolution. */
const LOD_DIV = [1, 2, 4, 8];
const UP = new THREE.Vector3(0, 1, 0);

interface Placed {
  x: number;
  y: number;
  z: number;
  s: number;
  r: number;
  biome: BiomeId;
  id: string;
}

/** Stable 0..1 hash of a string id (variant choice, tilt, tint). */
function hashUnit(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

export class SectorManager {
  readonly root = new THREE.Group();
  private sectors = new Map<string, SectorView>();
  private terrainMat: THREE.MeshStandardMaterial;
  private vegMat: THREE.MeshStandardMaterial;
  private ruinMat: THREE.MeshStandardMaterial;
  private metalMat: THREE.MeshStandardMaterial;
  private boneMat: THREE.MeshStandardMaterial;
  private woodMat: THREE.MeshStandardMaterial;
  private paperMat: THREE.MeshStandardMaterial;
  private screenMat: THREE.MeshStandardMaterial;
  private voidMat: THREE.MeshBasicMaterial;
  /** World-wide instanced vegetation (shared by all sectors). */
  readonly pools: VegetationPools;
  /** Off-thread terrain builder (the game sets it; tests build synchronously). */
  terrainJobs: TerrainJobs | null = null;
  private queue: { sx: number; sz: number; lod: number; detail: boolean; d: number }[] = [];
  private nodeHits = new Map<string, number>();
  private biomeCache = new Map<string, BiomeId>();
  private ready = false;

  constructor(
    private terrain: Terrain,
    private collision: CollisionWorld,
    private seed: number,
    /** nodeId → game time at which it regrows. */
    public harvested: Record<string, number>,
    /** Persistent world flags that change authored places (e.g. 'open:bunker'). */
    public flags: Set<string> = new Set(),
  ) {
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.vegMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5 });
    this.ruinMat = new THREE.MeshStandardMaterial({ color: 0x8d8a80, roughness: 0.9 });
    this.metalMat = new THREE.MeshStandardMaterial({ color: 0x5e6266, roughness: 0.6, metalness: 0.6 });
    this.boneMat = new THREE.MeshStandardMaterial({ color: 0xd8ccb0, roughness: 0.8 });
    this.woodMat = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 });
    this.paperMat = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 1 });
    this.screenMat = new THREE.MeshStandardMaterial({ color: 0x1a2a22, emissive: 0x2a6a4a, emissiveIntensity: 0.5 });
    this.voidMat = new THREE.MeshBasicMaterial({ color: 0x050403 });
    this.pools = new VegetationPools(this.vegMat);
    this.root.add(this.pools.root);
  }

  /** Replaces the shared materials (the game supplies textured ones; tests use the plain defaults). */
  /** Ruins: weathered concrete, rusty metal, old wood (procedural PBR textures). */
  applyTextures(lib: { bind: (m: THREE.MeshStandardMaterial, name: 'concrete' | 'planks' | 'leather', maps?: { map: boolean; normal: boolean; rough: boolean }) => unknown }): void {
    lib.bind(this.ruinMat, 'concrete');
    this.ruinMat.color.set(0xc8c4b8);
    lib.bind(this.woodMat, 'planks');
    this.woodMat.color.set(0xa08a70);
    lib.bind(this.metalMat, 'concrete', { map: false, normal: true, rough: true });
  }

  setMaterials(m: { terrain?: THREE.Material; vegetation?: THREE.Material; vegetationDepth?: THREE.Material }): void {
    if (m.terrain) this.terrainMat = m.terrain as THREE.MeshStandardMaterial;
    if (m.vegetation) {
      this.vegMat = m.vegetation as THREE.MeshStandardMaterial;
      this.pools.setMaterials(m.vegetation, m.vegetationDepth ?? null);
    }
    for (const v of this.sectors.values())
      v.group.traverse((o) => {
        if (o instanceof THREE.Mesh && o.userData.terrain && m.terrain) o.material = m.terrain;
      });
  }

  /** True once the sectors around the player exist (used by the loading screen). */
  get isReady(): boolean {
    return this.ready;
  }

  get loadedCount(): number {
    return this.sectors.size;
  }

  get pending(): number {
    return this.queue.length + (this.terrainJobs?.inFlight ?? 0);
  }

  update(px: number, pz: number, q: QualityProfile, now: number, budgetMs = 6): void {
    const S = WORLD.sectorSize;
    const csx = Math.floor(px / S);
    const csz = Math.floor(pz / S);
    const want = new Map<string, { sx: number; sz: number; lod: number; detail: boolean; d: number }>();
    for (let dx = -q.loadRadius; dx <= q.loadRadius; dx++)
      for (let dz = -q.loadRadius; dz <= q.loadRadius; dz++) {
        const sx = csx + dx;
        const sz = csz + dz;
        // Distance from player to the sector's nearest point decides LOD.
        const nx = clamp(px, sx * S, (sx + 1) * S);
        const nz = clamp(pz, sz * S, (sz + 1) * S);
        const d = Math.hypot(nx - px, nz - pz);
        if (d > q.loadRadius * S) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        const lod = d < S * 0.6 ? 0 : d < S * 1.6 ? 1 : d < S * 3 ? 2 : 3;
        want.set(`${sx},${sz}`, { sx, sz, lod, detail: ring <= q.detailRadius, d });
      }

    for (const [key, v] of this.sectors) {
      if (!want.has(key)) this.unload(key, v);
    }
    this.queue = [];
    for (const [key, w] of want) {
      const cur = this.sectors.get(key);
      if (!cur || cur.lod !== w.lod || cur.detail !== w.detail) this.queue.push(w);
    }
    this.queue.sort((a, b) => a.d - b.d);

    const t0 = performance.now();
    while (this.queue.length) {
      const w = this.queue.shift()!;
      this.build(w.sx, w.sz, w.lod, w.detail, q, now, w.d);
      if (performance.now() - t0 > budgetMs && this.ready) break;
    }
    if (!this.queue.length || !this.queue.some((w) => w.d < S)) {
      // Ready once the ground around the player exists (async terrain included).
      let near = true;
      for (const v of this.sectors.values()) if (v.d < S && !v.terrainReady) near = false;
      if (near) this.ready = true;
    }
  }

  private unload(key: string, v: SectorView): void {
    this.root.remove(v.group);
    v.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) {
        if (o.userData.ownGeometry) o.geometry.dispose();
        if (o.userData.ownMaterial) {
          const m = o.material as THREE.MeshStandardMaterial;
          m.map?.dispose();
          m.dispose();
        }
      }
    });
    for (const c of v.colliders) this.collision.remove(c);
    for (const h of v.handles) h.pool.remove(h);
    v.handles = [];
    this.sectors.delete(key);
  }

  biomeCoarse(x: number, z: number): BiomeId {
    const k = `${Math.round(x / 8)},${Math.round(z / 8)}`;
    let b = this.biomeCache.get(k);
    if (!b) {
      b = this.terrain.biomeAt(Math.round(x / 8) * 8, Math.round(z / 8) * 8);
      if (this.biomeCache.size > 60000) this.biomeCache.clear();
      this.biomeCache.set(k, b);
    }
    return b;
  }

  private build(sx: number, sz: number, lod: number, detail: boolean, q: QualityProfile, now: number, d = 0): void {
    const key = `${sx},${sz}`;
    const old = this.sectors.get(key);
    const res = Math.max(8, Math.round(q.terrainRes / LOD_DIV[lod]));
    const group = new THREE.Group();
    group.name = `sector ${key}`;
    const view: SectorView = { sx, sz, lod, detail, group, nodes: [], colliders: [], interactables: [], handles: [], terrainReady: false, d };
    if (this.terrainJobs) {
      // Keep the previous terrain visible until the new level of detail arrives.
      const prev = old?.group.children.find((o) => o.userData.terrain && o.userData.ownGeometry) as THREE.Mesh | undefined;
      if (prev && old && old.terrainReady) {
        old.group.remove(prev);
        prev.userData.placeholder = true;
        group.add(prev);
      }
      if (old) this.unload(key, old);
      void this.terrainJobs.request(sx, sz, res).then((data) => {
        if (this.sectors.get(key) !== view) return; // superseded or unloaded
        for (const c of [...group.children]) {
          if (c.userData.placeholder) {
            group.remove(c);
            (c as THREE.Mesh).geometry.dispose();
          }
        }
        group.add(this.terrainMesh(data));
        view.terrainReady = true;
      });
    } else {
      if (old) this.unload(key, old);
      group.add(this.buildTerrain(sx, sz, res));
      view.terrainReady = true;
    }
    this.pools.setShadows(q.shadows);
    if (detail) {
      this.buildVegetation(view, q, now);
      this.buildSites(view, now);
    } else if (q.farTrees) this.buildFarTrees(view, q, now);
    this.root.add(group);
    this.sectors.set(key, view);
  }

  private buildTerrain(sx: number, sz: number, res: number): THREE.Mesh {
    return this.terrainMesh(terrainMeshData(this.terrain, (bx, bz) => this.biomeCoarse(bx, bz), sx, sz, res));
  }

  private terrainMesh(d: TerrainMeshData): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(d.position, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(d.normal, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(d.color, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2));
    geo.setAttribute('splatA', new THREE.BufferAttribute(d.splatA, 4));
    geo.setAttribute('splatB', new THREE.BufferAttribute(d.splatB, 4));
    geo.setIndex(new THREE.BufferAttribute(d.index, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.receiveShadow = true;
    mesh.userData.ownGeometry = true;
    mesh.userData.terrain = true;
    return mesh;
  }

  /**
   * Deterministic placement of the sector's vegetation. The random sequence
   * is consumed identically whatever `want` selects, so ids (used to persist
   * harvesting) and positions match between detailed and distant versions.
   */
  private placeVegetation(view: SectorView, q: QualityProfile, now: number, want: (k: VegetationKind) => boolean): Map<VegetationKind, Placed[]> {
    const S = WORLD.sectorSize;
    const rng = new Rng(hash2(this.seed ^ 0x7e9, view.sx, view.sz));
    const x0 = view.sx * S;
    const z0 = view.sz * S;
    const centerBiome = this.biomeCoarse(x0 + S / 2, z0 + S / 2);
    // Gather rules from biomes present (sample 4 points so mixed sectors get both floras).
    const present = new Set<BiomeId>([centerBiome]);
    for (const [fx, fz] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) present.add(this.biomeCoarse(x0 + fx * S, z0 + fz * S));
    const byKind = new Map<VegetationKind, Placed[]>();
    let idx = 0;
    for (const biome of present) {
      for (const rule of BIOMES[biome].vegetation) {
        const isGrass = rule.kind === 'grass';
        if (isGrass && view.lod > 1) continue;
        const count = Math.round(((rule.density * S * S) / 1000 / present.size) * q.vegetationDensity * (isGrass ? 0.6 : 1));
        const wanted = want(rule.kind);
        for (let k = 0; k < count; k++) {
          const x = x0 + rng.next() * S;
          const z = z0 + rng.next() * S;
          const s = rng.range(0.7, 1.35);
          const rot = rng.next() * Math.PI * 2;
          const id = `${view.sx},${view.sz}:${idx++}`;
          if (!wanted) continue;
          if (this.biomeCoarse(x, z) !== biome) continue;
          const h = this.terrain.height(x, z);
          if (rule.kind === 'reeds' ? h < -0.6 || h > 1.5 : h < 0.4) continue;
          if (rule.kind !== 'rock' && rule.kind !== 'boulder' && this.terrain.slope(x, z) > 0.75) continue;
          if (this.terrain.nearSite(x, z) && VEG_COLLIDER[rule.kind] > 0) continue;
          // Herds keep their trails clear of plants.
          if (rule.kind !== 'rock' && rule.kind !== 'boulder' && this.terrain.trailMask(x, z) > 0.5) continue;
          const regrow = this.harvested[id];
          if (regrow !== undefined && regrow > now) continue;
          let list = byKind.get(rule.kind);
          if (!list) byKind.set(rule.kind, (list = []));
          list.push({ x, y: h - 0.1, z, s, r: rot, biome, id });
        }
      }
    }
    return byKind;
  }

  private instanceMatrix(p: Placed, kind: VegetationKind, out: THREE.Matrix4): THREE.Matrix4 {
    const quat = new THREE.Quaternion().setFromAxisAngle(UP, p.r);
    // Rocks sink a little and are tilted; plants stand upright.
    const tilt = kind === 'rock' || kind === 'boulder' ? new THREE.Quaternion().setFromEuler(new THREE.Euler((hashUnit(p.id, 1) - 0.5) * 0.4, 0, (hashUnit(p.id, 2) - 0.5) * 0.4)) : null;
    if (tilt) quat.multiply(tilt);
    const y = kind === 'rock' || kind === 'boulder' ? p.y - 0.15 * p.s : p.y;
    return out.compose(new THREE.Vector3(p.x, y, p.z), quat, new THREE.Vector3(p.s, p.s * (0.9 + hashUnit(p.id, 3) * 0.2), p.s));
  }

  /** Subtle per-instance colour variation (lusher in the jungle, drier on the plains). */
  private instanceColor(p: Placed, kind: VegetationKind, out: THREE.Color): THREE.Color {
    const v = 0.88 + hashUnit(p.id, 4) * 0.24;
    if (kind === 'rock' || kind === 'boulder') {
      const tint = p.biome === 'volcanic' ? [0.55, 0.52, 0.5] : p.biome === 'snow' ? [1.05, 1.06, 1.08] : p.biome === 'beach' ? [1.1, 1.02, 0.9] : [1, 0.98, 0.94];
      return out.setRGB(tint[0] * v, tint[1] * v, tint[2] * v);
    }
    const dry = p.biome === 'plains' || p.biome === 'ruins' ? 0.08 : p.biome === 'jungle' ? -0.05 : 0;
    return out.setRGB(v * (1 + dry), v, v * (1 - dry * 1.5));
  }

  private buildVegetation(view: SectorView, q: QualityProfile, now: number): void {
    const byKind = this.placeVegetation(view, q, now, () => true);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const lod = view.lod >= q.treeLod ? 1 : 0;
    for (const [kind, list] of byKind) {
      for (const p of list) {
        const variant = Math.floor(hashUnit(p.id, 0) * PLANT_VARIANTS);
        const shadow = q.shadows && kind !== 'grass';
        const pool = this.pools.pool(`${kind}:${variant}:${lod}`, plantGeometry(kind, variant, lod), shadow);
        const inst = pool.add(this.instanceMatrix(p, kind, m), this.instanceColor(p, kind, c));
        view.handles.push(inst);
        const yieldDef = VEG_YIELD[kind];
        let colliderId: string | null = null;
        const cr = VEG_COLLIDER[kind] * p.s;
        if (cr > 0) {
          colliderId = `veg:${p.id}`;
          this.collision.add({ kind: 'circle', id: colliderId, x: p.x, z: p.z, r: cr, y0: p.y - 1, y1: p.y + (kind === 'rock' ? 1.2 : kind === 'boulder' ? 4 : 12) * p.s });
          view.colliders.push(colliderId);
        }
        if (yieldDef) view.nodes.push({ id: p.id, kind, x: p.x, y: p.y, z: p.z, scale: p.s, biome: p.biome, inst, colliderId });
      }
    }
  }

  /** Distant sectors: low-detail trees only (same positions), no colliders or resources. */
  private buildFarTrees(view: SectorView, q: QualityProfile, now: number): void {
    const trees = new Set<VegetationKind>(['conifer', 'broadleaf', 'palm', 'deadTree', 'boulder']);
    const byKind = this.placeVegetation(view, q, now, (k) => trees.has(k));
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (const [kind, list] of byKind)
      for (const p of list) {
        const variant = Math.floor(hashUnit(p.id, 0) * PLANT_VARIANTS);
        const pool = this.pools.pool(`${kind}:${variant}:1`, plantGeometry(kind, variant, 1), false);
        view.handles.push(pool.add(this.instanceMatrix(p, kind, m), this.instanceColor(p, kind, c)));
      }
  }

  /** Authored ruins/research sites and cave entrances. */
  private buildSites(view: SectorView, now: number): void {
    const S = WORLD.sectorSize;
    for (const site of PLANNED_SITES) {
      if (Math.floor(site.x / S) !== view.sx || Math.floor(site.z / S) !== view.sz) continue;
      if (site.kind === 'cave') this.buildCave(view, site, now);
      else this.buildRuin(view, site, now);
    }
    const f = fossilSite(this.seed, view.sx, view.sz, this.terrain);
    if (f && !((this.harvested[f.id] ?? -1) > now)) {
      const y = this.terrain.height(f.x, f.z);
      const g = new THREE.Group();
      g.add(this.ownMesh(new THREE.DodecahedronGeometry(1.1, 0), this.ruinMat, 0, 0.2, 0));
      for (let i = 0; i < 4; i++) {
        const bone = this.ownMesh(new THREE.TorusGeometry(0.7 - i * 0.08, 0.06, 5, 10, Math.PI), this.boneMat, i * 0.35 - 0.5, 0.35, 0);
        bone.rotation.y = Math.PI / 2;
        g.add(bone);
      }
      g.position.set(f.x, y, f.z);
      g.userData.nodeId = f.id;
      view.group.add(g);
      view.nodes.push({ id: f.id, kind: 'fossil', x: f.x, y, z: f.z, scale: 1, biome: this.biomeCoarse(f.x, f.z), inst: null, colliderId: null });
    }
  }

  private ownMesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.ownGeometry = true;
    return m;
  }

  private addBox(view: SectorView, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, rot: number, id: string): THREE.Mesh {
    const mesh = this.ownMesh(new THREE.BoxGeometry(w, h, d), mat, x, y + h / 2, z);
    mesh.rotation.y = -rot;
    view.group.add(mesh);
    this.collision.add({ kind: 'box', id, x, z, hx: w / 2, hz: d / 2, rot, y0: y - 1, y1: y + h, walkable: h < 1.2, enabled: true });
    view.colliders.push(id);
    return mesh;
  }

  private addInteractable(view: SectorView, it: Interactable): void {
    if (it.object) {
      it.object.userData.interactable = it.id;
      view.group.add(it.object);
    }
    view.interactables.push(it);
  }

  private buildRuin(view: SectorView, site: PlannedSite, now: number): void {
    const rng = new Rng(hash2(this.seed, Math.round(site.x), Math.round(site.z)));
    // A broken concrete compound: perimeter walls with gaps, a main building, debris.
    const R = site.radius * 0.45;
    const rot = rng.next() * Math.PI;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const place = (lx: number, lz: number) => [site.x + lx * c - lz * s, site.z + lx * s + lz * c] as const;
    let n = 0;
    for (let side = 0; side < 4; side++) {
      for (let k = -3; k <= 3; k++) {
        if (rng.chance(0.3)) continue; // collapsed sections
        const along = (k / 3.5) * R;
        const lx = side % 2 === 0 ? along : side === 1 ? R : -R;
        const lz = side % 2 === 0 ? (side === 0 ? -R : R) : along;
        const [x, z] = place(lx, lz);
        const h = rng.range(0.8, 3.2);
        const y = this.terrain.height(x, z) - 0.3;
        this.addBox(view, this.ruinMat, x, y, z, R / 3.2, h, 0.5, rot + (side % 2 ? Math.PI / 2 : 0), `site:${site.id}:w${n++}`);
      }
    }
    // Main structure (roofless) with a single 2.5 m doorway on its +z side.
    const [mx, mz] = place(rng.range(-R * 0.3, R * 0.3), rng.range(-R * 0.3, R * 0.3));
    const my = this.terrain.height(mx, mz) - 0.2;
    const W = 10;
    const local = (lx: number, lz: number) => [mx + lx * c - lz * s, mz + lx * s + lz * c] as const;
    for (const [lx, lz, w, d] of [[0, -W / 2, W, 0.6], [-1.25, W / 2, 7.5, 0.6], [-W / 2, 0, 0.6, W], [W / 2, 0, 0.6, W]] as const) {
      const [x, z] = local(lx, lz);
      this.addBox(view, this.ruinMat, x, my, z, w, 3.6, d, rot, `site:${site.id}:m${n++}`);
    }
    const docs = DOCS.filter((d) => d.site === site.id);
    // Terminal (research log) and a desk note.
    const term = docs.find((d) => d.kind === 'terminal');
    {
      const [x, z] = local(2, 0);
      const m = this.addBox(view, this.metalMat, x, my, z, 1.4, 1.1, 0.8, rot + 0.4, `site:${site.id}:console`);
      const screen = this.ownMesh(new THREE.PlaneGeometry(0.9, 0.5), this.screenMat, 0, 0.75, 0.41);
      m.add(screen);
      if (term) this.addInteractable(view, { id: `doc:${term.id}`, kind: 'doc', ref: term.id, site: site.id, x, y: my, z, object: null });
    }
    const note = docs.find((d) => d.kind === 'note');
    if (note) {
      const [x, z] = local(-2, 1);
      const g = new THREE.Group();
      g.add(this.ownMesh(new THREE.BoxGeometry(1, 0.8, 0.7), this.woodMat, 0, 0.4, 0));
      g.add(this.ownMesh(new THREE.BoxGeometry(0.35, 0.02, 0.45), this.paperMat, 0, 0.81, 0));
      g.position.set(x, this.terrain.height(x, z), z);
      g.rotation.y = -rot;
      this.addInteractable(view, { id: `doc:${note.id}`, kind: 'doc', ref: note.id, site: site.id, x, y: g.position.y, z, object: g });
    }
    const radio = docs.find((d) => d.kind === 'radio');
    if (radio) {
      const [x, z] = local(-3, -3);
      const g = new THREE.Group();
      g.add(this.ownMesh(new THREE.BoxGeometry(1.2, 0.9, 0.6), this.metalMat, 0, 0.45, 0));
      g.add(this.ownMesh(new THREE.CylinderGeometry(0.03, 0.03, 3, 4), this.metalMat, 0.4, 2.2, 0));
      g.position.set(x, this.terrain.height(x, z), z);
      this.addInteractable(view, { id: `doc:${radio.id}`, kind: 'doc', ref: radio.id, site: site.id, x, y: g.position.y, z, object: g });
    }
    // Site-specific objects.
    const pickup = (item: string, lx: number, lz: number, color: number) => {
      const [x, z] = local(lx, lz);
      const g = new THREE.Group();
      g.add(this.ownMesh(new THREE.BoxGeometry(0.8, 1.8, 0.6), this.metalMat, 0, 0.9, 0));
      const obj = this.ownMesh(item === 'calibration_core' ? new THREE.CylinderGeometry(0.2, 0.2, 0.5, 10) : new THREE.BoxGeometry(0.25, 0.02, 0.16), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 }), 0, 1.9, 0);
      obj.userData.ownMaterial = true;
      obj.name = 'item';
      g.add(obj);
      g.position.set(x, this.terrain.height(x, z), z);
      this.addInteractable(view, { id: `pickup:${item}`, kind: 'pickup', ref: item, site: site.id, x, y: g.position.y, z, object: g });
    };
    if (site.id === 'ruin_swamp_station') pickup('keycard', -3, -3, 0xd04a3a);
    if (site.id === 'ruin_volcano_bunker') {
      pickup('calibration_core', -3, -3, 0xff9a4a);
      if (!this.flags.has('open:bunker')) {
        const [x, z] = local(3.75, W / 2);
        const door = this.addBox(view, this.metalMat, x, my, z, 2.5, 3.6, 0.3, rot, `site:${site.id}:door`);
        this.addInteractable(view, { id: 'door:bunker', kind: 'door', ref: 'keycard', site: site.id, x, y: my, z, object: null, colliderId: `site:${site.id}:door` });
        door.name = 'bunker_door';
      }
    }
    if (site.id === 'ruin_north_observatory') {
      const [x, z] = local(0, -9);
      const y = this.terrain.height(x, z);
      const g = new THREE.Group();
      for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) {
        const leg = this.ownMesh(new THREE.CylinderGeometry(0.06, 0.08, 9, 5), this.metalMat, dx * 0.6, 4.5, dz * 0.6);
        leg.rotation.set(dz * 0.05, 0, -dx * 0.05);
        g.add(leg);
      }
      const lamp = this.ownMesh(new THREE.SphereGeometry(0.5, 12, 10), new THREE.MeshStandardMaterial({ color: 0x7a5a3a, emissive: 0xff8a3a, emissiveIntensity: this.flags.has('beacon:on') ? 3 : 0.1 }), 0, 9.3, 0);
      lamp.userData.ownMaterial = true;
      lamp.name = 'beacon_lamp';
      g.add(lamp);
      g.position.set(x, y, z);
      this.collision.add({ kind: 'circle', id: `site:${site.id}:beacon`, x, z, r: 1, y0: y - 1, y1: y + 9 });
      view.colliders.push(`site:${site.id}:beacon`);
      this.addInteractable(view, { id: 'beacon', kind: 'beacon', ref: 'beacon', site: site.id, x, y, z, object: g });
    }
    // Hidden caches (only a research scanner reveals them).
    if (site.id === 'ruin_jungle_lab' || site.id === 'ruin_coast_dock' || site.id === 'ruin_plains_outpost') {
      const [x, z] = place(R * 0.7, -R * 0.6);
      const g = new THREE.Group();
      g.add(this.ownMesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), this.metalMat, 0, 0.1, 0));
      g.position.set(x, this.terrain.height(x, z), z);
      g.visible = false;
      this.addInteractable(view, { id: `cache:${site.id}`, kind: 'cache', ref: site.id, site: site.id, x, y: g.position.y, z, object: g });
    }
    // Loot: scrap piles and a supply crate as harvestable nodes.
    for (let i = 0; i < 5; i++) {
      const [x, z] = place(rng.range(-R, R), rng.range(-R, R));
      const id = `site:${site.id}:loot${i}`;
      if ((this.harvested[id] ?? -1) > now) continue;
      const y = this.terrain.height(x, z);
      const kind = i === 0 ? 'crate' : 'scrap';
      const mesh = this.ownMesh(kind === 'crate' ? new THREE.BoxGeometry(1, 0.7, 0.7) : new THREE.DodecahedronGeometry(0.5, 0), kind === 'crate' ? this.metalMat : this.ruinMat, x, y + 0.35, z);
      mesh.userData.nodeId = id;
      view.group.add(mesh);
      view.nodes.push({ id, kind, x, y, z, scale: 1, biome: 'ruins', inst: null, colliderId: null });
    }
  }

  /**
   * Cave mouth (blocked by rubble until cleared with a pickaxe) and a separate
   * underground chamber with paintings, crystals and fossils.
   */
  private buildCave(view: SectorView, site: PlannedSite, now: number): void {
    const y = this.terrain.height(site.x, site.z);
    const arch = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI;
      const m = new THREE.Mesh(plantGeometry('boulder', i % PLANT_VARIANTS, 0), this.vegMat);
      m.position.set(Math.cos(a) * 5, Math.sin(a) * 5, 0);
      m.scale.setScalar(0.8);
      m.castShadow = true;
      arch.add(m);
    }
    const dark = this.ownMesh(new THREE.CircleGeometry(4, 16, 0, Math.PI), this.voidMat, 0, 0.2, -0.8);
    dark.castShadow = false;
    arch.add(dark);
    arch.position.set(site.x, y - 0.5, site.z);
    view.group.add(arch);
    for (const side of [-1, 1]) {
      const id = `site:${site.id}:pillar${side}`;
      this.collision.add({ kind: 'circle', id, x: site.x + side * 5, z: site.z, r: 2, y0: y - 2, y1: y + 6 });
      view.colliders.push(id);
    }
    const rubbleId = `rubble:${site.id}`;
    if (!((this.harvested[rubbleId] ?? -1) > now)) {
      const g = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const m = new THREE.Mesh(plantGeometry('rock', i % PLANT_VARIANTS, 0), this.vegMat);
        m.position.set((i - 2) * 1.3, 0.6 + (i % 2) * 0.8, 0.5);
        m.scale.setScalar(1.3);
        g.add(m);
      }
      g.position.set(site.x, y - 0.3, site.z);
      g.userData.nodeId = rubbleId;
      view.group.add(g);
      const cid = `site:${site.id}:rubble`;
      this.collision.add({ kind: 'circle', id: cid, x: site.x, z: site.z + 0.5, r: 3, y0: y - 1, y1: y + 3 });
      view.colliders.push(cid);
      view.nodes.push({ id: rubbleId, kind: 'rubble', x: site.x, y, z: site.z + 2, scale: 1, biome: 'mountain', inst: null, colliderId: cid });
    }
    this.addInteractable(view, { id: `cave_enter:${site.id}`, kind: 'cave_enter', ref: site.id, site: site.id, x: site.x, y, z: site.z + 2.5, object: null });
    this.buildCaveInterior(view, site, now);
  }

  private buildCaveInterior(view: SectorView, site: PlannedSite, now: number): void {
    const rng = new Rng(hash2(this.seed ^ 0xca7e, Math.round(site.x), Math.round(site.z)));
    const g = new THREE.Group();
    g.position.set(site.x, CAVE_Y, site.z);
    const R = CAVE_RADIUS;
    const tint = site.id === 'cave_north_ice' ? 0x8aa4b8 : site.id === 'cave_volcano_lava' ? 0x4a3028 : 0x5a5048;
    const rockMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.95, side: THREE.DoubleSide, flatShading: true });
    const domeGeo = new THREE.IcosahedronGeometry(R, 2);
    const pos = domeGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + Math.sin(pos.getX(i) * 0.7) * 0.06 + Math.cos(pos.getZ(i) * 0.5) * 0.06;
      pos.setXYZ(i, pos.getX(i) * k, Math.max(-0.5, pos.getY(i) * 0.55), pos.getZ(i) * k);
    }
    domeGeo.computeVertexNormals();
    const dome = new THREE.Mesh(domeGeo, rockMat);
    dome.userData.ownGeometry = true;
    dome.userData.ownMaterial = true;
    dome.receiveShadow = true;
    g.add(dome);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 1, 24), rockMat);
    floor.rotation.x = -Math.PI / 2;
    floor.userData.ownGeometry = true;
    g.add(floor);
    // Stalagmites (solid).
    for (let i = 0; i < 9; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = rng.range(5, R - 2.5);
      const h = rng.range(1, 3.5);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (z > 6 && Math.abs(x) < 4) continue; // keep the exit clear
      const m = this.ownMesh(new THREE.ConeGeometry(0.5, h, 6), rockMat, x, h / 2, z);
      g.add(m);
      const id = `cave:${site.id}:stal${i}`;
      this.collision.add({ kind: 'circle', id, x: site.x + x, z: site.z + z, r: 0.5, y0: CAVE_Y - 1, y1: CAVE_Y + h });
      view.colliders.push(id);
    }
    // Exit: a shaft of daylight near the entrance.
    const shaft = this.ownMesh(new THREE.CylinderGeometry(1.2, 2, 8, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.18, depthWrite: false }), 0, 4, 12);
    shaft.userData.ownMaterial = true;
    shaft.castShadow = false;
    g.add(shaft);
    const glow = new THREE.PointLight(0xbcd4ff, 18, 14, 1.5);
    glow.position.set(0, 3, 12);
    g.add(glow);
    this.addInteractable(view, { id: `cave_exit:${site.id}`, kind: 'cave_exit', ref: site.id, site: site.id, x: site.x, y: CAVE_Y, z: site.z + 12, object: null });
    // Crystal clusters (harvestable, faintly luminous).
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0x9ad8ff, emissive: 0x2a7aff, emissiveIntensity: 0.9, roughness: 0.2 });
    for (let i = 0; i < 3; i++) {
      const id = `cave:${site.id}:crystal${i}`;
      if ((this.harvested[id] ?? -1) > now) continue;
      const a = (i / 3) * Math.PI * 2 + 0.6;
      const x = Math.cos(a) * (R - 3);
      const z = Math.sin(a) * (R - 3);
      const cg = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const m = this.ownMesh(new THREE.OctahedronGeometry(0.35, 0), crystalMat, (k - 1.5) * 0.3, 0.4 + (k % 2) * 0.3, 0);
        m.scale.y = 2;
        m.rotation.z = (k - 1.5) * 0.3;
        cg.add(m);
      }
      cg.position.set(x, 0, z);
      cg.userData.nodeId = id;
      g.add(cg);
      view.nodes.push({ id, kind: 'crystal', x: site.x + x, y: CAVE_Y, z: site.z + z, scale: 1, biome: 'mountain', inst: null, colliderId: null });
    }
    const crystalLight = new THREE.PointLight(0x6ab4ff, 10, 18, 1.6);
    crystalLight.position.set(0, 2, -6);
    g.add(crystalLight);
    // Fossil wall.
    const fid = `cave:${site.id}:fossil`;
    if (!((this.harvested[fid] ?? -1) > now)) {
      const fg = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const bone = this.ownMesh(new THREE.TorusGeometry(0.6 - i * 0.07, 0.05, 5, 10, Math.PI), this.boneMat, i * 0.3, 1.2, 0);
        fg.add(bone);
      }
      fg.position.set(-R + 2.5, 0, 0);
      fg.rotation.y = Math.PI / 2;
      fg.userData.nodeId = fid;
      g.add(fg);
      view.nodes.push({ id: fid, kind: 'fossil', x: site.x - R + 2.5, y: CAVE_Y, z: site.z, scale: 1, biome: 'mountain', inst: null, colliderId: null });
    }
    // Cave painting on the far wall.
    const doc = DOCS.find((d) => d.site === site.id && d.kind === 'painting');
    if (doc) {
      const tex = paintingTexture(doc.id);
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 1, transparent: true });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 3), mat);
      panel.position.set(0, 2.2, -R + 1.6);
      panel.userData.ownGeometry = true;
      panel.userData.ownMaterial = true;
      g.add(panel);
      this.addInteractable(view, { id: `doc:${doc.id}`, kind: 'doc', ref: doc.id, site: site.id, x: site.x, y: CAVE_Y, z: site.z - R + 3, object: null });
    }
    view.group.add(g);
  }

  interactablesNear(x: number, z: number, radius: number): Interactable[] {
    const out: Interactable[] = [];
    for (const v of this.sectors.values()) for (const it of v.interactables) if (Math.hypot(it.x - x, it.z - z) < radius) out.push(it);
    return out;
  }

  /** Opens an authored door (removes its collider and mesh) and records the flag. */
  openDoor(it: Interactable, flag: string): void {
    this.flags.add(flag);
    if (it.colliderId) this.collision.remove(it.colliderId);
    for (const v of this.sectors.values()) {
      v.group.traverse((o) => {
        if (o.name === 'bunker_door') o.visible = false;
      });
      v.interactables = v.interactables.filter((x) => x !== it);
    }
  }

  /** Hides one-time objects already taken and toggles scanner-only caches. */
  syncInteractables(isTaken: (id: string) => boolean, scanning: boolean, beaconOn: boolean): void {
    for (const v of this.sectors.values())
      for (const it of v.interactables) {
        if (!it.object) continue;
        if (it.kind === 'pickup') {
          const item = it.object.getObjectByName('item');
          if (item) item.visible = !isTaken(it.ref);
        } else if (it.kind === 'cache') it.object.visible = scanning && !isTaken(it.id);
        else if (it.kind === 'beacon') {
          const lamp = it.object.getObjectByName('beacon_lamp') as THREE.Mesh | undefined;
          if (lamp) (lamp.material as THREE.MeshStandardMaterial).emissiveIntensity = beaconOn ? 3 : 0.1;
        }
      }
  }

  nodesNear(x: number, z: number, radius: number): ResourceNode[] {
    const out: ResourceNode[] = [];
    for (const v of this.sectors.values()) {
      if (!v.detail) continue;
      for (const n of v.nodes) if (Math.hypot(n.x - x, n.z - z) < radius + n.scale) out.push(n);
    }
    return out;
  }

  hitsLeft(n: ResourceNode): number {
    const def = VEG_YIELD[n.kind as VegetationKind];
    const special: Partial<Record<ResourceNode['kind'], number>> = { rubble: 6, fossil: 3, crystal: 2 };
    const max = def ? Math.ceil(def.hits * n.scale) : special[n.kind] ?? 1;
    return this.nodeHits.get(n.id) ?? max;
  }

  /** Registers one harvesting hit; returns true when the node is depleted (and hides it). */
  hitNode(n: ResourceNode, now: number, power = 1): boolean {
    const left = this.hitsLeft(n) - power;
    if (left > 0) {
      this.nodeHits.set(n.id, left);
      return false;
    }
    this.nodeHits.delete(n.id);
    const permanent = n.kind === 'crate' || n.kind === 'scrap' || n.kind === 'rubble' || n.kind === 'fossil';
    const regrowDays = permanent ? 1e6 : n.kind === 'crystal' ? 8 : n.kind === 'rock' || n.kind === 'boulder' ? 10 : 3;
    this.harvested[n.id] = now + regrowDays * WORLD.dayLengthSeconds;
    if (n.inst) {
      n.inst.pool.remove(n.inst);
      for (const v of this.sectors.values()) v.handles = v.handles.filter((h) => h !== n.inst);
    } else {
      for (const v of this.sectors.values())
        v.group.traverse((o) => {
          if (o.userData.nodeId === n.id) o.visible = false;
        });
    }
    if (n.colliderId) this.collision.remove(n.colliderId);
    for (const v of this.sectors.values()) v.nodes = v.nodes.filter((x) => x !== n);
    return true;
  }

  /** Forgets regrown entries so the save doesn't grow without bound. */
  pruneHarvested(now: number): void {
    for (const [k, t] of Object.entries(this.harvested)) if (t < now) delete this.harvested[k];
  }

  dispose(): void {
    for (const [k, v] of this.sectors) this.unload(k, v);
    this.pools.dispose();
  }
}

/** Procedural ochre cave painting (figures, animals, symbols) drawn on a canvas. */
export function paintingTexture(docId: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0)';
  g.clearRect(0, 0, 512, 256);
  g.strokeStyle = g.fillStyle = 'rgba(150,60,30,0.85)';
  g.lineWidth = 5;
  g.lineCap = 'round';
  const human = (x: number, y: number, s: number) => {
    g.beginPath();
    g.arc(x, y - 30 * s, 6 * s, 0, Math.PI * 2);
    g.moveTo(x, y - 24 * s);
    g.lineTo(x, y);
    g.moveTo(x - 10 * s, y - 16 * s);
    g.lineTo(x + 10 * s, y - 16 * s);
    g.moveTo(x, y);
    g.lineTo(x - 8 * s, y + 16 * s);
    g.moveTo(x, y);
    g.lineTo(x + 8 * s, y + 16 * s);
    g.stroke();
  };
  const sauropod = (x: number, y: number) => {
    g.beginPath();
    g.ellipse(x, y, 50, 20, 0, 0, Math.PI * 2);
    g.moveTo(x + 40, y - 10);
    g.quadraticCurveTo(x + 70, y - 70, x + 90, y - 80);
    g.moveTo(x - 45, y);
    g.quadraticCurveTo(x - 90, y + 10, x - 110, y - 5);
    for (const dx of [-30, -15, 20, 35]) {
      g.moveTo(x + dx, y + 15);
      g.lineTo(x + dx, y + 45);
    }
    g.stroke();
  };
  const spiral = (x: number, y: number, r: number) => {
    g.beginPath();
    for (let t = 0; t < 18; t += 0.2) g.lineTo(x + Math.cos(t) * (r * t) / 18, y + Math.sin(t) * (r * t) / 18);
    g.stroke();
  };
  if (docId === 'painting_spine') {
    sauropod(300, 150);
    human(120, 170, 1);
    human(160, 175, 0.9);
    human(200, 168, 1.1);
    spiral(250, 50, 40);
  } else if (docId === 'painting_ice') {
    g.beginPath();
    g.moveTo(180, 200);
    g.lineTo(260, 70);
    g.lineTo(340, 200);
    g.stroke();
    g.beginPath();
    g.moveTo(260, 60);
    g.lineTo(240, 20);
    g.lineTo(270, 40);
    g.lineTo(255, 0);
    g.stroke();
    g.fillStyle = 'rgba(170,40,30,0.7)';
    for (const [x, y] of [[80, 90], [110, 160], [420, 100], [440, 170]]) {
      g.beginPath();
      g.ellipse(x, y, 14, 18, 0, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 22; i++) g.fillRect(150 + i * 10 + (i > 6 ? 10 : 0) + (i > 13 ? 10 : 0) + (i > 20 ? 10 : 0), 230, 4, 16);
  } else {
    g.beginPath();
    g.moveTo(60, 220);
    g.lineTo(130, 110);
    g.lineTo(200, 220);
    g.stroke();
    g.fillStyle = 'rgba(200,80,20,0.8)';
    g.beginPath();
    g.arc(130, 100, 14, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(420, 220);
    g.lineTo(420, 80);
    g.moveTo(400, 80);
    g.lineTo(440, 80);
    g.moveTo(140, 100);
    g.setLineDash([10, 12]);
    g.lineTo(420, 80);
    g.stroke();
    g.setLineDash([]);
    g.beginPath();
    g.arc(300, 170, 30, 0, Math.PI * 2);
    g.stroke();
    human(255, 190, 1);
    human(350, 185, 0.7);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
