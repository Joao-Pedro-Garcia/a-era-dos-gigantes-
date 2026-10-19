import type { MoveKind } from '../combat/dinoAttacks';
import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { TextureLibrary } from '../graphics/textureLibrary';
import { createContactShadow } from '../graphics/contactShadow';
import { RIG_FITS } from './rigFits';
import { driveExternal, instantiate, riggedMesh, setExternalShadows, type ExternalInstance } from '../graphics/externalModels';
import type { AnimalData } from './animal';
import { growthScale } from './animal';
import { ALPHA } from './alpha';
import { type AlphaAura, createAlphaAura, disposeAlphaAura } from './alphaAura';

/** Hide colour of alpha males: darker, toward red. */
const ALPHA_TINT = new THREE.Color(0.82, 0.58, 0.52);
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
  meshMid: THREE.SkinnedMesh;
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
  /** Artist skin re-bound to this skeleton (animated by the game), shown up close. */
  rig: THREE.SkinnedMesh | null;
  /** Jaw rest angle of the re-bound skin (closes a mouth bound open). */
  jawRest: number;
  /** Built with juvenile proportions. */
  juvenile: boolean;
  /** Built as an alpha male (bigger, darker reddish tint, ember aura). */
  alpha: boolean;
  aura: AlphaAura | null;
  /** Materials cloned to tint an external model (disposed with the view). */
  extMats: THREE.Material[];
  /** Hit reaction: time since the blow, its direction in the animal's frame and strength. */
  hitT: number;
  /** Seconds since death (animated fall). */
  deadT: number;
  /** Current head scan angle (observing). */
  scan: number;
  /** Smoothed turning rate (rad/s) and the last heading, for leaning into turns. */
  turn: number;
  lastHeading: number;
  hitLX: number;
  hitLZ: number;
  hitAmp: number;
}

/**
 * Registers a blow for the hit reaction (flinch away from it, head jerk,
 * tail whip). `strength` is already scaled by the animal's size: a small
 * animal is knocked visibly, a giant barely shudders.
 */
export function hitAnimalView(v: AnimalView, dirX: number, dirZ: number, heading: number, strength: number): void {
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const l = Math.hypot(dirX, dirZ) || 1;
  v.hitLX = (dirX * c - dirZ * s) / l;
  v.hitLZ = (dirX * s + dirZ * c) / l;
  v.hitT = 0;
  v.hitAmp = Math.min(1.2, strength);
}

/** Size factor of hit reactions: ~1.2 for a 10 kg animal, ~0.6 at 1 t, ~0.15 for a 50 t sauropod. */
export function reactionScale(massKg: number): number {
  return Math.max(0.15, Math.min(1.2, 1.6 - Math.log10(Math.max(1, massKg)) / 3));
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
/** Multiple of the LOD distance up to which artist models are drawn. */
const EXTERNAL_LOD = 1.2;
/**
 * Artist models stay up to at least this distance whatever the quality level:
 * on phones (short LOD distance) the procedural stand-in otherwise replaced the
 * film-style T. rex as soon as it was a few dozen metres away.
 */
const EXTERNAL_MIN_DIST = 120;

export function setAnimalContext(lib: TextureLibrary | null, ground: ((x: number, z: number) => number) | null): void {
  library = lib;
  groundFn = ground;
  if (lib) lib.bindUniforms('scutes', scuteTex);
}

function template(sp: SpeciesDef, juvenile = false): DinoTemplate {
  const key = juvenile ? `${sp.id}:juv` : sp.id;
  let t = templates.get(key);
  if (!t) {
    t = buildDinoTemplate(sp, juvenile);
    t.geometry.userData.shared = true;
    t.mid.userData.shared = true;
    t.low.userData.shared = true;
    templates.set(key, t);
  }
  return t;
}

/** Large feature scales (scutes) blended into the scale material per vertex (see scuteAmount). */
const scuteTex = { map: { value: null as THREE.Texture | null }, normal: { value: null as THREE.Texture | null } };

/**
 * Skin shader: the small-scale texture and the scute texture are mixed per
 * vertex by `skinRegion` (back and flanks vs. limbs, face and belly), for
 * colour, relief and roughness alike. Only used when textures are bound.
 */
function patchSkin(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = (s) => {
    s.uniforms.scuteMap = scuteTex.map;
    s.uniforms.scuteNormal = scuteTex.normal;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float skinRegion;\nvarying float vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = skinRegion;');
    const SCUTE_UV = '0.5';
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D scuteMap;\nuniform sampler2D scuteNormal;\nvarying float vRegion;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(scuteMap, vMapUv * ${SCUTE_UV}), vRegion);
  diffuseColor *= sampledDiffuseColor;
#endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  roughnessFactor *= mix(texture2D(roughnessMap, vRoughnessMapUv).g, texture2D(scuteNormal, vRoughnessMapUv * ${SCUTE_UV}).a, vRegion);
#endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        THREE.ShaderChunk.normal_fragment_maps.replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          `vec3 mapN = normalize(mix(texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0, texture2D( scuteNormal, vNormalMapUv * ${SCUTE_UV} ).xyz * 2.0 - 1.0, vRegion));`,
        ),
      );
  };
  m.customProgramCacheKey = () => 'dinoSkin';
}

