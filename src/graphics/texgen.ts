/**
 * Procedural, tileable PBR texture generation (pure functions, no DOM/WebGL).
 *
 * Every generator returns two RGBA8 images of size N×N:
 *  - `albedo`: sRGB colour in rgb, a height value (0–255) in alpha that the
 *    terrain shader uses for height-based layer blending (or coverage alpha
 *    for cut-out textures such as leaves and hair);
 *  - `normal`: tangent-space normal in rgb (OpenGL convention, +y = +v) and
 *    roughness in alpha.
 * All noise is periodic on the texture size, so the images tile seamlessly.
 * Because there are no external image files, these are the game's real
 * material sources; they run in a worker for the full-resolution pass.
 */

export interface TexImage {
  size: number;
  albedo: Uint8Array;
  normal: Uint8Array;
}

// ------------------------------------------------------------------ noise

function hash3(x: number, y: number, s: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a: number, p: number) => ((a % p) + p) % p;

/** Periodic value noise, smooth (quintic) interpolation, period in lattice cells. */
export function vnoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const x0 = mod(ix, period);
  const y0 = mod(iy, period);
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash3(x0, y0, seed);
  const b = hash3(x1, y0, seed);
  const c = hash3(x0, y1, seed);
  const d = hash3(x1, y1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Tileable fBm on u,v ∈ [0,1): `base` lattice cells at the first octave. Range ≈ 0..1. */
export function fbm(u: number, v: number, base: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let p = base;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u * p, v * p, p, seed + o * 101) * amp;
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}

export interface Cell {
  f1: number;
  f2: number;
  id: number;
  /** Offset from the pixel to the nearest feature point, in cell units. */
  dx: number;
  dy: number;
}

/** Tileable Worley noise (F1, F2 and the id of the nearest cell). */
export function worley(u: number, v: number, period: number, seed: number, jitter = 0.9, out: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 }): Cell {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  let bdx = 0;
  let bdy = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = ix + i;
      const cy = iy + j;
      const wx = mod(cx, period);
      const wy = mod(cy, period);
      const px = cx + 0.5 + (hash3(wx, wy, seed) - 0.5) * jitter;
      const py = cy + 0.5 + (hash3(wx, wy, seed + 7) - 0.5) * jitter;
      const dx = px - x;
      const dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash3(wx, wy, seed + 13);
        bdx = dx;
        bdy = dy;
      } else if (d < f2) f2 = d;
    }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  out.dx = bdx;
  out.dy = bdy;
  return out;
}

// ------------------------------------------------------------------ buffers

