import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { TextureLibrary } from '../graphics/textureLibrary';
import { createContactShadow } from '../graphics/contactShadow';
import { driveExternal, hasExternal, instantiate, type ExternalInstance } from '../graphics/externalModels';
import type { AnimalData } from './animal';
import { growthScale } from './animal';
import { buildDinoTemplate, DMAT, type DinoTemplate } from './dinoModel';
import { SPECIES, type SpeciesDef } from './species';

/**
 * Animal views: skinned procedural dinosaurs (see dinoModel.ts) posed every
 * frame from the simulation.
 *
 * - Locomotion: duty-factor gait driven by the distance actually travelled
 *   (the brain's stride counter), so planted feet do not slide; legs are
 *   solved with IK (thigh + shin, the metatarsus keeps its orientation, toes
 *   stay flat) onto the real terrain height under each foot; the body pitches
 *   on slopes and bobs with the steps.
 * - Tail waves and counterbalances, the neck lowers to graze or drink and
 *   rises when alert, the jaw chews, roars and pants.
 * - Resting animals lie down (the IK folds the legs), dead ones roll over,
 *   flyers tuck their legs and flap.
 * - Distant animals switch to a low-detail mesh; every individual gets a
 *   slightly different size and tint.
 */
export interface AnimalView {
  root: THREE.Group;
  sp: SpeciesDef;
  tpl: DinoTemplate;
  meshHi: THREE.SkinnedMesh;
  meshLo: THREE.SkinnedMesh;
  bones: Map<string, THREE.Bone>;
  rest: Map<string, THREE.Vector3>;
  materials: THREE.MeshStandardMaterial[];
  shadow: THREE.Mesh;
  size: number;
  posture: number;
  flap: number;
  jaw: number;
  look: number;
  pelvisDrop: number;
  bodyPitch: number;
  legInfo: LegRuntime[];
  /** Artist model replacing the procedural one (see externalModels.ts). */
  ext: ExternalInstance | null;
}

interface LegRuntime {
  name: string;
  front: boolean;
  walking: boolean;
  phase: number;
  l0: number;
  l1: number;
  /** Rest angles (forward-positive, from straight down) of thigh, shin, metatarsus. */
  r: [number, number, number];
  hip: THREE.Vector3;
  toe: THREE.Vector3;
  metaVec: THREE.Vector3;
  kneeForward: boolean;
}

const templates = new Map<string, DinoTemplate>();
let library: TextureLibrary | null = null;
let groundFn: ((x: number, z: number) => number) | null = null;
const baseMats = new Map<string, THREE.MeshStandardMaterial[]>();

/** The game supplies the texture library and terrain height (both optional for tools/tests). */
export function setAnimalContext(lib: TextureLibrary | null, ground: ((x: number, z: number) => number) | null): void {
  library = lib;
  groundFn = ground;
}

function template(sp: SpeciesDef): DinoTemplate {
  let t = templates.get(sp.id);
  if (!t) {
    t = buildDinoTemplate(sp);
    t.geometry.userData.shared = true;
    t.low.userData.shared = true;
    templates.set(sp.id, t);
  }
  return t;
}

function speciesMaterials(sp: SpeciesDef): THREE.MeshStandardMaterial[] {
  let m = baseMats.get(sp.id);
  if (m) return m;
  const scales = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  const feathers = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const horn = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0 });
  const eye = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0 });
  const membrane = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, transparent: false });
  if (library) {
    library.bind(scales, 'scales');
    library.bind(feathers, 'feathers');
    library.bind(membrane, 'leather');
  }
  m = [scales, feathers, horn, eye, membrane];
  for (const x of m) x.userData.shared = true;
  baseMats.set(sp.id, m);
  return m;
}

