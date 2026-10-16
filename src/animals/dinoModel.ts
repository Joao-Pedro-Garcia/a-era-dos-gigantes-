import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SpeciesDef } from './species';

/**
 * Procedural skinned dinosaurs.
 *
 * Each species is built from a blueprint derived from its body plan and
 * measurements (length, hip height, bulk) and its features:
 *  - the body is ONE continuous surface lofted along a smoothed spine
 *    from the tail tip to the base of the skull, with anatomical cross
 *    sections (tail base muscles, deep belly, rib cage, neck) and skinned to a
 *    chain of spine bones, so the tail and neck bend smoothly;
 *  - legs are lofted along thigh → shin → metatarsus → toes with muscle
 *    profiles and claws (digitigrade for theropods, columnar for sauropods,
 *    sprawling for crocodyliforms);
 *  - the skull is sculpted per family (deep theropod skull, duck-billed
 *    hadrosaur, beaked ceratopsian with frill, long narrow snouts) with an
 *    articulated lower jaw, teeth, eyes and nostrils;
 *  - species features (horns, frill, plates, sail, spikes, club, crests,
 *    dome, armour, feathers, wing membranes) are attached to their bones.
 * Colour patterns (countershading, stripes, spots, dorsal line, pale throat)
 * are painted per vertex; scales/feathers come from normal-mapped textures.
 */

export type DinoBone = string;

interface CP {
  /** Model-space position (m). */
  p: THREE.Vector3;
  /** Half width / half height of the cross section, and how far the centre hangs below the spine. */
  rx: number;
  ry: number;
  drop: number;
  bone: string | null;
}

interface LegDef {
  name: string;
  /** Joint chain positions: hip/shoulder, knee/elbow, ankle/wrist, toe joint, toe tip. */
  joints: THREE.Vector3[];
  radii: number[];
  parent: string;
  front: boolean;
  /** Gait phase offset (0..1). */
  phase: number;
  claws: number;
  clawLen: number;
}

export interface Blueprint {
  cps: CP[];
  legs: LegDef[];
  head: { bone: string; at: THREE.Vector3; len: number; height: number; width: number; pitch: number };
  /** Reference scale for texture tiling (m). */
  tile: number;
  feathered: boolean;
}

export interface DinoTemplate {
  geometry: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
  bones: { name: string; parent: string | null; pos: THREE.Vector3 }[];
  bp: Blueprint;
  legs: { name: string; front: boolean; phase: number; lengths: number[]; joints: THREE.Vector3[] }[];
  hipHeight: number;
}

type RGB = [number, number, number];
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

// Material slots.
export const DMAT = { scales: 0, feathers: 1, horn: 2, eye: 3, membrane: 4 } as const;

