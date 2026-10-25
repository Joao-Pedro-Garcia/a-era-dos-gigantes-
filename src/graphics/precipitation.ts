import * as THREE from 'three';
import { WIND } from './wind';

/**
 * Rain and snow animated entirely on the GPU: each drop is an instanced
 * streak (or flake) whose position wraps inside a box that travels with the
 * camera. Streaks are oriented along their fall velocity (wind tilts them),
 * fade with distance and are lit by the scene's sky colour, so they read as
 * part of the scene rather than lines drawn over the screen.
 */
const COUNT = 6000;
const BOX = new THREE.Vector3(60, 34, 60);

export class Precipitation {
  readonly object: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private density = 1;
  private uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uBox: { value: BOX.clone() },
    uSpeed: { value: 9 },
    uLen: { value: 0.9 },
    uWidth: { value: 0.012 },
    uWind: { value: new THREE.Vector2() },
    uOpacity: { value: 0 },
    uSnow: { value: 0 },
    uColor: { value: new THREE.Color(0.7, 0.75, 0.8) },
  };

  constructor() {
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, -0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    const off = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) off.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    geo.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 4));
    geo.instanceCount = COUNT;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
attribute vec4 offset;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uBox;
uniform float uSpeed;
uniform float uLen;
uniform float uWidth;
uniform vec2 uWind;
uniform float uSnow;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  float speed = uSpeed * (0.85 + offset.w * 0.3);
  vec3 vel = vec3(uWind.x, -speed, uWind.y);
  vec3 p = offset.xyz * uBox + vel * uTime;
  // Snow flakes wander.
  p.x += uSnow * sin(uTime * 0.9 + offset.w * 40.0) * 0.6;
  p.z += uSnow * cos(uTime * 0.7 + offset.x * 40.0) * 0.6;
  // Wrap around the camera.
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 center = uCam + rel;
  vec3 dir = normalize(vel);
  // Camera-facing strip: the camera's right vector made perpendicular to the
  // fall direction (no cross product with the view ray, which can degenerate).
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 side = camRight - dir * dot(camRight, dir);
  side = side / max(length(side), 1e-3);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float len = mix(uLen, uWidth * 2.0, uSnow);
  vec3 wp = center + side * position.x * uWidth * 2.0 + dir * (-position.y) * len;
  if (uSnow > 0.5) wp = center + camRight * position.x * uWidth * 2.0 + camUp * (position.y + 0.5) * uWidth * 2.0;
  float d = length(rel);
  vFade = (1.0 - smoothstep(uBox.x * 0.2, uBox.x * 0.5, d)) * smoothstep(0.6, 2.0, d);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`,
      fragmentShader: /* glsl */ `
varying vec2 vUv;
varying float vFade;
uniform float uOpacity;
uniform float uSnow;
uniform vec3 uColor;
void main() {
  float a;
  if (uSnow > 0.5) a = (1.0 - smoothstep(0.2, 0.5, length(vUv - 0.5)));
  else a = (1.0 - abs(vUv.x - 0.5) * 2.0) * smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.6, 1.0, vUv.y));
  gl_FragColor = vec4(uColor, a * vFade * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    this.object = new THREE.Mesh(geo, mat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
    this.object.userData.noAO = true;
    this.object.visible = false;
  }

  setDensity(d: number): void {
    this.density = d;
  }

  update(dt: number, camera: THREE.Camera, precip: number, snowy: boolean, indoor: boolean, particles: number): void {
    const on = precip > 0.05 && !indoor && particles > 0;
    this.object.visible = on;
    if (!on) return;
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uCam.value.copy(camera.position);
    u.uSnow.value = snowy ? 1 : 0;
    u.uSpeed.value = snowy ? 1.4 : 11;
    u.uLen.value = snowy ? 0.05 : 0.9;
    u.uWidth.value = snowy ? 0.035 : 0.016;
    u.uWind.value.copy(WIND.dir).multiplyScalar(WIND.strength * (snowy ? 3 : 6));
    u.uOpacity.value = (snowy ? 0.9 : 0.7) * Math.min(1, precip * 1.3);
    u.uColor.value.setRGB(snowy ? 0.95 : 0.75, snowy ? 0.96 : 0.79, snowy ? 1 : 0.85);
    this.object.geometry.instanceCount = Math.floor(COUNT * Math.max(0.05, this.density) * Math.min(1, 0.25 + precip));
  }

  dispose(): void {
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}
