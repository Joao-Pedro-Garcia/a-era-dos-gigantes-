import * as THREE from 'three';
import { ACTIONS, type ActionKind, type CombatController } from '../combat/actions';
import { JOINTS, type BoneName } from './humanModel';

/**
 * Arm animation for actions, shared by the third-person body and the
 * first-person arms.
 *
 * Each action is described by a few hand keys in body space (metres; x =
 * the character's left, y = up, z = forward): where the grip is, which way
 * the handle leaves the fist (thumb side) and which way the knuckles / edge
 * face. Keys exist for the ready stance, the end of the wind-up, the impact
 * and the follow-through; the action phases interpolate between them with
 * easing, so the impact pose is reached exactly at the impact frame.
 * A two-bone IK then places the shoulder, elbow and wrist of the skinned
 * arm so the hand reaches the key, with the elbow pointing to a natural
 * side (pole vector).
 */
export type V3 = [number, number, number];
export interface HandKey {
  /** Grip position (body space). */
  p: V3;
  /** Handle direction (leaves the fist on the thumb side). */
  h: V3;
  /** Knuckle / edge direction. */
  f: V3;
  /** Elbow direction (optional). */
  pole?: V3;
}
export interface ArmPose {
  R: HandKey | null;
  L: HandKey | null;
  /** Upper-body twist (rad, + turns the chest left) and forward lean. */
  twist: number;
  lean: number;
}

interface KeySet {
  ready: HandKey;
  windup: HandKey;
  impact: HandKey;
  follow: HandKey;
  /** Twist at wind-up and impact. */
  tw: [number, number];
}

const K = (p: V3, h: V3, f: V3, pole?: V3): HandKey => ({ p, h, f, pole });