class Part {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  v(p: THREE.Vector3, u: number, v: number, c: RGB, bones: number[], w: number[]): number {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    this.si.push(bones[0] ?? 0, bones[1] ?? 0, bones[2] ?? 0, 0);
    this.sw.push(w[0] ?? 1, w[1] ?? 0, w[2] ?? 0, 0);
    return this.pos.length / 3 - 1;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// ------------------------------------------------------------------ blueprints

function blueprint(sp: SpeciesDef): Blueprint {
  const L = sp.lengthM;
  const H = sp.hipHeightM;
  const f = new Set(sp.look.features);
  const plan = sp.locomotion.plan;
  const feathered = f.has('feathers');
  const cps: CP[] = [];
  const cp = (z: number, y: number, rx: number, ry: number, drop = 0, bone: string | null = null) => cps.push({ p: V(0, y, z), rx, ry, drop, bone });
  const legs: LegDef[] = [];
  let head: Blueprint['head'];

  if (plan === 'theropod' || plan === 'hadrosaur' || plan === 'bird') {
    const hadro = plan === 'hadrosaur';
    const apex = sp.ecology === 'apexPredator' || sp.massKg > 1500;
    const b = hadro ? 1.25 : sp.id === 'tyrannosaurus' ? 1.18 : sp.id === 'gallimimus' ? 0.82 : f.has('feathers') && L < 3 ? 0.95 : sp.id === 'therizinosaurus' ? 1.2 : 1;
    const Hh = H;
    const longNeck = f.has('longNeck');
    cp(-0.56 * L, Hh * 0.72, 0.004 * L, 0.005 * L, 0, null);
    cp(-0.44 * L, Hh * 0.84, 0.016 * L * b, 0.02 * L * b, 0, 'tail4');
    cp(-0.31 * L, Hh * 0.95, 0.031 * L * b, 0.04 * L * b, 0, 'tail3');
    cp(-0.19 * L, Hh * 1.02, 0.047 * L * b, 0.062 * L * b, 0.004 * L, 'tail2');
    cp(-0.08 * L, Hh * 1.06, 0.05 * L * b, 0.066 * L * b, 0.008 * L, 'tail1');
    cp(0.02 * L, Hh * 1.08, 0.056 * L * b, 0.074 * L * b, 0.014 * L * b, 'pelvis');
    cp(0.1 * L, Hh * 1.07, 0.06 * L * b, 0.08 * L * b, 0.026 * L * b, 'torso');
    cp(0.17 * L, Hh * 1.05, 0.052 * L * b, 0.072 * L * b, 0.022 * L * b, 'chest');
    if (longNeck) {
      cp(0.22 * L, Hh * 1.14, 0.038 * L * b, 0.046 * L * b, 0.006 * L, 'neck1');
      cp(0.255 * L, Hh * 1.34, 0.028 * L * b, 0.032 * L * b, 0, 'neck2');
      cp(0.28 * L, Hh * 1.55, 0.024 * L * b, 0.026 * L * b, 0, 'neck3');
      cp(0.3 * L, Hh * 1.68, 0.022 * L, 0.024 * L, 0, null);
    } else if (hadro) {
      cp(0.22 * L, Hh * 1.08, 0.045 * L * b, 0.058 * L * b, 0.01 * L, 'neck1');
      cp(0.26 * L, Hh * 1.16, 0.036 * L, 0.045 * L, 0.004 * L, 'neck2');
      cp(0.29 * L, Hh * 1.18, 0.032 * L, 0.04 * L, 0, 'neck3');
      cp(0.31 * L, Hh * 1.16, 0.03 * L, 0.038 * L, 0, null);
    } else {
      cp(0.215 * L, Hh * 1.1, 0.046 * L * b, 0.058 * L * b, 0.01 * L, 'neck1');
      cp(0.245 * L, Hh * 1.2, 0.04 * L * b, 0.048 * L * b, 0.004 * L, 'neck2');
      cp(0.268 * L, Hh * 1.28, 0.036 * L * b, 0.044 * L * b, 0, 'neck3');
      cp(0.285 * L, Hh * 1.31, 0.034 * L * b, 0.042 * L * b, 0, null);
    }
    const end = cps[cps.length - 1].p;
    const hl = f.has('longSnout') ? 0.16 * L : apex ? 0.125 * L : hadro ? 0.12 * L : f.has('beak') && longNeck ? 0.07 * L : 0.1 * L;
    const hh = apex ? 0.034 * L : hadro ? 0.027 * L : 0.024 * L;
    head = { bone: 'head', at: end.clone(), len: hl, height: hh, width: apex ? hh * 1.05 : hh * 0.8, pitch: longNeck ? 0.25 : 0.12 };
    // Hind legs (digitigrade).
    for (const side of [1, -1]) {
      const x = side * 0.05 * L * b;
      const legScale = H;
      legs.push({
        name: side > 0 ? 'hindL' : 'hindR',
        joints: [V(x, Hh * 1.0, 0.02 * L), V(x * 1.08, Hh * 0.55, 0.02 * L + 0.17 * legScale), V(x * 1.02, Hh * 0.2, 0.02 * L - 0.07 * legScale), V(x, Hh * 0.035, 0.02 * L + 0.02 * legScale), V(x, 0, 0.02 * L + 0.2 * legScale)],
        radii: [0.036 * L * b * (apex ? 1.1 : 1), 0.02 * L * b, 0.012 * L * b, 0.009 * L * b, 0.006 * L],
        parent: 'pelvis',
        front: false,
        phase: side > 0 ? 0 : 0.5,
        claws: 3,
        clawLen: 0.03 * H,
      });
    }
    // Arms: tiny on tyrannosaurs, long clawed on raptors/therizinosaurs, sturdy on hadrosaurs.
    const armLen = f.has('longClaws') ? 0.15 * L : hadro ? H * 0.72 : sp.id === 'tyrannosaurus' ? 0.06 * L : sp.id === 'carnotaurus' ? 0.035 * L : 0.09 * L;
    for (const side of [1, -1]) {
      const x = side * 0.055 * L * b;
      const s0 = V(x, Hh * 0.98, 0.17 * L);
      const e = s0.clone().add(V(side * 0.01 * L, -armLen * 0.48, armLen * (hadro ? 0.05 : 0.2)));
      const w = e.clone().add(V(0, -armLen * 0.45, armLen * (hadro ? 0.08 : 0.22)));
      const t0 = w.clone().add(V(0, -armLen * 0.08, armLen * 0.08));
      legs.push({
        name: side > 0 ? 'armL' : 'armR',
        joints: [s0, e, w, t0, t0.clone().add(V(0, -armLen * 0.06, armLen * (f.has('longClaws') ? 0.25 : 0.1)))],
        radii: [0.02 * L * b * (hadro ? 1.6 : 1), 0.013 * L * b * (hadro ? 1.6 : 1), 0.01 * L * (hadro ? 1.6 : 1), 0.007 * L, 0.004 * L],
        parent: 'chest',
        front: true,
        phase: hadro ? (side > 0 ? 0.5 : 0) : -1,
        claws: f.has('longClaws') || f.has('thumbSpike') ? 3 : 2,
        clawLen: f.has('longClaws') ? 0.07 * L : 0.015 * L,
      });
    }
  } else if (plan === 'quadruped' || plan === 'crocodyliform') {
    const croc = plan === 'crocodyliform';
    const ankylo = f.has('armor');
    const stego = f.has('plates');
    const cera = f.has('frill');
    const Hh = H;
    const wide = ankylo ? 1.35 : croc ? 1.0 : 1.0;
    const tailY = stego ? 0.85 : croc ? 0.25 : 0.55;
    cp(-0.55 * L, Hh * tailY, 0.004 * L, 0.005 * L, 0, null);
    cp(-0.42 * L, Hh * lerp(tailY, 1, 0.3), 0.022 * L * wide, 0.024 * L, 0, 'tail4');
    cp(-0.3 * L, Hh * lerp(tailY, 1, 0.6), 0.04 * L * wide, 0.045 * L, 0, 'tail3');
    cp(-0.18 * L, Hh * (croc ? 0.8 : 0.98), 0.06 * L * wide, 0.065 * L, 0.004 * L, 'tail2');
    cp(-0.09 * L, Hh * (croc ? 0.85 : 1.08), 0.085 * L * wide, 0.09 * L * (croc ? 0.6 : 1), 0.015 * L, 'tail1');
    cp(0.0, Hh * (croc ? 0.86 : stego ? 1.32 : 1.14), 0.1 * L * wide, (croc ? 0.06 : 0.095) * L, (croc ? 0.008 : 0.03) * L, 'pelvis');
    cp(0.08 * L, Hh * (croc ? 0.85 : stego ? 1.2 : 1.12), 0.105 * L * wide, (croc ? 0.06 : 0.1) * L, (croc ? 0.01 : 0.04) * L, 'torso');
    cp(0.16 * L, Hh * (croc ? 0.82 : stego ? 0.95 : 1.02), 0.085 * L * wide, (croc ? 0.05 : 0.085) * L, (croc ? 0.008 : 0.03) * L, 'chest');
    cp(0.22 * L, Hh * (croc ? 0.76 : stego ? 0.8 : 0.9), 0.055 * L * wide, (croc ? 0.04 : 0.065) * L, 0.012 * L, 'neck1');
    cp(0.255 * L, Hh * (croc ? 0.74 : stego ? 0.72 : 0.84), 0.045 * L * wide, (croc ? 0.035 : 0.055) * L, 0.006 * L, 'neck2');
    cp(0.275 * L, Hh * (croc ? 0.73 : stego ? 0.68 : 0.8), 0.042 * L * wide, (croc ? 0.033 : 0.05) * L, 0, null);
    const end = cps[cps.length - 1].p;
    const hl = croc ? 0.22 * L : cera ? (f.has('horns3') ? 0.21 * L : 0.17 * L) : ankylo ? 0.08 * L : stego ? 0.06 * L : 0.12 * L;
    const hh = croc ? 0.018 * L : cera ? 0.042 * L : ankylo ? 0.03 * L : 0.022 * L;
    head = { bone: 'head', at: end.clone(), len: hl, height: hh, width: croc ? hh * 1.4 : ankylo ? hh * 1.6 : hh * 0.95, pitch: croc ? 0.02 : 0.35 };
    const legY = croc ? Hh * 0.95 : Hh;
    for (const [front, side] of [[false, 1], [false, -1], [true, 1], [true, -1]] as [boolean, number][]) {
      const z = front ? 0.15 * L : -0.04 * L;
      const len = front ? legY * (stego ? 0.62 : croc ? 0.9 : 0.86) : legY;
      const x = side * (croc ? 0.07 : 0.085) * L * wide;
      const top = V(x, front ? len * 1.02 : legY * 1.02, z);
      const spread = croc ? side * 0.08 * L : side * 0.008 * L;
      const knee = top.clone().add(V(spread, -len * 0.48, front ? -0.04 * len : 0.08 * len));
      const ankle = top.clone().add(V(spread * 1.2, -len * 0.88, front ? 0.0 : -0.05 * len));
      const toe = V(ankle.x, 0.025 * len, ankle.z + 0.06 * len);
      legs.push({
        name: `${front ? 'front' : 'hind'}${side > 0 ? 'L' : 'R'}`,
        joints: [top, knee, ankle, toe, toe.clone().add(V(0, -0.02 * len, 0.14 * len))],
        radii: [(front ? 0.032 : 0.042) * L * (croc ? 0.6 : 1), (front ? 0.026 : 0.03) * L * (croc ? 0.6 : 1), 0.023 * L * (croc ? 0.6 : 1), 0.025 * L * (croc ? 0.6 : 1), 0.02 * L * (croc ? 0.5 : 1)],
        parent: front ? 'chest' : 'pelvis',
        front,
        // Lateral-sequence walk: LH, LF, RH, RF.
        phase: (front ? 0.25 : 0) + (side > 0 ? 0 : 0.5),
        claws: croc ? 4 : 4,
        clawLen: croc ? 0.012 * L : 0.01 * L,
      });
    }
  } else if (plan === 'sauropod') {
    const Hh = H;
    cp(-0.56 * L, Hh * 0.45, 0.003 * L, 0.003 * L, 0, null);
    cp(-0.44 * L, Hh * 0.62, 0.012 * L, 0.014 * L, 0, 'tail4');
    cp(-0.32 * L, Hh * 0.82, 0.024 * L, 0.028 * L, 0, 'tail3');
    cp(-0.2 * L, Hh * 1.02, 0.04 * L, 0.045 * L, 0, 'tail2');
    cp(-0.11 * L, Hh * 1.15, 0.06 * L, 0.065 * L, 0.01 * L, 'tail1');
    cp(-0.03 * L, Hh * 1.24, 0.078 * L, 0.082 * L, 0.025 * L, 'pelvis');
    cp(0.05 * L, Hh * 1.3, 0.085 * L, 0.09 * L, 0.035 * L, 'torso');
    cp(0.12 * L, Hh * 1.36, 0.075 * L, 0.08 * L, 0.028 * L, 'chest');
    cp(0.17 * L, Hh * 1.48, 0.04 * L, 0.048 * L, 0.006 * L, 'neck1');
    cp(0.215 * L, Hh * 1.85, 0.026 * L, 0.03 * L, 0, 'neck2');
    cp(0.245 * L, Hh * 2.25, 0.019 * L, 0.022 * L, 0, 'neck3');
    cp(0.262 * L, Hh * 2.55, 0.016 * L, 0.018 * L, 0, null);
    const end = cps[cps.length - 1].p;
    head = { bone: 'head', at: end.clone(), len: 0.045 * L, height: 0.013 * L, width: 0.012 * L, pitch: 0.9 };
    for (const [front, side] of [[false, 1], [false, -1], [true, 1], [true, -1]] as [boolean, number][]) {
      const z = front ? 0.12 * L : -0.04 * L;
      const len = front ? Hh * 1.22 : Hh * 1.05;
      const x = side * 0.06 * L;
      const top = V(x, len * 1.0, z);
      legs.push({
        name: `${front ? 'front' : 'hind'}${side > 0 ? 'L' : 'R'}`,
        joints: [top, V(x, len * 0.52, z + (front ? -0.01 : 0.02) * L), V(x, len * 0.1, z), V(x, 0.03 * len, z + 0.01 * L), V(x, 0, z + 0.035 * L)],
        radii: [0.045 * L, 0.034 * L, 0.03 * L, 0.032 * L, 0.03 * L],
        parent: front ? 'chest' : 'pelvis',
        front,
        phase: (front ? 0.25 : 0) + (side > 0 ? 0 : 0.5),
        claws: 3,
        clawLen: 0.008 * L,
      });
    }
  } else {
    // Pterosaur: compact torso, long neck, huge beaked head, membrane wings.
    const Hh = H * 0.85;
    const longNeck = f.has('longNeck');
    cp(-0.24 * L, Hh * 0.9, 0.004 * L, 0.004 * L, 0, null);
    cp(-0.16 * L, Hh * 0.95, 0.02 * L, 0.02 * L, 0, 'tail1');
    cp(-0.05 * L, Hh * 1.0, 0.06 * L, 0.06 * L, 0.01 * L, 'pelvis');
    cp(0.06 * L, Hh * 1.05, 0.075 * L, 0.075 * L, 0.012 * L, 'torso');
    cp(0.14 * L, Hh * 1.08, 0.06 * L, 0.06 * L, 0.01 * L, 'chest');
    cp(0.2 * L, Hh * (longNeck ? 1.35 : 1.18), 0.028 * L, 0.03 * L, 0, 'neck1');
    cp(0.24 * L, Hh * (longNeck ? 1.75 : 1.28), 0.022 * L, 0.024 * L, 0, 'neck2');
    cp(0.26 * L, Hh * (longNeck ? 2.05 : 1.34), 0.02 * L, 0.022 * L, 0, null);
    const end = cps[cps.length - 1].p;
    head = { bone: 'head', at: end.clone(), len: 0.42 * L, height: 0.03 * L, width: 0.02 * L, pitch: longNeck ? 0.5 : 0.15 };
    for (const side of [1, -1]) {
      const x = side * 0.035 * L;
      legs.push({
        name: side > 0 ? 'hindL' : 'hindR',
        joints: [V(x, Hh * 0.98, -0.05 * L), V(x, Hh * 0.6, 0.0), V(x, Hh * 0.15, -0.03 * L), V(x, 0.02 * Hh, -0.01 * L), V(x, 0, 0.03 * L)],
        radii: [0.022 * L, 0.014 * L, 0.01 * L, 0.008 * L, 0.005 * L],
        parent: 'pelvis',
        front: false,
        phase: side > 0 ? 0 : 0.5,
        claws: 3,
        clawLen: 0.012 * L,
      });
      // Folded wing used as a front limb on the ground (quadrupedal launch posture).
      const s0 = V(side * 0.05 * L, Hh * 1.08, 0.14 * L);
      legs.push({
        name: side > 0 ? 'wingL' : 'wingR',
        joints: [s0, s0.clone().add(V(side * 0.1 * L, -Hh * 0.35, -0.02 * L)), s0.clone().add(V(side * 0.12 * L, -Hh * 0.95, 0.05 * L)), V(side * 0.17 * L, 0.03 * Hh, 0.08 * L), V(side * 0.6 * L, Hh * 0.3, -0.2 * L)],
        radii: [0.022 * L, 0.016 * L, 0.012 * L, 0.009 * L, 0.003 * L],
        parent: 'chest',
        front: true,
        phase: side > 0 ? 0.25 : 0.75,
        claws: 3,
        clawLen: 0.01 * L,
      });
    }
  }
  return { cps, legs, head: head!, tile: 0.1 + 0.06 * Math.pow(L, 0.75), feathered };
}

// ------------------------------------------------------------------ painting

function painter(sp: SpeciesDef) {
  const base = new THREE.Color(sp.look.base);
  const belly = new THREE.Color(sp.look.belly);
  const accent = new THREE.Color(sp.look.accent);
  const L = sp.lengthM;
  const pattern = sp.look.pattern;
  return (p: THREE.Vector3, under: number, part: 'body' | 'limb' | 'head' | 'accent' | 'horn' | 'claw'): RGB => {
    if (part === 'horn') return [0.62, 0.56, 0.46];
    if (part === 'claw') return [0.18, 0.15, 0.12];
    const c = base.clone();
    if (part === 'accent') c.copy(accent);
    else {
      // Countershading: pale belly and throat, darker back.
      c.lerp(belly, smooth(-0.1, 0.9, under) * (pattern === 'countershade' ? 1 : 0.75));
      if (under < -0.55) c.multiplyScalar(0.82); // dorsal line
      if (part !== 'limb' && under < 0.3) {
        if (pattern === 'stripes') {
          const s = Math.sin((p.z / L) * 46 + Math.sin(p.y * 7 / L * 10) * 0.6 + hash(Math.floor(p.z * 3 / L * 10), 1, 2) * 0.8);
          if (s > 0.25) c.lerp(accent, 0.55 * smooth(0.25, 0.6, s) * smooth(0.3, -0.4, under));
        } else if (pattern === 'spots') {
          const q = L * 0.035;
          const h = hash(Math.floor(p.x / q), Math.floor(p.y / q), Math.floor(p.z / q));
          if (h > 0.72) c.lerp(accent, 0.6 * smooth(0.3, -0.3, under));
        }
      }
      if (part === 'limb') c.multiplyScalar(0.9);
    }
    const n = 1 + (hash(p.x * 9, p.y * 9, p.z * 9) - 0.5) * 0.06;
    return [c.r * n, c.g * n, c.b * n];
  };
}

// ------------------------------------------------------------------ builders

/** Catmull-Rom resampling of the spine control points. */
function spineSamples(cps: CP[], perSeg: number): { p: THREE.Vector3; rx: number; ry: number; drop: number; s: number }[] {
  const curve = new THREE.CatmullRomCurve3(cps.map((c) => c.p.clone()), false, 'centripetal');
  const n = (cps.length - 1) * perSeg;
  const out: { p: THREE.Vector3; rx: number; ry: number; drop: number; s: number }[] = [];
  const lengths = curve.getLengths(n);
  const total = lengths[n];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const seg = Math.min(cps.length - 2, Math.floor(u * (cps.length - 1)));
    const t = u * (cps.length - 1) - seg;
    const a = cps[seg];
    const b = cps[seg + 1];
    const k = t * t * (3 - 2 * t);
    out.push({ p: curve.getPoint(u), rx: lerp(a.rx, b.rx, k), ry: lerp(a.ry, b.ry, k), drop: lerp(a.drop, b.drop, k), s: lengths[i] / total });
  }
  return out;
}

interface BoneInfo {
  name: string;
  parent: string | null;
  pos: THREE.Vector3;
}

export function buildDinoTemplate(sp: SpeciesDef): DinoTemplate {
  const bp = blueprint(sp);
  const bones: BoneInfo[] = [{ name: 'root', parent: null, pos: V() }];
  const boneIndex = new Map<string, number>([['root', 0]]);
  const addBone = (name: string, parent: string, pos: THREE.Vector3) => {
    boneIndex.set(name, bones.length);
    bones.push({ name, parent, pos: pos.clone() });
  };
  // Spine chain: pelvis is the hub; tail bones go backward, torso/neck forward.
  const pelvisI = bp.cps.findIndex((c) => c.bone === 'pelvis');
  addBone('pelvis', 'root', bp.cps[pelvisI].p);
  for (let i = pelvisI - 1; i >= 0; i--) if (bp.cps[i].bone) addBone(bp.cps[i].bone!, bones[bones.length - 1].name === 'pelvis' || i === pelvisI - 1 ? 'pelvis' : bp.cps[i + 1].bone!, bp.cps[i].p);
  // Fix tail parents to form a chain.
  let prev = 'pelvis';
  for (let i = pelvisI - 1; i >= 0; i--) {
    const b = bp.cps[i].bone;
    if (!b) continue;
    bones[boneIndex.get(b)!].parent = prev;
    prev = b;
  }
  prev = 'pelvis';
  for (let i = pelvisI + 1; i < bp.cps.length; i++) {
    const b = bp.cps[i].bone;
    if (!b) continue;
    addBone(b, prev, bp.cps[i].p);
    prev = b;
  }
  addBone('head', prev, bp.head.at);
  const jawHinge = bp.head.at.clone().add(V(0, -bp.head.height * 0.35, bp.head.len * 0.12));
  addBone('jaw', 'head', jawHinge);
  for (const leg of bp.legs) {
    const names = ['0', '1', '2', '3'].map((k) => `${leg.name}${k}`);
    addBone(names[0], leg.parent, leg.joints[0]);
    for (let k = 1; k < 4; k++) addBone(names[k], names[k - 1], leg.joints[k]);
  }

  const build = (detail: boolean): THREE.BufferGeometry => {
    const parts = [new Part(), new Part(), new Part(), new Part(), new Part()];
    const paint = painter(sp);
    const segs = detail ? 22 : 9;
    const perSeg = detail ? 9 : 3;
    const tile = bp.tile;
    const feathered = bp.feathered;
    const bodyMat = feathered ? DMAT.feathers : DMAT.scales;

    // --- Body.
    const samples = spineSamples(bp.cps, perSeg);
    // Bone positions along the spine (arc parameter) for skin weights.
    const spineBones = bp.cps
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.bone)
      .map((x) => ({ idx: boneIndex.get(x.c.bone!)!, s: samples[x.i * perSeg].s }));
    spineBones.push({ idx: boneIndex.get('head')!, s: 1.0001 });
    const spineWeights = (s: number): [number[], number[]] => {
      let j = 0;
      while (j < spineBones.length - 1 && spineBones[j + 1].s < s) j++;
      const a = spineBones[j];
      const b = spineBones[Math.min(spineBones.length - 1, j + 1)];
      if (a === b || s <= a.s) return [[a.idx], [1]];
      const t = smooth(0, 1, (s - a.s) / (b.s - a.s));
      return [[a.idx, b.idx], [1 - t, t]];
    };
    const body = parts[bodyMat];
    const base = body.pos.length / 3;
    let along = 0;
    for (let i = 0; i < samples.length; i++) {
      const sm = samples[i];
      if (i > 0) along += sm.p.distanceTo(samples[i - 1].p);
      const next = samples[Math.min(samples.length - 1, i + 1)].p;
      const prv = samples[Math.max(0, i - 1)].p;
      const tan = next.clone().sub(prv).normalize();
      const side = V(1, 0, 0);
      const up = tan.clone().cross(side).normalize().negate();
      if (up.y < 0) up.negate();
      const [bi, bw] = spineWeights(sm.s);
      const circ = Math.PI * (sm.rx + sm.ry);
      const uRep = Math.max(1, Math.round(circ / tile));
      for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        // Section: rounder on top, fuller belly below (drop).
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const below = Math.max(0, -sa);
        const r = V().addScaledVector(side, ca * sm.rx).addScaledVector(up, sa * sm.ry - below * sm.drop);
        const p = sm.p.clone().add(r);
        const under = -sa; // +1 belly, -1 back
        body.v(p, (k / segs) * uRep, along / tile, paint(p, under, 'body'), bi, bw);
      }
    }
    for (let i = 0; i < samples.length - 1; i++)
      for (let k = 0; k < segs; k++) {
        const a = base + i * (segs + 1) + k;
        const b = a + segs + 1;
        body.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }

