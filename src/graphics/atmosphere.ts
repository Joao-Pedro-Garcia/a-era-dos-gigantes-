import * as THREE from 'three';

/**
 * Atmosphere shared by the sky and every lit material.
 *
 * - Aerial perspective: distance fog with exponential height falloff (mist
 *   pools in valleys, mountain tops stay clear) and sun in-scattering
 *   (the haze glows toward the sun at dawn and dusk).
 * - It is applied in linear HDR before tone mapping, exactly like the sky,
 *   so distant terrain melts into the real horizon colour instead of a flat
 *   grey band.
 * - The horizon colour is computed on the CPU with the same Preetham model
 *   the sky shader uses (see `skyRadiance`).
 *
 * Installed once by overriding three's fog shader chunks and adding the
 * extra uniforms through a global onBeforeCompile hook.
 */
export const ATMOS = {
  sunDir: { value: new THREE.Vector3(0, 1, 0) },
  sunScatter: { value: new THREE.Color(0, 0, 0) },
  /** Height falloff (1/m) and reference altitude of the fog layer. */
  heightFalloff: { value: 0.012 },
  baseHeight: { value: 0 },
};

let installed = false;

export function installAtmosphere(): void {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  // World position from the view-space position (works for every material, sprites included).
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[3].xyz );
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  uniform vec3 uFogSunDir;
  uniform vec3 uFogSunScatter;
  uniform float uFogFalloff;
  uniform float uFogBase;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  vec3 applyAtmosphere( vec3 col ) {
    vec3 ray = vFogWorldPos - cameraPosition;
    float dist = length( ray );
    vec3 dir = ray / max( dist, 1e-3 );
    #ifdef FOG_EXP2
      // Analytic integral of an exponential height fog along the view ray.
      float k = uFogFalloff;
      float camH = max( cameraPosition.y - uFogBase, -50.0 );
      float dy = ray.y;
      float integ = abs( dy * k ) > 1e-3 ? ( 1.0 - exp( -dy * k ) ) / ( dy * k ) : 1.0;
      float amount = fogDensity * exp( -camH * k ) * integ * dist;
      float fogFactor = 1.0 - exp( -amount );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    float sunAmt = pow( max( dot( dir, uFogSunDir ), 0.0 ), 6.0 );
    vec3 fc = fogColor + uFogSunScatter * sunAmt;
    return mix( col, fc, clamp( fogFactor, 0.0, 1.0 ) );
  }
#endif`;
  // Fog now happens before tone mapping (see opaque_fragment below).
  C.fog_fragment = '';
  C.opaque_fragment = `#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
#ifdef USE_FOG
outgoingLight = applyAtmosphere( outgoingLight );
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`;

  // Every material receives the shared atmosphere uniforms.
  THREE.Material.prototype.onBeforeCompile = function (shader: THREE.WebGLProgramParametersWithUniforms) {
    atmosphereUniforms(shader);
  };
}

/** Adds the shared uniforms (call it from custom onBeforeCompile hooks too). */
export function atmosphereUniforms(shader: { uniforms: Record<string, THREE.IUniform> }): void {
  shader.uniforms.uFogSunDir = ATMOS.sunDir;
  shader.uniforms.uFogSunScatter = ATMOS.sunScatter;
  shader.uniforms.uFogFalloff = ATMOS.heightFalloff;
  shader.uniforms.uFogBase = ATMOS.baseHeight;
}

// ------------------------------------------------------------------ Preetham sky (CPU twin of the sky shader)

export interface SkyParams {
  turbidity: number;
  rayleigh: number;
  mieCoefficient: number;
  mieDirectionalG: number;
}

const totalRayleigh = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MieConst = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const cutoffAngle = 1.6110731556870734;
const steepness = 1.5;
const EE = 1000;

/**
 * Sky radiance (linear, before tone mapping) for a view direction — the same
 * formula as the sky shader, so fog and sky agree.
 */
export function skyRadiance(dir: THREE.Vector3, sun: THREE.Vector3, p: SkyParams, out = new THREE.Color()): THREE.Color {
  const sunE = EE * Math.max(0, 1 - Math.exp(-(cutoffAngle - Math.acos(Math.max(-1, Math.min(1, sun.y)))) / steepness));
  const betaR = totalRayleigh.map((v) => v * p.rayleigh);
  const c = 0.2 * p.turbidity * 10e-18;
  const betaM = MieConst.map((v) => 0.434 * c * v * p.mieCoefficient);
  const zenith = Math.acos(Math.max(0, dir.y));
  const inv = 1 / (Math.cos(zenith) + 0.15 * Math.pow(93.885 - (zenith * 180) / Math.PI, -1.253));
  const sR = 8.4e3 * inv;
  const sM = 1.25e3 * inv;
  const cosTheta = dir.dot(sun);
  const rPhase = (3 / (16 * Math.PI)) * (1 + Math.pow(cosTheta * 0.5 + 0.5, 2));
  const g = p.mieDirectionalG;
  const mPhase = (1 / (4 * Math.PI)) * ((1 - g * g) / Math.pow(1 - 2 * g * cosTheta + g * g, 1.5));
  const res = [0, 0, 0];
  const sunLow = Math.min(1, Math.max(0, Math.pow(1 - sun.y, 5)));
  for (let i = 0; i < 3; i++) {
    const Fex = Math.exp(-(betaR[i] * sR + betaM[i] * sM));
    const ratio = (betaR[i] * rPhase + betaM[i] * mPhase) / (betaR[i] + betaM[i]);
    let Lin = Math.pow(sunE * ratio * (1 - Fex), 1.5);
    Lin *= 1 + (Math.pow(sunE * ratio * Fex, 0.5) - 1) * sunLow;
    const L0 = 0.1 * Fex;
    const tex = (Lin + L0) * 0.04 + [0, 0.0003, 0.00075][i];
    res[i] = Math.pow(tex, 1 / 2.4);
  }
  return out.setRGB(res[0], res[1], res[2]);
}

/** Colour of direct sunlight after crossing the atmosphere (white at noon, orange/red near the horizon). */
export function sunTransmittance(sun: THREE.Vector3, p: SkyParams, out = new THREE.Color()): THREE.Color {
  const fex = (y: number) => {
    const zenith = Math.acos(Math.max(0.0, y));
    const inv = 1 / (Math.cos(zenith) + 0.15 * Math.pow(Math.max(1e-3, 93.885 - (zenith * 180) / Math.PI), -1.253));
    const c = 0.2 * p.turbidity * 10e-18;
    return totalRayleigh.map((r, i) => Math.exp(-(r * p.rayleigh * 8.4e3 * inv + 0.434 * c * MieConst[i] * p.mieCoefficient * 1.25e3 * inv)));
  };
  const a = fex(Math.max(0.02, sun.y));
  const z = fex(1);
  return out.setRGB(Math.min(1, a[0] / z[0]), Math.min(1, a[1] / z[1]), Math.min(1, a[2] / z[2]));
}
