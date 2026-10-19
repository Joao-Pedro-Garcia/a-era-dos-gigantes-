import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural skinned human (≈1.75 m adult survivor).
 *
 * The body is one continuous skinned mesh lofted from anatomical cross
 * sections (pelvis, waist, rib cage, shoulders, neck; tapered limbs with
 * thigh/calf and biceps/forearm profiles), so joints bend smoothly instead
 * of being separate cylinders. Skin weights blend between neighbouring
 * bones around every joint. The head is sculpted from a sphere (skull,
 * brow, eye sockets, cheekbones, nose, jaw and chin, ears) with eyes and a
 * hair cap; hands have a palm, thumb and four fingers. Clothing is part of
 * the same skeleton: a woven tunic with a flared skirt and short sleeves,
 * trousers, a leather belt with a pouch, leather shin wraps and foot wraps,
 * each with its own textured material.
 *
 * Coordinates: Y up, the character faces +Z, its left side is +X.
 */

export type BoneName =
  | 'root' | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'upperArm.L' | 'foreArm.L' | 'hand.L' | 'upperArm.R' | 'foreArm.R' | 'hand.R'
  | 'thigh.L' | 'shin.L' | 'foot.L' | 'toe.L' | 'thigh.R' | 'shin.R' | 'foot.R' | 'toe.R';

/**
 * Rest-pose joint positions (model space, metres), fitted to the artist survivor
 * (public/models/survivor.glb, re-posed by tools: arms hanging, thumbs forward,
 * hands closed in a grip). The procedural body below is the fallback when that
 * file is missing.
 */
export const JOINTS: Record<BoneName, [number, number, number]> = {
  root: [0, 0, 0],
  hips: [0, 0.977, 0],
  spine: [0, 1.045, 0],
  chest: [0, 1.201, 0],
  neck: [0, 1.512, -0.041],
  head: [0, 1.593, 0.017],
  'upperArm.L': [0.211, 1.411, -0.065],
  'foreArm.L': [0.22, 1.139, -0.073],
  'hand.L': [0.23, 0.909, -0.057],
  'upperArm.R': [-0.211, 1.411, -0.065],
  'foreArm.R': [-0.22, 1.139, -0.073],
  'hand.R': [-0.23, 0.909, -0.057],
  'thigh.L': [0.088, 0.93, -0.025],
  'shin.L': [0.093, 0.52, -0.013],
  'foot.L': [0.098, 0.146, -0.039],
  'toe.L': [0.115, 0.047, 0.173],
  'thigh.R': [-0.088, 0.93, -0.025],
  'shin.R': [-0.093, 0.52, -0.013],
  'foot.R': [-0.098, 0.146, -0.039],
  'toe.R': [-0.115, 0.047, 0.173],
};

/**
 * Centre of the closed hand's grip axis in the hand bone (right hand; the left
 * mirrors x): the handle runs along z through the curled fingers.
 */
export const HAND_GRIP: [number, number, number] = [0.006, -0.108, 0];

const PARENT: Record<BoneName, BoneName | null> = {
  root: null,
  hips: 'root',
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  'upperArm.L': 'chest',
  'foreArm.L': 'upperArm.L',
  'hand.L': 'foreArm.L',
  'upperArm.R': 'chest',
  'foreArm.R': 'upperArm.R',
  'hand.R': 'foreArm.R',
  'thigh.L': 'hips',
  'shin.L': 'thigh.L',
  'foot.L': 'shin.L',
  'toe.L': 'foot.L',
  'thigh.R': 'hips',
  'shin.R': 'thigh.R',
  'foot.R': 'shin.R',
  'toe.R': 'foot.R',
};

export const BONE_NAMES = Object.keys(JOINTS) as BoneName[];
const BI = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

/** Material slots of the body mesh. */
export const MAT = { skin: 0, cloth: 1, leather: 2, hair: 3, eye: 4 } as const;

type RGB = [number, number, number];
type Skin = [number, number, number, number]; // bone a, bone b, weight a, weight b

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Two-bone blend helper: weight moves from a to b across [t0, t1]. */
const blend = (a: number, b: number, t: number, t0: number, t1: number): Skin => {
  const w = smooth(t0, t1, t);
  return [a, b, 1 - w, w];
};

