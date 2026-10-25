import * as THREE from 'three';
import type { SpeciesDef } from './species';

/**
 * Red aura of alpha males: a small cloud of embers rising around the body.
 * Everything moves in the vertex shader (no per-frame CPU work, no lights);
 * the only per-frame inputs are the time and an intensity that rises when the
 * animal is alert, defending or hunting.
 */
const COUNT = 56;

const vert = /* glsl */ `
  attribute vec4 seed;
  uniform float uTime;
  uniform float uRadius;
  uniform float uHeight;
  uniform float uLength;
  uniform float uIntensity;
  uniform float uPixel;
  uniform float uSize;
  varying float vAlpha;
  void main() {
    float life = fract(uTime * (0.22 + seed.w * 0.18) + seed.x);
    float ang = seed.y * 6.2831853 + uTime * (0.3 + seed.z * 0.4) * (seed.z > 0.5 ? 1.0 : -1.0);
    float rad = uRadius * (0.7 + 0.35 * seed.z) * (1.0 - 0.4 * life);
    vec3 p = vec3(cos(ang) * rad, life * uHeight, sin(ang) * rad * 0.7 + (seed.x - 0.5) * uLength);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uPixel * uSize * (0.35 + 0.5 * seed.w) * (1.0 - life * 0.5) / max(0.5, -mv.z), 1.0, 48.0);
    vAlpha = sin(life * 3.14159) * (0.5 + 0.5 * uIntensity);
  }`;

const frag = /* glsl */ `
  uniform float uIntensity;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float core = exp(-d * 3.0);
    // Normal blending keeps the embers red even against a bright sky.
    vec3 col = mix(vec3(0.55, 0.02, 0.01), vec3(1.0, 0.28, 0.08), core * (0.35 + 0.5 * uIntensity));
    gl_FragColor = vec4(col, vAlpha * min(1.0, core * 1.6));
  }`;

let geometry: THREE.BufferGeometry | null = null;

function sharedGeometry(): THREE.BufferGeometry {
  if (geometry) return geometry;
  geometry = new THREE.BufferGeometry();
  const seeds = new Float32Array(COUNT * 4);
  // Deterministic spread (golden ratio) so every alpha looks alike.
  for (let i = 0; i < COUNT; i++) {
    seeds[i * 4] = (i * 0.618034) % 1;
    seeds[i * 4 + 1] = (i * 0.381966 + 0.13) % 1;
    seeds[i * 4 + 2] = (i * 0.754877) % 1;
    seeds[i * 4 + 3] = (i * 0.569840 + 0.29) % 1;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return geometry;
}

export interface AlphaAura {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
}

export function createAlphaAura(sp: SpeciesDef): AlphaAura {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRadius: { value: Math.max(0.6, sp.lengthM * 0.22) },
      uHeight: { value: Math.max(1, sp.hipHeightM * 1.25) },
      uLength: { value: sp.lengthM * 0.55 },
      uIntensity: { value: 0 },
      uPixel: { value: 60 },
      uSize: { value: Math.min(2, Math.max(0.5, sp.lengthM / 6)) },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const points = new THREE.Points(sharedGeometry(), material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  points.name = 'alphaAura';
  return { points, material };
}

/** Per-frame update: intensity follows the animal's mood smoothly. */
export function updateAlphaAura(aura: AlphaAura, now: number, aroused: boolean, alive: boolean, dt: number, pixelHeight: number): void {
  aura.points.visible = alive;
  const u = aura.material.uniforms;
  u.uTime.value = now % 1000;
  const want = aroused ? 1 : 0;
  u.uIntensity.value += (want - u.uIntensity.value) * Math.min(1, dt * 2.5);
  u.uPixel.value = pixelHeight * 0.4;
}

export function disposeAlphaAura(aura: AlphaAura): void {
  aura.points.removeFromParent();
  aura.material.dispose();
}
