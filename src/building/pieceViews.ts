import * as THREE from 'three';
import { PIECES, WALL_H, type Piece, type PieceType } from './building';

const mats = {
  wood: new THREE.MeshStandardMaterial({ color: 0x7a5a38, roughness: 0.9 }),
  darkWood: new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.92 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x7c776c, roughness: 0.95 }),
  thatch: new THREE.MeshStandardMaterial({ color: 0x9a8550, roughness: 1 }),
  hide: new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 }),
  soil: new THREE.MeshStandardMaterial({ color: 0x3e2e20, roughness: 1 }),
  plant: new THREE.MeshStandardMaterial({ color: 0x5a8a32, roughness: 0.9 }),
  flame: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
  water: new THREE.MeshStandardMaterial({ color: 0x3a6a80, roughness: 0.2 }),
  cut: new THREE.MeshStandardMaterial({ color: 0x8a8478, roughness: 0.85 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x6a6e72, roughness: 0.5, metalness: 0.6 }),
  glow: new THREE.MeshStandardMaterial({ color: 0xffe9b0, emissive: 0xffd27a, emissiveIntensity: 0 }),
  wire: new THREE.MeshStandardMaterial({ color: 0x9a9a8a, roughness: 0.4, metalness: 0.5, emissive: 0x4a8aff, emissiveIntensity: 0 }),
  egg: new THREE.MeshStandardMaterial({ color: 0xd8cfb8, roughness: 0.7 }),
};

