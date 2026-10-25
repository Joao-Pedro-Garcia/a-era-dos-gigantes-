import { MATERIAL_GENERATORS, TERRAIN_GENERATORS, type TexImage } from './texgen';

/**
 * Generates full-resolution procedural textures off the main thread. Each
 * texture is posted back as soon as it is ready (progressive refinement).
 * Layers listed in `photos` are built from photographic maps instead
 * (public/textures, CC0 from Poly Haven), decoded here so the main thread
 * never stalls; if a photo cannot be loaded the procedural one is used.
 */
export interface TexRequest {
  id: number;
  names: string[];
  size: number;
  photos?: { base: string; names: string[] };
}
export interface TexResponse {
  id: number;
  name: string;
  image: TexImage;
  ms: number;
  /** A photo was expected but could not be loaded (the image is procedural). */
  fallback?: boolean;
}

const gens: Record<string, (n: number) => TexImage> = { ...TERRAIN_GENERATORS, ...MATERIAL_GENERATORS };

async function pixels(url: string, size: number): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(size, size);
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, size, size);
  bmp.close();
  return ctx.getImageData(0, 0, size, size).data;
}

/** Packs the four photo maps into the generator layout (albedo+height, normal+roughness). */
async function photo(base: string, name: string, size: number): Promise<TexImage> {
  const dir = `${base}${size <= 512 ? 512 : 1024}/${name}`;
  const [col, h, nrm, r] = await Promise.all(['col', 'h', 'nrm', 'r'].map((k) => pixels(`${dir}_${k}.webp`, size)));
  const albedo = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size * 4; i += 4) {
    albedo[i] = col[i];
    albedo[i + 1] = col[i + 1];
    albedo[i + 2] = col[i + 2];
    albedo[i + 3] = h[i];
    normal[i] = nrm[i];
    normal[i + 1] = nrm[i + 1];
    normal[i + 2] = nrm[i + 2];
    normal[i + 3] = r[i];
  }
  return { size, albedo, normal };
}

const canPhoto = typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
let queue = Promise.resolve();

self.onmessage = (e: MessageEvent<TexRequest>) => {
  const { id, names, size, photos } = e.data;
  // Requests run one after another so their results keep arriving in order.
  queue = queue.then(async () => {
    for (const name of names) {
      const g = gens[name];
      if (!g) continue;
      const t0 = performance.now();
      let image: TexImage | null = null;
      let fallback = false;
      if (photos?.names.includes(name)) {
        if (canPhoto) {
          try {
            image = await photo(photos.base, name, size);
          } catch {
            image = null;
          }
        }
        fallback = !image;
      }
      image ??= g(size);
      const msg: TexResponse = { id, name, image, ms: performance.now() - t0, fallback };
      (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, [image.albedo.buffer, image.normal.buffer]);
    }
  });
};