/** Keys for the right hand (the left hand of a punch combo is mirrored). */
const KEYS: Record<Exclude<ActionKind, 'bow'>, KeySet> = {
  punch: {
    ready: K([-0.16, 1.24, 0.24], [0.3, 1, 0], [0, 0.35, 1], [-0.6, -1, -0.2]),
    windup: K([-0.2, 1.3, 0.08], [0.45, 1, 0], [0, 0.2, 1], [-0.9, -0.8, -0.3]),
    impact: K([-0.05, 1.42, 0.6], [1, 0.25, 0], [0, 0, 1], [-1, -0.3, 0]),
    follow: K([-0.06, 1.4, 0.54], [1, 0.3, 0], [0, 0.05, 1], [-1, -0.5, 0]),
    tw: [-0.25, 0.3],
  },
  chop: {
    ready: K([-0.22, 1.08, 0.3], [0.05, 0.75, 0.65], [0.1, -0.3, 1], [-0.6, -1, -0.4]),
    windup: K([-0.36, 1.58, 0.02], [-0.35, 0.55, -0.75], [0.3, 0.75, 0.2], [-1, 0.2, -0.3]),
    impact: K([-0.06, 1.2, 0.46], [0.4, -0.05, 0.92], [0.9, -0.2, -0.35], [-0.8, -0.6, 0]),
    follow: K([0.1, 1.04, 0.38], [0.75, -0.3, 0.55], [0.55, -0.5, -0.7], [-0.5, -1, 0]),
    tw: [-0.45, 0.4],
  },
  mine: {
    ready: K([-0.13, 1.08, 0.32], [0, 0.85, 0.5], [0, -0.45, 1], [-0.7, -1, -0.3]),
    windup: K([-0.07, 1.74, 0.02], [0, 0.15, -1], [0, 1, 0.1], [-1, 0.4, -0.2]),
    impact: K([-0.05, 1.0, 0.5], [0, -0.5, 0.86], [0, -0.86, -0.5], [-0.8, -0.6, 0]),
    follow: K([-0.05, 0.92, 0.46], [0, -0.7, 0.7], [0, -0.7, -0.7], [-0.8, -0.7, 0]),
    tw: [-0.15, 0.1],
  },
  slash: {
    ready: K([-0.2, 1.16, 0.3], [0, 0.6, 0.8], [0.9, 0, -0.3], [-0.6, -1, -0.3]),
    windup: K([-0.38, 1.34, 0.14], [-0.4, 0.6, 0.6], [1, 0, 0.3], [-1, -0.4, -0.2]),
    impact: K([0.0, 1.26, 0.5], [0.55, 0.2, 0.8], [0.8, 0, -0.55], [-0.8, -0.6, 0]),
    follow: K([0.16, 1.16, 0.38], [0.8, 0.1, 0.5], [0.5, 0, -0.85], [-0.6, -0.8, 0]),
    tw: [-0.35, 0.35],
  },
  thrust: {
    ready: K([-0.19, 1.08, -0.04], [0.14, 0.14, 1], [0, 1, 0], [-0.6, -1, -0.6]),
    windup: K([-0.22, 1.16, -0.2], [0.12, 0.08, 1], [0, 1, 0], [-0.7, -1, -0.7]),
    // Two hands on the shaft: the rear (right) hand drives it from the hip past the chest.
    impact: K([-0.06, 1.22, 0.16], [0.1, 0.03, 1], [0, 1, 0], [-0.8, -1, -0.3]),
    follow: K([-0.05, 1.22, 0.19], [0.1, 0.02, 1], [0, 1, 0], [-0.8, -1, -0.3]),
    tw: [-0.3, 0.25],
  },
  bash: {
    ready: K([-0.22, 1.12, 0.3], [0, 0.85, 0.5], [0, -0.5, 1], [-0.6, -1, -0.4]),
    windup: K([-0.26, 1.64, -0.04], [0, 0.35, -0.94], [0, 0.94, 0.35], [-1, 0.2, -0.2]),
    impact: K([-0.1, 1.16, 0.5], [0, 0.02, 1], [0, -1, 0.02], [-0.8, -0.6, 0]),
    follow: K([-0.06, 0.98, 0.42], [0, -0.5, 0.86], [0, -0.86, -0.5], [-0.8, -0.8, 0]),
    tw: [-0.3, 0.3],
  },
  use: {
    ready: K([-0.22, 1.06, 0.26], [0, 0.35, 1], [0.6, -0.8, 0], [-0.6, -1, -0.4]),
    windup: K([-0.12, 1.4, 0.34], [0, 0.6, 0.8], [0.6, -0.6, 0.3], [-0.8, -1, -0.2]),
    impact: K([-0.04, 1.6, 0.22], [0, 0.05, 1], [1, -0.1, 0], [-0.9, -0.8, 0]),
    follow: K([-0.04, 1.6, 0.22], [0, 0.05, 1], [1, -0.1, 0], [-0.9, -0.8, 0]),
    tw: [0, 0],
  },
  drink: {
    ready: K([-0.22, 1.06, 0.26], [0, 0.35, 1], [0.6, -0.8, 0], [-0.6, -1, -0.4]),
    windup: K([-0.08, 1.45, 0.2], [0.2, 0.8, 0.2], [0.8, 0, -0.5], [-0.8, -1, 0]),
    impact: K([-0.02, 1.6, 0.14], [0.2, 0.3, -0.9], [1, 0, 0.2], [-0.9, -0.6, 0]),
    follow: K([-0.02, 1.6, 0.14], [0.2, 0.3, -0.9], [1, 0, 0.2], [-0.9, -0.6, 0]),
    tw: [0, 0],
  },
};

/** Left-hand guard while the right hand works with a one-handed item. */
const GUARD_L = K([0.2, 1.08, 0.2], [-0.3, 1, 0.2], [0, 0.2, 1], [0.6, -1, -0.4]);
/** Bow: left (bow) hand keys and the right hand's anchor. */
const BOW_READY_L = K([0.18, 1.08, 0.3], [-0.35, 0.8, 0.45], [0, -0.3, 1], [0.6, -1, -0.3]);
const BOW_AIM_L = K([0.03, 1.47, 0.6], [-0.18, 1, 0], [0, 0, 1], [1, -0.6, 0]);
/** First person: the bow sits just under the crosshair so the arrow points into the view. */
/** First-person draw length factor (the drawing hand would otherwise touch the camera). */
export const FP_DRAW = 0.45;
const BOW_AIM_L_FP = K([0.05, 1.38, 0.6], [-0.18, 1, 0], [0, 0, 1], [1, -0.6, 0]);

const mirror = (k: HandKey): HandKey => ({
  p: [-k.p[0], k.p[1], k.p[2]],
  h: [-k.h[0], k.h[1], k.h[2]],
  f: [-k.f[0], k.f[1], k.f[2]],
  pole: k.pole ? [-k.pole[0], k.pole[1], k.pole[2]] : undefined,
});