class Part {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  constructor(readonly material: number) {}
  v(p: THREE.Vector3, u: number, v: number, c: RGB, s: Skin): number {
    this.pos.push(p.x, p.y, p.z);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    this.si.push(s[0], s[1], 0, 0);
    this.sw.push(s[2], s[3], 0, 0);
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

interface Section {
  c: THREE.Vector3;
  /** Half extents along the section's local X (side) and Z (front) axes. */
  rx: number;
  rz: number;
  /** Superellipse exponent (2 = ellipse, higher = boxier). */
  p?: number;
}

/**
 * Lofts closed cross sections along a path. Sections are perpendicular to
 * the path tangent; `side` fixes the local X axis orientation.
 */
function loft(part: Part, secs: Section[], segs: number, side: THREE.Vector3, tile: number, color: (t: number, a: number) => RGB, skin: (t: number, p: THREE.Vector3) => Skin, capEnd = false, capStart = false): void {
  const n = secs.length;
  const base = part.pos.length / 3;
  let along = 0;
  const ring: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) along += secs[i].c.distanceTo(secs[i - 1].c);
    const t = i / (n - 1);
    const tan = (i < n - 1 ? secs[i + 1].c.clone().sub(secs[i].c) : secs[i].c.clone().sub(secs[i - 1].c)).normalize();
    const ax = side.clone().sub(tan.clone().multiplyScalar(side.dot(tan))).normalize();
    // az = ax × tan keeps a consistent handedness, so the winding below faces outward.
    const az = ax.clone().cross(tan).normalize();
    const circ = Math.PI * (secs[i].rx + secs[i].rz);
    const uRep = Math.max(1, Math.round(circ / tile));
    const pexp = secs[i].p ?? 2;
    for (let k = 0; k <= segs; k++) {
      const a = (k / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const ex = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / pexp);
      const ez = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / pexp);
      const p = secs[i].c.clone().addScaledVector(ax, ex * secs[i].rx).addScaledVector(az, ez * secs[i].rz);
      part.v(p, (k / segs) * uRep, along / tile, color(t, a), skin(t, p));
    }
    ring.push(base + i * (segs + 1));
  }
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < segs; k++) {
      const a = ring[i] + k;
      const b = ring[i + 1] + k;
      part.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  const cap = (i: number, flip: boolean) => {
    const c = part.v(secs[i].c, 0.5, 0.5, color(i / (n - 1), 0), skin(i / (n - 1), secs[i].c));
    for (let k = 0; k < segs; k++) {
      const a = ring[i] + k;
      if (flip) part.idx.push(c, a, a + 1);
      else part.idx.push(c, a + 1, a);
    }
  };
  if (capEnd) cap(n - 1, false);
  if (capStart) cap(0, true);
}

// ------------------------------------------------------------------ colours

const SKIN: RGB = [0.52, 0.34, 0.25];
const TUNIC: RGB = [0.26, 0.2, 0.13];
const TROUSERS: RGB = [0.15, 0.12, 0.09];
const LEATHER: RGB = [0.3, 0.19, 0.11];
const HAIR: RGB = [0.16, 0.11, 0.08];

// ------------------------------------------------------------------ body parts

