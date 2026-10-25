import { describe, expect, it } from 'vitest';
import { Inventory, GRID_SIZE } from '../src/inventory/inventory';
import { Crafting } from '../src/crafting/crafting';
import { RECIPES } from '../src/crafting/recipes';
import { ITEMS } from '../src/inventory/items';

const total = (inv: Inventory) => inv.data.slots.reduce((s, x) => s + (x?.qty ?? 0), 0);

describe('inventory', () => {
  it('stacks, respects max stacks and reports what did not fit', () => {
    const inv = new Inventory();
    expect(inv.add('wood', 120)).toBe(0);
    expect(inv.count('wood')).toBe(120);
    expect(inv.data.slots.filter(Boolean).length).toBe(3);
    const left = inv.add('stone', 50 * GRID_SIZE);
    expect(left).toBe(50 * 3);
  });
  it('keeps durable tools as separate entries', () => {
    const inv = new Inventory();
    inv.add('stone_axe', 2);
    expect(inv.data.slots.filter((s) => s?.id === 'stone_axe').length).toBe(2);
    expect(inv.data.slots[0]!.dur).toBe(ITEMS.stone_axe.durability);
  });
  it('removes all-or-nothing', () => {
    const inv = new Inventory();
    inv.add('fiber', 5);
    expect(inv.remove('fiber', 6)).toBe(false);
    expect(inv.count('fiber')).toBe(5);
    expect(inv.removeAll({ fiber: 2, wood: 1 })).toBe(false);
    expect(inv.count('fiber')).toBe(5);
    expect(inv.removeAll({ fiber: 2 })).toBe(true);
    expect(inv.count('fiber')).toBe(3);
  });
  it('addAll is atomic when the grid is full', () => {
    const inv = new Inventory();
    for (let i = 0; i < GRID_SIZE; i++) inv.add('stone_axe', 1);
    expect(inv.addAll({ wood: 1 })).toBe(false);
    expect(inv.count('wood')).toBe(0);
  });
  it('sorting preserves totals and hotbar references', () => {
    const inv = new Inventory();
    inv.add('wood', 7);
    inv.add('spear', 1);
    inv.add('wood', 30);
    inv.add('berries', 4);
    inv.data.hotbar[0] = inv.data.slots.findIndex((s) => s?.id === 'spear');
    const before = total(inv);
    inv.sort();
    expect(total(inv)).toBe(before);
    expect(inv.data.slots[inv.data.hotbar[0]!]!.id).toBe('spear');
  });
  it('sanitizes corrupted saves', () => {
    const inv = new Inventory();
    inv.data.slots[0] = { id: 'not_an_item', qty: 3 };
    inv.data.slots[1] = { id: 'wood', qty: 999 };
    inv.data.slots[2] = { id: 'wood', qty: Number.NaN };
    inv.data.hotbar[0] = 0;
    const issues = Inventory.sanitize(inv.data);
    expect(issues.length).toBeGreaterThan(0);
    expect(inv.data.slots[0]).toBeNull();
    expect(inv.data.slots[1]!.qty).toBe(ITEMS.wood.maxStack);
    expect(inv.data.slots[2]).toBeNull();
    expect(inv.data.hotbar[0]).toBeNull();
  });
  it('weight and capacity follow equipment', () => {
    const inv = new Inventory();
    inv.add('backpack', 1);
    const base = inv.capacity();
    inv.equip(0);
    expect(inv.capacity()).toBe(base + (ITEMS.backpack.capacity ?? 0));
  });
});

