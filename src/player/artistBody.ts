import * as THREE from 'three';
import { externalEntry, riggedMesh } from '../graphics/externalModels';
import { BONE_NAMES, type BoneName } from './humanModel';

/**
 * The artist survivor (manifest `player` with a `rig`): its skin re-bound to
 * the game skeleton, so the procedural animation (gait IK, actions, aiming,
 * swimming, riding) drives it exactly like the procedural body. The file is
 * re-posed offline to the skeleton's rest pose (see docs/humano-3d.md).
 */
export interface ArtistBody {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
}

const BONE_INDEX = new Map(BONE_NAMES.map((n, i) => [n, i]));
let arms: ArtistBody | null | undefined;

export function artistBody(): ArtistBody | null {
  if (!externalEntry('player')?.rig) return null;
  return riggedMesh('player', BONE_INDEX);
}

const ARM_BONES = new Set<BoneName>(['upperArm.L', 'foreArm.L', 'hand.L', 'upperArm.R', 'foreArm.R', 'hand.R']);

/**
 * First-person arms: the triangles of the artist body that belong to the arms
 * (sleeves, hands), sharing its vertex buffers.
 */
export function artistArms(): ArtistBody | null {
  if (arms !== undefined) return arms;
  const body = artistBody();
  if (!body) return null;
  const g = body.geometry;
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const armIdx = new Set([...ARM_BONES].map((b) => BONE_INDEX.get(b)!));
  // Share of each vertex's weight on the arm bones.
  const onArm = new Float32Array(si.count);
  for (let v = 0; v < si.count; v++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (armIdx.has(si.getComponent(v, k))) w += sw.getComponent(v, k);
    onArm[v] = w;
  }
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) out.setAttribute(name, g.getAttribute(name));
  const src = g.index!;
  const idx: number[] = [];
  const groups = g.groups.length ? g.groups : [{ start: 0, count: src.count, materialIndex: 0 }];
  for (const gr of groups) {
    const start = idx.length;
    for (let i = gr.start; i < gr.start + gr.count; i += 3) {
      const a = src.getX(i);
      const b = src.getX(i + 1);
      const c = src.getX(i + 2);
      // Keep the sleeve up to the shoulder seam (mostly-arm vertices).
      if (onArm[a] > 0.5 && onArm[b] > 0.5 && onArm[c] > 0.5) idx.push(a, b, c);
    }
    if (idx.length > start) out.addGroup(start, idx.length - start, gr.materialIndex ?? 0);
  }
  out.setIndex(idx);
  out.computeBoundingSphere();
  arms = { geometry: out, material: body.material };
  return arms;
}
