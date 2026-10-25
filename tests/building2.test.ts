import { describe, expect, it } from 'vitest';
import { Building, PIECES, storageAdd, storageTakeOne } from '../src/building/building';
import { Inventory } from '../src/inventory/inventory';
import { CollisionWorld } from '../src/world/collision';

const flat = () => ({ height: () => 5, waterLevel: 0, collision: new CollisionWorld() });
const rich = () => {
  const inv = new Inventory();
  for (const [id, q] of Object.entries({ wood: 50, stone: 50, fiber: 50, rope: 20, metal_ingot: 20, metal_scrap: 20, crystal: 10, hide: 10, clay: 20, flint: 20, trap_snare: 3 }))
    while (inv.count(id) < q) inv.add(id, Math.min(q - inv.count(id), 50));
  return inv;
};
const tickCtx = { now: 0, raining: false, growth: 1, windSpeed: 8, warm: () => true, incubationSeconds: () => 1000 };

describe('new building pieces', () => {
  it('stairs are a walkable ramp that never blocks movement', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const st = b.place(b.preview('stairs', 0, 3, 0, false, env, 0, 0), rich())!;
    expect(st).toBeTruthy();
    expect(env.collision.blocked(st.x, st.z, 0.3)).toBe(false);
    const low = env.collision.surfaceAt(st.x, st.z - 1.8, 100);
    const high = env.collision.surfaceAt(st.x, st.z + 1.8, 100);
    expect(high - low).toBeGreaterThan(2);
  });
  it('wind generators power nearby consumers only when there is wind', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const inv = rich();
    b.place(b.preview('wind_generator', 0, 0, 0, false, env, 0, 0), inv);
    const near = b.place(b.preview('lamp', 4, 0, 0, false, env, 0, 0), inv)!;
    const pieces = [...b.pieces.values()];
    const far = { ...near, id: 'far', x: 300 };
    b.pieces.set('far', far);
    b.tick(1, { ...tickCtx, windSpeed: 8 });
    expect(near.powered).toBe(true);
    expect(far.powered).toBe(false);
    b.tick(1, { ...tickCtx, windSpeed: 0.5 });
    expect(near.powered).toBe(false);
    void pieces;
  });
  it('crops must be planted and need water to grow well', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const plot = b.place(b.preview('crop_plot', 3, 0, 0, false, env, 0, 0), rich())!;
    b.tick(10000, tickCtx);
    expect(plot.growth).toBe(0);
    expect(b.plant(plot.id, 'berries', 0)).toBe(true);
    expect(b.plant(plot.id, 'herb', 0)).toBe(false);
    b.tick(500, { ...tickCtx, now: 500 });
    const watered = plot.growth!;
    plot.growth = 0;
    plot.wateredAt = -1e9;
    b.tick(500, { ...tickCtx, now: 5000 });
    expect(plot.growth!).toBeLessThan(watered);
    plot.growth = 1;
    expect(b.harvestCrop(plot.id)).toEqual({ berries: 8 });
    expect(plot.crop).toBeNull();
  });
  it('eggs incubate faster when warm', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const inv = rich();
    const warm = b.place(b.preview('nest_box', 3, 0, 0, false, env, 0, 0), inv)!;
    const cold = b.place(b.preview('nest_box', -3, 0, 0, false, env, 0, 0), inv)!;
    b.incubate(warm.id, 'protoceratops');
    b.incubate(cold.id, 'protoceratops');
    expect(b.incubate(warm.id, 'protoceratops')).toBe(false);
    b.tick(100, { ...tickCtx, warm: (x) => x > 0 });
    expect(warm.egg!.progress).toBeGreaterThan(cold.egg!.progress);
  });
  it('skill discounts never drop a material to zero', () => {
    const c = Building.cost('foundation', 0.8);
    expect(c.wood).toBe(Math.ceil(PIECES.foundation.cost.wood! * 0.8));
    expect(Object.values(Building.cost('snare_trap', 0.1)).every((q) => q >= 1)).toBe(true);
  });
  it('storage helpers merge stacks and take single portions', () => {
    const slots = Array(3).fill(null);
    expect(storageAdd(slots, { id: 'berries', qty: 150 })).toBe(0);
    expect(storageTakeOne(slots, ['raw_meat'])).toBeNull();
    expect(storageTakeOne(slots, ['berries'])).toBe('berries');
    expect(slots.reduce((s, x) => s + (x?.qty ?? 0), 0)).toBe(149);
  });
});
