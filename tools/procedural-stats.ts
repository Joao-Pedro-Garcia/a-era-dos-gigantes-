// Prints the statistics of the procedural terrain layers that tools/photo-textures.py
// matches the photos to. Usage: node tools/procedural-stats.ts > procstats.json
import { TERRAIN_GENERATORS } from '../src/graphics/texgen.ts';

const N = 256;
const lin = (v: number) => Math.pow(v / 255, 2.2);
/** Wrapping box blur (two passes approximate a Gaussian well enough for a statistic). */
function blur(a: Float64Array, r: number): Float64Array {
  let src = a;
  for (let pass = 0; pass < 2; pass++) {
    const tmp = new Float64Array(N * N);
    const out = new Float64Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let k = -r; k <= r; k++) s += src[y * N + ((x + k + N) % N)]; tmp[y * N + x] = s / (2 * r + 1); }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { let s = 0; for (let k = -r; k <= r; k++) s += tmp[((y + k + N) % N) * N + x]; out[y * N + x] = s / (2 * r + 1); }
    src = out;
  }
  return src;
}
const out: Record<string, unknown> = {};
for (const [k, g] of Object.entries(TERRAIN_GENERATORS)) {
  const im = g(N);
  const n = N * N;
  const rgb = [0, 0, 0];
  let h = 0, hh = 0, rough = 0, nstr = 0;
  const lum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = [lin(im.albedo[i * 4]), lin(im.albedo[i * 4 + 1]), lin(im.albedo[i * 4 + 2])];
    for (let j = 0; j < 3; j++) rgb[j] += c[j];
    lum[i] = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    const a = im.albedo[i * 4 + 3] / 255;
    h += a;
    hh += a * a;
    rough += im.normal[i * 4 + 3] / 255;
    nstr += Math.hypot(im.normal[i * 4] / 127.5 - 1, im.normal[i * 4 + 1] / 127.5 - 1);
  }
  const low = blur(lum, 4);
  let d = 0;
  for (let i = 0; i < n; i++) d += (lum[i] - low[i]) ** 2;
  const mh = h / n;
  out[k] = { rgb: rgb.map((v) => v / n), h: mh, hstd: Math.sqrt(hh / n - mh * mh), rough: rough / n, detail: Math.sqrt(d / n), nstr: nstr / n };
}
console.log(JSON.stringify(out, null, 1));
