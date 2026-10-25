import { describe, expect, it } from 'vitest';
import { BONE_NAMES, HAND_GRIP, JOINTS } from '../src/player/humanModel';
import { parseManifest } from '../src/graphics/externalModels';
import manifest from '../public/models/manifest.json';

describe('survivor skeleton fitted to the artist body', () => {
  it('is left/right symmetric and anatomically ordered', () => {
    for (const b of BONE_NAMES) {
      if (!b.endsWith('.L')) continue;
      const r = JOINTS[b.replace('.L', '.R') as keyof typeof JOINTS];
      const l = JOINTS[b];
      expect(r[0]).toBeCloseTo(-l[0], 6);
      expect(r[1]).toBeCloseTo(l[1], 6);
      expect(r[2]).toBeCloseTo(l[2], 6);
    }
    const y = (b: keyof typeof JOINTS) => JOINTS[b][1];
    expect(y('head')).toBeGreaterThan(y('neck'));
    expect(y('neck')).toBeGreaterThan(y('chest'));
    expect(y('chest')).toBeGreaterThan(y('spine'));
    expect(y('thigh.L')).toBeGreaterThan(y('shin.L'));
    expect(y('shin.L')).toBeGreaterThan(y('foot.L'));
    expect(y('upperArm.L')).toBeGreaterThan(y('foreArm.L'));
    expect(y('foreArm.L')).toBeGreaterThan(y('hand.L'));
    // The grip sits inside the curled fingers, below the wrist.
    expect(HAND_GRIP[1]).toBeLessThan(-0.08);
    expect(Math.abs(HAND_GRIP[0])).toBeLessThan(0.03);
  });

  it('the manifest maps every artist bone of the survivor to a game bone', () => {
    const m = parseManifest(manifest);
    const rig = m.player?.rig;
    expect(rig).toBeTruthy();
    const targets = new Set(Object.values(rig!));
    for (const t of targets) expect(BONE_NAMES).toContain(t);
    // All the game bones that carry skin are used.
    for (const b of ['hips', 'spine', 'chest', 'neck', 'head', 'upperArm.L', 'foreArm.L', 'hand.L', 'thigh.R', 'shin.R', 'foot.R', 'toe.R']) expect(targets.has(b as never)).toBe(true);
    expect(m.player?.credit?.license).toBe('CC BY 4.0');
  });
});
