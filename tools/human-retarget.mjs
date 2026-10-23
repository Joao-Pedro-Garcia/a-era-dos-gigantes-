// Retargets humanoid clips (Quaternius Universal Animation Library, CC0) onto the
// game's 20-bone survivor skeleton and writes compact rotation tracks:
//   node tools/human-retarget.mjs UAL1_Standard.glb public/anim/human.json
// Method: for every mapped bone, the clip's world-space rotation relative to the
// source bind pose (T-pose) is applied on top of a fixed correction that turns the
// game's rest bone (arms hanging) into the source's rest bone (arms out), keeping
// the forward axis. Local rotations follow from the parents' world rotations.
// Needs @gltf-transform/core (not a game dependency).
import { NodeIO } from '@gltf-transform/core';
import * as THREE from 'three';
import fs from 'node:fs';

const [src, dst] = process.argv.slice(2);
const FPS = 30;
const CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop', 'Jump_Start', 'Jump_Loop', 'Jump_Land', 'Punch_Jab', 'Punch_Cross', 'Hit_Chest', 'Roll', 'Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Death01'];

// Game skeleton (parsed from humanModel.ts so the two never drift apart).
const hm = fs.readFileSync(new URL('../src/player/humanModel.ts', import.meta.url), 'utf8');
const jointsSrc = hm.slice(hm.indexOf('export const JOINTS'), hm.indexOf('};', hm.indexOf('export const JOINTS')));
const J = {};
for (const m of jointsSrc.matchAll(/'?([\w.]+)'?: \[([-\d.e]+), ([-\d.e]+), ([-\d.e]+)\]/g)) J[m[1]] = new THREE.Vector3(+m[2], +m[3], +m[4]);
const PARENT = { root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', 'upperArm.L': 'chest', 'foreArm.L': 'upperArm.L', 'hand.L': 'foreArm.L', 'upperArm.R': 'chest', 'foreArm.R': 'upperArm.R', 'hand.R': 'foreArm.R', 'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L', 'toe.L': 'foot.L', 'thigh.R': 'hips', 'shin.R': 'thigh.R', 'foot.R': 'shin.R', 'toe.R': 'foot.R' };
// game bone ← [source bone, game child for the rest direction, source child, secondary axis]
const MAP = {
  hips: ['pelvis', 'spine', 'spine_01', 'z'],
  spine: ['spine_01', 'chest', 'spine_02', 'z'],
  chest: ['spine_03', 'neck', 'neck_01', 'z'],
  neck: ['neck_01', 'head', 'Head', 'z'],
  head: ['Head', null, null, 'z'],
};
for (const [s, u] of [['L', 'l'], ['R', 'r']]) {
  MAP[`upperArm.${s}`] = [`upperarm_${u}`, `foreArm.${s}`, `lowerarm_${u}`, 'z'];
  MAP[`foreArm.${s}`] = [`lowerarm_${u}`, `hand.${s}`, `hand_${u}`, 'z'];
  MAP[`hand.${s}`] = [`hand_${u}`, null, `middle_01_${u}`, 'z'];
  MAP[`thigh.${s}`] = [`thigh_${u}`, `shin.${s}`, `calf_${u}`, 'z'];
  MAP[`shin.${s}`] = [`calf_${u}`, `foot.${s}`, `foot_${u}`, 'z'];
  MAP[`foot.${s}`] = [`foot_${u}`, `toe.${s}`, `ball_${u}`, 'x'];
  MAP[`toe.${s}`] = [`ball_${u}`, null, null, 'x'];
}
// Game hand direction (no child bone): toward the knuckles, hanging down.
const HAND_DIR = new THREE.Vector3(0, -1, 0);

const doc = await new NodeIO().read(src);
const root = doc.getRoot();
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const byName = new Map(joints.map((j) => [j.getName(), j]));
const parentOf = new Map();
for (const j of joints) for (const c of j.listChildren()) parentOf.set(c, j);
const topJoints = joints.filter((j) => !parentOf.has(j));
// Static transform above the skeleton (armature node etc.).
const above = new Map(topJoints.map((j) => {
  const m = new THREE.Matrix4().fromArray(j.getWorldMatrix());
  const local = new THREE.Matrix4().compose(new THREE.Vector3(...j.getTranslation()), new THREE.Quaternion(...j.getRotation()), new THREE.Vector3(...j.getScale()));
  return [j, m.multiply(local.invert())];
}));

function sampleTrack(ch, t) {
  const s = ch.getSampler();
  const times = s.getInput().getArray();
  const vals = s.getOutput().getArray();
  const n = s.getOutput().getElementSize();
  if (t <= times[0]) return Array.from(vals.slice(0, n));
  if (t >= times[times.length - 1]) return Array.from(vals.slice((times.length - 1) * n, times.length * n));
  let i = 1;
  while (times[i] < t) i++;
  const a = (t - times[i - 1]) / (times[i] - times[i - 1]);
  const v0 = vals.slice((i - 1) * n, i * n);
  const v1 = vals.slice(i * n, (i + 1) * n);
  if (n === 4) return new THREE.Quaternion(...v0).slerp(new THREE.Quaternion(...v1), s.getInterpolation() === 'STEP' ? 0 : a).toArray();
  return Array.from(v0).map((x, k) => x + (v1[k] - x) * (s.getInterpolation() === 'STEP' ? 0 : a));
}

/** World rotations and positions of all source joints at time t (null anim → bind pose). */
function pose(anim, t) {
  const over = new Map();
  if (anim) for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode();
    if (!over.has(node)) over.set(node, {});
    over.get(node)[ch.getTargetPath()] = sampleTrack(ch, t);
  }
  const W = new Map();
  const visit = (j, parentM) => {
    const o = over.get(j) ?? {};
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...(o.translation ?? j.getTranslation())), new THREE.Quaternion(...(o.rotation ?? j.getRotation())), new THREE.Vector3(...(o.scale ?? j.getScale())));
    const m = parentM.clone().multiply(local);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    m.decompose(p, q, sc);
    W.set(j.getName(), { p, q, m });
    for (const c of j.listChildren()) if (byName.has(c.getName())) visit(c, m);
  };
  for (const j of topJoints) visit(j, above.get(j));
  return W;
}

