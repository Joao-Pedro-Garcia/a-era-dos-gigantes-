import * as THREE from 'three';
import type { VegetationKind } from './biomes';

/**
 * Procedural plant and rock models for the vegetation material
 * (see graphics/vegetationMaterial.ts).
 *
 * Trees are grown, not assembled from primitives: trunks and branches are
 * continuous tapered tubes that bend along noisy paths with root flares at
 * the base; foliage is made of many textured leaf cards (from the leaf
 * atlas) clustered at branch tips, with normals bent outward from the crown
 * centre so the canopy shades like a volume. The flora follows the
 * Mesozoic: araucaria-like conifers, early broadleaf angiosperms, palms,
 * cycads, ferns and horsetails.
 *
 * Every kind has several variants (seeded), and a low-detail version used
 * at distance with the same silhouette.
 */

// Vegetation texture array layers.
export const VL = { bark: 0, barkRinged: 1, leaves: 2, stone: 3, plain: 4 } as const;
// Leaf atlas cells (u0, v0, u1, v1).
const ATLAS = {
  broad: [0.0, 0.0, 0.5, 0.5],
  needles: [0.5, 0.0, 1.0, 0.5],
  fern: [0.0, 0.5, 0.5, 1.0],
  palm: [0.5, 0.5, 1.0, 1.0],
} as const;
type Cell = keyof typeof ATLAS;

type RGB = [number, number, number];

