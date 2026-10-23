import * as THREE from 'three';
import type { TextureLibrary } from './textureLibrary';

/**
 * Terrain shading: a MeshStandardMaterial extended with texture splatting.
 *
 * Per-vertex attributes (computed from the world generator):
 *  - `color`  : biome tint (multiplies the textures, gives macro variation);
 *  - `splatA` : weights of grass, dirt, sand, snow;
 *  - `splatB` : weights of litter, mud, forced rock, and baked ambient occlusion.
 * Rock is also added on steep slopes from the interpolated normal, using
 * biplanar projection so cliffs are not stretched. Layers are blended by
 * their height maps (stones poke through grass, mud fills the gaps), sampled
 * at two scales to hide tiling, and lit with blended normal and roughness
 * maps. A global wetness value darkens and polishes the ground and fills
 * puddles in flat hollows when it rains.
 */
export interface TerrainShaderUniforms {
  uWetness: { value: number };
  uTime: { value: number };
  /** Far-terrain only: horizontal centre and radius of the area covered by detailed sectors. */
  uHoleCenter: { value: THREE.Vector2 };
  uHoleRadius: { value: number };
}

export function createTerrainUniforms(): TerrainShaderUniforms {
  return { uWetness: { value: 0 }, uTime: { value: 0 }, uHoleCenter: { value: new THREE.Vector2() }, uHoleRadius: { value: 0 } };
}

export function createTerrainMaterial(lib: TextureLibrary, u: TerrainShaderUniforms, opts: { normals: boolean; far?: boolean }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.FrontSide });
  mat.defines = { SPLAT_NORMALS: opts.normals ? 1 : 0, FAR_TERRAIN: opts.far ? 1 : 0 };
  mat.customProgramCacheKey = () => `terrain-${opts.normals ? 1 : 0}-${opts.far ? 1 : 0}`;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, lib.terrainUniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 splatA;
attribute vec4 splatB;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec3 vWPos;
varying vec3 vWNormal;
uniform vec2 uHoleCenter;
uniform float uHoleRadius;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#if FAR_TERRAIN
  // Sink the coarse horizon mesh under the detailed sectors so it never pokes through
  // (no fragment discard: it would disable early depth rejection for the whole mesh).
  float holeD = length(position.xz - uHoleCenter);
  transformed.y -= 60.0 * (1.0 - smoothstep(uHoleRadius - 40.0, uHoleRadius + 10.0, holeD));
#endif`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vSplatA = splatA;
vSplatB = splatB;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray tAlbedo;
uniform sampler2DArray tNormal;
uniform float uWetness;
uniform float uTime;
varying vec4 vSplatA;
varying vec4 vSplatB;
varying vec3 vWPos;
varying vec3 vWNormal;
uniform vec2 uHoleCenter;
uniform float uHoleRadius;
const int NL = 7;
// Layer order matches TERRAIN_LAYERS: grass, dirt, rock, sand, snow, litter, mud.
float vDistFade;
vec4 sampleNear(sampler2DArray t, vec2 uv, int layer, vec2 uv2);
vec4 sampleLayer(sampler2DArray t, vec2 uv, int layer, vec2 uv2) {
  // In the distance a tiled texture shows its repetition as a lattice:
  // converge to the layer's average colour (its smallest mip) instead.
  vec4 avg = textureLod(t, vec3(uv2, float(layer)), 12.0);
  if (vDistFade > 0.999) return avg;
  return mix(sampleNear(t, uv, layer, uv2), avg, vDistFade);
}
vec4 sampleNear(sampler2DArray t, vec2 uv, int layer, vec2 uv2) {
#if SPLAT_NORMALS && !FAR_TERRAIN
  // Two scales, mixed, to break visible repetition.
  return mix(texture(t, vec3(uv, float(layer))), texture(t, vec3(uv2, float(layer))), 0.35);
#elif FAR_TERRAIN
  return texture(t, vec3(uv2, float(layer)));
#else
  return texture(t, vec3(uv, float(layer)));
#endif
}
// Typical roughness per layer (used when the normal/roughness maps are off).
const float LAYER_ROUGH[7] = float[7](0.85, 0.92, 0.8, 0.95, 0.65, 0.85, 0.5);`,
      )
      .replace(
        '#include <map_fragment>',
        `
vec3 tN = normalize(vWNormal);
vDistFade = smoothstep(120.0, 520.0, length(vWPos - cameraPosition));
float w[NL];
w[0] = vSplatA.x; w[1] = vSplatA.y; w[3] = vSplatA.z; w[4] = vSplatA.w;
w[5] = vSplatB.x; w[6] = vSplatB.y;
float slopeRock = smoothstep(0.42, 0.7, 1.0 - tN.y);
w[2] = max(vSplatB.z, slopeRock);
float keep = 1.0 - w[2];
for (int i = 0; i < NL; i++) if (i != 2) w[i] *= keep;