function torso(cloth: Part, skin: Part): void {
  // y, half width, half depth, z offset, superellipse
  const prof: [number, number, number, number, number][] = [
    [0.86, 0.15, 0.105, -0.005, 2.4],
    [0.93, 0.172, 0.118, -0.01, 2.6],
    [1.0, 0.168, 0.112, -0.005, 2.6],
    [1.07, 0.148, 0.102, 0.0, 2.4],
    [1.14, 0.152, 0.106, 0.004, 2.4],
    [1.22, 0.163, 0.116, 0.012, 2.6],
    [1.3, 0.172, 0.122, 0.016, 2.7],
    [1.35, 0.166, 0.112, 0.008, 2.4],
    [1.385, 0.158, 0.104, 0.002, 2.3],
    [1.415, 0.14, 0.09, -0.004, 2.2],
    [1.445, 0.11, 0.078, -0.008, 2.0],
  ];
  const sk = (y: number, x: number): Skin => {
    const sideArm = x > 0 ? BI['upperArm.L'] : BI['upperArm.R'];
    if (y > 1.36 && Math.abs(x) > 0.11) {
      const w = smooth(0.11, 0.17, Math.abs(x)) * smooth(1.36, 1.44, y) * 0.55;
      return [BI.chest, sideArm, 1 - w, w];
    }
    if (y < 1.03) return blend(BI.hips, BI.spine, y, 0.98, 1.06);
    if (y < 1.2) return blend(BI.spine, BI.chest, y, 1.13, 1.22);
    return [BI.chest, BI.chest, 1, 0];
  };
  const secs = prof.map(([y, rx, rz, zc, p]) => ({ c: V(0, y, zc), rx, rz, p }));
  loft(cloth, secs, 28, V(1, 0, 0), 0.6, (t) => {
    const k = 0.92 + 0.08 * Math.sin(t * 9);
    return [TUNIC[0] * k, TUNIC[1] * k, TUNIC[2] * k];
  }, (_t, p) => sk(p.y, p.x));
  // Neck (skin), continuing from the collar into the head.
  const neck: Section[] = [
    { c: V(0, 1.42, -0.01), rx: 0.1, rz: 0.07 },
    { c: V(0, 1.46, -0.008), rx: 0.075, rz: 0.064 },
    { c: V(0, 1.51, -0.004), rx: 0.066, rz: 0.062 },
    { c: V(0, 1.56, 0.0), rx: 0.062, rz: 0.06 },
    { c: V(0, 1.6, 0.004), rx: 0.056, rz: 0.055 },
  ];
  loft(skin, neck, 16, V(1, 0, 0), 0.3, () => SKIN, (t) => blend(BI.neck, BI.head, t, 0.55, 0.95));
  // Collar band.
  loft(cloth, [
    { c: V(0, 1.44, -0.006), rx: 0.085, rz: 0.075 },
    { c: V(0, 1.47, -0.006), rx: 0.072, rz: 0.066 },
  ], 20, V(1, 0, 0), 0.3, () => [TUNIC[0] * 0.8, TUNIC[1] * 0.8, TUNIC[2] * 0.8], () => [BI.chest, BI.neck, 0.6, 0.4]);
}

/** Flared tunic skirt from the waist to mid-thigh, following the legs a little. */
function skirt(cloth: Part): void {
  const rows: [number, number, number][] = [
    [1.06, 0.158, 0.112],
    [0.96, 0.185, 0.13],
    [0.88, 0.198, 0.142],
    [0.8, 0.206, 0.15],
    [0.72, 0.212, 0.155],
  ];
  const secs = rows.map(([y, rx, rz]) => ({ c: V(0, y, -0.008), rx, rz, p: 2.2 }));
  loft(cloth, secs, 32, V(1, 0, 0), 0.6, (t, a) => {
    const fold = 0.9 + 0.1 * Math.sin(a * 9 + t * 2);
    return [TUNIC[0] * fold * 0.95, TUNIC[1] * fold * 0.95, TUNIC[2] * fold * 0.95];
  }, (_t, p) => {
    const down = smooth(0.98, 0.7, p.y);
    if (Math.abs(p.x) < 0.03) return [BI.hips, BI.hips, 1, 0];
    const thigh = p.x > 0 ? BI['thigh.L'] : BI['thigh.R'];
    return [BI.hips, thigh, 1 - down * 0.6, down * 0.6];
  });
}

function belt(leather: Part): void {
  loft(leather, [
    { c: V(0, 1.03, 0.0), rx: 0.166, rz: 0.12, p: 2.4 },
    { c: V(0, 1.06, 0.0), rx: 0.168, rz: 0.121, p: 2.4 },
    { c: V(0, 1.09, 0.0), rx: 0.165, rz: 0.119, p: 2.4 },
  ], 32, V(1, 0, 0), 0.5, () => LEATHER, () => [BI.hips, BI.spine, 0.7, 0.3]);
  // Pouch on the right hip.
  loft(leather, [
    { c: V(-0.16, 0.92, 0.05), rx: 0.035, rz: 0.03 },
    { c: V(-0.165, 0.97, 0.05), rx: 0.05, rz: 0.035 },
    { c: V(-0.168, 1.03, 0.05), rx: 0.045, rz: 0.03 },
  ], 10, V(0, 0, 1), 0.3, () => [LEATHER[0] * 0.85, LEATHER[1] * 0.85, LEATHER[2] * 0.85], () => [BI.hips, BI.hips, 1, 0], true, true);
}