/** Float working buffers for one texture. */
class Canvas {
  readonly n: number;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly h: Float32Array;
  readonly rough: Float32Array;
  readonly a: Float32Array;
  constructor(n: number) {
    this.n = n;
    const c = n * n;
    this.r = new Float32Array(c);
    this.g = new Float32Array(c);
    this.b = new Float32Array(c);
    this.h = new Float32Array(c);
    this.rough = new Float32Array(c).fill(0.9);
    this.a = new Float32Array(c).fill(1);
  }
  each(fn: (u: number, v: number, i: number) => void): void {
    const n = this.n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) fn((x + 0.5) / n, (y + 0.5) / n, y * n + x);
  }
  set(i: number, r: number, g: number, b: number): void {
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
  }
  /**
   * Draws a soft-edged stroke (capsule) from (u0,v0) to (u1,v1) with wrap-around.
   * `paint` receives the pixel index and the coverage/along-stroke position.
   */
  stroke(u0: number, v0: number, u1: number, v1: number, width: number, paint: (i: number, cover: number, t: number) => void): void {
    const n = this.n;
    const x0 = u0 * n;
    const y0 = v0 * n;
    const x1 = u1 * n;
    const y1 = v1 * n;
    const w = width * n;
    const minx = Math.floor(Math.min(x0, x1) - w - 1);
    const maxx = Math.ceil(Math.max(x0, x1) + w + 1);
    const miny = Math.floor(Math.min(y0, y1) - w - 1);
    const maxy = Math.ceil(Math.max(y0, y1) + w + 1);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len2 = dx * dx + dy * dy || 1;
    for (let y = miny; y <= maxy; y++)
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2));
        const ex = px - (x0 + dx * t);
        const ey = py - (y0 + dy * t);
        const d = Math.sqrt(ex * ex + ey * ey);
        const ww = w * (1 - t * 0.85); // tapers toward the tip
        if (d > ww + 0.5) continue;
        const cover = Math.max(0, Math.min(1, ww + 0.5 - d));
        paint(mod(y, n) * n + mod(x, n), cover, t);
      }
  }
  /** Filled ellipse with a profile callback (r = 0 at centre, 1 at the rim). */
  ellipse(cu: number, cv: number, ru: number, rv: number, rot: number, paint: (i: number, r: number, lu: number, lv: number) => void): void {
    const n = this.n;
    const R = Math.max(ru, rv) * n + 1;
    const cx = cu * n;
    const cy = cv * n;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++)
      for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
        const dx = (x + 0.5 - cx) / n;
        const dy = (y + 0.5 - cy) / n;
        const lu = (dx * c + dy * s) / ru;
        const lv = (-dx * s + dy * c) / rv;
        const r = Math.sqrt(lu * lu + lv * lv);
        if (r > 1) continue;
        paint(mod(y, n) * n + mod(x, n), r, lu, lv);
      }
  }

  /** Packs into RGBA8 images; normals derived from the height field. */
  finish(normalStrength: number, alphaIsCoverage = false): TexImage {
    const n = this.n;
    const albedo = new Uint8Array(n * n * 4);
    const normal = new Uint8Array(n * n * 4);
    const to8 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    // Strength is expressed per texel at 512 px so different sizes look alike.
    const k = normalStrength * (n / 512);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const hl = this.h[y * n + mod(x - 1, n)];
        const hr = this.h[y * n + mod(x + 1, n)];
        const hd = this.h[mod(y - 1, n) * n + x];
        const hu = this.h[mod(y + 1, n) * n + x];
        let nx = (hl - hr) * k;
        let ny = (hd - hu) * k;
        let nz = 1;
        const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= l;
        ny /= l;
        nz /= l;
        const o = i * 4;
        albedo[o] = to8(linearToSrgb(this.r[i]));
        albedo[o + 1] = to8(linearToSrgb(this.g[i]));
        albedo[o + 2] = to8(linearToSrgb(this.b[i]));
        albedo[o + 3] = to8(alphaIsCoverage ? this.a[i] : this.h[i]);
        normal[o] = to8(nx * 0.5 + 0.5);
        normal[o + 1] = to8(ny * 0.5 + 0.5);
        normal[o + 2] = to8(nz * 0.5 + 0.5);
        normal[o + 3] = to8(this.rough[i]);
      }
    return { size: n, albedo, normal };
  }
}