function lerpV(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function lerpKey(a: HandKey, b: HandKey, t: number): HandKey {
  const pa = a.pole ?? [0, -1, 0];
  const pb = b.pole ?? [0, -1, 0];
  return { p: lerpV(a.p, b.p, t), h: lerpV(a.h, b.h, t), f: lerpV(a.f, b.f, t), pole: lerpV(pa, pb, t) };
}

const easeInOut = (t: number) => t * t * (3 - 2 * t);
const easeIn = (t: number) => t * t;
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/** Second hand on a two-handed handle, `along` metres from the first along the handle. */
function secondHand(r: HandKey, along: number): HandKey {
  const h = new THREE.Vector3(...r.h).normalize();
  return { p: [r.p[0] + h.x * along, r.p[1] + h.y * along, r.p[2] + h.z * along], h: r.h, f: r.f, pole: [0.7, -1, -0.2] };
}

/**
 * The arm pose for the current action state.
 * @param holding action kind of the item in the hands (null = bare hands at rest)
 * @param fp first-person (keeps the ready stance in view)
 */
export function actionPose(c: CombatController, holding: ActionKind | null, fp: boolean): ArmPose {
  const active = c.phase === 'windup' || c.phase === 'strike' || c.phase === 'recover' || c.phase === 'draw' || c.phase === 'release';
  const kind: ActionKind | null = active ? c.def.kind : holding;
  const out: ArmPose = { R: null, L: null, twist: 0, lean: 0 };
  if (!kind) return out;

  if (kind === 'bow') {
    let l = BOW_READY_L;
    let rp: V3 | null = null;
    let aim = 0;
    if (active) {
      const p = c.progress;
      aim = c.phase === 'windup' ? easeInOut(p) : c.phase === 'recover' ? 1 - easeInOut(p) : 1;
      l = lerpKey(BOW_READY_L, fp ? BOW_AIM_L_FP : BOW_AIM_L, aim);
      // Fatigue shake after holding full draw for a while.
      if (c.aimTime > 2.5) {
        const s = Math.min(1, (c.aimTime - 2.5) / 3) * 0.006;
        const t = c.aimTime * 31;
        l = { ...l, p: [l.p[0] + Math.sin(t) * s, l.p[1] + Math.cos(t * 1.3) * s, l.p[2]] };
      }
      // Right hand on the string: the nock lies behind the grip along the bow's
      // back (−knuckle direction of the bow hand), at brace height + the draw.
      const f = new THREE.Vector3(...l.f).normalize();
      const pull = c.phase === 'release' || c.phase === 'recover' ? 0 : c.draw;
      // In first person the draw is shortened so the drawing hand stays in front of the camera.
      const back = 0.09 + 0.52 * pull * (fp ? FP_DRAW : 1);
      rp = [l.p[0] - f.x * back - 0.005, l.p[1] - f.y * back + 0.01, l.p[2] - f.z * back];
      // After the release the hand flies back past the anchor and drops a little.
      if (c.phase === 'release') {
        const t = easeOut(c.progress);
        const full = 0.09 + 0.52 * (fp ? FP_DRAW : 1);
        rp = [l.p[0] - f.x * full - 0.06 * t, l.p[1] - f.y * full - 0.03 * t, l.p[2] - f.z * (full + (fp ? 0.02 : 0.08) * t)];
      }
    }
    out.L = l;
    out.R = rp ? K(rp, [0, 1, 0], [0.3, 0, 1], [-1, -0.2, -0.4]) : null;
    out.twist = aim * 0.5;
    if (fp && !active) out.L = lerpKey(BOW_READY_L, K([0.12, 1.25, 0.38], [-0.35, 0.85, 0.3], [0, -0.3, 1], [0.6, -1, -0.3]), 1);
    return out;
  }

  const base = KEYS[kind];
  // First person: the ready stance is held higher so the hands and the item stay in view.
  // Wind-ups above the head are kept forward of the camera (the raised tool shows at the top of the view).
  const ks = fp
    ? {
        ...base,
        ready: kind === 'punch' ? base.ready : { ...base.ready, p: [base.ready.p[0] * 0.9, base.ready.p[1] + 0.15, base.ready.p[2] + 0.06] as V3 },
        windup: { ...base.windup, p: [base.windup.p[0], Math.min(base.windup.p[1], 1.55), Math.max(base.windup.p[2], 0) + 0.3] as V3 },
      }
    : base;
  let r: HandKey;
  let tw = 0;
  const p = c.progress;
  if (!active) r = ks.ready;
  else if (c.phase === 'windup') {
    r = lerpKey(ks.ready, ks.windup, easeInOut(p));
    tw = ks.tw[0] * easeInOut(p);
  } else if (c.phase === 'strike') {
    const ia = ACTIONS[kind].impactAt;
    if (p < ia) {
      const t = easeIn(p / ia);
      r = lerpKey(ks.windup, ks.impact, t);
      tw = ks.tw[0] + (ks.tw[1] - ks.tw[0]) * t;
    } else {
      r = lerpKey(ks.impact, ks.follow, easeOut((p - ia) / (1 - ia)));
      tw = ks.tw[1];
    }
  } else {
    r = lerpKey(ks.follow, ks.ready, easeInOut(p));
    tw = ks.tw[1] * (1 - easeInOut(p));
  }
  const two = kind === 'mine' || kind === 'thrust';
  // First person: the spear is angled from the lower right toward the crosshair, so both
  // hands and the shaft read clearly instead of being seen end-on.
  if (fp && kind === 'thrust') r = { ...r, h: [r.h[0] + 0.3, r.h[1] + 0.12, r.h[2]] };
  if (kind === 'punch') {
    const guard = ks.ready;
    if (c.hand === 'L' && active) {
      out.L = mirror(r);
      out.R = guard;
      tw = -tw;
    } else {
      out.R = r;
      out.L = mirror(guard);
    }
    if (!active && !fp) {
      out.R = null; // relaxed arms when not fighting (third person)
      out.L = null;
    }
  } else {
    out.R = r;
    out.L = two ? secondHand(r, kind === 'thrust' ? 0.36 : -0.2) : active && kind !== 'use' && kind !== 'drink' ? GUARD_L : null;
  }
  out.twist = tw;
  out.lean = kind === 'thrust' && active ? 0.08 : 0;
  return out;
}

/** Applies the equip lowering to a pose: hands drop out of view (FP) or to the hip (TP). */
export function lowerPose(pose: ArmPose, lowered: number, fp: boolean): ArmPose {
  if (lowered <= 0) return pose;
  const d: V3 = fp ? [0, -0.42 * lowered, -0.12 * lowered] : [0, -0.28 * lowered, -0.18 * lowered];
  const tilt = (k: HandKey | null): HandKey | null =>
    k && { ...k, p: [k.p[0] + d[0], k.p[1] + d[1], k.p[2] + d[2]], h: lerpV(k.h, [0, 0.2, 1], lowered * 0.7) };
  return { ...pose, R: tilt(pose.R), L: tilt(pose.L) };
}

// ------------------------------------------------------------------ IK

const S0 = { L: new THREE.Vector3(...JOINTS['upperArm.L']), R: new THREE.Vector3(...JOINTS['upperArm.R']) };
const E0 = { L: new THREE.Vector3(...JOINTS['foreArm.L']), R: new THREE.Vector3(...JOINTS['foreArm.R']) };
const W0 = { L: new THREE.Vector3(...JOINTS['hand.L']), R: new THREE.Vector3(...JOINTS['hand.R']) };
export const UPPER_LEN = S0.L.distanceTo(E0.L);
export const FORE_LEN = E0.L.distanceTo(W0.L);
/** Grip point inside the hand (hand bone frame, rest pose): matches itemModels.attachToHand. */
const GRIP = { L: new THREE.Vector3(-0.02, -0.09, 0), R: new THREE.Vector3(0.02, -0.09, 0) };

function frame(x: THREE.Vector3, yHint: THREE.Vector3): THREE.Matrix4 {
  const X = x.clone().normalize();
  const Z = new THREE.Vector3().crossVectors(X, yHint);
  if (Z.lengthSq() < 1e-8) Z.set(1, 0, 0).cross(X);
  Z.normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X);
  return new THREE.Matrix4().makeBasis(X, Y, Z);
}

