import * as THREE from 'three';
import { createAnimal } from '../animals/animal';
import { createAnimalView, poseAnimalView, setAnimalContext } from '../animals/animalView';
import { SPECIES_IDS, SPECIES } from '../animals/species';
import { Rng } from '../core/rng';
import { installAtmosphere } from '../graphics/atmosphere';
import { TextureLibrary } from '../graphics/textureLibrary';
import { PlayerView } from '../player/playerView';
import type { PlayerController } from '../player/player';

/**
 * Developer showcase (open the game with ?showcase): every species lined up
 * on a flat stage, walking in place, for model and animation review.
 * Optional ?species=id focuses one species; ?side shows a side view.
 */
export function runShowcase(canvas: HTMLCanvasElement): void {
  const params = new URLSearchParams(location.search);
  if (params.has('human')) {
    runHumanShowcase(canvas, params);
    return;
  }
  const only = params.get('species');
  installAtmosphere();
  const lib = new TextureLibrary();
  lib.request(512);
  setAnimalContext(lib, null);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb8c8d4);
  scene.fog = new THREE.Fog(0xb8c8d4, 200, 600);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(30, 60, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 60, bottom: -60, far: 200 });
  scene.add(sun, new THREE.HemisphereLight(0xcfe0ff, 0x5a5040, 1));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 200), new THREE.MeshStandardMaterial({ color: 0x7a8a48, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const ids = only ? [only] : SPECIES_IDS;
  const rng = new Rng(1);
  let x = 0;
  const items = ids.map((id) => {
    const sp = SPECIES[id];
    const a = createAnimal({ id, speciesId: id, x: 0, z: 0, bornAt: -1e9, groupId: 'g', rng });
    const v = createAnimalView(id, `show-${id}`);
    x += sp.lengthM / 2 + 3;
    a.x = x;
    a.z = 0;
    a.heading = params.has('side') ? Math.PI / 2 : 0.6;
    a.speed = sp.walkSpeed;
    a.state = 'wander';
    x += sp.lengthM / 2 + 3;
    scene.add(v.root);
    return { a, v, sp, stride: 0 };
  });
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  const total = x;
  const fit = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  fit();
  addEventListener('resize', fit);
  const maxLen = Math.max(...items.map((i) => i.sp.lengthM));
  const dist = only ? maxLen * 1.8 + 4 : total * 0.42;
  camera.position.set(total / 2, only ? maxLen * 0.5 : 18, dist);
  camera.lookAt(total / 2, only ? maxLen * 0.25 : 2, 0);
  if (only && params.has('close')) {
    // Three-quarter view at eye level, framing the head and fore body.
    const sp0 = SPECIES[only];
    camera.position.set(total / 2 + sp0.lengthM * 0.55, sp0.hipHeightM * 1.15, sp0.lengthM * 0.55);
    camera.lookAt(total / 2 + sp0.lengthM * 0.15, sp0.hipHeightM * 0.95, 0);
  }
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;top:8px;color:#222;font:12px system-ui;background:#fff8;padding:4px 8px;border-radius:6px';
  label.textContent = ids.join(' · ');
  document.body.appendChild(label);
  let t = 0;
  let last = performance.now();
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    for (const it of items) {
      it.stride += (it.a.speed * dt) / it.sp.locomotion.stride;
      poseAnimalView(it.v, it.a, it.stride, it.sp.locomotion.flies && !params.has('ground') ? 3 : 0, 0, dt, 10);
      it.v.root.position.y = it.sp.locomotion.flies && !params.has('ground') ? 3 : 0;
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(loop);
  (window as unknown as { __showcaseReady: boolean }).__showcaseReady = true;
}

/**
 * ?showcase&human: the survivor model idle, walking, running and crouching
 * side by side (optionally ?side for a profile view, ?close for a close-up).
 */
function runHumanShowcase(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  installAtmosphere();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c8);
  const sun = new THREE.DirectionalLight(0xfff2e0, 4);
  sun.position.set(4, 8, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 4, bottom: -2, far: 30 });
  sun.shadow.normalBias = 0.02;
  scene.add(sun, new THREE.HemisphereLight(0xbcd0e8, 0x5a4a38, 1.1));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x6f7048, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const tex = new TextureLibrary();
  tex.request(512);
  const modes = [
    { speed: 0, crouch: false, sprint: false },
    { speed: 1.6, crouch: false, sprint: false },
    { speed: 3.3, crouch: false, sprint: false },
    { speed: 6.4, crouch: false, sprint: true },
    { speed: 1.2, crouch: true, sprint: false },
  ];
  const actors = modes.map((m, i) => {
    const v = new PlayerView(tex);
    scene.add(v.root);
    if (i === 0 && params.has('tool')) v.setHeld('stone_axe');
    const p = { s: { x: (i - 2) * 1.6, y: 0, z: 0, yaw: 0, pitch: 0 }, bodyYaw: params.has('side') ? Math.PI / 2 : params.has('back') ? Math.PI : 0, horizontalSpeed: m.speed, onGround: true, swimming: false, crouching: m.crouch, sprinting: m.sprint, stride: i * 0.3 };
    return { v, p, m };
  });
  const camera = new THREE.PerspectiveCamera(params.has('close') ? 22 : 35, 1, 0.1, 100);
  const fit = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  fit();
  addEventListener('resize', fit);
  if (params.has('close')) {
    camera.position.set(-3.2 + 0.4, 1.6, 2.2);
    camera.lookAt(-3.2, 1.45, 0);
  } else {
    camera.position.set(0, 1.4, 9.5);
    camera.lookAt(0, 0.9, 0);
  }
  let last = performance.now();
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const a of actors) {
      a.p.stride += (a.m.speed * dt) / (a.m.sprint ? 1.6 : 1.1);
      a.v.update(dt, a.p as unknown as PlayerController, false);
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(loop);
  (window as unknown as { __showcaseReady: boolean }).__showcaseReady = true;
}
