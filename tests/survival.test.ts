import { describe, expect, it } from 'vitest';
import { DIFFICULTY } from '../src/core/config';
import { Survival, createSurvival, type SurvivalContext } from '../src/survival/survival';

const calm: SurvivalContext = { airTemp: 22, insulation: 0, exertion: 0, sprinting: false, inWater: false, nearFire: false, sheltered: false, resting: false, overweight: 0 };

describe('survival', () => {
  it('hunger and thirst grow over a day; thirst faster', () => {
    const s = new Survival(createSurvival(), DIFFICULTY.normal);
    for (let i = 0; i < 600; i++) s.update(1, calm);
    expect(s.d.food).toBeLessThan(85);
    expect(85 - s.d.water).toBeGreaterThan(85 - s.d.food);
  });
  it('cold without clothing lowers body temperature; fire warms', () => {
    const s = new Survival(createSurvival(), DIFFICULTY.normal);
    for (let i = 0; i < 600; i++) s.update(1, { ...calm, airTemp: -15 });
    expect(s.d.bodyTemp).toBeLessThan(36);
    const t = s.d.bodyTemp;
    for (let i = 0; i < 300; i++) s.update(1, { ...calm, airTemp: -15, nearFire: true, insulation: 10 });
    expect(s.d.bodyTemp).toBeGreaterThan(t);
  });
  it('dies of thirst and does not regenerate at zero health', () => {
    const s = new Survival({ ...createSurvival(), water: 0, food: 100 }, DIFFICULTY.normal);
    for (let i = 0; i < 2000 && s.alive; i++) s.update(1, calm);
    expect(s.alive).toBe(false);
    s.d.water = 100;
    s.update(1, calm);
    expect(s.d.health).toBe(0);
  });
  it('relaxed difficulty is gentler', () => {
    const a = new Survival(createSurvival(), DIFFICULTY.peaceful);
    const b = new Survival(createSurvival(), DIFFICULTY.normal);
    for (let i = 0; i < 600; i++) {
      a.update(1, calm);
      b.update(1, calm);
    }
    expect(a.d.water).toBeGreaterThan(b.d.water);
    expect(a.damage(20, 0, 'bite')).toBeLessThan(b.damage(20, 0, 'bite'));
  });
  it('bites cause bleeding that bandages stop', () => {
    const s = new Survival(createSurvival(), DIFFICULTY.normal);
    s.damage(30, 0, 'bite');
    expect(s.d.bleeding).toBeGreaterThan(0);
    s.treat(15, true);
    expect(s.d.bleeding).toBe(0);
  });
});