function linearToSrgb(c: number): number {
  c = Math.max(0, c);
  return c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** sRGB hex → linear components (generators work in linear space). */
function lin(hex: number): [number, number, number] {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return [f((hex >> 16) & 255), f((hex >> 8) & 255), f(hex & 255)];
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Deterministic PRNG for scattering strokes. */
function prng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function mixCol(c: Canvas, i: number, col: [number, number, number], t: number): void {
  c.r[i] = mix(c.r[i], col[0], t);
  c.g[i] = mix(c.g[i], col[1], t);
  c.b[i] = mix(c.b[i], col[2], t);
}

// ------------------------------------------------------------------ terrain layers

export const TERRAIN_LAYERS = ['grass', 'dirt', 'rock', 'sand', 'snow', 'litter', 'mud'] as const;
export type TerrainLayer = (typeof TERRAIN_LAYERS)[number];

function soilBase(c: Canvas, seed: number, dark: [number, number, number], light: [number, number, number]): void {
  c.each((u, v, i) => {
    const n = fbm(u, v, 6, 5, seed);
    const f = fbm(u, v, 48, 2, seed + 3);
    const t = n * 0.8 + f * 0.2;
    c.set(i, mix(dark[0], light[0], t), mix(dark[1], light[1], t), mix(dark[2], light[2], t));
    c.h[i] = n * 0.35 + f * 0.15;
    c.rough[i] = 0.92 - f * 0.08;
  });
}

function grass(n: number): TexImage {
  const c = new Canvas(n);
  soilBase(c, 11, lin(0x2a2414), lin(0x4a3e26));
  const rnd = prng(77);
  const blades = Math.round(n * n * 0.045);
  const greens = [lin(0x3d5a1e), lin(0x56702a), lin(0x6e7f34), lin(0x4a6524), lin(0x7d8a40), lin(0x8f8a48)];
  for (let k = 0; k < blades; k++) {
    const u = rnd();
    const v = rnd();
    // Patches: tone varies with a low-frequency field so the ground is not uniform.
    const patch = fbm(u, v, 4, 3, 5);
    const col = greens[Math.min(greens.length - 1, Math.floor((rnd() * 0.6 + patch * 0.7) * greens.length))];
    const len = (0.012 + rnd() * 0.022) * (0.6 + patch * 0.8);
    const ang = rnd() * Math.PI * 2;
    const bright = 0.7 + rnd() * 0.5;
    c.stroke(u, v, u + Math.cos(ang) * len, v + Math.sin(ang) * len, 0.0028 + rnd() * 0.0016, (i, cover, t) => {
      const shade = bright * (0.65 + t * 0.55);
      mixCol(c, i, [col[0] * shade, col[1] * shade, col[2] * shade], cover * 0.95);
      c.h[i] = Math.max(c.h[i], 0.45 + t * 0.5 * cover);
      c.rough[i] = mix(c.rough[i], 0.78, cover);
    });
  }
  return c.finish(5);
}

function dirt(n: number): TexImage {
  const c = new Canvas(n);
  soilBase(c, 21, lin(0x3b2c1c), lin(0x6e5638));
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  c.each((u, v, i) => {
    // Pebbles.
    worley(u, v, 22, 9, 0.9, cell);
    const size = 0.14 + cell.id * 0.18;
    if (cell.id > 0.62 && cell.f1 < size) {
      const t = 1 - cell.f1 / size;
      const g = 0.05 + cell.id * 0.06;
      mixCol(c, i, [g * 1.05, g, g * 0.9], smooth(0, 0.25, t));
      c.h[i] = Math.max(c.h[i], 0.45 + Math.sqrt(t) * 0.45);
      c.rough[i] = mix(c.rough[i], 0.7, t);
    }
    // Fine cracks of dry soil.
    worley(u, v, 9, 31, 0.95, cell);
    const crack = 1 - smooth(0, 0.06, cell.f2 - cell.f1);
    if (crack > 0) {
      c.r[i] *= 1 - crack * 0.45;
      c.g[i] *= 1 - crack * 0.45;
      c.b[i] *= 1 - crack * 0.45;
      c.h[i] -= crack * 0.2;
    }
  });
  return c.finish(6);
}

function rock(n: number): TexImage {
  const c = new Canvas(n);
  const dark = lin(0x4a463f);
  const light = lin(0x8a847a);
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  c.each((u, v, i) => {
    const warp = fbm(u, v, 3, 4, 41) * 2.5;
    const strata = Math.sin((v + warp * 0.18) * Math.PI * 2 * 7) * 0.5 + 0.5;
    const n1 = fbm(u, v, 8, 6, 43);
    const t = n1 * 0.7 + strata * 0.3;
    c.set(i, mix(dark[0], light[0], t), mix(dark[1], light[1], t), mix(dark[2], light[2], t));
    c.h[i] = n1 * 0.6 + strata * 0.25;
    worley(u, v, 6, 47, 0.95, cell);
    const crack = 1 - smooth(0, 0.05, cell.f2 - cell.f1);
    c.h[i] -= crack * 0.5;
    const d = 1 - crack * 0.55;
    c.r[i] *= d;
    c.g[i] *= d;
    c.b[i] *= d;
    // Lichen and mineral stains.
    const lichen = smooth(0.66, 0.74, fbm(u, v, 10, 4, 49));
    if (lichen > 0) mixCol(c, i, lin(0x7a7c4a), lichen * 0.35);
    const stain = smooth(0.55, 0.8, fbm(u, v, 4, 3, 53));
    if (stain > 0) mixCol(c, i, lin(0x6a4a32), stain * 0.25);
    c.rough[i] = 0.72 + n1 * 0.18 - lichen * 0.05;
  });
  return c.finish(9);
}

function sand(n: number): TexImage {
  const c = new Canvas(n);
  const dark = lin(0x7e6c4e);
  const light = lin(0xb4a27a);
  c.each((u, v, i) => {
    const w = fbm(u, v, 3, 3, 61);
    const ripple = Math.sin((v * 14 + w * 3 + u * 2) * Math.PI * 2) * 0.5 + 0.5;
    const grain = vnoise(u * n * 0.5, v * n * 0.5, n * 0.5, 63);
    const t = fbm(u, v, 5, 4, 67) * 0.6 + grain * 0.25 + ripple * 0.15;
    c.set(i, mix(dark[0], light[0], t), mix(dark[1], light[1], t), mix(dark[2], light[2], t));
    c.h[i] = ripple * 0.35 + grain * 0.15 + w * 0.2;
    c.rough[i] = 0.93 + grain * 0.05;
  });
  return c.finish(3);
}

function snow(n: number): TexImage {
  const c = new Canvas(n);
  c.each((u, v, i) => {
    const s = fbm(u, v, 5, 5, 71);
    const g = vnoise(u * n * 0.5, v * n * 0.5, n * 0.5, 73);
    const b = 0.78 + s * 0.15;
    c.set(i, b * 0.93, b * 0.96, b);
    c.h[i] = s * 0.6 + g * 0.08;
    // Glints: occasional very smooth crystals.
    c.rough[i] = g > 0.97 ? 0.2 : 0.62 + s * 0.12;
  });
  return c.finish(3);
}

function litter(n: number): TexImage {
  const c = new Canvas(n);
  soilBase(c, 81, lin(0x22180e), lin(0x3e2c1a));
  const rnd = prng(83);
  const leafCols = [lin(0x6e4a22), lin(0x8a5a26), lin(0x5a4020), lin(0x7a6a30), lin(0x4a3a1c), lin(0x9a6a2e), lin(0x5e5a2a)];
  const leaves = Math.round(n * n * 0.0022);
  for (let k = 0; k < leaves; k++) {
    const cu = rnd();
    const cv = rnd();
    const ru = 0.012 + rnd() * 0.018;
    const rv = ru * (0.35 + rnd() * 0.25);
    const rot = rnd() * Math.PI;
    const col = leafCols[Math.floor(rnd() * leafCols.length)];
    const lift = 0.4 + (k / leaves) * 0.5; // later leaves lie on top
    c.ellipse(cu, cv, ru, rv, rot, (i, r, lu, lv) => {
      const vein = Math.abs(lv) < 0.08 ? 0.75 : 1;
      const edge = 1 - smooth(0.85, 1, r);
      const curl = (1 - r * r) * 0.12;
      mixCol(c, i, [col[0] * vein, col[1] * vein, col[2] * vein], edge);
      c.h[i] = Math.max(c.h[i], lift + curl - Math.abs(lu) * 0.02);
      c.rough[i] = mix(c.rough[i], 0.75, edge);
    });
  }
  // Twigs.
  for (let k = 0; k < Math.round(n * 0.12); k++) {
    const u = rnd();
    const v = rnd();
    const a = rnd() * Math.PI * 2;
    const l = 0.03 + rnd() * 0.06;
    c.stroke(u, v, u + Math.cos(a) * l, v + Math.sin(a) * l, 0.003, (i, cover) => {
      mixCol(c, i, lin(0x3a2a1a), cover);
      c.h[i] = Math.max(c.h[i], 0.95 * cover);
    });
  }
  return c.finish(6);
}

function mud(n: number): TexImage {
  const c = new Canvas(n);
  soilBase(c, 91, lin(0x231a10), lin(0x433322));
  c.each((u, v, i) => {
    const wet = smooth(0.5, 0.62, fbm(u, v, 4, 4, 93));
    c.r[i] *= 1 - wet * 0.35;
    c.g[i] *= 1 - wet * 0.33;
    c.b[i] *= 1 - wet * 0.3;
    c.h[i] = c.h[i] * (1 - wet) + 0.08 * wet;
    c.rough[i] = mix(0.8, 0.22, wet);
  });
  return c.finish(4);
}

export const TERRAIN_GENERATORS: Record<TerrainLayer, (n: number) => TexImage> = { grass, dirt, rock, sand, snow, litter, mud };

// ------------------------------------------------------------------ material textures

/** Bark: vertical furrows and plates (greyish so per-species vertex tints show). */
export function bark(n: number, kind: 'furrowed' | 'ringed' = 'furrowed'): TexImage {
  const c = new Canvas(n);
  const dark = lin(0x3e342a);
  const light = lin(0xa89a88);
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  c.each((u, v, i) => {
    let t: number;
    if (kind === 'furrowed') {
      // Stretched noise along v gives long ridges; Worley adds plates.
      const warp = fbm(u, v, 4, 3, 101) * 0.3;
      const ridges = fbm(u + warp, v * 0.25, 16, 4, 103);
      const furrow = Math.pow(Math.abs(Math.sin((u * 14 + warp * 3 + fbm(u, v * 0.2, 6, 2, 105) * 1.5) * Math.PI)), 0.6);
      worley(u, v * 0.3, 14, 107, 0.9, cell);
      const plate = smooth(0, 0.12, cell.f2 - cell.f1);
      t = ridges * 0.45 + furrow * 0.4 + plate * 0.15;
      c.h[i] = t;
    } else {
      // Palm/cycad trunks: leaf-scar rings.
      const ring = Math.abs(Math.sin((v * 10 + fbm(u, v, 6, 2, 109) * 0.6) * Math.PI));
      const fib = fbm(u, v, 24, 3, 111);
      t = ring * 0.6 + fib * 0.4;
      c.h[i] = ring * 0.7 + fib * 0.3;
    }
    c.set(i, mix(dark[0], light[0], t), mix(dark[1], light[1], t), mix(dark[2], light[2], t));
    const moss = smooth(0.6, 0.72, fbm(u, v, 5, 4, 113)) * (1 - t);
    if (moss > 0) mixCol(c, i, lin(0x4a5a26), moss * 0.6);
    c.rough[i] = 0.85 + (1 - t) * 0.12;
  });
  // Moderate relief: strong normals on thin trunks turn most of the surface away from the light.
  return c.finish(kind === 'ringed' ? 3 : 6);
}

/** Leaf atlas 2×2 with coverage alpha: broad leaves, needles, fern frond, palm leaflets. */
export function leafAtlas(n: number): TexImage {
  const c = new Canvas(n);
  c.a.fill(0);
  c.h.fill(0);
  c.r.fill(0.05);
  c.g.fill(0.08);
  c.b.fill(0.02);
  const rnd = prng(131);
  const half = 0.5;
  const leafCol = (base: number) => {
    const col = lin(base);
    const k = 0.75 + rnd() * 0.5;
    return [col[0] * k, col[1] * k, col[2] * k] as [number, number, number];
  };
  const leaf = (cu: number, cv: number, ru: number, rv: number, rot: number, col: [number, number, number], clipU: number, clipV: number) => {
    c.ellipse(cu, cv, ru, rv, rot, (i, r, lu, lv) => {
      // Keep each leaf inside its atlas cell (avoid bleeding into neighbours).
      const x = (i % n) / n;
      const y = Math.floor(i / n) / n;
      if (x < clipU + 0.01 || x > clipU + half - 0.01 || y < clipV + 0.01 || y > clipV + half - 0.01) return;
      // Pointed tip: shrink the ellipse toward one end.
      if (Math.abs(lv) > (1 - Math.max(0, lu) ** 2) * 1.0) return;
      const vein = Math.abs(lv) < 0.07 ? 0.78 : 1;
      const side = 0.85 + lv * 0.15;
      mixCol(c, i, [col[0] * vein * side, col[1] * vein * side, col[2] * vein * side], 1);
      c.a[i] = 1;
      c.h[i] = 0.6 + (1 - r) * 0.3 - (Math.abs(lv) < 0.07 ? 0.15 : 0);
      c.rough[i] = 0.55 + r * 0.2;
    });
  };
  // Cell (0,0): broad leaf cluster (angiosperms / ginkgo-like).
  for (let k = 0; k < 26; k++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * 0.17;
    const cu = 0.25 + Math.cos(a) * d;
    const cv = 0.25 + Math.sin(a) * d;
    leaf(cu, cv, 0.055 + rnd() * 0.03, 0.022 + rnd() * 0.01, a + (rnd() - 0.5), leafCol([0x3d5a22, 0x4a6a2a, 0x557530, 0x35501e][k % 4]), 0, 0);
  }
  // Cell (1,0): conifer / araucaria sprays (needles along twigs).
  for (let s = 0; s < 7; s++) {
    const cu0 = 0.53 + rnd() * 0.08;
    const cv0 = 0.05 + s * 0.06 + rnd() * 0.02;
    const ang = -0.3 + rnd() * 0.6;
    const len = 0.32 + rnd() * 0.08;
    const col = leafCol(0x2c4420);
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      const bu = cu0 + Math.cos(ang) * len * t;
      const bv = cv0 + Math.sin(ang) * len * t + 0.02;
      for (const side of [-1, 1]) {
        const na = ang + side * (0.9 + rnd() * 0.3);
        const nl = 0.025 * (1 - t * 0.5);
        c.stroke(bu, bv, bu + Math.cos(na) * nl, bv + Math.sin(na) * nl, 0.0035, (i, cover) => {
          const x = (i % n) / n;
          const y = Math.floor(i / n) / n;
          if (x < 0.51 || x > 0.99 || y > 0.49) return;
          mixCol(c, i, col, cover);
          c.a[i] = Math.max(c.a[i], cover);
          c.h[i] = Math.max(c.h[i], 0.6 * cover);
          c.rough[i] = 0.6;
        });
      }
    }
  }
  // Cell (0,1): fern frond (rachis + pinnae), pointing up the cell.
  {
    c.stroke(0.25, 0.98, 0.25, 0.53, 0.004, (i, cover) => {
      mixCol(c, i, lin(0x3a5a1e), cover);
      c.a[i] = Math.max(c.a[i], cover);
      c.h[i] = 0.8;
    });
    for (let k = 0; k < 22; k++) {
      const t = k / 22;
      const v = 0.95 - t * 0.4;
      const len = 0.2 * Math.sin(Math.PI * (0.15 + t * 0.85)) * (1 - t * 0.3);
      for (const side of [-1, 1]) {
        const pc = leafCol(0x4a7a2a);
        for (let q = 0; q < 6; q++) {
          const tt = (q + 0.5) / 6;
          leaf(0.25 + side * len * tt, v - len * tt * 0.25, 0.012 * (1 - tt * 0.4), 0.006, side > 0 ? 1.4 : 1.75, pc, 0, 0.5);
        }
      }
    }
  }
  // Cell (1,1): palm/cycad leaflets, long and narrow, side by side.
  for (let k = 0; k < 9; k++) {
    const u = 0.53 + k * 0.05;
    const col = leafCol(0x4a6a28);
    c.stroke(u, 0.98, u + (rnd() - 0.5) * 0.02, 0.53, 0.012, (i, cover, t) => {
      const x = (i % n) / n;
      if (x < 0.51) return;
      const vein = Math.abs(((i % n) / n - u)) < 0.002 ? 0.8 : 1;
      mixCol(c, i, [col[0] * vein * (0.85 + t * 0.2), col[1] * vein, col[2] * vein], cover);
      c.a[i] = Math.max(c.a[i], cover);
      c.h[i] = 0.5 + cover * 0.3;
      c.rough[i] = 0.5;
    });
  }
  return c.finish(4, true);
}

/** Reptile skin: tiled scales with darker creases and scattered tubercles (greyscale, tinted per species). */
export function scales(n: number, period = 40): TexImage {
  const c = new Canvas(n);
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const big: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  c.each((u, v, i) => {
    worley(u, v, period, 151, 0.85, cell);
    const edge = cell.f2 - cell.f1;
    const dome = smooth(0, 0.35, edge);
    worley(u, v, Math.round(period / 4), 157, 0.8, big);
    const tub = big.id > 0.7 ? smooth(0.45, 0.1, big.f1) : 0;
    const tone = 0.62 + cell.id * 0.18 + fbm(u, v, 4, 3, 159) * 0.12;
    const crease = 1 - smooth(0, 0.08, edge);
    const b = tone * (1 - crease * 0.4) * (1 + tub * 0.1);
    c.set(i, b, b * 0.98, b * 0.94);
    c.h[i] = dome * 0.6 + tub * 0.6;
    c.rough[i] = 0.62 + crease * 0.25 - dome * 0.1;
  });
  return c.finish(10);
}

/**
 * Large reptile scutes (feature scales): big polygonal, non-overlapping scales,
 * many with a low conical tubercle in the centre, set among a fine mosaic of
 * small pebbly scales in the creases (after ceratopsian and hadrosaur skin
 * impressions). Greyscale, tinted per species; blended with `scales` per region.
 */
export function scutes(n: number, period = 10): TexImage {
  const c = new Canvas(n);
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const fine: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  c.each((u, v, i) => {
    worley(u, v, period, 211, 0.75, cell);
    worley(u, v, period * 7, 223, 0.9, fine);
    const edge = cell.f2 - cell.f1;
    // Flat-topped plate with rounded shoulders; a groove of small scales between plates.
    const plate = smooth(0.02, 0.2, edge);
    const tuber = cell.id > 0.35 ? smooth(0.42, 0.0, cell.f1) * (0.4 + cell.id * 0.6) : 0;
    const pebble = smooth(0, 0.3, fine.f2 - fine.f1) * (1 - plate);
    const tone = 0.6 + cell.id * 0.14 + fbm(u, v, 6, 3, 227) * 0.14;
    const groove = 1 - plate;
    const b = tone * (1 - groove * 0.35) * (1 + tuber * 0.08);
    c.set(i, b, b * 0.97, b * 0.92);
    c.h[i] = plate * 0.55 + tuber * 0.75 + pebble * 0.18;
    // Worn tubercle tips and plate tops are a little smoother than the creases.
    c.rough[i] = 0.8 + groove * 0.12 - tuber * 0.12;
  });
  return c.finish(12);
}

/** Feathered integument: overlapping vane streaks. */
export function feathers(n: number): TexImage {
  const c = new Canvas(n);
  c.each((u, v, i) => {
    const row = v * 16;
    const ri = Math.floor(row);
    const off = (ri % 2) * 0.5;
    const fu = u * 10 + off;
    const fi = Math.floor(fu);
    const lu = fu - fi - 0.5;
    const lv = row - ri;
    const barbs = Math.sin((lu * 6 + lv * 3) * Math.PI * 4) * 0.5 + 0.5;
    const shape = 1 - smooth(0.3, 0.5, Math.abs(lu) + lv * 0.25);
    const tone = 0.6 + hash3(mod(fi, 10), mod(ri, 16), 171) * 0.25 + barbs * 0.08;
    c.set(i, tone, tone * 0.97, tone * 0.92);
    c.h[i] = shape * 0.6 * (1 - lv) + barbs * 0.1;
    c.rough[i] = 0.82;
  });
  return c.finish(6);
}

/**
 * Mammal coat: dense, fine hair strands lying along the body (v runs along the
 * body), gathered into slightly darker locks, with a soft, matte sheen.
 */
export function fur(n: number): TexImage {
  const c = new Canvas(n);
  // Stretched value noise that still tiles: separate whole-number periods across (u)
  // and along (v) the hair.
  const aniso = (u: number, v: number, pu: number, pv: number, octaves: number, seed: number) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const k = 1 << o;
      const x = u * pu * k;
      const y = v * pv * k;
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      const fx = x - ix;
      const fy = y - iy;
      const ux = fx * fx * (3 - 2 * fx);
      const uy = fy * fy * (3 - 2 * fy);
      const x0 = mod(ix, pu * k);
      const y0 = mod(iy, pv * k);
      const x1 = (x0 + 1) % (pu * k);
      const y1 = (y0 + 1) % (pv * k);
      const sd = seed + o * 101;
      const a = hash3(x0, y0, sd);
      const b = hash3(x1, y0, sd);
      const cc = hash3(x0, y1, sd);
      const d = hash3(x1, y1, sd);
      sum += (a + (b - a) * ux + (cc - a) * uy + (a - b - cc + d) * ux * uy) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
  c.each((u, v, i) => {
    const strands = aniso(u, v, 96, 6, 3, 251);
    const locks = aniso(u, v, 10, 4, 3, 253);
    const tips = aniso(u, v, 24, 12, 2, 257);
    const t = strands * 0.6 + locks * 0.4;
    const tone = 0.62 + t * 0.32 + (tips - 0.5) * 0.08;
    c.set(i, tone, tone * 0.98, tone * 0.95);
    c.h[i] = strands * 0.7 + locks * 0.3;
    c.rough[i] = 0.9 - strands * 0.08;
  });
  return c.finish(4);
}

/** Human skin: very subtle pores and tone variation. */
export function skin(n: number): TexImage {
  const c = new Canvas(n);
  c.each((u, v, i) => {
    const pores = vnoise(u * n * 0.35, v * n * 0.35, Math.round(n * 0.35), 181);
    const tone = 0.92 + fbm(u, v, 6, 4, 183) * 0.08;
    c.set(i, tone, tone, tone);
    c.h[i] = pores * 0.15 + fbm(u, v, 16, 3, 187) * 0.1;
    c.rough[i] = 0.55 + pores * 0.15;
  });
  return c.finish(2);
}

/** Coarse woven plant fibre cloth, with a seam band. */
export function cloth(n: number): TexImage {
  const c = new Canvas(n);
  const P = 96;
  c.each((u, v, i) => {
    const wu = Math.sin(u * P * Math.PI * 2);
    const wv = Math.sin(v * P * Math.PI * 2);
    const over = (Math.floor(u * P) + Math.floor(v * P)) % 2 === 0;
    const thread = over ? Math.abs(wv) : Math.abs(wu);
    const fibre = fbm(u, v, 48, 2, 191);
    const dirt = fbm(u, v, 4, 4, 193);
    const tone = 0.8 + thread * 0.05 + fibre * 0.08 - dirt * 0.18;
    c.set(i, tone, tone * 0.97, tone * 0.9);
    c.h[i] = thread * 0.3 + fibre * 0.2 + dirt * 0.3;
    // Seam: a stitched band along v = 0.5.
    const sd = Math.abs(v - 0.5);
    if (sd < 0.012) {
      const stitch = Math.sin(u * 80 * Math.PI) > 0.2 ? 1 : 0;
      c.h[i] = 0.2 + stitch * 0.7;
      const t = stitch ? 0.6 : 0.5;
      c.set(i, t, t * 0.9, t * 0.75);
    }
    c.rough[i] = 0.92;
  });
  return c.finish(2.5);
}

/** Tanned hide/leather: wrinkles and pores. */
export function leather(n: number): TexImage {
  const c = new Canvas(n);
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  c.each((u, v, i) => {
    worley(u, v, 18, 201, 0.9, cell);
    const wrinkle = smooth(0, 0.12, cell.f2 - cell.f1);
    const n1 = fbm(u, v, 6, 5, 203);
    const tone = 0.7 + n1 * 0.2 + wrinkle * 0.06;
    c.set(i, tone, tone * 0.95, tone * 0.88);
    c.h[i] = wrinkle * 0.4 + n1 * 0.3;
    c.rough[i] = 0.6 + (1 - wrinkle) * 0.2;
  });
  return c.finish(5);
}

/** Hair strands (alpha coverage at the edges of locks). */
export function hair(n: number): TexImage {
  const c = new Canvas(n);
  c.each((u, v, i) => {
    const strands = fbm(u * 1, v * 0.06, 64, 3, 211);
    const locks = fbm(u, v * 0.2, 6, 3, 213);
    const t = strands * 0.7 + locks * 0.3;
    c.set(i, 0.6 + t * 0.4, 0.6 + t * 0.4, 0.6 + t * 0.4);
    c.h[i] = t;
    c.a[i] = smooth(0.25, 0.45, t + (1 - v) * 0.3);
    c.rough[i] = 0.45 + (1 - t) * 0.2;
  });
  return c.finish(6, true);
}

/** Split wood planks with grain (building pieces). */
export function planks(n: number): TexImage {
  const c = new Canvas(n);
  const dark = lin(0x3a2818);
  const light = lin(0x8a6a48);
  c.each((u, v, i) => {
    const board = Math.floor(u * 4);
    const bu = u * 4 - board;
    const grain = fbm(u * 4 + board * 0.37, v * 0.5, 2, 3, 221 + board);
    const lines = Math.sin((bu * 3 + grain * 4 + v * 0.5) * Math.PI * 6) * 0.5 + 0.5;
    const knot = smooth(0.82, 0.9, fbm(u, v, 3, 2, 223 + board));
    const t = lines * 0.35 + grain * 0.5 - knot * 0.4;
    c.set(i, mix(dark[0], light[0], t), mix(dark[1], light[1], t), mix(dark[2], light[2], t));
    const gap = smooth(0.02, 0, Math.min(bu, 1 - bu));
    c.h[i] = 0.6 + lines * 0.15 - gap * 0.6;
    if (gap > 0) {
      c.r[i] *= 1 - gap * 0.7;
      c.g[i] *= 1 - gap * 0.7;
      c.b[i] *= 1 - gap * 0.7;
    }
    c.rough[i] = 0.8 + lines * 0.1;
  });
  return c.finish(6);
}

/** Weathered concrete / masonry with stains (ruins). */
export function concrete(n: number): TexImage {
  const c = new Canvas(n);
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  c.each((u, v, i) => {
    const n1 = fbm(u, v, 8, 5, 231);
    const pits = vnoise(u * n * 0.25, v * n * 0.25, Math.round(n * 0.25), 233);
    const streak = fbm(u * 4, v * 0.3, 6, 3, 235);
    let t = 0.55 + n1 * 0.25 - smooth(0.5, 0.8, streak) * 0.2;
    worley(u, v, 5, 237, 0.95, cell);
    const crack = 1 - smooth(0, 0.025, cell.f2 - cell.f1);
    t *= 1 - crack * 0.5;
    c.set(i, t, t * 0.98, t * 0.93);
    const moss = smooth(0.62, 0.75, fbm(u, v, 4, 4, 239)) * (1 - v * 0.6);
    if (moss > 0) mixCol(c, i, lin(0x4a5528), moss * 0.7);
    c.h[i] = n1 * 0.5 + (pits > 0.9 ? -0.2 : 0) - crack * 0.4;
    c.rough[i] = 0.88;
  });
  return c.finish(5);
}

export const MATERIAL_GENERATORS = {
  bark: (n: number) => bark(n, 'furrowed'),
  barkRinged: (n: number) => bark(n, 'ringed'),
  leaves: leafAtlas,
  scales: (n: number) => scales(n, 40),
  scutes: (n: number) => scutes(n, 10),
  feathers,
  skin,
  cloth,
  leather,
  hair,
  fur,
  planks,
  concrete,
} as const;
export type MaterialTex = keyof typeof MATERIAL_GENERATORS;
