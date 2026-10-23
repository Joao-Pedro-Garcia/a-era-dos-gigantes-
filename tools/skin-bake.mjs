// Bakes skinned meshes into their rest pose as the file shows it (linear blend skinning with the
// joints' current world matrices × inverse bind matrices), drops skins/joints and puts every mesh at
// the scene root with an identity transform: a static model for the autoSkin path. With a time, the
// file's first animation is sampled there first (for files whose rest pose is mid-stride); with a
// side ('l' or 'r'), that side's leg joints are then mirrored onto the other leg (symmetric rigs
// named *_l/*_r or *.l/*.r), for a frame where only one foot is planted under the body.
// usage: node tools/skin-bake.mjs src.glb dst.glb [rotXdeg] [timeSeconds] [l|r]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import * as THREE from 'three';
const [src, dst, rx = '0', at = '', mirrorFrom = ''] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const R = new THREE.Matrix4().makeRotationX((+rx * Math.PI) / 180);
const anim = doc.getRoot().listAnimations()[0];
if (at !== '' && anim) {
  const t = +at;
  for (const ch of anim.listChannels()) {
    const node = ch.getTargetNode(), path = ch.getTargetPath(), smp = ch.getSampler();
    const times = smp.getInput().getArray(), vals = smp.getOutput().getArray();
    const n = path === 'rotation' ? 4 : 3;
    if (path !== 'rotation' && path !== 'translation' && path !== 'scale') continue;
    let i = 0;
    while (i < times.length - 2 && times[i + 1] < t) i++;
    const a = Math.min(1, Math.max(0, (t - times[i]) / ((times[i + 1] ?? times[i]) - times[i] || 1)));
    const v0 = Array.from(vals.slice(i * n, i * n + n)), v1 = Array.from(vals.slice((i + 1) * n, (i + 1) * n + n));
    if (!v1.length) { node[path === 'rotation' ? 'setRotation' : path === 'translation' ? 'setTranslation' : 'setScale'](v0); continue; }
    if (path === 'rotation') node.setRotation(new THREE.Quaternion().fromArray(v0).slerp(new THREE.Quaternion().fromArray(v1), a).toArray());
    else node[path === 'translation' ? 'setTranslation' : 'setScale'](v0.map((x, k) => x + (v1[k] - x) * a));
  }
}
if (mirrorFrom) {
  // Mirror across the body's mid-plane (x = 0): rotation (x, -y, -z, w), translation (-x, y, z).
  const to = mirrorFrom === 'r' ? 'l' : 'r';
  const key = (name, side) => name.replace(/_\d+$/, '').replace(new RegExp(`([_.])${side}$|([_.])${side}([_.])`), (m, a, b, c) => (a ? `${a}#` : `${b}#${c}`));
  const nodes = doc.getRoot().listNodes();
  const src = new Map(nodes.filter((n) => /hip|knee|foot|toe|leg/i.test(n.getName())).map((n) => [key(n.getName(), mirrorFrom), n]));
  for (const n of nodes) {
    if (!/hip|knee|foot|toe|leg/i.test(n.getName())) continue;
    const k = key(n.getName(), to);
    const m = k.includes('#') && src.get(k);
    if (!m || m === n) continue;
    const q = m.getRotation(), t = m.getTranslation();
    n.setRotation([q[0], -q[1], -q[2], q[3]]).setTranslation([-t[0], t[1], t[2]]);
  }
}
const scene = doc.getRoot().listScenes()[0];
const meshNodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
const done = new Set();
const v = new THREE.Vector3(), nrm = new THREE.Vector3(), acc = new THREE.Vector3(), accN = new THREE.Vector3(), t = new THREE.Vector3();
for (const n of meshNodes) {
  const skin = n.getSkin();
  let mats = null;
  if (skin) {
    const ibm = skin.getInverseBindMatrices();
    mats = skin.listJoints().map((j, i) => {
      const B = ibm ? new THREE.Matrix4().fromArray(ibm.getElement(i, new Array(16))) : new THREE.Matrix4();
      return R.clone().multiply(new THREE.Matrix4().fromArray(j.getWorldMatrix())).multiply(B);
    });
  }
  const M = R.clone().multiply(new THREE.Matrix4().fromArray(n.getWorldMatrix()));
  for (const p of n.getMesh().listPrimitives()) {
    if (done.has(p)) continue;
    done.add(p);
    const pos = p.getAttribute('POSITION'), nor = p.getAttribute('NORMAL');
    const J = p.getAttribute('JOINTS_0'), W = p.getAttribute('WEIGHTS_0');
    const e = [0, 0, 0], je = [0, 0, 0, 0], we = [0, 0, 0, 0];
    const outP = new Float32Array(pos.getCount() * 3), outN = nor ? new Float32Array(nor.getCount() * 3) : null;
    for (let i = 0; i < pos.getCount(); i++) {
      v.fromArray(pos.getElement(i, e));
      if (nor) nrm.fromArray(nor.getElement(i, e));
      if (mats && J && W) {
        J.getElement(i, je); W.getElement(i, we);
        acc.set(0, 0, 0); accN.set(0, 0, 0);
        let ws = 0;
        for (let k = 0; k < 4; k++) if (we[k] > 0) { ws += we[k]; acc.addScaledVector(t.copy(v).applyMatrix4(mats[je[k]]), we[k]); if (nor) accN.addScaledVector(t.copy(nrm).transformDirection(mats[je[k]]), we[k]); }
        acc.divideScalar(ws || 1);
        acc.toArray(outP, i * 3);
        if (nor) accN.normalize().toArray(outN, i * 3);
      } else {
        t.copy(v).applyMatrix4(M).toArray(outP, i * 3);
        if (nor) t.copy(nrm).transformDirection(M).toArray(outN, i * 3);
      }
    }
    pos.setArray(outP);
    if (nor) nor.setArray(outN);
    for (const sem of ['JOINTS_0', 'WEIGHTS_0', 'TANGENT']) if (p.getAttribute(sem)) p.setAttribute(sem, null);
  }
}
for (const n of meshNodes) {
  const m = n.getMesh(); n.setMesh(null);
  scene.addChild(doc.createNode(n.getName()).setMesh(m));
}
for (const s of doc.getRoot().listSkins()) s.dispose();
for (const a of doc.getRoot().listAnimations()) a.dispose();
for (const c of [...scene.listChildren()]) if (!c.getMesh()) scene.removeChild(c);
await doc.transform(prune());
await io.write(dst, doc);
console.log('ok', dst);
