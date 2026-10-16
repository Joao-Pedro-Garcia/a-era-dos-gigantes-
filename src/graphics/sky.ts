import * as THREE from 'three';

/**
 * Sky dome: Preetham daylight scattering (same model as three's Sky, kept in
 * sync with `skyRadiance`), a cloud layer lit by the sun (darker bases,
 * bright sun-facing edges, wind drift, coverage driven by the weather),
 * stars and the moon at night, and a horizon that blends into the fog
 * colour so far terrain and sky meet seamlessly.
 */
export interface SkyUniforms {
  sunDir: { value: THREE.Vector3 };
  moonDir: { value: THREE.Vector3 };
  turbidity: { value: number };
  rayleigh: { value: number };
  mieCoefficient: { value: number };
  mieDirectionalG: { value: number };
  cloudCover: { value: number };
  cloudDark: { value: number };
  cloudOffset: { value: THREE.Vector2 };
  night: { value: number };
  horizonColor: { value: THREE.Color };
  sunLight: { value: THREE.Color };
}

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww; // at the far plane
}`;

const fragment = /* glsl */ `
varying vec3 vDir;
uniform vec3 sunDir;
uniform vec3 moonDir;
uniform float turbidity;
uniform float rayleigh;
uniform float mieCoefficient;
uniform float mieDirectionalG;
uniform float cloudCover;
uniform float cloudDark;
uniform vec2 cloudOffset;
uniform float night;
uniform vec3 horizonColor;
uniform vec3 sunLight;

const float pi = 3.141592653589793;
const vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);

