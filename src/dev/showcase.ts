import { loadHumanClips } from '../player/humanClips';
import * as THREE from 'three';
import { createAnimal } from '../animals/animal';
import { type AttackPose, createAnimalView, poseAnimalView, setAnimalContext } from '../animals/animalView';
import { loadExternalModels } from '../graphics/externalModels';
import { SPECIES_IDS, SPECIES } from '../animals/species';
import { Rng } from '../core/rng';
import { installAtmosphere } from '../graphics/atmosphere';
import { TextureLibrary } from '../graphics/textureLibrary';
import { PlayerView } from '../player/playerView';
import { Viewmodel } from '../player/viewmodel';
import { ACTIONS, CombatController, actionKindFor } from '../combat/actions';
import type { PlayerController } from '../player/player';

/**
 * Developer showcase (open the game with ?showcase): every species lined up
 * on a flat stage, walking in place, for model and animation review.
 * Optional ?species=id focuses one species; ?side shows a side view.
 * ?ext also loads the artist models from public/models; ?state=… and
 * ?still / ?run pick the behaviour and speed shown.
 */
export function runShowcase(canvas: HTMLCanvasElement): void {
  const params = new URLSearchParams(location.search);
  // Motion-captured human clips (?proc keeps the procedural gait for comparison).
  if (!params.has('proc')) void loadHumanClips();
  if (params.has('ext'))
    void loadExternalModels().then((r) => {
      (window as unknown as { __extReady: unknown }).__extReady = r;
    });
  if (params.has('combat')) {
    runCombatShowcase(canvas, params);
    return;
  }
  if (params.has('seq')) {
    runHumanSequence(canvas, params);
    return;
  }
  if (params.has('human')) {
    runHumanShowcase(canvas, params);
    return;
  }
  if (params.has('sheet')) {
    runSpeciesSheet(canvas, params);
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

  // ?attack=<move>: the species in four poses of one attack (rest, end of the
  // wind-up, mid strike, mid recovery), side by side.
  const move = params.get('attack') as AttackPose['kind'] | null;
  const poses: (AttackPose | null)[] = [null, { kind: move!, phase: 'windup', u: 1 }, { kind: move!, phase: 'strike', u: 0.6 }, { kind: move!, phase: 'recover', u: 0.35 }];
  const ids = only && move ? [only, only, only, only] : only ? [only] : SPECIES_IDS;
  const rng = new Rng(1);
  let x = 0;
  const items = ids.map((id, idx) => {
    const sp = SPECIES[id];
    const a = createAnimal({ id: `${id}-${idx}`, speciesId: id, x: 0, z: 0, bornAt: -1e9, groupId: 'g', rng });
    const v = createAnimalView(id, `show-${id}-${idx}`);
    x += sp.lengthM / 2 + 3;
    a.x = x;
    a.z = 0;
    a.heading = params.has('side') ? Math.PI / 2 : 0.6;
    a.speed = params.has('still') ? 0 : params.has('run') ? sp.runSpeed : sp.walkSpeed;
    a.state = (params.get('state') ?? (params.has('run') ? 'flee' : 'wander')) as typeof a.state;
    x += sp.lengthM / 2 + 3;
    scene.add(v.root);
    return { a, v, sp, stride: 0, atk: move ? poses[idx] : null };
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
  const dist = only && !move ? maxLen * 1.8 + 4 : total * 0.5;
  camera.position.set(total / 2, only ? (move ? maxLen * 0.35 : maxLen * 0.5) : 18, dist);
  camera.lookAt(total / 2, only ? maxLen * 0.25 : 2, 0);
  if (params.has('top')) {
    camera.position.set(total / 2, total * 0.55, 1);
    camera.lookAt(total / 2, 0, 0);
  }
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
      poseAnimalView(it.v, it.a, it.stride, it.sp.locomotion.flies && !params.has('ground') ? 3 : 0, 0, dt, 10, 70, it.atk);
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
/**
 * Animation review (?showcase&seq=turn|stop|jump|punch|crouch|walk): one survivor driven by a
 * scripted controller, advanced deterministically at 60 Hz by `window.__seqStep(frames)`
 * (no real-time loop), so frame strips can be captured before/after a change.
 * &side / &front choose the camera; &ext loads the artist body.
 */
function runHumanSequence(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  installAtmosphere();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fb4c8);
  const sun = new THREE.DirectionalLight(0xfff2e0, 4);
  sun.position.set(4, 8, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2, far: 30 });
  scene.add(sun, new THREE.HemisphereLight(0xbcd0e8, 0x5a4a38, 1.1));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x6f7048, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  // Floor marks every metre: foot sliding shows against them.
  for (let i = -10; i <= 10; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 20), new THREE.MeshBasicMaterial({ color: 0x4a4a30 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(i, 0.002, 0);
    scene.add(m);
  }
  const tex = new TextureLibrary();
  tex.request(512);
  const seq = params.get('seq') ?? 'walk';
  const v = new PlayerView(tex);
  scene.add(v.root);
  const c = new CombatController();
  const p = { s: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, bodyYaw: 0, horizontalSpeed: 0, onGround: true, swimming: false, crouching: false, sprinting: false, stride: 0, visualY: 0, vy: 0, stepLength: () => Math.min(1.6, Math.max(1.1, 1.1 + ((p.horizontalSpeed - 3.3) / 3.1) * 0.5)) };
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  let t = 0;
  // Scripted controller: speed, yaw, jump and the punch request over time.
  const script = (time: number): void => {
    if (seq === 'turn') {
      p.horizontalSpeed = 0;
      p.bodyYaw = time < 0.4 ? 0 : Math.min(1.7, (time - 0.4) * 3.2);
    } else if (seq === 'stop') {
      p.horizontalSpeed = time < 1 ? 6.4 : Math.max(0, 6.4 - (time - 1) * 16);
      p.sprinting = p.horizontalSpeed > 4;
    } else if (seq === 'jump') {
      p.horizontalSpeed = 0;
      const j = time - 0.4;
      if (j > 0 && j < 0.85) {
        p.onGround = false;
        p.vy = 4.8 - 11.3 * j;
        p.s.y = Math.max(0, 4.8 * j - 0.5 * 11.3 * j * j);
      } else {
        p.onGround = true;
        p.vy = 0;
        p.s.y = 0;
      }
      p.visualY = p.s.y;
    } else if (seq === 'punch') {
      p.horizontalSpeed = 0;
    } else if (seq === 'crouch') {
      p.crouching = true;
      p.horizontalSpeed = time < 0.6 ? 0 : 1.6;
    } else {
      p.horizontalSpeed = 1.6;
    }
  };
  const frame = (): void => {
    const dt = 1 / 60;
    t += dt;
    script(t);
    p.stride += (p.horizontalSpeed * dt) / p.stepLength();
    // The body moves for real (sliding feet would show against the floor marks).
    p.s.x += Math.sin(p.bodyYaw) * p.horizontalSpeed * dt;
    p.s.z += Math.cos(p.bodyYaw) * p.horizontalSpeed * dt;
    if (seq === 'punch' && Math.abs(t - 0.5) < 0.009) c.request();
    c.update(dt, { pressed: false, held: false, wanted: '', hasAmmo: true });
    v.update(dt, p as unknown as PlayerController, false, undefined, c);
  };
  const view = (): void => {
    const side = params.has('front') ? 0 : Math.PI / 2;
    const d = seq === 'stop' ? 6 : 4.2;
    camera.position.set(p.s.x + Math.sin(side) * d, 1.15 + p.s.y, p.s.z + Math.cos(side) * d);
    camera.lookAt(p.s.x, 0.95 + p.s.y, p.s.z);
    renderer.render(scene, camera);
  };
  (window as unknown as { __seqStep: (n: number) => number }).__seqStep = (n: number) => {
    for (let i = 0; i < n; i++) frame();
    view();
    return t;
  };
  view();
  (window as unknown as { __showcaseReady: boolean }).__showcaseReady = true;
}

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
    const c = new CombatController();
    if (i === 0 && params.has('tool')) c.shown = 'stone_axe';
    const p = { s: { x: (i - 2) * 1.6, y: 0, z: 0, yaw: 0, pitch: 0 }, bodyYaw: params.has('side') ? Math.PI / 2 : params.has('back') ? Math.PI : 0, horizontalSpeed: m.speed, onGround: true, swimming: false, crouching: m.crouch, sprinting: m.sprint, stride: i * 0.3, visualY: 0, stepLength: () => Math.min(1.6, Math.max(1.1, 1.1 + ((m.speed - 3.3) / 3.1) * 0.5)) };
    return { v, p, m, c };
  });
  const camera = new THREE.PerspectiveCamera(params.has('close') ? 22 : 35, 1, 0.1, 100);
  const fit = () => {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  fit();
  addEventListener('resize', fit);
  if (params.has('face')) {
    // Portrait of the idle survivor (eyes, skin, hair).
    camera.fov = 12;
    camera.position.set(-3.2 + 0.25, 1.68, 1.6);
    camera.lookAt(-3.2, 1.64, 0);
    camera.updateProjectionMatrix();
  } else if (params.has('close')) {
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
      a.v.update(dt, a.p as unknown as PlayerController, false, undefined, a.c);
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(loop);
  (window as unknown as { __showcaseReady: boolean }).__showcaseReady = true;
}

/**
 * Combat review (?showcase&combat): every weapon frozen at one action phase,
 * in third person (a row of survivors seen from the side or the front) or
 * in first person (&fp: the arms as the player sees them).
 *   &phase=ready|windup|impact|follow|recover|draw  &item=<id> (fp)  &front
 *   &anim : loop the attacks instead of freezing them.
 */
function freeze(c: CombatController, item: string, phase: string): void {
  c.shown = item;
  const kind = actionKindFor(item);
  c.def = ACTIONS[kind];
  c.hand = 'R';
  c.lowered = 0;
  if (phase === 'ready') {
    c.phase = 'idle';
    c.t = 0;
  } else if (phase === 'windup') {
    c.phase = 'windup';
    c.t = c.def.windup;
  } else if (phase === 'impact') {
    c.phase = kind === 'bow' ? 'release' : 'strike';
    c.t = c.def.strike * c.def.impactAt;
  } else if (phase === 'follow') {
    c.phase = 'strike';
    c.t = c.def.strike;
  } else if (phase === 'recover') {
    c.phase = 'recover';
    c.t = c.def.recover * 0.5;
  } else if (phase === 'draw') {
    c.phase = kind === 'bow' ? 'draw' : 'windup';
    c.t = 0.5;
    c.draw = 1;
  } else if (phase === 'left') {
    c.phase = 'strike';
    c.hand = 'L';
    c.t = c.def.strike * c.def.impactAt;
  }
}

function runCombatShowcase(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  installAtmosphere();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fa7bd);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3);
  sun.position.set(4, 8, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -8;
  sc.right = sc.top = 8;
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a4a35, 0.7);
  scene.add(sun, hemi);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshStandardMaterial({ color: 0x5f6b45, roughness: 0.95 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const tex = new TextureLibrary();
  tex.request(512);
  const phase = params.get('phase') ?? 'impact';
  const anim = params.has('anim');
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  const fit = () => {
    if (renderer.domElement.width === innerWidth * renderer.getPixelRatio() && camera.aspect === innerWidth / innerHeight) return;
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  };
  fit();
  addEventListener('resize', fit);

  if (params.has('fp')) {
    // First person: a world camera at eye height and the viewmodel pass on top.
    const item = params.get('item') ?? '';
    const c = new CombatController();
    freeze(c, item, phase);
    const vm = new Viewmodel(tex);
    vm.visible = true;
    camera.fov = 72;
    camera.position.set(0, 1.65, 0);
    camera.rotation.set(-0.05, 0, 0, 'YXZ');
    // Something to hit: a tree trunk and a rock in front.
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 6, 12), new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.9 }));
    trunk.position.set(0.3, 3, -1.8);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.7, 1), new THREE.MeshStandardMaterial({ color: 0x77736c, roughness: 0.9 }));
    rock.position.set(-1.4, 0.3, -2.6);
    scene.add(trunk, rock);
    let last = performance.now();
    let time = 0;
    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      if (anim) {
        if (!c.busy) c.request();
        c.update(dt, { pressed: false, held: false, wanted: item, hasAmmo: true });
      }
      fit();
      camera.updateMatrixWorld();
      vm.update(anim ? dt : 0.5, camera, c, { x: 0, y: 0 }, 0, time, { dir: sun.position.clone().normalize(), color: sun.color, intensity: sun.intensity, sky: hemi.color, ground: hemi.groundColor, hemi: hemi.intensity, env: null });
      renderer.autoClear = true;
      renderer.render(scene, camera);
      vm.render(renderer);
    };
    requestAnimationFrame(loop);
    (window as unknown as { __showcaseReady: boolean }).__showcaseReady = true;
    return;
  }

  const items = (params.get('items') ?? ',stone_axe,stone_pickaxe,spear,stone_knife,wooden_club,bow').split(',');
  const actors = items.map((item, i) => {
    const v = new PlayerView(tex);
    scene.add(v.root);
    const c = new CombatController();
    freeze(c, item, phase);
    const p = { s: { x: (i - (items.length - 1) / 2) * 1.5, y: 0, z: 0, yaw: 0, pitch: 0 }, bodyYaw: params.has('front') ? 0 : Math.PI / 2, horizontalSpeed: 0, onGround: true, swimming: false, crouching: false, sprinting: false, stride: 0, visualY: 0, stepLength: () => 1.1 };
    return { v, p, c, item };
  });
  const span = items.length * 1.5;
  camera.position.set(0, 1.3, span * 1.05 + 2);
  camera.lookAt(0, 1.0, 0);
  const close = params.get('close');
  if (close !== null) {
    // Close-up of one survivor (index), seen from its front-right.
    const x = actors[Number(close)]?.p.s.x ?? 0;
    camera.fov = 30;
    camera.position.set(x + 1.2, 1.55, 3.0);
    camera.lookAt(x + 0.25, 1.25, 0);
    camera.updateProjectionMatrix();
  }
  const handParam = params.get('hand');
  const handCam = handParam !== null ? { i: Number(handParam), off: params.has('palm') ? new THREE.Vector3(-0.15, 0.05, 0.6) : new THREE.Vector3(0.6, 0.1, 0.25) } : null;
  if (handCam) {
    camera.fov = 22;
    camera.updateProjectionMatrix();
  }
  let last = performance.now();
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const a of actors) {
      if (anim) {
        if (!a.c.busy) a.c.request();
        a.c.update(dt, { pressed: false, held: false, wanted: a.item, hasAmmo: true });
      }
      // Frozen poses still need the IK weights to settle: step with a large dt.
      a.v.update(anim ? dt : 0.5, a.p as unknown as PlayerController, false, undefined, a.c);
    }
    if (handCam) {
      // &hand=<index>: the right hand of one survivor filling the frame (grip review).
      const hb = (actors[handCam.i]?.v as unknown as { rig: { bones: Record<string, THREE.Bone> } }).rig.bones['hand.R'];
      const w = hb.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -0.08, 0));
      camera.position.copy(w).add(handCam.off);
      camera.lookAt(w);
    }
    renderer.render(scene, camera);
  };
  requestAnimationFrame(loop);
  (window as unknown as { __showcaseReady: boolean }).__showcaseReady = true;
}

