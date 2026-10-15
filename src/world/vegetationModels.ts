import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { VegetationKind } from './biomes';

/**
 * Procedural low-poly vegetation meshes with baked vertex colours. Each kind
 * becomes one geometry so a sector draws all instances of it in one call.
 */
function colored(geo: THREE.BufferGeometry, color: number, jitter = 0.06, seed = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  let s = seed;
  for (let i = 0; i < n; i += 3) {
    s = (s * 16807) % 2147483647;
    const j = 1 + ((s / 2147483647) - 0.5) * 2 * jitter;
    for (let k = 0; k < 3 && i + k < n; k++) {
      arr[(i + k) * 3] = c.r * j;
      arr[(i + k) * 3 + 1] = c.g * j;
      arr[(i + k) * 3 + 2] = c.b * j;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function at(geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s: [number, number, number] = [1, 1, 1]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));
  geo.applyMatrix4(m);
  return geo;
}

const trunk = 0x5a4632;

function conifer(): THREE.BufferGeometry {
  const parts = [colored(at(new THREE.CylinderGeometry(0.18, 0.35, 3, 6), 0, 1.5, 0), trunk)];
  for (let i = 0; i < 4; i++) {
    const r = 2.2 - i * 0.45;
    parts.push(colored(at(new THREE.ConeGeometry(r, 2.6, 8), 0, 2.6 + i * 1.5, 0, 0, i * 0.4), 0x2f4a2c, 0.12, i + 3));
  }
  return mergeGeometries(parts)!;
}

function broadleaf(): THREE.BufferGeometry {
  const parts = [colored(at(new THREE.CylinderGeometry(0.25, 0.45, 4.5, 7), 0, 2.25, 0), trunk)];
  const blobs: [number, number, number, number][] = [[0, 5.6, 0, 2.6], [1.4, 5, 0.6, 1.8], [-1.3, 5.1, -0.5, 1.9], [0.3, 6.6, -0.9, 1.6], [-0.4, 5.2, 1.5, 1.7]];
  blobs.forEach(([x, y, z, r], i) => parts.push(colored(at(new THREE.IcosahedronGeometry(r, 1), x, y, z, 0, 0, 0, [1, 0.8, 1]), 0x3d5a2a, 0.15, i + 7)));
  return mergeGeometries(parts)!;
}

function palm(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) parts.push(colored(at(new THREE.CylinderGeometry(0.2, 0.26, 1.1, 6), i * 0.12, 0.55 + i * 1.05, 0, 0, 0, -0.06), 0x6e5a40, 0.1, i));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const leaf = at(new THREE.PlaneGeometry(0.9, 3.4, 1, 3), 0, 1.6, 0, 0, 0, 0);
    const pos = leaf.attributes.position;
    for (let v = 0; v < pos.count; v++) pos.setZ(v, -Math.pow(pos.getY(v) / 3.4, 2) * 1.6);
    leaf.rotateX(-1.1);
    leaf.rotateY(a);
    leaf.translate(0.7, 6.3, 0);
    parts.push(colored(leaf, 0x4a6b2a, 0.15, i + 20));
  }
  return mergeGeometries(parts)!;
}

function cycad(): THREE.BufferGeometry {
  const parts = [colored(at(new THREE.CylinderGeometry(0.35, 0.45, 1.2, 8), 0, 0.6, 0), 0x5a4a30)];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const leaf = new THREE.PlaneGeometry(0.5, 2.2, 1, 2);
    leaf.translate(0, 1.1, 0);
    leaf.rotateX(-0.9);
    leaf.rotateY(a);
    leaf.translate(0, 1.2, 0);
    parts.push(colored(leaf, 0x557a32, 0.15, i + 40));
  }
  return mergeGeometries(parts)!;
}

function fern(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const leaf = new THREE.PlaneGeometry(0.35, 1.3, 1, 2);
    leaf.translate(0, 0.65, 0);
    leaf.rotateX(-1.0);
    leaf.rotateY(a);
    parts.push(colored(leaf, 0x4f7a2e, 0.18, i + 60));
  }
  return mergeGeometries(parts)!;
}

function bush(): THREE.BufferGeometry {
  const parts = [
    colored(at(new THREE.IcosahedronGeometry(0.9, 1), 0, 0.7, 0, 0, 0, 0, [1.2, 0.8, 1]), 0x3f5e2b, 0.15, 3),
    colored(at(new THREE.IcosahedronGeometry(0.6, 0), 0.6, 0.6, 0.3), 0x46672f, 0.15, 5),
  ];
  for (let i = 0; i < 6; i++) parts.push(colored(at(new THREE.IcosahedronGeometry(0.09, 0), Math.cos(i) * 0.8, 0.8 + (i % 3) * 0.15, Math.sin(i * 1.7) * 0.7), 0x8a1f2a, 0.1, i));
  return mergeGeometries(parts)!;
}

