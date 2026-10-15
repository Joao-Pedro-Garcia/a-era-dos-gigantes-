import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp, damp } from '../core/math';
import type { AnimalData } from './animal';
import { growthScale } from './animal';
import { SPECIES, type SpeciesDef } from './species';

/**
 * Procedural creature models built from each species' dimensions and
 * features. Parts are rigged as simple pivots (legs, neck/head, tail, wings)
 * so the locomotion animation is driven by the distance actually travelled –
 * no foot sliding.
 */
interface LegTemplate {
  hip: THREE.Vector3;
  thigh: THREE.BufferGeometry;
  shin: THREE.BufferGeometry;
  thighLen: number;
  /** Phase offset in cycles. */
  phase: number;
  front: boolean;
}

interface Template {
  body: THREE.BufferGeometry;
  neck: THREE.BufferGeometry;
  neckPivot: THREE.Vector3;
  tail: THREE.BufferGeometry;
  tailPivot: THREE.Vector3;
  legs: LegTemplate[];
  wings: THREE.BufferGeometry | null;
  wingPivot: THREE.Vector3;
  hipHeight: number;
}

export interface AnimalView {
  root: THREE.Group;
  body: THREE.Group;
  neck: THREE.Group;
  tail: THREE.Group;
  legs: { thigh: THREE.Group; shin: THREE.Group; t: LegTemplate }[];
  wings: THREE.Group[];
  sp: SpeciesDef;
  tpl: Template;
  posture: number;
  flap: number;
}

const templates = new Map<string, Template>();
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
const wingMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
material.userData.shared = true;
wingMaterial.userData.shared = true;

function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** Paints vertex colours: countershading, stripes or spots from local position. */
function paint(geo: THREE.BufferGeometry, sp: SpeciesDef, part: 'body' | 'limb' | 'accent' | 'dark' | 'horn'): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const base = new THREE.Color(sp.look.base);
  const belly = new THREE.Color(sp.look.belly);
  const accent = new THREE.Color(sp.look.accent);
  const c = new THREE.Color();
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const midY = (bb.min.y + bb.max.y) / 2;
  const L = sp.lengthM;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (part === 'horn') c.setRGB(0.78, 0.72, 0.6);
    else if (part === 'dark') c.setRGB(0.08, 0.07, 0.06);
    else if (part === 'accent') c.copy(accent);
    else {
      c.copy(base);
      const under = clamp((midY - y) / Math.max(0.01, bb.max.y - bb.min.y) * 2.2, 0, 1);
      c.lerp(belly, part === 'limb' ? under * 0.4 : under * (sp.look.pattern === 'countershade' ? 1 : 0.7));
      if (sp.look.pattern === 'stripes' && part === 'body' && y > midY) {
        if (Math.sin((z / L) * 40) > 0.35) c.lerp(accent, 0.55);
      } else if (sp.look.pattern === 'spots' && part === 'body' && y > midY - 0.1) {
        const q = L * 0.04;
        if (hash(Math.floor(x / q), Math.floor(y / q), Math.floor(z / q)) > 0.78) c.lerp(accent, 0.6);
      }
      const n = 1 + (hash(x * 7, y * 7, z * 7) - 0.5) * 0.08;
      c.multiplyScalar(n);
    }
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

function ellipsoid(rx: number, ry: number, rz: number, x: number, y: number, z: number, seg = 14): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.floor(seg * 0.7)));
  g.scale(rx, ry, rz);
  g.translate(x, y, z);
  return g;
}

/** Tapered tube between two points. */
function tube(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, seg = 8): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.translate(0, len / 2, 0);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

