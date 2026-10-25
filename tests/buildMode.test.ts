import { describe, expect, it } from 'vitest';
import { Building, GRID, PIECES, type PieceType } from '../src/building/building';
import { BUILD_STEPS, BuildController, HoldRepeat } from '../src/building/buildMode';
import { Inventory } from '../src/inventory/inventory';
import { BUILD_CATEGORIES } from '../src/ui/buildScreen';
import { CollisionWorld } from '../src/world/collision';

const flat = (h = 5) => ({ height: () => h, waterLevel: 0, collision: new CollisionWorld() });
const rich = () => {
  const inv = new Inventory();
  for (let i = 0; i < 6; i++) for (const id of ['wood', 'stone', 'fiber']) inv.add(id, 50);
  return inv;
};

describe('build screen placement controller', () => {
  it('follows the aim until the first adjustment, then stays where it was put', () => {
    const c = new BuildController();
    c.select('campfire');
    expect(c.target(3, 4, 0)).toEqual({ x: 3, z: 4, rot: 0 });
    c.nudge('forward', { x: 3, z: 4 }, 0);
    const a = c.target(99, 99, 1.2); // the player turned and aims elsewhere
    expect(a.x).toBeCloseTo(3, 6);
    expect(a.z).toBeCloseTo(4 + BUILD_STEPS.normal.move, 6);
    // Rotation became absolute: turning the view does not turn the piece.
    expect(c.target(0, 0, 2).rot).toBe(a.rot);
  });

  it('moves relative to the camera in all four directions with the chosen precision', () => {
    const c = new BuildController();
    c.select('campfire');
    c.snap = false;
    c.step = 'fine';
    const yaw = Math.PI / 2; // looking along +x
    const cur = { x: 0, z: 0 };
    c.nudge('forward', cur, yaw);
    expect(c.anchor!.x).toBeCloseTo(0.1, 6);
    c.nudge('right', cur, yaw);
    expect(c.anchor!.z).toBeCloseTo(0.1, 6);
    c.nudge('left', cur, yaw, 2);
    expect(c.anchor!.z).toBeCloseTo(-0.1, 6);
    c.step = 'fast';
    c.nudge('back', cur, yaw);
    expect(c.anchor!.x).toBeCloseTo(-1.9, 6);
  });

  it('moves snapped foundations a whole grid cell at a time', () => {
    const c = new BuildController();
    c.select('foundation');
    c.step = 'fine';
    expect(c.moveStep()).toBe(GRID);
    c.snap = false;
    expect(c.moveStep()).toBeCloseTo(0.1, 6);
  });

  it('raises and lowers without moving horizontally, within limits', () => {
    const c = new BuildController();
    c.select('storage');
    c.raise(1, { x: 2, z: 2 }, 0, 3);
    expect(c.lift).toBeCloseTo(0.75, 6);
    expect(c.target(50, 50, 0)).toMatchObject({ x: 2, z: 2 });
    c.step = 'fast';
    c.raise(-1, { x: 2, z: 2 }, 0, 50);
    expect(c.lift).toBe(-3);
  });

  it('rotates by 90° when snapping, by the precision step otherwise, and resets', () => {
    const c = new BuildController();
    c.select('wall');
    c.rotate(1);
    expect(c.rot).toBeCloseTo(Math.PI / 2, 6);
    c.snap = false;
    c.step = 'fine';
    c.rotate(-1, 2);
    expect(c.rot).toBeCloseTo(Math.PI / 2 - (10 * Math.PI) / 180, 6);
    c.resetRotation();
    expect(c.rot).toBe(0);
  });

  it('cancel and placement release the preview; cancelling deselects', () => {
    const c = new BuildController();
    c.select('bed');
    c.nudge('left', { x: 0, z: 0 }, 0);
    c.raise(1, { x: 0, z: 0 }, 0);
    c.placed();
    expect(c.anchor).toBeNull();
    expect(c.lift).toBe(0);
    expect(c.selected).toBe('bed');
    c.cancel();
    expect(c.selected).toBeNull();
  });

  it('ignores adjustments while nothing is selected', () => {
    const c = new BuildController();
    c.nudge('forward', { x: 0, z: 0 }, 0);
    c.raise(1, { x: 0, z: 0 }, 0);
    c.rotate(1);
    expect(c.anchor).toBeNull();
    expect(c.lift).toBe(0);
    expect(c.rot).toBe(0);
  });
});