function basis(f0, t0, f1, t1) {
  const mk = (f, t) => {
    const x = f.clone().normalize();
    const z = t.clone().sub(x.clone().multiplyScalar(t.dot(x))).normalize();
    const y = z.clone().cross(x);
    return new THREE.Matrix4().makeBasis(x, y, z);
  };
  const a = mk(f0, t0), b = mk(f1, t1);
  return new THREE.Quaternion().setFromRotationMatrix(b.multiply(a.transpose()));
}

const bind = pose(null, 0);
// Correction per bone: game rest direction → source rest direction (forward or lateral kept).
const R0 = {};
for (const [g, [sb, gc, sc, axis]] of Object.entries(MAP)) {
  const sec = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const gDir = gc ? J[gc].clone().sub(J[g]) : g.startsWith('hand') ? HAND_DIR.clone() : null;
  const sDir = sc ? bind.get(sc).p.clone().sub(bind.get(sb).p) : null;
  R0[g] = gDir && sDir ? basis(gDir, sec, sDir, sec) : new THREE.Quaternion();
}
// Hand: the source hand is flat (palm down) in the T-pose; the game's hangs with the thumb forward.
for (const s of ['L', 'R']) {
  const u = s.toLowerCase();
  const fingers = bind.get(`middle_01_${u}`).p.clone().sub(bind.get(`hand_${u}`).p);
  const thumbSide = bind.get(`index_01_${u}`).p.clone().sub(bind.get(`pinky_01_${u}`).p);
  R0[`hand.${s}`] = basis(HAND_DIR, new THREE.Vector3(0, 0, 1), fingers, thumbSide);
}
const legGame = J['thigh.L'].y - J['foot.L'].y;
const legSrc = bind.get('thigh_l').p.y - bind.get('foot_l').p.y;
const hipScale = legGame / legSrc;
const ORDER = Object.keys(PARENT).filter((b) => b !== 'root');

const out = { fps: FPS, source: 'Universal Animation Library (Quaternius, CC0)', bones: ORDER, clips: {} };
for (const name of CLIPS) {
  const anim = root.listAnimations().find((a) => a.getName() === name);
  if (!anim) { console.log('missing', name); continue; }
  let dur = 0;
  for (const ch of anim.listChannels()) { const t = ch.getSampler().getInput().getArray(); dur = Math.max(dur, t[t.length - 1]); }
  const frames = Math.max(2, Math.round(dur * FPS) + 1);
  const rot = Object.fromEntries(ORDER.map((b) => [b, []]));
  const hips = [];
  for (let f = 0; f < frames; f++) {
    const t = Math.min(dur, f / FPS);
    const P = pose(anim, t);
    const Wg = { root: new THREE.Quaternion() };
    for (const b of ORDER) {
      const [sb] = MAP[b];
      const D = P.get(sb).q.clone().multiply(bind.get(sb).q.clone().invert());
      Wg[b] = D.multiply(R0[b]);
      const local = Wg[PARENT[b]].clone().invert().multiply(Wg[b]);
      rot[b].push(...local.toArray().map((x) => +x.toFixed(4)));
    }
    const d = P.get('pelvis').p.clone().sub(bind.get('pelvis').p).multiplyScalar(hipScale);
    hips.push(+d.x.toFixed(4), +d.y.toFixed(4), +d.z.toFixed(4));
  }
  const clip = { dur: +dur.toFixed(4), frames, hips, rot };
  if (name.startsWith('Punch')) {
    // Impact: the frame where a hand reaches furthest forward of the pelvis.
    let best = { f: 0, hand: 'R', z: -1e9 };
    for (let f = 0; f < frames; f++) {
      const P = pose(anim, Math.min(dur, f / FPS));
      for (const [h, u] of [['L', 'l'], ['R', 'r']]) {
        const z = P.get(`hand_${u}`).p.z - P.get('pelvis').p.z;
        if (z > best.z) best = { f, hand: h, z };
      }
    }
    clip.impact = +(best.f / (frames - 1)).toFixed(3);
    clip.hand = best.hand;
  }
  out.clips[name] = clip;
  console.log(name, dur.toFixed(2), frames);
}
fs.writeFileSync(dst, JSON.stringify(out));
console.log('wrote', dst, fs.statSync(dst).size);
