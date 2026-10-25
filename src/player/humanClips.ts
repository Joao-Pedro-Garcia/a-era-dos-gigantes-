import * as THREE from 'three';
import type { BoneName } from './humanModel';

/**
 * Motion-captured clips for the survivor (Universal Animation Library by
 * Quaternius, CC0), retargeted offline onto the game skeleton by
 * tools/human-retarget.mjs: per clip, local rotations of the 19 bones and the
 * pelvis offset, sampled at 30 fps. Poses are sampled and blended here and
 * applied by PlayerView (procedural layers — aiming, tool swings, terrain,
 * reactions — still go on top).
 */
export type ClipId = 'Idle_Loop' | 'Walk_Loop' | 'Jog_Fwd_Loop' | 'Sprint_Loop' | 'Crouch_Idle_Loop' | 'Crouch_Fwd_Loop' | 'Jump_Start' | 'Jump_Loop' | 'Jump_Land' | 'Punch_Jab' | 'Punch_Cross' | 'Hit_Chest' | 'Roll' | 'Swim_Fwd_Loop' | 'Swim_Idle_Loop' | 'Death01';

interface ClipData {
  dur: number;
  frames: number;
  /** Punches: normalized time of the hit and the striking hand. */
  impact?: number;
  hand?: 'L' | 'R';
  hips: number[];
  rot: Record<string, number[]>;
}
interface ClipFile {
  fps: number;
  bones: BoneName[];
  clips: Record<string, ClipData>;
}

export interface Pose {
  hips: THREE.Vector3;
  rot: Map<BoneName, THREE.Quaternion>;
}

let data: ClipFile | null = null;
let loading: Promise<boolean> | null = null;
let failed = false;

/** Loads the clip file once (false when missing: the procedural animation is used). */
export function loadHumanClips(url = './anim/human.json'): Promise<boolean> {
  loading ??= fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: ClipFile | null) => {
      if (!j?.clips || !Array.isArray(j.bones)) return (failed = true), false;
      data = j;
      return true;
    })
    .catch(() => ((failed = true), false));
  return loading;
}

/** Load state of the clip file, for the menu. */
export function clipsState(): 'loaded' | 'loading' | 'failed' {
  return data ? 'loaded' : failed || !loading ? 'failed' : 'loading';
}

export function clipsReady(): boolean {
  return data !== null;
}

/** For tests and tools: install already-parsed clip data. */
export function setHumanClips(j: ClipFile | null): void {
  data = j;
}

export function clipImpact(id: ClipId): number {
  return data?.clips[id]?.impact ?? 0.35;
}

export function clipDuration(id: ClipId): number {
  return data?.clips[id]?.dur ?? 0;
}

export function newPose(): Pose {
  const rot = new Map<BoneName, THREE.Quaternion>();
  for (const b of data?.bones ?? []) rot.set(b, new THREE.Quaternion());
  return { hips: new THREE.Vector3(), rot };
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();

/**
 * Samples a clip at normalized time u (0..1; wrapped when `loop`) into `out`.
 * Returns false if the clip is not available.
 */
export function sampleClip(id: ClipId, u: number, loop: boolean, out: Pose): boolean {
  const c = data?.clips[id];
  if (!c || !data) return false;
  const n = c.frames;
  const x = loop ? (((u % 1) + 1) % 1) * (n - 1) : Math.min(1, Math.max(0, u)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const a = x - i;
  for (const b of data.bones) {
    const r = c.rot[b];
    const q = out.rot.get(b);
    if (!r || !q) continue;
    qa.fromArray(r, i * 4);
    qb.fromArray(r, (i + 1) * 4);
    q.copy(qa).slerp(qb, a);
  }
  const h = c.hips;
  out.hips.set(h[i * 3] + (h[i * 3 + 3] - h[i * 3]) * a, h[i * 3 + 1] + (h[i * 3 + 4] - h[i * 3 + 1]) * a, h[i * 3 + 2] + (h[i * 3 + 5] - h[i * 3 + 2]) * a);
  return true;
}

/** out = lerp(a, b, w) (slerp for rotations). `out` may be `a` but not `b`. */
export function blendPose(a: Pose, b: Pose, w: number, out: Pose): void {
  for (const [k, q] of out.rot) {
    const qa2 = a.rot.get(k);
    const qb2 = b.rot.get(k);
    if (qa2 && qb2) q.copy(qa2).slerp(qb2, w);
  }
  out.hips.copy(a.hips).lerp(b.hips, w);
}

export function copyPose(src: Pose, out: Pose): void {
  for (const [k, q] of out.rot) {
    const s = src.rot.get(k);
    if (s) q.copy(s);
  }
  out.hips.copy(src.hips);
}
