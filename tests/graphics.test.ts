import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildDinoTemplate } from '../src/animals/dinoModel';
import { SPECIES, SPECIES_IDS } from '../src/animals/species';
import { QUALITY, effectiveQuality } from '../src/core/config';
import { MATERIAL_GENERATORS, TERRAIN_GENERATORS, fbm, vnoise, worley } from '../src/graphics/texgen';
import { buildHumanGeometry, buildHumanRig, BONE_NAMES } from '../src/player/humanModel';
import { GROUND_PROFILES, groundSample, newGroundSample } from '../src/world/groundShading';
import { decorGeometry, plantGeometry, PLANT_VARIANTS } from '../src/world/plants';
import { Terrain } from '../src/world/terrain';
import { VegetationPools } from '../src/world/vegetationPools';
import type { VegetationKind } from '../src/world/biomes';

/** Every float attribute is finite. */
function finite(g: THREE.BufferGeometry): boolean {
  for (const a of Object.values(g.attributes)) {
    const arr = (a as THREE.BufferAttribute).array as ArrayLike<number>;
    for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

/** Skin weights sum to 1 and indices point at existing bones. */
function skinOk(g: THREE.BufferGeometry, bones: number): boolean {
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  for (let i = 0; i < sw.count; i++) {
    const s = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
    if (Math.abs(s - 1) > 1e-3) return false;
    for (const k of [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)]) if (k < 0 || k >= bones) return false;
  }
  return true;
}

describe('procedural textures', () => {
  it('noise is periodic, so textures tile without seams', () => {
    for (const p of [4, 8, 16]) {
      expect(vnoise(0.3, 0.7, p, 1)).toBeCloseTo(vnoise(0.3 + p, 0.7 - p, p, 1), 10);
      expect(fbm(0.0001, 0.5, p, 4, 2)).toBeCloseTo(fbm(1.0001, 0.5, p, 4, 2), 6);
      expect(worley(0.02, 0.4, p, 3).f1).toBeCloseTo(worley(1.02, 0.4, p, 3).f1, 6);
    }
  });

  it('every generator returns RGBA8 albedo and normal/roughness of the requested size, deterministically', () => {
    const all = { ...TERRAIN_GENERATORS, ...MATERIAL_GENERATORS } as Record<string, (n: number) => { size: number; albedo: Uint8Array; normal: Uint8Array }>;
    for (const [name, gen] of Object.entries(all)) {
      const a = gen(32);
      expect(a.size, name).toBe(32);
      expect(a.albedo.length, name).toBe(32 * 32 * 4);
      expect(a.normal.length, name).toBe(32 * 32 * 4);
      const b = gen(32);
      expect(Buffer.from(a.albedo).equals(Buffer.from(b.albedo)), name).toBe(true);
      // Normals point out of the surface (z > 0) everywhere.
      for (let i = 0; i < 32 * 32; i++) expect(a.normal[i * 4 + 2], name).toBeGreaterThan(127);
    }
  });

  it('left/right and top/bottom edges continue each other (seamless tiling)', () => {
    const t = TERRAIN_GENERATORS.rock(64);
    const n = 64;
    let diffEdge = 0;
    let diffInner = 0;
    for (let y = 0; y < n; y++) {
      const o = (y * n) * 4;
      diffEdge += Math.abs(t.albedo[o] - t.albedo[o + (n - 1) * 4]); // column 0 vs 63 (neighbours across the seam)
      diffInner += Math.abs(t.albedo[o + 31 * 4] - t.albedo[o + 32 * 4]); // two neighbours inside
    }
    // Across the seam the change is of the same order as between any two neighbours.
    expect(diffEdge).toBeLessThan(diffInner * 3 + n * 8);
  });
});

describe('vegetation models', () => {
  const kinds: VegetationKind[] = ['conifer', 'broadleaf', 'palm', 'cycad', 'fern', 'bush', 'deadTree', 'rock', 'boulder', 'reeds', 'grass'];
  it('all kinds, variants and detail levels build with finite data and the vegetation attributes', () => {
    for (const k of kinds)
      for (let v = 0; v < PLANT_VARIANTS; v++)
        for (const lod of [0, 1]) {
          const g = plantGeometry(k, v, lod);
          expect(finite(g), `${k}:${v}:${lod}`).toBe(true);
          for (const a of ['position', 'normal', 'uv', 'color', 'vegLayer', 'wind']) expect(g.attributes[a], `${k} ${a}`).toBeDefined();
          expect(g.index!.count % 3).toBe(0);
        }
  });

  it('variants differ and distant versions are lighter', () => {
    const a = plantGeometry('broadleaf', 0, 0);
    const b = plantGeometry('broadleaf', 1, 0);
    expect(a.attributes.position.count).not.toBe(b.attributes.position.count);
    for (const k of ['broadleaf', 'conifer', 'palm'] as VegetationKind[]) expect(plantGeometry(k, 0, 1).attributes.position.count).toBeLessThan(plantGeometry(k, 0, 0).attributes.position.count);
  });

  it('trees sway more at the top than at the base; rocks do not sway', () => {
    const g = plantGeometry('conifer', 0, 0);
    const pos = g.attributes.position;
    const wind = g.attributes.wind;
    let low = 0;
    let high = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < 1) low = Math.max(low, wind.getX(i));
      if (pos.getY(i) > 8) high = Math.max(high, wind.getX(i));
    }
    expect(high).toBeGreaterThan(low * 5);
    const r = plantGeometry('rock', 0, 0).attributes.wind;
    for (let i = 0; i < r.count; i++) expect(r.getX(i)).toBe(0);
    for (const d of ['tuft', 'pebble', 'log', 'smallFern', 'treeFern'] as const) expect(finite(decorGeometry(d, 0))).toBe(true);
  });

  it('instance pools keep handles valid through removals and growth', () => {
    const pools = new VegetationPools(new THREE.MeshBasicMaterial());
    const geo = new THREE.BoxGeometry();
    const p = pools.pool('box', geo, false);
    const m = new THREE.Matrix4();
    const handles = Array.from({ length: 200 }, (_, i) => p.add(m.makeTranslation(i, 0, 0)));
    expect(p.count).toBe(200);
    // Remove every other one; the survivors must still point at their own transform.
    for (let i = 0; i < 200; i += 2) p.remove(handles[i]);
    expect(p.count).toBe(100);
    const out = new THREE.Matrix4();
    for (let i = 1; i < 200; i += 2) {
      p.mesh.getMatrixAt(handles[i].slot, out);
      expect(new THREE.Vector3().setFromMatrixPosition(out).x).toBe(i);
    }
    // Removing twice is harmless.
    p.remove(handles[0]);
    expect(p.count).toBe(100);
    pools.dispose();
  });
});

