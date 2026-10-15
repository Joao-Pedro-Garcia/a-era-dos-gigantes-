import * as THREE from 'three';
import { createAnimal } from '../animals/animal';
import { createAnimalView, poseAnimalView } from '../animals/animalView';
import { SPECIES_IDS, SPECIES } from '../animals/species';
import { Rng } from '../core/rng';

/**
 * Developer showcase (open the game with ?showcase): every species lined up
 * on a flat stage, walking in place, for model and animation review.
 * Optional ?species=id focuses one species; ?side shows a side view.
 */
export function runShowcase(canvas: HTMLCanvasElement): void {
  const params = new URLSearchParams(location.search);
  const only = params.get('species');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
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
    const v = createAnimalView(id);
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