function leg(side: 1 | -1, cloth: Part, leather: Part): void {
  const sfx = side > 0 ? '.L' : '.R';
  const thigh = BI[`thigh${sfx}` as BoneName];
  const shin = BI[`shin${sfx}` as BoneName];
  const foot = BI[`foot${sfx}` as BoneName];
  const hx = JOINTS[`thigh${sfx}` as BoneName][0];
  // y, radius side, radius front, z offset
  const prof: [number, number, number, number][] = [
    [0.98, 0.1, 0.105, 0.0],
    [0.9, 0.092, 0.098, 0.005],
    [0.78, 0.083, 0.088, 0.01],
    [0.66, 0.07, 0.072, 0.012],
    [0.56, 0.057, 0.06, 0.015],
    [0.5, 0.054, 0.058, 0.016],
    [0.44, 0.058, 0.064, 0.005],
    [0.36, 0.06, 0.068, -0.006],
    [0.26, 0.05, 0.055, -0.004],
    [0.16, 0.04, 0.043, 0.0],
    [0.1, 0.037, 0.04, 0.0],
  ];
  const sk = (y: number): Skin => {
    if (y > 0.6) return y > 0.9 ? blend(BI.hips, thigh, y, 0.99, 0.9) : [thigh, thigh, 1, 0];
    if (y > 0.2) return blend(thigh, shin, y, 0.56, 0.46);
    return blend(shin, foot, y, 0.15, 0.09);
  };
  const secs = prof.map(([y, rx, rz, zc]) => ({ c: V(hx + side * (0.98 - y) * 0.009, y, zc), rx, rz }));
  loft(cloth, secs, 18, V(1, 0, 0), 0.6, (t) => {
    const k = 0.9 + 0.1 * Math.cos(t * 20);
    return [TROUSERS[0] * k, TROUSERS[1] * k, TROUSERS[2] * k];
  }, (_t, p) => sk(p.y));
  // Leather shin wraps (slightly larger than the trouser leg), spiralling bands.
  const wrap = prof.filter(([y]) => y <= 0.42).map(([y, rx, rz, zc]) => ({ c: V(hx + side * (0.98 - y) * 0.009, y, zc), rx: rx + 0.007, rz: rz + 0.007 }));
  loft(leather, wrap, 18, V(1, 0, 0), 0.25, (t, a) => {
    const band = Math.sin(t * 40 + a * 1) > 0.7 ? 0.7 : 1;
    return [LEATHER[0] * band, LEATHER[1] * band, LEATHER[2] * band];
  }, (_t, p) => sk(p.y));
  // Foot (leather wrapped): heel → toes along +Z.
  const fx = JOINTS[`foot${sfx}` as BoneName][0];
  const fsecs: [number, number, number, number][] = [
    // z, half width, half height, centre height
    [-0.065, 0.032, 0.038, 0.045],
    [-0.04, 0.042, 0.05, 0.055],
    [0.0, 0.045, 0.055, 0.058],
    [0.05, 0.048, 0.042, 0.045],
    [0.1, 0.052, 0.032, 0.035],
    [0.15, 0.05, 0.026, 0.028],
    [0.19, 0.042, 0.02, 0.022],
    [0.215, 0.025, 0.014, 0.018],
  ];
  const toe = BI[`toe${sfx}` as BoneName];
  loft(leather, fsecs.map(([z, w, h, cy]) => ({ c: V(fx + side * 0.008 * (z + 0.05) * 4, cy, z), rx: w, rz: h, p: 2.6 })), 16, V(1, 0, 0), 0.25, () => [LEATHER[0] * 0.8, LEATHER[1] * 0.8, LEATHER[2] * 0.8], (_t, p) => blend(foot, toe, p.z, 0.09, 0.14), true, true);
}

