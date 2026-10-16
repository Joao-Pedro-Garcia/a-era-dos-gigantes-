import * as THREE from 'three';
import type { TextureLibrary } from '../graphics/textureLibrary';

/**
 * Hand-held item models, shared by the third-person body and the
 * first-person arms (one builder, so the two views always show the same
 * object).
 *
 * Item space: the grip point is the origin, +Y runs along the handle toward
 * the working end (axe head, spear tip, top limb of the bow) and +Z is the
 * direction the edge or striking face points. `attachToHand` maps that onto
 * the hand bone so +Y leaves the fist on the thumb side and +Z points the
 * way the knuckles face.
 *
 * Sizes are real-world: a 0.6 m hafted axe, a 1.9 m spear, a 1.3 m bow.
 */
export interface ItemModel {
  root: THREE.Group;
  id: string;
  /** Bow only: moves the string's nock point (0 = braced, 1 = full draw). */
  setDraw?: (draw: number) => void;
  /** Bow only: nock point in item space (where the arrow rests). */
  nock?: THREE.Vector3;
  /** Point that touches the target (item space); used for impact effects. */
  tip: THREE.Vector3;
  /** Torch flame (animated by the owner). */
  flame?: THREE.Object3D;
  /** Arrow shown on the string while drawing (bow). */
  arrow?: THREE.Object3D;
}

interface Mats {
  wood: THREE.MeshStandardMaterial;
  darkWood: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  flint: THREE.MeshStandardMaterial;
  obsidian: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  binding: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  string: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  plastic: THREE.MeshStandardMaterial;
  screen: THREE.MeshStandardMaterial;
  flare: THREE.MeshStandardMaterial;
  flame: THREE.MeshBasicMaterial;
  flameCore: THREE.MeshBasicMaterial;
  feather: THREE.MeshStandardMaterial;
  char: THREE.MeshStandardMaterial;
}

let mats: Mats | null = null;

function materials(lib: TextureLibrary | null): Mats {
  if (mats) return mats;
  const S = (color: number, roughness: number, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  mats = {
    wood: S(0xb08a62, 0.8),
    darkWood: S(0x5a4330, 0.85),
    stone: S(0x8a857c, 0.85),
    flint: S(0x6f665c, 0.45),
    obsidian: S(0x111114, 0.12, 0.1),
    metal: S(0x9a9a98, 0.38, 0.9),
    binding: S(0x8a7350, 0.95),
    leather: S(0x5c3c24, 0.7),
    string: S(0xd8ccb0, 0.8),
    brass: S(0xb08a3c, 0.35, 0.85),
    plastic: S(0x2a2c2e, 0.55),
    screen: S(0x103018, 0.3, 0, { emissive: 0x30ff70, emissiveIntensity: 0.5 }),
    flare: S(0xc02018, 0.6),
    flame: new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    flameCore: new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }),
    feather: S(0xe8e0d0, 0.9, 0, { side: THREE.DoubleSide }),
    char: S(0x2a2018, 1),
  };
  if (lib) {
    lib.bind(mats.wood, 'bark', { map: true, normal: true, rough: false });
    lib.bind(mats.darkWood, 'bark', { map: true, normal: true, rough: false });
    lib.bind(mats.stone, 'concrete', { map: true, normal: true, rough: true });
    lib.bind(mats.flint, 'concrete', { map: false, normal: true, rough: false });
    lib.bind(mats.leather, 'leather');
    lib.bind(mats.binding, 'cloth', { map: false, normal: true, rough: false });
  }
  for (const m of Object.values(mats)) m.userData.shared = true;
  return mats;
}

// ------------------------------------------------------------------ geometry helpers