function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Accumulates vertices for one plant model. */
class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  layer: number[] = [];
  wind: number[] = [];
  idx: number[] = [];
  constructor(readonly height: number) {}

  /** Default sway: grows with height squared, in metres at full wind. */
  windAt(p: THREE.Vector3, extra = 0): number {
    const t = Math.max(0, p.y) / Math.max(1, this.height);
    return t * t * this.height * 0.045 + extra;
  }

  vertex(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: RGB, layer: number, wind: number): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(c[0], c[1], c[2]);
    this.layer.push(layer);
    this.wind.push(wind);
    return this.pos.length / 3 - 1;
  }

  /**
   * Tapered tube along a path (parallel-transport frames, no twisting).
   * Bark UVs keep a constant texel density: u wraps around, v runs along the length.
   */
  tube(path: THREE.Vector3[], radii: number[], segs: number, layer: number, color: (t: number, a: number) => RGB, tile = 1.6, windExtra = (_t: number) => 0, flare = 0): void {
    const n = path.length;
    let normal = V3(1, 0, 0);
    const tangent = V3();
    let prevT = path[1].clone().sub(path[0]).normalize();
    if (Math.abs(prevT.dot(normal)) > 0.9) normal = V3(0, 0, 1);
    normal = normal.sub(prevT.clone().multiplyScalar(prevT.dot(normal))).normalize();
    let along = 0;
    const base = this.pos.length / 3;
    for (let i = 0; i < n; i++) {
      if (i > 0) along += path[i].distanceTo(path[i - 1]);
      tangent.copy(i < n - 1 ? path[i + 1].clone().sub(path[i]) : path[i].clone().sub(path[i - 1])).normalize();
      // Parallel transport of the normal.
      const axis = prevT.clone().cross(tangent);
      const s = axis.length();
      if (s > 1e-5) normal.applyAxisAngle(axis.normalize(), Math.asin(Math.min(1, s)));
      prevT.copy(tangent);
      const bin = tangent.clone().cross(normal).normalize();
      const t = i / (n - 1);
      const r = radii[i];
      const circ = 2 * Math.PI * Math.max(r, 0.05);
      const uRep = Math.max(1, Math.round(circ / tile));
      for (let k = 0; k <= segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        // Root flare: lobes at the base of trunks.
        const lobes = flare > 0 ? 1 + flare * Math.exp(-along * 2.2) * (0.6 + 0.4 * Math.cos(a * 4 + 0.7)) : 1;
        const dir = normal.clone().multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
        const p = path[i].clone().addScaledVector(dir, r * lobes);
        this.vertex(p, dir, (k / segs) * uRep, along / tile, color(t, a), layer, this.windAt(path[i], windExtra(t)));
      }
    }
    for (let i = 0; i < n - 1; i++)
      for (let k = 0; k < segs; k++) {
        const a = base + i * (segs + 1) + k;
        const b = a + segs + 1;
        this.idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
  }

  /**
   * A leaf card: a quad (optionally bent along its length) textured with an
   * atlas cell. Normals point away from `crown` for volumetric shading.
   */
  card(origin: THREE.Vector3, along: THREE.Vector3, across: THREE.Vector3, cell: Cell, color: RGB, crown: THREE.Vector3 | null, droop = 0, segs = 1, windBoost = 0, centered = true): void {
    const [u0, v0, u1, v1] = ATLAS[cell];
    const base = this.pos.length / 3;
    const len = along.length();
    const dirA = along.clone().normalize();
    const flat = across.clone().cross(dirA).normalize();
    if (flat.y < 0) flat.negate();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      // Bend downwards with the square of the distance (gravity).
      const p = origin.clone().addScaledVector(dirA, len * t).add(V3(0, -droop * t * t, 0));
      if (centered) p.addScaledVector(dirA, -len * 0.5);
      for (const side of [-1, 1]) {
        const q = p.clone().addScaledVector(across, side * 0.5);
        const n = crown ? q.clone().sub(crown).normalize().lerp(flat, 0.35).normalize() : flat;
        // Tip of fern/palm fronds is at v0, base at v1 (as drawn in the atlas).
        const v = cell === 'fern' || cell === 'palm' ? v1 - (v1 - v0) * t : v0 + (v1 - v0) * t;
        const u = side < 0 ? u0 : u1;
        const shade = crown ? 0.75 + 0.25 * Math.min(1, q.distanceTo(crown) / Math.max(0.5, len * 2)) : 1;
        this.vertex(q, n, u, v, [color[0] * shade, color[1] * shade, color[2] * shade], VL.leaves, this.windAt(q, windBoost * t));
      }
    }
    for (let i = 0; i < segs; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  /** Grass blade: tapered curved strip, untextured, colour gradient root→tip. */
  blade(root: THREE.Vector3, dir: THREE.Vector3, h: number, w: number, lean: THREE.Vector3, base: RGB, tip: RGB): void {
    const segs = 3;
    const start = this.pos.length / 3;
    const side = V3(-dir.z, 0, dir.x).normalize();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const p = root.clone().add(V3(0, h * t, 0)).addScaledVector(lean, h * t * t);
      const width = w * (1 - t * 0.92);
      const c: RGB = [base[0] + (tip[0] - base[0]) * t, base[1] + (tip[1] - base[1]) * t, base[2] + (tip[2] - base[2]) * t];
      const n = V3(0, 1, 0).lerp(dir, 0.4).normalize();
      for (const s of [-1, 1]) this.vertex(p.clone().addScaledVector(side, (s * width) / 2), n, 0, 0, c, VL.plain, t * t * h * 0.35);
    }
    for (let i = 0; i < segs; i++) {
      const a = start + i * 2;
      this.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  /** Small coloured blob (berries, fruit). */
  blob(c: THREE.Vector3, r: number, color: RGB): void {
    const g = new THREE.IcosahedronGeometry(r, 0);
    const p = g.attributes.position;
    const base = this.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      const v = V3(p.getX(i), p.getY(i), p.getZ(i));
      this.vertex(v.clone().add(c), v.normalize(), 0, 0, color, VL.plain, this.windAt(c, 0.05));
    }
    for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    g.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('vegLayer', new THREE.Float32BufferAttribute(this.layer, 1));
    g.setAttribute('wind', new THREE.Float32BufferAttribute(this.wind, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    g.userData.shared = true;
    return g;
  }
}

// ------------------------------------------------------------------ helpers

const lin = (hex: number): RGB => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const jit = (c: RGB, r: () => number, amt: number): RGB => {
  const k = 1 + (r() - 0.5) * 2 * amt;
  const h = (r() - 0.5) * amt * 0.6;
  return [c[0] * k * (1 + h), c[1] * k, c[2] * k * (1 - h)];
};

/** A path that wanders from `start` along `dir`, bending toward `bias`. */
function wanderPath(r: () => number, start: THREE.Vector3, dir: THREE.Vector3, len: number, n: number, wobble: number, bias = V3(0, 0.15, 0)): THREE.Vector3[] {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const step = len / (n - 1);
  const p = start.clone();
  for (let i = 1; i < n; i++) {
    d.add(V3((r() - 0.5) * wobble, (r() - 0.5) * wobble * 0.5, (r() - 0.5) * wobble)).add(bias).normalize();
    p.addScaledVector(d, step);
    pts.push(p.clone());
  }
  return pts;
}

function perpendicular(d: THREE.Vector3, ang: number, spin: number): THREE.Vector3 {
  const ref = Math.abs(d.y) < 0.9 ? V3(0, 1, 0) : V3(1, 0, 0);
  const side = d.clone().cross(ref).normalize().applyAxisAngle(d, spin);
  return d.clone().applyAxisAngle(side, ang).normalize();
}

/** Tints multiply the textures, so they stay near 1 (hue shifts only). */
const T = (r: number, g: number, b: number): RGB => [r, g, b];
const BARK_BROWN = T(1.0, 0.92, 0.82);
const BARK_GREY = T(1.05, 1.05, 1.02);

// ------------------------------------------------------------------ broadleaf (angiosperm)

function broadleaf(seed: number, lod: number): THREE.BufferGeometry {
  const r = rng(seed);
  const H = 8 + r() * 4;
  const b = new Builder(H);
  const segs = lod ? 5 : 9;
  const bark = jit(BARK_BROWN, r, 0.12);
  const leaf = jit([T(1.0, 1.0, 0.9), T(0.92, 1.0, 0.95), T(1.1, 1.05, 0.85)][seed % 3], r, 0.1);
  const barkCol = (t: number) => [bark[0] * (0.75 + t * 0.25), bark[1] * (0.75 + t * 0.25), bark[2] * (0.75 + t * 0.25)] as RGB;
  const fork = H * (0.32 + r() * 0.12);
  const trunkR = 0.28 + r() * 0.1;
  const trunk = wanderPath(r, V3(0, -0.4, 0), V3((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2), fork + 0.4, lod ? 4 : 7, 0.12, V3(0, 0.1, 0));
  b.tube(trunk, trunk.map((_, i) => trunkR * (1 - (i / trunk.length) * 0.25)), segs, VL.bark, barkCol, 1.6, () => 0, lod ? 0.4 : 0.9);
  // Surface roots spreading over the ground.
  if (!lod)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + r();
      const d = V3(Math.cos(a), -0.25, Math.sin(a));
      const p = wanderPath(r, V3(Math.cos(a) * trunkR * 0.6, 0.15, Math.sin(a) * trunkR * 0.6), d, 1.2 + r(), 4, 0.3, V3(0, -0.06, 0));
      b.tube(p, p.map((_, i) => trunkR * 0.35 * (1 - i / p.length)), 5, VL.bark, () => barkCol(0.2), 1.6);
    }
  const crownC = V3(0, fork + (H - fork) * 0.55, 0);
  const tips: THREE.Vector3[] = [];
  const grow = (start: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, depth: number) => {
    const pts = wanderPath(r, start, dir, len, lod ? 3 : 5, 0.25, V3(0, depth > 1 ? -0.02 : 0.06, 0));
    b.tube(pts, pts.map((_, i) => rad * (1 - (i / (pts.length - 1)) * 0.45)), Math.max(4, segs - depth * 2), VL.bark, barkCol, 1.6, (t) => t * depth * 0.08);
    const maxDepth = lod ? 2 : 3;
    if (depth >= maxDepth || rad < 0.03) {
      tips.push(pts[pts.length - 1]);
      tips.push(pts[Math.floor(pts.length * 0.6)]);
      return;
    }
    const kids = 2 + Math.floor(r() * 2);
    for (let k = 0; k < kids; k++) {
      const at = pts[Math.min(pts.length - 1, Math.floor(pts.length * (0.5 + r() * 0.5)))];
      const nd = perpendicular(dir.clone().normalize(), 0.45 + r() * 0.45, r() * Math.PI * 2);
      nd.y = Math.max(nd.y, -0.1);
      grow(at, nd, len * (0.6 + r() * 0.15), rad * 0.6, depth + 1);
    }
  };
  const limbs = 3 + Math.floor(r() * 2);
  for (let k = 0; k < limbs; k++) {
    const a = (k / limbs) * Math.PI * 2 + r() * 0.8;
    const d = V3(Math.cos(a) * 0.65, 1, Math.sin(a) * 0.65);
    grow(trunk[trunk.length - 1], d, (H - fork) * (0.45 + r() * 0.15), trunkR * 0.62, 1);
  }
  // Leaf clusters.
  const perTip = lod ? 4 : 9;
  const size = lod ? 2.6 : 1.55;
  for (const tip of tips) {
    for (let k = 0; k < perTip; k++) {
      const o = tip.clone().add(V3((r() - 0.5) * 1.6, (r() - 0.3) * 1.0, (r() - 0.5) * 1.6));
      const along = V3(r() - 0.5, (r() - 0.5) * 0.6, r() - 0.5).normalize().multiplyScalar(size * (0.8 + r() * 0.4));
      const across = along.clone().cross(V3(r() - 0.5, 1, r() - 0.5)).normalize().multiplyScalar(size * (0.8 + r() * 0.4));
      b.card(o, along, across, 'broad', jit(leaf, r, 0.12), crownC, 0, 1, 0.15);
    }
  }
  return b.build();
}

// ------------------------------------------------------------------ conifer (araucaria / podocarp)

function conifer(seed: number, lod: number): THREE.BufferGeometry {
  const r = rng(seed);
  const variant = seed % 3;
  const H = variant === 1 ? 9 + r() * 3 : 14 + r() * 6;
  const b = new Builder(H);
  const bark = jit(T(1.05, 0.88, 0.78), r, 0.1);
  const needles = jit(variant === 2 ? T(1.1, 1.1, 0.95) : T(0.95, 1.0, 1.0), r, 0.08);
  const barkCol = (t: number) => [bark[0] * (0.8 + t * 0.2), bark[1] * (0.8 + t * 0.2), bark[2] * (0.8 + t * 0.2)] as RGB;
  const trunkR = 0.25 + r() * 0.15 + H * 0.008;
  const trunk = wanderPath(r, V3(0, -0.4, 0), V3(0, 1, 0), H, lod ? 5 : 10, 0.04, V3(0, 0.2, 0));
  b.tube(trunk, trunk.map((_, i) => trunkR * (1 - (i / (trunk.length - 1)) * 0.8)), lod ? 5 : 9, VL.bark, barkCol, 1.4, () => 0, lod ? 0.3 : 0.6);
  // Araucaria: whorls of horizontal branches, crown concentrated near the top (umbrella);
  // young trees (variant 1) are conical with branches all along the trunk.
  const startY = variant === 1 ? H * 0.2 : H * 0.5;
  const whorlStep = lod ? 1.6 : 0.95;
  const crownC = V3(0, (startY + H) / 2, 0);
  let whorl = 0;
  for (let y = startY; y < H * 0.97; y += whorlStep * (0.85 + r() * 0.3)) {
    const t = (y - startY) / (H - startY);
    const len = variant === 1 ? (1 - t) * H * 0.32 + 0.6 : Math.sin(Math.PI * (0.35 + t * 0.6)) * H * 0.2 + 0.5;
    const count = lod ? 3 : 5;
    whorl++;
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + whorl * 0.6 + r() * 0.3;
      const d = V3(Math.cos(a), 0.12 + (variant === 2 ? 0.25 : 0), Math.sin(a));
      const pts = wanderPath(r, V3(0, y, 0), d, len, lod ? 2 : 4, 0.1, V3(0, -0.025, 0));
      if (!lod || k % 2 === 0) b.tube(pts, pts.map((_, i) => 0.07 * (1 - i / pts.length) + 0.015), 4, VL.bark, barkCol, 1.4, (tt) => tt * 0.25);
      // Needle sprays along the branch, held roughly horizontal.
      const sprays = lod ? 2 : 4;
      for (let s = 0; s < sprays; s++) {
        const p = pts[Math.min(pts.length - 1, Math.floor(((s + 1) / sprays) * (pts.length - 1)))];
        const along = d.clone().setY(0).normalize().multiplyScalar(len * (lod ? 0.9 : 0.55) + 0.4);
        const across = V3(-along.z, 0.15 * (r() - 0.5), along.x).normalize().multiplyScalar(lod ? 1.7 : 1.1);
        b.card(p, along, across, 'needles', jit(needles, r, 0.1), crownC, 0.25, 2, 0.3);
      }
    }
  }
  // Leader / top tuft.
  b.card(V3(0, H * 0.98, 0), V3(0, 1.2, 0), V3(1, 0, 0), 'needles', needles, null, 0, 1, 0.2, false);
  return b.build();
}

// ------------------------------------------------------------------ palm, cycad, fern

function frond(b: Builder, r: () => number, base: THREE.Vector3, azimuth: number, elev: number, len: number, width: number, droop: number, cell: Cell, color: RGB, segs: number): void {
  const dir = V3(Math.cos(azimuth) * Math.cos(elev), Math.sin(elev), Math.sin(azimuth) * Math.cos(elev));
  const across = V3(-Math.sin(azimuth), 0, Math.cos(azimuth)).multiplyScalar(width);
  b.card(base, dir.multiplyScalar(len), across, cell, jit(color, r, 0.1), null, droop, segs, 0.25 * len, false);
}

function palm(seed: number, lod: number): THREE.BufferGeometry {
  const r = rng(seed);
  const H = 6 + r() * 4;
  const b = new Builder(H);
  const bark = jit(T(1.05, 1.0, 0.88), r, 0.08);
  const lean = V3((r() - 0.5) * 0.6, 1, (r() - 0.5) * 0.6).normalize();
  const trunk = wanderPath(r, V3(0, -0.3, 0), lean, H, lod ? 5 : 9, 0.05, V3(0, 0.06, 0));
  b.tube(trunk, trunk.map((_, i) => 0.24 - (i / trunk.length) * 0.06), lod ? 5 : 8, VL.barkRinged, (t) => [bark[0] * (0.8 + t * 0.2), bark[1] * (0.8 + t * 0.2), bark[2] * (0.8 + t * 0.2)] as RGB, 1.2, () => 0, 0.5);
  const top = trunk[trunk.length - 1];
  const leaf = jit(T(1.05, 1.05, 0.9), r, 0.08);
  const n = lod ? 7 : 12;
  for (let k = 0; k < n; k++) {
    const az = (k / n) * Math.PI * 2 + r() * 0.3;
    const old = k % 4 === 3;
    frond(b, r, top, az, old ? -0.4 : 0.35 + r() * 0.35, 3 + r() * 1.2, 1.1, old ? 0.6 : 1.6, 'palm', old ? T(2.2, 1.5, 0.8) : leaf, lod ? 2 : 5);
  }
  return b.build();
}

function cycad(seed: number, lod: number): THREE.BufferGeometry {
  const r = rng(seed);
  const H = 0.8 + r() * 1.2;
  const b = new Builder(H + 1.5);
  const bark = jit(T(1.0, 0.95, 0.85), r, 0.08);
  const trunk = wanderPath(r, V3(0, -0.2, 0), V3(0, 1, 0), H, 4, 0.05);
  b.tube(trunk, trunk.map((_, i) => 0.42 - i * 0.03), lod ? 6 : 10, VL.barkRinged, () => bark, 0.9, () => 0, 0.2);
  const top = trunk[trunk.length - 1];
  const leaf = jit(T(0.9, 1.0, 0.95), r, 0.08);
  const n = lod ? 9 : 18;
  for (let k = 0; k < n; k++) {
    const az = (k / n) * Math.PI * 2 + r() * 0.25;
    frond(b, r, top.clone().add(V3(0, 0.05, 0)), az, 0.55 + r() * 0.4, 1.6 + r() * 0.8, 0.55, 0.55, 'palm', leaf, lod ? 2 : 4);
  }
  return b.build();
}

function fern(seed: number, lod: number, scale = 1): THREE.BufferGeometry {
  const r = rng(seed);
  const b = new Builder(1.5 * scale);
  const leaf = jit(T(1.0, 1.08, 0.95), r, 0.1);
  const n = lod ? 6 : 9 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const az = (k / n) * Math.PI * 2 + r() * 0.4;
    frond(b, r, V3(0, 0.02, 0), az, 0.7 + r() * 0.5, (1.0 + r() * 0.6) * scale, 0.75 * scale, 0.7 * scale, 'fern', leaf, lod ? 2 : 4);
  }
  return b.build();
}

/** Tree fern (Mesozoic understorey): a fern crown on a slender fibrous trunk. */
function treeFern(seed: number, lod: number): THREE.BufferGeometry {
  const r = rng(seed);
  const H = 2.5 + r() * 2;
  const b = new Builder(H + 1.5);
  const trunk = wanderPath(r, V3(0, -0.2, 0), V3((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3), H, 5, 0.08);
  b.tube(trunk, trunk.map(() => 0.16), lod ? 5 : 7, VL.barkRinged, () => T(0.8, 0.7, 0.6), 0.7);
  const top = trunk[trunk.length - 1];
  const leaf = jit(T(0.95, 1.05, 0.95), r, 0.08);
  const n = lod ? 7 : 12;
  for (let k = 0; k < n; k++) frond(b, r, top, (k / n) * Math.PI * 2 + r() * 0.4, 0.4 + r() * 0.4, 2.0 + r() * 0.6, 1.1, 1.3, 'fern', leaf, lod ? 2 : 4);
  return b.build();
}

// ------------------------------------------------------------------ bush, dead tree, reeds, grass

function bush(seed: number, lod: number): THREE.BufferGeometry {
  const r = rng(seed);
  const b = new Builder(1.6);
  const bark = jit(BARK_BROWN, r, 0.1);
  const leaf = jit(T(0.95, 1.0, 0.9), r, 0.1);
  const crown = V3(0, 0.7, 0);
  if (!lod)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + r();
      const p = wanderPath(r, V3(0, -0.1, 0), V3(Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6), 1 + r() * 0.4, 3, 0.3);
      b.tube(p, [0.05, 0.035, 0.02], 4, VL.bark, () => bark, 1.2);
    }
  const n = lod ? 12 : 34;
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * 0.9;
    const o = V3(Math.cos(a) * rad, 0.35 + r() * 0.9 - rad * 0.3, Math.sin(a) * rad);
    const along = V3(r() - 0.5, (r() - 0.5) * 0.5, r() - 0.5).normalize().multiplyScalar(lod ? 1.3 : 0.8);
    const across = along.clone().cross(V3(0, 1, 0)).normalize().multiplyScalar(lod ? 1.3 : 0.8);
    b.card(o, along, across, 'broad', jit(leaf, r, 0.12), crown, 0, 1, 0.1);
  }
  // Berries.
  if (!lod) for (let k = 0; k < 14; k++) b.blob(V3((r() - 0.5) * 1.5, 0.5 + r() * 0.7, (r() - 0.5) * 1.5), 0.045, lin(0x8a1a26));
  return b.build();
}

