import * as THREE from 'three';
import type { QualityProfile } from '../core/config';
import { atmosphereUniforms } from './atmosphere';
import { WIND } from './wind';

/**
 * Sea, rivers and lakes: one surface at the water level that follows the
 * player. The grid is dense near the player and stretches to the horizon.
 * Each vertex knows the water depth (terrain below), so the shader can show
 * clear shallows over sand, dark deep water, foam on shorelines and fade the
 * edge smoothly. Waves are a sum of directional wave normals driven by the
 * wind; reflections come from the sky environment map (Fresnel), with a
 * sun glint; rain draws ripple rings.
 *
 * Depths are refreshed in small slices per frame when the player moves far
 * enough, so there is no hitch.
 */
const N = 72; // vertices per side
const INNER = 220; // half-size of the evenly spaced inner area (m)
const OUTER = 16000;

export class WaterSurface {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private depth: Float32Array;
  private pending: Float32Array;
  private sliceAt = -1;
  private center = new THREE.Vector2(1e9, 1e9);
  private nextCenter = new THREE.Vector2();
  private heightFn: ((x: number, z: number) => number) | null = null;
  private level = 0;
  private offsets: Float32Array;
  readonly uniforms = {
    uRain: { value: 0 },
    uSunDirW: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uDeep: { value: new THREE.Color(0.01, 0.045, 0.06) },
    uShallow: { value: new THREE.Color(0.08, 0.2, 0.18) },
    uDetail: { value: 1 },
  };