function cone(r: number, h: number, x: number, y: number, z: number, rx: number, ry = 0, rz = 0): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(r, h, 7);
  g.translate(0, h / 2, 0);
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx);
  g.translate(x, y, z);
  return g;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function buildTemplate(sp: SpeciesDef): Template {
  const L = sp.lengthM;
  const H = sp.hipHeightM;
  const plan = sp.locomotion.plan;
  const f = new Set(sp.look.features);
  const body: THREE.BufferGeometry[] = [];
  const neck: THREE.BufferGeometry[] = [];
  const tail: THREE.BufferGeometry[] = [];
  const legs: LegTemplate[] = [];
  let wings: THREE.BufferGeometry | null = null;
  let neckPivot = V(0, H, L * 0.2);
  let tailPivot = V(0, H, -L * 0.15);
  const wingPivot = V(0, H * 1.05, L * 0.05);

  const biped = plan === 'theropod' || plan === 'hadrosaur' || plan === 'bird';
  const leg = (x: number, z: number, len: number, r: number, phase: number, front: boolean) => {
    const thighLen = len * 0.5;
    legs.push({
      hip: V(x, len, z),
      thigh: paint(tube(V(0, 0, 0), V(0, -thighLen, plan === 'crocodyliform' ? 0 : r * 0.6), r, r * 0.7), sp, 'limb'),
      shin: paint(mergeGeometries([tube(V(0, 0, 0), V(0, -len * 0.5, -r * 0.3), r * 0.65, r * 0.4), box(r * 1.4, r * 0.4, r * 2.4, 0, -len * 0.5, r * 0.6)])!, sp, 'limb'),
      thighLen,
      phase,
      front,
    });
  };

  if (plan === 'theropod' || plan === 'hadrosaur' || plan === 'bird') {
    const bulk = plan === 'hadrosaur' ? 1.25 : f.has('feathers') && L < 3 ? 0.9 : 1;
    const torsoY = H * 1.05;
    body.push(paint(ellipsoid(L * 0.085 * bulk, L * 0.095 * bulk, L * 0.2, 0, torsoY, L * 0.06), sp, 'body'));
    neckPivot = V(0, torsoY + L * 0.04, L * 0.22);
    const neckLen = f.has('longNeck') ? L * 0.22 : L * 0.12;
    const headPos = V(0, neckLen * 0.75, neckLen * 0.85);
    neck.push(paint(tube(V(0, 0, 0), headPos, L * 0.05 * bulk, L * 0.035), sp, 'body'));
    const headLen = f.has('longSnout') ? L * 0.16 : plan === 'hadrosaur' ? L * 0.1 : L * 0.11;
    const headH = sp.ecology === 'apexPredator' ? L * 0.065 : L * 0.045;
    neck.push(paint(ellipsoid(headH * 0.75, headH, headLen * 0.55, headPos.x, headPos.y, headPos.z + headLen * 0.35), sp, 'body'));
    neck.push(paint(ellipsoid(headH * 0.6, headH * 0.35, headLen * 0.45, 0, headPos.y - headH * 0.55, headPos.z + headLen * 0.4), sp, 'body'));
    for (const side of [-1, 1]) neck.push(paint(ellipsoid(headH * 0.12, headH * 0.12, headH * 0.12, side * headH * 0.62, headPos.y + headH * 0.3, headPos.z + headLen * 0.5, 6), sp, 'dark'));
    if (f.has('crestTube')) neck.push(paint(tube(V(0, headPos.y + headH * 0.6, headPos.z + headLen * 0.3), V(0, headPos.y + headH * 1.6, headPos.z - headLen * 1.4), headH * 0.25, headH * 0.18), sp, 'accent'));
    if (f.has('dualCrest')) for (const side of [-1, 1]) neck.push(paint(box(headH * 0.08, headH * 0.6, headLen * 0.9, side * headH * 0.25, headPos.y + headH * 1.1, headPos.z + headLen * 0.35), sp, 'accent'));
    if (f.has('browHorns')) for (const side of [-1, 1]) neck.push(paint(cone(headH * 0.18, headH * 0.6, side * headH * 0.5, headPos.y + headH * 0.7, headPos.z + headLen * 0.05, -0.3, 0, side * -0.5), sp, 'horn'));
    if (f.has('dome')) neck.push(paint(ellipsoid(headH * 0.85, headH * 0.75, headH * 0.9, 0, headPos.y + headH * 0.6, headPos.z + headLen * 0.1), sp, 'accent'));
    if (f.has('beak')) neck.push(paint(cone(headH * 0.35, headLen * 0.5, 0, headPos.y - headH * 0.1, headPos.z + headLen * 0.85, Math.PI / 2), sp, 'horn'));
    if (f.has('sail')) {
      const sail = new THREE.CylinderGeometry(L * 0.18, L * 0.18, L * 0.02, 18, 1, false, 0, Math.PI);
      sail.rotateZ(Math.PI / 2);
      sail.rotateY(Math.PI / 2);
      sail.scale(1, 1.1, 1.4);
      sail.translate(0, torsoY + L * 0.07, L * 0.04);
      body.push(paint(sail, sp, 'accent'));
    }
    tailPivot = V(0, torsoY, -L * 0.12);
    tail.push(paint(tube(V(0, 0, 0), V(0, -H * 0.12, -L * 0.48), L * 0.065 * bulk, L * 0.008), sp, 'body'));
    if (f.has('feathers')) tail.push(paint(box(L * 0.08, L * 0.01, L * 0.18, 0, -H * 0.1, -L * 0.4), sp, 'accent'));
    // Arms.
    const armLen = f.has('longClaws') ? L * 0.14 : plan === 'hadrosaur' ? H * 0.75 : L * 0.06;
    for (const side of [-1, 1]) {
      body.push(paint(tube(V(side * L * 0.06, torsoY - L * 0.02, L * 0.18), V(side * L * 0.07, torsoY - armLen, L * 0.22), L * 0.018, L * 0.01), sp, 'limb'));
      if (f.has('longClaws') || f.has('thumbSpike')) body.push(paint(cone(L * 0.008, L * 0.05, side * L * 0.07, torsoY - armLen, L * 0.22, Math.PI * 0.8), sp, 'horn'));
      // Pennaceous arm feathers on feathered theropods (folded "wings").
      if (f.has('feathers') && !f.has('wings')) body.push(paint(box(L * 0.006, armLen * 0.9, L * 0.09, side * L * 0.075, torsoY - armLen * 0.5, L * 0.16), sp, 'accent'));
    }
    const legR = Math.max(0.04, L * (plan === 'hadrosaur' ? 0.04 : 0.032));
    leg(-L * 0.06, 0, H, legR, 0, false);
    leg(L * 0.06, 0, H, legR, 0.5, false);
    if (plan === 'bird' || f.has('wings')) {
      const w = new THREE.BufferGeometry();
      const span = L * 0.75;
      w.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, L * 0.12, span, 0, 0, 0, 0, -L * 0.12, span, 0, 0, span * 0.3, 0, -L * 0.2, 0, 0, -L * 0.12]), 3));
      w.computeVertexNormals();
      wings = paint(w, sp, 'accent');
    }
  } else if (plan === 'quadruped' || plan === 'crocodyliform') {
    const croc = plan === 'crocodyliform';
    const torsoY = croc ? H * 0.75 : H * 1.0;
    body.push(paint(ellipsoid(L * (croc ? 0.08 : 0.13), L * (croc ? 0.05 : 0.12), L * 0.24, 0, torsoY, 0), sp, 'body'));
    neckPivot = V(0, torsoY, L * 0.22);
    const ceratopsian = f.has('frill');
    const headLen = croc ? L * 0.2 : ceratopsian ? L * 0.2 : L * 0.14;
    const headH = croc ? L * 0.035 : ceratopsian ? L * 0.075 : L * 0.06;
    const hz = headLen * 0.6;
    neck.push(paint(ellipsoid(headH * 1.1, headH, headLen * 0.55, 0, croc ? 0 : -headH * 0.3, hz), sp, 'body'));
    for (const side of [-1, 1]) neck.push(paint(ellipsoid(headH * 0.14, headH * 0.14, headH * 0.14, side * headH * 0.9, headH * 0.3, hz - headLen * 0.1, 6), sp, 'dark'));
    if (f.has('beak') || f.has('horns3')) neck.push(paint(cone(headH * 0.4, headLen * 0.35, 0, -headH * 0.5, hz + headLen * 0.45, Math.PI / 2), sp, 'horn'));
    if (f.has('frill')) {
      const fr = new THREE.CircleGeometry(headH * (f.has('horns3') ? 2.1 : 1.6), 16, 0, Math.PI);
      fr.rotateX(-0.95);
      fr.translate(0, headH * 0.4, hz - headLen * 0.35);
      neck.push(paint(fr, sp, 'accent'));
      if (f.has('frillSpikes')) for (let i = -2; i <= 2; i++) neck.push(paint(cone(headH * 0.12, headH * 0.8, i * headH * 0.6, headH * 1.9 - Math.abs(i) * headH * 0.3, hz - headLen * 0.5, -0.6), sp, 'horn'));
    }
    if (f.has('horns3')) {
      for (const side of [-1, 1]) neck.push(paint(cone(headH * 0.2, headLen * 0.9, side * headH * 0.5, headH * 0.7, hz - headLen * 0.05, 1.0), sp, 'horn'));
      neck.push(paint(cone(headH * 0.18, headLen * 0.35, 0, headH * 0.1, hz + headLen * 0.3, 0.6), sp, 'horn'));
    }
    if (f.has('nasalBoss')) neck.push(paint(ellipsoid(headH * 0.5, headH * 0.35, headH * 0.6, 0, headH * 0.8, hz + headLen * 0.1), sp, 'horn'));
    if (f.has('plates')) for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const pz = L * 0.2 - t * L * 0.55;
      const ph = L * 0.09 * Math.sin(Math.PI * (0.15 + t * 0.8));
      for (const side of [-1, 1]) body.push(paint(box(L * 0.008, ph, ph * 0.9, side * L * 0.02, torsoY + L * 0.11 + ph * 0.3, pz, 0.15), sp, 'accent'));
    }
    if (f.has('armor') || f.has('scutes')) for (let i = 0; i < 18; i++) {
      const a = (i % 6) / 5 - 0.5;
      const pz = L * 0.18 - Math.floor(i / 6) * L * 0.15;
      body.push(paint(cone(L * 0.015, L * 0.03, a * L * 0.2, torsoY + L * (croc ? 0.045 : 0.11) - Math.abs(a) * L * 0.06, pz, 0, 0, a * 1.4), sp, 'horn'));
    }
    tailPivot = V(0, torsoY, -L * 0.2);
    tail.push(paint(tube(V(0, 0, 0), V(0, croc ? -H * 0.2 : -H * 0.15, -L * 0.5), L * (croc ? 0.06 : 0.07), L * 0.01), sp, 'body'));
    if (f.has('club')) tail.push(paint(ellipsoid(L * 0.06, L * 0.04, L * 0.06, 0, -H * 0.15, -L * 0.5), sp, 'horn'));
    if (f.has('tailSpikes')) for (const side of [-1, 1]) for (const k of [0.42, 0.48]) tail.push(paint(cone(L * 0.012, L * 0.09, 0, -H * 0.12, -L * k, 0, 0, side * 1.1), sp, 'horn'));
    const legR = L * (croc ? 0.025 : 0.04);
    const fl = croc ? H * 0.95 : H * (f.has('plates') ? 0.7 : 0.9);
    leg(-L * 0.1, L * 0.15, fl, legR, 0, true);
    leg(L * 0.1, L * 0.15, fl, legR, 0.5, true);
    leg(-L * 0.1, -L * 0.13, H, legR * 1.1, 0.5, false);
    leg(L * 0.1, -L * 0.13, H, legR * 1.1, 0, false);
  } else if (plan === 'sauropod') {
    const torsoY = H * 1.15;
    body.push(paint(ellipsoid(L * 0.08, L * 0.085, L * 0.17, 0, torsoY, 0), sp, 'body'));
    neckPivot = V(0, torsoY + L * 0.03, L * 0.14);
    const headPos = V(0, H * 1.25, L * 0.24);
    neck.push(paint(tube(V(0, 0, 0), headPos, L * 0.045, L * 0.017, 10), sp, 'body'));
    neck.push(paint(ellipsoid(L * 0.017, L * 0.02, L * 0.035, headPos.x, headPos.y + L * 0.01, headPos.z + L * 0.02), sp, 'body'));
    tailPivot = V(0, torsoY, -L * 0.14);
    tail.push(paint(tube(V(0, 0, 0), V(0, -H * 0.4, -L * 0.48), L * 0.05, L * 0.006, 10), sp, 'body'));
    const legR = L * 0.03;
    leg(-L * 0.06, L * 0.12, H * 1.15, legR, 0, true);
    leg(L * 0.06, L * 0.12, H * 1.15, legR, 0.5, true);
    leg(-L * 0.06, -L * 0.1, H, legR * 1.1, 0.5, false);
    leg(L * 0.06, -L * 0.1, H, legR * 1.1, 0, false);
  } else {
    // Pterosaur: compact body, long head with crest, membrane wings.
    const torsoY = H * 0.9;
    body.push(paint(ellipsoid(L * 0.1, L * 0.1, L * 0.22, 0, torsoY, 0), sp, 'body'));
    neckPivot = V(0, torsoY + L * 0.05, L * 0.18);
    const neckLen = f.has('longNeck') ? L * 0.35 : L * 0.15;
    neck.push(paint(tube(V(0, 0, 0), V(0, neckLen * 0.6, neckLen), L * 0.04, L * 0.03), sp, 'body'));
    neck.push(paint(cone(L * 0.05, L * 0.5, 0, neckLen * 0.6, neckLen, Math.PI / 2), sp, 'horn'));
    if (f.has('headCrest')) neck.push(paint(cone(L * 0.03, L * 0.35, 0, neckLen * 0.6 + L * 0.02, neckLen, -Math.PI / 2 - 0.3), sp, 'accent'));
    tailPivot = V(0, torsoY, -L * 0.2);
    tail.push(paint(tube(V(0, 0, 0), V(0, 0, -L * 0.1), L * 0.03, L * 0.005), sp, 'body'));
    const span = L * 1.4;
    const w = new THREE.BufferGeometry();
    w.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, L * 0.15, span, 0, L * 0.05, 0, 0, -L * 0.15, span, 0, L * 0.05, span * 0.5, 0, -L * 0.12, 0, 0, -L * 0.15]), 3));
    w.computeVertexNormals();
    wings = paint(w, sp, 'body');
    const legR = L * 0.025;
    leg(-L * 0.12, L * 0.12, H, legR, 0, true);
    leg(L * 0.12, L * 0.12, H, legR, 0.5, true);
    leg(-L * 0.06, -L * 0.1, H * 0.7, legR * 0.8, 0.5, false);
    leg(L * 0.06, -L * 0.1, H * 0.7, legR * 0.8, 0, false);
  }
  void biped;

  const merge = (arr: THREE.BufferGeometry[]) => {
    const g = mergeGeometries(arr.map((x) => (x.index ? x.toNonIndexed() : x)))!;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.userData.shared = true;
    return g;
  };
  // Neck geometry is authored relative to the pivot (except for theropods where head was computed relative to pivot already).
  return {
    body: merge(body),
    neck: merge(neck),
    neckPivot,
    tail: merge(tail),
    tailPivot,
    legs,
    wings,
    wingPivot,
    hipHeight: H,
  };
}