/** The skin texture: a hair coat on mammals, scales on everything else. */
const skinTexture = (sp: SpeciesDef) => (sp.look.features.includes('fur') ? 'fur' : 'scales');

function speciesMaterials(sp: SpeciesDef): THREE.MeshStandardMaterial[] {
  let m = baseMats.get(sp.id);
  if (m) return m;
  // Fully rough base: the scale texture's roughness map alone decides the sheen (no plastic shine).
  // A faint sheen at grazing angles (dry reptile skin catching the light along the
  // silhouette) instead of the flat, painted look of a purely diffuse surface.
  const scales = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 1, metalness: 0, sheen: 0.35, sheenRoughness: 0.55, sheenColor: new THREE.Color(0.55, 0.5, 0.42) });
  const feathers = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
  const horn = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0 });
  const eye = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0 });
  const membrane = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, side: THREE.DoubleSide, transparent: false });
  if (library) {
    patchSkin(scales);
    library.bind(scales, skinTexture(sp));
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

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _a1 = new THREE.Vector3();
const _a2 = new THREE.Vector3();

/**
 * Turns a bone so the segment that points along `restDir` in the rest pose
 * points along `dir` (both in the animal's model space).
 */
function aimBone(v: AnimalView, b: THREE.Bone, restDir: THREE.Vector3, dir: THREE.Vector3): void {
  // Only the chain above this bone needs fresh matrices (not the whole model).
  b.parent!.updateWorldMatrix(true, false);
  const rootInv = v.root.getWorldQuaternion(_q1).invert();
  const parentQ = b.parent!.getWorldQuaternion(_q2).premultiply(rootInv);
  const target = _q3.setFromUnitVectors(_a1.copy(restDir).normalize(), _a2.copy(dir).normalize());
  b.quaternion.copy(parentQ.invert().multiply(target));
}

/** Deterministic 0..1 hash of two numbers. */
function hash3(a: number, b: number): number {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Forward-positive angle of a (y, z) vector measured from straight down. */
const ang = (v: THREE.Vector3) => Math.atan2(v.z, -v.y);

/** Builds species models ahead of time within a time budget (loading screen). */
export function prewarmAnimals(ids: string[], budgetMs: number, juvenileIds: string[] = []): boolean {
  const t0 = performance.now();
  const jobs: [string, boolean][] = [...ids.map((id): [string, boolean] => [id, false]), ...juvenileIds.map((id): [string, boolean] => [id, true])];
  for (const [id, juv] of jobs) {
    if (templates.has(juv ? `${id}:juv` : id)) continue;
    template(SPECIES[id], juv);
    if (performance.now() - t0 > budgetMs) return false;
  }
  return true;
}

/**
 * @param juvenile build the young body (big head and eyes, short snout,
 * long legs, small horns/plates/crests); the game swaps the model when the
 * animal grows out of the juvenile stage.
 */
export function createAnimalView(speciesId: string, individual = '', juvenile = false, alpha = false): AnimalView {
  const sp = SPECIES[speciesId];
  const tpl = template(sp, juvenile);
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
    if (alpha) c.color.multiply(ALPHA_TINT);
    c.userData.shared = false;
    if (library && i === DMAT.scales) patchSkin(c);
    if (library) library.bind(c, i === DMAT.scales ? skinTexture(sp) : 'feathers');
    return c;
  });
  const mk = (g: THREE.BufferGeometry) => {
    const m = new THREE.SkinnedMesh(g, g.groups.length ? materials : materials[sp.look.features.includes('feathers') ? DMAT.feathers : DMAT.scales]);
    root.add(m);
    m.bind(skeleton, new THREE.Matrix4());
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    // three.js still needs a bounding sphere to depth-sort; a skinned mesh would
    // compute it by skinning every vertex on the CPU (a spike per new animal).
    // The bind-pose sphere of the shared geometry, padded for the animation, is enough.
    if (!g.boundingSphere) g.computeBoundingSphere();
    m.boundingSphere = g.boundingSphere!.clone();
    m.boundingSphere.radius *= 1.3;
    return m;
  };
  const meshHi = mk(tpl.geometry);
  const meshMid = mk(tpl.mid);
  const meshLo = mk(tpl.low);
  meshMid.visible = false;
  meshLo.visible = false;
  const shadow = createContactShadow(Math.max(0.25, sp.lengthM * 0.3), 0.5);
  root.add(shadow);
  root.userData.speciesId = speciesId;

  const legInfo: LegRuntime[] = tpl.legs.map((l) => {
    const j = l.joints;
    const plan = sp.locomotion.plan;
    const biped = plan === 'theropod' || plan === 'hadrosaur' || plan === 'bird';
    // Flippers of marine reptiles never walk.
    const walking = !(biped && l.front) && plan !== 'mosasaur';
    const d0 = j[1].clone().sub(j[0]);
    const d1 = j[2].clone().sub(j[1]);
    const d2 = j[3].clone().sub(j[2]);
    // Knee direction relative to the hip→ankle line.
    const line = j[2].clone().sub(j[0]);
    const kneeForward = ang(d0) > ang(line);
    return { name: l.name, front: l.front, walking, phase: l.phase, l0: d0.length(), l1: d1.length(), r: [ang(d0), ang(d1), ang(d2)], hip: j[0].clone(), toe: j[3].clone(), metaVec: j[2].clone().sub(j[3]), kneeForward };
  });
  const size = (0.94 + hashId(individual || speciesId, 3) * 0.12) * (alpha ? ALPHA.size : 1);
  const aura = alpha ? createAlphaAura(sp) : null;
  if (aura) root.add(aura.points);
  const view: AnimalView = { root, sp, tpl, meshHi, meshMid, meshLo, bones, rest, materials, shadow, size, posture: 0, flap: 0, jaw: 0, look: 0, pelvisDrop: 0, bodyPitch: 0, legInfo, ext: null, rig: null, jawRest: 0, juvenile, alpha, aura, extMats: [], deadT: 99, scan: 0, turn: 0, lastHeading: NaN, hitT: 99, hitLX: 0, hitLZ: 0, hitAmp: 0 };
  // Resolves after the optional models finish loading (null when the species has none).
  void instantiate(speciesId, individual).then((inst) => {
    if (!inst) return;
    if (!root.parent) {
      inst.dispose();
      return;
    }
    if (inst.entry.rig) {
      // Driven by this skeleton instead of the file's clips (adults only: the
      // skeleton is fitted to the artist's joints, juveniles keep their own build).
      inst.dispose();
      if (juvenile) return;
      const boneIdx = new Map(tpl.bones.map((b, i) => [b.name, i] as [string, number]));
      const rg = riggedMesh(speciesId, boneIdx);
      if (!rg) return;
      let mat = rg.material;
      if (alpha) {
        const tint = (m: THREE.Material) => {
          const c = m.clone();
          if ('color' in c && c.color instanceof THREE.Color) c.color.multiply(ALPHA_TINT);
          view.extMats.push(c);
          return c;
        };
        mat = Array.isArray(mat) ? mat.map(tint) : tint(mat);
      }
      const m = new THREE.SkinnedMesh(rg.geometry, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.visible = false;
      root.add(m);
      m.bind(skeleton, new THREE.Matrix4());
      view.rig = m;
      view.jawRest = RIG_FITS[speciesId]?.jawClosed ?? 0;
      return;
    }
    view.ext = inst;
    if (alpha) {
      // Darker, reddish hide: per-instance material clones (the shared ones stay untouched).
      for (const m of inst.meshes) {
        const tinted = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => {
          const c = mat.clone();
          if ('color' in c && c.color instanceof THREE.Color) c.color.multiply(ALPHA_TINT);
          view.extMats.push(c);
          return c;
        });
        m.material = Array.isArray(m.material) ? tinted : tinted[0];
      }
    }
    root.add(inst.root);
  });
  return view;
}