function deadTree(seed: number, lod: number): THREE.BufferGeometry {
  const r = rng(seed);
  const H = 5 + r() * 3;
  const b = new Builder(H);
  const bark = jit(BARK_GREY, r, 0.08);
  const col = (t: number) => [bark[0] * (0.7 + t * 0.3), bark[1] * (0.7 + t * 0.3), bark[2] * (0.7 + t * 0.3)] as RGB;
  const trunk = wanderPath(r, V3(0, -0.4, 0), V3((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3), H, lod ? 4 : 8, 0.15);
  b.tube(trunk, trunk.map((_, i) => 0.3 * (1 - (i / trunk.length) * 0.7)), lod ? 5 : 8, VL.bark, col, 1.6, () => 0, lod ? 0.3 : 0.8);
  const branches = lod ? 3 : 6;
  for (let k = 0; k < branches; k++) {
    const at = trunk[Math.floor(trunk.length * (0.4 + r() * 0.55))];
    const d = perpendicular(V3(0, 1, 0), 0.7 + r() * 0.6, r() * Math.PI * 2);
    const pts = wanderPath(r, at, d, 1.5 + r() * 2, lod ? 3 : 5, 0.5, V3(0, 0.04, 0));
    b.tube(pts, pts.map((_, i) => 0.09 * (1 - i / pts.length) + 0.01), 4, VL.bark, col, 1.6, (t) => t * 0.1);
  }
  return b.build();
}

/** Horsetails (Equisetum): segmented stalks with dark nodes. */
function reeds(seed: number, lod: number): THREE.BufferGeometry {
  const r = rng(seed);
  const b = new Builder(2);
  const green = jit(lin(0x6a8a3e), r, 0.08);
  const n = lod ? 8 : 16;
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.5;
    const h = 1.1 + r() * 1.1;
    const pts = wanderPath(r, V3(Math.cos(a) * d, -0.1, Math.sin(a) * d), V3((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2), h, 5, 0.06);
    const nodes = 6 + Math.floor(r() * 4);
    b.tube(pts, pts.map((_, i) => 0.025 * (1 - i / pts.length * 0.6)), lod ? 3 : 5, VL.plain, (t) => (Math.abs(((t * nodes) % 1) - 0.5) > 0.44 ? [green[0] * 0.35, green[1] * 0.35, green[2] * 0.3] : [green[0] * (0.8 + t * 0.3), green[1] * (0.8 + t * 0.3), green[2] * (0.8 + t * 0.2)]), 1, (t) => t * t * h * 0.15);
  }
  return b.build();
}

function grass(seed: number, lod: number, height = 1, count = 26, spread = 0.55): THREE.BufferGeometry {
  const r = rng(seed);
  const b = new Builder(0.8 * height);
  const n = lod ? Math.ceil(count / 3) : count;
  const dryness = (seed % 3) * 0.12;
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * spread;
    const root = V3(Math.cos(a) * d, -0.02, Math.sin(a) * d);
    const h = (0.35 + r() * 0.5) * height;
    const lean = V3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.25 + r() * 0.35).add(V3((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3));
    const baseC = lin(0x3a4a1c);
    const tipC = jit(lin([0x8a9a48, 0x9aa050, 0x7d9040][k % 3]), r, 0.15);
    tipC[0] += dryness;
    tipC[1] += dryness * 0.6;
    b.blade(root, V3(Math.cos(a + 1.3), 0, Math.sin(a + 1.3)), h, (0.04 + r() * 0.03) * (lod ? 2 : 1), lean, baseC, tipC);
  }
  return b.build();
}

