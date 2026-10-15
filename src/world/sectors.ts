import * as THREE from 'three';
import { WORLD, type QualityProfile } from '../core/config';
import { clamp, lerp, smoothstep } from '../core/math';
import { Rng, hash2 } from '../core/rng';
import { BIOMES, type BiomeId, type VegetationKind } from './biomes';
import { CollisionWorld } from './collision';
import { PLANNED_SITES, type PlannedSite, type Terrain } from './terrain';
import { VEG_COLLIDER, VEG_YIELD, vegetationGeometries } from './vegetationModels';

/**
 * Streams the continent around the player. Sectors close to the player get
 * high-resolution terrain, vegetation, colliders and harvestable nodes; far
 * sectors get coarse terrain only. Geometry is regenerated deterministically
 * from the seed; only harvested state is persisted, so reloading a sector can
 * never duplicate resources.
 */
export interface ResourceNode {
  id: string;
  kind: VegetationKind | 'crate' | 'scrap';
  x: number;
  y: number;
  z: number;
  scale: number;
  biome: BiomeId;
  /** Instanced mesh + index for hiding when depleted. */
  mesh: THREE.InstancedMesh | null;
  index: number;
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
}

const LOD_RES = [64, 32, 16, 8];
const SKIRT = 12;

export class SectorManager {
  readonly root = new THREE.Group();
  private sectors = new Map<string, SectorView>();
  private terrainMat: THREE.MeshStandardMaterial;
  private vegMat: THREE.MeshStandardMaterial;
  private ruinMat: THREE.MeshStandardMaterial;
  private metalMat: THREE.MeshStandardMaterial;
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
  ) {
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide, shadowSide: THREE.FrontSide });
    this.vegMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, alphaTest: 0.5 });
    this.ruinMat = new THREE.MeshStandardMaterial({ color: 0x8d8a80, roughness: 0.9 });
    this.metalMat = new THREE.MeshStandardMaterial({ color: 0x5e6266, roughness: 0.6, metalness: 0.6 });
  }

  /** True once the sectors around the player exist (used by the loading screen). */
  get isReady(): boolean {
    return this.ready;
  }

  get loadedCount(): number {
    return this.sectors.size;
  }

  get pending(): number {
    return this.queue.length;
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
      this.build(w.sx, w.sz, w.lod, w.detail, q, now);
      if (performance.now() - t0 > budgetMs && this.ready) break;
    }
    if (!this.queue.length || !this.queue.some((w) => w.d < S)) this.ready = true;
  }

  private unload(key: string, v: SectorView): void {
    this.root.remove(v.group);
    v.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.ownGeometry) o.geometry.dispose();
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    for (const c of v.colliders) this.collision.remove(c);
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

  private build(sx: number, sz: number, lod: number, detail: boolean, q: QualityProfile, now: number): void {
    const key = `${sx},${sz}`;
    const old = this.sectors.get(key);
    if (old) this.unload(key, old);
    const group = new THREE.Group();
    group.name = `sector ${key}`;
    const view: SectorView = { sx, sz, lod, detail, group, nodes: [], colliders: [] };
    group.add(this.buildTerrain(sx, sz, LOD_RES[lod]));
    if (detail) {
      this.buildVegetation(view, q, now);
      this.buildSites(view, now);
    }
    this.root.add(group);
    this.sectors.set(key, view);
  }

  private buildTerrain(sx: number, sz: number, res: number): THREE.Mesh {
    const S = WORLD.sectorSize;
    const step = S / res;
    const x0 = sx * S;
    const z0 = sz * S;
    const N = res + 1;
    const G = res + 3; // with a 1-vertex border for normals
    const hs = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) hs[j * G + i] = this.terrain.height(x0 + (i - 1) * step, z0 + (j - 1) * step);

    const vcount = N * N + 4 * N;
    const pos = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    const col = new Float32Array(vcount * 3);
    const tmp = new THREE.Color();
    const n = new THREE.Vector3();
    let v = 0;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const gi = (j + 1) * G + (i + 1);
        const h = hs[gi];
        const x = x0 + i * step;
        const z = z0 + j * step;
        pos.set([x, h, z], v * 3);
        const dx = hs[gi + 1] - hs[gi - 1];
        const dz = hs[gi + G] - hs[gi - G];
        n.set(-dx, 2 * step, -dz).normalize();
        nor.set([n.x, n.y, n.z], v * 3);
        this.groundColor(x, z, h, 1 - n.y, tmp);
        col.set([tmp.r, tmp.g, tmp.b], v * 3);
        v++;
      }
    // Skirt vertices hide cracks between neighbouring LODs.
    const edge = (i: number, j: number) => {
      const src = j * N + i;
      pos.set([pos[src * 3], pos[src * 3 + 1] - SKIRT, pos[src * 3 + 2]], v * 3);
      nor.set([nor[src * 3], nor[src * 3 + 1], nor[src * 3 + 2]], v * 3);
      col.set([col[src * 3], col[src * 3 + 1], col[src * 3 + 2]], v * 3);
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
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, v * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, v * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, v * 3), 3));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.receiveShadow = true;
    mesh.userData.ownGeometry = true;
    mesh.userData.terrain = true;
    return mesh;
  }

  private groundColor(x: number, z: number, h: number, slope: number, out: THREE.Color): void {
    // Bilinear blend of coarse biome colours for soft transitions.
    const g = 16;
    const fx = x / g;
    const fz = z / g;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    let r = 0, gg = 0, b = 0;
    const c = new THREE.Color();
    const variation = this.terrain.groundNoise(x, z);
    for (const [dx, dz, w] of [[0, 0, (1 - tx) * (1 - tz)], [1, 0, tx * (1 - tz)], [0, 1, (1 - tx) * tz], [1, 1, tx * tz]] as const) {
      const biome = this.biomeCoarse((ix + dx) * g, (iz + dz) * g);
      const [lo, hi] = BIOMES[biome].ground;
      c.set(lo).lerp(new THREE.Color(hi), variation);
      r += c.r * w;
      gg += c.g * w;
      b += c.b * w;
    }
    out.setRGB(r, gg, b);
    // Steep slopes show bare rock; shorelines are wet and dark.
    const rock = smoothstep(0.35, 0.6, slope);
    const snowy = this.biomeCoarse(x, z) === 'snow';
    if (rock > 0) out.lerp(new THREE.Color(snowy ? 0xa9adb3 : 0x6c675e), rock * (snowy ? 0.6 : 1));
    if (h < 0.8) out.lerp(new THREE.Color(0x5a5040), clamp(lerp(0.6, 0, (h + 1) / 1.8), 0, 0.6));
  }

  private buildVegetation(view: SectorView, q: QualityProfile, now: number): void {
    const S = WORLD.sectorSize;
    const rng = new Rng(hash2(this.seed ^ 0x7e9, view.sx, view.sz));
    const x0 = view.sx * S;
    const z0 = view.sz * S;
    const centerBiome = this.biomeCoarse(x0 + S / 2, z0 + S / 2);
    // Gather rules from biomes present (sample 4 points so mixed sectors get both floras).
    const present = new Set<BiomeId>([centerBiome]);
    for (const [fx, fz] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) present.add(this.biomeCoarse(x0 + fx * S, z0 + fz * S));
    const byKind = new Map<VegetationKind, { x: number; y: number; z: number; s: number; r: number; biome: BiomeId; id: string }[]>();
    let idx = 0;
    for (const biome of present) {
      for (const rule of BIOMES[biome].vegetation) {
        const isGrass = rule.kind === 'grass';
        if (isGrass && view.lod > 1) continue;
        const count = Math.round(((rule.density * S * S) / 1000 / present.size) * q.vegetationDensity * (isGrass ? 0.6 : 1));
        for (let k = 0; k < count; k++) {
          const x = x0 + rng.next() * S;
          const z = z0 + rng.next() * S;
          const s = rng.range(0.7, 1.35);
          const rot = rng.next() * Math.PI * 2;
          const id = `${view.sx},${view.sz}:${idx++}`;
          if (this.biomeCoarse(x, z) !== biome) continue;
          const h = this.terrain.height(x, z);
          if (rule.kind === 'reeds' ? h < -0.6 || h > 1.5 : h < 0.4) continue;
          if (rule.kind !== 'rock' && rule.kind !== 'boulder' && this.terrain.slope(x, z) > 0.75) continue;
          if (this.terrain.nearSite(x, z) && VEG_COLLIDER[rule.kind] > 0) continue;
          const regrow = this.harvested[id];
          if (regrow !== undefined && regrow > now) continue;
          let list = byKind.get(rule.kind);
          if (!list) byKind.set(rule.kind, (list = []));
          list.push({ x, y: h - 0.1, z, s, r: rot, biome, id });
        }
      }
    }
    const geos = vegetationGeometries();
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [kind, list] of byKind) {
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(geos[kind], this.vegMat, list.length);
      mesh.castShadow = kind !== 'grass' && kind !== 'fern' && q.shadows;
      mesh.receiveShadow = kind !== 'grass';
      list.forEach((p, i) => {
        quat.setFromAxisAngle(up, p.r);
        m.compose(new THREE.Vector3(p.x, p.y, p.z), quat, new THREE.Vector3(p.s, p.s, p.s));
        mesh.setMatrixAt(i, m);
        const yieldDef = VEG_YIELD[kind];
        let colliderId: string | null = null;
        const cr = VEG_COLLIDER[kind] * p.s;
        if (cr > 0) {
          colliderId = `veg:${p.id}`;
          this.collision.add({ kind: 'circle', id: colliderId, x: p.x, z: p.z, r: cr, y0: p.y - 1, y1: p.y + (kind === 'rock' ? 1.2 : kind === 'boulder' ? 4 : 12) * p.s });
          view.colliders.push(colliderId);
        }
        if (yieldDef) view.nodes.push({ id: p.id, kind, x: p.x, y: p.y, z: p.z, scale: p.s, biome: p.biome, mesh, index: i, colliderId });
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      view.group.add(mesh);
    }
  }

  /** Authored ruins/research sites and cave entrances. */
  private buildSites(view: SectorView, now: number): void {
    const S = WORLD.sectorSize;
    for (const site of PLANNED_SITES) {
      if (Math.floor(site.x / S) !== view.sx || Math.floor(site.z / S) !== view.sz) continue;
      if (site.kind === 'cave') this.buildCave(view, site);
      else this.buildRuin(view, site, now);
    }
  }

  private addBox(view: SectorView, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number, rot: number, id: string): void {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = -rot;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.ownGeometry = true;
    view.group.add(mesh);
    this.collision.add({ kind: 'box', id, x, z, hx: w / 2, hz: d / 2, rot, y0: y - 1, y1: y + h, walkable: h < 1.2, enabled: true });
    view.colliders.push(id);
  }

  private buildRuin(view: SectorView, site: PlannedSite, now: number): void {
    const rng = new Rng(hash2(this.seed, Math.round(site.x), Math.round(site.z)));
    const base = this.terrain.height(site.x, site.z);
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
        const lx = side % 2 === 0 ? along : (side === 1 ? R : -R);
        const lz = side % 2 === 0 ? (side === 0 ? -R : R) : along;
        const [x, z] = place(lx, lz);
        const h = rng.range(0.8, 3.2);
        const y = this.terrain.height(x, z) - 0.3;
        this.addBox(view, this.ruinMat, x, y, z, R / 3.2, h, 0.5, rot + (side % 2 ? Math.PI / 2 : 0), `site:${site.id}:w${n++}`);
      }
    }
    // Main structure (roofless).
    const [mx, mz] = place(rng.range(-R * 0.3, R * 0.3), rng.range(-R * 0.3, R * 0.3));
    const my = this.terrain.height(mx, mz) - 0.2;
    const W = 10;
    for (const [lx, lz, w, d] of [[0, -W / 2, W, 0.6], [0, W / 2, W * 0.55, 0.6], [-W / 2, 0, 0.6, W], [W / 2, 0, 0.6, W]] as const) {
      const x = mx + lx * c - lz * s;
      const z = mz + lx * s + lz * c;
      this.addBox(view, this.ruinMat, x, my, z, w, 3.6, d, rot, `site:${site.id}:m${n++}`);
    }
    this.addBox(view, this.metalMat, mx + 2 * c, my, mz + 2 * s, 1.4, 1.1, 0.8, rot + 0.4, `site:${site.id}:console`);
    // Loot: scrap piles and research crates as harvestable nodes.
    for (let i = 0; i < 5; i++) {
      const [x, z] = place(rng.range(-R, R), rng.range(-R, R));
      const id = `site:${site.id}:loot${i}`;
      if ((this.harvested[id] ?? -1) > now) continue;
      const y = this.terrain.height(x, z);
      const kind = i === 0 ? 'crate' : 'scrap';
      const geo = kind === 'crate' ? new THREE.BoxGeometry(1, 0.7, 0.7) : new THREE.DodecahedronGeometry(0.5, 0);
      const mesh = new THREE.Mesh(geo, kind === 'crate' ? this.metalMat : this.ruinMat);
      mesh.position.set(x, y + 0.35, z);
      mesh.castShadow = true;
      mesh.userData.ownGeometry = true;
      mesh.userData.nodeId = id;
      view.group.add(mesh);
      view.nodes.push({ id, kind, x, y, z, scale: 1, biome: 'ruins', mesh: null, index: -1, colliderId: null });
    }
    void base;
  }

  private buildCave(view: SectorView, site: PlannedSite): void {
    const y = this.terrain.height(site.x, site.z);
    const geos = vegetationGeometries();
    const mat = this.vegMat;
    // Rock arch framing a dark recess: the entrance to an (as yet unexplorable) cave.
    const arch = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI;
      const m = new THREE.Mesh(geos.boulder, mat);
      m.position.set(Math.cos(a) * 5, Math.sin(a) * 5, 0);
      m.scale.setScalar(0.8);
      m.castShadow = true;
      arch.add(m);
    }
    const dark = new THREE.Mesh(new THREE.CircleGeometry(4, 16, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x050403 }));
    dark.position.set(0, 0.2, -0.8);
    dark.userData.ownGeometry = true;
    arch.add(dark);
    arch.position.set(site.x, y - 0.5, site.z);
    view.group.add(arch);
    for (const side of [-1, 1]) {
      const id = `site:${site.id}:pillar${side}`;
      this.collision.add({ kind: 'circle', id, x: site.x + side * 5, z: site.z, r: 2, y0: y - 2, y1: y + 6 });
      view.colliders.push(id);
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
    const max = def ? Math.ceil(def.hits * n.scale) : 1;
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
    const regrowDays = n.kind === 'rock' || n.kind === 'boulder' ? 10 : n.kind === 'crate' || n.kind === 'scrap' ? 1e6 : 3;
    this.harvested[n.id] = now + regrowDays * WORLD.dayLengthSeconds;
    if (n.mesh) {
      const m = new THREE.Matrix4().makeScale(0, 0, 0);
      n.mesh.setMatrixAt(n.index, m);
      n.mesh.instanceMatrix.needsUpdate = true;
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
  }
}
