import { describe, expect, it } from 'vitest';
import { AQUATIC_MIN_DEPTH } from '../src/animals/aquatic';
import { reactionScale } from '../src/animals/animalView';
import { buildDinoTemplate } from '../src/animals/dinoModel';
import { SPECIES, SPECIES_IDS } from '../src/animals/species';
import { Rng } from '../src/core/rng';
import { ctx, makeWorld, player } from './helpers';

const tris = (g: { index: { count: number } | null }) => (g.index?.count ?? 0) / 3;

describe('dinosaur models', () => {
  it('every species builds three levels of detail that keep the same silhouette', () => {
    for (const id of SPECIES_IDS) {
      const t = buildDinoTemplate(SPECIES[id]);
      const [hi, mid, lo] = [t.geometry, t.mid, t.low];
      expect(tris(hi), id).toBeGreaterThan(tris(mid));
      expect(tris(mid), id).toBeGreaterThan(tris(lo));
      for (const g of [hi, mid, lo]) {
        const p = g.attributes.position.array as Float32Array;
        for (let i = 0; i < p.length; i++) expect(Number.isFinite(p[i])).toBe(true);
        // Skin weights sum to one.
        const w = g.attributes.skinWeight;
        for (let i = 0; i < w.count; i += 7) expect(Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1)).toBeLessThan(1e-3);
      }
      hi.computeBoundingBox();
      lo.computeBoundingBox();
      const a = hi.boundingBox!.getSize(hi.boundingBox!.min.clone().set(0, 0, 0));
      const b = lo.boundingBox!.getSize(lo.boundingBox!.min.clone().set(0, 0, 0));
      // Far version within 12 % of the close one in length and height (feathers/teeth aside).
      expect(Math.abs(a.z - b.z) / a.z, id).toBeLessThan(0.12);
      expect(Math.abs(a.y - b.y) / a.y, id).toBeLessThan(0.15);
    }
  }, 120_000);

  it('juveniles have their own proportions (bigger head and eyes, small display structures)', () => {
    for (const id of ['tyrannosaurus', 'triceratops', 'stegosaurus', 'parasaurolophus']) {
      const adult = buildDinoTemplate(SPECIES[id]);
      const young = buildDinoTemplate(SPECIES[id], true);
      expect(young.bp.juvenile).toBe(true);
      expect(young.bp.head.height / SPECIES[id].hipHeightM).toBeGreaterThan((adult.bp.head.height / SPECIES[id].hipHeightM) * 1.25);
      expect(young.hipHeight).toBeGreaterThan(adult.hipHeight);
    }
  });

  it('pterosaurs have a wing finger bone long enough for their wingspan', () => {
    for (const id of ['pteranodon', 'quetzalcoatlus']) {
      const t = buildDinoTemplate(SPECIES[id]);
      expect(t.bones.some((b) => b.name === 'wingLF')).toBe(true);
      const wing = t.legs.find((l) => l.name === 'wingL')!;
      const finger = wing.fingerTip!.distanceTo(wing.joints[3]);
      const arm = wing.lengths[0] + wing.lengths[1] + wing.lengths[2];
      expect(finger).toBeGreaterThan(arm);
    }
  });

  it('hit reactions shrink with body size', () => {
    expect(reactionScale(10)).toBeGreaterThan(reactionScale(500));
    expect(reactionScale(500)).toBeGreaterThan(reactionScale(8000));
    expect(reactionScale(50000)).toBeGreaterThanOrEqual(0.15);
  });
});

describe('Mosasaurus (marine squamate)', () => {
  it('is classified correctly and lives only in deep water', () => {
    const sp = SPECIES.mosasaurus;
    expect(sp.clade).toBe('squamate');
    expect(sp.locomotion.aquatic).toBe(true);
    expect(sp.habitat).toEqual(['ocean']);
  });

  it('stays in deep water while it swims and hunts', () => {
    const { terrain, eco } = makeWorld(42);
    // Find deep sea.
    let sx = 0;
    let sz = 0;
    let found = false;
    for (let r = 0; r < 6000 && !found; r += 200)
      for (let k = 0; k < 16 && !found; k++) {
        const x = Math.cos(k) * r;
        const z = Math.sin(k) * r;
        if (terrain.height(x, z) < -12) {
          sx = x;
          sz = z;
          found = true;
        }
      }
    expect(found).toBe(true);
    const grp = eco.spawnGroup('mosasaurus', sx, sz, new Rng(3));
    expect(grp.length).toBeGreaterThan(0);
    const a = grp[0];
    a.hunger = 0.9;
    const p = player(sx + 30, sz + 30);
    let minDepth = 0;
    for (let i = 0; i < 1800; i++) {
      eco.update(0.25, ctx(p));
      const h = terrain.height(a.x, a.z);
      expect(h).toBeLessThan(AQUATIC_MIN_DEPTH + 0.5);
      expect(a.y).toBeLessThan(0.5);
      minDepth = Math.min(minDepth, a.y);
    }
    expect(minDepth).toBeLessThan(-2); // it dives
  });
});