    // --- Head (skull + jaw).
    buildHead(sp, bp, parts, boneIndex, paint, detail);
    // --- Legs.
    for (const leg of bp.legs) buildLeg(sp, leg, parts, boneIndex, paint, detail, tile, feathered && leg.front ? DMAT.feathers : DMAT.scales);
    // --- Features.
    buildFeatures(sp, bp, parts, boneIndex, samples, spineWeights, paint, detail);

    const geos = parts.map((p) => p.geometry()).filter((g) => g.attributes.position.count > 0 || detail);
    // The distant version is a single group (one draw call); details keep their materials.
    const g = mergeGeometries(geos, detail)!;
    g.computeBoundingSphere();
    return g;
  };

  const legsInfo = bp.legs.map((l) => ({
    name: l.name,
    front: l.front,
    phase: l.phase,
    joints: l.joints.map((j) => j.clone()),
    lengths: [0, 1, 2, 3].map((k) => l.joints[k].distanceTo(l.joints[k + 1])),
  }));
  return { geometry: build(true), low: build(false), bones, bp, legs: legsInfo, hipHeight: sp.hipHeightM };
}

/** Generic tapered tube along points, skinned rigidly or by segment. */
function tube(part: Part, pts: THREE.Vector3[], radii: number[], segs: number, color: (p: THREE.Vector3, t: number) => RGB, skin: (i: number, t: number) => [number[], number[]], tile: number, cap = true, flatten = 1): void {
  const base = part.pos.length / 3;
  let along = 0;
  let normal = V(1, 0, 0);
  for (let i = 0; i < pts.length; i++) {
    if (i > 0) along += pts[i].distanceTo(pts[i - 1]);
    const tan = (i < pts.length - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1])).normalize();
    if (Math.abs(tan.dot(normal)) > 0.95) normal = V(0, 0, 1);
    const side = normal.clone().sub(tan.clone().multiplyScalar(normal.dot(tan))).normalize();
    const up = tan.clone().cross(side).normalize();
    const t = i / (pts.length - 1);
    const [bi, bw] = skin(i, t);
    const r = radii[i];
    const uRep = Math.max(1, Math.round((2 * Math.PI * r) / tile));
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const p = pts[i].clone().addScaledVector(side, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r * flatten);
      part.v(p, (k / segs) * uRep, along / tile, color(p, t), bi, bw);
    }
  }
  for (let i = 0; i < pts.length - 1; i++)
    for (let k = 0; k < segs; k++) {
      const a = base + i * (segs + 1) + k;
      const b = a + segs + 1;
      part.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  if (cap) {
    const last = pts.length - 1;
    const [bi, bw] = skin(last, 1);
    const c = part.v(pts[last], 0.5, 0.5, color(pts[last], 1), bi, bw);
    const ring = base + last * (segs + 1);
    for (let k = 0; k < segs; k++) part.idx.push(ring + k, ring + k + 1, c);
  }
}