// ------------------------------------------------------------------ rocks, logs, pebbles

function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = (t: number) => t * t * (3 - 2 * t);
  let s = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const w = (dx ? u(fx) : 1 - u(fx)) * (dy ? u(fy) : 1 - u(fy)) * (dz ? u(fz) : 1 - u(fz));
    s += hash3(ix + dx, iy + dy, iz + dz) * w;
  }
  return s;
}

/** Weathered rock: displaced sphere, flattened base, box-projected stone texture, mossy tops. */
function rock(seed: number, lod: number, size = 1, flat = 0.65): THREE.BufferGeometry {
  const r = rng(seed);
  const g = new THREE.IcosahedronGeometry(1, lod ? 2 : 4).toNonIndexed();
  const p = g.attributes.position;
  const o = r() * 100;
  const sx = 0.8 + r() * 0.5;
  const sz = 0.8 + r() * 0.5;
  for (let i = 0; i < p.count; i++) {
    const v = V3(p.getX(i), p.getY(i), p.getZ(i));
    let n = 0;
    let amp = 0.35;
    let f = 1.3;
    for (let k = 0; k < 4; k++) {
      n += (vnoise3(v.x * f + o, v.y * f + o, v.z * f) - 0.5) * amp;
      f *= 2.1;
      amp *= 0.5;
    }
    // Facets: quantise the radius a little for fractured planes.
    const rad = 1 + n;
    v.multiplyScalar(rad);
    v.x *= sx;
    v.z *= sz;
    v.y *= flat;
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.2;
    p.setXYZ(i, v.x * size, v.y * size, v.z * size);
  }
  g.computeVertexNormals();
  const b = new Builder(size);
  const nrm = g.attributes.normal;
  const moss = T(0.75, 0.95, 0.55);
  const stone: RGB = [1, 1, 1];
  for (let i = 0; i < p.count; i += 3) {
    // Box projection per triangle (dominant axis of the face normal).
    const fn = V3(nrm.getX(i) + nrm.getX(i + 1) + nrm.getX(i + 2), nrm.getY(i) + nrm.getY(i + 1) + nrm.getY(i + 2), nrm.getZ(i) + nrm.getZ(i + 1) + nrm.getZ(i + 2)).normalize();
    const ax = Math.abs(fn.x) > Math.abs(fn.y) && Math.abs(fn.x) > Math.abs(fn.z) ? 0 : Math.abs(fn.y) > Math.abs(fn.z) ? 1 : 2;
    for (let k = 0; k < 3; k++) {
      const v = V3(p.getX(i + k), p.getY(i + k), p.getZ(i + k));
      const n = V3(nrm.getX(i + k), nrm.getY(i + k), nrm.getZ(i + k));
      const uvs = ax === 0 ? [v.z, v.y] : ax === 1 ? [v.x, v.z] : [v.x, v.y];
      const m = Math.max(0, n.y - 0.55) * 1.6;
      const ao = 0.6 + 0.4 * Math.min(1, (v.y / size + 0.2) * 1.5);
      const c: RGB = [(stone[0] + (moss[0] - stone[0]) * m) * ao, (stone[1] + (moss[1] - stone[1]) * m) * ao, (stone[2] + (moss[2] - stone[2]) * m) * ao];
      b.vertex(v, n, uvs[0] / 2.2, uvs[1] / 2.2, c, VL.stone, 0);
    }
    const s = b.pos.length / 3 - 3;
    b.idx.push(s, s + 1, s + 2);
  }
  g.dispose();
  return b.build();
}

