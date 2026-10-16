import * as THREE from 'three';
import type { QualityProfile } from '../core/config';
import { clamp, lerp } from '../core/math';
import { ATMOS, skyRadiance, sunTransmittance, type SkyParams } from '../graphics/atmosphere';
import { SkyDome } from '../graphics/sky';
import { WIND } from '../graphics/wind';
import { WaterSurface } from '../graphics/water';
import { Precipitation } from '../graphics/precipitation';
import type { Environment } from './environment';
import { VOLCANO } from './terrain';

/**
 * Visual side of the environment: atmospheric sky with clouds, sun/moon
 * light coloured by the atmosphere, image-based ambient light rendered from
 * the sky, aerial-perspective fog, stable shadows, water, precipitation,
 * lightning, wildfires and the volcano.
 */
export class EnvironmentView {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  /** Sky/ground bounce light (fallback when image-based lighting is off; bounce term otherwise). */
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4030, 0.6);
  readonly sky = new SkyDome();
  readonly water: WaterSurface;
  private precip: Precipitation;
  private flash = 0;
  private fireGroup = new THREE.Group();
  private fireLight = new THREE.PointLight(0xff7a2a, 0, 120, 1.6);
  private volcanoLight = new THREE.PointLight(0xff4a10, 0, 2200, 1.2);
  private smoke: THREE.Points;
  private fireMat: THREE.PointsMaterial;
  private sunDir = new THREE.Vector3();
  private lightDir = new THREE.Vector3();
  readonly fog: THREE.FogExp2;
  /** Inside a cave: no sky light, dark fog. */
  indoor = false;
  private particles = 1;
  private effects = true;
  private shadowRange = 70;
  private shadowMapSize = 2048;
  // Image-based lighting from the sky.
  private skyLighting = true;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene = new THREE.Scene();
  private envSky = new SkyDome(3);
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envKey = '';
  private envTimer = 0;
  /** 0..1 rain wetness of surfaces (dries slowly). */
  wetness = 0;
  /** Suggested tone-mapping exposure (eye adaptation); applied by the game. */
  exposure = 0.85;
  private tmpC = new THREE.Color();
  private tmpV = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private env: Environment,
  ) {
    scene.add(this.sky);
    this.envScene.add(this.envSky);

    this.fog = new THREE.FogExp2(0xa8b8c8, 0.0005);
    scene.fog = this.fog;

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.05;
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 900;
    scene.add(this.sun, this.sun.target, this.hemi);

    this.water = new WaterSurface();
    scene.add(this.water.mesh);
    this.precip = new Precipitation();
    scene.add(this.precip.object);

    this.fireMat = new THREE.PointsMaterial({ color: 0xff8a30, size: 2.2, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    scene.add(this.fireGroup, this.fireLight);

    // Volcano: glow and an ash column.
    const sN = 400;
    const sp = new Float32Array(sN * 3);
    for (let i = 0; i < sN; i++) sp.set([(Math.random() - 0.5) * 60, Math.random() * 500, (Math.random() - 0.5) * 60], i * 3);
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.smoke = new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0x3a3632, size: 40, transparent: true, opacity: 0.5, depthWrite: false }));
    this.smoke.position.set(VOLCANO.x, VOLCANO.height - 60, VOLCANO.z);
    this.smoke.visible = false;
    this.volcanoLight.position.set(VOLCANO.x, VOLCANO.height - 40, VOLCANO.z);
    scene.add(this.smoke, this.volcanoLight);
  }

  applyQuality(q: QualityProfile): void {
    this.particles = q.particles;
    this.effects = q.effects;
    this.precip.setDensity(q.particles);
    this.sun.castShadow = q.shadows;
    this.shadowRange = q.shadowRange;
    this.shadowMapSize = q.shadowMapSize;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -q.shadowRange;
    cam.right = cam.top = q.shadowRange;
    cam.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    // Normal offset of about one texel avoids acne without detaching shadows.
    this.sun.shadow.normalBias = ((2 * q.shadowRange) / q.shadowMapSize) * 1.2;
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.sky.setOctaves(q.effects ? 5 : 3);
    this.sky.u.cloudCover.value = q.clouds ? this.sky.u.cloudCover.value : 0;
    this.skyLighting = q.skyLighting;
    if (!q.skyLighting) {
      this.scene.environment = null;
      this.envKey = '';
    }
    this.water.setQuality(q);
  }

  private skyParams(): SkyParams {
    const s = this.env.state;
    return {
      turbidity: lerp(2.6, 12, s.intensity) + (this.env.eruptionActive ? 6 : 0),
      rayleigh: lerp(1.5, 0.7, s.intensity),
      mieCoefficient: lerp(0.004, 0.012, s.intensity),
      mieDirectionalG: 0.82,
    };
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, snowy: boolean, renderer?: THREE.WebGLRenderer): void {
    const env = this.env;
    const s = env.state;
    // Sun path: rises in the east (+x), sets in the west, tilted to the south.
    const ang = (env.dayFraction - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    const night = env.sunElevation < -0.02;
    const nightF = clamp(-env.sunElevation * 6, 0, 1);
    this.lightDir.copy(night ? this.tmpV.copy(this.sunDir).multiplyScalar(-1) : this.sunDir); // moon opposite
    const p = this.skyParams();
    const cloud = s.intensity;
    const coverage = clamp(0.12 + (s.weather === 'cloudy' ? 0.45 : 0) + (s.weather === 'fog' ? 0.3 : 0) + cloud * 0.75, 0, 1);

    // --- Sky uniforms.
    const u = this.sky.u;
    u.sunDir.value.copy(this.sunDir);
    u.moonDir.value.copy(this.sunDir).multiplyScalar(-1);
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = p.mieCoefficient;
    u.mieDirectionalG.value = p.mieDirectionalG;
    u.cloudCover.value = this.effects || coverage > 0.5 ? coverage : coverage * 0.6;
    u.cloudDark.value = clamp(cloud * 1.1 - 0.2, 0, 0.85);
    u.night.value = nightF;
    WIND.update(dt, s.windDir, s.windSpeed);
    u.cloudOffset.value.x += WIND.dir.x * (s.windSpeed + 2) * dt * 0.00012;
    u.cloudOffset.value.y += WIND.dir.y * (s.windSpeed + 2) * dt * 0.00012;

    // --- Horizon (fog) colour from the same atmospheric model as the sky.
    const side = this.tmpV.set(-this.sunDir.z, 0.05, this.sunDir.x).normalize();
    const horizon = skyRadiance(side, this.sunDir, p, new THREE.Color());
    const toward = skyRadiance(this.tmpV.set(this.sunDir.x, 0.05, this.sunDir.z).normalize(), this.sunDir, p, this.tmpC);
    const scatter = new THREE.Color(Math.max(0, toward.r - horizon.r), Math.max(0, toward.g - horizon.g), Math.max(0, toward.b - horizon.b));
    // Overcast skies are grey; night keeps a faint blue.
    const daylight = env.daylight;
    const grey = new THREE.Color().setRGB(0.55, 0.58, 0.6).multiplyScalar(lerp(0.05, 1, daylight));
    horizon.lerp(grey, coverage * coverage * 0.75);
    // Under heavy rain clouds the haze is as dark as the cloud base.
    horizon.multiplyScalar(1 - u.cloudDark.value * 0.5);
    scatter.multiplyScalar(1 - coverage * 0.8);
    horizon.lerp(new THREE.Color(0.012, 0.018, 0.035), nightF * 0.85);
    if (env.eruptionActive) horizon.lerp(new THREE.Color(0.25, 0.18, 0.14), 0.3);
    u.horizonColor.value.copy(horizon);

    // --- Sun / moon light: colour from atmospheric transmittance.
    const trans = sunTransmittance(this.sunDir, p, this.tmpC);
    const sunCol = night ? new THREE.Color(0.5, 0.6, 0.85) : trans;
    u.sunLight.value.copy(sunCol).multiplyScalar(night ? 0.1 : clamp(this.sunDir.y * 4, 0, 1) * 1.2);
    this.sun.color.copy(sunCol);
    // Thick cloud turns direct sunlight into diffuse skylight (soft, almost shadowless).
    const occlusion = 1 - coverage * 0.8 - cloud * 0.35;
    this.sun.intensity = night ? 0.22 * (1 - cloud * 0.7) * nightF : lerp(0, 3.7, clamp(this.sunDir.y * 3.2, 0, 1)) * clamp(occlusion, 0.05, 1);
    // Stable shadows: snap the light's centre to the shadow-map texel grid.
    const texel = (2 * this.shadowRange) / this.shadowMapSize;
    const L = this.lightDir;
    const right = new THREE.Vector3().crossVectors(L, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    const up = new THREE.Vector3().crossVectors(right, L).normalize();
    const fr = focus.dot(right);
    const fu = focus.dot(up);
    const c = focus.clone().addScaledVector(right, Math.round(fr / texel) * texel - fr).addScaledVector(up, Math.round(fu / texel) * texel - fu);
    this.sun.position.copy(c).addScaledVector(L, 450);
    this.sun.target.position.copy(c);

    // --- Ambient: image-based light from the sky, plus ground bounce (approximate GI).
    const groundBounce = new THREE.Color(0.32, 0.28, 0.2).multiplyScalar(this.sun.intensity * 0.12);
    if (this.skyLighting && renderer) {
      this.updateEnvMap(renderer, dt);
      this.scene.environmentIntensity = (lerp(0.2, 0.68, daylight) * (1 - cloud * 0.15) + this.flash * 2) * (this.indoor ? 0.05 : 1);
      this.hemi.color.setRGB(0, 0, 0);
      this.hemi.groundColor.copy(groundBounce);
      this.hemi.intensity = 1;
    } else {
      this.hemi.color.copy(horizon).multiplyScalar(0.9);
      this.hemi.groundColor.copy(groundBounce).add(new THREE.Color(0.03, 0.025, 0.02));
      this.hemi.intensity = lerp(0.25, 1.1, daylight) * (1 - cloud * 0.2) + this.flash * 3;
    }

    // --- Eye adaptation: dim scenes (dusk, storms, night) are exposed brighter, like a camera would.
    const adapt = clamp(daylight * (1 - cloud * 0.4), 0, 1);
    this.exposure += (lerp(night ? 1.9 : 1.5, 0.95, adapt) * (this.indoor ? 1.6 : 1) - this.exposure) * Math.min(1, dt * 0.8);

    // --- Fog: density from weather, height falloff keeps peaks clear.
    this.fog.color.copy(horizon);
    ATMOS.sunDir.value.copy(this.sunDir);
    ATMOS.sunScatter.value.copy(scatter).multiplyScalar(night ? 0 : 1);
    ATMOS.baseHeight.value = env.waterLevel;
    ATMOS.heightFalloff.value = s.weather === 'fog' ? 0.02 : 0.006;
    this.fog.density = 0.00011 + env.fogDensity * 0.0045 + cloud * 0.0004 + (env.eruptionActive ? 0.0008 : 0);
    this.sky.visible = !this.indoor;
    if (this.indoor) {
      this.sun.intensity = 0;
      this.hemi.color.setRGB(0, 0, 0);
      this.hemi.groundColor.setRGB(0.02, 0.018, 0.015);
      this.hemi.intensity = 1;
      this.fog.color.setRGB(0.005, 0.005, 0.006);
      this.fog.density = 0.03;
      ATMOS.heightFalloff.value = 0;
      ATMOS.sunScatter.value.setRGB(0, 0, 0);
    }

    // --- Wetness: rain soaks surfaces quickly, they dry slowly in the sun.
    const precip = s.weather === 'rain' || s.weather === 'storm' ? s.intensity : 0;
    const raining = precip > 0.05 && !snowy && !this.indoor;
    this.wetness = clamp(this.wetness + (raining ? dt * 0.05 * (0.5 + precip) : -dt * 0.004 * (0.3 + daylight)), 0, 1);

    this.water.update(dt, focus, env.waterLevel, horizon, sunCol, this.sunDir, this.sun.intensity, raining ? precip : 0, this.scene.environment);
    this.precip.update(dt, camera, precip, snowy, this.indoor, this.particles);

    // Lightning flash.
    if (env.lightning) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 4);

    this.updateFires(focus, dt);

    // Volcano.
    const erupt = env.eruptionActive;
    this.smoke.visible = erupt && this.effects && !this.indoor;
    this.volcanoLight.intensity = !this.effects ? 0 : erupt ? 40000 : 2500;
    if (erupt) this.smoke.rotation.y += dt * 0.05;
  }

  /** Re-renders the sky into a prefiltered environment map when it changed noticeably. */
  private updateEnvMap(renderer: THREE.WebGLRenderer, dt: number): void {
    this.envTimer -= dt;
    const u = this.sky.u;
    const key = [u.sunDir.value.x, u.sunDir.value.y, u.sunDir.value.z].map((v) => Math.round(v * 30)).join(',') + `|${Math.round(u.cloudCover.value * 10)}|${Math.round(u.night.value * 5)}|${this.indoor}`;
    if (key === this.envKey && this.scene.environment) return;
    if (this.envTimer > 0 && this.scene.environment) return;
    this.envTimer = 2;
    this.envKey = key;
    // The env sky shares the live uniforms, minus the sun disc's glare (it would dominate the cube map).
    const eu = this.envSky.u;
    for (const k of Object.keys(u) as (keyof typeof u)[]) {
      const src = u[k].value as unknown;
      const dst = eu[k] as { value: unknown };
      if (src instanceof THREE.Vector3 || src instanceof THREE.Vector2 || src instanceof THREE.Color) (dst.value as THREE.Vector3).copy(src as THREE.Vector3);
      else dst.value = src;
    }
    this.pmrem ??= new THREE.PMREMGenerator(renderer);
    const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 10);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
  }

  private updateFires(focus: THREE.Vector3, dt: number): void {
    const fires = this.env.state.fires;
    while (this.fireGroup.children.length > fires.length) {
      const c = this.fireGroup.children.pop() as THREE.Points;
      c.geometry.dispose();
    }
    let nearest = Infinity;
    fires.forEach((f, i) => {
      let pts = this.fireGroup.children[i] as THREE.Points | undefined;
      if (!pts) {
        const N = 300;
        const arr = new Float32Array(N * 3);
        for (let k = 0; k < arr.length; k += 3) arr[k + 1] = Math.random() * 6;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        pts = new THREE.Points(geo, this.fireMat);
        pts.frustumCulled = false;
        pts.userData.fresh = true;
        this.fireGroup.add(pts);
      }
      const arr = pts.geometry.attributes.position.array as Float32Array;
      for (let k = 0; k < arr.length; k += 3) {
        arr[k + 1] += dt * (2 + (k % 7));
        if (arr[k + 1] > 3 + f.intensity * 6 || pts.userData.fresh) {
          const a = Math.random() * Math.PI * 2;
          const r = Math.sqrt(Math.random()) * f.r;
          arr[k] = f.x + Math.cos(a) * r;
          arr[k + 2] = f.z + Math.sin(a) * r;
          if (!pts.userData.fresh) arr[k + 1] = 0;
        }
      }
      pts.userData.fresh = false;
      pts.geometry.attributes.position.needsUpdate = true;
      pts.geometry.setDrawRange(0, Math.floor(300 * Math.max(0.1, this.particles)));
      const d = Math.hypot(f.x - focus.x, f.z - focus.z);
      if (d < nearest) {
        nearest = d;
        this.fireLight.position.set(f.x, focus.y + 6, f.z);
        this.fireLight.intensity = this.effects ? 400 * f.intensity : 0;
      }
    });
    if (!fires.length) this.fireLight.intensity = 0;
  }

  /** Lets fire particles sit on the ground. */
  groundFires(height: (x: number, z: number) => number): void {
    this.env.state.fires.forEach((f, i) => {
      const pts = this.fireGroup.children[i] as THREE.Points | undefined;
      if (pts) pts.position.y = height(f.x, f.z);
    });
  }

  dispose(): void {
    this.envRT?.dispose();
    this.pmrem?.dispose();
    this.envSky.geometry.dispose();
    this.envSky.material.dispose();
    this.water.dispose();
    this.precip.dispose();
  }
}