const BACK = new THREE.Vector3(0, 0, -1);
const REST_UPPER = { L: frame(E0.L.clone().sub(S0.L), BACK), R: frame(E0.R.clone().sub(S0.R), BACK) };
const REST_FORE = { L: frame(W0.L.clone().sub(E0.L), BACK), R: frame(W0.R.clone().sub(E0.R), BACK) };

const tq = new THREE.Quaternion();
const tq2 = new THREE.Quaternion();
const tm = new THREE.Matrix4();

/** Rotation (mesh space) of a hand whose fingers point along `f` and thumb along `h`. */
function handRotation(k: HandKey, out: THREE.Quaternion): THREE.Quaternion {
  const f = new THREE.Vector3(...k.f).normalize();
  const h = new THREE.Vector3(...k.h);
  h.addScaledVector(f, -h.dot(f));
  if (h.lengthSq() < 1e-6) h.set(0, 1, 0);
  h.normalize();
  const y = f.clone().negate(); // rest: fingers along −Y
  const x = new THREE.Vector3().crossVectors(y, h);
  return out.setFromRotationMatrix(tm.makeBasis(x, y, h));
}

/**
 * Rotates `bone` (whose rest orientation in mesh space is identity) so its
 * orientation in mesh space becomes `q`, given the parent's current mesh-space rotation.
 */
