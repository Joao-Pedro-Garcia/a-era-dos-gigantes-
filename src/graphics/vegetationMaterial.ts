import * as THREE from 'three';
import { atmosphereUniforms } from './atmosphere';
import type { ArrayUniforms } from './textureLibrary';
import { WIND } from './wind';

/**
 * One material for every plant and rock. Geometry carries:
 *  - `vegLayer`: which texture of the vegetation array to use
 *     (0 bark, 1 ringed bark, 2 leaf atlas, 3 stone, 4 = untextured, colour only);
 *  - `wind`: sway amplitude in metres at full wind (0 at the base);
 *  - `color`: per-vertex tint (species, age, moss, dry tips…).
 * Sway is applied in world space after instancing, with a per-instance
 * phase and gusts, and leaves add a small flutter. The same displacement
 * and the leaf cut-out are used by the shadow depth material, so shadows
 * match what is drawn.
 */
const LAYER_LEAVES = 2;

const windVertex = /* glsl */ `
  #ifdef USE_INSTANCING
    vec3 instPos = instanceMatrix[3].xyz;
  #else
    vec3 instPos = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  float ph = dot(instPos.xz, vec2(0.071, 0.113));
  float gust = 0.55 + 0.45 * sin(uWindTime * 0.37 + ph * 0.5);
  float sway = sin(uWindTime * 1.25 + ph) * 0.65 + sin(uWindTime * 2.9 + ph * 1.7) * 0.25;
  float amp = vWind * uWindStrength * gust;
  vec3 windOff = vec3(uWindDir.x, 0.0, uWindDir.y) * amp * (0.55 + 0.45 * sway);
  // Leaves flutter around their own position.
  if (abs(vegLayer - ${LAYER_LEAVES.toFixed(1)}) < 0.5) {
    float f = sin(uWindTime * 9.0 + dot(position, vec3(3.1, 2.3, 1.7)) + ph * 3.0);
    windOff += vec3(f, f * 0.6, -f) * 0.05 * uWindStrength * min(vWind, 1.0);
  }
  windOff.y -= amp * amp * 0.08; // tips dip slightly as they bend
`;

const commonVertex = /* glsl */ `
attribute float vegLayer;
attribute float wind;
varying float vLayer;
varying vec2 vVegUv;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindTime;
`;

/** Projection with wind applied in world space after instancing. */
const projectWithWind = /* glsl */ `
  float vWind = wind;
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  ${windVertex}
  mvPosition.xyz += (inverse(mat3(modelMatrix)) * windOff);
  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
`;

const leafAlpha = /* glsl */ `
float vegAlpha(sampler2DArray t, vec2 uv, float layer) {
  if (abs(layer - ${LAYER_LEAVES.toFixed(1)}) > 0.5) return 1.0;
  float a = texture(t, vec3(uv, layer)).a;
  // Keep foliage dense in the distance: alpha-tested mips otherwise thin out.
  vec2 px = uv * 512.0;
  float mip = max(0.0, 0.5 * log2(max(dot(dFdx(px), dFdx(px)), dot(dFdy(px), dFdy(px)))));
  return a * (1.0 + mip * 0.35);
}
`;

export function createVegetationMaterial(arr: ArrayUniforms, opts: { normals: boolean }): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide, alphaTest: 0.5 });
  mat.defines = { VEG_NORMALS: opts.normals ? 1 : 0 };
  mat.customProgramCacheKey = () => `veg-${opts.normals ? 1 : 0}`;
  mat.onBeforeCompile = (shader) => {
    atmosphereUniforms(shader);
    Object.assign(shader.uniforms, WIND.uniforms, { tVegAlbedo: arr.tAlbedo, tVegNormal: arr.tNormal });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${commonVertex}`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLayer = vegLayer;\nvVegUv = uv;')
      .replace('#include <project_vertex>', projectWithWind);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray tVegAlbedo;
uniform sampler2DArray tVegNormal;
varying float vLayer;
varying vec2 vVegUv;
${leafAlpha}
// Cotangent frame from screen derivatives (no tangent attribute needed).
mat3 vegTBN(vec3 N, vec3 p, vec2 uv) {
  vec3 dp1 = dFdx(p); vec3 dp2 = dFdy(p);
  vec2 duv1 = dFdx(uv); vec2 duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N); vec3 dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x;
  vec3 B = dp2perp * duv1.y + dp1perp * duv2.y;
  float invmax = inversesqrt(max(dot(T, T), dot(B, B)) + 1e-12);
  return mat3(T * invmax, B * invmax, N);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `vec4 vegTex = vLayer < 3.5 ? texture(tVegAlbedo, vec3(vVegUv, vLayer)) : vec4(1.0);
diffuseColor.rgb *= vegTex.rgb;
diffuseColor.a *= vegAlpha(tVegAlbedo, vVegUv, vLayer);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = vLayer < 3.5 ? texture(tVegNormal, vec3(vVegUv, vLayer)).a : 0.75;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#if VEG_NORMALS
if (vLayer < 3.5) {
  vec3 mapN = texture(tVegNormal, vec3(vVegUv, vLayer)).xyz * 2.0 - 1.0;
  mapN.xy *= abs(vLayer - 2.0) < 0.5 ? 0.6 : 1.0;
  normal = normalize(vegTBN(normal, -vViewPosition, vVegUv) * mapN);
}
#endif`,
      )
      // Light through leaves: thin foliage glows a little when back-lit.
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
if (abs(vLayer - 2.0) < 0.5 || vLayer > 3.5) {
  reflectedLight.indirectDiffuse += diffuseColor.rgb * 0.12 * (1.0 - material.roughness * 0.3);
}`,
      );
  };
  return mat;
}

/** Shadow caster with the same wind and leaf cut-out as the visible material. */
export function createVegetationDepthMaterial(arr: ArrayUniforms): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WIND.uniforms, { tVegAlbedo: arr.tAlbedo });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${commonVertex}`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLayer = vegLayer;\nvVegUv = uv;')
      .replace('#include <project_vertex>', projectWithWind);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
precision highp sampler2DArray;
uniform sampler2DArray tVegAlbedo;
varying float vLayer;
varying vec2 vVegUv;
${leafAlpha}`,
      )
      .replace('#include <alphatest_fragment>', 'if (vegAlpha(tVegAlbedo, vVegUv, vLayer) < 0.5) discard;');
  };
  mat.customProgramCacheKey = () => 'veg-depth';
  return mat;
}
