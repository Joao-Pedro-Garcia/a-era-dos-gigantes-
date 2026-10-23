import { describe, expect, it } from 'vitest';
import { SPECIES } from '../src/animals/species';
import { BIOMES } from '../src/world/biomes';
import { buildDinoTemplate, scuteAmount } from '../src/animals/dinoModel';
import { TAME_PROFILES } from '../src/taming/profiles';

const NEW = ['megatherium', 'deinosuchus', 'dodo', 'anaconda', 'smilodon'];

describe('expanded fauna', () => {
  it('adds the five animals, each living in at least one biome and with a taming profile', () => {
    for (const id of NEW) {
      expect(SPECIES[id], id).toBeDefined();
      expect(Object.values(BIOMES).some((b) => (b.fauna[id] ?? 0) > 0), id).toBe(true);
      expect(TAME_PROFILES[id], id).toBeDefined();
    }
  });

  it('mammals and the anaconda give birth to live young; the dodo and Deinosuchus lay eggs', () => {
    for (const id of ['megatherium', 'smilodon', 'anaconda']) expect(SPECIES[id].reproduction.live, id).toBe(true);
    for (const id of ['dodo', 'deinosuchus']) expect(SPECIES[id].reproduction.live, id).toBeFalsy();
  });

  it('builds the right bodies: four legs on the mammals, none on the snake, a coat of hair instead of scutes', () => {
    for (const id of ['megatherium', 'smilodon']) {
      const t = buildDinoTemplate(SPECIES[id]);
      expect(t.bp.legs.filter((l) => !l.name.startsWith('arm')).length, id).toBe(4);
      expect(scuteAmount(SPECIES[id])).toBe(0);
    }
    const snake = buildDinoTemplate(SPECIES.anaconda);
    expect(snake.bp.legs).toHaveLength(0);
    // Long and low: the body never rises much above its own thickness.
    snake.geometry.computeBoundingBox();
    const bb = snake.geometry.boundingBox!;
    expect(bb.max.z - bb.min.z).toBeGreaterThan(SPECIES.anaconda.lengthM * 0.85);
    expect(bb.max.y).toBeLessThan(0.5);
  });

  it('the sabre-tooth has its sabres: geometry reaching well below the head', () => {
    const t = buildDinoTemplate(SPECIES.smilodon);
    const { at, height } = t.bp.head;
    const pos = t.geometry.attributes.position;
    let low = Infinity;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - at.z) < t.bp.head.len && Math.abs(pos.getX(i)) < 0.2) low = Math.min(low, pos.getY(i));
    expect(at.y - low).toBeGreaterThan(height * 1.2);
  });
});
