import { describe, expect, it } from 'vitest';
import { CELL, Exploration, createExploration, fossilSite } from '../src/exploration/exploration';
import { Terrain } from '../src/world/terrain';

const terrain = new Terrain(3);

describe('exploration', () => {
  it('reveals cells around the player only once', () => {
    const e = new Exploration(createExploration(), terrain);
    let xp = 0;
    e.onReveal = (n) => (xp += n);
    const n1 = e.reveal(100, 100, 200);
    expect(n1).toBeGreaterThan(20);
    expect(e.reveal(100, 100, 200)).toBe(0);
    expect(xp).toBe(n1);
    expect(e.isExplored(100, 100)).toBe(true);
    expect(e.isExplored(3000, 3000)).toBe(false);
  });
  it('the spyglass cone reveals only in the looking direction', () => {
    const e = new Exploration(createExploration(), terrain);
    e.reveal(0, 0, 500, { yaw: 0, halfAngle: 0.25 });
    expect(e.isExplored(0, 400)).toBe(true);
    expect(e.isExplored(0, -400)).toBe(false);
  });
  it('round-trips through serialization', () => {
    const e = new Exploration(createExploration(), terrain);
    e.reveal(-800, 400, 150);
    e.toggleMarker(10, 10);
    const d = JSON.parse(JSON.stringify(e.serialize()));
    const e2 = new Exploration(d, terrain);
    expect(e2.isExplored(-800, 400)).toBe(true);
    expect(e2.exploredFraction()).toBeCloseTo(e.exploredFraction());
    expect(e2.d.markers.length).toBe(1);
  });
  it('markers toggle and trail stays bounded', () => {
    const e = new Exploration(createExploration(), terrain);
    expect(e.toggleMarker(500, 500)).toBe(true);
    expect(e.toggleMarker(520, 510)).toBe(false);
    for (let i = 0; i < 5000; i++) e.track(i * CELL, 0);
    expect(e.d.trail.length).toBeLessThanOrEqual(3000);
  });
  it('corrupted map data falls back to unexplored', () => {
    const e = new Exploration({ ...createExploration(), cells: '%%%not-base64%%%' }, terrain);
    expect(e.exploredFraction()).toBe(0);
  });
  it('fossil sites are deterministic and rare', () => {
    let count = 0;
    for (let x = -20; x < 20; x++)
      for (let z = -20; z < 20; z++) {
        const f = fossilSite(3, x, z, terrain);
        if (f) {
          count++;
          expect(fossilSite(3, x, z, terrain)).toEqual(f);
        }
      }
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(1600 * 0.1);
  });
});