/** Deterministic pseudo-random in [0, 1). */
function rnd(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Slightly irregular tapered handle from y0 to y1 (radius r0 at y0, r1 at y1). */
function handle(y0: number, y1: number, r0: number, r1: number, mat: THREE.Material, seed = 1): THREE.Mesh {
  const len = y1 - y0;
  const g = new THREE.CylinderGeometry(r1, r0, len, 10, Math.max(4, Math.round(len * 12)), false);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // A gentle natural bend and knots: the shaft is a cut branch, not a lathe part.
    const t = y / len + 0.5;
    p.setX(i, p.getX(i) * (1 + (rnd(seed + Math.round(t * 9)) - 0.5) * 0.12) + Math.sin(t * Math.PI) * len * 0.008);
    p.setZ(i, p.getZ(i) * (1 + (rnd(seed * 3 + Math.round(t * 7)) - 0.5) * 0.12));
  }
  g.computeVertexNormals();
  g.translate(0, y0 + len / 2, 0);
  return mesh(g, mat);
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const o = new THREE.Mesh(g, m);
  o.castShadow = true;
  return o;
}

/** Knapped stone: a low-poly blob flattened into a wedge with faceted, chipped faces. */
function knapped(sx: number, sy: number, sz: number, seed: number, mat: THREE.Material, edge = 1): THREE.Mesh {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = 0.82 + rnd(seed + Math.round((x + 2) * 3) * 7 + Math.round((y + 2) * 3) * 13 + Math.round((z + 2) * 3) * 29) * 0.3;
    // Thin toward the edge (+Z): a wedge.
    x *= 1 - Math.max(0, z) * 0.85 * edge;
    p.setXYZ(i, x * sx * n, y * sy * n, z * sz * n);
  }
  const ng = g.toNonIndexed();
  ng.computeVertexNormals(); // flat facets
  g.dispose();
  return mesh(ng, mat);
}

/** Flat extruded profile in the item's Y–Z plane (blades, axe heads), `thick` along X. */
function profile(points: [number, number][], thick: number, bevel: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
  // Shape x → item +Z, shape y → item +Y, extrusion → item X (centred).
  g.rotateY(-Math.PI / 2);
  g.translate(thick / 2, 0, 0);
  g.computeVertexNormals();
  return mesh(g, mat);
}

/** Lashing: a few turns of cord around the handle at height y. */
function lashing(y: number, r: number, turns: number, mat: THREE.Material, cross = false): THREE.Group {
  const grp = new THREE.Group();
  for (let i = 0; i < turns; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.0045, 5, 14), mat);
    t.rotation.x = Math.PI / 2;
    t.rotation.y = (i - turns / 2) * 0.12;
    t.position.y = y + (i - (turns - 1) / 2) * 0.01;
    grp.add(t);
  }
  if (cross)
    for (const s of [1, -1]) {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r + 0.03, 0.004, 4, 14), mat);
      t.rotation.set(0, Math.PI / 2, s * 0.6);
      t.position.y = y + 0.01;
      grp.add(t);
    }
  return grp;
}

// ------------------------------------------------------------------ items

function axe(m: Mats, metal: boolean): ItemModel {
  const root = new THREE.Group();
  root.add(handle(-0.12, 0.5, 0.017, 0.02, m.wood, metal ? 5 : 2));
  if (metal) {
    // Forged bearded axe head, socketed on the haft.
    const head = profile([[-0.035, -0.025], [0.03, -0.022], [0.075, -0.06], [0.11, -0.055], [0.118, 0.0], [0.11, 0.05], [0.07, 0.045], [0.03, 0.022], [-0.035, 0.025]], 0.012, 0.003, m.metal);
    head.position.y = 0.45;
    const eye = mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.06, 10), m.metal);
    eye.position.y = 0.45;
    root.add(head, eye);
  } else {
    // Flint head wedged through a split in the haft, lashed above and below.
    const head = knapped(0.03, 0.05, 0.085, 11, m.flint);
    head.position.set(0, 0.44, 0.045);
    root.add(head, lashing(0.4, 0.019, 4, m.binding, true), lashing(0.485, 0.019, 3, m.binding));
  }
  return { root, id: '', tip: new THREE.Vector3(0, 0.44, 0.12) };
}