function hashId(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** Forward-positive angle of a (y, z) vector measured from straight down. */
const ang = (v: THREE.Vector3) => Math.atan2(v.z, -v.y);

/** Builds species models ahead of time within a time budget (loading screen). */
export function prewarmAnimals(ids: string[], budgetMs: number): boolean {
  const t0 = performance.now();
  for (const id of ids) {
    if (templates.has(id)) continue;
    template(SPECIES[id]);
    if (performance.now() - t0 > budgetMs) return false;
  }
  return true;
}

export function createAnimalView(speciesId: string, individual = ''): AnimalView {
  const sp = SPECIES[speciesId];
  const tpl = template(sp);
  const root = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  const rest = new Map<string, THREE.Vector3>();
  for (const b of tpl.bones) {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bones.set(b.name, bone);
  }
  for (const b of tpl.bones) {
    const bone = bones.get(b.name)!;
    const local = b.pos.clone();
    if (b.parent) {
      local.sub(tpl.bones.find((x) => x.name === b.parent)!.pos);
      bones.get(b.parent)!.add(bone);
    }
    bone.position.copy(local);
    rest.set(b.name, local.clone());
  }
  // Bones must have up-to-date world matrices before the bind pose is captured.
  root.add(bones.get('root')!);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(tpl.bones.map((b) => bones.get(b.name)!));
  // Per-individual tint of skin/feathers (shared textures, cloned materials).
  const base = speciesMaterials(sp);
  const tint = 0.9 + hashId(individual || speciesId, 1) * 0.2;
  const hue = (hashId(individual || speciesId, 2) - 0.5) * 0.06;
  const materials = base.map((m, i) => {
    if (i !== DMAT.scales && i !== DMAT.feathers) return m;
    const c = m.clone();
    c.color.setRGB(tint * (1 + hue), tint, tint * (1 - hue));
    c.userData.shared = false;
    if (library) library.bind(c, i === DMAT.scales ? 'scales' : 'feathers');
    return c;
  });
  const mk = (g: THREE.BufferGeometry) => {
    const m = new THREE.SkinnedMesh(g, g.groups.length ? materials : materials[sp.look.features.includes('feathers') ? DMAT.feathers : DMAT.scales]);
    root.add(m);
    m.bind(skeleton, new THREE.Matrix4());
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  };
  const meshHi = mk(tpl.geometry);
  const meshLo = mk(tpl.low);
  meshLo.visible = false;
  const shadow = createContactShadow(Math.max(0.25, sp.lengthM * 0.3), 0.5);
  root.add(shadow);
  root.userData.speciesId = speciesId;

  const legInfo: LegRuntime[] = tpl.legs.map((l) => {
    const j = l.joints;
    const plan = sp.locomotion.plan;
    const biped = plan === 'theropod' || plan === 'hadrosaur' || plan === 'bird';
    const walking = !(biped && l.front);
    const d0 = j[1].clone().sub(j[0]);
    const d1 = j[2].clone().sub(j[1]);
    const d2 = j[3].clone().sub(j[2]);
    // Knee direction relative to the hip→ankle line.
    const line = j[2].clone().sub(j[0]);
    const kneeForward = ang(d0) > ang(line);
    return { name: l.name, front: l.front, walking, phase: l.phase, l0: d0.length(), l1: d1.length(), r: [ang(d0), ang(d1), ang(d2)], hip: j[0].clone(), toe: j[3].clone(), metaVec: j[2].clone().sub(j[3]), kneeForward };
  });
  const size = 0.94 + hashId(individual || speciesId, 3) * 0.12;
  const view: AnimalView = { root, sp, tpl, meshHi, meshLo, bones, rest, materials, shadow, size, posture: 0, flap: 0, jaw: 0, look: 0, pelvisDrop: 0, bodyPitch: 0, legInfo, ext: null };
  if (hasExternal(speciesId))
    void instantiate(speciesId).then((inst) => {
      if (!inst || !root.parent) return;
      view.ext = inst;
      root.add(inst.root);
    });
  return view;
}

export function disposeAnimalView(v: AnimalView): void {
  v.root.removeFromParent();
  v.ext?.dispose();
  for (const m of v.materials)
    if (!m.userData.shared) {
      library?.unbind(m);
      m.dispose();
    }
  v.shadow.geometry.dispose();
  (v.shadow.material as THREE.Material).dispose();
  v.meshHi.skeleton.dispose();
}

/** Poses the model for the current frame. */
export function poseAnimalView(v: AnimalView, a: AnimalData, stride: number, altitude: number, now: number, dt: number, camDist: number, lodDistance = 70): void {
  const sp = v.sp;
  const g = growthScale(a, now) * v.size;
  v.root.position.set(a.x, a.y, a.z);
  v.root.rotation.set(0, a.heading, 0);
  v.root.scale.setScalar(g);
  const far = camDist > lodDistance;
  v.meshHi.visible = !far;
  v.meshLo.visible = far;
  const shadows = camDist < 90;
  v.meshHi.castShadow = shadows;
  v.meshLo.castShadow = shadows;
  if (v.ext) {
    v.meshHi.visible = v.meshLo.visible = false;
    v.ext.root.rotation.z = a.alive ? 0 : Math.PI / 2;
    driveExternal(v.ext, dt, a.state, a.speed / Math.max(0.2, g), sp.walkSpeed, sp.runSpeed, altitude > 1);
    return;
  }

  const B = v.bones;
  for (const [name, b] of B) {
    b.position.copy(v.rest.get(name)!);
    b.rotation.set(0, 0, 0);
  }
  const bone = (n: string) => B.get(n);
  const pelvis = bone('pelvis')!;

  if (!a.alive) {
    pelvis.rotation.z = Math.PI / 2 * 0.92;
    pelvis.position.y = v.tpl.hipHeight * 0.35;
    for (const l of v.legInfo) {
      const t = bone(`${l.name}0`);
      if (t) t.rotation.x = 0.3;
    }
    const n1 = bone('neck1');
    if (n1) n1.rotation.x = 0.4;
    v.shadow.visible = false;
    return;
  }
  v.shadow.visible = altitude < 2;

  const runF = clamp(a.speed / Math.max(0.1, sp.runSpeed), 0, 1);
  const moving = a.speed > 0.05;
  const airborne = altitude > 1;
  const resting = a.state === 'rest' && !moving;
  const k = (r: number) => damp(r, dt);
  v.posture += ((resting ? 1 : 0) - v.posture) * k(1.2);
  const mv = moving && !airborne ? 1 : 0;

  // ---- Legs ----------------------------------------------------------------
  const stepLen = sp.locomotion.stride;
  const H = v.tpl.hipHeight;
  const cycle = stride / 2;
  const cy = Math.cos(a.heading);
  const sy = Math.sin(a.heading);
  // Ground under each walking foot (model units, relative to the animal's origin).
  const groundAt = (local: THREE.Vector3) => {
    if (!groundFn || camDist > 60) return 0;
    const wx = a.x + (local.x * cy + local.z * sy) * g;
    const wz = a.z + (-local.x * sy + local.z * cy) * g;
    return clamp((groundFn(wx, wz) - a.y) / g, -0.3 * H, 0.3 * H);
  };
  let drop = 0;
  const targets: { l: LegRuntime; T: THREE.Vector3; toeOff: number }[] = [];
  let frontG = 0;
  let hindG = 0;
  let nf = 0;
  let nh = 0;
  for (const l of v.legInfo) {
    if (!l.walking) continue;
    const reach = (l.l0 + l.l1) * 0.62;
    const duty = Math.min(0.7 - runF * 0.3, reach / (2 * stepLen));
    const stanceLen = 2 * stepLen * duty * mv * (1 - v.posture);
    const u = (((cycle + l.phase) % 1) + 1) % 1;
    let fz: number;
    let lift = 0;
    let toeOff = 0;
    if (u < duty) {
      fz = stanceLen * (0.5 - u / duty);
      toeOff = Math.max(0, u / duty - 0.75) / 0.25;
    } else {
      const w = (u - duty) / (1 - duty);
      fz = stanceLen * (-0.5 + (1 - Math.cos(w * Math.PI)) / 2);
      lift = Math.sin(w * Math.PI) * H * (0.12 + runF * 0.12) * mv;
    }
    const T = l.toe.clone().add(new THREE.Vector3(0, lift, fz));
    if (airborne) T.set(l.toe.x, l.hip.y - (l.l0 + l.l1) * 0.55, l.toe.z - (l.l0 + l.l1) * 0.45);
    else {
      const gy = groundAt(T);
      T.y += gy;
      if (l.front) {
        frontG += gy;
        nf++;
      } else {
        hindG += gy;
        nh++;
      }
    }
    // Pelvis must come down if the foot would be out of reach (also folds the legs when resting).
    const A = T.clone().add(l.metaVec);
    const d = Math.hypot(A.y - l.hip.y, A.z - l.hip.z);
    drop = Math.max(drop, d - (l.l0 + l.l1) * 0.97);
    targets.push({ l, T, toeOff });
  }
  // Body pitch from the ground under front and hind feet (quadrupeds), smoothed.
  const span = Math.abs((v.legInfo.find((l) => l.front && l.walking)?.hip.z ?? 0) - (v.legInfo.find((l) => !l.front)?.hip.z ?? 0)) || 1;
  const pitchTarget = nf && nh ? Math.atan2(hindG / nh - frontG / nf, span) : 0;
  v.bodyPitch += (clamp(pitchTarget, -0.35, 0.35) - v.bodyPitch) * k(4);
  const bob = moving && !airborne ? -Math.cos(cycle * Math.PI * 4) * H * (0.012 + runF * 0.02) : 0;
  const rest = v.posture * H * 0.55;
  v.pelvisDrop += (Math.max(0, drop) + rest - v.pelvisDrop) * k(10);
  pelvis.position.y -= v.pelvisDrop - bob - (nh ? hindG / nh : 0) * 0.5 - (nf ? frontG / nf : 0) * 0.5;
  pelvis.rotation.x = v.bodyPitch + runF * 0.05 * mv;
  pelvis.rotation.z = Math.sin(cycle * Math.PI * 2) * 0.025 * mv;
  pelvis.rotation.y = Math.sin(cycle * Math.PI * 2) * 0.04 * mv;

  // IK per walking leg (in the pelvis frame; pelvis offsets applied to the hip).
  const hipShift = pelvis.position.y - v.rest.get('pelvis')!.y;
  for (const { l, T, toeOff } of targets) {
    const hip = l.hip.clone();
    hip.y += hipShift;
    const A = T.clone().add(l.metaVec);
    let dy = A.y - hip.y;
    let dz = A.z - hip.z;
    let d = Math.hypot(dy, dz);
    const maxD = (l.l0 + l.l1) * 0.999;
    const minD = Math.abs(l.l0 - l.l1) + 1e-3;
    if (d > maxD) {
      dy *= maxD / d;
      dz *= maxD / d;
      d = maxD;
    }
    d = Math.max(d, minD);
    const phi = Math.atan2(dz, -dy);
    const beta = Math.acos(clamp((l.l0 * l.l0 + d * d - l.l1 * l.l1) / (2 * l.l0 * d), -1, 1));
    const t0 = l.kneeForward ? phi + beta : phi - beta;
    const kneeY = hip.y - Math.cos(t0) * l.l0;
    const kneeZ = hip.z + Math.sin(t0) * l.l0;
    const t1 = Math.atan2(hip.z + dz - kneeZ, -(hip.y + dy - kneeY));
    const d0 = t0 - l.r[0] + v.bodyPitch;
    const d1 = t1 - l.r[1];
    const d2 = toeOff * 0.5;
    const b0 = bone(`${l.name}0`);
    const b1 = bone(`${l.name}1`);
    const b2 = bone(`${l.name}2`);
    const b3 = bone(`${l.name}3`);
    if (b0) b0.rotation.x = -d0;
    if (b1) b1.rotation.x = -(d1 - (d0 - v.bodyPitch));
    if (b2) b2.rotation.x = -(d2 - d1);
    if (b3) b3.rotation.x = d2;
  }
  // Arms of bipeds: swing a little, folded closer when running.
  for (const l of v.legInfo) {
    if (l.walking) continue;
    const b0 = bone(`${l.name}0`);
    const b1 = bone(`${l.name}1`);
    const sw = Math.sin(cycle * Math.PI * 2 + (l.name.endsWith('L') ? 0 : Math.PI)) * 0.15 * mv;
    if (b0) b0.rotation.x = sw - runF * 0.3 + v.posture * 0.5;
    if (b1) b1.rotation.x = -0.3 - runF * 0.4;
  }

  // ---- Tail, neck, head, jaw -------------------------------------------------
  const tailNames = ['tail1', 'tail2', 'tail3', 'tail4'];
  const tailAmp = moving ? 0.05 + runF * 0.05 : 0.03;
  const tailFreq = moving ? Math.PI * 2 : 0.8;
  tailNames.forEach((n, i) => {
    const b = bone(n);
    if (!b) return;
    const ph = moving ? cycle * tailFreq : now * tailFreq + a.z;
    b.rotation.y = Math.sin(ph - i * 0.7) * tailAmp * (1 + i * 0.4);
    b.rotation.x = (v.posture * 0.12 - runF * 0.04) * (i === 0 ? 1 : 0.6) + (airborne ? -0.05 : 0);
  });
  const grazing = !moving && (a.state === 'graze' || a.state === 'drink' || a.state === 'eat');
  const alert = a.state === 'alert' || a.state === 'flee';
  const headDown = grazing ? 1 : alert ? -0.35 : v.posture * 0.6;
  v.look += (headDown - v.look) * k(2.5);
  const neckBones = ['neck1', 'neck2', 'neck3'].map(bone).filter((b): b is THREE.Bone => !!b);
  const lowerTotal = sp.locomotion.plan === 'sauropod' ? 0.9 : sp.hipHeightM > 1 ? 0.75 : 0.6;
  const breathe = Math.sin(now * 1.4 + a.x) * 0.02;
  neckBones.forEach((b, i) => {
    b.rotation.x = (v.look * lowerTotal) / neckBones.length + (i === 0 ? -v.bodyPitch : 0) + breathe * 0.5;
    b.rotation.y = Math.sin(now * 0.3 + a.x + i) * 0.05 * (1 - mv);
  });
  const head = bone('head');
  if (head) head.rotation.x = v.look * 0.35 - runF * 0.1;
  const jawTarget = grazing ? 0.12 + Math.max(0, Math.sin(now * 6 + a.x)) * 0.18 : a.state === 'defend' || a.state === 'hunt' ? 0.5 : runF > 0.6 ? 0.18 : 0.02;
  v.jaw += (jawTarget - v.jaw) * k(8);
  const jaw = bone('jaw');
  if (jaw) jaw.rotation.x = v.jaw;
  const chest = bone('chest');
  if (chest) chest.scale.setScalar(1 + Math.sin(now * 1.8 + a.x) * 0.012);

  // ---- Flight ------------------------------------------------------------------
  if (airborne || sp.locomotion.flies) {
    v.flap += dt * (airborne ? (a.state === 'flee' ? 9 : 4.5) : 0);
    for (const l of v.legInfo) {
      if (!(l.name.startsWith('wing') || (l.front && (sp.locomotion.plan === 'bird' || sp.look.features.includes('wings'))))) continue;
      const side = l.name.endsWith('L') ? 1 : -1;
      const b0 = bone(`${l.name}0`);
      const b1 = bone(`${l.name}1`);
      const b2 = bone(`${l.name}2`);
      if (!b0 || !b1) continue;
      if (airborne) {
        const f = Math.sin(v.flap);
        b0.rotation.set(0, 0, side * (1.35 + f * 0.55));
        b1.rotation.set(0, 0, side * 0.25);
        if (b2) b2.rotation.set(0, 0, side * 0.2);
      }
    }
  }
  // Contact shadow under the body.
  v.shadow.position.set(0, 0.02 + (airborne ? 0 : 0), (v.legInfo[0]?.hip.z ?? 0) * 0.5);
}

/** A simple nest mound with eggs. */
export function createNestView(eggs: number, size: number): THREE.Group {
  const g = new THREE.Group();
  const mound = new THREE.Mesh(new THREE.TorusGeometry(size * 0.6, size * 0.25, 8, 16), new THREE.MeshStandardMaterial({ color: 0x5a4a32, roughness: 1 }));
  mound.rotation.x = -Math.PI / 2;
  mound.position.y = size * 0.1;
  g.add(mound);
  const eggMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.7 });
  for (let i = 0; i < Math.min(eggs, 16); i++) {
    const a = (i / Math.min(eggs, 16)) * Math.PI * 2;
    const e = new THREE.Mesh(new THREE.SphereGeometry(size * 0.12, 12, 8), eggMat);
    e.scale.y = 1.3;
    e.position.set(Math.cos(a) * size * 0.3, size * 0.15, Math.sin(a) * size * 0.3);
    g.add(e);
  }
  return g;
}