function template(sp: SpeciesDef): Template {
  let t = templates.get(sp.id);
  if (!t) {
    t = buildTemplate(sp);
    for (const l of t.legs) l.thigh.userData.shared = l.shin.userData.shared = true;
    if (t.wings) t.wings.userData.shared = true;
    templates.set(sp.id, t);
  }
  return t;
}

export function createAnimalView(speciesId: string): AnimalView {
  const sp = SPECIES[speciesId];
  const tpl = template(sp);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const mk = (g: THREE.BufferGeometry) => {
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  body.add(mk(tpl.body));
  const neck = new THREE.Group();
  neck.position.copy(tpl.neckPivot);
  neck.add(mk(tpl.neck));
  body.add(neck);
  const tail = new THREE.Group();
  tail.position.copy(tpl.tailPivot);
  tail.add(mk(tpl.tail));
  body.add(tail);
  const legs = tpl.legs.map((t) => {
    const thigh = new THREE.Group();
    thigh.position.copy(t.hip);
    thigh.add(mk(t.thigh));
    const shin = new THREE.Group();
    shin.position.set(0, -t.thighLen, sp.locomotion.plan === 'crocodyliform' ? 0 : 0);
    shin.add(mk(t.shin));
    thigh.add(shin);
    body.add(thigh);
    return { thigh, shin, t };
  });
  const wings: THREE.Group[] = [];
  if (tpl.wings) {
    for (const side of [-1, 1]) {
      const w = new THREE.Group();
      w.position.copy(tpl.wingPivot);
      if (sp.locomotion.plan === 'pterosaur') w.position.y = tpl.hipHeight * 0.95;
      const m = new THREE.Mesh(tpl.wings, wingMaterial);
      m.castShadow = true;
      m.scale.x = side;
      w.add(m);
      body.add(w);
      wings.push(w);
    }
  }
  root.userData.speciesId = speciesId;
  return { root, body, neck, tail, legs, wings, sp, tpl, posture: 0, flap: 0 };
}

/** Poses the model for the current frame. */
export function poseAnimalView(v: AnimalView, a: AnimalData, stride: number, altitude: number, now: number, dt: number, camDist: number): void {
  const sp = v.sp;
  const g = growthScale(a, now);
  v.root.position.set(a.x, a.y, a.z);
  v.root.rotation.y = a.heading;
  v.root.scale.setScalar(g);
  const castShadow = camDist < 90;
  v.root.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = castShadow;
  });

  if (!a.alive) {
    v.body.rotation.z = Math.PI / 2 * 0.92;
    v.body.position.y = -v.tpl.hipHeight * 0.55;
    v.legs.forEach((l) => (l.thigh.rotation.x = 0.3));
    v.neck.rotation.x = 0.4;
    return;
  }
  v.body.rotation.z = 0;

  const speed = a.speed;
  const run = clamp(speed / Math.max(0.1, sp.runSpeed), 0, 1);
  const moving = speed > 0.05;
  const airborne = altitude > 1;
  const resting = a.state === 'rest' && !moving;
  v.posture += ((resting ? 1 : 0) - v.posture) * damp(1.5, dt);

  const cycle = stride * Math.PI * 2 * 0.5;
  const amp = moving ? 0.35 + run * 0.45 : 0;
  for (const l of v.legs) {
    const ph = cycle + l.t.phase * Math.PI * 2;
    const swing = Math.sin(ph) * amp;
    if (airborne) {
      l.thigh.rotation.x = -1.1;
      l.shin.rotation.x = 1.2;
    } else {
      l.thigh.rotation.x = swing * (1 - v.posture) - v.posture * 1.2;
      l.shin.rotation.x = Math.max(0, -Math.cos(ph)) * amp * 1.2 + v.posture * 2;
    }
  }
  // Body bob tied to stride and lowered posture when resting.
  const bob = moving && !airborne ? Math.abs(Math.sin(cycle)) * 0.04 * sp.hipHeightM * (0.5 + run) : 0;
  v.body.position.y = bob - v.posture * sp.hipHeightM * 0.55;
  v.body.rotation.x = airborne ? -0.05 : run * 0.06;

  // Head: lowered to graze/drink/eat, raised when alert.
  const headDown = !moving && (a.state === 'graze' || a.state === 'drink' || a.state === 'eat') ? 0.75 : a.state === 'alert' ? -0.25 : 0;
  const breathe = Math.sin(now * 1.3 + a.x) * 0.03;
  v.neck.rotation.x += (headDown + breathe - v.neck.rotation.x) * damp(3, dt);
  v.tail.rotation.y = Math.sin(now * (moving ? 2 + run * 3 : 0.8) + a.z) * (moving ? 0.12 : 0.06);
  v.tail.rotation.x = -run * 0.1;

  if (v.wings.length) {
    const flapping = airborne;
    v.flap += dt * (flapping ? (a.state === 'flee' ? 9 : 4) : 0);
    const spread = flapping ? 1 : 0.25;
    v.wings.forEach((w, i) => {
      const side = i === 0 ? -1 : 1;
      w.scale.x = spread;
      w.rotation.z = flapping ? side * Math.sin(v.flap) * 0.6 : side * -0.9;
    });
  }
}

/** A simple nest mound with eggs. */
export function createNestView(eggs: number, size: number): THREE.Group {
  const g = new THREE.Group();
  const mound = new THREE.Mesh(new THREE.TorusGeometry(size * 0.6, size * 0.25, 6, 12), new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 1 }));
  mound.rotation.x = -Math.PI / 2;
  mound.position.y = size * 0.1;
  g.add(mound);
  const eggMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.7 });
  for (let i = 0; i < Math.min(eggs, 16); i++) {
    const a = (i / Math.min(eggs, 16)) * Math.PI * 2;
    const e = new THREE.Mesh(new THREE.SphereGeometry(size * 0.12, 8, 6), eggMat);
    e.scale.y = 1.3;
    e.position.set(Math.cos(a) * size * 0.3, size * 0.15, Math.sin(a) * size * 0.3);
    g.add(e);
  }
  return g;
}