function arm(side: 1 | -1, cloth: Part, skin: Part, fist = false): void {
  const sfx = side > 0 ? '.L' : '.R';
  const upper = BI[`upperArm${sfx}` as BoneName];
  const fore = BI[`foreArm${sfx}` as BoneName];
  const hand = BI[`hand${sfx}` as BoneName];
  const S = V(...JOINTS[`upperArm${sfx}` as BoneName]);
  const E = V(...JOINTS[`foreArm${sfx}` as BoneName]);
  const W = V(...JOINTS[`hand${sfx}` as BoneName]);
  const along = (t: number) => (t < 0.5 ? S.clone().lerp(E, t / 0.5) : E.clone().lerp(W, (t - 0.5) / 0.5));
  // t, radius side, radius front
  const prof: [number, number, number][] = [
    [-0.03, 0.03, 0.03],
    [0.04, 0.054, 0.053],
    [0.18, 0.05, 0.052],
    [0.32, 0.045, 0.049],
    [0.46, 0.039, 0.042],
    [0.52, 0.038, 0.04],
    [0.62, 0.042, 0.04],
    [0.78, 0.036, 0.031],
    [0.92, 0.029, 0.024],
    [1.0, 0.027, 0.021],
  ];
  const sk = (t: number): Skin => (t < 0.7 ? blend(upper, fore, t, 0.44, 0.56) : blend(fore, hand, t, 0.93, 1.0));
  const sideAxis = V(0, 0, 1);
  const secs = prof.map(([t, rx, rz]) => ({ c: t < 0 ? S.clone().add(V(-side * 0.06, -0.025, 0)) : along(t), rx: rz, rz: rx }));
  // Sleeve over the shoulder and upper arm (cloth), skin below.
  const split = 4;
  loft(cloth, secs.slice(0, split + 1).map((s, i) => ({ ...s, rx: s.rx + (i === split ? 0.009 : 0.006), rz: s.rz + (i === split ? 0.009 : 0.006) })), 16, sideAxis, 0.6, () => TUNIC, (t) => {
    const tt = prof[Math.round(t * split)][0];
    return tt < 0.02 ? [BI.chest, upper, 0.4, 0.6] : sk(tt);
  });
  loft(skin, secs.slice(split - 1), 16, sideAxis, 0.3, () => SKIN, (t) => sk(prof[split - 1 + Math.round(t * (prof.length - split))][0]));
  handMesh(side, skin, hand, W, fist);
}