describe('terrain shading', () => {
  it('ground weights are non-negative and follow the biome', () => {
    const t = new Terrain(1234);
    const gs = newGroundSample();
    const plains = groundSample(t, () => 'plains', 300, 900, 20, gs);
    expect(Math.min(...plains.a, ...plains.b)).toBeGreaterThanOrEqual(0);
    expect(plains.a[0] + plains.a[1]).toBeGreaterThan(0.5);
    const beach = groundSample(t, () => 'beach', 300, 900, 2.5, newGroundSample());
    expect(beach.a[2]).toBeGreaterThan(0.5);
    const snowy = groundSample(t, () => 'mountain', 300, 900, 300, newGroundSample());
    expect(snowy.a[3]).toBeGreaterThan(0.5);
    for (const p of Object.values(GROUND_PROFILES)) expect(p.grass + p.dirt + p.sand + p.snow + p.litter + p.mud + p.rock).toBeGreaterThan(0.9);
  });

  it('animal trails are narrow, deterministic paths', () => {
    const t = new Terrain(77);
    let on = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (t.trailMask((i % 63) * 13.7, Math.floor(i / 63) * 13.7) > 0.5) on++;
    expect(on / N).toBeGreaterThan(0.002);
    expect(on / N).toBeLessThan(0.12);
    expect(t.trailMask(123.4, 567.8)).toBe(new Terrain(77).trailMask(123.4, 567.8));
  });
});