/** Smooth path through joints (with intermediate samples for muscle bulges). */
function legPath(joints: THREE.Vector3[], per: number): { p: THREE.Vector3; seg: number; t: number }[] {
  const out: { p: THREE.Vector3; seg: number; t: number }[] = [];
  for (let s = 0; s < joints.length - 1; s++)
    for (let i = 0; i < per; i++) {
      const t = i / per;
      out.push({ p: joints[s].clone().lerp(joints[s + 1], t), seg: s, t });
    }
  out.push({ p: joints[joints.length - 1].clone(), seg: joints.length - 2, t: 1 });
  return out;
}

function buildLeg(sp: SpeciesDef, leg: LegDef, parts: Part[], boneIndex: Map<string, number>, paint: ReturnType<typeof painter>, detail: boolean, tile: number, mat: number): void {
  const per = detail ? 5 : 2;
  const path = legPath(leg.joints.slice(0, 4), per);
  const bonesI = [0, 1, 2, 3].map((k) => boneIndex.get(`${leg.name}${k}`)!);
  const parentI = boneIndex.get(leg.parent)!;
  const radii = path.map(({ seg, t }) => {
    const r0 = leg.radii[seg];
    const r1 = leg.radii[seg + 1];
    // Muscle bulge in the upper third of the thigh/upper arm and calf.
    const bulge = seg === 0 ? 1 + 0.18 * Math.sin(Math.PI * Math.min(1, t * 1.6)) : seg === 1 ? 1 + 0.12 * Math.sin(Math.PI * t) : 1;
    return lerp(r0, r1, t) * bulge;
  });
  // The upper end starts deep inside the body and swells outward, so the
  // thigh/shoulder emerges from the flank instead of a capped cylinder.
  const inside = V(leg.joints[0].x * 0.35, leg.joints[0].y + leg.radii[0] * 1.4, leg.joints[0].z);
  path.unshift({ p: inside, seg: 0, t: 0 });
  radii.unshift(leg.radii[0] * 0.55);
  tube(parts[mat], path.map((x) => x.p), radii, detail ? 14 : 6, (p) => paint(p, 0.2, 'limb'), (i) => {
    const { seg, t } = path[i];
    if (seg === 0 && t < 0.25) return [[parentI, bonesI[0]], [1 - t * 4 * 0.6 - 0.4, t * 4 * 0.6 + 0.4]];
    if (t < 0.15 && seg > 0) {
      const w = smooth(0, 0.15, t) * 0.5 + 0.5;
      return [[bonesI[seg - 1], bonesI[seg]], [1 - w, w]];
    }
    return [[bonesI[seg]], [1]];
  }, tile, true);
  // Toes with claws.
  const toeRoot = leg.joints[3];
  const tip = leg.joints[4];
  const dir = tip.clone().sub(toeRoot);
  const len = dir.length();
  dir.normalize();
  const sideV = V(dir.z, 0, -dir.x).normalize();
  const nToes = leg.claws;
  for (let k = 0; k < nToes; k++) {
    const spread = (k - (nToes - 1) / 2) * 0.35;
    const d = dir.clone().applyAxisAngle(V(0, 1, 0), spread).normalize();
    const tl = len * (k === Math.floor(nToes / 2) ? 1 : 0.8);
    const pts = [toeRoot.clone().addScaledVector(sideV, spread * leg.radii[3] * 1.2), toeRoot.clone().addScaledVector(d, tl * 0.5).addScaledVector(sideV, spread * leg.radii[3] * 1.4), toeRoot.clone().addScaledVector(d, tl).addScaledVector(sideV, spread * leg.radii[3] * 1.5)];
    const r = leg.radii[3] * 0.45;
    tube(parts[DMAT.scales], pts, [r, r * 0.85, r * 0.6], detail ? 6 : 4, (p) => paint(p, 0.3, 'limb'), () => [[bonesI[3]], [1]], tile, false);
    // Claw: curved cone.
    const cb = pts[2];
    const cl = leg.clawLen;
    const curve = [cb, cb.clone().addScaledVector(d, cl * 0.5).add(V(0, -cl * 0.1, 0)), cb.clone().addScaledVector(d, cl).add(V(0, -cl * 0.45, 0))];
    tube(parts[DMAT.horn], curve, [r * 0.6, r * 0.35, r * 0.05], detail ? 5 : 3, (p) => paint(p, 0, 'claw'), () => [[bonesI[3]], [1]], tile, true);
  }
  void sp;
}