function setMeshRotation(bone: THREE.Bone, parentMeshQ: THREE.Quaternion, q: THREE.Quaternion, weight: number): void {
  tq2.copy(parentMeshQ).invert().multiply(q);
  if (weight >= 1) bone.quaternion.copy(tq2);
  else bone.quaternion.slerp(tq2, weight);
}

function meshQuat(o: THREE.Object3D, meshInvQ: THREE.Quaternion, out: THREE.Quaternion): THREE.Quaternion {
  o.getWorldQuaternion(out);
  return out.premultiply(meshInvQ);
}

/**
 * Solves one arm so the grip reaches `k` (mesh space), blending with the
 * current (animated) bone rotations by `weight`.
 */
export function solveArm(mesh: THREE.Object3D, bones: Record<BoneName, THREE.Bone>, side: 'L' | 'R', k: HandKey, weight: number): void {
  if (weight <= 0.001) return;
  const upper = bones[`upperArm.${side}`];
  const fore = bones[`foreArm.${side}`];
  const hand = bones[`hand.${side}`];
  const meshInvQ = mesh.getWorldQuaternion(new THREE.Quaternion()).invert();
  const meshInv = tm.copy(mesh.matrixWorld).invert();
  upper.parent!.updateWorldMatrix(true, false);
  upper.updateWorldMatrix(false, false);
  const S = upper.getWorldPosition(new THREE.Vector3()).applyMatrix4(meshInv);
  // The target is the grip; the wrist sits back from it by the grip offset rotated with the hand.
  const qh = handRotation(k, new THREE.Quaternion());
  const T = new THREE.Vector3(...k.p).sub(GRIP[side].clone().applyQuaternion(qh));
  const a = UPPER_LEN;
  const b = FORE_LEN;
  const st = T.clone().sub(S);
  let d = st.length();
  const dir = st.clone().divideScalar(Math.max(1e-5, d));
  d = THREE.MathUtils.clamp(d, Math.abs(a - b) + 0.02, (a + b) * 0.999);
  const along = (a * a - b * b + d * d) / (2 * d);
  const hgt = Math.sqrt(Math.max(0, a * a - along * along));
  const pole = new THREE.Vector3(...(k.pole ?? [side === 'L' ? 0.6 : -0.6, -1, -0.4]));
  const perp = pole.addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
  perp.normalize();
  const E = S.clone().addScaledVector(dir, along).addScaledVector(perp, hgt);
  const W = S.clone().addScaledVector(dir, d);

  // Upper arm.
  // Rest frames use "back" (−Z) as the elbow side; the desired elbow side is `perp`.
  const desiredU = frame(E.clone().sub(S), perp);
  const qU = new THREE.Quaternion().setFromRotationMatrix(desiredU.multiply(tm.copy(REST_UPPER[side]).transpose()));
  const parentQ = meshQuat(upper.parent!, meshInvQ, new THREE.Quaternion());
  setMeshRotation(upper, parentQ, qU, weight);
  upper.updateWorldMatrix(false, false);

  // Forearm: same hinge plane.
  const desiredF = frame(W.clone().sub(E), perp);
  const qF = new THREE.Quaternion().setFromRotationMatrix(desiredF.multiply(tm.copy(REST_FORE[side]).transpose()));
  setMeshRotation(fore, meshQuat(upper, meshInvQ, tq), qF, weight);
  fore.updateWorldMatrix(false, false);

  // Hand orientation.
  setMeshRotation(hand, meshQuat(fore, meshInvQ, tq), qh, weight);
  hand.updateWorldMatrix(false, false);
}

/** Rotates a key about the shoulder line (aiming up/down with the camera pitch in third person). */
export function pitchKey(k: HandKey | null, pitch: number): HandKey | null {
  if (!k || Math.abs(pitch) < 1e-4) return k;
  const q = tq.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -pitch);
  const c = new THREE.Vector3(0, 1.39, 0);
  const p = new THREE.Vector3(...k.p).sub(c).applyQuaternion(q).add(c);
  const h = new THREE.Vector3(...k.h).applyQuaternion(q);
  const f = new THREE.Vector3(...k.f).applyQuaternion(q);
  return { p: [p.x, p.y, p.z], h: [h.x, h.y, h.z], f: [f.x, f.y, f.z], pole: k.pole };
}