export function disposeAnimalView(v: AnimalView): void {
  v.root.removeFromParent();
  v.ext?.dispose();
  for (const m of v.extMats) m.dispose();
  if (v.aura) disposeAlphaAura(v.aura);
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
/** Attack in progress (from the AI): which move, which phase and how far into it. */
export interface AttackPose {
  kind: MoveKind;
  phase: 'windup' | 'strike' | 'recover';
  u: number;
}

export function poseAnimalView(v: AnimalView, a: AnimalData, stride: number, altitude: number, now: number, dt: number, camDist: number, lodDistance = 70, atk: AttackPose | null = null): void {
  const sp = v.sp;
  const g = growthScale(a, now) * v.size * (a.genes?.size ?? 1);
  v.root.position.set(a.x, a.y, a.z);
  v.root.rotation.set(0, a.heading, 0);
  v.root.scale.setScalar(g);
  // Three detail levels: full up close, mid-distance, single-material far version.
  const level = camDist > lodDistance ? 2 : camDist > lodDistance * 0.45 ? 1 : 0;
  v.meshHi.visible = level === 0;
  v.meshMid.visible = level === 1;
  v.meshLo.visible = level === 2;
  const shadows = camDist < 90;
  v.meshHi.castShadow = shadows;
  v.meshMid.castShadow = shadows;
  v.meshLo.castShadow = shadows;
  if (v.rig) {
    // Re-bound artist skin: same skeleton and procedural animation, so only the
    // visible mesh changes with distance.
    const near = camDist < Math.max(lodDistance * EXTERNAL_LOD, EXTERNAL_MIN_DIST);
    v.rig.visible = near;
    if (near) {
      v.meshHi.visible = v.meshMid.visible = v.meshLo.visible = false;
      v.rig.castShadow = camDist < lodDistance * 0.65;
    }
  }
  if (v.ext) {
    // Far away the artist model gives way to the cheap procedural one (no mixer update).
    const near = camDist < Math.max(lodDistance * EXTERNAL_LOD, EXTERNAL_MIN_DIST);
    v.ext.root.visible = near;
    if (near) {
      v.meshHi.visible = v.meshMid.visible = v.meshLo.visible = false;
      setExternalShadows(v.ext, camDist < lodDistance * 0.65);
      // Files without a death clip just roll onto their side.
      v.ext.root.rotation.z = a.alive || v.ext.actions.has('death') ? 0 : Math.PI / 2;
      // The attack clip plays only while a blow is under way; between blows the
      // animal stands or runs like any other.
      const st = !a.alive ? 'dead' : atk ? 'defend' : a.state === 'hunt' || a.state === 'defend' ? 'idle' : a.state;
      driveExternal(v.ext, dt, st, a.speed / Math.max(0.2, g), sp.walkSpeed, sp.runSpeed, altitude > 1);
      return;
    }
  }

  const B = v.bones;
  for (const [name, b] of B) {
    b.position.copy(v.rest.get(name)!);
    b.rotation.set(0, 0, 0);
  }
  const bone = (n: string) => B.get(n);
  const pelvis = bone('pelvis')!;

  if (!a.alive) {
    // Death: the body sags, the legs buckle and it rolls onto its side over a
    // second or two (giants fall slower), the neck and tail go limp.
    v.deadT += dt;
    const dur = sp.massKg > 3000 ? 2.2 : sp.massKg > 300 ? 1.5 : 0.9;
    const u = Math.min(1, v.deadT / dur);
    const fall = u * u * (3 - 2 * u);
    const buckle = Math.min(1, v.deadT / (dur * 0.5));
    pelvis.rotation.z = (Math.PI / 2) * 0.92 * fall;
    pelvis.position.y -= v.tpl.hipHeight * (0.65 * fall + 0.15 * buckle * (1 - fall));
    for (const l of v.legInfo) {
      const t0 = bone(`${l.name}0`);
      const t1 = bone(`${l.name}1`);
      if (t0) t0.rotation.x = 0.3 * fall + (1 - fall) * buckle * (l.front ? -0.4 : 0.5);
      if (t1) t1.rotation.x = -0.6 * buckle * (1 - fall) - 0.2 * fall;
    }
    ['neck1', 'neck2', 'neck3'].forEach((n, i) => {
      const b = bone(n);
      if (b) b.rotation.x = (0.4 + i * 0.1) * fall;
    });
    const jw = bone('jaw');
    if (jw) jw.rotation.x = 0.25 * fall + (v.rig?.visible ? v.jawRest : 0);
    ['tail1', 'tail2', 'tail3', 'tail4'].forEach((n) => {
      const b = bone(n);
      if (b) b.rotation.x = 0.08 * fall;
    });
    v.shadow.visible = false;
    return;
  }
  v.deadT = 0;
  v.shadow.visible = altitude < 2 && !sp.locomotion.aquatic;

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
  if (sp.locomotion.plan === 'serpent') {
    // Lateral undulation: a wave runs from the head to the tail as fast as the snake
    // advances (each point of the body follows the path of the one ahead); at rest the
    // body keeps a gentle S and only breathes. The head stays pointed forward.
    const chain = ['neck3', 'neck2', 'neck1', 'chest', 'torso', 'pelvis', 'tail1', 'tail2', 'tail3', 'tail4'];
    const amp = moving ? 0.32 + runF * 0.12 : 0.12;
    const ph = moving ? cycle * Math.PI * 2 : 0.6 + Math.sin(now * 0.4 + a.x) * 0.15;
    let acc = 0;
    chain.forEach((n, i) => {
      const b = bone(n);
      if (!b) return;
      // Bones down the tail are children of the pelvis in the other direction: flip their sign.
      const sign = i <= 5 ? -1 : 1;
      const yaw = Math.sin(ph + i * 0.9) * amp * (i === 0 ? 0.5 : 1);
      b.rotation.y = sign * yaw;
      b.rotation.x = 0;
      if (i <= 2) acc += yaw;
    });
    if (head) head.rotation.y = acc * 0.6;
  }
  const jawTarget = grazing ? 0.12 + Math.max(0, Math.sin(now * 6 + a.x)) * 0.18 : a.state === 'defend' || a.state === 'hunt' ? 0.5 : runF > 0.6 ? 0.18 : 0.02;
  v.jaw += (jawTarget - v.jaw) * k(8);
  const jaw = bone('jaw');
  if (jaw) jaw.rotation.x = v.jaw + (v.rig?.visible ? v.jawRest : 0);
  const chest = bone('chest');
  if (chest) chest.scale.setScalar(1 + Math.sin(now * 1.8 + a.x) * 0.012);

  // ---- Behaviour layers -------------------------------------------------------
  // Turning: inertia. The neck leads into the turn, the body rolls into it and
  // the tail swings out; giants turn with visible weight, small animals snap.
  if (Number.isNaN(v.lastHeading)) v.lastHeading = a.heading;
  let dh = a.heading - v.lastHeading;
  dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  v.lastHeading = a.heading;
  const rate = dt > 0 ? dh / dt : 0;
  const heavy = clamp(Math.log10(Math.max(10, sp.massKg)) / 4.5, 0.2, 1);
  v.turn += (clamp(rate, -2, 2) - v.turn) * k(heavy > 0.8 ? 2.5 : 8);
  const lean = v.turn * (0.05 + runF * 0.1) * heavy;
  pelvis.rotation.z += -lean;
  neckBones.forEach((b) => (b.rotation.y += v.turn * 0.12));
  tailNames.forEach((n, i) => {
    const b = bone(n);
    if (b) b.rotation.y += -v.turn * 0.06 * (1 + i * 0.5) * heavy;
  });
  const still = !moving && !airborne;
  const st = a.state;
  // Observing (idle, alert): slow head scans; small animals glance more often and faster.
  if (still && (st === 'idle' || st === 'alert' || st === 'wander' || st === 'follow')) {
    const fast = sp.massKg < 100 ? 2.4 : 1;
    const seg = Math.floor((now * 0.35 * fast + a.x) % 1000);
    const target = (hash3(seg, a.z) - 0.5) * (st === 'alert' ? 1.1 : 0.7);
    v.scan += (target - v.scan) * k(st === 'alert' ? 6 * fast : 1.5 * fast);
    neckBones.forEach((b) => (b.rotation.y += v.scan / neckBones.length));
    if (head) head.rotation.y += v.scan * 0.3;
  }
  // Sniffing while investigating: short quick dips of the snout.
  if (st === 'investigate') {
    const sniff = Math.max(0, Math.sin(now * 9 + a.x)) * 0.06;
    if (head) head.rotation.x += sniff + 0.15;
    neckBones.forEach((b) => (b.rotation.x += 0.08));
  }
  // Drinking: head right down, lapping jaw.
  if (st === 'drink' && still) {
    neckBones.forEach((b) => (b.rotation.x += 0.12));
    if (jaw) jaw.rotation.x = 0.06 + Math.max(0, Math.sin(now * 7 + a.z)) * 0.08;
  }
  // Threat display / combat by body type.
  if ((st === 'defend' || st === 'hunt') && !atk) {
    const f = new Set(sp.look.features);
    const pulse = Math.sin(now * 2.2 + a.x);
    if (f.has('horns3') || f.has('frill') || f.has('nasalBoss') || f.has('dome')) {
      // Ceratopsians, pachycephalosaurs: head lowered, horns / dome forward, shaking.
      neckBones.forEach((b) => (b.rotation.x += 0.12));
      if (head) head.rotation.x += 0.2 + pulse * 0.05;
      neckBones.forEach((b) => (b.rotation.y += Math.sin(now * 5) * 0.03));
    } else if (f.has('plates') || f.has('club')) {
      // Thyreophorans: swing the weaponised tail toward the threat.
      tailNames.forEach((n, i) => {
        const b = bone(n);
        if (b) b.rotation.y += Math.sin(now * 2.6) * 0.18 * (1 + i * 0.3);
      });
      pelvis.rotation.y += Math.sin(now * 2.6) * 0.06;
    } else if (sp.diet === 'carnivore' || sp.diet === 'piscivore') {
      // Predators: head low and forward, jaws gape; snapping when hunting at speed.
      neckBones.forEach((b) => (b.rotation.x += 0.05));
      if (jaw) jaw.rotation.x = st === 'hunt' && runF > 0.5 ? 0.25 + Math.max(0, Math.sin(now * 8)) * 0.4 : 0.55 + pulse * 0.1;
      tailNames.forEach((n) => {
        const b = bone(n);
        if (b) b.rotation.x -= 0.04; // tail raised
      });
    } else {
      // Other herbivores: tall alarm posture, head up.
      neckBones.forEach((b) => (b.rotation.x -= 0.1));
    }
  }
  // ---- Attack moves (wind-up → strike → recover) -----------------------------
  if (atk) {
    const ease = (x: number) => x * x * (3 - 2 * x);
    // wind: drawn back (1 at the end of the wind-up); hit: thrown into the blow.
    const wind = atk.phase === 'windup' ? ease(atk.u) : atk.phase === 'strike' ? 1 - ease(atk.u) : 0;
    const hit = atk.phase === 'strike' ? ease(atk.u) : atk.phase === 'recover' ? 1 - ease(atk.u) : 0;
    const side = a.id.charCodeAt(a.id.length - 1) % 2 ? 1 : -1;
    const arms = v.legInfo.filter((l) => l.front && !l.walking);
    const fronts = v.legInfo.filter((l) => l.front && l.walking);
    const jawOpen = (o: number) => {
      if (jaw) jaw.rotation.x = Math.max(jaw.rotation.x, o + (v.rig?.visible ? v.jawRest : 0));
    };
    switch (atk.kind) {
      case 'bite':
      case 'shake':
      case 'peck':
      case 'roll':
      case 'constrict':
      case 'spit': {
        // Head drawn back and up with the jaws gaping, then driven forward and
        // down as they snap shut.
        // Totals spread over however many neck bones the species has.
        const back = (atk.kind === 'spit' ? 0.6 : 0.42) / Math.max(1, neckBones.length);
        const fwd = 0.5 / Math.max(1, neckBones.length);
        neckBones.forEach((b) => (b.rotation.x += -back * wind + fwd * hit));
        if (head) head.rotation.x += -0.12 * wind + 0.1 * hit;
        pelvis.position.z += (-0.05 * wind + 0.07 * hit) * H;
        if (atk.kind !== 'peck') jawOpen(0.85 * wind + (atk.phase === 'strike' ? 0.85 * (1 - atk.u) : 0.05));
        if (atk.kind === 'spit' && atk.phase !== 'windup') jawOpen(0.7 * hit);
        if (atk.kind === 'shake' && atk.phase === 'recover') {
          // Thrashing the head side to side with the prey in the jaws.
          const f = Math.sin(atk.u * Math.PI * 6) * (1 - atk.u);
          neckBones.forEach((b) => (b.rotation.y += f * 0.28));
          if (chest) chest.rotation.y += f * 0.08;
        }
        if (atk.kind === 'roll' && atk.phase === 'recover') pelvis.rotation.z += Math.sin(atk.u * Math.PI) * 1.4 * side;
        if (atk.kind === 'constrict') {
          // Coils draw tight around the prey.
          tailNames.forEach((n, i) => {
            const b = bone(n);
            if (b) b.rotation.y += side * (0.25 + i * 0.12) * Math.max(wind, hit);
          });
        }
        break;
      }
      case 'claw':
      case 'thumb':
      case 'pounce': {
        // Forelimbs raised and spread in the wind-up, raked down through the strike.
        arms.forEach((l, i) => {
          const b0 = bone(`${l.name}0`);
          const b1 = bone(`${l.name}1`);
          const lead = atk.kind === 'thumb' ? (i === 0 ? 1 : 0.3) : 1;
          if (b0) b0.rotation.x += (-1.1 * wind + 0.7 * hit) * lead;
          if (b1) b1.rotation.x += (0.5 * wind - 0.4 * hit) * lead;
        });
        // Quadrupeds (megatherium) rear onto the hind legs to swipe.
        if (!arms.length) {
          pelvis.rotation.x += -0.3 * Math.max(wind, hit);
          fronts.forEach((l) => {
            const b0 = bone(`${l.name}0`);
            if (b0) b0.rotation.x += -1 * wind + 0.6 * hit;
          });
        }
        if (atk.kind === 'pounce') {
          // Crouch, then spring: the body is thrown forward nose-up, legs trailing.
          pelvis.position.y -= 0.14 * H * wind;
          pelvis.rotation.x += 0.12 * wind - 0.25 * hit;
          for (const l of v.legInfo) {
            if (l.front) continue;
            const b0 = bone(`${l.name}0`);
            const b1 = bone(`${l.name}1`);
            if (b0) b0.rotation.x += 0.6 * hit;
            if (b1) b1.rotation.x += -0.5 * hit;
          }
          jawOpen(0.6 * Math.max(wind, hit));
        }
        neckBones.forEach((b) => (b.rotation.x += 0.1 * hit));
        break;
      }
      case 'tail':
      case 'club':
      case 'spikes': {
        // The tail is cocked to one side, then swept hard across to the other;
        // the hips counter-rotate to put the body behind it.
        const amp = atk.kind === 'tail' ? 0.35 : 0.5;
        const sweep = side * (amp * wind - amp * 1.3 * hit);
        tailNames.forEach((n, i) => {
          const b = bone(n);
          if (b) b.rotation.y += sweep * (0.45 + i * 0.15);
        });
        pelvis.rotation.y += -sweep * 0.25;
        neckBones.forEach((b) => (b.rotation.y += sweep * 0.2));
        break;
      }
      case 'horns':
      case 'headbutt': {
        // Head lowered and braced, then a hooking thrust up and forward.
        neckBones.forEach((b) => (b.rotation.x += 0.22 * wind - 0.3 * hit));
        if (head) head.rotation.x += 0.25 * wind - 0.35 * hit;
        pelvis.position.z += (-0.06 * wind + 0.08 * hit) * H;
        pelvis.position.y -= 0.05 * H * wind;
        break;
      }
      case 'roar': {
        // Alpha roar: head thrown up and forward, jaws wide, the body braced and
        // shaking with the effort through the whole call.
        const call = atk.phase === 'strike' ? 1 : wind;
        const shake = atk.phase === 'strike' ? Math.sin(atk.u * Math.PI * 14) * 0.03 : 0;
        neckBones.forEach((b) => (b.rotation.x += -0.4 / Math.max(1, neckBones.length) * call + shake));
        if (head) head.rotation.x += -0.15 * call;
        jawOpen(1.0 * call);
        pelvis.position.y -= 0.03 * H * call;
        tailNames.forEach((n) => {
          const b = bone(n);
          if (b) b.rotation.x -= 0.05 * call;
        });
        if (chest) chest.scale.setScalar(1 + 0.04 * call);
        break;
      }
      case 'stomp': {
        // Rear up on the hind legs, forefeet lifted, then slam them down.
        const rear = atk.phase === 'windup' ? wind : atk.phase === 'strike' ? 1 - ease(atk.u) : 0;
        pelvis.rotation.x += -0.38 * rear + 0.06 * hit;
        fronts.forEach((l) => {
          const b0 = bone(`${l.name}0`);
          const b1 = bone(`${l.name}1`);
          if (b0) b0.rotation.x += -0.9 * rear;
          if (b1) b1.rotation.x += 0.9 * rear;
        });
        arms.forEach((l) => {
          const b0 = bone(`${l.name}0`);
          if (b0) b0.rotation.x += -0.8 * rear;
        });
        neckBones.forEach((b) => (b.rotation.x += -0.15 * rear + 0.12 * hit));
        break;
      }
    }
  }
  // Tending a nest: crouched, head low over the eggs, slow movements.
  if (st === 'nest' && still) {
    neckBones.forEach((b) => (b.rotation.x += 0.18 + Math.sin(now * 0.8) * 0.03));
  }
  // Swimming: body low in the water, legs paddle slowly, the tail sculls.
  const swimming = sp.locomotion.swims && a.y < -sp.hipHeightM * 0.3;
  if (swimming) {
    const sw = now * (moving ? 3 : 1.2);
    tailNames.forEach((n, i) => {
      const b = bone(n);
      if (b) b.rotation.y += Math.sin(sw - i * 0.9) * (0.12 + i * 0.05);
    });
    for (const l of v.legInfo) {
      const b0 = bone(`${l.name}0`);
      if (b0) b0.rotation.x += Math.sin(sw + l.phase * Math.PI * 2) * 0.35;
    }
    if (!sp.locomotion.aquatic) neckBones.forEach((b) => (b.rotation.x -= 0.06)); // head held up out of the water
    else {
      // Marine reptile: the body undulates along its length, driven from the tail;
      // the paddles steer and stabilise.
      pelvis.rotation.y += Math.sin(sw + 0.6) * 0.04;
      neckBones.forEach((b, i) => (b.rotation.y += Math.sin(sw + 1.2 + i * 0.3) * 0.03));
    }
  }

  // ---- Flight ------------------------------------------------------------------
  if (airborne || sp.locomotion.flies) {
    // Take-off and landing (low altitude): fast, deep wingbeats with the legs reaching down.
    const nearGround = airborne && altitude < 6;
    v.flap += dt * (airborne ? (a.state === 'flee' || nearGround ? 9 : 4.5) : 0);
    if (nearGround)
      for (const l of v.legInfo) {
        if (l.front) continue;
        const b0 = bone(`${l.name}0`);
        const b1 = bone(`${l.name}1`);
        const reach = 1 - altitude / 6;
        if (b0) b0.rotation.x = -0.2 * reach;
        if (b1) b1.rotation.x = 0.2 * reach;
      }
    for (const l of v.legInfo) {
      if (!(l.name.startsWith('wing') || (l.front && (sp.locomotion.plan === 'bird' || sp.look.features.includes('wings'))))) continue;
      const side = l.name.endsWith('L') ? 1 : -1;
      const b0 = bone(`${l.name}0`);
      const b1 = bone(`${l.name}1`);
      const b2 = bone(`${l.name}2`);
      if (!b0 || !b1) continue;
      if (airborne && sp.locomotion.plan === 'pterosaur') {
        // Extended wing: humerus, forearm and metacarpal reach out to the side, the
        // wing finger sweeps back; the whole wing beats about the shoulder.
        const f = Math.sin(v.flap);
        const beat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), side * f * 0.5);
        const dirs = [V3(side, 0.12, 0.12), V3(side, 0.05, 0.28), V3(side, 0.02, 0.06), V3(side, -0.03, -0.3)].map((d) => d.normalize().applyQuaternion(beat));
        const info = v.tpl.legs.find((x) => x.name === l.name)!;
        const j = info.joints;
        const rest = [j[1].clone().sub(j[0]), j[2].clone().sub(j[1]), j[3].clone().sub(j[2]), info.fingerTip!.clone().sub(j[3])];
        const chain = [b0, b1, b2, bone(`${l.name}3`), bone(`${l.name}F`)];
        // Metacarpal (bone 2) is aimed by bone index 2; bone 3 (hand) keeps its rest
        // orientation relative to it; the finger is aimed last.
        aimBone(v, chain[0]!, rest[0], dirs[0]);
        aimBone(v, chain[1]!, rest[1], dirs[1]);
        if (chain[2]) aimBone(v, chain[2], rest[2], dirs[2]);
        if (chain[4]) aimBone(v, chain[4], rest[3], dirs[3]);
      } else if (sp.locomotion.plan === 'pterosaur') {
        // On the ground the wing finger stays folded back along the flank, whatever
        // the walking forelimb is doing.
        const info = v.tpl.legs.find((x) => x.name === l.name)!;
        const fb = bone(`${l.name}F`);
        if (fb && info.fingerTip) {
          const restDir = info.fingerTip.clone().sub(info.joints[3]);
          aimBone(v, fb, restDir, V3(side * 0.1, 0.55, -0.9));
        }
      } else if (airborne) {
        const f = Math.sin(v.flap);
        b0.rotation.set(0, 0, side * (1.35 + f * 0.55));
        b1.rotation.set(0, 0, side * 0.25);
        if (b2) b2.rotation.set(0, 0, side * 0.2);
      }
    }
  }
  // ---- Hit reaction (layered on top of everything) -----------------------------
  if (v.hitT < 0.9) {
    v.hitT += dt;
    const t = v.hitT;
    // Sharp onset (80 ms), then a damped recovery.
    const f = Math.sin(Math.min(1, t / 0.08) * Math.PI * 0.5) * Math.exp(-t * 5.5) * v.hitAmp;
    pelvis.position.x += v.hitLX * f * H * 0.07;
    pelvis.position.z += v.hitLZ * f * H * 0.07;
    pelvis.rotation.z += -v.hitLX * f * 0.12;
    pelvis.rotation.x += -v.hitLZ * f * 0.06;
    if (chest) chest.rotation.y += v.hitLX * f * 0.15;
    // The head jerks up and turns toward where the blow came from.
    neckBones.forEach((b) => {
      b.rotation.x -= f * 0.18;
      b.rotation.y += -v.hitLX * f * 0.25;
    });
    if (head) head.rotation.x -= f * 0.15;
    if (jaw) jaw.rotation.x += f * 0.35;
    tailNames.forEach((n, i) => {
      const b = bone(n);
      if (b) b.rotation.y += Math.sin(t * 22 - i) * f * 0.12 * (1 + i * 0.4);
    });
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
