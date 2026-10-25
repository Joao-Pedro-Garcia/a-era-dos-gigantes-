import { describe, expect, it } from 'vitest';
import { Noise2D } from '../src/core/noise';
import { Rng, hash2 } from '../src/core/rng';
import { CollisionWorld } from '../src/world/collision';
import { missingKeys } from '../src/localization/i18n';

describe('rng & noise', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    expect(hash2(1, 2, 3)).toBe(hash2(1, 2, 3));
    expect(hash2(1, 2, 3)).not.toBe(hash2(1, 3, 2));
  });
  it('noise stays in range and is deterministic', () => {
    const n = new Noise2D(9);
    const m = new Noise2D(9);
    for (let i = 0; i < 500; i++) {
      const v = n.fbm(i * 0.37, i * 0.11, 4);
      expect(v).toBe(m.fbm(i * 0.37, i * 0.11, 4));
      expect(Math.abs(v)).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('collision', () => {
  it('pushes a cylinder out of a circle and an oriented box', () => {
    const w = new CollisionWorld();
    w.add({ kind: 'circle', id: 'tree', x: 0, z: 0, r: 1, y0: 0, y1: 10 });
    const [x, z] = w.resolve(0.5, 0, 0.4, 0, 1.8);
    expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(1.39);
    w.add({ kind: 'box', id: 'wall', x: 10, z: 0, hx: 2, hz: 0.15, rot: Math.PI / 4, y0: 0, y1: 3, walkable: false, enabled: true });
    expect(w.blocked(10, 0, 0.3)).toBe(true);
    const [bx, bz] = w.resolve(10, 0, 0.3, 0, 1.8);
    expect(CollisionWorld.penetration(w.get('wall')!, bx, bz, 0.29)).toBeNull();
  });
  it('ignores disabled boxes (open doors) and steps onto walkable tops', () => {
    const w = new CollisionWorld();
    w.add({ kind: 'box', id: 'door', x: 0, z: 0, hx: 2, hz: 0.15, rot: 0, y0: 0, y1: 3, walkable: false, enabled: false });
    expect(w.blocked(0, 0, 0.3)).toBe(false);
    w.add({ kind: 'box', id: 'floor', x: 5, z: 5, hx: 2, hz: 2, rot: 0, y0: -2, y1: 0.3, walkable: true, enabled: true });
    expect(w.surfaceAt(5, 5, 1)).toBeCloseTo(0.3);
    const [x, z] = w.resolve(5, 5, 0.4, 0, 1.8);
    expect([x, z]).toEqual([5, 5]);
  });
});

describe('localization', () => {
  it('has every Portuguese key translated to English', () => {
    expect(missingKeys()).toEqual([]);
  });
});