describe('crafting', () => {
  const stations = new Set(['hand'] as const);
  it('consumes materials atomically and refunds exactly on cancel', () => {
    const inv = new Inventory();
    inv.add('wood', 3);
    inv.add('flint', 2);
    inv.add('fiber', 3);
    const c = new Crafting();
    expect(c.start('stone_axe', inv, new Set(stations))).toBeNull();
    expect(inv.count('wood')).toBe(1);
    expect(c.start('stone_axe', inv, new Set(stations))).toBe('materials');
    expect(inv.count('wood')).toBe(1);
    const overflow = c.cancel(0, inv);
    expect(overflow).toEqual({});
    expect(inv.count('wood')).toBe(3);
    expect(inv.count('flint')).toBe(2);
    expect(inv.count('fiber')).toBe(3);
  });
  it('completes jobs over time', () => {
    const inv = new Inventory();
    inv.add('fiber', 6);
    const c = new Crafting();
    c.start('bandage', inv, new Set(stations));
    expect(c.update(1, inv).completed).toEqual([]);
    expect(c.update(5, inv).completed).toEqual(['bandage']);
    expect(inv.count('bandage')).toBe(2);
  });
  it('enforces stations and unlocks', () => {
    const inv = new Inventory();
    inv.addAll({ wood: 10, fiber: 20, hide: 5, obsidian: 5, rope: 3 });
    const c = new Crafting();
    expect(c.start('bow', inv, new Set(stations))).toBe('station');
    expect(c.start('obsidian_spear', inv, new Set(['hand', 'workbench']))).toBe('locked');
    c.unlocked.add('found_obsidian');
    expect(c.start('obsidian_spear', inv, new Set(['hand', 'workbench']))).toBeNull();
  });
  it('returns overflow instead of destroying output when the grid is full', () => {
    const inv = new Inventory();
    inv.add('fiber', 6);
    const c = new Crafting();
    c.start('bandage', inv, new Set(stations));
    for (let i = 0; i < GRID_SIZE; i++) inv.add('stone_axe', 1);
    const res = c.update(10, inv);
    expect(res.overflow).toEqual({ bandage: 2 });
  });
  it('only references known items', () => {
    for (const r of RECIPES) {
      expect(ITEMS[r.output], r.id).toBeDefined();
      for (const k of Object.keys(r.inputs)) expect(ITEMS[k], `${r.id}:${k}`).toBeDefined();
    }
  });
});

describe('v0.2 inventory and crafting rules', () => {
  it('eggs of different species never merge', () => {
    const inv = new Inventory();
    inv.add('dino_egg', 1, undefined, 'triceratops');
    inv.add('dino_egg', 1, undefined, 'velociraptor');
    inv.add('dino_egg', 1, undefined, 'triceratops');
    expect(inv.data.slots.filter(Boolean).length).toBe(2);
    expect(inv.count('dino_egg', 'triceratops')).toBe(2);
    expect(inv.remove('dino_egg', 2, 'velociraptor')).toBe(false);
    expect(inv.remove('dino_egg', 1, 'velociraptor')).toBe(true);
  });
  it('rejects invalid quantities', () => {
    const inv = new Inventory();
    expect(inv.add('wood', Number.NaN)).toBe(0);
    expect(inv.add('wood', -5)).toBe(0);
    expect(inv.count('wood')).toBe(0);
    expect(inv.remove('wood', -1)).toBe(false);
  });
  it('recipes can require a tool that is not consumed', () => {
    const inv = new Inventory();
    inv.addAll({ hide: 2, fiber: 4 });
    const c = new Crafting();
    expect(c.start('waterskin', inv, new Set(['hand']))).toBe('tool');
    inv.add('stone_knife', 1);
    expect(c.start('waterskin', inv, new Set(['hand']))).toBeNull();
    expect(inv.count('stone_knife')).toBe(1);
  });
  it('the artisan skill shortens crafting and thrifty can refund materials', () => {
    const inv = new Inventory();
    inv.add('fiber', 12);
    const c = new Crafting();
    c.timeMultiplier = 0.5;
    c.refundChance = 1;
    c.random = () => 0;
    c.start('bandage', inv, new Set(['hand']));
    expect(c.queue[0].remaining).toBe(1.5);
    c.update(2, inv);
    expect(inv.count('fiber')).toBe(7);
  });
});
