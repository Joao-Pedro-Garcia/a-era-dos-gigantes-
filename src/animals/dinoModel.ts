import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SpeciesDef } from './species';
import { RIG_FITS } from './rigFits';

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
  /** Flattening of the limb section (flippers). */
  flat?: number;
  /** Pterosaurs: tip of the wing finger (rest pose, extended). */
  fingerTip?: THREE.Vector3;
}

export interface Blueprint {
  cps: CP[];
  legs: LegDef[];
  head: { bone: string; at: THREE.Vector3; len: number; height: number; width: number; pitch: number };
  /** Reference scale for texture tiling (m). */
  tile: number;
  feathered: boolean;
  /** Young body proportions (bigger head and eyes, small horns, plates and crests). */
  juvenile: boolean;
}

export interface DinoTemplate {
  geometry: THREE.BufferGeometry;
  /** Mid-distance level of detail. */
  mid: THREE.BufferGeometry;
  low: THREE.BufferGeometry;
  bones: { name: string; parent: string | null; pos: THREE.Vector3 }[];
  bp: Blueprint;
  legs: { name: string; front: boolean; phase: number; lengths: number[]; joints: THREE.Vector3[]; fingerTip?: THREE.Vector3 }[];
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

/** Smooth 3D value noise in [0, 1] (trilinear over the hash lattice). */
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const h = (a: number, b: number, c: number) => hash(xi + a, yi + b, zi + c);
  const x00 = lerp(h(0, 0, 0), h(1, 0, 0), u), x10 = lerp(h(0, 1, 0), h(1, 1, 0), u);
  const x01 = lerp(h(0, 0, 1), h(1, 0, 1), u), x11 = lerp(h(0, 1, 1), h(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

/** Three octaves of value noise (natural mottling), in [0, 1]. */
function fbm(x: number, y: number, z: number): number {
  return (vnoise(x, y, z) * 0.55 + vnoise(x * 2.03 + 17, y * 2.03, z * 2.03) * 0.3 + vnoise(x * 4.1, y * 4.1 + 31, z * 4.1) * 0.15);
}

/** A sphere that shades nearby skin (body, neck, tail, limbs and head) for the baked occlusion. */
interface Occluder {
  c: THREE.Vector3;
  r: number;
}

/**
 * Bakes ambient occlusion into the vertex colours: armpits, groin, the
 * underside, the space between the legs and where the neck meets the body
 * get the soft contact shadow they have under a real sky (analytic sphere
 * occlusion, plus the ground below surfaces that face down).
 */
function bakeOcclusion(g: THREE.BufferGeometry, occ: Occluder[], hip: number): void {
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const col = g.attributes.color;
  const p = V();
  const n = V();
  const d = V();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    let o = 0;
    for (const s of occ) {
      d.subVectors(s.c, p);
      const dist = d.length();
      // Skin of this very sphere (or inside it): no self-shadowing.
      if (dist < s.r * 1.08) continue;
      const cos = d.dot(n) / dist;
      if (cos <= 0) continue;
      o += (cos * s.r * s.r) / (dist * dist);
    }
    // The ground under the belly, chin and the underside of the tail.
    o += Math.max(0, -n.y) * 0.45 * smooth(hip * 1.6, 0, p.y);
    const k = lerp(0.22, 1, Math.exp(-2 * o));
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  col.needsUpdate = true;
}

// Material slots.
export const DMAT = { scales: 0, feathers: 1, horn: 2, eye: 3, membrane: 4 } as const;

class Part {
  /** Skin region written with the next vertices: 0 small scales … 1 large feature scales (scutes). */
  region = 0;
  reg: number[] = [];
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: number[] = [];
  v(p: THREE.Vector3, u: number, v: number, c: RGB, bones: number[], w: number[]): number {
    this.pos.push(p.x, p.y, p.z);
    this.reg.push(this.region);
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
    g.setAttribute('skinRegion', new THREE.Float32BufferAttribute(this.reg, 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// ------------------------------------------------------------------ blueprints

function blueprint(sp: SpeciesDef, juvenile = false): Blueprint {
  const L = sp.lengthM;
  // Juveniles stand relatively taller (long legs for their size).
  const H = sp.hipHeightM * (juvenile ? 1.08 : 1);
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
    // Film-style Dilophosaurus: a slender, lightly built animal (thin body, neck and legs).
    const slim = f.has('neckFrill');
    const b = slim ? 0.68 : hadro ? 1.25 : sp.id === 'tyrannosaurus' ? 1.18 : sp.id === 'gallimimus' ? 0.82 : f.has('feathers') && L < 3 ? 0.95 : sp.id === 'therizinosaurus' ? 1.2 : 1;
    // Body breadth (back view): large theropods are broad at the hips and ribs, not slab-sided.
    // Hadrosaurs were deep- rather than broad-bodied.
    // Spinosaurids were narrow-bodied (deep, slab-sided chest).
    const spino = f.has('longSnout');
    const wb = spino || slim ? 0.8 : apexW(sp) ? 1.3 : hadro ? 0.8 : 1.08;
    const Hh = H;
    const longNeck = f.has('longNeck');
    // Hadrosaur tails were tall and flattened side to side (long neural spines and
    // chevrons) and held straight out, stiffened by ossified tendons; blunt tip.
    // Spinosaurus: a tall, flattened, paddle-like tail (Ibrahim et al. 2020).
    const paddle = f.has('sail');
    const tw = hadro ? 0.7 : paddle ? 0.6 : 1;
    const td = hadro ? 1.22 : paddle ? 1.45 : 1;
    cp(-0.56 * L, Hh * (hadro ? 0.86 : 0.72), 0.004 * L * (hadro ? 1.5 : paddle ? 1.2 : 1), 0.005 * L * (hadro ? 2.4 : paddle ? 2.2 : 1), 0, null);
    cp(-0.44 * L, Hh * (hadro ? 0.93 : 0.84), 0.016 * L * b * tw, 0.02 * L * b * td, 0, 'tail4');
    cp(-0.31 * L, Hh * (hadro ? 0.99 : 0.95), 0.031 * L * b * tw, 0.04 * L * b * td, 0, 'tail3');
    // The tail base is thick (caudofemoralis muscles that pull the thighs).
    cp(-0.19 * L, Hh * 1.02, 0.05 * L * b * wb * (hadro ? 0.85 : 1), 0.062 * L * b * (hadro ? 1.08 : paddle ? 0.95 : 1), 0.006 * L, 'tail2');
    cp(-0.08 * L, Hh * 1.06, 0.056 * L * b * wb, 0.068 * L * b, 0.012 * L, 'tail1');
    cp(0.02 * L, Hh * 1.08, 0.062 * L * b * wb, 0.074 * L * b, 0.016 * L * b, 'pelvis');
    cp(0.1 * L, Hh * 1.07, 0.064 * L * b * wb, 0.08 * L * b, 0.028 * L * b, 'torso');
    // The hadrosaur back slopes down from the hips to the shoulders.
    cp(0.17 * L, Hh * (hadro ? 1.01 : 1.05), 0.054 * L * b * wb, 0.072 * L * b, 0.022 * L * b, 'chest');
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
      // Spinosaurids: a long, slender, S-curved neck.
      const ns = spino || slim ? 0.7 : 1;
      const lean = spino || slim;
      cp(0.215 * L, Hh * 1.1, 0.046 * L * b * ns, 0.058 * L * b * (lean ? 0.85 : 1), 0.01 * L, 'neck1');
      cp(0.245 * L, Hh * (lean ? 1.24 : 1.2), 0.04 * L * b * ns, 0.048 * L * b * ns, 0.004 * L, 'neck2');
      cp(0.268 * L, Hh * (lean ? 1.34 : 1.28), 0.036 * L * b * ns, 0.044 * L * b * ns, 0, 'neck3');
      cp(0.285 * L, Hh * (lean ? 1.36 : 1.31), 0.034 * L * b * ns, 0.042 * L * b * ns, 0, null);
    }
    if (f.has('plump')) {
      // Dodo: a round, heavy body, a stubby tail tuft and a short, thick neck.
      for (const c of cps) {
        if (c.p.z < -0.1 * L) c.p.z = -0.1 * L + (c.p.z + 0.1 * L) * 0.35;
        if (!c.bone || c.bone === 'pelvis' || c.bone === 'torso' || c.bone === 'chest' || c.bone.startsWith('tail')) {
          c.rx *= 1.75;
          c.ry *= 1.6;
          c.drop *= 1.6;
        }
        if (c.bone?.startsWith('neck') || (!c.bone && c.p.z > 0)) {
          c.p.z = 0.17 * L + (c.p.z - 0.17 * L) * 0.75;
          c.rx *= 1.35;
          c.ry *= 1.35;
        }
      }
    }
    const end = cps[cps.length - 1].p;
    // Carnotaurus: short, deep, bulldog-like skull.
    const hl = f.has('longSnout') ? 0.16 * L : sp.id === 'carnotaurus' ? 0.075 * L : apex ? 0.125 * L : hadro ? 0.12 * L : f.has('beak') && longNeck ? 0.07 * L : 0.1 * L;
    const hh = apex ? 0.034 * L : hadro ? 0.027 * L : 0.024 * L;
    head = f.has('hookBeak')
      ? // Dodo: a big head with a long, heavy, hooked bill (about a third of the bird).
        { bone: 'head', at: end.clone(), len: 0.3 * L, height: 0.1 * L, width: 0.075 * L, pitch: 0.25 }
      : { bone: 'head', at: end.clone(), len: hl, height: hh, width: apex ? hh * 1.05 : hh * 0.8, pitch: longNeck ? 0.25 : 0.12 };
    // Hind legs (digitigrade).
    for (const side of [1, -1]) {
      // Hip socket on the flank; the knee sits forward under the belly (thigh slants forward),
      // the shin slopes back to a long metatarsus (digitigrade, the ankle well off the ground).
      const x = side * (hadro ? 0.05 : 0.055) * L * b * wb;
      const legScale = H;
      legs.push({
        name: side > 0 ? 'hindL' : 'hindR',
        joints: [V(x, Hh * 1.0, 0.02 * L), V(x * 1.12, Hh * 0.56, 0.02 * L + 0.2 * legScale), V(x * 1.04, Hh * 0.22, 0.02 * L - 0.08 * legScale), V(x, Hh * 0.035, 0.02 * L + 0.02 * legScale), V(x, 0, 0.02 * L + 0.2 * legScale)],
        // Massive muscular thigh ("drumstick"), strong shin, slender metatarsus.
        // Hadrosaurs: strong but not theropod-sized thighs, stout shin and metatarsus.
        radii: hadro ? [0.037 * L, 0.022 * L, 0.0135 * L, 0.0105 * L, 0.007 * L] : [0.046 * L * b * (apex ? 1.15 : 1), 0.024 * L * b * (apex ? 1.1 : 1), 0.0125 * L * b, 0.009 * L * b, 0.006 * L],
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
      const x = side * (hadro ? 0.045 * L * b * wb : 0.055 * L * b);
      const s0 = V(x, Hh * (hadro ? 0.93 : 0.98), 0.17 * L);
      const e = s0.clone().add(V(side * 0.01 * L, -armLen * 0.48, armLen * (hadro ? 0.05 : 0.2)));
      const w = e.clone().add(V(0, -armLen * 0.45, armLen * (hadro ? 0.08 : 0.22)));
      const t0 = w.clone().add(V(0, -armLen * 0.08, armLen * 0.08));
      legs.push({
        name: side > 0 ? 'armL' : 'armR',
        joints: [s0, e, w, t0, t0.clone().add(V(0, -armLen * 0.06, armLen * (f.has('longClaws') ? 0.25 : 0.1)))],
        // Hadrosaur forelimbs: muscular upper arm (big deltopectoral crest), slender
        // forearm and a hoof-like "mitten" of bound fingers.
        radii: hadro ? [0.017 * L * b, 0.0105 * L * b, 0.0085 * L, 0.0075 * L, 0.006 * L] : [0.02 * L * b, 0.013 * L * b, 0.01 * L, 0.007 * L, 0.004 * L],
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
    // Tails are held clear of the ground (trackways show no tail drag).
    const tailY = stego ? 0.9 : croc ? 0.25 : ankylo ? 0.85 : 0.72;
    // Ankylosaurs: low, very broad body; the distal tail is a narrow, stiff "handle"
    // (interlocking vertebrae) carrying the club.
    const ay = ankylo ? 0.78 : 1;
    const ar = ankylo ? 0.72 : 1;
    const hd = ankylo ? 0.6 : 1;
    // Ceratopsian tails are short and stout (no whip-like tip).
    // Ceratopsian tails are comparatively short and stout, ending in a blunt point.
    const ct = cera ? 1.35 : 1;
    const tz = cera ? 0.78 : 1;
    cp(-0.55 * L * tz, Hh * tailY, (ankylo ? 0.011 : 0.004) * L * (cera ? 1.5 : 1), (ankylo ? 0.009 : 0.005) * L * (cera ? 1.5 : 1), 0, null);
    cp(-0.42 * L * tz, Hh * lerp(tailY, 1, 0.3), 0.022 * L * wide * ct * hd, 0.024 * L * ct * hd, 0, 'tail4');
    cp(-0.3 * L * (cera ? 0.85 : 1), Hh * lerp(tailY, 1, 0.6), 0.04 * L * wide * (cera ? 1.15 : 1) * (ankylo ? 0.75 : 1), 0.045 * L * (cera ? 1.15 : 1) * (ankylo ? 0.75 : 1), 0, 'tail3');
    cp(-0.18 * L, Hh * (croc ? 0.8 : ankylo ? 0.86 : 0.98), 0.06 * L * wide * (ankylo ? 0.85 : 1), 0.065 * L * ar, 0.004 * L, 'tail2');
    cp(-0.09 * L, Hh * (croc ? 0.85 : 1.08 * ay), 0.085 * L * wide, 0.09 * L * (croc ? 0.6 : 1) * ar, 0.015 * L, 'tail1');
    cp(0.0, Hh * (croc ? 0.86 : stego ? 1.32 : 1.1 * ay), 0.1 * L * wide, (croc ? 0.06 : 0.095 * ar) * L, (croc ? 0.008 : 0.03) * L, 'pelvis');
    cp(0.08 * L, Hh * (croc ? 0.85 : stego ? 1.2 : 1.1 * ay), 0.105 * L * wide, (croc ? 0.06 : 0.1 * ar) * L, (croc ? 0.01 : 0.04) * L, 'torso');
    cp(0.16 * L, Hh * (croc ? 0.82 : stego ? 0.95 : 1.02 * ay), 0.085 * L * wide, (croc ? 0.05 : 0.085 * ar) * L, (croc ? 0.008 : 0.03) * L, 'chest');
    cp(0.22 * L, Hh * (croc ? 0.76 : stego ? 0.8 : 0.9), 0.055 * L * wide, (croc ? 0.04 : 0.065) * L, 0.012 * L, 'neck1');
    // Ceratopsians carry the heavy head higher (beak around knee height), not drooping.
    cp(0.255 * L, Hh * (croc ? 0.74 : stego ? 0.72 : cera ? 0.9 : 0.84), 0.045 * L * wide, (croc ? 0.035 : 0.055) * L, 0.006 * L, 'neck2');
    cp(0.275 * L, Hh * (croc ? 0.73 : stego ? 0.68 : cera ? 0.9 : 0.8), 0.042 * L * wide, (croc ? 0.033 : 0.05) * L, 0, null);
    const end = cps[cps.length - 1].p;
    // Ceratopsian skulls are huge and deep (triceratops: ~1.3 m from beak to the back of the
    // skull, ~0.6 m deep, broad cheeks), carried low with the beak pointing down and forward.
    // Alligatoroids (Deinosuchus) have a broad, shorter snout than the slender-snouted Sarcosuchus.
    const broad = croc && !f.has('longSnout');
    const hl = croc ? (broad ? 0.15 * L : 0.22 * L) : cera ? (f.has('horns3') ? 0.155 * L : 0.15 * L) : ankylo ? 0.08 * L : stego ? 0.06 * L : 0.12 * L;
    const hh = croc ? 0.018 * L : cera ? (f.has('horns3') ? 0.07 * L : 0.062 * L) : ankylo ? 0.03 * L : 0.022 * L;
    head = { bone: 'head', at: end.clone(), len: hl, height: hh, width: croc ? hh * (broad ? 2.1 : 1.4) : ankylo ? hh * 1.8 : cera ? hh * 1.05 : hh * 0.95, pitch: croc ? 0.02 : cera ? 0.36 : ankylo ? 0.25 : 0.35 };
    const legY = croc ? Hh * 0.95 : Hh;
    for (const [front, side] of [[false, 1], [false, -1], [true, 1], [true, -1]] as [boolean, number][]) {
      const z = front ? 0.15 * L : -0.04 * L;
      const len = front ? legY * (stego ? 0.62 : croc ? 0.9 : 0.86) : legY;
      const x = side * (croc ? 0.07 : ankylo ? 0.068 : 0.085) * L * wide;
      const top = V(x, front ? len * 1.02 : legY * 1.02, z);
      // Ceratopsian forelimbs were semi-erect: the elbows stood a little out from the body.
      const spread = croc ? side * 0.08 * L : cera && front ? side * 0.028 * L : side * 0.008 * L;
      const knee = top.clone().add(V(spread, -len * 0.48, front ? -0.04 * len : 0.08 * len));
      const ankle = top.clone().add(V(spread * 1.2, -len * 0.88, front ? 0.0 : -0.05 * len));
      const toe = V(ankle.x, 0.025 * len, ankle.z + 0.06 * len);
      legs.push({
        name: `${front ? 'front' : 'hind'}${side > 0 ? 'L' : 'R'}`,
        joints: [top, knee, ankle, toe, toe.clone().add(V(0, -0.02 * len, 0.14 * len))],
        // Pillar-like limbs of heavy quadrupeds (thick thigh and upper arm, stout forearm and shin).
        radii: [(front ? 0.036 : 0.05) * L * (croc ? 0.55 : cera ? 1.12 : ankylo ? (front ? 0.85 : 0.72) : 1), (front ? 0.031 : 0.036) * L * (croc ? 0.55 : cera ? 1.08 : 1), 0.027 * L * (croc ? 0.6 : 1), 0.028 * L * (croc ? 0.6 : 1), 0.022 * L * (croc ? 0.5 : 1)],
        parent: front ? 'chest' : 'pelvis',
        front,
        // Lateral-sequence walk: LH, LF, RH, RF.
        phase: (front ? 0.25 : 0) + (side > 0 ? 0 : 0.5),
        // Ceratopsians and thyreophorans walked on short toes ending in blunt hooves.
        claws: croc ? 4 : front ? 5 : 4,
        clawLen: croc ? 0.012 * L : 0.006 * L,
      });
    }
  } else if (plan === 'sauropod') {
    // Brachiosaurid: shoulders higher than the hips (long forelimbs), a deep barrel
    // chest, a long neck held straight and raised (exact posture debated), a tail
    // short for a sauropod, and pillar-like limbs on padded, elephant-like feet.
    const Hh = H;
    cp(-0.44 * L, Hh * 0.55, 0.004 * L, 0.005 * L, 0, null);
    cp(-0.36 * L, Hh * 0.72, 0.011 * L, 0.013 * L, 0, 'tail4');
    cp(-0.27 * L, Hh * 0.88, 0.021 * L, 0.025 * L, 0, 'tail3');
    cp(-0.18 * L, Hh * 0.99, 0.036 * L, 0.041 * L, 0, 'tail2');
    cp(-0.1 * L, Hh * 1.05, 0.055 * L, 0.06 * L, 0.008 * L, 'tail1');
    cp(-0.03 * L, Hh * 1.08, 0.07 * L, 0.068 * L, 0.02 * L, 'pelvis');
    cp(0.04 * L, Hh * 1.14, 0.08 * L, 0.08 * L, 0.03 * L, 'torso');
    cp(0.11 * L, Hh * 1.22, 0.074 * L, 0.08 * L, 0.026 * L, 'chest');
    // Neck: deep at the base (taller than wide), tapering little toward the head.
    cp(0.165 * L, Hh * 1.4, 0.042 * L, 0.054 * L, 0.008 * L, 'neck1');
    cp(0.235 * L, Hh * 1.76, 0.025 * L, 0.031 * L, 0, 'neck2');
    cp(0.3 * L, Hh * 2.15, 0.019 * L, 0.023 * L, 0, 'neck3');
    cp(0.345 * L, Hh * 2.47, 0.016 * L, 0.019 * L, 0, null);
    const end = cps[cps.length - 1].p;
    head = { bone: 'head', at: end.clone(), len: 0.045 * L, height: 0.014 * L, width: 0.013 * L, pitch: 0.4 };
    for (const [front, side] of [[false, 1], [false, -1], [true, 1], [true, -1]] as [boolean, number][]) {
      const z = front ? 0.12 * L : -0.04 * L;
      const len = front ? Hh * 1.22 : Hh * 1.05;
      const x = side * (front ? 0.055 : 0.058) * L;
      const top = V(x, len * 1.0, z);
      legs.push({
        name: `${front ? 'front' : 'hind'}${side > 0 ? 'L' : 'R'}`,
        joints: [top, V(x, len * 0.52, z + (front ? -0.01 : 0.02) * L), V(x, len * 0.1, z), V(x, 0.03 * len, z + 0.01 * L), V(x, 0, z + 0.03 * L)],
        // Columns, not tubes: strong upper arm and thigh (caudofemoralis), straight
        // shin and forearm, and a broad padded foot.
        radii: front ? [0.028 * L, 0.021 * L, 0.018 * L, 0.021 * L, 0.02 * L] : [0.035 * L, 0.025 * L, 0.02 * L, 0.023 * L, 0.022 * L],
        parent: front ? 'chest' : 'pelvis',
        front,
        phase: (front ? 0.25 : 0) + (side > 0 ? 0 : 0.5),
        // Hands: a horseshoe of fingers bound in a pad (only the thumb claw);
        // feet: a pad with three big claws.
        claws: front ? 5 : 3,
        clawLen: front ? 0.003 * L : 0.011 * L,
      });
    }
  } else if (plan === 'mammal') {
    // Mammals of the expanded fauna. A sabre-toothed cat: deep chest, robust forelimbs,
    // digitigrade legs, short bobbed tail. A giant ground sloth: massive hindquarters
    // and thick tail (a tripod when it rears), long arms with huge claws, walking on
    // the sides of its feet and the knuckles of its hands, small long-snouted head.
    const sloth = f.has('longClaws');
    const Hh = H;
    if (sloth) {
      cp(-0.5 * L, Hh * 0.42, 0.018 * L, 0.02 * L, 0, null);
      cp(-0.43 * L, Hh * 0.58, 0.045 * L, 0.05 * L, 0, 'tail4');
      cp(-0.37 * L, Hh * 0.74, 0.068 * L, 0.074 * L, 0, 'tail3');
      cp(-0.31 * L, Hh * 0.88, 0.09 * L, 0.098 * L, 0.008 * L, 'tail2');
      cp(-0.23 * L, Hh * 1.0, 0.118 * L, 0.12 * L, 0.018 * L, 'tail1');
      cp(-0.11 * L, Hh * 1.1, 0.15 * L, 0.148 * L, 0.04 * L, 'pelvis');
      cp(0.03 * L, Hh * 1.1, 0.145 * L, 0.15 * L, 0.05 * L, 'torso');
      cp(0.15 * L, Hh * 1.05, 0.118 * L, 0.13 * L, 0.035 * L, 'chest');
      cp(0.24 * L, Hh * 1.04, 0.07 * L, 0.075 * L, 0.012 * L, 'neck1');
      cp(0.29 * L, Hh * 1.04, 0.052 * L, 0.056 * L, 0, 'neck2');
      cp(0.33 * L, Hh * 1.02, 0.043 * L, 0.047 * L, 0, 'neck3');
      cp(0.36 * L, Hh * 1.0, 0.037 * L, 0.041 * L, 0, null);
    } else {
      // Short bobtail, deep chest, thick neck carried low.
      cp(-0.4 * L, Hh * 0.82, 0.02 * L, 0.022 * L, 0, null);
      cp(-0.37 * L, Hh * 0.9, 0.028 * L, 0.03 * L, 0, 'tail4');
      cp(-0.34 * L, Hh * 0.96, 0.036 * L, 0.038 * L, 0, 'tail3');
      cp(-0.31 * L, Hh * 1.0, 0.046 * L, 0.05 * L, 0, 'tail2');
      cp(-0.27 * L, Hh * 1.03, 0.064 * L, 0.07 * L, 0.004 * L, 'tail1');
      cp(-0.19 * L, Hh * 1.02, 0.092 * L, 0.11 * L, 0.012 * L, 'pelvis');
      cp(-0.03 * L, Hh * 0.98, 0.1 * L, 0.13 * L, 0.03 * L, 'torso');
      cp(0.11 * L, Hh * 1.02, 0.104 * L, 0.148 * L, 0.036 * L, 'chest');
      cp(0.19 * L, Hh * 1.08, 0.075 * L, 0.088 * L, 0.014 * L, 'neck1');
      cp(0.24 * L, Hh * 1.12, 0.062 * L, 0.07 * L, 0, 'neck2');
      cp(0.275 * L, Hh * 1.13, 0.054 * L, 0.06 * L, 0, 'neck3');
      cp(0.295 * L, Hh * 1.12, 0.048 * L, 0.054 * L, 0, null);
    }
    const end = cps[cps.length - 1].p;
    head = sloth
      ? { bone: 'head', at: end.clone(), len: 0.11 * L, height: 0.043 * L, width: 0.04 * L, pitch: 0.35 }
      : { bone: 'head', at: end.clone(), len: 0.15 * L, height: 0.075 * L, width: 0.072 * L, pitch: 0.22 };
    for (const [front, side] of [[false, 1], [false, -1], [true, 1], [true, -1]] as [boolean, number][]) {
      const z = sloth ? (front ? 0.13 * L : -0.1 * L) : front ? 0.1 * L : -0.18 * L;
      const x = side * (sloth ? 0.105 : 0.058) * L;
      let joints: THREE.Vector3[];
      if (sloth) {
        const top = V(x, Hh * (front ? 1.0 : 1.02), z);
        joints = front
          ? [top, V(x * 1.12, Hh * 0.56, z - 0.05 * Hh), V(x * 1.15, Hh * 0.13, z + 0.02 * Hh), V(x * 1.2, 0.06 * Hh, z + 0.1 * Hh), V(x * 1.2, 0, z + 0.28 * Hh)]
          : [top, V(x * 1.1, Hh * 0.56, z + 0.07 * Hh), V(x * 1.14, Hh * 0.1, z - 0.02 * Hh), V(x * 1.2, 0.05 * Hh, z + 0.1 * Hh), V(x * 1.2, 0, z + 0.24 * Hh)];
      } else {
        // Digitigrade: the cat walks on its toes, the hock and wrist well off the ground.
        joints = front
          ? [V(x, Hh * 1.06, z), V(x, Hh * 0.6, z - 0.1 * Hh), V(x, Hh * 0.14, z), V(x, 0.04 * Hh, z + 0.05 * Hh), V(x, 0, z + 0.14 * Hh)]
          : [V(x, Hh * 1.0, z), V(x, Hh * 0.6, z + 0.14 * Hh), V(x, Hh * 0.27, z - 0.12 * Hh), V(x, 0.04 * Hh, z - 0.02 * Hh), V(x, 0, z + 0.1 * Hh)];
      }
      legs.push({
        name: `${front ? 'front' : 'hind'}${side > 0 ? 'L' : 'R'}`,
        joints,
        radii: sloth
          ? front ? [0.062 * L, 0.046 * L, 0.034 * L, 0.03 * L, 0.024 * L] : [0.09 * L, 0.062 * L, 0.042 * L, 0.04 * L, 0.034 * L]
          : front ? [0.078 * L, 0.054 * L, 0.036 * L, 0.032 * L, 0.028 * L] : [0.085 * L, 0.052 * L, 0.03 * L, 0.028 * L, 0.025 * L],
        parent: front ? 'chest' : 'pelvis',
        front,
        phase: (front ? 0.25 : 0) + (side > 0 ? 0 : 0.5),
        claws: sloth ? 3 : 4,
        clawLen: sloth ? (front ? 0.07 * L : 0.03 * L) : 0.012 * L,
      });
    }
  } else if (plan === 'serpent') {
    // Snake: no legs; a long body resting on the ground along its whole length, the
    // tail tapering to a point, a flat, broad head on a short neck.
    const r = 0.024 * L;
    const y = r * 0.9;
    cp(-0.5 * L, r * 0.3, 0.12 * r, 0.12 * r, 0, null);
    cp(-0.42 * L, r * 0.48, 0.45 * r, 0.42 * r, 0, 'tail4');
    cp(-0.32 * L, r * 0.7, 0.75 * r, 0.7 * r, 0, 'tail3');
    cp(-0.2 * L, r * 0.85, 0.94 * r, 0.85 * r, 0, 'tail2');
    cp(-0.08 * L, y, r, 0.9 * r, 0, 'tail1');
    cp(0.04 * L, y, r, 0.9 * r, 0, 'pelvis');
    cp(0.16 * L, y, 0.98 * r, 0.88 * r, 0, 'torso');
    cp(0.28 * L, r * 0.86, 0.9 * r, 0.82 * r, 0, 'chest');
    cp(0.37 * L, r * 0.78, 0.74 * r, 0.68 * r, 0, 'neck1');
    cp(0.42 * L, r * 0.72, 0.6 * r, 0.55 * r, 0, 'neck2');
    cp(0.455 * L, r * 0.7, 0.55 * r, 0.5 * r, 0, 'neck3');
    cp(0.47 * L, r * 0.7, 0.5 * r, 0.45 * r, 0, null);
    const end = cps[cps.length - 1].p;
    head = { bone: 'head', at: end.clone(), len: 0.034 * L, height: 0.55 * r, width: 0.85 * r, pitch: 0.02 };
  } else if (plan === 'mosasaur') {
    // Marine squamate: long streamlined body, short neck, long lizard skull, four
    // paddles and a long laterally flattened tail that bends down into a crescent fluke.
    const Hh = H;
    cp(-0.52 * L, Hh * 0.55, 0.004 * L, 0.012 * L, 0, null);
    cp(-0.44 * L, Hh * 0.82, 0.012 * L, 0.03 * L, 0, 'tail4');
    cp(-0.32 * L, Hh * 0.97, 0.022 * L, 0.045 * L, 0, 'tail3');
    cp(-0.2 * L, Hh * 1.0, 0.034 * L, 0.055 * L, 0, 'tail2');
    cp(-0.09 * L, Hh * 1.0, 0.046 * L, 0.062 * L, 0.004 * L, 'tail1');
    cp(0.0, Hh * 1.0, 0.055 * L, 0.066 * L, 0.008 * L, 'pelvis');
    cp(0.08 * L, Hh * 1.0, 0.06 * L, 0.068 * L, 0.01 * L, 'torso');
    cp(0.16 * L, Hh * 1.0, 0.055 * L, 0.06 * L, 0.008 * L, 'chest');
    cp(0.22 * L, Hh * 1.01, 0.043 * L, 0.046 * L, 0.004 * L, 'neck1');
    cp(0.26 * L, Hh * 1.02, 0.036 * L, 0.038 * L, 0, null);
    const end = cps[cps.length - 1].p;
    head = { bone: 'head', at: end.clone(), len: 0.13 * L, height: 0.03 * L, width: 0.028 * L, pitch: 0.03 };
    for (const [front, side] of [[true, 1], [true, -1], [false, 1], [false, -1]] as [boolean, number][]) {
      const z = front ? 0.14 * L : -0.02 * L;
      const len = (front ? 0.09 : 0.075) * L;
      const top = V(side * 0.045 * L, Hh * 0.93, z);
      const dir = V(side, -0.35, -0.55).normalize();
      const j = [0, 0.3, 0.62, 0.86, 1].map((t) => top.clone().addScaledVector(dir, len * t).add(V(0, 0, -t * t * len * 0.15)));
      legs.push({
        name: `${front ? 'front' : 'hind'}${side > 0 ? 'L' : 'R'}`,
        joints: j,
        radii: [0.016 * L, 0.018 * L, 0.016 * L, 0.011 * L, 0.004 * L],
        parent: front ? 'chest' : 'pelvis',
        front,
        phase: front ? 0 : 0.5,
        claws: 0,
        clawLen: 0,
        flat: 0.3,
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
    head = { bone: 'head', at: end.clone(), len: 0.42 * L, height: 0.03 * L, width: 0.02 * L, pitch: longNeck ? 0.75 : 0.35 };
    // Wingspan relative to body length (Pteranodon ~3.3×, azhdarchids ~2×).
    const span = (longNeck ? 2.1 : 3.2) * L;
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
      // Forelimb used for walking on the ground (quadrupedal stance): humerus,
      // forearm, long metacarpal down to the small three-fingered hand. The
      // huge fourth (wing) finger is its own bone.
      const s0 = V(side * 0.05 * L, Hh * 1.08, 0.14 * L);
      const e = s0.clone().add(V(side * 0.05 * L, -Hh * 0.3, -0.04 * L));
      const w = e.clone().add(V(side * 0.01 * L, -Hh * 0.45, 0.07 * L));
      const hand = V(w.x, 0.03 * Hh, w.z + 0.02 * L);
      const armLen = s0.distanceTo(e) + e.distanceTo(w) + w.distanceTo(hand);
      const fingerLen = Math.max(0.3 * L, span / 2 - armLen - 0.05 * L);
      // The wing finger is modelled extended (straight out to the side): the membrane
      // is built spread, and folding the finger back along the flank on the ground
      // gathers it into a narrow band (see animalView).
      const fold = V(side, 0, -0.15).normalize();
      legs.push({
        name: side > 0 ? 'wingL' : 'wingR',
        joints: [s0, e, w, hand, hand.clone().add(V(0, -0.01 * Hh, 0.04 * L))],
        radii: [0.02 * L, 0.014 * L, 0.011 * L, 0.008 * L, 0.004 * L],
        parent: 'chest',
        front: true,
        phase: side > 0 ? 0.25 : 0.75,
        claws: 3,
        clawLen: 0.01 * L,
        fingerTip: hand.clone().addScaledVector(fold, fingerLen),
      });
    }
  }
  // The neck ends inside the back of the skull: its last section is narrower than
  // the skull and sits a little forward, so the head grows out of the neck without a collar.
  const hd = head!;
  if (juvenile) {
    // Young dinosaurs: proportionally bigger head with a shorter snout, shorter tail.
    hd.height *= 1.4;
    hd.width *= 1.4;
    hd.len *= 1.15;
    for (const c of cps) if (c.p.z < -0.1 * L) c.p.z = -0.1 * L + (c.p.z + 0.1 * L) * 0.85;
  }
  // Adults of species with a re-bound artist model: joints where the artist put them.
  const fit = juvenile ? undefined : RIG_FITS[sp.id];
  if (fit) {
    for (const c of cps) if (c.bone && fit.cps[c.bone]) c.p.set(...fit.cps[c.bone]);
    cps[0].p.set(...fit.tip);
    hd.at.set(...fit.head);
    cps[cps.length - 1].p.copy(hd.at);
    for (const leg of legs) {
      const j = fit.legs[leg.name];
      if (j) leg.joints = j.map((v) => V(...v));
    }
  }
  const last = cps[cps.length - 1];
  const prev = cps[cps.length - 2];
  last.rx = Math.min(last.rx, hd.width * 0.7);
  last.ry = Math.min(last.ry, hd.height * 0.75);
  last.drop = 0;
  prev.rx = Math.min(prev.rx, Math.max(last.rx * 1.25, hd.width * 0.95));
  last.p.add(V(0, -Math.sin(hd.pitch), Math.cos(hd.pitch)).multiplyScalar(hd.len * 0.08));
  return { cps, legs, head: hd, tile: 0.1 + 0.06 * Math.pow(L, 0.75), feathered, juvenile };
}

const apexW = (sp: SpeciesDef) => sp.ecology === 'apexPredator' || sp.massKg > 1500;

/**
 * How much of the back and flanks is covered by large feature scales
 * (scutes/tubercles) rather than the fine pebbly mosaic, after the skin
 * impressions known for each group (see docs/realismo/fichas.md):
 * ceratopsians have big polygonal scales with central tubercles, hadrosaurs
 * fields of tubercles, sauropods a rounded mosaic; tyrannosaurs show small
 * scales. Feathered animals have none.
 */
export function scuteAmount(sp: SpeciesDef): number {
  const f = new Set(sp.look.features);
  if (f.has('feathers') || f.has('fur')) return 0;
  if (f.has('frill')) return 1;
  if (f.has('armor')) return 0.75;
  const plan = sp.locomotion.plan;
  if (plan === 'crocodyliform') return 0.85;
  if (plan === 'hadrosaur') return 0.6;
  if (f.has('plates')) return 0.5;
  if (plan === 'sauropod') return 0.25;
  if (plan === 'mosasaur' || plan === 'pterosaur') return 0;
  if (sp.id === 'tyrannosaurus') return 0.15;
  return 0.3;
}

// ------------------------------------------------------------------ painting

function painter(sp: SpeciesDef) {
  const base = new THREE.Color(sp.look.base);
  const belly = new THREE.Color(sp.look.belly);
  const accent = new THREE.Color(sp.look.accent);
  const mud = new THREE.Color(0.2, 0.16, 0.12);
  const L = sp.lengthM;
  const hip = sp.hipHeightM;
  const pattern = sp.look.pattern;
  // Noise scales relative to the animal (patches a few per flank, fine mottling).
  const big = 1 / (L * 0.11);
  const fine = 1 / (L * 0.028);
  return (p: THREE.Vector3, under: number, part: 'body' | 'limb' | 'head' | 'accent' | 'horn' | 'claw'): RGB => {
    if (part === 'horn') return [0.62, 0.56, 0.46];
    if (part === 'claw') return [0.18, 0.15, 0.12];
    const c = base.clone();
    const nb = fbm(p.x * big, p.y * big, p.z * big);
    const nf = fbm(p.x * fine + 5, p.y * fine, p.z * fine);
    if (part === 'accent') c.copy(accent);
    else {
      // Countershading: pale belly and throat, a darker saddle along the back.
      c.lerp(belly, smooth(-0.15, 0.85, under + (nb - 0.5) * 0.35) * (pattern === 'countershade' ? 1 : 0.75));
      c.multiplyScalar(1 - 0.2 * smooth(-0.25, -0.9, under));
      if (part !== 'limb' && under < 0.35) {
        const fade = smooth(0.35, -0.3, under);
        if (pattern === 'stripes') {
          // Irregular bands broken by noise (no ruler-straight stripes).
          const s = Math.sin((p.z / L) * 46 + (nb - 0.5) * 5 + (nf - 0.5) * 1.5);
          c.lerp(accent, 0.6 * smooth(0.15, 0.7, s) * fade);
        } else if (pattern === 'spots') {
          const sp2 = fbm(p.x * fine * 0.8 + 11, p.y * fine * 0.8, p.z * fine * 0.8);
          c.lerp(accent, 0.65 * smooth(0.6, 0.72, sp2) * fade);
        } else {
          // Plain: large soft blotches of the accent colour.
          c.lerp(accent, 0.3 * smooth(0.55, 0.8, nb) * fade);
        }
      }
      if (part === 'limb') c.multiplyScalar(0.9);
    }
    // Mottling at two scales, and a slight hue drift between patches.
    const m = 0.8 + 0.28 * nb + 0.16 * (nf - 0.5);
    c.multiplyScalar(m);
    c.r *= 1 + (nb - 0.5) * 0.08;
    c.b *= 1 - (nb - 0.5) * 0.08;
    // Dried mud and dust on the feet and lower legs.
    const dirt = smooth(hip * 0.22, 0, p.y) * (0.55 + 0.3 * nf);
    if (dirt > 0) c.lerp(mud, Math.min(0.8, dirt));
    return [c.r, c.g, c.b];
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

export function buildDinoTemplate(sp: SpeciesDef, juvenile = false): DinoTemplate {
  const bp = blueprint(sp, juvenile);
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
  // Jaw hinge: behind the eye, on the mouth line (see buildHead).
  const hp = bp.head.pitch;
  const hf = V(0, -Math.sin(hp), Math.cos(hp));
  const hu = V(0, Math.cos(hp), Math.sin(hp));
  const fit = juvenile ? undefined : RIG_FITS[sp.id];
  const jawHinge = fit ? V(...fit.jaw) : bp.head.at.clone().addScaledVector(hf, -bp.head.len * 0.04).addScaledVector(hu, skullProfile(skullFamily(sp), 0.08).lip * bp.head.height);
  addBone('jaw', 'head', jawHinge);
  for (const leg of bp.legs) {
    const names = ['0', '1', '2', '3'].map((k) => `${leg.name}${k}`);
    addBone(names[0], leg.parent, leg.joints[0]);
    for (let k = 1; k < 4; k++) addBone(names[k], names[k - 1], leg.joints[k]);
    // Pterosaur wing finger: its own bone at the end of the metacarpal.
    if (leg.fingerTip) addBone(`${leg.name}F`, names[3], leg.joints[3]);
  }

  // Occluders for the baked contact shadows: the body, neck and tail, each limb and the head.
  const occluders: Occluder[] = [];
  for (const sm of spineSamples(bp.cps, 3)) occluders.push({ c: sm.p.clone().add(V(0, -sm.drop * 0.5, 0)), r: Math.min(sm.rx, sm.ry + sm.drop * 0.5) * 0.95 });
  for (const leg of bp.legs)
    for (let k = 0; k < 3; k++)
      for (const t of [0.15, 0.5, 0.85]) occluders.push({ c: leg.joints[k].clone().lerp(leg.joints[k + 1], t), r: lerp(leg.radii[k], leg.radii[k + 1], t) * 0.9 });
  {
    const hf2 = V(0, -Math.sin(bp.head.pitch), Math.cos(bp.head.pitch));
    occluders.push({ c: bp.head.at.clone().addScaledVector(hf2, bp.head.len * 0.35), r: Math.min(bp.head.height, bp.head.width) * 0.8 });
  }

  // Three levels of detail from the same blueprint (the silhouette is identical):
  // 0 = close, 1 = mid distance, 2 = far (one material, one draw call).
  const build = (lod: number): THREE.BufferGeometry => {
    const detail = lod === 0;
    const parts = [new Part(), new Part(), new Part(), new Part(), new Part()];
    const paint = painter(sp);
    const segs = [44, 14, 9][lod];
    const perSeg = [18, 5, 3][lod];
    const tile = bp.tile;
    const feathered = bp.feathered;
    const bodyMat = feathered ? DMAT.feathers : DMAT.scales;
    const scutes = scuteAmount(sp);

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
    // Anatomy carved into the body surface (close-up level only): the ridge of the
    // spine, the hip bones (ilia) and shoulder blades under the skin, transverse
    // skin folds on the neck and throat, and gentle irregularity instead of a
    // perfectly smooth loft.
    const sAt = (bone: string) => {
      const i = bp.cps.findIndex((c) => c.bone === bone);
      return i < 0 ? -1 : samples[i * perSeg].s;
    };
    const sPelvis = sAt('pelvis');
    const sChest = sAt('chest');
    const sNeck = sAt('neck1') > 0 ? sAt('neck1') : 2;
    const L = sp.lengthM;
    const gs = (x: number, c: number, w: number) => Math.exp(-((x - c) * (x - c)) / (w * w));
    const furry = sp.look.features.includes('fur');
    const fold = L * (feathered || furry ? 0 : 0.011);
    const sculpt = (sm: { s: number }, a: number, along: number, p: THREE.Vector3) => {
      if (!detail) return 1;
      const dt = Math.atan2(Math.cos(a), Math.sin(a)); // 0 on top, ±π/2 at the sides
      const under = -Math.sin(a);
      let f = 1;
      // Spine ridge along the back and tail (neural spines).
      f += 0.03 * gs(dt, 0, 0.16) * (sm.s < sNeck ? 1 : 0.5);
      // Hip bones: two low bumps either side of the spine; a hollow between them and the ribs.
      if (sPelvis >= 0) f += 0.06 * gs(sm.s, sPelvis, 0.035) * gs(Math.abs(dt), 0.65, 0.3) - 0.025 * gs(sm.s, sPelvis + 0.06, 0.03) * gs(Math.abs(dt), 1.1, 0.4);
      // Shoulder blades sliding over the ribs.
      if (sChest >= 0) f += 0.05 * gs(sm.s, sChest + 0.01, 0.04) * gs(Math.abs(dt), 0.85, 0.35);
      // Ribs faintly showing on the flanks between shoulder and hip.
      if (sPelvis >= 0 && sChest >= 0 && sm.s > sPelvis && sm.s < sChest) f += 0.008 * Math.sin((along / (L * 0.022)) * Math.PI * 2) * gs(Math.abs(dt), 1.35, 0.35) * smooth(sPelvis, sPelvis + 0.04, sm.s) * smooth(sChest, sChest - 0.03, sm.s);
      // Transverse folds on the neck, deepest on the throat.
      if (fold > 0 && sm.s > sNeck) {
        const wob = vnoise(p.x * 4 / L * 10, p.y * 0.5, along * 0.7);
        f += 0.016 * Math.pow(Math.max(0, Math.sin((along / fold) * Math.PI * 2 + 4 * wob)), 3) * smooth(-0.1, 0.9, under) * (0.4 + 0.6 * wob) * smooth(sNeck, sNeck + 0.03, sm.s);
      }
      // Natural unevenness.
      const q = 1 / (L * 0.035);
      f += 0.035 * (vnoise(p.x * q, p.y * q, p.z * q) - 0.5);
      return f;
    };
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
        r.multiplyScalar(sculpt(sm, a, along, sm.p.clone().add(r)));
        const p = sm.p.clone().add(r);
        const under = -sa; // +1 belly, -1 back
        // Large feature scales on the back and flanks, small ones on the belly.
        body.region = scutes * smooth(0.55, -0.25, under);
        body.v(p, (k / segs) * uRep, along / tile, paint(p, under, 'body'), bi, bw);
      }
    }
    for (let i = 0; i < samples.length - 1; i++)
      for (let k = 0; k < segs; k++) {
        const a = base + i * (segs + 1) + k;
        const b = a + segs + 1;
        body.idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    body.region = 0;
    // Close both ends (tail tip and the neck end, which sits inside the back of the skull).
    for (const [ri, flip] of [[0, true], [samples.length - 1, false]] as [number, boolean][]) {
      const r0 = base + ri * (segs + 1);
      const [bi, bw] = spineWeights(samples[ri].s);
      const c = body.v(samples[ri].p, 0.5, 0.5, paint(samples[ri].p, 0, 'body'), bi, bw);
      for (let k = 0; k < segs; k++) body.idx.push(...(flip ? [r0 + k + 1, r0 + k, c] : [r0 + k, r0 + k + 1, c]));
    }

    // --- Head (skull + jaw).
    buildHead(sp, bp, parts, boneIndex, paint, lod);
    // --- Legs.
    for (const leg of bp.legs) buildLeg(sp, leg, parts, boneIndex, paint, detail, tile, feathered && leg.front ? DMAT.feathers : DMAT.scales, bp.cps.find((c) => c.bone === leg.parent));
    // --- Features.
    buildFeatures(sp, bp, parts, boneIndex, samples, spineWeights, paint, detail);

    const grouped = lod < 2;
    const geos = parts.map((p) => p.geometry()).filter((g) => g.attributes.position.count > 0 || grouped);
    // The distant version is a single group (one draw call); closer ones keep their materials.
    const g = mergeGeometries(geos, grouped)!;
    bakeOcclusion(g, occluders, sp.hipHeightM);
    g.computeBoundingSphere();
    return g;
  };

  const legsInfo = bp.legs.map((l) => ({
    name: l.name,
    front: l.front,
    phase: l.phase,
    joints: l.joints.map((j) => j.clone()),
    lengths: [0, 1, 2, 3].map((k) => l.joints[k].distanceTo(l.joints[k + 1])),
    fingerTip: l.fingerTip?.clone(),
  }));
  return { geometry: build(0), mid: build(1), low: build(2), bones, bp, legs: legsInfo, hipHeight: fit ? fit.legs[bp.legs.find((l) => !l.front)!.name][0][1] : sp.hipHeightM * (juvenile ? 1.08 : 1) };
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

function buildLeg(sp: SpeciesDef, leg: LegDef, parts: Part[], boneIndex: Map<string, number>, paint: ReturnType<typeof painter>, detail: boolean, tile: number, mat: number, body?: CP): void {
  const per = detail ? 9 : 2;
  const path = legPath(leg.joints.slice(0, 4), per);
  const bonesI = [0, 1, 2, 3].map((k) => boneIndex.get(`${leg.name}${k}`)!);
  const parentI = boneIndex.get(leg.parent)!;
  const radii = path.map(({ seg, t }) => {
    const r0 = leg.radii[seg];
    const r1 = leg.radii[seg + 1];
    // Muscle bulge in the upper third of the thigh/upper arm and calf (theropods: the
    // "drumstick"; big quadrupeds: thighs that flow into the flank).
    const heavy = sp.locomotion.plan === 'quadruped' || sp.locomotion.plan === 'mammal';
    const bulge = seg === 0 ? 1 + (heavy ? 0.1 : 0.18) * Math.sin(Math.PI * Math.min(1, t * 1.6)) : seg === 1 ? 1 + 0.12 * Math.sin(Math.PI * t) : 1;
    // Skin folds bunched around the knee/elbow and ankle/wrist (close-up level).
    const wrinkle = detail && seg > 0 ? 1 + 0.045 * Math.sin(t * Math.PI * 9) * smooth(0.28, 0, t) : 1;
    return lerp(r0, r1, t) * bulge * wrinkle;
  });
  // The upper end starts deep inside the body and swells outward, so the
  // thigh/shoulder emerges from the flank instead of a capped cylinder.
  const quad = sp.locomotion.plan === 'quadruped' || sp.locomotion.plan === 'mammal';
  // (Ankylosaurs: the low, flat back leaves less room above the hip.)
  const inside = V(leg.joints[0].x * 0.35, leg.joints[0].y + leg.radii[0] * (quad ? (sp.look.features.includes('armor') ? 0.4 : 1.0) : 1.4), leg.joints[0].z);
  // Keep the root well inside the body, and round the shoulder of the thigh/upper
  // arm with an extra ring (no straight cone showing above the flank).
  if (body) inside.y = Math.min(inside.y, body.p.y + body.ry * 0.35);
  const rootR = leg.radii[0] * (quad ? 0.95 : 0.7);
  const mid = inside.clone().lerp(leg.joints[0], 0.55);
  mid.x += Math.sign(leg.joints[0].x) * leg.radii[0] * 0.12;
  path.unshift({ p: mid, seg: 0, t: 0 });
  radii.unshift(leg.radii[0] * (quad ? 1.0 : 0.95));
  path.unshift({ p: inside, seg: 0, t: 0 });
  radii.unshift(rootR);
  // Colour: the top of the thigh/shoulder continues the flank colour; lower limbs are a little paler.
  const topY = leg.joints[0].y;
  // Limbs carry mostly small scales; a few larger ones on the thigh and upper arm.
  parts[mat].region = scuteAmount(sp) * 0.3;
  tube(parts[mat], path.map((x) => x.p), radii, detail ? 22 : 8, (p) => paint(p, p.y > topY - leg.radii[0] ? lerp(0.2, -0.35, smooth(topY - leg.radii[0], topY + leg.radii[0], p.y)) : 0.2, p.y > topY - leg.radii[0] * 2 ? 'body' : 'limb'), (i) => {
    const { seg, t } = path[i];
    if (seg === 0 && t < 0.25) return [[parentI, bonesI[0]], [1 - t * 4 * 0.6 - 0.4, t * 4 * 0.6 + 0.4]];
    if (t < 0.15 && seg > 0) {
      const w = smooth(0, 0.15, t) * 0.5 + 0.5;
      return [[bonesI[seg - 1], bonesI[seg]], [1 - w, w]];
    }
    return [[bonesI[seg]], [1]];
  }, tile, true, leg.flat ?? 1.12);
  parts[mat].region = 0;
  // Toes with claws.
  const toeRoot = leg.joints[3];
  const tip = leg.joints[4];
  const dir = tip.clone().sub(toeRoot);
  const len = dir.length();
  dir.normalize();
  const sideV = V(dir.z, 0, -dir.x).normalize();
  const nToes = leg.claws;
  // Heavy quadrupeds stand on short, close-set toes ending in blunt hooves.
  const sauro = sp.locomotion.plan === 'sauropod';
  const hoofed = sp.locomotion.plan === 'quadruped' || sauro;
  // Ornithopods (hadrosaurs) walked on three toes ending in broad, blunt hooves;
  // sauropod hands were a column of bound fingers with blunt nails.
  const blunt = (hoofed && !(sauro && !leg.front)) || sp.locomotion.plan === 'hadrosaur';
  for (let k = 0; k < nToes; k++) {
    const spread = (k - (nToes - 1) / 2) * (hoofed ? 0.22 : 0.35);
    const d = dir.clone().applyAxisAngle(V(0, 1, 0), spread).normalize();
    const tl = len * (k === Math.floor(nToes / 2) ? 1 : 0.8) * (hoofed ? 0.7 : 1);
    const pts = [toeRoot.clone().addScaledVector(sideV, spread * leg.radii[3] * 1.2), toeRoot.clone().addScaledVector(d, tl * 0.5).addScaledVector(sideV, spread * leg.radii[3] * 1.4), toeRoot.clone().addScaledVector(d, tl).addScaledVector(sideV, spread * leg.radii[3] * 1.5)];
    const r = leg.radii[3] * 0.45;
    tube(parts[DMAT.scales], pts, [r, r * 0.85, r * 0.6], detail ? 6 : 4, (p) => paint(p, 0.3, 'limb'), () => [[bonesI[3]], [1]], tile, false);
    // Claw: curved cone.
    const cb = pts[2];
    const cl = leg.clawLen;
    const curve = [cb, cb.clone().addScaledVector(d, cl * 0.5).add(V(0, -cl * (blunt ? 0.06 : 0.1), 0)), cb.clone().addScaledVector(d, cl * (blunt ? 0.8 : 1)).add(V(0, -cl * (blunt ? 0.2 : 0.45), 0))];
    tube(parts[DMAT.horn], curve, blunt ? [r * 0.85, r * 0.7, r * 0.25] : [r * 0.6, r * 0.35, r * 0.05], detail ? 5 : 3, (p) => paint(p, 0, 'claw'), () => [[bonesI[3]], [1]], tile, true);
  }
}

/** Skull family: decides the shape of the head, jaws, teeth and eyes. */
type SkullFamily = 'theropod' | 'apex' | 'longSnout' | 'croc' | 'duck' | 'beak' | 'cera' | 'anky' | 'sauropod' | 'ptero' | 'small' | 'mosa' | 'felid' | 'sloth' | 'snake' | 'dodo';

function skullFamily(sp: SpeciesDef): SkullFamily {
  const f = new Set(sp.look.features);
  const plan = sp.locomotion.plan;
  if (plan === 'pterosaur') return 'ptero';
  if (plan === 'mosasaur') return 'mosa';
  if (plan === 'crocodyliform') return 'croc';
  if (plan === 'mammal') return f.has('longClaws') ? 'sloth' : 'felid';
  if (plan === 'serpent') return 'snake';
  if (f.has('hookBeak')) return 'dodo';
  if (f.has('longSnout')) return 'longSnout';
  if (plan === 'hadrosaur') return 'duck';
  if (plan === 'sauropod') return 'sauropod';
  if (f.has('frill')) return 'cera';
  if (f.has('armor')) return 'anky';
  if (f.has('beak') || f.has('frill') || f.has('dome') || f.has('plates') || f.has('armor') || f.has('thumbSpike')) return 'beak';
  if (sp.ecology === 'apexPredator' || sp.massKg > 1500) return 'apex';
  if (sp.lengthM < 2.6) return 'small';
  return 'theropod';
}

/**
 * Head profile along the skull (t = 0 at the back of the skull, 1 at the
 * tip of the snout), in units of the head height / width:
 *  - top: height of the skull roof above the mouth line;
 *  - hw: half width;
 *  - lip: height of the mouth line (relative to the head axis);
 *  - jaw: depth of the lower jaw below the mouth line.
 */
function skullProfile(fam: SkullFamily, t: number): { top: number; hw: number; lip: number; jaw: number } {
  const bump = (c: number, w: number) => Math.exp(-((t - c) * (t - c)) / (w * w));
  switch (fam) {
    case 'apex':
      // Deep, broad-backed skull (binocular vision forward), tall muzzle, heavy jaw.
      return { top: 1.25 - 0.62 * Math.pow(t, 1.25) + 0.08 * bump(0.3, 0.08), hw: 1.15 - 0.62 * Math.pow(t, 0.75), lip: -0.3 + 0.1 * (1 - t), jaw: 0.62 - 0.35 * t };
    case 'theropod':
      return { top: 1.1 - 0.6 * Math.pow(t, 1.15) + 0.07 * bump(0.28, 0.08), hw: 1 - 0.6 * Math.pow(t, 0.85), lip: -0.3 + 0.08 * (1 - t), jaw: 0.5 - 0.3 * t };
    case 'small':
      // Small theropods: rounder braincase, bigger eyes, slender snout.
      return { top: 1.15 - 0.75 * Math.pow(t, 0.9), hw: 1 - 0.7 * Math.pow(t, 0.8), lip: -0.28, jaw: 0.4 - 0.25 * t };
    case 'longSnout':
      // Spinosaurids: long low snout with a terminal rosette; nostrils set back.
      return { top: 0.95 - 0.62 * smooth(0, 0.55, t) - 0.05 * t, hw: 0.95 - 0.68 * smooth(0, 0.45, t) + 0.12 * bump(0.93, 0.05), lip: -0.25 - 0.06 * t + 0.06 * bump(0.6, 0.1), jaw: 0.42 - 0.28 * smooth(0, 0.6, t) };
    case 'croc':
      return { top: 0.75 - 0.42 * smooth(0, 0.55, t), hw: 1.05 - 0.6 * smooth(0, 0.5, t) + 0.18 * bump(0.92, 0.06), lip: -0.15, jaw: 0.38 - 0.24 * smooth(0, 0.6, t) };
    case 'duck':
      // Hadrosaur: tall back of the skull, narrowing face, broad flat bill.
      return { top: 1.15 - 0.78 * smooth(0.1, 0.95, t), hw: 0.95 - 0.52 * smooth(0, 0.6, t) + 0.2 * smooth(0.75, 1, t), lip: -0.3 - 0.1 * t, jaw: 0.5 - 0.36 * t };
    case 'beak':
      // Ceratopsians, ornithomimids, thyreophorans: deep face ending in a hooked keratin beak.
      return { top: 1.1 - 0.55 * Math.pow(t, 1.3), hw: 1 - 0.75 * Math.pow(t, 1.2), lip: -0.3 - 0.18 * smooth(0.75, 1, t), jaw: 0.5 - 0.35 * t };
    case 'anky':
      // Ankylosaurid: short, flat-topped skull, wider than long at the back,
      // tapering to a narrow, squared keratin beak; shallow lower jaw.
      return { top: 0.9 - 0.32 * smooth(0.35, 1, t), hw: 1.08 - 0.12 * t - 0.42 * smooth(0.62, 1, t), lip: -0.3 - 0.08 * smooth(0.8, 1, t), jaw: 0.36 - 0.16 * t };
    case 'cera':
      // Ceratopsid: very deep face (tall over the nose), cheeks (jugals) flaring out
      // below the eyes, narrowing to a hooked, parrot-like rostral beak over a
      // pointed predentary; the lower jaw is deep where the dental batteries sit.
      return {
        top: 1.2 - 0.12 * smooth(0.25, 0.7, t) - 0.75 * Math.pow(smooth(0.68, 1, t), 1.3),
        hw: 0.82 + 0.38 * bump(0.16, 0.13) - 0.58 * smooth(0.32, 1, t),
        lip: -0.32 - 0.34 * Math.pow(smooth(0.78, 1, t), 1.5),
        jaw: 0.62 - 0.3 * smooth(0.2, 1, t),
      };
    case 'sauropod':
      // Brachiosaurid: the bony nostrils form a tall arch over and in front of the
      // eyes; long, broad, blunt snout (spatulate teeth), shallow lower jaw.
      return { top: 1.0 + 0.7 * bump(0.42, 0.13) - 0.5 * smooth(0.45, 1, t), hw: 0.95 - 0.12 * t + 0.08 * bump(0.85, 0.1), lip: -0.3, jaw: 0.38 - 0.16 * t };
    case 'felid':
      // Big cat: short, rounded skull, high forehead, broad cheeks, short muzzle with a
      // deep upper lip (the sabre-tooth's "flange" chin below).
      return { top: 1.05 - 0.1 * smooth(0.2, 0.5, t) - 0.45 * smooth(0.55, 1, t), hw: 1.0 + 0.08 * bump(0.35, 0.15) - 0.45 * smooth(0.45, 1, t), lip: -0.32 - 0.06 * smooth(0.6, 1, t), jaw: 0.38 - 0.12 * t + 0.1 * bump(0.85, 0.08) };
    case 'sloth':
      // Ground sloth: small braincase, long, deep, tubular snout, deep lower jaw.
      return { top: 0.9 - 0.25 * smooth(0.25, 1, t), hw: 0.85 - 0.3 * smooth(0.2, 1, t), lip: -0.3, jaw: 0.45 - 0.15 * t };
    case 'snake':
      // Boa: flat, broad, triangular head narrowing to a rounded snout.
      return { top: 0.62 - 0.22 * smooth(0.3, 1, t), hw: 1.05 - 0.45 * smooth(0.25, 1, t), lip: -0.24, jaw: 0.24 - 0.08 * t };
    case 'dodo':
      // Dodo: rounded head and a huge, deep bill ending in a strong hook.
      return { top: 1.0 - 0.3 * smooth(0.2, 0.5, t) - 0.25 * smooth(0.8, 1, t) + 0.1 * bump(0.92, 0.05), hw: 0.95 - 0.45 * smooth(0.2, 0.55, t) - 0.25 * smooth(0.85, 1, t), lip: -0.28 - 0.25 * smooth(0.88, 1, t), jaw: 0.42 - 0.18 * t };
    case 'mosa':
      // Monitor-like skull: long, fairly narrow, pointed snout, deep lower jaw.
      return { top: 0.9 - 0.55 * Math.pow(t, 0.9), hw: 0.95 - 0.62 * Math.pow(t, 0.85), lip: -0.3 + 0.05 * t, jaw: 0.5 - 0.32 * t };
    case 'ptero':
      // Long, pointed, toothless beak.
      return { top: 1 - 0.95 * Math.pow(t, 0.75), hw: 1 - 0.95 * Math.pow(t, 0.7), lip: -0.15 * (1 - t), jaw: 0.45 * (1 - Math.pow(t, 0.8)) };
  }
}

/**
 * Lofts closed rings into a surface, capping both ends with fans. Each ring
 * holds the same number of points (first point repeated at the end).
 */
function ringLoft(part: Part, rings: { p: THREE.Vector3; c: RGB }[][], bones: number[], w: number[], uTile: number, capStart: boolean, capEnd: boolean): void {
  const base = part.pos.length / 3;
  const n = rings[0].length;
  rings.forEach((ring, i) => ring.forEach((v, k) => part.v(v.p, (k / (n - 1)) * uTile, i / Math.max(1, rings.length - 1), v.c, bones, w)));
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < n - 1; k++) {
      const a = base + i * n + k;
      const b = a + n;
      part.idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const cap = (ri: number, flip: boolean) => {
    const ring = rings[ri];
    const c = ring.reduce((acc, v) => acc.add(v.p), V()).multiplyScalar(1 / ring.length);
    const ci = part.v(c, 0.5, 0.5, ring[0].c, bones, w);
    const r0 = base + ri * n;
    for (let k = 0; k < n - 1; k++) {
      if (flip) part.idx.push(r0 + k + 1, r0 + k, ci);
      else part.idx.push(r0 + k, r0 + k + 1, ci);
    }
  };
  if (capStart) cap(0, true);
  if (capEnd) cap(rings.length - 1, false);
}

const MOUTH: RGB = [0.36, 0.13, 0.12];
const TOOTH: RGB = [0.86, 0.82, 0.7];
const KERATIN: RGB = [0.24, 0.21, 0.17];
// Hadrosaur bill sheath (rhamphotheca): darker, browner keratin (colour unknown; interpretation).
const BILL: RGB = [0.14, 0.115, 0.09];

/**
 * Sculpted head: a closed skull (roof, cheeks, palate), a separate solid
 * lower jaw on its own bone (mouth floor and tongue inside, so an open mouth
 * is not hollow), teeth set along the jaw margins (carnivores), keratin
 * beaks/bills (herbivores), eyeballs with iris and pupil set in sockets with
 * upper and lower lids and a brow ridge, nostrils and a closed back of the
 * skull that blends into the neck.
 */
function buildHead(sp: SpeciesDef, bp: Blueprint, parts: Part[], boneIndex: Map<string, number>, paint: ReturnType<typeof painter>, detail: number): void {
  const plan = sp.locomotion.plan;
  const fam = skullFamily(sp);
  const hb = boneIndex.get('head')!;
  const jb = boneIndex.get('jaw')!;
  const { at, len, height, width, pitch } = bp.head;
  const fwd = V(0, -Math.sin(pitch), Math.cos(pitch));
  const up = V(0, Math.cos(pitch), Math.sin(pitch));
  const sideV = V(1, 0, 0);
  const hi = detail === 0;
  const segs = hi ? 34 : detail === 1 ? 14 : 8;
  const rings = hi ? 32 : detail === 1 ? 12 : 6;
  const mat = bp.feathered && plan !== 'bird' && sp.lengthM < 3 ? DMAT.feathers : DMAT.scales;
  const beaked = fam === 'beak' || fam === 'cera' || fam === 'anky' || fam === 'dodo' || fam === 'duck' || fam === 'ptero';
  const H = height;
  const Wd = width;
  // Point on the head: t along the skull, x across (m), y up (m, from the head axis).
  const P = (t: number, x: number, y: number) => at.clone().addScaledVector(fwd, -len * 0.12 + t * len * 1.04).addScaledVector(sideV, x).addScaledVector(up, y);
  // Rounding of the back of the skull (occiput) and of the snout tip.
  const round = (t: number) => Math.sqrt(Math.max(0.0, smooth(-0.02, 0.16, t))) * 0.55 + 0.45 * smooth(-0.02, 0.1, t);
  const tipRound = (t: number) => (fam === 'ptero' ? 1 : 0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - smooth(0.9, 1.0, t))));
  const keratin = (t: number) => beaked && t > (fam === 'ptero' ? 0.35 : fam === 'duck' ? 0.78 : fam === 'dodo' ? 0.42 : 0.82);
  const KER: RGB = fam === 'duck' || fam === 'anky' ? BILL : fam === 'dodo' ? [0.5, 0.47, 0.33] : sp.id === 'gallimimus' || sp.id === 'quetzalcoatlus' ? [0.72, 0.42, 0.14] : KERATIN;

  // ---- Upper skull: roof arch over the mouth line, closed by the palate.
  const skull: { p: THREE.Vector3; c: RGB }[][] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const pr = skullProfile(fam, t);
    const k = round(t) * tipRound(t);
    const hw = pr.hw * Wd * k;
    const top = pr.top * H * k;
    const lip = pr.lip * H;
    const ring: { p: THREE.Vector3; c: RGB }[] = [];
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let x: number;
      let y: number;
      let c: RGB;
      if (sa >= 0) {
        // Roof and cheeks: flat-sided superellipse, the cheeks bulge below the eyes.
        const e = 0.75;
        x = Math.sign(ca) * Math.pow(Math.abs(ca), e) * hw * (1 + 0.06 * Math.sin(a * 2) * (1 - t));
        y = lip + Math.pow(sa, 0.85) * top;
        const nostril = t > (fam === 'longSnout' ? 0.55 : fam === 'croc' ? 0.94 : 0.84) && t < (fam === 'longSnout' ? 0.66 : 0.97) && sa > 0.35 && sa < 0.75 && fam !== 'ptero';
        c = nostril ? [0.06, 0.05, 0.045] : keratin(t) ? KER : paint(P(t, x, y), -0.6 * sa + 0.1, 'head');
      } else {
        // Palate, just above the mouth line, recessed inside the tooth row.
        x = ca * hw * 0.9;
        y = lip + sa * H * 0.05;
        c = keratin(t) ? KER : sa < -0.3 ? MOUTH : paint(P(t, x, y), 0.6, 'head');
      }
      ring.push({ p: P(t, x, y), c });
    }
    skull.push(ring);
  }
  // The face has smaller scales than the back (larger ones over the cheeks and skull roof).
  parts[mat].region = scuteAmount(sp) * 0.35;
  ringLoft(parts[mat], skull, [hb], [1], 2, true, true);
  parts[mat].region = 0;

  // ---- Lower jaw: solid, hinged at the back, mouth floor inside.
  const jaw: { p: THREE.Vector3; c: RGB }[][] = [];
  const jr = hi ? 16 : detail === 1 ? 9 : 5;
  const j0 = 0.06;
  const j1 = fam === 'duck' ? 0.97 : fam === 'beak' || fam === 'cera' || fam === 'anky' ? 0.94 : 0.96;
  for (let i = 0; i <= jr; i++) {
    const t = j0 + (i / jr) * (j1 - j0);
    const pr = skullProfile(fam, t);
    const k = smooth(j0 - 0.02, j0 + 0.12, t) * 0.6 + 0.4;
    const kt = 0.4 + 0.6 * Math.sqrt(Math.max(0, 1 - smooth(j1 - 0.08, j1, t)));
    const hw = pr.hw * Wd * 0.92 * k * kt;
    const depth = pr.jaw * H * k * kt;
    const lip = pr.lip * H;
    const ring: { p: THREE.Vector3; c: RGB }[] = [];
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      let x: number;
      let y: number;
      let c: RGB;
      if (sa > 0) {
        // Mouth floor with the tongue in the middle.
        x = ca * hw * 0.9;
        y = lip - H * 0.03 + sa * H * 0.03;
        c = keratin(t) ? KER : Math.abs(ca) < 0.8 ? MOUTH : paint(P(t, x, y), 0.5, 'head');
      } else {
        x = Math.sign(ca) * Math.pow(Math.abs(ca), 0.8) * hw;
        y = lip + sa * depth;
        c = keratin(t) ? KER : paint(P(t, x, y), 0.4 - sa * 0.6, 'head');
      }
      ring.push({ p: P(t, x, y), c });
    }
    jaw.push(ring);
  }
  ringLoft(parts[mat], jaw, [jb], [1], 2, true, true);

  // ---- Teeth along the margins (carnivores and piscivores; toothless beaks have none).
  const toothed = (sp.diet === 'carnivore' || sp.diet === 'piscivore' || sp.diet === 'omnivore') && fam !== 'ptero' && fam !== 'beak' && fam !== 'cera' && fam !== 'anky' && fam !== 'duck' && fam !== 'dodo';
  if (toothed && detail < 2) {
    const n = hi ? (fam === 'croc' || fam === 'longSnout' ? 18 : 13) : 7;
    const toothLen = H * (fam === 'apex' ? 0.2 : fam === 'small' ? 0.12 : fam === 'croc' || fam === 'longSnout' ? 0.14 : 0.16);
    for (let i = 0; i < n; i++) {
      const t = 0.24 + (i / (n - 1)) * 0.7;
      const pr = skullProfile(fam, t);
      const k = tipRound(t);
      // Largest teeth in the middle of the row (maxillary fangs), smaller at both ends.
      const size = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, (t - 0.2) / 0.6)) + (fam === 'longSnout' && t > 0.85 ? 0.4 : 0);
      for (const s of [1, -1]) {
        const x = s * pr.hw * Wd * 0.86 * k;
        const yl = pr.lip * H;
        // Upper tooth, slightly recurved backward.
        const r0 = P(t, x, yl + H * 0.01);
        const tl = toothLen * size;
        tube(parts[DMAT.horn], [r0, r0.clone().addScaledVector(up, -tl * 0.6).addScaledVector(fwd, -tl * 0.05), r0.clone().addScaledVector(up, -tl).addScaledVector(fwd, -tl * 0.15)], [tl * 0.2, tl * 0.13, tl * 0.01], hi ? 5 : 3, () => TOOTH, () => [[hb], [1]], 1, true);
        // Lower tooth (inside the upper row when the mouth is closed).
        if (i % 2 === 0) {
          const pj = skullProfile(fam, t - 0.03);
          const xl = s * pj.hw * Wd * 0.78 * k;
          const b0 = P(t - 0.03, xl, yl - H * 0.02);
          const ll = tl * 0.8;
          tube(parts[DMAT.horn], [b0, b0.clone().addScaledVector(up, ll * 0.6), b0.clone().addScaledVector(up, ll).addScaledVector(fwd, -ll * 0.1)], [ll * 0.2, ll * 0.12, ll * 0.01], hi ? 5 : 3, () => TOOTH, () => [[jb], [1]], 1, true);
        }
      }
    }
  }

  // ---- Eyes: eyeball (sclera hidden in the socket, coloured iris, dark pupil), lids, brow.
  const eyeT = fam === 'ptero' ? 0.14 : fam === 'croc' ? 0.2 : fam === 'longSnout' ? 0.16 : fam === 'sauropod' ? 0.3 : fam === 'duck' || fam === 'beak' || fam === 'cera' || fam === 'anky' ? 0.24 : fam === 'dodo' ? 0.16 : fam === 'snake' ? 0.24 : fam === 'felid' ? 0.42 : 0.27;
  const prE = skullProfile(fam, eyeT);
  const big = (fam === 'small' ? 1.4 : fam === 'ptero' ? 1.1 : 1) * (bp.juvenile ? 1.3 : 1);
  const r = Math.max(0.006, H * 0.13 * big);
  const iris: RGB = sp.diet === 'carnivore' || sp.diet === 'piscivore' ? [0.62, 0.42, 0.08] : [0.3, 0.2, 0.1];
  const slit = fam === 'croc';
  for (const s of [1, -1]) {
    const k = round(eyeT);
    const ey = prE.lip * H + prE.top * H * k * (fam === 'croc' ? 0.95 : 0.66);
    const ex = s * prE.hw * Wd * k * (fam === 'croc' ? 0.6 : 0.8);
    const c = P(eyeT, ex, ey);
    // Outward direction: sideways, a little forward (binocular in predators) and up.
    const out = sideV.clone().multiplyScalar(s).addScaledVector(fwd, fam === 'apex' || fam === 'small' ? 0.45 : 0.15).addScaledVector(up, fam === 'croc' ? 0.6 : 0.12).normalize();
    const g = new THREE.SphereGeometry(r, hi ? 14 : 7, hi ? 10 : 5);
    const pp = g.attributes.position;
    const eb = parts[DMAT.eye].pos.length / 3;
    const lu = up.clone().addScaledVector(out, -up.dot(out)).normalize();
    for (let i = 0; i < pp.count; i++) {
      const v = V(pp.getX(i), pp.getY(i), pp.getZ(i));
      const d = v.clone().normalize();
      const o = d.dot(out);
      const vert = Math.abs(d.dot(lu));
      const pupil = slit ? o > 0.84 && vert < 0.92 && Math.abs(d.clone().addScaledVector(out, -o).addScaledVector(lu, -d.dot(lu)).length()) < 0.14 : o > 0.93;
      const col: RGB = pupil ? [0.01, 0.01, 0.01] : o > 0.72 ? [iris[0] * (0.7 + 0.3 * o), iris[1] * (0.7 + 0.3 * o), iris[2]] : [0.12, 0.09, 0.07];
      // Sunk into the socket: the back half is pushed inward.
      const p = v.multiplyScalar(o < 0 ? 0.6 : 1).add(c).addScaledVector(out, -r * 0.35);
      parts[DMAT.eye].v(p, 0, 0, col, [hb], [1]);
    }
    const ix = g.index!.array;
    for (let i = 0; i < ix.length; i++) parts[DMAT.eye].idx.push(eb + ix[i]);
    g.dispose();
    // Lids: arcs of skin around the front of the eyeball.
    const across = out.clone().cross(lu).normalize();
    const lid = (upper: boolean) => {
      const pts: THREE.Vector3[] = [];
      const radii: number[] = [];
      const m = hi ? 9 : 5;
      for (let i = 0; i <= m; i++) {
        const a = Math.PI * (0.08 + 0.84 * (i / m));
        const v = across.clone().multiplyScalar(Math.cos(a) * r * 1.02).addScaledVector(lu, (upper ? 1 : -1) * Math.sin(a) * r * (upper ? 0.82 : 0.78));
        pts.push(c.clone().addScaledVector(out, r * 0.3).add(v));
        radii.push(r * (upper ? 0.24 : 0.17) * (0.5 + 0.5 * Math.sin(Math.PI * (i / m))));
      }
      tube(parts[mat], pts, radii, hi ? 6 : 4, (p) => paint(p, upper ? -0.5 : 0.1, 'head'), () => [[hb], [1]], 1, true);
    };
    lid(true);
    lid(false);
    // Brow ridge over the eye (pronounced in large theropods).
    const browH = fam === 'apex' ? 0.65 : fam === 'theropod' ? 0.5 : 0.35;
    const brow = c.clone().addScaledVector(lu, r * 1.05).addScaledVector(out, -r * 0.1);
    tube(parts[mat], [brow.clone().addScaledVector(fwd, -r * 1.6), brow, brow.clone().addScaledVector(fwd, r * 1.6)], [r * browH * 0.6, r * browH, r * browH * 0.4], hi ? 7 : 4, (p) => paint(p, -0.6, 'head'), () => [[hb], [1]], 1, true);
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
  // Display structures (horns, frills, plates, crests, sails) are small in juveniles.
  const fs = bp.juvenile ? 0.4 : 1;
  // Carnotaurus (film): black horns; everyone else pale keratin darkening to the tip.
  const darkHorn = sp.id === 'carnotaurus';
  const horn = (root: THREE.Vector3, dir: THREE.Vector3, rawLength: number, r: number, bone: number, curve = 0.15) => {
    const length = rawLength * (bp.juvenile ? 0.35 : 1);
    const d = dir.clone().normalize();
    const pts = [root, root.clone().addScaledVector(d, length * 0.5).addScaledVector(up, length * curve * 0.3), root.clone().addScaledVector(d, length).addScaledVector(up, length * curve)];
    // Keratin sheath: pale grey-brown at the base, darker toward the tip.
    tube(parts[DMAT.horn], pts, [r, r * 0.55, r * 0.04], detail ? 8 : 4, (_p, t) => (darkHorn ? [lerp(0.16, 0.07, t), lerp(0.13, 0.06, t), lerp(0.11, 0.05, t)] : [lerp(0.5, 0.2, t), lerp(0.45, 0.17, t), lerp(0.37, 0.14, t)]), () => [[bone], [1]], 1, true);
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

  // Skull roof height (from the head axis) at a point along a ceratopsian skull.
  const ceraRoof = (t: number) => {
    const pr = skullProfile('cera', t);
    return (pr.lip + pr.top) * height;
  };
  const onSkull = (t: number, x: number, y: number) => at.clone().addScaledVector(fwd, -len * 0.12 + t * len * 1.04).addScaledVector(side, x).addScaledVector(up, y);
  // Horn with a keratin sheath that bends toward `bend` (brow horns of adult
  // triceratops curve forward; they pointed backward in juveniles).
  const bentHorn = (root: THREE.Vector3, dir: THREE.Vector3, rawLength: number, r: number, bend: THREE.Vector3, amount: number) => {
    const length = rawLength * (bp.juvenile ? 0.35 : 1);
    const d = dir.clone().normalize();
    const pts: THREE.Vector3[] = [root.clone().addScaledVector(d, -r * 1.5)]; // open base buried in the skull
    const radii: number[] = [r * 0.9];
    const n = detail ? 7 : 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push(root.clone().addScaledVector(d, length * t).addScaledVector(bend, length * amount * t * t * (bp.juvenile ? -0.6 : 1)));
      // Thick base, steady taper, blunt worn tip.
      radii.push(r * (1 - 0.85 * Math.pow(t, 1.15)) + r * 0.04);
    }
    // Keratin sheath: grey-brown, darker and smoother toward the worn tip.
    tube(parts[DMAT.horn], pts, radii, detail ? 10 : 5, (_p, t) => [lerp(0.34, 0.16, t), lerp(0.3, 0.14, t), lerp(0.24, 0.11, t)], () => [[hb], [1]], 1, true);
  };

  if (f.has('horns3')) {
    // Brow horns: ~1 m, rising from above the eyes, curving forward.
    for (const s of [1, -1]) {
      const W = bp.head.width;
      const root = onSkull(0.3, s * W * 0.42, ceraRoof(0.3) - height * 0.06);
      bentHorn(root, up.clone().multiplyScalar(0.82).addScaledVector(fwd, 0.5).addScaledVector(side, s * 0.14), L * 0.12, height * 0.19, fwd, 0.22);
    }
    // Short, thick nasal horn over the nostrils.
    bentHorn(onSkull(0.72, 0, ceraRoof(0.72) - height * 0.05), up.clone().multiplyScalar(0.85).addScaledVector(fwd, 0.5), L * 0.035, height * 0.16, fwd, 0.1);
  }
  // Pachyrhinosaurus: a broad, flat-topped bony boss over the nose instead of a horn.
  if (f.has('nasalBoss')) bentHorn(onSkull(0.62, 0, ceraRoof(0.62) - height * 0.08), up.clone().addScaledVector(fwd, 0.25), len * 0.12, height * 0.3, fwd, 0);
  if (f.has('frill')) {
    // Solid bony frill (no openings in triceratops): a broad shield growing out of
    // the back of the skull roof and sweeping up and back over the neck, thick at
    // its base and thinner toward the margin, slightly dished, with a row of small
    // triangular epoccipitals along the edge. Same skin as the head, darker and
    // more weathered toward the rim (its display colours are unknown).
    const fs2 = bp.juvenile ? 0.55 : 1;
    const Wf = (f.has('horns3') ? 0.115 : 0.1) * L * fs2;
    const Bf = (f.has('horns3') ? 0.12 : 0.11) * L * fs2;
    const centre = onSkull(0.1, 0, ceraRoof(0.1) - height * 0.08);
    const n = detail ? 26 : 10;
    const m = detail ? 7 : 3;
    const p = parts[DMAT.scales];
    // ~35–40° above the horizontal with the head in its resting pose: the shield covers the neck.
    const back = fwd.clone().multiplyScalar(-1).addScaledVector(up, 0.55).normalize();
    const normal = side.clone().cross(back).normalize(); // faces forward/up
    const b0 = p.pos.length / 3;
    const pointAt = (i: number, k: number, face: number) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI;
      const u = k / m;
      // Squarish outline (wider at the back than a half-disc), slightly scalloped.
      const shape = 1 + 0.06 * Math.cos(a * 2) + (detail ? 0.015 * Math.sin(a * 14) : 0);
      const rr = lerp(0.02, 1, u) * shape;
      const th = lerp(Bf * 0.1, Bf * 0.03, u);
      // The sides of the shield curve down over the neck (saddle shape), so the frill
      // reads as a broad plate from the side and not as a flat blade.
      const droop = Math.sin(a) * Math.sin(a) * u * Wf * 0.32;
      return centre.clone().addScaledVector(side, Math.sin(a) * Wf * rr).addScaledVector(back, Math.cos(a) * Bf * rr).addScaledVector(normal, u * u * Bf * 0.14 - droop + face * th * 0.5);
    };
    p.region = 0.2;
    for (const face of [1, -1])
      for (let i = 0; i <= n; i++)
        for (let k = 0; k <= m; k++) {
          const q = pointAt(i, k, face);
          const rim = k / m;
          const c = paint(q, -0.3, 'head');
          const dark = 1 - 0.18 * smooth(0.5, 1, rim);
          p.v(q, (i / n) * 3, (k / m) * 2, [c[0] * dark, c[1] * dark, c[2] * dark], [hb], [1]);
        }
    p.region = 0;
    const idx = (face: number, i: number, k: number) => b0 + (face > 0 ? 0 : (n + 1) * (m + 1)) + i * (m + 1) + k;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < m; k++) {
        const a = idx(1, i, k), b = idx(1, i + 1, k), c = idx(1, i, k + 1), d = idx(1, i + 1, k + 1);
        p.idx.push(a, b, c, b, d, c);
        const a2 = idx(-1, i, k), b2 = idx(-1, i + 1, k), c2 = idx(-1, i, k + 1), d2 = idx(-1, i + 1, k + 1);
        p.idx.push(a2, c2, b2, b2, c2, d2);
      }
    // Rim and the two side edges join the faces.
    for (let i = 0; i < n; i++) p.idx.push(idx(1, i, m), idx(1, i + 1, m), idx(-1, i, m), idx(1, i + 1, m), idx(-1, i + 1, m), idx(-1, i, m));
    // Inner edge, where the shield grows out of the skull roof (no hole at its base).
    for (let i = 0; i < n; i++) p.idx.push(idx(1, i, 0), idx(1, i + 1, 0), idx(-1, i, 0), idx(1, i + 1, 0), idx(-1, i + 1, 0), idx(-1, i, 0));
    for (const i of [0, n])
      for (let k = 0; k < m; k++) {
        const fl = i === 0;
        const q = [idx(1, i, k), idx(-1, i, k), idx(1, i, k + 1), idx(-1, i, k + 1)];
        if (fl) p.idx.push(q[0], q[2], q[1], q[2], q[3], q[1]);
        else p.idx.push(q[0], q[1], q[2], q[2], q[1], q[3]);
      }
    // Epoccipitals: small triangular bony knobs along the margin (worn and uneven in adults).
    if (detail && !f.has('frillSpikes'))
      for (let i = 1; i < 18; i++) {
        const ii = (i / 18) * n;
        const q = pointAt(ii, m, 0);
        const a = -Math.PI / 2 + (ii / n) * Math.PI;
        const dir = side.clone().multiplyScalar(Math.sin(a) * Wf).addScaledVector(back, Math.cos(a) * Bf).normalize();
        horn(q.clone().addScaledVector(dir, -Bf * 0.015), dir, Bf * (0.06 + hash(i, 3, 7) * 0.03), Bf * 0.03, hb, 0);
      }
    // Pachyrhinosaurus: long spikes growing from the margin of the frill.
    if (f.has('frillSpikes')) for (let i = 1; i < 6; i++) {
      const q = pointAt((i / 6) * n, m, 0);
      const dir = q.clone().sub(centre).normalize();
      horn(q.clone().addScaledVector(dir, -Bf * 0.04), dir, Bf * 0.35, height * 0.08, hb, 0.05);
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
    // Parasaurolophus: the premaxillae and nasals grow back into a long hollow tube
    // (the nasal passages loop through it). It starts on the snout, follows the
    // skull roof and sweeps up and back well past the back of the skull, about as
    // long again as the skull, slightly flattened side to side, with a rounded end
    // that bends a little down. Juveniles had only a low bump.
    const roof = (t: number) => {
      const pr = skullProfile('duck', Math.min(1, Math.max(0, t)));
      return (pr.lip + pr.top) * height;
    };
    const ext = bp.juvenile ? 0.25 : 1;
    const rise = bp.juvenile ? 0.4 : 1;
    const path: [number, number][] = [
      [0.7, roof(0.7) - height * 0.3],
      [0.52, roof(0.52) - height * 0.02],
      [0.28, roof(0.28) + height * 0.3 * rise],
      [0.05, roof(0.05) + height * 0.62 * rise],
      [0.05 - 0.35 * ext, roof(0) + height * (0.62 + 0.42 * ext) * rise],
      [0.05 - 0.68 * ext, roof(0) + height * (0.62 + 0.66 * ext) * rise],
      [0.05 - 0.86 * ext, roof(0) + height * (0.62 + 0.64 * ext) * rise],
      [0.05 - 0.93 * ext, roof(0) + height * (0.62 + 0.56 * ext) * rise],
    ];
    const pts = path.map(([t, y]) => onSkull(t, 0, y));
    const r = height * 0.27 * (bp.juvenile ? 0.8 : 1);
    const p = parts[DMAT.scales];
    p.region = 0.15;
    tube(p, pts, [r * 0.45, r * 0.85, r, r, r * 0.98, r * 0.92, r * 0.72, r * 0.18], detail ? 12 : 6, (q, t) => paint(q, -0.4 - 0.3 * t, t > 0.3 ? 'accent' : 'head'), () => [[hb], [1]], 1, true, 1.35);
    p.region = 0;
  }
  if (f.has('dualCrest')) for (const s of [1, -1]) {
    const p = parts[DMAT.scales];
    const n = detail ? 10 : 4;
    const b0 = p.pos.length / 3;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const base = at.clone().addScaledVector(fwd, len * (0.1 + t * 0.7)).addScaledVector(up, height * 0.55).addScaledVector(side, s * height * 0.25);
      const h = height * 0.85 * Math.sin(Math.PI * (0.15 + t * 0.75)) * fs;
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
  if (f.has('sabers')) {
    // Sabre-toothed cat: two long, flattened, gently curved upper canines (~0.25 m in
    // Smilodon populator), hanging below the closed jaw; ivory, darker at the root.
    const w = bp.head.width;
    const pr = skullProfile('felid', 0.8);
    for (const sx of [1, -1]) {
      const root = onSkull(0.8, sx * w * 0.32, pr.lip * height * 0.9);
      const down = up.clone().multiplyScalar(-1);
      const l = 0.11 * L * fs;
      const pts = [0, 0.35, 0.7, 1].map((t) => root.clone().addScaledVector(down, l * t).addScaledVector(fwd, -l * 0.28 * t * t).addScaledVector(side, sx * l * 0.03 * t));
      tube(parts[DMAT.horn], pts, [0.011 * L * fs, 0.0095 * L * fs, 0.007 * L * fs, 0.0015 * L], detail ? 8 : 4, (_q, t) => [lerp(0.62, 0.86, t), lerp(0.56, 0.82, t), lerp(0.45, 0.7, t)], () => [[hb], [1]], 1, true, 0.45);
    }
  }
  if (sp.locomotion.plan === 'mammal') {
    // Ears: rounded and upright on the cat, small on the sloth.
    const w = bp.head.width;
    const fam = skullFamily(sp);
    const pr = skullProfile(fam, 0.1);
    const big = fam === 'felid';
    for (const sx of [1, -1]) {
      const root = onSkull(0.1, sx * w * (big ? 0.6 : 0.7), (pr.lip + pr.top * 0.85) * height);
      const dir = up.clone().addScaledVector(fwd, -0.35).addScaledVector(side, sx * 0.35).normalize();
      const l = (big ? 0.026 : 0.02) * L;
      tube(parts[DMAT.scales], [root, root.clone().addScaledVector(dir, l * 0.6), root.clone().addScaledVector(dir, l)], [l * 0.55, l * 0.45, l * 0.12], detail ? 8 : 4, (q) => paint(q, -0.3, 'body'), () => [[hb], [1]], 1, true, 0.35);
    }
  }
  if (f.has('neckFrill')) {
    // Film-style neck frill (Jurassic Park's Dilophosaurus; no fossil evidence):
    // a scalloped fan of skin on each side of the neck behind the head, half open,
    // skin-coloured at the base, yellow in the middle and orange-red at the rim.
    const n3 = bp.cps.find((c) => c.bone === 'neck3') ?? bp.cps[bp.cps.length - 2];
    const nb = boneIndex.get('neck3') ?? hb;
    const c = n3.p.clone().lerp(at, 0.35);
    const along = at.clone().sub(n3.p).normalize();
    const upN = V(0, 1, 0).sub(along.clone().multiplyScalar(along.y)).normalize();
    const R = 0.15 * L * fs;
    const rn = Math.max(n3.rx, n3.ry) * 0.9;
    // Dense enough for the vein pattern (painted per vertex) to read up close.
    const ribs = detail ? 44 : 9;
    const rows = detail ? 14 : 3;
    const p = parts[DMAT.membrane];
    // Film look: olive-yellow fan with a red reticulated (net-like) pattern
    // and a dark, serrated rim; it grows out of the neck skin.
    const olive: RGB = [0.62, 0.6, 0.2];
    const red: RGB = [0.8, 0.2, 0.06];
    const rim: RGB = [0.16, 0.14, 0.07];
    const kf = 9 / R;
    for (const sd of [1, -1]) {
      const b0 = p.pos.length / 3;
      for (let i = 0; i <= ribs; i++) {
        const th = lerp(-1.15, 1.45, i / ribs);
        const dir = V(sd * Math.cos(th), 0, 0).addScaledVector(upN, Math.sin(th)).addScaledVector(along, -0.45).normalize();
        const root = c.clone().addScaledVector(V(sd, 0, 0), Math.cos(th) * rn).addScaledVector(upN, Math.sin(th) * rn * 0.9);
        const len = R * (0.75 + 0.25 * Math.sin(Math.PI * (i / ribs))) * (i % 2 ? 0.9 : 1);
        for (let k = 0; k <= rows; k++) {
          const u = k / rows;
          const q = root.clone().addScaledVector(dir, len * u).addScaledVector(along, -len * 0.15 * u * u);
          const base = paint(q, -0.2, 'body');
          // Net of red veins: thin bands where two warped waves cross zero.
          const wv = Math.abs(Math.sin(q.x * kf * sd + Math.sin(q.y * kf * 0.7) * 1.6)) * Math.abs(Math.sin(q.y * kf + Math.cos(q.z * kf * 0.8) * 1.6));
          const vein = u > 0.2 && u < 0.9 ? 1 - smooth(0.12, 0.3, wv) : 0;
          const fan: RGB = [lerp(olive[0], red[0], vein), lerp(olive[1], red[1], vein), lerp(olive[2], red[2], vein)];
          const e = smooth(0.82, 1, u);
          const inner = smooth(0, 0.25, u);
          const col: RGB = [0, 1, 2].map((j) => lerp(lerp(base[j], fan[j], inner), rim[j], e)) as RGB;
          p.v(q, i / ribs, u, col, [nb], [1]);
        }
      }
      for (let i = 0; i < ribs; i++)
        for (let k = 0; k < rows; k++) {
          const a0 = b0 + i * (rows + 1) + k;
          const a1 = a0 + rows + 1;
          if (sd > 0) p.idx.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1);
          else p.idx.push(a0, a0 + 1, a1, a1, a0 + 1, a1 + 1);
        }
    }
  }
  if (f.has('headCrest')) {
    const root = at.clone().addScaledVector(up, height * 0.6);
    const back = fwd.clone().multiplyScalar(-1).addScaledVector(up, 0.4).normalize();
    tube(parts[DMAT.scales], [root, root.clone().addScaledVector(back, len * 0.35), root.clone().addScaledVector(back, len * 0.6)], [height * 0.35, height * 0.2, height * 0.04], 6, (p) => paint(p, -0.3, 'accent'), () => [[hb], [1]], 1, true, 0.25);
  }
  if (f.has('beak') && sp.locomotion.plan !== 'pterosaur') {
    const tip = at.clone().addScaledVector(fwd, len * 0.82);
    const beakCol: RGB = sp.id === 'gallimimus' ? [0.72, 0.42, 0.14] : [0.32, 0.28, 0.22];
    tube(parts[DMAT.horn], [tip, tip.clone().addScaledVector(fwd, len * 0.14).addScaledVector(up, -height * 0.12)], [height * 0.25, height * 0.03], 8, () => beakCol, () => [[hb], [1]], 1, true);
  }
  // Dorsal structures along the spine.
  const spineBone = (s: number) => spineWeights(s);
  if (f.has('sail')) {
    // Dorsal sail: skin over very tall neural spines, tallest over the hips and
    // sloping down toward the shoulders, and continuing (much lower) as a fin along
    // the tall, paddle-like tail. A solid fin, thick at its base and thin at its
    // edge, with the spines showing as ridges; skin-coloured, darker toward the edge.
    const p = parts[DMAT.scales];
    const n = detail ? 44 : 10;
    const b0 = p.pos.length / 3;
    const sOfZ = (z: number) => {
      let best = samples[0];
      for (const sm of samples) if (Math.abs(sm.p.z - z) < Math.abs(best.p.z - z)) best = sm;
      return best.s;
    };
    const sPel = sOfZ(bp.cps.find((c) => c.bone === 'pelvis')!.p.z);
    const sCh = sOfZ(bp.cps.find((c) => c.bone === 'chest')!.p.z);
    const sF = Math.min(0.97, sCh + 0.03);
    const sP = sPel + 0.05;
    const sB = sPel - 0.1;
    const s0 = 0.02;
    const hMax = 0.12 * L * fs;
    const height = (s: number) => {
      const sail = s >= sP ? Math.pow(smooth(sF, sP, s), 0.75) : Math.pow(smooth(sB - 0.06, sP, s), 0.9);
      const fin = 0.02 * L * fs * smooth(s0, 0.16, s) * smooth(sP, sB - 0.04, s);
      return Math.max(hMax * sail * (0.94 + 0.06 * Math.sin(s * 90)), fin);
    };
    const rows = 4;
    for (const face of [1, -1])
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const s = lerp(s0, sF, t);
        const base = dorsal(s, -0.012 * L);
        const h = height(s);
        const [bi, bw] = spineBone(s);
        const ridge = detail ? 0.5 + 0.5 * Math.cos(i * Math.PI) : 0;
        for (let k = 0; k <= rows; k++) {
          const u = k / rows;
          const th = Math.min(0.012 * L, h * 0.25 + 0.002 * L) * (1 - u * 0.8) * (0.7 + 0.3 * ridge);
          const q = base.clone().add(V(face * th * 0.5, u * h, 0));
          const c = paint(q, -0.35, 'body');
          const a = paint(q, -0.35, 'accent');
          const m = 0.45 * smooth(0.45, 1, u);
          p.v(q, t * 6, u, [lerp(c[0], a[0], m), lerp(c[1], a[1], m), lerp(c[2], a[2], m)], bi, bw);
        }
      }
    const id = (face: number, i: number, k: number) => b0 + (face > 0 ? 0 : (n + 1) * (rows + 1)) + i * (rows + 1) + k;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < rows; k++) {
        // Outward-facing on both sides (the faces must point away from the midline).
        p.idx.push(id(1, i, k), id(1, i, k + 1), id(1, i + 1, k), id(1, i + 1, k), id(1, i, k + 1), id(1, i + 1, k + 1));
        p.idx.push(id(-1, i, k), id(-1, i + 1, k), id(-1, i, k + 1), id(-1, i + 1, k), id(-1, i + 1, k + 1), id(-1, i, k + 1));
      }
    for (let i = 0; i < n; i++) p.idx.push(id(1, i, rows), id(-1, i, rows), id(1, i + 1, rows), id(-1, i, rows), id(-1, i + 1, rows), id(1, i + 1, rows));
  }
  if (f.has('plates')) {
    // Seventeen individual plates in two alternating rows, largest over the hips and
    // the base of the tail. Each plate is a solid slab (front, back and a rounded
    // edge band), thick at its base and thin at its edge, leaning slightly outward.
    const count = 17;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const s = lerp(0.12, 0.82, t);
      const base = dorsal(s, -0.004 * L);
      // Film look: big plates, the tallest well above the hips.
      const h = 0.15 * L * Math.sin(Math.PI * (0.12 + t * 0.8)) * (0.92 + 0.16 * hash(i, 3, 7)) * fs;
      const row = i % 2 ? 1 : -1;
      const [bi, bw] = spineBone(s);
      const p = parts[DMAT.scales];
      // Outline (z along the body, y up), a rounded pentagon.
      const outline: [number, number][] = [];
      const k = detail ? 14 : 6;
      for (let j = 0; j <= k; j++) {
        const a = Math.PI * (j / k);
        const r = 1 - 0.18 * Math.abs(Math.cos(a * 2));
        // Pointed, kite-like plate (film look) rather than a rounded lobe.
        outline.push([-Math.cos(a) * h * 0.58 * r, h * (0.7 * (1 - Math.abs(Math.cos(a))) + 0.3 * Math.sin(a))]);
      }
      const lean = row * 0.12;
      const center = base.clone().add(V(row * 0.012 * L, 0, 0));
      const th = h * 0.07;
      const b0 = p.pos.length / 3;
      for (const face of [1, -1])
        for (const [z, y] of outline) {
          const tt = y / h;
          const q = center.clone().add(V(face * th * (1 - tt * 0.8) * 0.5 + Math.sin(lean) * y, y * Math.cos(lean), z));
          // Film look: beige plates crossed by dark brown bands that follow the edge.
          const band = 0.5 + 0.5 * Math.sin(tt * 11 + (z / h) * 3 + i);
          const bc = paint(q, -0.5, 'body');
          const beige: RGB = [0.6, 0.5, 0.34];
          const brown: RGB = [0.3, 0.22, 0.13];
          const mix = smooth(0.15, 0.5, tt);
          const pc: RGB = [0, 1, 2].map((j) => lerp(bc[j], lerp(beige[j], brown[j], smooth(0.55, 0.8, band)), mix)) as RGB;
          p.v(q, 0, 0, pc, bi, bw);
        }
      const nO = outline.length;
      const cF = p.v(center.clone().add(V(th * 0.5 + Math.sin(lean) * h * 0.4, h * 0.4, 0)), 0, 0, paint(center, -0.5, 'body'), bi, bw);
      const cB = p.v(center.clone().add(V(-th * 0.5 + Math.sin(lean) * h * 0.4, h * 0.4, 0)), 0, 0, paint(center, -0.5, 'body'), bi, bw);
      for (let j = 0; j < nO - 1; j++) {
        p.idx.push(b0 + j, b0 + j + 1, cF);
        p.idx.push(b0 + nO + j + 1, b0 + nO + j, cB);
        // Edge band.
        p.idx.push(b0 + j, b0 + nO + j, b0 + j + 1, b0 + j + 1, b0 + nO + j, b0 + nO + j + 1);
      }
    }
  }
  if (f.has('fluke')) {
    // Hypocercal tail fluke: the tail vertebrae bend down into the large lower lobe,
    // a smaller upper lobe of soft tissue rises above (as preserved in Prognathodon).
    const p = parts[DMAT.scales];
    const tb = boneIndex.get('tail4')!;
    const root = atS(0.035).p;
    const outline: [number, number][] = [[0.03, 0], [-0.01, 0.02], [-0.055, 0.05], [-0.05, 0.02], [-0.04, 0], [-0.06, -0.035], [-0.085, -0.08], [-0.05, -0.05], [-0.01, -0.02], [0.03, 0]];
    const b0 = p.pos.length / 3;
    for (const face of [1, -1])
      for (const [z, y] of outline) {
        const q = root.clone().add(V(face * 0.003 * L, y * L, z * L));
        p.v(q, 0, 0, paint(q, y > 0 ? -0.6 : 0.2, 'body'), [tb], [1]);
      }
    const n = outline.length;
    const cF = p.v(root.clone().add(V(0.003 * L, -0.01 * L, -0.03 * L)), 0, 0, paint(root, -0.3, 'body'), [tb], [1]);
    const cB = p.v(root.clone().add(V(-0.003 * L, -0.01 * L, -0.03 * L)), 0, 0, paint(root, -0.3, 'body'), [tb], [1]);
    for (let i = 0; i < n - 1; i++) {
      p.idx.push(b0 + i, b0 + i + 1, cF, b0 + n + i + 1, b0 + n + i, cB);
      p.idx.push(b0 + i, b0 + n + i, b0 + i + 1, b0 + i + 1, b0 + n + i, b0 + n + i + 1);
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
    // Tail club: fused osteoderms, about as wide as the skull (~0.6 m in Ankylosaurus):
    // two big, flattened lateral knobs around a smaller central one; skin-coloured.
    const clubCol = (q: THREE.Vector3): RGB => { const c = paint(q, -0.3, 'body'); return [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8]; };
    tube(parts[DMAT.horn], [c.clone().add(V(0, 0, 0.035 * L)), c.clone().add(V(0, 0, 0.01 * L)), c.clone().add(V(0, 0, -0.025 * L)), c.clone().add(V(0, 0, -0.045 * L))], [0.012 * L, 0.024 * L, 0.022 * L, 0.004 * L], detail ? 12 : 6, clubCol, () => [[tb], [1]], 1, true, 0.6);
    for (const sx of [1, -1]) tube(parts[DMAT.horn], [c.clone().add(V(sx * 0.008 * L, 0, 0.022 * L)), c.clone().add(V(sx * 0.026 * L, 0, 0.004 * L)), c.clone().add(V(sx * 0.028 * L, 0, -0.018 * L)), c.clone().add(V(sx * 0.016 * L, 0, -0.034 * L))], [0.008 * L, 0.022 * L, 0.018 * L, 0.004 * L], detail ? 10 : 5, clubCol, () => [[tb], [1]], 1, true, 0.62);
  }
  if (f.has('armor')) {
    // Skull horns: pyramidal squamosal horns at the back corners pointing back and
    // out, and quadratojugal horns below the eyes pointing down and back.
    const back = fwd.clone().multiplyScalar(-1);
    const hw = bp.head.width;
    for (const sx of [1, -1]) {
      horn(onSkull(0.08, sx * hw * 0.85, height * 0.45), back.clone().addScaledVector(side, sx * 1.1).addScaledVector(up, 0.15), 0.032 * L, 0.012 * L, hb, 0);
      horn(onSkull(0.2, sx * hw * 0.92, -height * 0.2), back.clone().multiplyScalar(0.6).addScaledVector(side, sx * 0.5).addScaledVector(up, -1), 0.022 * L, 0.01 * L, hb, 0);
    }
    // Ankylosaur armour: transverse bands of low, keeled osteoderms of uneven size
    // over the back, larger keeled spikes along the flank edge, two bony half-rings
    // over the neck and triangular plates along the sides of the tail. Between them
    // the hide carries small ossicles (the skin texture).
    const n = detail ? 24 : 9;
    const osteo = (root: THREE.Vector3, nrm: THREE.Vector3, r: number, h: number, bones: [number[], number[]], dark: number) =>
      tube(parts[DMAT.horn], [root.clone().addScaledVector(nrm, -h * 0.5), root.clone().addScaledVector(nrm, h * 0.55), root.clone().addScaledVector(nrm, h)], [r, r * 0.55, r * 0.1], detail ? 6 : 4, (q, t) => { const c = paint(q, -0.6, 'body'); const d = dark - 0.25 * t; return [c[0] * d, c[1] * d, c[2] * d]; }, () => bones, 1, true);
    for (let i = 0; i < n; i++) {
      const s = lerp(0.08, 0.9, i / (n - 1));
      const sm = atS(s);
      const bones = spineBone(s);
      const neck = s > 0.8;
      const tail = s < 0.4;
      const cols = tail ? 2 : neck ? (detail ? 6 : 4) : detail ? 9 : 5;
      for (let c = 0; c < cols; c++) {
        const a = tail ? (c === 0 ? 0.12 : 0.88) * Math.PI : lerp(neck ? 0.18 : 0.08, neck ? 0.82 : 0.92, c / (cols - 1)) * Math.PI;
        const jit = hash(i, c, 3.7);
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const nrm = V(ca / sm.rx, sa / sm.ry, 0).normalize();
        const root = sm.p.clone().add(V(ca * sm.rx, sa * sm.ry, 0));
        const edge = Math.abs(ca) > 0.85;
        if (tail) {
          // Tail plates shrink toward the club.
          const k = 0.5 + 0.5 * smooth(0.05, 0.4, s);
          osteo(root, nrm.clone().add(V(0, 0, -0.35)).normalize(), 0.02 * L * k, 0.03 * L * k * (0.85 + 0.3 * jit), bones, 0.72);
        } else if (edge) {
          osteo(root, nrm.clone().add(V(0, -0.15, -0.25)).normalize(), 0.017 * L, 0.03 * L * (0.8 + 0.4 * jit), bones, 0.7);
        } else {
          const r = (neck ? 0.026 : 0.019) * L * (0.75 + 0.5 * jit);
          osteo(root, nrm, r, r * (neck ? 0.55 : 0.42), bones, neck ? 0.68 : 0.78);
        }
      }
    }
  } else if (f.has('scutes')) {
    // Rows of osteoderms over the back and flanks (crocodyliforms).
    const rows = 3;
    const n = detail ? 26 : 10;
    for (let i = 0; i < n; i++) {
      const s = lerp(0.12, 0.85, i / (n - 1));
      const sm = atS(s);
      const [bi, bw] = spineBone(s);
      for (let r = 0; r < rows; r++) {
        const a = Math.PI / 2 + ((r - (rows - 1) / 2) / rows) * Math.PI * 0.8;
        const dir = V(Math.cos(a), Math.sin(a), 0);
        const root = sm.p.clone().add(V(dir.x * sm.rx * 0.95, dir.y * sm.ry * 0.95, 0));
        const h = 0.012 * L * (r === 0 || r === rows - 1 ? 1.4 : 1);
        const pts = [root, root.clone().addScaledVector(dir, h)];
        // Osteoderms: bony scutes covered in skin and keratin, darker than the hide.
        tube(parts[DMAT.horn], pts, [h * 0.7, h * 0.08], 5, (q, t) => { const c = paint(q, -0.6, 'body'); const d = 0.75 - 0.3 * t; return [c[0] * d, c[1] * d, c[2] * d]; }, () => [bi, bw], 1, true);
      }
    }
  }
  // Feathers. A coat of overlapping contour feathers (shingled backward along
  // the body, neck, thighs and tail; the snout, feet and lower legs stay
  // scaly), pennaceous wing feathers folded along the arms, a tail fan, and on
  // Microraptor long feathers on the hind legs (its "four wings").
  if (bp.feathered) {
    const p = parts[DMAT.feathers];
    const feather = (root: THREE.Vector3, dir: THREE.Vector3, sideDir: THREE.Vector3, len: number, w: number, bones: [number[], number[]], col: RGB, lift: THREE.Vector3 | null = null) => {
      const b0 = p.pos.length / 3;
      const tip = root.clone().addScaledVector(dir, len);
      const mid = root.clone().addScaledVector(dir, len * 0.45);
      if (lift) {
        tip.addScaledVector(lift, len * 0.05);
        mid.addScaledVector(lift, len * 0.04);
      }
      const dark: RGB = [col[0] * 0.62, col[1] * 0.62, col[2] * 0.62];
      const [bi, bw] = bones;
      p.v(root, 0, 0, col, bi, bw);
      p.v(mid.clone().addScaledVector(sideDir, w), 1, 0.45, col, bi, bw);
      p.v(tip, 0.5, 1, dark, bi, bw);
      p.v(mid.clone().addScaledVector(sideDir, -w * 0.6), 0, 0.45, col, bi, bw);
      p.idx.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3, b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2);
    };
    // Body coat (close level of detail only; further away the feather texture reads the same).
    if (detail) {
      const step = Math.max(1, Math.round(samples.length / 60));
      const around = 14;
      for (let i = 2; i < samples.length - 2; i += step) {
        const sm = samples[i];
        if (sm.s < 0.08 || sm.s > 0.97) continue;
        const next = samples[Math.min(samples.length - 1, i + 1)].p;
        const prv = samples[Math.max(0, i - 1)].p;
        const tan = next.clone().sub(prv).normalize();
        const sideAx = V(1, 0, 0);
        const upAx = tan.clone().cross(sideAx).normalize().negate();
        if (upAx.y < 0) upAx.negate();
        const bones = spineWeights(sm.s);
        const flen = Math.max(0.025, Math.min(sm.rx, sm.ry) * 0.7);
        for (let k = 0; k < around; k++) {
          const a = ((k + (i % 2) * 0.5) / around) * Math.PI * 2;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const below = Math.max(0, -sa);
          const nrm = V().addScaledVector(sideAx, ca * sm.ry).addScaledVector(upAx, sa * sm.rx).normalize();
          const root = sm.p.clone().addScaledVector(sideAx, ca * sm.rx * 0.97).addScaledVector(upAx, sa * sm.ry * 0.97 - below * sm.drop);
          // Shingled backward, following the curve of the body.
          const dir = tan.clone().negate().addScaledVector(nrm, 0.08).normalize();
          const sd = nrm.clone().cross(dir).normalize();
          const jitter = 0.85 + 0.3 * hash(i, k, 5);
          feather(root, dir, sd, flen * 1.8 * jitter, flen * 0.6, bones, paint(root, -sa, 'body'), nrm);
        }
      }
      // Thigh feathers ("trousers").
      for (const leg of bp.legs.filter((l) => !l.front)) {
        const b0 = boneIndex.get(`${leg.name}0`)!;
        const j0 = leg.joints[0];
        const j1 = leg.joints[1];
        for (let i = 0; i < 10; i++) {
          const t = 0.15 + (i / 10) * 0.7;
          const a = (i * 2.4) % (Math.PI * 2);
          const c = j0.clone().lerp(j1, t);
          const out = V(Math.sign(j0.x) * Math.abs(Math.cos(a)), Math.sin(a) * 0.5, Math.sin(a) * 0.4).normalize();
          const root = c.clone().addScaledVector(out, leg.radii[0] * (1 - t * 0.4));
          const dir = j1.clone().sub(j0).normalize().multiplyScalar(0.7).add(V(0, 0, -0.5)).normalize();
          feather(root, dir, out.clone().cross(dir).normalize(), leg.radii[0] * 1.6, leg.radii[0] * 0.4, [[b0], [1]], paint(root, 0, 'body'), out);
        }
      }
    }
    const wingy = sp.locomotion.plan === 'bird' || f.has('wings');
    for (const leg of bp.legs.filter((l) => l.front)) {
      const bonesI = [0, 1, 2, 3].map((k) => boneIndex.get(`${leg.name}${k}`)!);
      const s = Math.sign(leg.joints[0].x);
      const n = detail ? (wingy ? 16 : 11) : 4;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const seg = Math.min(2, Math.floor(t * 3));
        const lt = t * 3 - seg;
        const root = leg.joints[seg].clone().lerp(leg.joints[seg + 1], lt);
        // Primaries on the hand are the longest, secondaries along the forearm shorter.
        const len = leg.radii[0] * (wingy ? 7.5 : 4) * (0.55 + t * 0.7);
        const dir = V(s * 0.3, -0.5, -1).normalize();
        const col = paint(root, 0.2, 'body');
        feather(root, dir, V(s, 0.2, 0).normalize(), len, len * 0.2, [[bonesI[seg]], [1]], col, V(s, 0, 0));
      }
    }
    if (sp.id === 'microraptor') {
      // Long pennaceous feathers on the shins and feet (hind wings).
      for (const leg of bp.legs.filter((l) => !l.front)) {
        const s = Math.sign(leg.joints[0].x);
        for (let i = 0; i < (detail ? 9 : 3); i++) {
          const t = (i + 0.5) / 9;
          const seg = t < 0.5 ? 1 : 2;
          const lt = seg === 1 ? t * 2 : (t - 0.5) * 2;
          const root = leg.joints[seg].clone().lerp(leg.joints[seg + 1], lt);
          const len = leg.radii[0] * 4.5 * (0.6 + t * 0.6);
          feather(root, V(s * 0.4, -0.2, -1).normalize(), V(s, 0, 0), len, len * 0.2, [[boneIndex.get(`${leg.name}${seg}`)!], [1]], paint(root, 0.2, 'body'), V(s, 0, 0));
        }
      }
    }
    const tb = boneIndex.get('tail4') ?? boneIndex.get('tail3')!;
    const fan = sp.locomotion.plan === 'bird' ? 0.2 * L : 0.09 * L;
    const n = detail ? 13 : 4;
    for (let i = 0; i < n; i++) {
      const a = ((i / (n - 1)) - 0.5) * 1.6;
      const root = atS(0.04).p;
      const dir = V(Math.sin(a), 0, -Math.cos(a)).normalize();
      feather(root, dir, V(Math.cos(a), 0, Math.sin(a)), fan * (0.8 + 0.2 * Math.cos(a)), fan * 0.14, [[tb], [1]], paint(root, 0, 'body'));
    }
  }
  // Pterosaur wings: the wing finger (a long tapering bone), the brachiopatagium
  // stretched from the arm and finger to the flank down to the hip, and the
  // propatagium in front of the elbow. Built in the folded resting pose; in
  // flight the arm and finger bones extend and the membrane stretches with them
  // (its body edge is skinned to the spine, its leading edge to the wing bones).
  if (sp.locomotion.plan === 'pterosaur') {
    const p = parts[DMAT.membrane];
    for (const s of [1, -1]) {
      const wing = bp.legs.find((l) => l.name === (s > 0 ? 'wingL' : 'wingR'))!;
      const wb = [0, 1, 2, 3].map((k) => boneIndex.get(`${wing.name}${k}`)!);
      const fb = boneIndex.get(`${wing.name}F`)!;
      const j = wing.joints;
      const tip = wing.fingerTip!;
      // Wing finger bone.
      const fpts = [0, 0.25, 0.5, 0.75, 1].map((t) => j[3].clone().lerp(tip, t));
      tube(parts[DMAT.scales], fpts, [wing.radii[3] * 0.9, wing.radii[3] * 0.75, wing.radii[3] * 0.6, wing.radii[3] * 0.45, wing.radii[3] * 0.2], detail ? 7 : 4, (q) => paint(q, 0.2, 'limb'), () => [[fb], [1]], 1, true);
      // Leading edge: shoulder → elbow → wrist → hand → along the finger to its tip.
      const lead: { p: THREE.Vector3; b: number }[] = [
        { p: j[0], b: wb[0] },
        { p: j[1], b: wb[1] },
        { p: j[2], b: wb[2] },
        { p: j[3], b: fb },
        { p: j[3].clone().lerp(tip, 0.35), b: fb },
        { p: j[3].clone().lerp(tip, 0.7), b: fb },
        { p: tip, b: fb },
      ];
      // Body edge: along the flank from the shoulder back to the hip (thigh).
      const flank = (s01: number) => {
        const sm = atS(lerp(0.72, 0.42, s01));
        return { p: sm.p.clone().add(V(s * sm.rx * 0.95, -sm.ry * 0.1, 0)), w: spineWeights(sm.s) };
      };
      const rowsM = detail ? 5 : 3;
      const b0 = p.pos.length / 3;
      for (let i = 0; i < lead.length; i++) {
        const fl = flank(i / (lead.length - 1));
        for (let r = 0; r <= rowsM; r++) {
          const u = r / rowsM;
          // The trailing edge curves inward between finger tip and body (scalloped).
          const q = lead[i].p.clone().lerp(fl.p, u);
          const wl = 1 - u;
          const bones = [lead[i].b, ...fl.w[0]];
          const ws = [wl, ...fl.w[1].map((x) => x * u)];
          const shade = 0.9 + 0.1 * Math.sin(u * 3.1);
          p.v(q, i / (lead.length - 1), u, [0.5 * shade, 0.36 * shade, 0.28 * shade], bones, ws);
        }
      }
      for (let i = 0; i < lead.length - 1; i++)
        for (let r = 0; r < rowsM; r++) {
          const a = b0 + i * (rowsM + 1) + r;
          const b = a + rowsM + 1;
          p.idx.push(a, b, a + 1, a + 1, b, b + 1, a, a + 1, b, a + 1, b + 1, b);
        }
      // Propatagium: small membrane in front of the elbow, shoulder to wrist.
      const pb = p.pos.length / 3;
      p.v(j[0], 0, 0, [0.48, 0.34, 0.27], [wb[0]], [1]);
      p.v(j[1].clone().add(V(0, 0.02 * L, 0.06 * L)), 0.5, 1, [0.48, 0.34, 0.27], [wb[1]], [1]);
      p.v(j[2], 1, 0, [0.48, 0.34, 0.27], [wb[2]], [1]);
      p.v(j[1], 0.5, 0, [0.48, 0.34, 0.27], [wb[1]], [1]);
      p.idx.push(pb, pb + 1, pb + 3, pb + 3, pb + 1, pb + 2, pb, pb + 3, pb + 1, pb + 3, pb + 2, pb + 1);
    }
  }
}