function handMesh(side: 1 | -1, skin: Part, hand: number, W: THREE.Vector3, fist = false): void {
  const s: Skin = [hand, hand, 1, 0];
  // Palm: from the wrist down (relaxed hanging hand), thumb forward.
  // The palm starts inside the wrist and is capped, so the cut never shows when the wrist bends.
  const palm: Section[] = [
    { c: W.clone().add(V(0, 0.018, 0)), rx: 0.021, rz: 0.024 },
    { c: W.clone().add(V(0, -0.005, 0)), rx: 0.025, rz: 0.03 },
    { c: W.clone().add(V(side * 0.003, -0.04, 0.002)), rx: 0.017, rz: 0.042 },
    { c: W.clone().add(V(side * 0.005, -0.085, 0.002)), rx: 0.014, rz: 0.043 },
  ];
  loft(skin, palm, 12, V(0, 0, 1), 0.2, () => SKIN, () => s, true, true);
  // Fingers along the front edge of the palm, slightly curled inward.
  const base = W.clone().add(V(side * 0.005, -0.088, 0));
  const lens = [0.075, 0.085, 0.08, 0.065];
  // Fist: each finger wraps around the grip axis (a circle of radius R toward the palm),
  // which is where held items are attached (itemModels.attachToHand).
  const R = 0.024;
  for (let f = 0; f < 4; f++) {
    const z = 0.03 - f * 0.02;
    const root = base.clone().add(V(0, 0, z));
    const len = lens[f];
    const pts = fist
      ? [0, 0.25, 0.5, 0.75, 1].map((t) => {
          const a = (t * len) / R;
          return root.clone().add(V(-side * R * (1 - Math.cos(a)), -R * Math.sin(a) - 0.004, 0));
        })
      : [0, 0.4, 0.75, 1].map((t) => root.clone().add(V(-side * Math.sin(t * 1.0) * len * 0.35, -Math.sin(t * 1.2) * len * 0.9, 0)));
    // Fingers of a fist are thicker at the knuckles and taper less (they press together).
    const taper = fist ? 0.0006 : 0.0012;
    const r0 = fist ? 0.0105 : 0.0095;
    loft(skin, pts.map((c, i) => ({ c, rx: r0 - i * taper, rz: r0 - 0.0005 - i * taper })), 8, V(0, 0, 1), 0.2, () => SKIN, () => s, true);
  }
  // A closed fist: the finger pads press together around the grip axis (also fills the ring
  // the curled fingers would otherwise leave open when the hand holds nothing).
  if (fist) {
    const c = W.clone().add(V(side * (0.005 - R), -0.092, 0));
    loft(skin, [-0.034, -0.007, 0.02].map((z) => ({ c: c.clone().add(V(0, 0, z)), rx: 0.0165, rz: 0.0165 })), 10, V(1, 0, 0), 0.2, () => [SKIN[0] * 0.92, SKIN[1] * 0.9, SKIN[2] * 0.9], () => s, true, true);
  }
  // Thumb.
  const tr = W.clone().add(V(-side * 0.012, -0.03, 0.03));
  // In a fist the thumb closes over the middle phalanges of the index and middle fingers.
  const tpts = fist
    ? [0, 0.5, 1].map((t) => tr.clone().add(V(-side * t * 0.03, -t * 0.05, t * 0.012 - t * t * 0.02)))
    : [0, 0.5, 1].map((t) => tr.clone().add(V(-side * t * 0.012, -t * 0.045, t * 0.022)));
  loft(skin, tpts.map((c, i) => ({ c, rx: 0.012 - i * 0.002, rz: 0.011 - i * 0.002 })), 8, V(1, 0, 0), 0.2, () => SKIN, () => s, true);
}

// ------------------------------------------------------------------ head

const HEAD_C = V(0, 1.638, 0.01);

function gauss(dx: number, dy: number, sx: number, sy: number): number {
  return Math.exp(-((dx * dx) / (sx * sx) + (dy * dy) / (sy * sy)));
}

/** Sculpted head surface: offset from an ellipsoid as a function of direction. */
function headPoint(dir: THREE.Vector3): THREE.Vector3 {
  const x = dir.x * 0.078;
  // The lower face is broad with a rounded jaw line, not an egg point.
  let y = dir.y >= 0 ? dir.y * 0.113 : -Math.pow(-dir.y, 0.85) * 0.108;
  let z = dir.z * 0.098;
  let px = x;
  const front = Math.max(0, dir.z);
  // Fuller occiput; flatter face plane; jaw tapering to a rounded chin.
  if (dir.z < 0) z *= 1.1;
  z *= 1 - 0.12 * front * front;
  if (Math.abs(dir.y) < 0.45) px *= 1 + 0.05 * front;
  if (dir.y < 0) {
    // Square the jaw: superellipse width profile in the lower half, tapering only near the chin.
    const ay = -dir.y;
    const circle = Math.sqrt(Math.max(1e-4, 1 - ay * ay));
    const squared = Math.pow(Math.max(0, 1 - Math.pow(ay, 3.2)), 1 / 3.2);
    px *= Math.min(1.45, squared / circle) * lerp(1, 0.78, smooth(0.55, 1.0, ay));
  }
  // Brow ridge.
  z += 0.006 * front * gauss(dir.x, dir.y - 0.3, 0.55, 0.09);
  // Eye sockets.
  z -= 0.009 * front * (gauss(dir.x - 0.34, dir.y - 0.15, 0.16, 0.1) + gauss(dir.x + 0.34, dir.y - 0.15, 0.16, 0.1));
  // Cheekbones.
  px += Math.sign(dir.x) * 0.005 * gauss(Math.abs(dir.x) - 0.62, dir.y + 0.02, 0.2, 0.15) * front;
  // Nose: narrow bridge, rounded tip, nostril wings.
  z += 0.017 * front * gauss(dir.x, dir.y + 0.07, 0.12, 0.16) * smooth(0.3, -0.02, dir.y);
  z += 0.005 * front * gauss(Math.abs(dir.x) - 0.12, dir.y + 0.2, 0.08, 0.06);
  // Mouth: upper/lower lip, slight groove between.
  z += 0.004 * front * gauss(dir.x, dir.y + 0.36, 0.28, 0.05);
  z += 0.004 * front * gauss(dir.x, dir.y + 0.46, 0.25, 0.05);
  z -= 0.003 * front * gauss(dir.x, dir.y + 0.41, 0.3, 0.02);
  // Chin.
  z += 0.008 * front * gauss(dir.x, dir.y + 0.7, 0.3, 0.12);
  y -= 0.008 * gauss(dir.x, dir.y + 0.92, 0.5, 0.2);
  return V(px, y, z);
}

