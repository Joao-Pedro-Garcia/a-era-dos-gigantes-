import { MATERIAL_GENERATORS, TERRAIN_GENERATORS, type TexImage } from './texgen';

/**
 * Generates full-resolution procedural textures off the main thread. Each
 * texture is posted back as soon as it is ready (progressive refinement).
 */
export interface TexRequest {
  id: number;
  names: string[];
  size: number;
}
export interface TexResponse {
  id: number;
  name: string;
  image: TexImage;
  ms: number;
}

const gens: Record<string, (n: number) => TexImage> = { ...TERRAIN_GENERATORS, ...MATERIAL_GENERATORS };

self.onmessage = (e: MessageEvent<TexRequest>) => {
  const { id, names, size } = e.data;
  for (const name of names) {
    const g = gens[name];
    if (!g) continue;
    const t0 = performance.now();
    const image = g(size);
    const msg: TexResponse = { id, name, image, ms: performance.now() - t0 };
    (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, [image.albedo.buffer, image.normal.buffer]);
  }
};