vec2 uvA = vWPos.xz / 2.6;
vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vWPos.xz / 9.7 + 0.37;
vec3 splatCol = vec3(0.0);
float splatH = 0.0;
#if SPLAT_NORMALS && !FAR_TERRAIN
// Biplanar projection for rock on cliffs.
vec3 bw = pow(abs(tN), vec3(4.0));
bw /= (bw.x + bw.y + bw.z + 1e-4);
vec4 alb[NL];
float hmax = 0.0;
for (int i = 0; i < NL; i++) {
  alb[i] = vec4(0.0);
  if (w[i] < 0.01) continue;
  if (i == 2) {
    vec4 ry = sampleLayer(tAlbedo, vWPos.xz / 5.0, 2, uvB);
    vec4 rx = sampleLayer(tAlbedo, vWPos.zy / 5.0, 2, vWPos.zy / 13.0);
    vec4 rz = sampleLayer(tAlbedo, vWPos.xy / 5.0, 2, vWPos.xy / 13.0);
    alb[i] = rx * bw.x + ry * bw.y + rz * bw.z;
  } else {
    alb[i] = sampleLayer(tAlbedo, uvA, i, uvB);
  }
  hmax = max(hmax, alb[i].a + w[i]);
}
// Height blend: only the layers within a small depth of the top one contribute.
float wsum = 0.0;
for (int i = 0; i < NL; i++) {
  if (w[i] < 0.01) { w[i] = 0.0; continue; }
  float b = max(alb[i].a + w[i] - (hmax - 0.25), 0.0);
  w[i] = b;
  wsum += b;
}
for (int i = 0; i < NL; i++) {
  w[i] /= max(wsum, 1e-4);
  splatCol += alb[i].rgb * w[i];
  splatH += alb[i].a * w[i];
}
#else
// Fast path (Low preset and the horizon mesh): the two strongest layers, one sample each.
int i0 = 0;
int i1 = 1;
for (int i = 0; i < NL; i++) if (w[i] > w[i0]) i0 = i;
if (i0 == 1) i1 = 0;
for (int i = 0; i < NL; i++) if (i != i0 && w[i] > w[i1]) i1 = i;
#if FAR_TERRAIN
vec4 a0 = textureLod(tAlbedo, vec3(uvB, float(i0)), 12.0);
vec4 a1 = textureLod(tAlbedo, vec3(uvB, float(i1)), 12.0);
#else
vec4 a0 = texture(tAlbedo, vec3(uvA, float(i0)));
vec4 a1 = w[i1] > 0.02 ? texture(tAlbedo, vec3(uvA, float(i1))) : a0;
#endif
float b0 = max(a0.a + w[i0] - (max(a0.a + w[i0], a1.a + w[i1]) - 0.25), 0.0);
float b1 = max(a1.a + w[i1] - (max(a0.a + w[i0], a1.a + w[i1]) - 0.25), 0.0);
float bs = max(b0 + b1, 1e-4);
splatCol = (a0.rgb * b0 + a1.rgb * b1) / bs;
splatH = (a0.a * b0 + a1.a * b1) / bs;
for (int i = 0; i < NL; i++) w[i] = 0.0;
w[i0] += b0 / bs;
w[i1] += b1 / bs;
#endif
// Wet ground: darker, glossier; puddles collect in flat low spots.
float porous = 1.0 - w[2] * 0.6 - w[4] * 0.8;
float wet = uWetness * porous;
float puddle = uWetness * smoothstep(0.985, 0.998, tN.y) * (1.0 - smoothstep(0.25, 0.42, splatH)) * (1.0 - w[4]);
splatCol *= mix(1.0, 0.55, wet);
splatCol = mix(splatCol, splatCol * 0.35, puddle);
diffuseColor.rgb *= splatCol;
`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
{
  float r = 0.0;
#if SPLAT_NORMALS && !FAR_TERRAIN
  for (int i = 0; i < NL; i++) if (w[i] > 0.0) r += w[i] * texture(tNormal, vec3(uvA, float(i))).a;
#else
  for (int i = 0; i < NL; i++) r += w[i] * LAYER_ROUGH[i];
#endif
  roughnessFactor = mix(r, 0.18, wet * 0.8);
  roughnessFactor = mix(roughnessFactor, 0.04, puddle);
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#if SPLAT_NORMALS && !FAR_TERRAIN
{
  vec3 tn = vec3(0.0);
  for (int i = 0; i < NL; i++) {
    if (w[i] <= 0.0) continue;
    vec3 n = sampleLayer(tNormal, uvA, i, uvB).xyz * 2.0 - 1.0;
    tn += n * w[i];
  }
  tn.xy *= (1.0 - puddle);
  // Raindrop ripples on puddles.
  if (puddle > 0.01) {
    vec2 cell = floor(vWPos.xz * 1.5);
    vec2 f = fract(vWPos.xz * 1.5) - 0.5;
    float ph = fract(uTime * 0.9 + fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453));
    float d = length(f);
    float ring = sin((d - ph * 0.5) * 40.0) * (1.0 - ph) * (1.0 - smoothstep(0.0, 0.5, d));
    tn.xy += normalize(f + 1e-4) * ring * 0.25 * puddle;
  }
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - tN * tN.x);
  vec3 B = normalize(vec3(0.0, 0.0, 1.0) - tN * tN.z);
  vec3 nW = normalize(T * tn.x + B * tn.y + tN * max(tn.z, 0.2));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
#endif`,
      )
      .replace(
        '#include <aomap_fragment>',
        `{
  float ambientOcclusion = vSplatB.w;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  reflectedLight.indirectSpecular *= ambientOcclusion;
  reflectedLight.directDiffuse *= mix(1.0, ambientOcclusion, 0.4);
}`,
      );
  };
  return mat;
}