/** Face colouring: lips, brows, slightly warmer cheeks. */
function faceColor(dir: THREE.Vector3): RGB {
  const front = Math.max(0, dir.z);
  const lips = front * (gauss(dir.x, dir.y + 0.36, 0.25, 0.045) + gauss(dir.x, dir.y + 0.46, 0.22, 0.045));
  const brows = front * (gauss(dir.x - 0.34, dir.y - 0.33, 0.17, 0.035) + gauss(dir.x + 0.34, dir.y - 0.33, 0.17, 0.035));
  const cheeks = front * (gauss(dir.x - 0.45, dir.y + 0.12, 0.2, 0.15) + gauss(dir.x + 0.45, dir.y + 0.12, 0.2, 0.15));
  // Lash lines and eyelid shadow around the eyes.
  const lids = front * (gauss(dir.x - 0.3, dir.y - 0.2, 0.13, 0.03) + gauss(dir.x + 0.3, dir.y - 0.2, 0.13, 0.03));
  const dark = 1 - Math.min(0.75, lids * 0.9);
  const c: RGB = [SKIN[0] * (1 + cheeks * 0.12 + lips * 0.15) * dark, SKIN[1] * (1 - lips * 0.25) * dark, SKIN[2] * (1 - lips * 0.15) * dark];
  const b = Math.min(1, brows * 1.2);
  return [lerp(c[0], HAIR[0], b), lerp(c[1], HAIR[1], b), lerp(c[2], HAIR[2], b)];
}

function head(skin: Part, hair: Part, eye: Part): void {
  const s: Skin = [BI.head, BI.head, 1, 0];
  const W = 64;
  const H = 44;
  const base = skin.pos.length / 3;
  for (let j = 0; j <= H; j++) {
    const th = (j / H) * Math.PI;
    for (let i = 0; i <= W; i++) {
      const ph = (i / W) * Math.PI * 2;
      const d = V(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
      skin.v(headPoint(d).add(HEAD_C), i / W, j / H, faceColor(d), s);
    }
  }
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const a = base + j * (W + 1) + i;
      const b = a + W + 1;
      skin.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  // Ears.
  for (const side of [1, -1]) {
    const c = HEAD_C.clone().add(V(side * 0.078, 0.0, -0.01));
    loft(skin, [
      { c: c.clone().add(V(0, -0.028, 0)), rx: 0.006, rz: 0.01 },
      { c: c.clone().add(V(side * 0.008, 0.0, -0.004)), rx: 0.008, rz: 0.017 },
      { c: c.clone().add(V(side * 0.006, 0.024, -0.006)), rx: 0.006, rz: 0.013 },
    ], 8, V(1, 0, 0), 0.1, () => [SKIN[0] * 0.95, SKIN[1] * 0.9, SKIN[2] * 0.88], () => s, true, true);
  }
  // Eyes: white sclera with a dark iris facing forward.
  for (const side of [1, -1]) {
    const c = HEAD_C.clone().add(V(side * 0.03, 0.016, 0.066));
    const g = new THREE.SphereGeometry(0.0125, 14, 10);
    g.scale(1, 0.62, 1); // half-closed lids: only the visible slit of the eyeball
    const p = g.attributes.position;
    const eb = eye.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const v = V(p.getX(i), p.getY(i), p.getZ(i));
      const front = v.z / 0.0125;
      const col: RGB = front > 0.9 ? [0.01, 0.008, 0.006] : front > 0.55 ? [0.14, 0.08, 0.035] : [0.55, 0.5, 0.46];
      eye.v(v.add(c), 0, 0, col, s);
    }
    const ix = g.index!.array;
    for (let i = 0; i < ix.length; i++) eye.idx.push(eb + ix[i]);
    g.dispose();
  }
  // Hair: a cap over the skull with an irregular hairline (alpha texture on the edge).
  const hb = hair.pos.length / 3;
  const HW = 32;
  const HH = 14;
  for (let j = 0; j <= HH; j++) {
    const th = (j / HH) * Math.PI * 0.62;
    for (let i = 0; i <= HW; i++) {
      const ph = (i / HW) * Math.PI * 2;
      const d = V(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph));
      // Lower at the back and sides, higher on the forehead.
      const frontness = Math.max(0, Math.cos(ph));
      const limit = lerp(0.6, 0.3, frontness) * Math.PI;
      const tt = Math.min(th, limit);
      const dd = V(Math.sin(tt) * Math.sin(ph), Math.cos(tt), Math.sin(tt) * Math.cos(ph));
      const p = headPoint(dd).multiplyScalar(1.07 + 0.02 * Math.sin(ph * 7 + j)).add(HEAD_C).add(V(0, 0.006, -0.004));
      hair.v(p, (i / HW) * 3, j / HH, HAIR, s);
      void d;
    }
  }
  for (let j = 0; j < HH; j++)
    for (let i = 0; i < HW; i++) {
      const a = hb + j * (HW + 1) + i;
      const b = a + HW + 1;
      hair.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
}

