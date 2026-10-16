import { clamp, smoothstep } from '../core/math';
import type { BiomeId } from './biomes';
import type { Terrain } from './terrain';

/**
 * Which ground materials cover a point of the terrain. Used by the detailed
 * sectors and by the far horizon mesh, so both always agree.
 *
 * Weights (not normalised; the shader height-blends them):
 *   a = grass, dirt, sand, snow     b = litter, mud, forced rock
 * and a subtle tint that multiplies the textures (macro variation).
 */
export interface GroundSample {
  tint: [number, number, number];
  a: [number, number, number, number];
  b: [number, number, number];
}

interface Profile {
  grass: number;
  dirt: number;
  sand: number;
  snow: number;
  litter: number;
  mud: number;
  rock: number;
  tint: [number, number, number];
}

const P = (grass: number, dirt: number, sand: number, snow: number, litter: number, mud: number, rock: number, tint: [number, number, number]): Profile => ({ grass, dirt, sand, snow, litter, mud, rock, tint });

export const GROUND_PROFILES: Record<BiomeId, Profile> = {
  plains: P(0.85, 0.15, 0, 0, 0, 0, 0, [1.08, 1.0, 0.82]),
  jungle: P(0.3, 0.05, 0, 0, 0.55, 0.1, 0, [0.92, 1.04, 0.9]),
  swamp: P(0.3, 0, 0, 0, 0.2, 0.5, 0, [0.85, 0.95, 0.82]),
  beach: P(0, 0, 1, 0, 0, 0, 0, [1, 1, 1]),
  mountain: P(0.35, 0.35, 0, 0, 0, 0, 0.35, [0.95, 0.95, 0.92]),
  snow: P(0, 0, 0, 0.9, 0, 0, 0.1, [1, 1, 1]),
  volcanic: P(0, 0.55, 0, 0, 0, 0, 0.45, [0.5, 0.46, 0.43]),
  ruins: P(0.5, 0.5, 0, 0, 0, 0, 0, [1.0, 0.98, 0.9]),
  ocean: P(0, 0, 0.6, 0, 0, 0.4, 0, [0.85, 0.85, 0.8]),
};

/** `biomeAt` is usually a cached coarse lookup supplied by the caller. */
export function groundSample(terrain: Terrain, biomeAt: (x: number, z: number) => BiomeId, x: number, z: number, h: number, out: GroundSample): GroundSample {
  // Bilinear blend of the four surrounding coarse biome cells → soft transitions.
  const g = 16;
  const fx = x / g;
  const fz = z / g;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  let grass = 0, dirt = 0, sand = 0, snow = 0, litter = 0, mud = 0, rock = 0, tr = 0, tg = 0, tb = 0;
  for (let k = 0; k < 4; k++) {
    const dx = k & 1;
    const dz = k >> 1;
    const w = (dx ? tx : 1 - tx) * (dz ? tz : 1 - tz);
    const p = GROUND_PROFILES[biomeAt((ix + dx) * g, (iz + dz) * g)];
    grass += p.grass * w;
    dirt += p.dirt * w;
    sand += p.sand * w;
    snow += p.snow * w;
    litter += p.litter * w;
    mud += p.mud * w;
    rock += p.rock * w;
    tr += p.tint[0] * w;
    tg += p.tint[1] * w;
    tb += p.tint[2] * w;
  }
  // Patchiness: meadows give way to bare soil or leaf litter.
  const v = terrain.groundNoise(x, z);
  const bare = smoothstep(0.3, 0.12, v) * grass * 0.8;
  grass -= bare;
  dirt += bare * 0.7;
  litter += bare * 0.3;
  // Animal trails: compacted bare soil.
  const trail = terrain.trailMask(x, z);
  if (trail > 0) {
    const t = trail * (grass + litter + dirt > 0.3 ? 1 : 0);
    grass *= 1 - t;
    litter *= 1 - t * 0.8;
    dirt += t;
  }
  // Shorelines: wet sand or mud; underwater: silt.
  if (h < 1.6) {
    const shore = smoothstep(1.6, 0.3, h);
    const muddy = terrain.swampMask(x, z) > 0.3 || terrain.riverMask(x, z) > 0.3 ? 1 : 0.35;
    grass *= 1 - shore;
    litter *= 1 - shore;
    mud += shore * muddy;
    sand += shore * (1 - muddy);
  }
  // Snow line on high ground.
  const snowLine = smoothstep(210, 280, h);
  if (snowLine > 0) {
    snow += snowLine;
    grass *= 1 - snowLine;
    dirt *= 1 - snowLine;
  }
  const shade = 0.9 + v * 0.2;
  out.tint[0] = clamp(tr * shade, 0, 2);
  out.tint[1] = clamp(tg * shade, 0, 2);
  out.tint[2] = clamp(tb * shade, 0, 2);
  out.a[0] = grass;
  out.a[1] = dirt;
  out.a[2] = sand;
  out.a[3] = snow;
  out.b[0] = litter;
  out.b[1] = mud;
  out.b[2] = rock;
  return out;
}

export function newGroundSample(): GroundSample {
  return { tint: [1, 1, 1], a: [0, 0, 0, 0], b: [0, 0, 0] };
}