function pickaxe(m: Mats, metal: boolean): ItemModel {
  const root = new THREE.Group();
  root.add(handle(-0.12, 0.55, 0.018, 0.021, m.wood, metal ? 7 : 3));
  const mat = metal ? m.metal : m.stone;
  // Pick toward +Z (curved down), adze/hammer face toward −Z.
  const pick = mesh(new THREE.ConeGeometry(0.021, metal ? 0.24 : 0.2, 7), mat);
  pick.rotation.x = Math.PI / 2 + 0.25;
  pick.position.set(0, 0.52, metal ? 0.13 : 0.11);
  const back = metal ? mesh(new THREE.BoxGeometry(0.03, 0.035, 0.1), mat) : knapped(0.028, 0.032, 0.06, 23, m.stone, 0.2);
  back.position.set(0, 0.53, -0.05);
  const socket = mesh(new THREE.BoxGeometry(0.045, 0.06, 0.06), mat);
  socket.position.y = 0.53;
  root.add(pick, back, socket);
  if (!metal) root.add(lashing(0.49, 0.021, 4, m.binding, true));
  return { root, id: '', tip: new THREE.Vector3(0, 0.47, 0.24) };
}

function knife(m: Mats, metal: boolean): ItemModel {
  const root = new THREE.Group();
  root.add(handle(-0.05, 0.06, 0.013, 0.014, metal ? m.leather : m.wood, 4));
  if (metal) {
    const blade = profile([[-0.012, 0], [0.014, 0], [0.012, 0.09], [0.0, 0.165], [-0.012, 0.12]], 0.003, 0.0012, m.metal);
    blade.position.y = 0.06;
    const guard = mesh(new THREE.BoxGeometry(0.012, 0.01, 0.04), m.metal);
    guard.position.y = 0.062;
    root.add(blade, guard);
  } else {
    const blade = knapped(0.008, 0.075, 0.018, 41, m.flint, 0.6);
    blade.position.set(0, 0.125, 0.004);
    root.add(blade, lashing(0.06, 0.014, 3, m.binding));
  }
  return { root, id: '', tip: new THREE.Vector3(0, 0.2, 0) };
}

function spear(m: Mats, tip: 'flint' | 'obsidian' | 'metal'): ItemModel {
  const root = new THREE.Group();
  // Grip at about 40 % of the shaft.
  root.add(handle(-0.75, 1.05, 0.016, 0.014, m.wood, 9));
  const mat = tip === 'metal' ? m.metal : tip === 'obsidian' ? m.obsidian : m.flint;
  const head =
    tip === 'metal'
      ? profile([[0, 0], [0.024, 0.04], [0.016, 0.12], [0, 0.2], [-0.016, 0.12], [-0.024, 0.04]], 0.005, 0.003, mat)
      : (() => {
          const k = knapped(0.009, 0.085, 0.027, tip === 'obsidian' ? 53 : 61, mat, 0);
          k.position.y = 0.085;
          const grp = new THREE.Group();
          grp.add(k);
          return grp;
        })();
  head.position.y = 1.04;
  root.add(head, lashing(1.03, 0.015, 4, tip === 'metal' ? m.leather : m.binding));
  return { root, id: '', tip: new THREE.Vector3(0, 1.22, 0) };
}

function club(m: Mats): ItemModel {
  const root = new THREE.Group();
  const g = new THREE.CylinderGeometry(0.052, 0.018, 0.68, 10, 10);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const n = 1 + (rnd(i * 0.37 + 5) - 0.5) * 0.18 * Math.max(0, p.getY(i) / 0.34);
    p.setX(i, p.getX(i) * n);
    p.setZ(i, p.getZ(i) * n);
  }
  g.computeVertexNormals();
  g.translate(0, 0.22, 0);
  root.add(mesh(g, m.darkWood), lashing(-0.04, 0.019, 5, m.leather));
  // Knots near the head.
  for (let i = 0; i < 4; i++) {
    const k = mesh(new THREE.SphereGeometry(0.014, 6, 4), m.darkWood);
    const a = i * 1.7;
    k.position.set(Math.cos(a) * 0.045, 0.38 + i * 0.04, Math.sin(a) * 0.045);
    root.add(k);
  }
  return { root, id: '', tip: new THREE.Vector3(0, 0.52, 0.04) };
}

