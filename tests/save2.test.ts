import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, SaveError, checksumOf, migrate, sanitize, withChecksum, type SaveData } from '../src/save/saveData';
import { importSave, loadWithFallback, writeSave } from '../src/save/storage';
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
    version: SAVE_VERSION, savedAt: 0, seed: 1,
    player: { x: 1, y: 2, z: 3, yaw: 0, survival: createSurvival(), respawn: null, deaths: 0 },
    inventory: createInventory(), crafting: { queue: [], unlocked: [] }, env: createEnvState(1), eco: createEcosystemState(1),
    building: { pieces: [], nextId: 1 }, world: { harvested: {}, bags: [], nextBagId: 1, discovered: [] },
    progression: createProgression(), exploration: createExploration(), mysteries: createMysteries(),
  };
}
const file = (obj: unknown) => new Blob([typeof obj === 'string' ? obj : JSON.stringify(obj)]);

describe('save v2', () => {
  it('migrates a v1 save: adds progression, exploration, mysteries and taming fields', () => {
    const v1 = sample() as unknown as Record<string, unknown>;
    v1.version = 1;
    delete v1.progression;
    delete v1.exploration;
    delete v1.mysteries;
    const a = createAnimal({ id: 'a', speciesId: 'triceratops', x: 0, z: 0, bornAt: 0, groupId: 'g', rng: new Rng(1) }) as unknown as Record<string, unknown>;
    delete a.tame;
    delete a.tameProgress;
    (v1.eco as { animals: unknown[] }).animals = [a];
    const m = migrate(v1);
    expect(m.version).toBe(2);
    expect(m.progression.xp.survival).toBe(0);
    expect(m.eco.animals[0].tame).toBeNull();
    expect(m.eco.animals[0].tameProgress).toBe(0);
  });
  it('detects corrupted content with the checksum', () => {
    const s = withChecksum(sample());
    expect(checksumOf(s)).toBe(s.checksum);
    expect(() => migrate({ ...s, seed: 2 })).toThrowError(SaveError);
    expect(() => migrate(s)).not.toThrow();
  });
  it('rejects files that are not saves', async () => {
    await expect(importSave(file('{not json'))).rejects.toMatchObject({ code: 'json' });
    await expect(importSave(file([1, 2]))).rejects.toMatchObject({ code: 'notObject' });
    await expect(importSave(file({ hello: 1 }))).rejects.toMatchObject({ code: 'structure' });
    await expect(importSave(file({ ...sample(), version: 99 }))).rejects.toMatchObject({ code: 'future' });
  });
  it('clamps impossible values instead of loading them', () => {
    const s = sample();
    s.player.x = 1e9;
    s.player.survival.health = 5000;
    s.player.survival.food = Number.NaN;
    const a = createAnimal({ id: 'a', speciesId: 'triceratops', x: 0, z: 0, bornAt: 0, groupId: 'g', rng: new Rng(1) });
    a.hunger = 99;
    a.tame = { name: 'x'.repeat(200), obedience: 7, bond: -3, command: 'follow', anchorX: Number.NaN, anchorZ: 0, imprinted: false, fedAt: 0, trainedAt: 0, gatheredAt: 0, ridden: true };
    s.eco.animals = [a, { ...a, id: 'b', speciesId: 'unicorn' }];
    s.building.pieces = [{ id: 'p', type: 'nope' as never, x: 0, y: 0, z: 0, rot: 0 }];
    sanitize(s);
    expect(s.player.x).toBe(5200);
    expect(s.player.survival.health).toBe(100);
    expect(s.player.survival.food).toBe(60);
    expect(s.eco.animals.length).toBe(1);
    const t = s.eco.animals[0].tame!;
    expect(t.name.length).toBe(40);
    expect([t.obedience, t.bond]).toEqual([1, 0]);
    expect(t.ridden).toBe(false);
    expect(s.eco.animals[0].hunger).toBe(1);
    expect(s.building.pieces).toEqual([]);
  });
  it('falls back to the backup if the main slot is corrupted', async () => {
    const good = sample();
    await writeSave('fb', good);
    await writeSave('fb', { ...sample(), seed: 99 });
    // Corrupt the main slot directly.
    await new Promise<void>((res) => {
      const req = indexedDB.open('era-dos-gigantes', 1);
      req.onsuccess = () => {
        const tx = req.result.transaction('saves', 'readwrite');
        tx.objectStore('saves').put({ garbage: true }, 'fb');
        tx.oncomplete = () => {
          req.result.close();
          res();
        };
      };
    });
    const r = await loadWithFallback('fb');
    expect(r!.fromBackup).toBe(true);
    expect(r!.data.seed).toBe(1);
  });
});