function deadTree(): THREE.BufferGeometry {
  const parts = [colored(at(new THREE.CylinderGeometry(0.15, 0.35, 5, 6), 0, 2.5, 0), 0x4a4038)];
  for (let i = 0; i < 4; i++) parts.push(colored(at(new THREE.CylinderGeometry(0.05, 0.12, 2, 5), Math.cos(i * 2) * 0.6, 3 + i * 0.5, Math.sin(i * 2) * 0.6, 0.9 * Math.sin(i * 2), 0, 0.9 * Math.cos(i * 2)), 0x4a4038));
  return mergeGeometries(parts)!;
}

function rock(scale = 1): THREE.BufferGeometry {
  const g = new THREE.DodecahedronGeometry(1 * scale, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 1 + Math.sin(x * 3.1 + z * 2.3) * 0.12 + Math.cos(y * 4.2) * 0.08;
    pos.setXYZ(i, x * n, y * n * 0.7, z * n);
  }
  g.computeVertexNormals();
  return colored(g, 0x77736a, 0.12, 9);
}

function reeds(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) parts.push(colored(at(new THREE.CylinderGeometry(0.02, 0.04, 1.6 + (i % 3) * 0.4, 3), Math.cos(i * 2.4) * 0.4, 0.9, Math.sin(i * 2.4) * 0.4, Math.cos(i) * 0.1, 0, Math.sin(i) * 0.1), 0x6b7a3a, 0.2, i));
  return mergeGeometries(parts)!;
}

function grass(): THREE.BufferGeometry {
  // A clump of tapered blades (triangles), so no alpha texture is needed.
  const pos: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.45;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.35 + rnd() * 0.45;
    const w = 0.05 + rnd() * 0.04;
    const ry = rnd() * Math.PI;
    const lean = (rnd() - 0.5) * 0.3;
    const cx = Math.cos(ry) * w;
    const cz = Math.sin(ry) * w;
    pos.push(x - cx, 0, z - cz, x + cx, 0, z + cz, x + lean, h, z + lean * 0.5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // Blades are lit as if facing up so they blend with the terrain.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  const colored0 = colored(g, 0x7d8a40, 0.25, 11);
  return colored0;
}

let cache: Record<VegetationKind, THREE.BufferGeometry> | null = null;

export function vegetationGeometries(): Record<VegetationKind, THREE.BufferGeometry> {
  if (!cache) {
    cache = {
      conifer: conifer(), broadleaf: broadleaf(), palm: palm(), cycad: cycad(), fern: fern(), bush: bush(),
      deadTree: deadTree(), rock: rock(0.8), boulder: rock(2.6), reeds: reeds(), grass: grass(),
    };
    for (const [k, g] of Object.entries(cache)) if (k !== 'grass') g.computeVertexNormals();
  }
  return cache;
}

/** Collision radius (at scale 1) and whether the player can pass through. */
export const VEG_COLLIDER: Record<VegetationKind, number> = {
  conifer: 0.4, broadleaf: 0.5, palm: 0.3, cycad: 0.45, fern: 0, bush: 0, deadTree: 0.35, rock: 0.75, boulder: 2.3, reeds: 0, grass: 0,
};

/** What a vegetation instance yields when harvested. */
export const VEG_YIELD: Partial<Record<VegetationKind, { tool: 'wood' | 'stone' | 'fiber'; drops: Record<string, number>; hits: number }>> = {
  conifer: { tool: 'wood', drops: { wood: 2 }, hits: 6 },
  broadleaf: { tool: 'wood', drops: { wood: 2 }, hits: 7 },
  palm: { tool: 'wood', drops: { wood: 1, fiber: 1 }, hits: 5 },
  deadTree: { tool: 'wood', drops: { wood: 2 }, hits: 4 },
  cycad: { tool: 'fiber', drops: { cycad_fronds: 1, fiber: 1 }, hits: 3 },
  fern: { tool: 'fiber', drops: { fern_fronds: 1, fiber: 1 }, hits: 2 },
  bush: { tool: 'fiber', drops: { berries: 2, fiber: 1 }, hits: 3 },
  reeds: { tool: 'fiber', drops: { fiber: 3 }, hits: 2 },
  rock: { tool: 'stone', drops: { stone: 2 }, hits: 5 },
  boulder: { tool: 'stone', drops: { stone: 3 }, hits: 12 },
};