function fallenLog(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const b = new Builder(1);
  const len = 3 + r() * 3;
  const rad = 0.2 + r() * 0.15;
  const pts = wanderPath(r, V3(-len / 2, rad * 0.6, 0), V3(1, 0, 0), len, 6, 0.08, V3(0, 0, 0));
  const bark = jit(T(0.9, 0.85, 0.8), r, 0.1);
  const moss = T(0.75, 0.95, 0.5);
  b.tube(pts, pts.map((_, i) => rad * (1 - (i / pts.length) * 0.3)), 8, VL.bark, (_t, a) => {
    const m = Math.max(0, Math.sin(a)) * 0.7;
    return [bark[0] + (moss[0] - bark[0]) * m, bark[1] + (moss[1] - bark[1]) * m, bark[2] + (moss[2] - bark[2]) * m];
  }, 1.4);
  b.wind.fill(0);
  return b.build();
}

// ------------------------------------------------------------------ registry

export type DecorKind = 'tuft' | 'pebble' | 'log' | 'smallFern' | 'treeFern';

const VARIANTS = 3;

const GENERATORS: Record<VegetationKind, (seed: number, lod: number) => THREE.BufferGeometry> = {
  conifer,
  broadleaf,
  palm,
  cycad,
  fern: (s, l) => fern(s, l),
  bush,
  deadTree,
  rock: (s, l) => rock(s, l, 0.8),
  boulder: (s, l) => rock(s, l, 2.6, 0.75),
  reeds,
  grass: (s, l) => grass(s, l),
};