describe('press-and-hold repetition', () => {
  it('one step on the press, then a steady stream after the delay, capped per frame', () => {
    const r = new HoldRepeat();
    expect(r.steps('a', true, true, 0.016)).toBe(1);
    let n = 0;
    for (let i = 0; i < 20; i++) n += r.steps('a', false, true, 0.016); // 0.32 s: still in the delay
    expect(n).toBe(0);
    for (let i = 0; i < 44; i++) n += r.steps('a', false, true, 0.016); // ~0.7 s more
    expect(n).toBeGreaterThanOrEqual(9);
    expect(n).toBeLessThanOrEqual(11);
    expect(r.steps('a', false, true, 5)).toBeLessThanOrEqual(5); // a long hitch never jumps far
    expect(r.steps('a', false, false, 0.016)).toBe(0); // released
    expect(r.steps('a', false, true, 1)).toBe(0); // holding again without a new press does nothing
  });
});

describe('raising and lowering pieces (validation)', () => {
  it('facilities may not float or be buried', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    expect(b.preview('storage', 1, 1, 0, false, env, 0, 0, 0).valid).toBe(true);
    expect(b.preview('storage', 1, 1, 0, false, env, 0, 0, 0.6).reason).toBe('floating');
    expect(b.preview('storage', 1, 1, 0, false, env, 0, 0, -1).reason).toBe('buried');
    expect(b.preview('storage', 1, 1, 0, false, env, 0, 0, -0.2).valid).toBe(true);
  });

  it('foundations can be raised while their skirt reaches the ground', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const base = b.preview('foundation', 0, 0, 0, true, env, 0, 0);
    const up = b.preview('foundation', 0, 0, 0, true, env, 0, 0, 1.5);
    expect(up.valid).toBe(true);
    expect(up.y).toBeCloseTo(base.y + 1.5, 6);
    expect(b.preview('foundation', 0, 0, 0, true, env, 0, 0, 3).reason).toBe('floating');
    expect(b.preview('foundation', 0, 0, 0, true, env, 0, 0, -1).reason).toBe('buried');
  });

  it('walls on a foundation keep their support height', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const inv = rich();
    const f = b.place(b.preview('foundation', 0, 0, 0, true, env, 0, 0), inv)!;
    expect(b.preview('wall', f.x + 1.9, f.z, 0, true, env, 0, 0).valid).toBe(true);
    expect(b.preview('wall', f.x + 1.9, f.z, 0, true, env, 0, 0, 1).reason).toBe('support');
  });

  it('the placed piece is exactly the validated preview, and materials are taken once', () => {
    const env = flat();
    const b = new Building({ pieces: [], nextId: 1 }, env.collision);
    const inv = rich();
    const wood = inv.count('wood');
    const pl = b.preview('foundation', 0, 0, 0, true, env, 0, 0, 1);
    const p = b.place(pl, inv)!;
    expect([p.x, p.y, p.z, p.rot]).toEqual([pl.x, pl.y, pl.z, pl.rot]);
    expect(inv.count('wood')).toBe(wood - PIECES.foundation.cost.wood!);
    // The same spot again is rejected (no duplicates from a double click).
    expect(b.preview('foundation', 0, 0, 0, true, env, 0, 0, 1).reason).toBe('overlap');
  });
});

describe('build catalogue', () => {
  it('lists every piece in exactly one category', () => {
    const all = BUILD_CATEGORIES.flatMap((c) => c.pieces);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual((Object.keys(PIECES) as PieceType[]).sort());
  });

  it('snap step helper', () => {
    expect(Building.snapStep('platform', true)).toBe(GRID);
    expect(Building.snapStep('campfire', true)).toBe(0);
    expect(Building.snapStep('foundation', false)).toBe(0);
  });
});