// ------------------------------------------------------------------ assembly

export interface HumanRig {
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  /** Rest-pose local positions of every bone (to re-apply each frame). */
  rest: Record<BoneName, THREE.Vector3>;
  legLength: number;
}

export function buildHumanGeometry(): THREE.BufferGeometry {
  const parts = {
    skin: new Part(MAT.skin),
    cloth: new Part(MAT.cloth),
    leather: new Part(MAT.leather),
    hair: new Part(MAT.hair),
    eye: new Part(MAT.eye),
  };
  torso(parts.cloth, parts.skin);
  skirt(parts.cloth);
  belt(parts.leather);
  for (const side of [1, -1] as const) {
    leg(side, parts.cloth, parts.leather);
    // Hands loosely closed: they hold tools and punch (a relaxed fist also reads naturally when walking).
    arm(side, parts.cloth, parts.skin, true);
  }
  head(parts.skin, parts.hair, parts.eye);
  const list = [parts.skin, parts.cloth, parts.leather, parts.hair, parts.eye];
  const geo = mergeGeometries(list.map((p) => p.geometry()), true)!;
  geo.computeBoundingSphere();
  return geo;
}

/**
 * First-person arms: the same arm and hand surfaces as the body (sleeve,
 * forearm, hand), with the hands closed in a grip, skinned to the same
 * skeleton. Material slots: skin, cloth.
 */
export function buildArmsGeometry(): THREE.BufferGeometry {
  const skin = new Part(MAT.skin);
  const cloth = new Part(MAT.cloth);
  for (const side of [1, -1] as const) arm(side, cloth, skin, true);
  const geo = mergeGeometries([skin.geometry(), cloth.geometry()], true)!;
  geo.computeBoundingSphere();
  return geo;
}

export function buildHumanRig(materials: THREE.Material[], geometry?: THREE.BufferGeometry): HumanRig {
  const geo = geometry ?? buildHumanGeometry();
  const bones = {} as Record<BoneName, THREE.Bone>;
  const rest = {} as Record<BoneName, THREE.Vector3>;
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of BONE_NAMES) {
    const parent = PARENT[name];
    const p = V(...JOINTS[name]);
    if (parent) p.sub(V(...JOINTS[parent]));
    bones[name].position.copy(p);
    rest[name] = p.clone();
    if (parent) bones[parent].add(bones[name]);
  }
  const mesh = new THREE.SkinnedMesh(geo, materials);
  mesh.add(bones.root);
  mesh.bind(new THREE.Skeleton(BONE_NAMES.map((n) => bones[n])));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const legLength = JOINTS['thigh.L'][1] - JOINTS['foot.L'][1];
  return { mesh, bones, rest, legLength };
}