/**
 * Review sheet for one species (?showcase&sheet&species=id): six views in
 * one frame, all of the same individual at the same moment of a walk:
 * side, front, back, three-quarter head close-up, far (low-detail LOD) and
 * a shaded "flex" view (neck turned, mouth open, as when threatening).
 * &juvenile shows a young animal instead of an adult.
 */
function runSpeciesSheet(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const id = params.get('species') ?? 'tyrannosaurus';
  const sp = SPECIES[id];
  installAtmosphere();
  const lib = new TextureLibrary();
  lib.request(512);
  setAnimalContext(lib, null);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xb8c8d4);
  const sun = new THREE.DirectionalLight(0xfff4e6, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const L = sp.lengthM;
  Object.assign(sun.shadow.camera, { left: -L, right: L, top: L, bottom: -L, far: L * 6 });
  sun.position.set(L * 0.8, L * 2, L * 1.2);
  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x5a5040, 1);
  scene.add(sun, hemi);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(L * 40, 900), Math.max(L * 40, 900)), new THREE.MeshStandardMaterial({ color: 0x7a8a48, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  if (sp.locomotion.aquatic) {
    // Marine animals are reviewed over a dark sea floor.
    ground.position.y = -1.5;
    (ground.material as THREE.MeshStandardMaterial).color.set(0x2d4a55);
    scene.background = new THREE.Color(0x9fb8c8);
  }
  const rng = new Rng(1);
  const juvenile = params.has('juvenile');
  // Born 1/4 of the way to maturity (juvenile) or long ago (adult).
  const bornAt = juvenile ? -sp.reproduction.maturityDays * 1200 * 0.25 : -1e9;
  const a = createAnimal({ id: `sheet-${id}`, speciesId: id, x: 0, z: 0, bornAt, groupId: 'g', rng });
  const v = createAnimalView(id, `sheet-${id}`, juvenile);
  scene.add(v.root);
  (window as unknown as { __sheet: unknown }).__sheet = { v, a, pose: poseAnimalView, THREE };
  // Flyers are reviewed standing (&air shows them airborne, legs tucked).
  const flies = sp.locomotion.flies && params.has('air');
  const W = innerWidth;
  const Hh = innerHeight;
  renderer.setSize(W, Hh, false);
  const cam = new THREE.PerspectiveCamera(30, (W / 3) / (Hh / 2), 0.05, Math.max(L * 60, 1500));
  const label = document.createElement('div');
  label.style.cssText = 'position:fixed;left:8px;top:8px;color:#111;font:13px system-ui;background:#fff9;padding:4px 8px;border-radius:6px';
  label.textContent = `${sp.name['pt-BR']} (${sp.scientificName})${juvenile ? ' — filhote' : ''} · lateral · frente · trás · cabeça 3/4 · longe (LOD) · ${sp.locomotion.flies ? 'em voo' : 'sombra/ameaça'}`;
  document.body.appendChild(label);
  const H = sp.hipHeightM * (juvenile ? 0.5 : 1);
  const S = juvenile ? 0.5 : 1;
  const views: { pos: THREE.Vector3; look: THREE.Vector3; fov: number; shade?: boolean; flex?: boolean; far?: boolean }[] = [
    { pos: new THREE.Vector3(L * 1.9 * S, H * 0.9, 0), look: new THREE.Vector3(0, H * 0.8, 0), fov: 32 },
    { pos: new THREE.Vector3(0, H * 1.1, L * 1.5 * S), look: new THREE.Vector3(0, H * 0.9, 0), fov: 32 },
    { pos: new THREE.Vector3(0, H * 1.2, -L * 1.5 * S), look: new THREE.Vector3(0, H * 0.9, 0), fov: 32 },
    { pos: new THREE.Vector3(L * 0.35 * S, H * 1.25, L * 0.62 * S), look: new THREE.Vector3(0, H * 1.0, L * 0.3 * S), fov: 34 },
    // Beyond the LOD distance (far, single-material mesh), framed so the animal fills the view.
    { pos: new THREE.Vector3(80, 12, 80), look: new THREE.Vector3(0, H * 0.8, 0), fov: Math.max(1.2, (2 * Math.atan((L * 0.75) / 113) * 180) / Math.PI), far: true },
    { pos: new THREE.Vector3(L * 1.1 * S, H * 1.0, L * 1.1 * S), look: new THREE.Vector3(0, H * 0.9, L * 0.1 * S), fov: 34, shade: true, flex: true },
  ];
  // Flyers: the last view shows the animal in flight (wings spread) from below and behind.
  const flyer = sp.locomotion.flies;
  if (flyer) views[5] = { pos: new THREE.Vector3(L * 1.6, H * 0.4 + 2, -L * 1.4), look: new THREE.Vector3(0, H + 2, 0), fov: 38, flex: false };
  let t = 0;
  let last = performance.now();
  const stride = 0.3;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    views.forEach((vw, i) => {
      const col = i % 3;
      const row = 1 - Math.floor(i / 3);
      const x = Math.floor((col * W) / 3);
      const y = Math.floor((row * Hh) / 2);
      renderer.setViewport(x, y, Math.floor(W / 3) - 2, Math.floor(Hh / 2) - 2);
      renderer.setScissor(x, y, Math.floor(W / 3) - 2, Math.floor(Hh / 2) - 2);
      a.heading = 0; // facing +Z
      a.speed = vw.flex ? 0 : sp.walkSpeed;
      a.state = vw.flex ? 'defend' : 'wander';
      a.x = a.z = 0;
      const camDist = vw.far ? 200 : 10;
      // A large step lets every smoothed value settle to this view's pose (views share one model).
      const inAir = flies || (flyer && i === 5);
      if (inAir) v.flap = 0.9;
      poseAnimalView(v, a, stride, inAir ? 10 : 0, t, inAir ? 0 : 1, camDist, 70);
      v.root.position.y = inAir ? 2 + H * 0.2 : 0;
      if (vw.flex) {
        // Head turned toward the viewer, jaw open (threat display).
        for (const n of ['neck1', 'neck2', 'neck3']) {
          const b = v.bones.get(n);
          if (b) b.rotation.y += 0.25;
        }
      }
      sun.intensity = vw.shade ? 0.25 : 3;
      hemi.intensity = vw.shade ? 0.55 : 1;
      cam.fov = vw.fov;
      cam.aspect = (W / 3) / (Hh / 2);
      cam.position.copy(vw.pos);
      cam.lookAt(vw.look);
      if (i === 3) {
        // Head close-up: frame the head bone wherever the neck put it.
        const hb = v.bones.get('head');
        if (hb) {
          v.root.updateMatrixWorld(true);
          const hp = hb.getWorldPosition(new THREE.Vector3());
          const r = Math.max(0.12, (sp.lengthM * (sp.locomotion.plan === 'pterosaur' ? 0.4 : sp.locomotion.plan === 'quadruped' || sp.locomotion.plan === 'crocodyliform' ? 0.22 : 0.14)) * S);
          cam.position.set(hp.x + r * 1.6, hp.y + r * 0.5, hp.z + r * 2.2);
          cam.lookAt(hp.x, hp.y, hp.z + r * 0.5);
        }
      }
      cam.updateProjectionMatrix();
      renderer.render(scene, cam);
    });
  };
  requestAnimationFrame(loop);
  (window as unknown as { __showcaseReady: boolean }).__showcaseReady = true;
}