function torch(m: Mats): ItemModel {
  const root = new THREE.Group();
  root.add(handle(-0.18, 0.36, 0.016, 0.02, m.wood, 13));
  const wrap = mesh(new THREE.CylinderGeometry(0.038, 0.03, 0.12, 9), m.char);
  wrap.position.y = 0.38;
  const flame = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 8, 1, true), m.flame);
  outer.position.y = 0.1;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.12, 8, 1, true), m.flameCore);
  inner.position.y = 0.06;
  flame.add(outer, inner);
  flame.position.y = 0.44;
  flame.userData.noAO = true;
  root.add(wrap, flame);
  return { root, id: '', tip: new THREE.Vector3(0, 0.44, 0), flame };
}

function bow(m: Mats): ItemModel {
  const root = new THREE.Group();
  // Self bow: the limbs bend away from the archer (+Z at the grip), tips braced toward the string.
  const limbs: THREE.Group[] = [];
  const BRACE = -0.09;
  for (const s of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.y = s * 0.07;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      pts.push(new THREE.Vector3(0, s * t * 0.58, 0.04 * (1 - t * t) - 0.11 * t * t + 0.02));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 16, 0.011, 6);
    // Taper the limb toward the tip.
    const pa = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const y = pa.getY(i);
      const t = Math.min(1, Math.abs(y) / 0.58);
      const c = curve.getPointAt(t);
      const k = 1 - t * 0.55;
      pa.setX(i, pa.getX(i) * k);
      pa.setZ(i, c.z + (pa.getZ(i) - c.z) * k * 1.3);
    }
    g.computeVertexNormals();
    pivot.add(mesh(g, m.wood));
    limbs.push(pivot);
    root.add(pivot);
  }
  const grip = mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.16, 8), m.leather);
  grip.position.z = 0.02;
  root.add(grip);
  // String: two straight segments meeting at the nock.
  const segs = [0, 1].map(() => {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 1, 4), m.string);
    root.add(c);
    return c;
  });
  const nock = new THREE.Vector3(0, 0, BRACE);
  // Arrow on the string while drawing.
  const arrow = arrowModel(m);
  arrow.rotation.x = Math.PI / 2; // along +Z (toward the target)
  arrow.visible = false;
  root.add(arrow);
  const tipTop = new THREE.Vector3();
  const tipBot = new THREE.Vector3();
  const setDraw = (draw: number) => {
    const flex = draw * 0.16;
    limbs[0].rotation.x = -flex;
    limbs[1].rotation.x = flex;
    // Tip positions follow the rotated limb end.
    const end = new THREE.Vector3(0, 0.58, -0.09);
    tipTop.copy(end).applyAxisAngle(new THREE.Vector3(1, 0, 0), -flex).add(new THREE.Vector3(0, 0.07, 0));
    tipBot.set(0, -0.58, -0.09).applyAxisAngle(new THREE.Vector3(1, 0, 0), flex).add(new THREE.Vector3(0, -0.07, 0));
    nock.set(0, 0, BRACE - draw * 0.52);
    for (const [seg, tip] of [[segs[0], tipTop], [segs[1], tipBot]] as const) {
      const d = tip.clone().sub(nock);
      seg.scale.set(1, d.length(), 1);
      seg.position.copy(nock).addScaledVector(d, 0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    }
    // The arrow rests on the grip and is nocked on the string.
    arrow.position.set(0.012, 0.01, nock.z);
  };
  setDraw(0);
  return { root, id: '', tip: new THREE.Vector3(0, 0, 0.5), setDraw, nock, arrow };
}

/** Arrow: shaft along +Y from the nock (origin) to the stone point, fletching at the nock. */
export function arrowModel(m: Mats | null = null, lib: TextureLibrary | null = null): THREE.Group {
  const mm = m ?? materials(lib);
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.72, 5), mm.wood);
  shaft.position.y = 0.36;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.05, 4), mm.flint);
  head.position.y = 0.745;
  g.add(shaft, head);
  for (let i = 0; i < 3; i++) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(0.018, 0.09), mm.feather);
    f.position.set(Math.cos((i * Math.PI * 2) / 3) * 0.01, 0.07, Math.sin((i * Math.PI * 2) / 3) * 0.01);
    f.rotation.y = (i * Math.PI * 2) / 3;
    g.add(f);
  }
  return g;
}

