// Bakes every mesh into world space (optionally rotated about X), drops skins and skin attributes,
// and puts the meshes at the scene root: a static model for the autoSkin path.
// usage: node flatten.mjs src.glb dst.glb [rotXdeg]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import * as THREE from 'three';
const [src, dst, rx = '0'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const R = new THREE.Matrix4().makeRotationX((+rx * Math.PI) / 180);
const scene = doc.getRoot().listScenes()[0];
const meshNodes = doc.getRoot().listNodes().filter((n) => n.getMesh());
const done = new Set();
for (const n of meshNodes) {
  const M = R.clone().multiply(new THREE.Matrix4().fromArray(n.getWorldMatrix()));
  const N = new THREE.Matrix3().getNormalMatrix(M);
  for (const p of n.getMesh().listPrimitives()) {
    for (const sem of ['JOINTS_0', 'WEIGHTS_0']) if (p.getAttribute(sem)) p.setAttribute(sem, null);
    const pos = p.getAttribute('POSITION');
    if (!done.has(pos)) {
      done.add(pos);
      const a = new Float32Array(pos.getCount() * 3), v = new THREE.Vector3();
      for (let i = 0; i < pos.getCount(); i++) { v.fromArray(pos.getElement(i, [])).applyMatrix4(M); a.set([v.x, v.y, v.z], i * 3); }
      pos.setArray(a).setNormalized(false);
    }
    const nrm = p.getAttribute('NORMAL');
    if (nrm && !done.has(nrm)) {
      done.add(nrm);
      const a = new Float32Array(nrm.getCount() * 3), v = new THREE.Vector3();
      for (let i = 0; i < nrm.getCount(); i++) { v.fromArray(nrm.getElement(i, [])).applyMatrix3(N).normalize(); a.set([v.x, v.y, v.z], i * 3); }
      nrm.setArray(a).setNormalized(false);
    }
  }
  n.setSkin(null);
  n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  const parent = n.getParentNode();
  if (parent) parent.removeChild(n);
  for (const s of doc.getRoot().listScenes()) s.removeChild(n);
  scene.addChild(n);
}
for (const s of doc.getRoot().listSkins()) s.dispose();
for (const a of doc.getRoot().listAnimations()) a.dispose();
for (const c of scene.listChildren()) if (!c.getMesh()) { scene.removeChild(c); c.dispose(); }
await doc.transform(prune());
await io.write(dst, doc);
console.log('ok', dst);