vec3 preetham(vec3 dir) {
  float sunE = 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(clamp(sunDir.y, -1.0, 1.0))) / 1.5)));
  vec3 betaR = totalRayleigh * rayleigh;
  vec3 betaM = 0.434 * (0.2 * turbidity * 10E-18) * MieConst * mieCoefficient;
  float zenith = acos(max(0.0, dir.y));
  float inv = 1.0 / (cos(zenith) + 0.15 * pow(93.885 - ((zenith * 180.0) / pi), -1.253));
  vec3 Fex = exp(-(betaR * 8.4E3 * inv + betaM * 1.25E3 * inv));
  float cosTheta = dot(dir, sunDir);
  float rPhase = 0.05968310365946075 * (1.0 + pow(cosTheta * 0.5 + 0.5, 2.0));
  float g = mieDirectionalG;
  float mPhase = 0.07957747154594767 * ((1.0 - g * g) / pow(1.0 - 2.0 * g * cosTheta + g * g, 1.5));
  vec3 ratio = (betaR * rPhase + betaM * mPhase) / (betaR + betaM);
  vec3 Lin = pow(sunE * ratio * (1.0 - Fex), vec3(1.5));
  Lin *= mix(vec3(1.0), pow(sunE * ratio * Fex, vec3(0.5)), clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));
  vec3 L0 = vec3(0.1) * Fex;
  float sundisk = smoothstep(0.99995, 0.99997, cosTheta);
  L0 += sunE * 19000.0 * Fex * sundisk;
  vec3 tex = (Lin + L0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  return pow(tex, vec3(1.0 / 2.4));
}

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < CLOUD_OCTAVES; i++) { s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= 0.5; }
  return s;
}
float coverageLo() { return 1.0 - cloudCover * 0.95 - 0.12; }
float cloudDensity(vec2 p) {
  float base = fbm(p * 0.00045 + cloudOffset);
  float lo = coverageLo();
  // Early out: even with maximal detail this point stays clear.
  if (base * 0.75 + 0.25 < lo) return 0.0;
  float detail = fbm(p * 0.0021 - cloudOffset * 1.7);
  return smoothstep(lo, lo + 0.4, base * 0.75 + detail * 0.25);
}
float cloudShadow(vec2 p) {
  // Cheap low-frequency density toward the sun.
  float s = 0.0; float a = 0.5; vec2 q = p * 0.00045 + cloudOffset;
  for (int i = 0; i < 3; i++) { s += a * vnoise(q); q = mat2(1.6, 1.2, -1.2, 1.6) * q; a *= 0.5; }
  return smoothstep(coverageLo(), coverageLo() + 0.4, s / 0.875 * 0.75 + 0.12);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 d = vec3(dir.x, max(dir.y, 0.0), dir.z);
  vec3 col = preetham(normalize(d + vec3(0.0, 0.0001, 0.0)));

  // Night: stars and moon (the Preetham term fades out by itself).
  if (night > 0.01 && dir.y > 0.0) {
    vec3 sd = dir * 260.0;
    vec3 cell = floor(sd);
    float h = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    float h2 = fract(sin(dot(cell, vec3(269.5, 183.3, 246.1))) * 43758.5453);
    vec3 starPos = cell + vec3(h, h2, fract(h * 7.13 + h2 * 3.7));
    float star = step(0.9965, h2) * (0.4 + 0.6 * h) * (1.0 - smoothstep(0.05, 0.35, length(sd - starPos)));
    col += vec3(star) * night * 1.4 * smoothstep(0.0, 0.25, dir.y);
    float m = dot(dir, moonDir);
    col += vec3(0.9, 0.92, 1.0) * smoothstep(0.9993, 0.9996, m) * night * 2.5;
    col += vec3(0.05, 0.07, 0.12) * pow(max(m, 0.0), 24.0) * night;
  }

  // Cloud layer (a plane 1.8 km up seen from the ground).
  if (dir.y > 0.01 && cloudCover > 0.01) {
    float t = 1800.0 / dir.y;
    vec2 p = dir.xz * t;
    float dens = cloudDensity(p);
    if (dens > 0.001) {
      // Light reaching the cloud: density toward the sun (self-shadowing).
      vec2 toSun = normalize(sunDir.xz + 1e-4) * 260.0;
      float sh = cloudShadow(p + toSun) * 0.6 + cloudShadow(p + toSun * 2.2) * 0.4;
      float lit = exp(-sh * 2.2);
      float cosT = dot(dir, sunDir);
      float silver = pow(max(cosT, 0.0), 12.0) * (1.0 - dens) * 2.0;
      vec3 ambient = horizonColor * 0.85 + vec3(0.02);
      vec3 cloudCol = ambient * (0.55 + 0.45 * (1.0 - dens)) + sunLight * (lit * 0.75 + silver);
      cloudCol *= mix(1.0, 0.35, cloudDark);
      // Distant clouds fade into the haze near the horizon.
      float haze = smoothstep(0.02, 0.25, dir.y);
      col = mix(col, cloudCol, dens * haze);
    }
  }
  // Below the horizon and right at it, converge to the fog colour.
  col = mix(col, horizonColor, (1.0 - smoothstep(-0.02, 0.06, dir.y)));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class SkyDome extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  readonly u: SkyUniforms;
  constructor(octaves = 5) {
    const u: SkyUniforms = {
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      moonDir: { value: new THREE.Vector3(0, -1, 0) },
      turbidity: { value: 3 },
      rayleigh: { value: 1.4 },
      mieCoefficient: { value: 0.004 },
      mieDirectionalG: { value: 0.85 },
      cloudCover: { value: 0.3 },
      cloudDark: { value: 0 },
      cloudOffset: { value: new THREE.Vector2() },
      night: { value: 0 },
      horizonColor: { value: new THREE.Color(0.6, 0.7, 0.8) },
      sunLight: { value: new THREE.Color(1, 1, 1) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u as unknown as Record<string, THREE.IUniform>,
      vertexShader: vertex,
      fragmentShader: fragment,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      defines: { CLOUD_OCTAVES: octaves },
    });
    super(new THREE.SphereGeometry(1, 32, 16), mat);
    this.u = u;
    this.frustumCulled = false;
    // Last among opaque objects: only pixels not covered by the world run the sky shader.
    this.renderOrder = 100;
    this.userData.noAO = true;
  }

  setOctaves(n: number): void {
    if (this.material.defines.CLOUD_OCTAVES === n) return;
    this.material.defines.CLOUD_OCTAVES = n;
    this.material.needsUpdate = true;
  }
}