function generic(m: Mats, id: string): ItemModel {
  const root = new THREE.Group();
  let tip = new THREE.Vector3(0, 0.1, 0);
  switch (id) {
    case 'spyglass': {
      const a = mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.2, 12), m.brass);
      a.position.y = 0.04;
      const b = mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.14, 12), m.brass);
      b.position.y = 0.2;
      const lens = mesh(new THREE.CircleGeometry(0.019, 12), m.obsidian);
      lens.rotation.x = -Math.PI / 2;
      lens.position.y = 0.271;
      root.add(a, b, lens);
      tip = new THREE.Vector3(0, 0.27, 0);
      break;
    }
    case 'compass': {
      const c = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 16), m.brass);
      c.rotation.x = Math.PI / 2;
      c.position.y = 0.03;
      root.add(c);
      break;
    }
    case 'flare': {
      const c = mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.24, 10), m.flare);
      c.position.y = 0.06;
      root.add(c);
      tip = new THREE.Vector3(0, 0.18, 0);
      break;
    }
    case 'research_scanner':
    case 'radio_receiver': {
      const b = mesh(new THREE.BoxGeometry(0.05, 0.14, 0.035), m.plastic);
      b.position.y = 0.05;
      const s = mesh(new THREE.PlaneGeometry(0.036, 0.05), id === 'research_scanner' ? m.screen : m.plastic);
      s.position.set(0, 0.07, -0.0181);
      s.rotation.y = Math.PI;
      root.add(b, s);
      if (id === 'radio_receiver') {
        const ant = mesh(new THREE.CylinderGeometry(0.002, 0.003, 0.16, 4), m.metal);
        ant.position.set(0.018, 0.2, 0);
        root.add(ant);
      }
      break;
    }
    case 'waterskin': {
      const g = new THREE.SphereGeometry(0.07, 10, 8);
      g.scale(0.8, 1.15, 0.6);
      const bag = mesh(g, m.leather);
      bag.position.y = -0.02;
      bag.position.z = 0.05;
      root.add(bag);
      break;
    }
    case 'trap_snare': {
      const coil = mesh(new THREE.TorusGeometry(0.06, 0.006, 5, 18), m.binding);
      coil.position.y = 0.02;
      root.add(coil);
      break;
    }
    default: {
      const b = mesh(new THREE.BoxGeometry(0.04, 0.08, 0.04), m.leather);
      root.add(b);
    }
  }
  return { root, id: '', tip };
}

/** Builds the model of a held item. */
export function buildItemModel(id: string, lib: TextureLibrary | null): ItemModel {
  const m = materials(lib);
  let model: ItemModel;
  if (id === 'stone_axe' || id === 'metal_axe') model = axe(m, id === 'metal_axe');
  else if (id.endsWith('pickaxe')) model = pickaxe(m, id.startsWith('metal'));
  else if (id.endsWith('knife')) model = knife(m, id.startsWith('metal'));
  else if (id === 'spear' || id === 'obsidian_spear' || id === 'metal_spear') model = spear(m, id === 'metal_spear' ? 'metal' : id === 'obsidian_spear' ? 'obsidian' : 'flint');
  else if (id === 'wooden_club') model = club(m);
  else if (id === 'torch') model = torch(m);
  else if (id === 'bow') model = bow(m);
  else model = generic(m, id);
  model.id = id;
  model.root.name = `item:${id}`;
  return model;
}

/**
 * Grip transform inside the hand bone: the fist's grip axis runs through
 * the curled fingers (see humanModel `handMesh`), with the handle leaving
 * on the thumb side.
 */
export function attachToHand(model: ItemModel, hand: THREE.Object3D, side: 1 | -1): void {
  const holder = new THREE.Group();
  holder.name = 'grip';
  holder.position.set(side * -0.02, -0.09, 0.0);
  holder.rotation.x = Math.PI / 2;
  holder.add(model.root);
  hand.add(holder);
}

/** Disposes the geometries of a model (materials are shared). */
export function disposeItemModel(model: ItemModel): void {
  model.root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      if (!(o.material as THREE.Material).userData.shared) (o.material as THREE.Material).dispose();
    }
  });
  model.root.parent?.removeFromParent();
  model.root.removeFromParent();
}
