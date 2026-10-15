import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, migrate, sanitize, type SaveData } from '../src/save/saveData';
import { readSave, writeSave } from '../src/save/storage';
import { createInventory } from '../src/inventory/inventory';
import { createSurvival } from '../src/survival/survival';
import { createEnvState } from '../src/world/environment';
import { createEcosystemState } from '../src/animals/ecosystem';
import { createAnimal } from '../src/animals/animal';
import { Rng } from '../src/core/rng';
import { createProgression } from '../src/progression/skills';
import { createExploration } from '../src/exploration/exploration';
import { createMysteries } from '../src/mysteries/mysteries';

function sample(): SaveData {
  return {
    version: SAVE_VERSION,
    savedAt: 0,
    seed: 1,
    player: { x: 1, y: 2, z: 3, yaw: 0, survival: createSurvival(), respawn: null, deaths: 0 },
    inventory: createInventory(),
    crafting: { queue: [], unlocked: [] },
    env: createEnvState(1),
    eco: createEcosystemState(1),
    building: { pieces: [], nextId: 1 },
    world: { harvested: {}, bags: [], nextBagId: 1, discovered: [] },
    progression: createProgression(),
    exploration: createExploration(),
    mysteries: createMysteries(),
  };
}

describe('save data', () => {
  it('migrates a v0 save to the current version', () => {
    const v0 = { ...sample(), version: 0, world: { harvested: { a: 1 } } } as unknown;
    const m = migrate(v0);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.world.bags).toEqual([]);
    expect(m.world.harvested).toEqual({ a: 1 });
  });
  it('refuses saves from the future', () => {
    expect(() => migrate({ ...sample(), version: 99 })).toThrow();
  });
  it('sanitizes duplicates, NaNs and invalid items', () => {
    const s = sample();
    const a = createAnimal({ id: 'a1', speciesId: 'triceratops', x: 0, z: 0, bornAt: 0, groupId: 'g', rng: new Rng(1) });
    s.eco.animals = [a, { ...a }, { ...a, id: 'a2', x: Number.NaN }];
    s.player.x = Number.NaN;
    s.world.bags = [{ id: 'b', x: 0, y: 0, z: 0, createdAt: 0, reason: 'death', items: [{ id: 'nope', qty: 1 }] }];
    const issues = sanitize(s);
    expect(issues.length).toBeGreaterThan(0);
    expect(s.eco.animals.map((x) => x.id)).toEqual(['a1']);
    expect(s.player.x).toBe(0);
    expect(s.world.bags).toEqual([]);
  });
  it('round-trips through IndexedDB and keeps a backup', async () => {
    const s = sample();
    s.inventory.slots[0] = { id: 'wood', qty: 12 };
    await writeSave('t', s);
    s.inventory.slots[0] = { id: 'wood', qty: 13 };
    await writeSave('t', s);
    const r = await readSave('t');
    expect(r!.data.inventory.slots[0]).toEqual({ id: 'wood', qty: 13 });
    const b = await readSave('t.backup');
    expect(b!.data.inventory.slots[0]).toEqual({ id: 'wood', qty: 12 });
  });
});