// Materials are shared by every piece; geometries are per object and disposed with it.
for (const m of Object.values(mats)) m.userData.shared = true;

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Builds the visual for a piece (local origin at the piece's base point). */
export function createPieceObject(type: PieceType): THREE.Group {
  const g = new THREE.Group();
  const [w, h, d] = PIECES[type].size;
  switch (type) {
    case 'foundation':
      g.add(mesh(new THREE.BoxGeometry(w, 3, d), mats.stone, 0, -1.5, 0));
      break;
    case 'floor':
      for (let i = 0; i < 8; i++) g.add(mesh(new THREE.BoxGeometry(w / 8 - 0.02, h, d), mats.wood, -w / 2 + (i + 0.5) * (w / 8), h / 2, 0));
      break;
    case 'wall':
      for (let i = 0; i < 6; i++) {
        const log = mesh(new THREE.CylinderGeometry(0.24, 0.24, w, 8), i % 2 ? mats.wood : mats.darkWood, 0, 0.25 + i * (WALL_H / 6), 0);
        log.rotation.z = Math.PI / 2;
        g.add(log);
      }
      break;
    case 'door': {
      for (const side of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(1.1, h, d), mats.darkWood, side * (w / 2 - 0.55), h / 2, 0));
      g.add(mesh(new THREE.BoxGeometry(w, 0.5, d), mats.darkWood, 0, h - 0.25, 0));
      const leaf = new THREE.Group();
      leaf.name = 'leaf';
      leaf.position.set(-0.9, 0, 0);
      leaf.add(mesh(new THREE.BoxGeometry(1.8, h - 0.5, 0.12), mats.wood, 0.9, (h - 0.5) / 2, 0));
      g.add(leaf);
      break;
    }
    case 'roof': {
      for (const side of [-1, 1]) {
        const slab = mesh(new THREE.BoxGeometry(w + 0.4, 0.2, d / 2 + 0.6), mats.thatch, 0, 0.7, side * d / 4);
        slab.rotation.x = side * 0.35;
        g.add(slab);
      }
      break;
    }
    case 'fence':
      for (let i = 0; i <= 3; i++) g.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, h + 0.4, 6), mats.darkWood, -w / 2 + (i * w) / 3, h / 2 - 0.2, 0));
      for (const y of [0.5, 1.1]) {
        const rail = mesh(new THREE.BoxGeometry(w, 0.1, 0.08), mats.wood, 0, y, 0);
        g.add(rail);
      }
      break;
    case 'palisade':
      for (let i = 0; i < 9; i++) {
        const x = -w / 2 + (i + 0.5) * (w / 9);
        g.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, h, 7), mats.darkWood, x, h / 2, 0));
        g.add(mesh(new THREE.ConeGeometry(0.2, 0.5, 7), mats.darkWood, x, h + 0.25, 0));
      }
      break;
    case 'platform':
      g.add(mesh(new THREE.BoxGeometry(w, 0.25, d), mats.wood, 0, -0.125, 0));
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(mesh(new THREE.CylinderGeometry(0.15, 0.18, h + 3, 6), mats.darkWood, (x * w) / 2.3, -(h + 3) / 2, (z * d) / 2.3));
      break;
    case 'campfire': {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.add(mesh(new THREE.DodecahedronGeometry(0.16, 0), mats.stone, Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55));
      }
      for (let i = 0; i < 3; i++) {
        const log = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), mats.darkWood, 0, 0.2, 0);
        log.rotation.set(Math.PI / 2 - 0.4, (i * Math.PI * 2) / 3, 0);
        g.add(log);
      }
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 7), mats.flame);
      flame.position.y = 0.5;
      flame.name = 'flame';
      g.add(flame);
      const light = new THREE.PointLight(0xff8a3a, 60, 22, 1.6);
      light.position.y = 1;
      light.name = 'light';
      g.add(light);
      break;
    }
    case 'workbench':
      g.add(mesh(new THREE.BoxGeometry(w, 0.12, d), mats.wood, 0, h, 0));
      for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.add(mesh(new THREE.BoxGeometry(0.1, h, 0.1), mats.darkWood, (x * w) / 2.3, h / 2, (z * d) / 2.4));
      g.add(mesh(new THREE.DodecahedronGeometry(0.15, 0), mats.stone, 0.4, h + 0.12, 0));
      break;
    case 'storage':
      g.add(mesh(new THREE.BoxGeometry(w, h, d), mats.darkWood, 0, h / 2, 0));
      g.add(mesh(new THREE.BoxGeometry(w + 0.04, 0.08, d + 0.04), mats.wood, 0, h * 0.8, 0));
      break;
    case 'bed':
      g.add(mesh(new THREE.BoxGeometry(w, 0.25, d), mats.darkWood, 0, 0.15, 0));
      g.add(mesh(new THREE.BoxGeometry(w - 0.1, 0.15, d - 0.2), mats.hide, 0, 0.35, 0.05));
      break;
    case 'water_collector':
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.55, 0.9, 12), mats.darkWood, 0, 0.45, 0));
      g.add(mesh(new THREE.ConeGeometry(0.9, 0.35, 12, 1, true), mats.hide, 0, 1.05, 0));
      {
        const water = mesh(new THREE.CircleGeometry(0.55, 12), mats.water, 0, 0.5, 0);
        water.rotation.x = -Math.PI / 2;
        water.name = 'water';
        g.add(water);
      }
      break;
    case 'crop_plot': {
      g.add(mesh(new THREE.BoxGeometry(w, h, d), mats.soil, 0, h / 2, 0));
      const plants = new THREE.Group();
      plants.name = 'plants';
      for (let i = 0; i < 9; i++) plants.add(mesh(new THREE.ConeGeometry(0.15, 0.6, 5), mats.plant, ((i % 3) - 1) * 0.7, h + 0.3, (Math.floor(i / 3) - 1) * 0.7));
      g.add(plants);
      break;
    }
    case 'stairs': {
      const steps = 8;
      for (let i = 0; i < steps; i++) {
        const sh = ((i + 1) / steps) * h;
        g.add(mesh(new THREE.BoxGeometry(w, 0.18, d / steps + 0.02), mats.wood, 0, sh - 0.09, -d / 2 + (i + 0.5) * (d / steps)));
      }
      for (const side of [-1, 1]) {
        const rail = mesh(new THREE.BoxGeometry(0.1, 0.12, Math.hypot(d, h)), mats.darkWood, (side * w) / 2, h / 2 + 0.5, 0);
        rail.rotation.x = -Math.atan2(h, d);
        g.add(rail);
      }
      break;
    }
    case 'stone_foundation':
      g.add(mesh(new THREE.BoxGeometry(w, 3, d), mats.cut, 0, -1.5, 0));
      break;
    case 'stone_wall':
      for (let row = 0; row < 5; row++)
        for (let i = 0; i < 4; i++) {
          const off = row % 2 ? 0.5 : 0;
          const bw = w / 4 - 0.04;
          const x = -w / 2 + (i + 0.5 + off) * (w / 4);
          if (x > w / 2) continue;
          g.add(mesh(new THREE.BoxGeometry(bw, h / 5 - 0.04, d), row % 2 ? mats.cut : mats.stone, Math.min(x, w / 2 - bw / 2), (row + 0.5) * (h / 5), 0));
        }
      break;
    case 'gate': {
      for (const side of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.15, 0.18, h + 0.6, 7), mats.darkWood, (side * w) / 2, (h + 0.6) / 2, 0));
      const leaf = new THREE.Group();
      leaf.name = 'leaf';
      leaf.position.set(-w / 2, 0, 0);
      for (let i = 0; i < 7; i++) leaf.add(mesh(new THREE.BoxGeometry(0.12, h - 0.2, 0.12), mats.wood, 0.3 + i * ((w - 0.6) / 6), (h - 0.2) / 2 + 0.1, 0));
      for (const y of [0.5, h - 0.4]) leaf.add(mesh(new THREE.BoxGeometry(w - 0.3, 0.14, 0.14), mats.darkWood, w / 2, y, 0));
      g.add(leaf);
      break;
    }
    case 'feeding_trough':
      g.add(mesh(new THREE.BoxGeometry(w, 0.12, d), mats.darkWood, 0, 0.35, 0));
      for (const side of [-1, 1]) {
        g.add(mesh(new THREE.BoxGeometry(w, 0.4, 0.08), mats.wood, 0, 0.55, (side * d) / 2));
        g.add(mesh(new THREE.BoxGeometry(0.08, 0.4, d), mats.wood, (side * w) / 2, 0.55, 0));
        g.add(mesh(new THREE.BoxGeometry(0.12, 0.35, 0.12), mats.darkWood, (side * w) / 2.4, 0.17, 0));
      }
      {
        const food = mesh(new THREE.BoxGeometry(w - 0.2, 0.2, d - 0.2), mats.plant, 0, 0.5, 0);
        food.name = 'food';
        g.add(food);
      }
      break;
    case 'nest_box': {
      const ring = mesh(new THREE.TorusGeometry(0.6, 0.22, 6, 14), mats.thatch, 0, 0.2, 0);
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      const egg = mesh(new THREE.SphereGeometry(0.22, 10, 8), mats.egg, 0, 0.3, 0);
      egg.scale.y = 1.3;
      egg.name = 'egg';
      g.add(egg);
      break;
    }
    case 'spike_trap':
      g.add(mesh(new THREE.BoxGeometry(w, 0.08, d), mats.darkWood, 0, 0.04, 0));
      for (let i = 0; i < 9; i++) g.add(mesh(new THREE.ConeGeometry(0.07, 0.45, 5), mats.stone, ((i % 3) - 1) * 0.6, 0.3, (Math.floor(i / 3) - 1) * 0.6));
      break;
    case 'snare_trap': {
      const loop = mesh(new THREE.TorusGeometry(0.45, 0.03, 4, 16), mats.thatch, 0, 0.05, 0);
      loop.rotation.x = -Math.PI / 2;
      loop.name = 'loop';
      g.add(loop);
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.2, 5), mats.darkWood, 0.6, 0.6, 0));
      break;
    }
    case 'forge':
      g.add(mesh(new THREE.CylinderGeometry(0.9, 1, 1.2, 10), mats.stone, 0, 0.6, 0));
      g.add(mesh(new THREE.CylinderGeometry(0.3, 0.45, 0.8, 8), mats.stone, 0, 1.5, 0));
      {
        const fire = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), mats.flame);
        fire.position.set(0, 0.9, 0.7);
        fire.name = 'flame';
        g.add(fire);
        const light = new THREE.PointLight(0xff7a2a, 30, 10, 1.8);
        light.position.set(0, 1, 1);
        light.name = 'light';
        g.add(light);
      }
      break;
    case 'wind_generator': {
      g.add(mesh(new THREE.CylinderGeometry(0.12, 0.3, h, 6), mats.metal, 0, h / 2, 0));
      const rotor = new THREE.Group();
      rotor.name = 'rotor';
      rotor.position.set(0, h, 0.35);
      for (let i = 0; i < 3; i++) {
        const blade = mesh(new THREE.BoxGeometry(0.25, 2.2, 0.04), mats.hide, 0, 1.1, 0);
        const holder = new THREE.Group();
        holder.rotation.z = (i * Math.PI * 2) / 3;
        holder.add(blade);
        rotor.add(holder);
      }
      g.add(rotor);
      break;
    }
    case 'lamp': {
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.08, h, 6), mats.metal, 0, h / 2, 0));
      g.add(mesh(new THREE.SphereGeometry(0.2, 10, 8), mats.glow, 0, h, 0));
      const light = new THREE.PointLight(0xffe0a0, 0, 18, 1.5);
      light.position.y = h;
      light.name = 'light';
      g.add(light);
      break;
    }
    case 'electric_fence':
      for (let i = 0; i <= 2; i++) g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, h, 6), mats.darkWood, -w / 2 + (i * w) / 2, h / 2, 0));
      for (const y of [0.4, 0.9, 1.4]) {
        const wire = mesh(new THREE.CylinderGeometry(0.015, 0.015, w, 4), mats.wire, 0, y, 0);
        wire.rotation.z = Math.PI / 2;
        g.add(wire);
      }
      break;
    case 'well':
      g.add(mesh(new THREE.CylinderGeometry(0.9, 0.95, 0.9, 12, 1, true), mats.stone, 0, 0.45, 0));
      g.add(mesh(new THREE.CircleGeometry(0.85, 12), mats.water, 0, 0.3, 0).rotateX(-Math.PI / 2));
      for (const side of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.1, 1.6, 0.1), mats.darkWood, side * 0.85, 1.2, 0));
      g.add(mesh(new THREE.BoxGeometry(1.9, 0.1, 0.1), mats.darkWood, 0, 2, 0));
      break;
    case 'torch_post': {
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, h, 5), mats.darkWood, 0, h / 2, 0));
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), mats.flame);
      flame.position.y = h + 0.15;
      flame.name = 'flame';
      g.add(flame);
      const light = new THREE.PointLight(0xffa040, 25, 14, 1.6);
      light.position.y = h + 0.3;
      light.name = 'light';
      g.add(light);
      break;
    }
  }
  return g;
}