describe('characters', () => {
  it('the human is one skinned mesh with valid weights and a full skeleton', () => {
    const g = buildHumanGeometry();
    expect(finite(g)).toBe(true);
    expect(skinOk(g, BONE_NAMES.length)).toBe(true);
    expect(g.groups.length).toBe(5); // skin, cloth, leather, hair, eyes
    const rig = buildHumanRig([0, 1, 2, 3, 4].map(() => new THREE.MeshBasicMaterial()));
    expect(rig.mesh.skeleton.bones.length).toBe(BONE_NAMES.length);
    // Standing height ≈ 1.75–1.8 m, feet on the ground.
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeGreaterThan(-0.02);
    expect(g.boundingBox!.max.y).toBeGreaterThan(1.7);
    expect(g.boundingBox!.max.y).toBeLessThan(1.85);
  });

  it('every species builds a finite, correctly skinned dinosaur with a lighter distant version', () => {
    for (const id of SPECIES_IDS) {
      const t = buildDinoTemplate(SPECIES[id]);
      expect(finite(t.geometry), id).toBe(true);
      expect(skinOk(t.geometry, t.bones.length), id).toBe(true);
      expect(skinOk(t.low, t.bones.length), id).toBe(true);
      expect(t.low.attributes.position.count, id).toBeLessThan(t.geometry.attributes.position.count);
      t.geometry.computeBoundingBox();
      const bb = t.geometry.boundingBox!;
      // Size matches the species' length within reason, feet near the ground.
      expect(bb.max.z - bb.min.z, id).toBeGreaterThan(SPECIES[id].lengthM * 0.6);
      expect(bb.min.y, id).toBeLessThan(SPECIES[id].hipHeightM * 0.1 + 0.05);
      t.geometry.dispose();
      t.low.dispose();
    }
  });
});

describe('graphics presets', () => {
  it('quality rises monotonically from Low to Ultra', () => {
    const order = ['low', 'medium', 'high', 'ultra'] as const;
    for (let i = 1; i < order.length; i++) {
      const a = QUALITY[order[i - 1]];
      const b = QUALITY[order[i]];
      expect(b.terrainRes).toBeGreaterThanOrEqual(a.terrainRes);
      expect(b.textureSize).toBeGreaterThanOrEqual(a.textureSize);
      expect(b.groundCover).toBeGreaterThanOrEqual(a.groundCover);
      expect(b.shadowMapSize).toBeGreaterThanOrEqual(a.shadowMapSize);
    }
    expect(QUALITY.low.postFx).toBe(false);
    expect(QUALITY.ultra.postFx).toBe(true);
  });

  it('turning effects off also disables post-processing; texture overrides change resolution', () => {
    expect(effectiveQuality('ultra', { effects: false }).postFx).toBe(false);
    expect(effectiveQuality('low', { textures: 'high' }).textureSize).toBeGreaterThanOrEqual(512);
    expect(effectiveQuality('ultra', { textures: 'low' }).textureSize).toBeLessThanOrEqual(256);
  });
});