  constructor() {
    // Offsets along one axis: linear inside ±INNER, then geometric growth to ±OUTER.
    const half = N / 2;
    this.offsets = new Float32Array(N + 1);
    const innerSteps = 26;
    for (let i = 0; i <= N; i++) {
      const k = i - half;
      const a = Math.abs(k);
      let d: number;
      if (a <= innerSteps) d = (a / innerSteps) * INNER;
      else {
        const t = (a - innerSteps) / (half - innerSteps);
        d = INNER * Math.pow(OUTER / INNER, t);
      }
      this.offsets[i] = Math.sign(k) * d;
    }
    const V = (N + 1) * (N + 1);
    const pos = new Float32Array(V * 3);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pos.set([this.offsets[i], 0, this.offsets[j]], (j * (N + 1) + i) * 3);
    const idx: number[] = [];
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i;
        idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
      }
    this.depth = new Float32Array(V).fill(30);
    this.pending = new Float32Array(V);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(V * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setAttribute('depth', new THREE.BufferAttribute(this.depth, 1));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), OUTER * 1.5);

    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0, transparent: true, side: THREE.DoubleSide, depthWrite: true });
    mat.defines = { WAVES: 6 };
    // Reflections of the sky are strong at grazing angles; keep them from bleaching the water.
    mat.envMapIntensity = 0.45;
    mat.onBeforeCompile = (shader) => {
      atmosphereUniforms(shader);
      Object.assign(shader.uniforms, this.uniforms, WIND.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float depth;\nvarying float vDepth;\nvarying vec3 vWaterPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvDepth = depth;\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vDepth;
varying vec3 vWaterPos;
uniform float uRain;
uniform vec3 uSunDirW;
uniform vec3 uSunCol;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform float uDetail;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindTime;
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Gradient of a sum of directional waves (analytic normals, no textures).
vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  float amp = 0.06 + uWindStrength * 0.18;
  vec2 d0 = normalize(uWindDir + 1e-4);
  // Irrational frequency ratios and spread directions avoid a visible lattice.
  for (int i = 0; i < WAVES; i++) {
    float fi = float(i);
    float a = fi * 2.399 + 0.3;
    vec2 d = normalize(d0 + vec2(cos(a), sin(a)) * (0.6 + fi * 0.15));
    float k = 0.3 * pow(1.73, fi) * (1.0 + 0.13 * sin(fi * 3.7));
    float w = sqrt(9.8 * k);
    float ph = dot(d, p) * k - w * t + fi * 2.1 + 0.6 * sin(dot(p, vec2(0.013, 0.021)) + fi);
    g += d * cos(ph) * k * amp * pow(0.5, fi);
  }
  return g;
}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float shore = smoothstep(0.0, 2.5, vDepth);
float deep = smoothstep(0.5, 9.0, vDepth);
diffuseColor.rgb = mix(uShallow, uDeep, deep);
float foam = (1.0 - smoothstep(0.0, 0.45, vDepth)) * (0.55 + 0.45 * sin(vWaterPos.x * 0.9 + vWaterPos.z * 0.7 + uWindTime * 1.3));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.78, 0.76), clamp(foam, 0.0, 1.0) * 0.6 * uDetail);
diffuseColor.a = mix(0.25, 0.94, shore);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `vec2 waveG = waveGrad(vWaterPos.xz, uWindTime) * uDetail;
{
  vec2 g = waveG;
  // Rain ripples.
  if (uRain > 0.01) {
    vec2 cell = floor(vWaterPos.xz * 0.9);
    vec2 f = fract(vWaterPos.xz * 0.9) - 0.5;
    float ph = fract(uWindTime * 0.8 + wHash(cell));
    float d = length(f);
    float ring = sin((d - ph * 0.5) * 38.0) * (1.0 - ph) * (1.0 - smoothstep(0.05, 0.5, d));
    g += normalize(f + 1e-4) * ring * 0.35 * uRain;
  }
  vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
  if (!gl_FrontFacing) nW = -nW;
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`,
        )
        .replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
{
  // Sun glint on the wave facets.
  vec3 V = normalize(cameraPosition - vWaterPos);
  vec3 nW = normalize(vec3(-waveG.x, 1.0, -waveG.y));
  vec3 H = normalize(V + uSunDirW);
  float spec = pow(max(dot(nW, H), 0.0), 600.0) * 30.0;
  reflectedLight.directSpecular += uSunCol * spec * smoothstep(0.0, 0.1, uSunDirW.y);
}`,
        );
    };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = 1;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData.noAO = true;
  }

  setHeightFn(fn: (x: number, z: number) => number): void {
    this.heightFn = fn;
    this.center.set(1e9, 1e9);
  }

  setQuality(q: QualityProfile): void {
    this.uniforms.uDetail.value = q.normalMaps ? 1 : 0.6;
    const waves = q.normalMaps ? 6 : 3;
    // Low preset: opaque water (hidden fragments are rejected early; no see-through shallows).
    const transparent = q.normalMaps;
    if (this.mesh.material.transparent !== transparent) {
      this.mesh.material.transparent = transparent;
      this.mesh.material.needsUpdate = true;
    }
    if (this.mesh.material.defines!.WAVES !== waves) {
      this.mesh.material.defines!.WAVES = waves;
      this.mesh.material.needsUpdate = true;
    }
  }

  update(dt: number, focus: THREE.Vector3, level: number, horizon: THREE.Color, sunCol: THREE.Color, sunDir: THREE.Vector3, sunI: number, rain: number, env: THREE.Texture | null): void {
    void dt;
    void env;
    this.uniforms.uRain.value = rain;
    this.uniforms.uSunDirW.value.copy(sunDir);
    this.uniforms.uSunCol.value.copy(sunCol).multiplyScalar(sunI * 0.4);
    // Water colour follows the light a little (darker at night / overcast).
    const light = Math.min(1, sunI / 3 + 0.15);
    this.uniforms.uDeep.value.setRGB(0.01, 0.04, 0.055).multiplyScalar(0.4 + light * 0.6).lerp(horizon, 0.08);
    this.uniforms.uShallow.value.setRGB(0.09, 0.19, 0.16).multiplyScalar(0.4 + light * 0.6);
    this.level = level;
    this.mesh.position.y = level;

    // Recentre in steps of 24 m; recompute depths in slices.
    const S = 24;
    const cx = Math.round(focus.x / S) * S;
    const cz = Math.round(focus.z / S) * S;
    if (this.sliceAt < 0 && (cx !== this.center.x || cz !== this.center.y) && this.heightFn) {
      this.nextCenter.set(cx, cz);
      this.sliceAt = 0;
      // First placement: compute everything at once.
      if (this.center.x > 1e8) this.computeSlice(this.depth.length);
    }
    if (this.sliceAt >= 0) this.computeSlice(900);
  }

  private computeSlice(count: number): void {
    const fn = this.heightFn!;
    const total = this.depth.length;
    const end = Math.min(total, this.sliceAt + count);
    for (let k = this.sliceAt; k < end; k++) {
      const i = k % (N + 1);
      const j = Math.floor(k / (N + 1));
      const x = this.nextCenter.x + this.offsets[i];
      const z = this.nextCenter.y + this.offsets[j];
      const far = Math.abs(this.offsets[i]) > 1500 || Math.abs(this.offsets[j]) > 1500;
      this.pending[k] = far ? 30 : this.level - fn(x, z);
    }
    this.sliceAt = end;
    if (end >= total) {
      this.depth.set(this.pending);
      this.mesh.geometry.attributes.depth.needsUpdate = true;
      this.center.copy(this.nextCenter);
      this.mesh.position.x = this.center.x;
      this.mesh.position.z = this.center.y;
      this.sliceAt = -1;
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