function buildHead(sp: SpeciesDef, bp: Blueprint, parts: Part[], boneIndex: Map<string, number>, paint: ReturnType<typeof painter>, detail: boolean): void {
  const f = new Set(sp.look.features);
  const plan = sp.locomotion.plan;
  const hb = boneIndex.get('head')!;
  const jb = boneIndex.get('jaw')!;
  const { at, len, height, width, pitch } = bp.head;
  const fwd = V(0, -Math.sin(pitch), Math.cos(pitch));
  const up = V(0, Math.cos(pitch), Math.sin(pitch));
  const sideV = V(1, 0, 0);
  const segs = detail ? 18 : 8;
  const rings = detail ? 12 : 5;
  const mat = bp.feathered && plan !== 'bird' && sp.lengthM < 3 ? DMAT.feathers : DMAT.scales;
  const duck = plan === 'hadrosaur';
  const beak = f.has('beak');
  const croc = plan === 'crocodyliform' || f.has('longSnout');
  const cera = f.has('frill');
  const ptero = plan === 'pterosaur';
  // Skull: occiput → snout tip; section shapes per family.
  const prof = (t: number): [number, number, number] => {
    // half width, half height, vertical offset of the centre (fraction of height)
    if (ptero) return [width * lerp(1, 0.08, Math.pow(t, 0.8)), height * lerp(1, 0.1, Math.pow(t, 0.7)), 0];
    if (croc) return [width * lerp(1, 0.32, smooth(0, 0.45, t)) * (1 + (plan === 'crocodyliform' ? 0.25 * smooth(0.85, 1, t) : 0)), height * lerp(1, 0.32, smooth(0, 0.5, t)), -0.1 * t];
    if (duck) return [width * lerp(1, t > 0.7 ? 0.9 : 0.55, smooth(0, 0.7, t)), height * lerp(1, 0.35, smooth(0.2, 1, t)), -0.2 * t];
    if (beak || cera) return [width * lerp(1, 0.22, Math.pow(t, 1.5)), height * lerp(1, 0.45, t), -0.15 * t];
    if (sp.locomotion.plan === 'sauropod') return [width * lerp(1, 0.75, t), height * lerp(1, 0.55, t), -0.1 * t];
    // Theropod: deep skull, tapering snout, slight rise over the eyes.
    return [width * lerp(1, 0.42, Math.pow(t, 0.9)), height * lerp(1.05, 0.48, Math.pow(t, 1.1)), -0.05 * t];
  };
  const skull = parts[mat];
  const base = skull.pos.length / 3;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const c = at.clone().addScaledVector(fwd, -len * 0.1 + t * len);
    const [hw, hh, off] = prof(t);
    c.addScaledVector(up, off * height);
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // Flatter underside where the jaw sits.
      const yy = sa > 0 ? sa * hh : sa * hh * 0.45;
      const p = c.clone().addScaledVector(sideV, ca * hw).addScaledVector(up, yy);
      const nostril = !ptero && t > 0.85 && sa > 0.2 && sa < 0.7 && Math.abs(ca) > 0.4;
      const col = nostril ? ([0.05, 0.04, 0.035] as RGB) : paint(p, sa < 0 ? 0.6 : -0.5 * sa, 'head');
      skull.v(p, (k / segs) * 2, t * 2, col, [hb], [1]);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let k = 0; k < segs; k++) {
      const a = base + i * (segs + 1) + k;
      const b = a + segs + 1;
      skull.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  // Close the snout tip and back of the skull.
  const tipC = skull.v(at.clone().addScaledVector(fwd, len * 0.92), 0.5, 0.5, beak || ptero ? [0.55, 0.5, 0.4] : paint(at, 0, 'head'), [hb], [1]);
  const lastRing = base + rings * (segs + 1);
  for (let k = 0; k < segs; k++) skull.idx.push(lastRing + k, lastRing + k + 1, tipC);
  // Lower jaw (separate bone so the mouth can open).
  const jaw = parts[mat];
  const jbase = jaw.pos.length / 3;
  const jr = detail ? 8 : 4;
  for (let i = 0; i <= jr; i++) {
    const t = i / jr;
    const [hw, hh] = prof(t * 0.92);
    const c = at.clone().addScaledVector(fwd, -len * 0.05 + t * len * 0.88).addScaledVector(up, -hh * 0.42);
    for (let k = 0; k <= segs; k++) {
      const a = Math.PI + (k / segs) * Math.PI; // lower half only
      const p = c.clone().addScaledVector(sideV, Math.cos(a) * hw * 0.92).addScaledVector(up, Math.sin(a) * hh * 0.42);
      jaw.v(p, (k / segs) * 2, t * 2, paint(p, 0.7, 'head'), [jb], [1]);
    }
  }
  for (let i = 0; i < jr; i++)
    for (let k = 0; k < segs; k++) {
      const a = jbase + i * (segs + 1) + k;
      const b = a + segs + 1;
      jaw.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  // Teeth on carnivores (visible when the jaw opens).
  if (sp.diet === 'carnivore' || sp.diet === 'piscivore') {
    const n = detail ? 12 : 0;
    for (let i = 0; i < n; i++) {
      const t = 0.25 + (i / n) * 0.65;
      for (const s of [1, -1]) {
        const [hw, hh] = prof(t);
        const root = at.clone().addScaledVector(fwd, -len * 0.1 + t * len).addScaledVector(sideV, s * hw * 0.82).addScaledVector(up, -hh * 0.35);
        const tl = height * 0.18 * (1 - Math.abs(t - 0.55));
        tube(parts[DMAT.horn], [root, root.clone().addScaledVector(up, -tl)], [hw * 0.07, 0.0005], 4, () => [0.85, 0.8, 0.66], () => [[hb], [1]], 1, true);
      }
    }
  }
  // Eyes with a dark glossy surface and a lid ridge.
  for (const s of [1, -1]) {
    const t = ptero ? 0.12 : croc ? 0.22 : 0.25;
    const [hw, hh, off] = prof(t);
    const c = at.clone().addScaledVector(fwd, -len * 0.1 + t * len).addScaledVector(sideV, s * hw * 0.82).addScaledVector(up, hh * 0.45 + off * height);
    const r = Math.max(0.006, height * (ptero ? 0.14 : 0.13));
    const g = new THREE.SphereGeometry(r, detail ? 10 : 6, detail ? 8 : 4);
    const pp = g.attributes.position;
    const eb = parts[DMAT.eye].pos.length / 3;
    for (let i = 0; i < pp.count; i++) {
      const v = V(pp.getX(i), pp.getY(i), pp.getZ(i));
      const outward = (v.x * s) / r;
      const col: RGB = outward > 0.75 ? [0.02, 0.015, 0.01] : [0.42, 0.3, 0.08];
      parts[DMAT.eye].v(v.add(c), 0, 0, col, [hb], [1]);
    }
    const ix = g.index!.array;
    for (let i = 0; i < ix.length; i++) parts[DMAT.eye].idx.push(eb + ix[i]);
    g.dispose();
    // Brow ridge over the eye.
    const brow = c.clone().addScaledVector(up, r * 0.8);
    tube(parts[mat], [brow.clone().addScaledVector(fwd, -r * 1.4), brow, brow.clone().addScaledVector(fwd, r * 1.4)], [r * 0.4, r * 0.55, r * 0.35], 6, (p) => paint(p, -0.6, 'head'), () => [[hb], [1]], 1, true);
  }
}

function buildFeatures(sp: SpeciesDef, bp: Blueprint, parts: Part[], boneIndex: Map<string, number>, samples: ReturnType<typeof spineSamples>, spineWeights: (s: number) => [number[], number[]], paint: ReturnType<typeof painter>, detail: boolean): void {
  const f = new Set(sp.look.features);
  const L = sp.lengthM;
  const hb = boneIndex.get('head')!;
  const { at, len, height, pitch } = bp.head;
  const fwd = V(0, -Math.sin(pitch), Math.cos(pitch));
  const up = V(0, Math.cos(pitch), Math.sin(pitch));
  const side = V(1, 0, 0);
  const horn = (root: THREE.Vector3, dir: THREE.Vector3, length: number, r: number, bone: number, curve = 0.15) => {
    const d = dir.clone().normalize();
    const pts = [root, root.clone().addScaledVector(d, length * 0.5).addScaledVector(up, length * curve * 0.3), root.clone().addScaledVector(d, length).addScaledVector(up, length * curve)];
    tube(parts[DMAT.horn], pts, [r, r * 0.55, r * 0.04], detail ? 8 : 4, () => [0.6, 0.54, 0.44], () => [[bone], [1]], 1, true);
  };
  // Spine sample helper: position on the back at arc parameter s.
  const atS = (s: number) => {
    let i = 0;
    while (i < samples.length - 1 && samples[i].s < s) i++;
    return samples[i];
  };
  const dorsal = (s: number, extra = 0) => {
    const sm = atS(s);
    return sm.p.clone().add(V(0, sm.ry + extra, 0));
  };

  if (f.has('horns3')) {
    for (const s of [1, -1]) horn(at.clone().addScaledVector(fwd, len * 0.22).addScaledVector(up, height * 0.8).addScaledVector(side, s * height * 0.55), fwd.clone().multiplyScalar(0.85).addScaledVector(up, 0.55).addScaledVector(side, s * 0.12), len * 0.62, height * 0.17, hb, 0.2);
    horn(at.clone().addScaledVector(fwd, len * 0.78).addScaledVector(up, height * 0.35), fwd.clone().multiplyScalar(0.4).addScaledVector(up, 0.9), len * 0.17, height * 0.13, hb, 0.1);
  }
  if (f.has('nasalBoss')) horn(at.clone().addScaledVector(fwd, len * 0.62).addScaledVector(up, height * 0.45), up, len * 0.12, height * 0.28, hb, 0);
  if (f.has('frill')) {
    // Bony neck frill: a curved fan rising behind the skull, accent coloured, thick rim.
    const R = height * (f.has('horns3') ? 2.2 : 1.7);
    const centre = at.clone().addScaledVector(fwd, -len * 0.05).addScaledVector(up, height * 0.6);
    const n = detail ? 18 : 8;
    const p = parts[DMAT.scales];
    const b0 = p.pos.length / 3;
    const back = fwd.clone().multiplyScalar(-0.55).addScaledVector(up, 0.85).normalize();
    for (let i = 0; i <= n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI;
      const dir = side.clone().multiplyScalar(Math.sin(a)).addScaledVector(back, Math.cos(a)).normalize();
      for (const k of [0, 1]) {
        const rr = k === 0 ? R * 0.2 : R;
        const q = centre.clone().addScaledVector(dir, rr).addScaledVector(fwd, k * -height * 0.15);
        p.v(q, i / n, k, paint(q, -0.2, 'accent'), [hb], [1]);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = b0 + i * 2;
      p.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      p.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); // both faces
    }
    if (f.has('frillSpikes')) for (let i = 1; i < 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * Math.PI;
      const dir = side.clone().multiplyScalar(Math.sin(a)).addScaledVector(back, Math.cos(a)).normalize();
      horn(centre.clone().addScaledVector(dir, R * 0.97), dir, R * 0.35, height * 0.08, hb, 0.05);
    }
  }
  if (f.has('browHorns')) for (const s of [1, -1]) horn(at.clone().addScaledVector(fwd, len * 0.22).addScaledVector(up, height * 0.75).addScaledVector(side, s * height * 0.45), up.clone().addScaledVector(side, s * 0.7), height * (sp.id === 'carnotaurus' ? 0.9 : 0.4), height * 0.14, hb, 0);
  if (f.has('dome')) {
    const c = at.clone().addScaledVector(fwd, len * 0.15).addScaledVector(up, height * 0.75);
    const g = new THREE.SphereGeometry(height * 0.95, detail ? 14 : 6, detail ? 10 : 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const pp = g.attributes.position;
    const pb = parts[DMAT.scales].pos.length / 3;
    for (let i = 0; i < pp.count; i++) {
      const v = V(pp.getX(i), pp.getY(i), pp.getZ(i)).add(c);
      parts[DMAT.scales].v(v, 0, 0, paint(v, -0.5, 'accent'), [hb], [1]);
    }
    const ix = g.index!.array;
    for (let i = 0; i < ix.length; i++) parts[DMAT.scales].idx.push(pb + ix[i]);
    g.dispose();
  }
  if (f.has('crestTube')) {
    const root = at.clone().addScaledVector(fwd, len * 0.45).addScaledVector(up, height * 0.7);
    const pts = [root, root.clone().addScaledVector(fwd, -len * 0.5).addScaledVector(up, height * 1.0), root.clone().addScaledVector(fwd, -len * 1.35).addScaledVector(up, height * 1.6)];
    tube(parts[DMAT.scales], pts, [height * 0.22, height * 0.22, height * 0.16], detail ? 10 : 5, (p) => paint(p, -0.3, 'accent'), () => [[hb], [1]], 1, true);
  }
  if (f.has('dualCrest')) for (const s of [1, -1]) {
    const p = parts[DMAT.scales];
    const n = detail ? 10 : 4;
    const b0 = p.pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const base = at.clone().addScaledVector(fwd, len * (0.1 + t * 0.7)).addScaledVector(up, height * 0.55).addScaledVector(side, s * height * 0.25);
      const h = height * 0.85 * Math.sin(Math.PI * (0.15 + t * 0.75));
      for (const k of [0, 1]) {
        const q = base.clone().addScaledVector(up, k * h).addScaledVector(side, s * k * h * 0.15);
        p.v(q, t, k, paint(q, -0.3, 'accent'), [hb], [1]);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = b0 + i * 2;
      p.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3, a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  if (f.has('headCrest')) {
    const root = at.clone().addScaledVector(up, height * 0.6);
    const back = fwd.clone().multiplyScalar(-1).addScaledVector(up, 0.4).normalize();
    tube(parts[DMAT.scales], [root, root.clone().addScaledVector(back, len * 0.35), root.clone().addScaledVector(back, len * 0.6)], [height * 0.35, height * 0.2, height * 0.04], 6, (p) => paint(p, -0.3, 'accent'), () => [[hb], [1]], 1, true, 0.25);
  }
  if (f.has('beak') && sp.locomotion.plan !== 'pterosaur') {
    const tip = at.clone().addScaledVector(fwd, len * 0.82);
    tube(parts[DMAT.horn], [tip, tip.clone().addScaledVector(fwd, len * 0.14).addScaledVector(up, -height * 0.12)], [height * 0.25, height * 0.03], 8, () => [0.32, 0.28, 0.22], () => [[hb], [1]], 1, true);
  }
  // Dorsal structures along the spine.
  const spineBone = (s: number) => spineWeights(s);
  if (f.has('sail')) {
    const p = parts[DMAT.scales];
    const n = detail ? 24 : 8;
    const b0 = p.pos.length / 3;
    const s0 = atS(0.35).s;
    const s1 = atS(0.72).s;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const s = lerp(s0, s1, t);
      const base = dorsal(s, -0.01 * L);
      const h = 0.13 * L * Math.sin(Math.PI * t) * (0.85 + 0.15 * Math.sin(t * 9));
      const [bi, bw] = spineBone(s);
      for (const k of [0, 1]) {
        const q = base.clone().add(V(0, k * h, 0));
        p.v(q, t * 4, k, paint(q, -0.4 + k * 0.2, 'accent'), bi, bw);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = b0 + i * 2;
      p.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3, a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  if (f.has('plates')) {
    const count = 17;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const s = lerp(0.12, 0.82, t);
      const base = dorsal(s, -0.005 * L);
      const h = 0.085 * L * Math.sin(Math.PI * (0.12 + t * 0.8));
      const sideOff = (i % 2 ? 1 : -1) * 0.012 * L;
      const [bi, bw] = spineBone(s);
      const p = parts[DMAT.scales];
      const b0 = p.pos.length / 3;
      // Diamond-shaped plate.
      const pts = [V(0, 0, -h * 0.55), V(0, h * 0.55, -h * 0.25), V(0, h, 0.05 * h), V(0, h * 0.5, h * 0.45), V(0, 0, h * 0.5)];
      for (const q of pts) p.v(q.add(base).add(V(sideOff, 0, 0)), 0, 0, paint(base, -0.5, 'accent'), bi, bw);
      const c = p.v(base.clone().add(V(sideOff, h * 0.4, 0)), 0, 0, paint(base, -0.5, 'accent'), bi, bw);
      for (let k = 0; k < 4; k++) p.idx.push(b0 + k, b0 + k + 1, c, b0 + k + 1, b0 + k, c);
    }
  }
  if (f.has('tailSpikes')) {
    const tb = boneIndex.get('tail4') ?? boneIndex.get('tail3')!;
    const sm = atS(0.08);
    for (const s of [1, -1])
      for (const off of [0, 0.04]) {
        const root = atS(0.05 + off).p.clone().add(V(s * sm.rx * 0.6, sm.ry * 0.6, 0));
        horn(root, V(s * 0.9, 0.5, -0.3), 0.09 * L, 0.012 * L, tb, 0);
      }
  }
  if (f.has('club')) {
    const tb = boneIndex.get('tail4') ?? boneIndex.get('tail3')!;
    const c = atS(0.02).p;
    tube(parts[DMAT.horn], [c.clone().add(V(0, 0, 0.02 * L)), c, c.clone().add(V(0, 0, -0.04 * L))], [0.03 * L, 0.05 * L, 0.02 * L], detail ? 10 : 6, () => [0.48, 0.42, 0.34], () => [[tb], [1]], 1, true, 0.6);
  }
  if (f.has('armor') || f.has('scutes')) {
    // Rows of osteoderms over the back and flanks.
    const rows = f.has('armor') ? 5 : 3;
    const n = detail ? 26 : 10;
    for (let i = 0; i < n; i++) {
      const s = lerp(0.12, 0.85, i / (n - 1));
      const sm = atS(s);
      const [bi, bw] = spineBone(s);
      for (let r = 0; r < rows; r++) {
        const a = Math.PI / 2 + ((r - (rows - 1) / 2) / rows) * Math.PI * 0.8;
        const dir = V(Math.cos(a), Math.sin(a), 0);
        const root = sm.p.clone().add(V(dir.x * sm.rx * 0.95, dir.y * sm.ry * 0.95, 0));
        const h = (f.has('armor') ? 0.022 : 0.012) * L * (r === 0 || r === rows - 1 ? 1.4 : 1);
        const pts = [root, root.clone().addScaledVector(dir, h)];
        tube(parts[DMAT.horn], pts, [h * 0.7, h * 0.08], 5, () => [0.45, 0.4, 0.33], () => [bi, bw], 1, true);
      }
    }
  }
  // Feathers: rows of tapered pennaceous feathers along the arms (folded
  // "wings") and a tail fan, coloured like the body with darker tips.
  if (bp.feathered) {
    const p = parts[DMAT.feathers];
    const feather = (root: THREE.Vector3, dir: THREE.Vector3, sideDir: THREE.Vector3, len: number, w: number, bone: number, col: RGB) => {
      const b0 = p.pos.length / 3;
      const tip = root.clone().addScaledVector(dir, len);
      const mid = root.clone().addScaledVector(dir, len * 0.45);
      const dark: RGB = [col[0] * 0.55, col[1] * 0.55, col[2] * 0.55];
      p.v(root, 0, 0, col, [bone], [1]);
      p.v(mid.clone().addScaledVector(sideDir, w), 1, 0.45, col, [bone], [1]);
      p.v(tip, 0.5, 1, dark, [bone], [1]);
      p.v(mid.clone().addScaledVector(sideDir, -w * 0.4), 0, 0.45, col, [bone], [1]);
      p.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3, b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
    };
    const wingy = sp.locomotion.plan === 'bird' || f.has('wings');
    for (const leg of bp.legs.filter((l) => l.front)) {
      const bonesI = [0, 1, 2, 3].map((k) => boneIndex.get(`${leg.name}${k}`)!);
      const s = Math.sign(leg.joints[0].x);
      const n = detail ? (wingy ? 10 : 7) : 3;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const seg = Math.min(2, Math.floor(t * 3));
        const lt = t * 3 - seg;
        const root = leg.joints[seg].clone().lerp(leg.joints[seg + 1], lt);
        const len = leg.radii[0] * (wingy ? 7 : 3.5) * (0.6 + t * 0.6);
        const dir = V(s * 0.35, -0.55, -1).normalize();
        const col = paint(root, 0.2, 'body');
        feather(root, dir, V(s, 0, 0), len, len * 0.16, bonesI[seg], col);
      }
    }
    const tb = boneIndex.get('tail4') ?? boneIndex.get('tail3')!;
    const fan = sp.locomotion.plan === 'bird' ? 0.2 * L : 0.09 * L;
    const n = detail ? 9 : 4;
    for (let i = 0; i < n; i++) {
      const a = ((i / (n - 1)) - 0.5) * 1.6;
      const root = atS(0.04).p;
      const dir = V(Math.sin(a), 0, -Math.cos(a)).normalize();
      feather(root, dir, V(Math.cos(a), 0, Math.sin(a)), fan * (0.8 + 0.2 * Math.cos(a)), fan * 0.12, tb, paint(root, 0, 'body'));
    }
  }
  // Pterosaur wing membranes: from the wing finger to the ankle.
  if (sp.locomotion.plan === 'pterosaur') {
    const p = parts[DMAT.membrane];
    for (const s of [1, -1]) {
      const wing = bp.legs.find((l) => l.name === (s > 0 ? 'wingL' : 'wingR'))!;
      const hind = bp.legs.find((l) => l.name === (s > 0 ? 'hindL' : 'hindR'))!;
      const wb = [0, 1, 2, 3].map((k) => boneIndex.get(`${wing.name}${k}`)!);
      const hb2 = boneIndex.get(`${hind.name}2`)!;
      const edge = [wing.joints[0], wing.joints[1], wing.joints[2], wing.joints[3], wing.joints[4]];
      const trail = [samples[Math.floor(samples.length * 0.45)].p, samples[Math.floor(samples.length * 0.35)].p, hind.joints[2], hind.joints[2], wing.joints[4]];
      const b0 = p.pos.length / 3;
      for (let i = 0; i < edge.length; i++) {
        const bone = wb[Math.min(3, i)];
        p.v(edge[i], i / 4, 0, [0.5, 0.36, 0.28], [bone], [1]);
        p.v(trail[i], i / 4, 1, [0.42, 0.3, 0.24], i >= 2 && i < 4 ? [hb2] : [bone], [1]);
      }
      for (let i = 0; i < edge.length - 1; i++) {
        const a = b0 + i * 2;
        p.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3, a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
}
