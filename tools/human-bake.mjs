// Re-poses a rigged human (A/T pose) into the game's rest pose: arms hanging with the
// thumbs forward, straight legs, hands closed in a grip. Writes the posed positions and
// normals as the new mesh (metres, Y up, +Z forward, feet on y=0) and prints the posed
// joint positions for the game skeleton.
// usage: node hbake.mjs src.glb dst.glb out.json
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import fs from 'node:fs';
const [src, dst, outJson] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const skin = doc.getRoot().listSkins()[0];
const joints = skin.listJoints();
const name = (j) => j.getName().replace(/^Character3_/, '').replace(/_\d+(_\d+)?$/, '');
const S = 0.0097;
// Eye cap size: 5.6 file units across → about 2.5 cm.
const EYE_SCALE = 0.54;
// Upper lid opening (rad) and reach (m) around the eyeball centre.
const LID_OPEN = 0.3;
const LID_R = 0.026;
const EYE_OFFSET = new THREE.Vector3(0, -0.0035, 0.0003);
const byName = new Map();
for (const j of joints) if (!byName.has(name(j))) byName.set(name(j), j);
const P = new Map(); // rest world (scaled)
const restW = new Map();
for (const j of joints) {
  const m = new THREE.Matrix4().fromArray(j.getWorldMatrix());
  restW.set(j, m);
  P.set(j, new THREE.Vector3().setFromMatrixPosition(m).multiplyScalar(S));
}
const p = (n) => P.get(byName.get(n)).clone();
const zc = p('Hips').z;
for (const v of P.values()) v.z -= zc;
// ---- targets (game rest pose)
const sideOf = (L) => (L ? 1 : -1);
const T = new Map();
const set = (n, v) => T.set(byName.get(n), v);
set('Hips', p('Hips'));
set('Spine', p('Spine'));
set('Spine1', p('Spine1'));
set('Neck', p('Neck'));
set('Head', p('Head'));
const upperLen = p('LeftArm').distanceTo(p('LeftForeArm'));
const foreLen = p('LeftForeArm').distanceTo(p('LeftHand'));
const thighLen = p('LeftUpLeg').distanceTo(p('LeftLeg'));
const shinLen = p('LeftLeg').distanceTo(p('LeftFoot'));
for (const L of [true, false]) {
  const s = sideOf(L);
  const pre = L ? 'Left' : 'Right';
  const sh = p(`${pre}Arm`);
  set(`${pre}Arm`, sh);
  const el = sh.clone().add(new THREE.Vector3(s * 0.035, -1, -0.03).normalize().multiplyScalar(upperLen));
  set(`${pre}ForeArm`, el);
  const wr = el.clone().add(new THREE.Vector3(s * 0.04, -1, 0.07).normalize().multiplyScalar(foreLen));
  set(`${pre}Hand`, wr);
  const hip = p(`${pre}UpLeg`);
  set(`${pre}UpLeg`, hip);
  const knee = hip.clone().add(new THREE.Vector3(s * 0.012, -1, 0.03).normalize().multiplyScalar(thighLen));
  set(`${pre}Leg`, knee);
  const ank = knee.clone().add(new THREE.Vector3(s * 0.012, -1, -0.07).normalize().multiplyScalar(shinLen));
  set(`${pre}Foot`, ank);
}
// ---- orientation targets: [joint, child for the primary axis, target primary dir, secondary (rest from, target to)]
const aimChild = {
  Hips: 'Spine', Spine: 'Spine1', Spine1: 'Neck', Neck: 'Head',
  LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', RightArm: 'RightForeArm', RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', RightUpLeg: 'RightLeg', RightLeg: 'RightFoot',
};
const fromTo = (a, b) => new THREE.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
function basis(f0, t0, f1, t1) {
  // Rotation taking the orthonormal frame (f0, t0) to (f1, t1).
  const mk = (f, t) => {
    const x = f.clone().normalize();
    const z = t.clone().sub(x.clone().multiplyScalar(t.dot(x))).normalize();
    const y = z.clone().cross(x);
    return new THREE.Matrix4().makeBasis(x, y, z);
  };
  const a = mk(f0, t0);
  const b = mk(f1, t1);
  return new THREE.Quaternion().setFromRotationMatrix(b.multiply(a.transpose()));
}
const D = new Map(); // world delta rotation
const Pn = new Map(); // posed position
const parentOf = new Map();
for (const j of joints) for (const c of j.listChildren()) if (joints.includes(c)) parentOf.set(c, j);
const order = [];
const visit = (j) => { order.push(j); for (const c of j.listChildren()) if (joints.includes(c)) visit(c); };
for (const j of joints) if (!parentOf.has(j)) visit(j);
const THUMB = [0.6, 0.8, 0.8];
for (const j of order) {
  const n = name(j);
  const par = parentOf.get(j);
  const dp = par ? D.get(par) : new THREE.Quaternion();
  if (T.has(j)) Pn.set(j, T.get(j).clone());
  else if (par) Pn.set(j, Pn.get(par).clone().add(P.get(j).clone().sub(P.get(par)).applyQuaternion(D.get(par))));
  else Pn.set(j, P.get(j).clone());
  let d = dp.clone();
  if (aimChild[n] && T.has(j) && T.has(byName.get(aimChild[n]))) {
    const c = byName.get(aimChild[n]);
    // Keep the parent's twist: aim from the direction the parent's rotation already gives.
    const restDir = P.get(c).clone().sub(P.get(j)).applyQuaternion(dp);
    d = fromTo(restDir, T.get(c).clone().sub(T.get(j))).multiply(dp);
  }
  const hm = /^(Left|Right)Hand$/.exec(n);
  if (hm && j === byName.get(n)) {
    const pre = hm[1];
    const s = pre === 'Left' ? 1 : -1;
    const f0 = p(`${pre}HandMiddle1`).sub(p(`${pre}Hand`));
    const t0 = p(`${pre}HandIndex1`).sub(p(`${pre}HandPinky1`));
    d = basis(f0, t0, new THREE.Vector3(s * 0.12, -1, 0.1), new THREE.Vector3(0, 0, 1));
  }
  const fm = /^(Left|Right)Foot$/.exec(n);
  if (fm && j === byName.get(n)) {
    const pre = fm[1];
    const s = pre === 'Left' ? 1 : -1;
    const f0 = p(`${pre}ToeBase`).sub(p(`${pre}Foot`));
    // Toes point ahead (a little out), the sole stays flat: the lateral axis stays horizontal.
    const lat0 = new THREE.Vector3(1, 0, 0);
    d = basis(f0, lat0, new THREE.Vector3(s * 0.08, f0.y / Math.hypot(f0.x, f0.z), 1), new THREE.Vector3(1, 0, -s * 0.08));
  }
  D.set(j, d);
}
// ---- skin every vertex: rest world (via inverse binds) → posed
// ---- hand grip: the file weights the whole hand (fingers included) to the hand bone, so the
// fingers are closed here vertex by vertex, phalanx by phalanx (distal joint first).
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const FINGERS = { Index: [1.1, 1.5, 0.85], Middle: [1.2, 1.6, 0.9], Ring: [1.28, 1.6, 0.9], Pinky: [1.35, 1.55, 0.9] };
const hands = {};
for (const pre of ['Left', 'Right']) {
  const side = pre === 'Left' ? 1 : -1;
  const palmN = new THREE.Vector3(-side, 0, 0);
  const chains = [];
  for (const [f, ang] of Object.entries(FINGERS)) {
    const pts = [1, 2, 3, 4].map((k) => Pn.get(byName.get(`${pre}Hand${f}${k}`)).clone());
    const dir = pts[1].clone().sub(pts[0]).normalize();
    const axis = dir.clone().cross(palmN).normalize();
    chains.push({ f, pts, ang, axes: [axis, axis, axis] });
  }
  const tp = [1, 2, 3, 4].map((k) => Pn.get(byName.get(`${pre}HandThumb${k}`)).clone());
  const tdir = tp[2].clone().sub(tp[1]).normalize();
  // Thumb: swings across toward the fingers about the hand's long axis, then flexes.
  chains.push({ f: 'Thumb', pts: tp, ang: [THUMB[0], THUMB[1], THUMB[2]], axes: [new THREE.Vector3(0, -side, 0), tdir.clone().cross(palmN).normalize(), tdir.clone().cross(palmN).normalize()] });
  hands[pre] = chains;
}
const segDist = (p, a, b) => { const ab = b.clone().sub(a); const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / ab.lengthSq())); return p.distanceTo(a.clone().addScaledVector(ab, t)); };
function curlVertex(pre, v, n, w) {
  let best = null, bd = 0.02;
  for (const c of hands[pre]) for (let k = 0; k < 3; k++) { const d = segDist(v, c.pts[k], c.pts[k + 1]); if (d < bd) { bd = d; best = c; } }
  if (!best) return;
  const dir0 = best.pts[1].clone().sub(best.pts[0]).normalize();
  for (let k = 2; k >= 0; k--) {
    const jp = best.pts[k];
    const segDir = best.pts[Math.min(3, k + 1)].clone().sub(jp).normalize();
    const along = v.clone().sub(jp).dot(k === 0 ? dir0 : segDir);
    const ww = sm(-0.007, 0.005, along) * w;
    if (ww <= 0) continue;
    const q = new THREE.Quaternion().setFromAxisAngle(best.axes[k], best.ang[k] * ww);
    v.sub(jp).applyQuaternion(q).add(jp);
    if (n) n.applyQuaternion(q);
  }
}
const handJoint = new Map();
for (const [i, j] of joints.entries()) { const m = /^Character3_(Left|Right)Hand/.exec(j.getName()); if (m) handJoint.set(i, m[1]); }
const ibmAcc = skin.getInverseBindMatrices();
const IBM = joints.map((_, i) => new THREE.Matrix4().fromArray(ibmAcc.getElement(i, [])));
const restSkin = joints.map((j, i) => restW.get(j).clone().multiply(IBM[i]));
const posed = joints.map((j) => {
  const t = new THREE.Matrix4().makeTranslation(Pn.get(j).x, Pn.get(j).y, Pn.get(j).z);
  const r = new THREE.Matrix4().makeRotationFromQuaternion(D.get(j));
  const back = new THREE.Matrix4().makeTranslation(-P.get(j).x, -P.get(j).y, -P.get(j).z);
  return t.multiply(r).multiply(back);
});
const scaleZ = new THREE.Matrix4().makeTranslation(0, 0, -zc).multiply(new THREE.Matrix4().makeScale(S, S, S));
let minY = Infinity;
const done = new Set();
for (const mesh of doc.getRoot().listMeshes())
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (done.has(pos)) continue;
    done.add(pos);
    const nrm = prim.getAttribute('NORMAL');
    const J = prim.getAttribute('JOINTS_0');
    const W = prim.getAttribute('WEIGHTS_0');
    const outP = new Float32Array(pos.getCount() * 3);
    const outN = nrm ? new Float32Array(nrm.getCount() * 3) : null;
    const v = new THREE.Vector3(), nv = new THREE.Vector3(), acc = new THREE.Vector3(), accN = new THREE.Vector3(), tmp = new THREE.Vector3();
    const m = new THREE.Matrix4(), nm = new THREE.Matrix3();
    for (let i = 0; i < pos.getCount(); i++) {
      v.fromArray(pos.getElement(i, []));
      if (nrm) nv.fromArray(nrm.getElement(i, []));
      const ji = J.getElement(i, []);
      const wi = W.getElement(i, []);
      acc.set(0, 0, 0);
      accN.set(0, 0, 0);
      let wsum = 0;
      for (let k = 0; k < 4; k++) {
        if (!wi[k]) continue;
        m.copy(posed[ji[k]]).multiply(scaleZ).multiply(restSkin[ji[k]]);
        acc.addScaledVector(tmp.copy(v).applyMatrix4(m), wi[k]);
        if (nrm) accN.addScaledVector(tmp.copy(nv).applyMatrix3(nm.getNormalMatrix(m)), wi[k]);
        wsum += wi[k];
      }
      acc.multiplyScalar(1 / wsum);
      let hw = 0, hpre = null;
      for (let k = 0; k < 4; k++) if (wi[k] && handJoint.has(ji[k])) { hw += wi[k]; hpre = handJoint.get(ji[k]); }
      if (hpre && hw > 0.05) curlVertex(hpre, acc, nrm ? accN : null, sm(0.05, 0.6, hw / wsum));
      outP.set([acc.x, acc.y, acc.z], i * 3);
      if (outN) { accN.normalize(); outN.set([accN.x, accN.y, accN.z], i * 3); }
      minY = Math.min(minY, acc.y);
    }
    // Eye caps: their inverse binds in this file are broken (they collapse to the origin);
    // put each cap back in its socket by hand, facing forward.
    if (/^eye_/.test(mesh.getName())) {
      const jn = joints.map((jj) => jj.getName());
      const groups = new Map();
      for (let i = 0; i < pos.getCount(); i++) {
        const k = J.getElement(i, [])[0];
        const g = groups.get(k) ?? { c: new THREE.Vector3(), n: 0, list: [] };
        g.c.add(new THREE.Vector3().fromArray(pos.getElement(i, [])));
        g.n++;
        g.list.push(i);
        groups.set(k, g);
      }
      const head = byName.get('Head');
      for (const [k, g] of groups) {
        g.c.multiplyScalar(1 / g.n);
        const sideName = /left/.test(jn[k]) ? 'eye_left_eye' : 'eye_right_eye';
        const eyeJ = joints.find((jj) => jj.getName().startsWith(sideName));
        const centre = Pn.get(eyeJ);
        const kk = EYE_SCALE * S;
        for (const i of g.list) {
          const v = new THREE.Vector3().fromArray(pos.getElement(i, [])).sub(g.c).multiplyScalar(kk).applyQuaternion(D.get(head)).add(centre).add(EYE_OFFSET);
          outP.set([v.x, v.y, v.z], i * 3);
          if (outN) {
            const n = new THREE.Vector3().fromArray(nrm.getElement(i, [])).applyQuaternion(D.get(head)).normalize();
            outN.set([n.x, n.y, n.z], i * 3);
          }
        }
      }
    }
    // Upper eyelids sculpted half-closed: lift them about each eye's lateral axis.
    if (/^head_/.test(mesh.getName())) {
      const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      for (const side of ['eye_left_eye', 'eye_right_eye']) {
        const c = Pn.get(joints.find((jj) => jj.getName().startsWith(side))).clone().add(new THREE.Vector3(0, 0, -0.012));
        const rel = new THREE.Vector3();
        let moved = 0;
        for (let i = 0; i < pos.getCount(); i++) {
          rel.set(outP[i * 3], outP[i * 3 + 1], outP[i * 3 + 2]).sub(c);
          const len = rel.length();
          if (len > LID_R || rel.z < 0) continue;
          const w = sm(LID_R, LID_R * 0.6, len) * sm(-0.001, 0.005, rel.y);
          if (w <= 0) continue;
          const a = -LID_OPEN * w;
          const y = rel.y * Math.cos(a) - rel.z * Math.sin(a);
          const z = rel.y * Math.sin(a) + rel.z * Math.cos(a);
          outP[i * 3 + 1] = c.y + y;
          outP[i * 3 + 2] = c.z + z;
          moved++;
        }
        console.log('lid', side, c.toArray().map((x) => x.toFixed(3)).join(','), 'moved', moved);
      }
    }
    pos.setType('VEC3').setArray(outP).setNormalized(false);
    if (nrm) nrm.setArray(outN).setNormalized(false);
  }
// Feet on the ground.
for (const a of done) { const arr = a.getArray(); for (let i = 1; i < arr.length; i += 3) arr[i] -= minY; }
await io.write(dst, doc);
const out = {};
for (const j of joints) { const q = Pn.get(j); out[name(j)] = [q.x, q.y - minY, q.z].map((x) => +x.toFixed(4)); }
fs.writeFileSync(outJson, JSON.stringify(out, null, 1));
console.log('minY', minY.toFixed(4), 'height', 'see json');
for (const n of ['Hips', 'Spine', 'Spine1', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandMiddle1', 'LeftHandMiddle3', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase']) console.log(n.padEnd(18), out[n].join(' '));