const DECOR: Record<DecorKind, (seed: number, lod: number) => THREE.BufferGeometry> = {
  tuft: (s, l) => grass(s + 50, l, 0.75, 16, 0.4),
  pebble: (s, l) => rock(s + 70, l + 1, 0.18, 0.5),
  log: (s) => fallenLog(s),
  smallFern: (s, l) => fern(s + 90, l, 0.55),
  treeFern: (s, l) => treeFern(s, l),
};

const cache = new Map<string, THREE.BufferGeometry>();

/** Shared geometry for a vegetation kind, variant and level of detail (0 near, 1 far). */
export function plantGeometry(kind: VegetationKind, variant: number, lod: number): THREE.BufferGeometry {
  const key = `${kind}:${variant}:${lod}`;
  let g = cache.get(key);
  if (!g) {
    g = GENERATORS[kind](variant * 7919 + kind.length * 104729 + 1, lod);
    cache.set(key, g);
  }
  return g;
}

export function decorGeometry(kind: DecorKind, variant: number, lod = 0): THREE.BufferGeometry {
  const key = `decor:${kind}:${variant}:${lod}`;
  let g = cache.get(key);
  if (!g) {
    g = DECOR[kind](variant * 7919 + kind.length * 31337 + 3, lod);
    cache.set(key, g);
  }
  return g;
}

export const PLANT_VARIANTS = VARIANTS;

/**
 * Generates the shared plant models ahead of time (called during the loading
 * screen within a time budget), so the first sight of a species never stalls a frame.
 * Returns true when everything is ready.
 */
export function prewarmPlants(budgetMs: number): boolean {
  const t0 = performance.now();
  const kinds = Object.keys(GENERATORS) as VegetationKind[];
  for (const k of kinds)
    for (let v = 0; v < VARIANTS; v++)
      for (const lod of [0, 1]) {
        if (!cache.has(`${k}:${v}:${lod}`)) {
          plantGeometry(k, v, lod);
          if (performance.now() - t0 > budgetMs) return false;
        }
      }
  for (const d of Object.keys(DECOR) as DecorKind[])
    for (let v = 0; v < VARIANTS; v++)
      if (!cache.has(`decor:${d}:${v}:0`)) {
        decorGeometry(d, v);
        if (performance.now() - t0 > budgetMs) return false;
      }
  return true;
}