/** Releases per-object geometries (shared materials and geometries are kept). */
export function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh || c instanceof THREE.Points || c instanceof THREE.LineSegments) {
      if (!c.geometry.userData.shared) c.geometry.dispose();
      const ms = Array.isArray(c.material) ? c.material : [c.material];
      for (const m of ms) if (!m.userData.shared) m.dispose();
    }
  });
}

/** Applies dynamic state (door open, crop growth, collector level, flicker). */
export function syncPieceObject(o: THREE.Object3D, p: Piece, time: number): void {
  o.position.set(p.x, p.y, p.z);
  o.rotation.y = -p.rot;
  if (p.type === 'door' || p.type === 'gate') {
    const leaf = o.getObjectByName('leaf');
    if (leaf) leaf.rotation.y += ((p.open ? -1.5 : 0) - leaf.rotation.y) * 0.2;
  } else if (p.type === 'crop_plot') {
    const plants = o.getObjectByName('plants');
    if (plants) {
      plants.visible = !!p.crop;
      plants.scale.setScalar(0.15 + (p.growth ?? 0) * 0.85);
    }
  } else if (p.type === 'nest_box') {
    const egg = o.getObjectByName('egg');
    if (egg) {
      egg.visible = !!p.egg;
      egg.rotation.z = p.egg && p.egg.progress > 0.8 ? Math.sin(time * 9) * 0.15 : 0;
    }
  } else if (p.type === 'feeding_trough') {
    const food = o.getObjectByName('food');
    if (food) food.visible = (p.storage ?? []).some((s) => s);
  } else if (p.type === 'snare_trap') {
    const loop = o.getObjectByName('loop');
    if (loop) loop.visible = !!p.armed;
  } else if (p.type === 'wind_generator') {
    const rotor = o.getObjectByName('rotor');
    if (rotor && p.powered) rotor.rotation.z += 0.08;
  } else if (p.type === 'lamp') {
    const l = o.getObjectByName('light') as THREE.PointLight | undefined;
    if (l) l.intensity = p.powered ? 40 : 0;
  } else if (p.type === 'forge' || p.type === 'torch_post') {
    const f = o.getObjectByName('flame');
    if (f) f.scale.setScalar(0.9 + Math.sin(time * 11 + p.z) * 0.1);
  } else if (p.type === 'water_collector') {
    const w = o.getObjectByName('water');
    if (w) w.position.y = 0.1 + Math.min(1, (p.water ?? 0) / 20) * 0.75;
  } else if (p.type === 'campfire') {
    const f = o.getObjectByName('flame');
    if (f) f.scale.setScalar(0.85 + Math.sin(time * 13 + p.x) * 0.1 + Math.sin(time * 7.3) * 0.08);
    const l = o.getObjectByName('light') as THREE.PointLight | undefined;
    if (l) l.intensity = 55 + Math.sin(time * 11) * 8;
  }
}

export function createGhost(type: PieceType): THREE.Group {
  const g = createPieceObject(type);
  const mat = new THREE.MeshBasicMaterial({ color: 0x55ff77, transparent: true, opacity: 0.4, depthWrite: false });
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.material = mat;
      o.castShadow = false;
    }
    if (o instanceof THREE.Light) o.visible = false;
  });
  g.userData.mat = mat;
  return g;
}