describe('external model manifest', () => {
  it('accepts valid entries and rejects unsafe or malformed ones', async () => {
    const { parseManifest } = await import('../src/graphics/externalModels');
    const m = parseManifest({
      version: 1,
      species: {
        tyrannosaurus: { url: 'trex.glb', scale: 2, strideM: 3.6, clips: { walk: 'Walk', idle: 'Idle', bogus: 'x' } },
        bad1: { url: 'https://evil.example/x.glb' },
        bad2: { url: '../secret.glb' },
        bad3: { url: 'x.exe' },
        embedded: { url: 'rex.gltf.json' },
        bad4: { url: 'x.json' },
        'Bad-Id': { url: 'x.glb' },
      },
      player: { url: 'p.glb', scale: 1e9 },
    });
    expect(Object.keys(m.species)).toEqual(['tyrannosaurus', 'embedded']);
    expect(m.species.tyrannosaurus.clips).toEqual({ walk: 'Walk', idle: 'Idle' });
    expect(m.player!.scale).toBe(1000);
    expect(parseManifest(null).species).toEqual({});
    expect(parseManifest('garbage').player).toBeNull();
  });

  it('chooses clips by state and speed with sensible fallbacks', async () => {
    const { chooseClip } = await import('../src/graphics/externalModels');
    const all = new Set(['idle', 'walk', 'run', 'eat', 'rest'] as const);
    expect(chooseClip(all, 'wander', 0, 2, 7, false)).toBe('idle');
    expect(chooseClip(all, 'wander', 1.5, 2, 7, false)).toBe('walk');
    expect(chooseClip(all, 'flee', 6.5, 2, 7, false)).toBe('run');
    expect(chooseClip(all, 'graze', 0, 2, 7, false)).toBe('eat');
    expect(chooseClip(new Set(['walk'] as const), 'flee', 6, 2, 7, false)).toBe('walk');
    expect(chooseClip(new Set(), 'idle', 0, 2, 7, false)).toBeNull();
    const rich = new Set(['idle', 'walk', 'run', 'eat', 'drink', 'roar', 'death'] as const);
    expect(chooseClip(rich, 'drink', 0, 2, 7, false)).toBe('drink');
    expect(chooseClip(all, 'drink', 0, 2, 7, false)).toBe('eat');
    expect(chooseClip(rich, 'alert', 0, 2, 7, false)).toBe('roar');
    expect(chooseClip(rich, 'dead', 0, 2, 7, false)).toBe('death');
    expect(chooseClip(all, 'dead', 0, 2, 7, false)).toBe('idle');
  });

  it('reads measured clip speeds and author credits, rejecting bad ones', async () => {
    const { parseManifest, locomotionRate } = await import('../src/graphics/externalModels');
    const credit = { title: 'Rex', author: 'Someone', url: 'https://sketchfab.com/3d-models/x', license: 'CC BY 4.0' };
    const m = parseManifest({
      species: {
        tyrannosaurus: { url: 'a.glb', clipSpeeds: { run: 10.7, walk: -1, swim: 3 }, credit },
        stegosaurus: { url: 'b.glb', credit: { ...credit, url: 'javascript:alert(1)' } },
      },
    });
    expect(m.species.tyrannosaurus.clipSpeeds).toEqual({ run: 10.7 });
    expect(m.species.tyrannosaurus.credit).toEqual(credit);
    expect(m.species.stegosaurus.credit).toBeNull();
    // Measured speed: plays at real speed ÷ clip speed, clamped to a sane range.
    expect(locomotionRate(m.species.tyrannosaurus, 'run', 9, 7.5)).toBeCloseTo(7.5 / 10.7, 5);
    expect(locomotionRate(m.species.tyrannosaurus, 'run', 9, 0.1)).toBe(0.15);
    // Without one: a clip cycle covers two strides.
    expect(locomotionRate({ ...m.species.stegosaurus, strideM: 2 }, 'walk', 2, 1)).toBeCloseTo(0.5, 5);
  });

  it('reads the bone map of models re-bound to the game skeleton, dropping unsafe names', async () => {
    const { parseManifest } = await import('../src/graphics/externalModels');
    const m = parseManifest({ version: 1, species: { spinosaurus: { url: 's.glb', scale: 1.03, rig: { 'Bone.003_025': 'neck1', Master_01: 'pelvis', 'bad name!': 'head', ok: '1abc', x: 42 } } } });
    expect(m.species.spinosaurus.rig).toEqual({ 'Bone.003_025': 'neck1', Master_01: 'pelvis' });
    expect(parseManifest({ version: 1, species: { a: { url: 'a.glb' } } }).species.a.rig).toBeUndefined();
  });

  it('every bone of the shipped re-bound models maps to a bone of the fitted game skeleton', async () => {
    const fs = await import('fs');
    const { parseManifest } = await import('../src/graphics/externalModels');
    const { buildDinoTemplate } = await import('../src/animals/dinoModel');
    const { RIG_FITS } = await import('../src/animals/rigFits');
    const { SPECIES } = await import('../src/animals/species');
    const m = parseManifest(JSON.parse(fs.readFileSync('public/models/manifest.json', 'utf8')));
    for (const [id, e] of Object.entries(m.species)) {
      if (!e.rig) continue;
      expect(RIG_FITS[id], id).toBeDefined();
      const t = buildDinoTemplate(SPECIES[id]);
      const names = new Set(t.bones.map((b) => b.name));
      for (const b of Object.values(e.rig)) expect(names.has(b), `${id}: ${b}`).toBe(true);
      // The fitted skeleton stands where the artist's does: hips at the fitted height.
      const hip = t.bp.legs.find((l) => !l.front)!.joints[0];
      expect(t.hipHeight).toBeCloseTo(hip.y, 5);
    }
  });
});
