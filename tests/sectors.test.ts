import { describe, expect, it } from 'vitest';
import { QUALITY } from '../src/core/config';
import { CollisionWorld } from '../src/world/collision';
import { SectorManager } from '../src/world/sectors';
import { PLANNED_SITES, Terrain } from '../src/world/terrain';

const q = { ...QUALITY.low, loadRadius: 2, detailRadius: 1 };

describe('sector streaming', () => {
  const terrain = new Terrain(12345);
  it('loads around the player and unloads without leaking colliders', () => {
    const col = new CollisionWorld();
    const sm = new SectorManager(terrain, col, 12345, {});
    sm.update(120, 700, q, 0, 1e9);
    // Circular load radius: the 5x5 square minus far corners.
    expect(sm.loadedCount).toBeGreaterThan(18);
    expect(sm.loadedCount).toBeLessThanOrEqual(25);
    const near = col.size;
    expect(near).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      sm.update(120 + 3000, 700, q, 0, 1e9);
      sm.update(120, 700, q, 0, 1e9);
    }
    expect(col.size).toBe(near);
    sm.dispose();
    expect(col.size).toBe(0);
    expect(sm.loadedCount).toBe(0);
  });
  it('harvested resources do not reappear when a sector reloads, and regrow later', () => {
    const col = new CollisionWorld();
    const harvested: Record<string, number> = {};
    const sm = new SectorManager(terrain, col, 12345, harvested);
    sm.update(120, 700, q, 0, 1e9);
    const node = sm.nodesNear(120, 700, 200).find((n) => n.kind === 'broadleaf' || n.kind === 'rock' || n.kind === 'bush')!;
    expect(node).toBeTruthy();
    while (!sm.hitNode(node, 0, 1));
    sm.update(5000, 5000, q, 0, 1e9);
    sm.update(120, 700, q, 0, 1e9);
    expect(sm.nodesNear(120, 700, 200).some((n) => n.id === node.id)).toBe(false);
    const later = harvested[node.id] + 1;
    sm.update(5000, 5000, q, later, 1e9);
    sm.update(120, 700, q, later, 1e9);
    expect(sm.nodesNear(120, 700, 200).some((n) => n.id === node.id)).toBe(true);
  });
  it('builds the authored mystery objects and cave interiors', () => {
    const col = new CollisionWorld();
    const sm = new SectorManager(terrain, col, 12345, {});
    const bunker = PLANNED_SITES.find((s) => s.id === 'ruin_volcano_bunker')!;
    sm.update(bunker.x, bunker.z, q, 0, 1e9);
    const its = sm.interactablesNear(bunker.x, bunker.z, 120);
    expect(its.some((i) => i.id === 'door:bunker')).toBe(true);
    expect(its.some((i) => i.id === 'pickup:calibration_core')).toBe(true);
    const cave = PLANNED_SITES.find((s) => s.kind === 'cave')!;
    sm.update(cave.x, cave.z, q, 0, 1e9);
    const nodes = sm.nodesNear(cave.x, cave.z, 30);
    expect(nodes.some((n) => n.kind === 'rubble')).toBe(true);
    expect(nodes.some((n) => n.kind === 'crystal')).toBe(true);
    expect(sm.interactablesNear(cave.x, cave.z, 30).some((i) => i.kind === 'cave_exit')).toBe(true);
  });
  it('an opened door stays open after reloading (persistent flag)', () => {
    const col = new CollisionWorld();
    const sm = new SectorManager(terrain, col, 12345, {});
    const bunker = PLANNED_SITES.find((s) => s.id === 'ruin_volcano_bunker')!;
    sm.update(bunker.x, bunker.z, q, 0, 1e9);
    const door = sm.interactablesNear(bunker.x, bunker.z, 120).find((i) => i.id === 'door:bunker')!;
    sm.openDoor(door, 'open:bunker');
    expect(col.get(door.colliderId!)).toBeUndefined();
    sm.update(0, 0, q, 0, 1e9);
    sm.update(bunker.x, bunker.z, q, 0, 1e9);
    expect(sm.interactablesNear(bunker.x, bunker.z, 120).some((i) => i.id === 'door:bunker')).toBe(false);
  });
});
