import { describe, expect, it } from 'vitest';
import { Building, PIECES, type Piece } from '../src/building/building';
import { hpOf, maxHp, repairCost, stability, WEAR_FLOOR } from '../src/building/durability';
import { Inventory } from '../src/inventory/inventory';
import { CollisionWorld } from '../src/world/collision';

const H = 5;
const ground = () => H;
const flat = () => ({ height: () => H, waterLevel: 0, collision: new CollisionWorld() });

function rich() {
  const inv = new Inventory();
  for (let i = 0; i < 6; i++) {
    inv.add('wood', 50);
    inv.add('stone', 50);
    inv.add('fiber', 50);
  }
  inv.add('rope', 10);
  inv.add('hide', 10);
  return inv;
}

/** A small hut: foundation, four walls and a roof. */
function hut() {
  const env = flat();
  const b = new Building({ pieces: [], nextId: 1 }, env.collision);
  const inv = rich();
  const f = b.place(b.preview('foundation', 0, 0, 0, true, env, 0, 0), inv)!;
  const walls: Piece[] = [];
  for (const [dx, dz, rot] of [[2, 0, Math.PI / 2], [-2, 0, Math.PI / 2], [0, 2, 0], [0, -2, 0]] as const) {
    const pl = b.preview('wall', f.x + dx * 0.95, f.z + dz * 0.95, rot, true, env, 0, 0);
    expect(pl.valid).toBe(true);
    walls.push(b.place(pl, inv)!);
  }
  const roofPl = b.preview('roof', f.x, f.z, 0, true, env, 0, 0);
  expect(roofPl.valid).toBe(true);
  const roof = b.place(roofPl, inv)!;
  return { b, env, inv, f, walls, roof };
}

describe('piece durability', () => {
  it('stone outlasts wood; fresh pieces are at full health', () => {
    expect(maxHp('stone_wall')).toBeGreaterThan(maxHp('wall'));
    expect(maxHp('wall')).toBeGreaterThan(maxHp('fence'));
    const p = { id: 'x', type: 'wall', x: 0, y: 0, z: 0, rot: 0 } as Piece;
    expect(hpOf(p)).toBe(maxHp('wall'));
    expect(repairCost(p)).toEqual({});
  });

  it('rain wears wood down slowly, never below the floor; stone barely', () => {
    const { b, walls, f } = hut();
    b.weather(1200 * 30, true, true);
    expect(hpOf(walls[0])).toBeCloseTo(maxHp('wall') * WEAR_FLOOR, 0);
    expect(hpOf(f)).toBeGreaterThan(maxHp('foundation') * 0.5);
    const { b: b2, walls: w2 } = hut();
    b2.weather(1200, false, false);
    expect(hpOf(w2[0])).toBe(maxHp('wall'));
  });

  it('damage then repair with materials restores full health', () => {
    const { b, inv, walls } = hut();
    b.damage(walls[0].id, 150, ground);
    expect(hpOf(walls[0])).toBe(maxHp('wall') - 150);
    const cost = repairCost(walls[0]);
    expect(Object.keys(cost).length).toBeGreaterThan(0);
    const wood = inv.count('wood');
    expect(b.repair(walls[0].id, inv)).toBe('ok');
    expect(hpOf(walls[0])).toBe(maxHp('wall'));
    expect(inv.count('wood')).toBe(wood - (cost.wood ?? 0));
    expect(b.repair(walls[0].id, inv)).toBe('full');
    b.damage(walls[0].id, 100, ground);
    expect(b.repair(walls[0].id, new Inventory())).toBe('materials');
  });
});

describe('structural integrity', () => {
  it('a hut is fully supported', () => {
    const { b } = hut();
    for (const s of stability(b.pieces.values(), ground).values()) expect(s).toBeGreaterThanOrEqual(0.2);
  });

  it('breaking the foundation brings the walls and the roof down with it', () => {
    const { b, f, roof, walls } = hut();
    const res = b.damage(f.id, 1e6, ground);
    const gone = new Set(res.destroyed.map((p) => p.id));
    expect(gone.has(f.id)).toBe(true);
    for (const w of walls) expect(gone.has(w.id)).toBe(true);
    expect(gone.has(roof.id)).toBe(true);
    expect(b.pieces.size).toBe(0);
    expect(res.debris.wood).toBeGreaterThan(0);
  });

  it('losing one wall does not drop a roof still held by the others', () => {
    const { b, roof, walls } = hut();
    const res = b.damage(walls[0].id, 1e6, ground);
    expect(res.destroyed.map((p) => p.id)).toEqual([walls[0].id]);
    expect(b.pieces.has(roof.id)).toBe(true);
  });

  it('a roof falls when all its walls are gone', () => {
    const { b, roof, walls } = hut();
    for (const w of walls.slice(0, 3)) b.damage(w.id, 1e6, ground);
    const res = b.damage(walls[3].id, 1e6, ground);
    expect(res.destroyed.map((p) => p.id)).toContain(roof.id);
  });
});

describe('watchtower', () => {
  it('can be built on the ground; its deck is a walkable surface 8 m up', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const pl = b.preview('watchtower', 3, 3, 0, false, env, 0, 0);
    expect(pl.valid).toBe(true);
    expect(pl.y).toBeCloseTo(H + PIECES.watchtower.size[1]);
    const t = b.place(pl, rich())!;
    expect(env.collision.surfaceAt(t.x, t.z, t.y + 1)).toBeCloseTo(t.y);
    expect(maxHp('watchtower')).toBeGreaterThan(maxHp('wall'));
  });

  it('health survives a save round trip', () => {
    const { b, walls } = hut();
    b.damage(walls[1].id, 99, ground);
    const state = JSON.parse(JSON.stringify(b.serialize()));
    const b2 = new Building(state, new CollisionWorld());
    expect(hpOf(b2.pieces.get(walls[1].id)!)).toBe(maxHp('wall') - 99);
  });
});
