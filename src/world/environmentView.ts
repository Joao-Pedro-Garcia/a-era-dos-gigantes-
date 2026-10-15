import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { QualityProfile } from '../core/config';
import { clamp, lerp } from '../core/math';
import type { Environment } from './environment';
import { VOLCANO } from './terrain';

/**
 * Visual side of the environment: physically based sky, sun/moon light,
 * fog, water surface, precipitation, lightning, wildfires and the volcano.
 */
export class EnvironmentView {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4030, 0.6);
  private sky = new Sky();
  private water: THREE.Mesh;
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private flash = 0;
  private fireGroup = new THREE.Group();
  private fireLight = new THREE.PointLight(0xff7a2a, 0, 120, 1.6);
  private volcanoLight = new THREE.PointLight(0xff4a10, 0, 2200, 1.2);
  private smoke: THREE.Points;
  private fireMat: THREE.PointsMaterial;
  private sunDir = new THREE.Vector3();
  readonly fog: THREE.FogExp2;
  /** Inside a cave: no sky light, dark fog. */
  indoor = false;
  private particles = 1;
  private effects = true;

  constructor(scene: THREE.Scene, private env: Environment) {
    this.sky.scale.setScalar(20000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.85;
    scene.add(this.sky);

    this.fog = new THREE.FogExp2(0xa8b8c8, 0.0018);
    scene.fog = this.fog;

    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -70;
    cam.right = cam.top = 70;
    cam.near = 1;
    cam.far = 600;
    scene.add(this.sun, this.sun.target, this.hemi);

    const wgeo = new THREE.PlaneGeometry(4000, 4000, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(
      wgeo,
      new THREE.MeshStandardMaterial({ color: 0x2a5560, roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.82 }),
    );
    this.water.receiveShadow = true;
    this.water.renderOrder = 1;
    scene.add(this.water);

    // Rain streaks around the camera.
    const N = 2500;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 80;
      const y = Math.random() * 40;
      const z = (Math.random() - 0.5) * 80;
      this.rainPos.set([x, y, z, x, y - 0.8, z], i * 6);
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rgeo, new THREE.LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.35 }));
    this.rain.frustumCulled = false;
    scene.add(this.rain);

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
    this.rain.geometry.setDrawRange(0, Math.floor((this.rainPos.length / 3) * Math.max(0.05, q.particles)));
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, snowy: boolean): void {
    const env = this.env;
    const s = env.state;
    // Sun path: rises in the east (+x), sets in the west, tilted to the south.
    const ang = (env.dayFraction - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(ang), Math.sin(ang), 0.35).normalize();
    const u = this.sky.material.uniforms;
    const night = env.sunElevation < 0;
    const lightDir = night ? this.sunDir.clone().multiplyScalar(-1) : this.sunDir; // moon opposite
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = lerp(3, 14, s.intensity) + (env.eruptionActive ? 6 : 0);
    u.rayleigh.value = lerp(1.4, 0.6, s.intensity);

    const day = env.daylight;
    const cloud = s.intensity;
    this.sun.position.copy(focus).addScaledVector(lightDir, 300);
    this.sun.target.position.copy(focus);
    const low = clamp(env.sunElevation * 4, 0, 1);
    this.sun.color.setRGB(1, lerp(0.55, 0.96, low), lerp(0.35, 0.9, low));
    if (night) this.sun.color.setRGB(0.55, 0.65, 0.9);
    this.sun.intensity = night ? 0.18 * (1 - cloud * 0.7) : lerp(0.2, 3.2, day) * (1 - cloud * 0.65);
    this.hemi.intensity = lerp(0.08, 0.75, day) * (1 - cloud * 0.25) + this.flash * 3;

    // Fog colour follows the sky brightness; density follows weather.
    const fogC = new THREE.Color().setRGB(lerp(0.03, 0.66, day), lerp(0.04, 0.74, day), lerp(0.07, 0.82, day));
    fogC.lerp(new THREE.Color(0x6f7478).multiplyScalar(lerp(0.15, 1, day)), cloud * 0.6);
    if (env.eruptionActive) fogC.lerp(new THREE.Color(0x4a3a30), 0.3);
    this.fog.color.copy(fogC);
    this.fog.density = 0.0014 + env.fogDensity * 0.012;
    this.sky.visible = !this.indoor;
    if (this.indoor) {
      this.sun.intensity = 0;
      this.hemi.intensity = 0.04;
      this.fog.color.setRGB(0.01, 0.01, 0.012);
      this.fog.density = 0.03;
    }

    // Water follows the player (it's an infinite sea at waterLevel).
    this.water.position.set(Math.round(focus.x / 50) * 50, env.waterLevel, Math.round(focus.z / 50) * 50);

    // Precipitation.
    const precip = s.weather === 'rain' || s.weather === 'storm' ? s.intensity : 0;
    this.rain.visible = precip > 0.05 && !this.indoor && this.particles > 0;
    if (this.rain.visible) {
      const mat = this.rain.material as THREE.LineBasicMaterial;
      mat.opacity = 0.35 * precip;
      mat.color.set(snowy ? 0xffffff : 0xaabbcc);
      const fall = (snowy ? 3 : 28) * dt;
      const drift = Math.cos(s.windDir) * s.windSpeed * dt * 0.3;
      const p = this.rainPos;
      for (let i = 0; i < p.length; i += 6) {
        p[i + 1] -= fall;
        p[i + 4] -= fall;
        p[i] += drift;
        p[i + 3] += drift * (snowy ? 1 : 1.2);
        if (p[i + 4] < -5) {
          const x = (Math.random() - 0.5) * 80;
          const z = (Math.random() - 0.5) * 80;
          const len = snowy ? 0.12 : 0.8;
          p.set([x, 35, z, x, 35 - len, z], i);
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.position.copy(camera.position).setY(camera.position.y - 15);
    }

    // Lightning flash.
    if (env.lightning) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 4);

    // Wildfires near the player.
    this.updateFires(focus, dt);

    // Volcano.
    const erupt = env.eruptionActive;
    this.smoke.visible = erupt && this.effects && !this.indoor;
    this.volcanoLight.intensity = !this.effects ? 0 : erupt ? 40000 : 2500;
    if (erupt) this.smoke.rotation.y += dt * 0.05;
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
}
