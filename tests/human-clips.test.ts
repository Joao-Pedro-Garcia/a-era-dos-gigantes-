import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import { blendPose, clipDuration, clipImpact, newPose, sampleClip, setHumanClips } from '../src/player/humanClips';
import { BONE_NAMES } from '../src/player/humanModel';

const data = JSON.parse(fs.readFileSync('public/anim/human.json', 'utf8'));

describe('motion-captured survivor clips', () => {
  setHumanClips(data);
  it('covers every animated bone and the clips the game plays', () => {
    expect([...data.bones].sort()).toEqual(BONE_NAMES.filter((b) => b !== 'root').sort());
    for (const id of ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Jump_Loop', 'Jump_Land', 'Punch_Jab', 'Punch_Cross']) expect(clipDuration(id as never)).toBeGreaterThan(0.2);
    expect(data.source).toMatch(/CC0/);
  });

  it('samples unit quaternions and blends without freezing when out aliases the first pose', () => {
    const a = newPose();
    const b = newPose();
    sampleClip('Sprint_Loop', 0.3, true, a);
    sampleClip('Sprint_Loop', 0.7, true, b);
    for (const q of a.rot.values()) expect(Math.abs(q.length() - 1)).toBeLessThan(1e-3);
    const thigh0 = a.rot.get('thigh.L')!.clone();
    blendPose(a, b, 1, a);
    expect(a.rot.get('thigh.L')!.angleTo(thigh0)).toBeGreaterThan(1); // the thigh swings from back to front
  });

  it('the punches land with the hand reaching forward at the marked impact', () => {
    expect(clipImpact('Punch_Jab')).toBeGreaterThan(0.1);
    expect(clipImpact('Punch_Cross')).toBeLessThan(0.7);
    const p = newPose();
    sampleClip('Punch_Cross', clipImpact('Punch_Cross'), false, p);
    // Elbow nearly straight at the hit.
    expect(p.rot.get('foreArm.R')!.angleTo(new THREE.Quaternion())).toBeLessThan(0.9);
  });
});