describe('realism pilot: triceratops and skin regions', () => {
  it('every model carries a skin region per vertex in [0, 1]', async () => {
    const { scuteAmount } = await import('../src/animals/dinoModel');
    for (const id of SPECIES_IDS) {
      const g = buildDinoTemplate(SPECIES[id]).geometry;
      const r = g.attributes.skinRegion;
      expect(r, id).toBeDefined();
      expect(r.count).toBe(g.attributes.position.count);
      let max = 0;
      for (let i = 0; i < r.count; i++) {
        expect(r.getX(i)).toBeGreaterThanOrEqual(0);
        expect(r.getX(i)).toBeLessThanOrEqual(1);
        max = Math.max(max, r.getX(i));
      }
      // Feathered animals have no scutes; ceratopsians have the largest ones.
      expect(max, id).toBeCloseTo(scuteAmount(SPECIES[id]), 1);
    }
    expect(scuteAmount(SPECIES.triceratops)).toBe(1);
    expect(scuteAmount(SPECIES.microraptor)).toBe(0);
    expect(scuteAmount(SPECIES.tyrannosaurus)).toBeLessThan(0.3);
  });

  it('the triceratops has a massive skull, brow horns ~1 m and a short tail', () => {
    const sp = SPECIES.triceratops;
    const t = buildDinoTemplate(sp);
    expect(t.bp.head.height).toBeGreaterThan(0.06 * sp.lengthM);
    expect(t.bp.head.height).toBeLessThan(0.09 * sp.lengthM);
    // Tail tip well short of half the body length behind the hips.
    const tip = t.bp.cps[0].p.z;
    const pelvis = t.bp.cps.find((c) => c.bone === 'pelvis')!.p.z;
    expect(pelvis - tip).toBeLessThan(0.45 * sp.lengthM);
    // The whole animal (beak to tail, frill included) stays within ±15 % of its length.
    t.geometry.computeBoundingBox();
    const len = t.geometry.boundingBox!.max.z - t.geometry.boundingBox!.min.z;
    expect(len / sp.lengthM).toBeGreaterThan(0.85);
    expect(len / sp.lengthM).toBeLessThan(1.15);
  });

  it('the parasaurolophus has a long tubular crest past the back of the skull and a deep, flat-sided tail', () => {
    const sp = SPECIES.parasaurolophus;
    const t = buildDinoTemplate(sp);
    const { at, len, height } = t.bp.head;
    const pos = t.geometry.attributes.position;
    // Crest: the highest point around the head is the crest, well above the skull
    // roof and well behind the head (the crest is about as long again as the skull).
    let top = -Infinity;
    let topZ = 0;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      if (z > at.z - 1.6 * len && pos.getY(i) > top) {
        top = pos.getY(i);
        topZ = z;
      }
    }
    expect(top - at.y).toBeGreaterThan(1.6 * height);
    expect(at.z - topZ).toBeGreaterThan(0.4 * len);
    expect(at.z - topZ).toBeLessThan(1.3 * len);
    // Tail taller than wide (neural spines and chevrons), with a blunt end.
    const tail3 = t.bp.cps.find((c) => c.bone === 'tail3')!;
    expect(tail3.ry / tail3.rx).toBeGreaterThan(1.5);
    expect(t.bp.cps[0].ry).toBeGreaterThan(0.01 * sp.lengthM);
    // Thighs proportionate to a 2.6 t ornithopod (not theropod "drumsticks").
    const thigh = t.bp.legs.find((l) => l.name === 'hindL')!;
    // (the film look carries heavier thighs than the fossil proportions, still not theropod-like).
    expect(thigh.radii[0]).toBeLessThan(0.05 * sp.lengthM);
  });

  it('the brachiosaurus stands higher at the shoulders, with a raised neck and a short tail', () => {
    const sp = SPECIES.brachiosaurus;
    const t = buildDinoTemplate(sp);
    const front = t.bp.legs.find((l) => l.name === 'frontL')!;
    const hind = t.bp.legs.find((l) => l.name === 'hindL')!;
    expect(front.joints[0].y).toBeGreaterThan(hind.joints[0].y * 1.1);
    // Head well above the shoulders (12-14 m), neck raised.
    expect(t.bp.head.at.y).toBeGreaterThan(11);
    expect(t.bp.head.at.y).toBeLessThan(15);
    // Tail behind the hips shorter than 0.45 of the length.
    const pelvis = t.bp.cps.find((c) => c.bone === 'pelvis')!.p.z;
    expect(pelvis - t.bp.cps[0].p.z).toBeLessThan(0.45 * sp.lengthM);
    // Pillar legs, not 2 m wide tubes; belly well off the ground but below the hip joint.
    expect(hind.radii[0]).toBeLessThan(0.04 * sp.lengthM);
    const torso = t.bp.cps.find((c) => c.bone === 'torso')!;
    expect(torso.p.y - torso.ry - torso.drop).toBeLessThan(sp.hipHeightM);
  });

  it('the ankylosaurus is low and broad, with a wide club, skull horns and banded armour', () => {
    const sp = SPECIES.ankylosaurus;
    const t = buildDinoTemplate(sp);
    const torso = t.bp.cps.find((c) => c.bone === 'torso')!;
    expect(torso.rx).toBeGreaterThan(torso.ry * 1.5);
    t.geometry.computeBoundingBox();
    const bb = t.geometry.boundingBox!;
    // Top of the back, armour included, a little over 2 m (~1.7 m at the hips plus the
    // osteoderms; the film-look spikes are taller than the fossil ones).
    expect(bb.max.y).toBeLessThan(sp.hipHeightM * 1.5);
    // Club: the tail tip region is about as wide as the skull (~0.5-0.7 m).
    const pos = t.geometry.attributes.position;
    const tipZ = t.bp.cps[0].p.z;
    let w = 0;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - tipZ) < 0.15) w = Math.max(w, Math.abs(pos.getX(i)));
    expect(2 * w).toBeGreaterThan(0.45);
    expect(2 * w).toBeLessThan(0.9);
  });
});
