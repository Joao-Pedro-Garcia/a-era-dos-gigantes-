import { describe, expect, it } from 'vitest';
import { Building, PIECES } from '../src/building/building';
import { Inventory } from '../src/inventory/inventory';
import { CollisionWorld } from '../src/world/collision';

const flat = (h = 5) => ({ height: () => h, waterLevel: 0, collision: new CollisionWorld() });

function rich() {
  const inv = new Inventory();
  for (let i = 0; i < 6; i++) {
    inv.add('wood', 50);
    inv.add('stone', 50);
    inv.add('fiber', 50);
  }
  inv.add('hide', 10);
  return inv;
}

describe('building', () => {
  it('places a foundation, snaps walls to its edges and consumes materials', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const inv = rich();
    const wood = inv.count('wood');
    const f = b.place(b.preview('foundation', 1.3, 2.2, 0, true, env, 0, 0), inv)!;
    expect(f).toBeTruthy();
    expect([f.x, f.z]).toEqual([0, 4]);
    expect(inv.count('wood')).toBe(wood - PIECES.foundation.cost.wood!);
    const w = b.preview('wall', f.x + 1.9, f.z + 0.2, 0, true, env, 0, 0);
    expect(w.valid).toBe(true);
    expect(w.x).toBeCloseTo(f.x + 2);
    expect(w.z).toBeCloseTo(f.z);
    expect(w.y).toBeCloseTo(f.y);
  });
  it('rejects water, overlaps, steep ground, distance and unsupported roofs', () => {
    const inv = rich();
    const water = { height: () => -3, waterLevel: 0, collision: new CollisionWorld() };
    const bw = new Building({ pieces: [], nextId: 1 }, water.collision);
    expect(bw.preview('foundation', 0, 0, 0, true, water, 0, 0).reason).toBe('water');
    expect(bw.preview('platform', 0, 0, 0, true, water, 0, 0).valid).toBe(true);

    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    b.place(b.preview('foundation', 0, 0, 0, true, env, 0, 0), inv);
    expect(b.preview('foundation', 0.4, 0.3, 0, false, env, 0, 0).reason).toBe('overlap');
    expect(b.preview('roof', 0, 0, 0, true, env, 0, 0).reason).toBe('support');
    expect(b.preview('campfire', 40, 0, 0, true, env, 0, 0).reason).toBe('distance');

    const steep = { height: (x: number) => x * 2, waterLevel: -100, collision: new CollisionWorld() };
    const bs = new Building({ pieces: [], nextId: 1 }, steep.collision);
    expect(bs.preview('foundation', 0, 0, 0, true, steep, 0, 0).reason).toBe('slope');
  });
  it('blocks placement through trees and rocks', () => {
    const env = flat();
    env.collision.add({ kind: 'circle', id: 'tree', x: 0, z: 0, r: 0.6, y0: 0, y1: 10 });
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    expect(b.preview('workbench', 0, 0, 0, false, env, 0, 0).reason).toBe('blocked');
  });
  it('does not consume anything when materials are missing', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const inv = new Inventory();
    inv.add('wood', 3);
    expect(b.place(b.preview('foundation', 0, 0, 0, true, env, 0, 0), inv)).toBeNull();
    expect(inv.count('wood')).toBe(3);
  });
  it('demolishing refunds half and returns storage contents; doors toggle collision', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const inv = rich();
    const st = b.place(b.preview('storage', 3, 0, 0, false, env, 0, 0), inv)!;
    st.storage![0] = { id: 'berries', qty: 7 };
    const wood = inv.count('wood');
    b.demolish(st.id, inv);
    expect(inv.count('wood')).toBe(wood + PIECES.storage.cost.wood! / 2);
    expect(inv.count('berries')).toBe(7);
    const door = b.place(b.preview('door', 0, 3, 0, false, env, 0, 0), inv)!;
    expect(env.collision.blocked(door.x, door.z, 0.2)).toBe(true);
    b.toggleDoor(door.id);
    expect(env.collision.blocked(door.x, door.z, 0.2)).toBe(false);
  });
  it('stations and shelter are detected', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const inv = rich();
    b.place(b.preview('campfire', 2, 0, 0, false, env, 0, 0), inv);
    expect(b.stationsNear(0, 0).has('campfire')).toBe(true);
    expect(b.stationsNear(50, 0).has('campfire')).toBe(false);
  });
});
