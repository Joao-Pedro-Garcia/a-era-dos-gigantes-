import { describe, expect, it } from 'vitest';
import { Environment, createEnvState, type EnvEvent } from '../src/world/environment';
import { PLANNED_SITES, SPAWN, Terrain, VOLCANO } from '../src/world/terrain';
import { BIOMES } from '../src/world/biomes';
import { SPECIES } from '../src/animals/species';

describe('terrain', () => {
  const t = new Terrain(12345);
  it('is deterministic', () => {
    expect(new Terrain(12345).height(512.3, -77.1)).toBe(t.height(512.3, -77.1));
  });
  it('places the authored regions where planned', () => {
    expect(t.biomeAt(VOLCANO.x - 300, VOLCANO.z)).toBe('volcanic');
    expect(t.height(VOLCANO.x - 300, VOLCANO.z)).toBeGreaterThan(100);
    expect(t.biomeAt(2100, 2000)).toBe('swamp');
    expect(['jungle', 'ruins']).toContain(t.biomeAt(-2000, 1700));
    expect(t.biomeAt(0, 4900)).toBe('ocean');
    const north = t.temperatureBase(0, -3200, t.height(0, -3200));
    expect(north).toBeLessThan(5);
  });
  it('has dry, gentle ground at the spawn', () => {
    const s = t.findDryGround(SPAWN.x, SPAWN.z);
    expect(t.height(s.x, s.z)).toBeGreaterThan(1);
    expect(t.slope(s.x, s.z)).toBeLessThan(0.5);
  });
  it('levels authored sites onto dry, usable ground for any seed', () => {
    for (const seed of [12345, 1, 777, 4242]) {
      const tt = new Terrain(seed);
      for (const s of PLANNED_SITES) {
        expect(tt.height(s.x, s.z), `${seed}:${s.id}`).toBeGreaterThan(2);
        expect(tt.slope(s.x, s.z), `${seed}:${s.id}`).toBeLessThan(0.35);
        if (s.kind !== 'cave') expect(tt.biomeAt(s.x, s.z)).toBe('ruins');
      }
    }
  });
  it('only references existing species in biome fauna tables', () => {
    for (const b of Object.values(BIOMES)) for (const id of Object.keys(b.fauna)) expect(SPECIES[id], id).toBeDefined();
  });
});

describe('environment', () => {
  const terrain = new Terrain(1);
  it('produces the same weather sequence from the same seed', () => {
    const a = new Environment(createEnvState(7), terrain);
    const b = new Environment(createEnvState(7), terrain);
    const ea: EnvEvent[] = [];
    const eb: EnvEvent[] = [];
    for (let i = 0; i < 3000; i++) {
      a.update(5, 0, 0, ea);
      b.update(5, 0, 0, eb);
    }
    expect(ea).toEqual(eb);
    expect(ea.some((e) => e.type === 'weather')).toBe(true);
  });
  it('cycles day and night', () => {
    const e = new Environment(createEnvState(3), terrain);
    e.state.time = 1200 * 0.5;
    expect(e.isNight).toBe(false);
    e.state.time = 1200 * 0.02;
    expect(e.isNight).toBe(true);
  });
  it('extinguishes wildfires under heavy rain', () => {
    const e = new Environment(createEnvState(3), terrain);
    const ev: EnvEvent[] = [];
    e.startFire(300, 700, ev);
    expect(e.state.fires.length).toBe(1);
    e.state.weather = 'storm';
    e.state.intensity = 1;
    e.state.weatherUntil = 1e12;
    for (let i = 0; i < 200; i++) e.update(1, 0, 0, ev);
    expect(e.state.fires.length).toBe(0);
  });
  it('does not start fires in water or snow', () => {
    const e = new Environment(createEnvState(3), terrain);
    e.startFire(0, 4900, []);
    e.startFire(0, -3400, []);
    expect(e.state.fires.length).toBe(0);
  });
  it('schedules volcanic eruptions', () => {
    const e = new Environment(createEnvState(3), terrain);
    const ev: EnvEvent[] = [];
    e.state.time = e.state.nextEruptionAt - 1;
    e.update(2, 0, 0, ev);
    expect(e.eruptionActive).toBe(true);
    expect(ev.some((x) => x.type === 'eruption')).toBe(true);
  });
});
