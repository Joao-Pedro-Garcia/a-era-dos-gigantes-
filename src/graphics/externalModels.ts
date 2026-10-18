import * as THREE from 'three';

/**
 * Optional artist-made models (GLB/glTF with animations) that replace the
 * procedural ones. They are listed in `public/models/manifest.json`; the game
 * ships with an empty manifest, so nothing is downloaded unless files are
 * added. See public/models/README.md for the format.
 *
 * Loaded models are cloned per individual (skeletons included) and driven by
 * an AnimationMixer: the clip is chosen from the animal/player state, and the
 * locomotion clips are time-scaled by real speed ÷ the clip's own ground
 * speed so feet stay planted.
 */
export interface ModelEntry {
  url: string;
  scale: number;
  strideM: number;
  clips: Partial<Record<ClipName, string>>;
  /** Ground speed (m/s, at scale 1) each locomotion clip was animated at; overrides strideM. */
  clipSpeeds: Partial<Record<'walk' | 'run', number>>;
  /** Author credit (required by CC-BY files). */
  credit: ModelCredit | null;
}
export interface ModelCredit {
  title: string;
  author: string;
  url: string;
  license: string;
}
export type ClipName = 'idle' | 'walk' | 'run' | 'eat' | 'drink' | 'rest' | 'attack' | 'roar' | 'swim' | 'fly' | 'death';
export interface ModelManifest {
  version: number;
  species: Record<string, ModelEntry>;
  player: ModelEntry | null;
}

const CLIPS: ClipName[] = ['idle', 'walk', 'run', 'eat', 'drink', 'rest', 'attack', 'roar', 'swim', 'fly', 'death'];

/** Validates a manifest read from disk (unknown or malformed entries are dropped). */
export function parseManifest(raw: unknown): ModelManifest {
  const out: ModelManifest = { version: 1, species: {}, player: null };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const entry = (e: unknown): ModelEntry | null => {
    if (!e || typeof e !== 'object') return null;
    const x = e as Record<string, unknown>;
    if (typeof x.url !== 'string' || !/^[\w\-./]+\.(glb|gltf|gltf\.json)$/i.test(x.url) || x.url.includes('..') || /^[a-z]+:/i.test(x.url)) return null;
    const clips: Partial<Record<ClipName, string>> = {};
    if (x.clips && typeof x.clips === 'object') for (const c of CLIPS) if (typeof (x.clips as Record<string, unknown>)[c] === 'string') clips[c] = (x.clips as Record<string, string>)[c];
    const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    const clipSpeeds: Partial<Record<'walk' | 'run', number>> = {};
    if (x.clipSpeeds && typeof x.clipSpeeds === 'object')
      for (const c of ['walk', 'run'] as const) {
        const v = (x.clipSpeeds as Record<string, unknown>)[c];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) clipSpeeds[c] = Math.min(40, Math.max(0.05, v));
      }
    let credit: ModelCredit | null = null;
    const c = x.credit as Record<string, unknown> | undefined;
    const str = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 200;
    if (c && typeof c === 'object' && str(c.title) && str(c.author) && str(c.license) && str(c.url) && /^https:\/\/[\w.-]+\//.test(c.url as string))
      credit = { title: c.title as string, author: c.author as string, url: c.url as string, license: c.license as string };
    return { url: x.url, scale: num(x.scale, 1, 0.001, 1000), strideM: num(x.strideM, 1, 0.05, 20), clips, clipSpeeds, credit };
  };
  if (r.species && typeof r.species === 'object')
    for (const [id, e] of Object.entries(r.species as Record<string, unknown>)) {
      const m = entry(e);
      if (m && /^[a-z_]+$/.test(id)) out.species[id] = m;
    }
  out.player = entry(r.player);
  return out;
}

/** Which clip to play for a state/speed, falling back to what the file has. */
export function chooseClip(available: Set<ClipName>, state: string, speed: number, walkSpeed: number, runSpeed: number, airborne: boolean, current: ClipName | null = null): ClipName | null {
  const want: ClipName[] = [];
  if (state === 'dead') want.push('death');
  else if (airborne) want.push('fly');
  // Hysteresis: the thresholds depend on the clip already playing, so a speed
  // hovering around a limit does not flicker between clips.
  const mid = (walkSpeed + runSpeed) / 2;
  const runFrom = current === 'run' ? mid * 0.85 : mid * 1.1;
  const walkFrom = current === 'walk' || current === 'run' ? 0.05 : 0.15;
  if (speed > runFrom) want.push('run', 'walk');
  else if (speed > walkFrom) want.push('walk', 'run');
  else if (state === 'drink') want.push('drink', 'eat', 'idle');
  else if (state === 'graze' || state === 'eat') want.push('eat', 'idle');
  else if (state === 'rest') want.push('rest', 'idle');
  else if (state === 'defend' || state === 'hunt') want.push('attack', 'idle');
  else if (state === 'alert') want.push('roar', 'idle');
  want.push('idle', 'walk');
  for (const c of want) if (available.has(c)) return c;
  return null;
}

interface Loaded {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  entry: ModelEntry;
}

const loaded = new Map<string, Loaded>();
let manifest: ModelManifest = { version: 1, species: {}, player: null };
let ready: Promise<unknown> | null = null;

/** Credits of the files listed in the manifest (for the credits screen). */
export function modelCredits(): { id: string; credit: ModelCredit }[] {
  const out: { id: string; credit: ModelCredit }[] = [];
  for (const [id, e] of Object.entries(manifest.species)) if (e.credit) out.push({ id, credit: e.credit });
  if (manifest.player?.credit) out.push({ id: 'player', credit: manifest.player.credit });
  return out;
}

/** Reads the manifest and loads the listed files (no-op with the default empty manifest). */
export function loadExternalModels(base = './models/'): Promise<{ loaded: string[]; failed: string[] }> {
  const p = loadAll(base);
  ready = p;
  return p;
}

async function loadAll(base: string): Promise<{ loaded: string[]; failed: string[] }> {
  const result = { loaded: [] as string[], failed: [] as string[] };
  try {
    const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return result;
    manifest = parseManifest(await res.json());
  } catch {
    return result;
  }
  const jobs = Object.entries(manifest.species).map(([id, e]) => [id, e] as const);
  if (manifest.player) jobs.push(['player', manifest.player]);
  if (!jobs.length) return result;
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/examples/jsm/loaders/GLTFLoader.js'), import('three/examples/jsm/libs/meshopt_decoder.module.js')]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  await Promise.all(
    jobs.map(async ([id, e]) => {
      try {
        const gltf = await loader.loadAsync(`${base}${e.url}`);
        // Bind-pose bounds once, so clones never skin every vertex on the CPU to get them.
        gltf.scene.traverse((o) => {
          const m = o as THREE.SkinnedMesh;
          if (!m.isSkinnedMesh) return;
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          m.boundingSphere = m.geometry.boundingSphere!.clone();
          m.boundingSphere.radius *= 1.3;
          m.boundingBox = m.geometry.boundingBox!.clone();
        });
        loaded.set(id, { scene: gltf.scene, animations: gltf.animations, entry: e });
        result.loaded.push(id);
      } catch {
        result.failed.push(id);
      }
    }),
  );
  return result;
}

export interface ExternalInstance {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<ClipName, THREE.AnimationAction>;
  current: ClipName | null;
  entry: ModelEntry;
  meshes: THREE.Mesh[];
  shadows: boolean;
  dispose(): void;
}

/** Turns shadow casting on or off for the whole instance (cheap when unchanged). */
export function setExternalShadows(inst: ExternalInstance, on: boolean): void {
  if (inst.shadows === on) return;
  inst.shadows = on;
  for (const m of inst.meshes) m.castShadow = on;
}

/** A per-individual clone of an external model (null when none is registered). */
export async function instantiate(id: string): Promise<ExternalInstance | null> {
  if (ready) await ready.catch(() => undefined);
  const src = loaded.get(id);
  if (!src) return null;
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  const root = clone(src.scene);
  root.scale.setScalar(src.entry.scale);
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      meshes.push(o as THREE.Mesh);
      o.castShadow = true;
      o.receiveShadow = true;
      // Skinned bounds follow the bind pose; animated limbs must not be culled.
      o.frustumCulled = false;
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<ClipName, THREE.AnimationAction>();
  for (const c of CLIPS) {
    const name = src.entry.clips[c];
    const clip = name ? src.animations.find((a) => a.name === name) : undefined;
    if (!clip) continue;
    const action = mixer.clipAction(clip);
    if (c === 'death') {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    actions.set(c, action);
  }
  return {
    root,
    mixer,
    actions,
    current: null,
    entry: src.entry,
    meshes,
    shadows: true,
    dispose: () => mixer.stopAllAction(),
  };
}

/**
 * One throw-away instance of every loaded model, for compiling their shaders
 * on the loading screen instead of mid-game (the first appearance of a new
 * material otherwise blocks a frame for hundreds of ms on weak GPUs).
 */
export async function warmupInstances(): Promise<ExternalInstance[]> {
  if (ready) await ready.catch(() => undefined);
  const out: ExternalInstance[] = [];
  for (const id of loaded.keys()) {
    const inst = await instantiate(id);
    if (!inst) continue;
    // Pose it once so skinning matrices are valid.
    const first = inst.actions.values().next().value;
    first?.play();
    inst.mixer.update(0);
    out.push(inst);
  }
  return out;
}

export function hasExternal(id: string): boolean {
  return loaded.has(id);
}

/** Playback rate that keeps the feet of a locomotion clip planted at `speed` (m/s, model scale 1). */
export function locomotionRate(entry: ModelEntry, clip: 'walk' | 'run', duration: number, speed: number): number {
  const native = entry.clipSpeeds[clip];
  // Without a measured speed: one clip cycle covers two steps of strideM.
  const rate = native ? speed / native : (speed * (duration || 1)) / (2 * entry.strideM);
  return Math.min(3, Math.max(0.15, rate));
}

/** Drives an instance: cross-fades to the right clip and scales locomotion to the real speed. */
export function driveExternal(inst: ExternalInstance, dt: number, state: string, speed: number, walkSpeed: number, runSpeed: number, airborne: boolean): void {
  const clip = chooseClip(new Set(inst.actions.keys()), state, speed, walkSpeed, runSpeed, airborne, inst.current);
  if (clip && clip !== inst.current) {
    const next = inst.actions.get(clip)!;
    const prev = inst.current ? inst.actions.get(inst.current)! : null;
    next.reset().play();
    const gait = (c: ClipName | null) => c === 'walk' || c === 'run';
    if (prev && gait(inst.current) && gait(clip)) {
      // Walk ↔ run: start the new cycle at the same point of the stride so the feet don't jump.
      const u = (prev.time / prev.getClip().duration) % 1;
      next.time = u * next.getClip().duration;
    }
    if (prev) prev.crossFadeTo(next, gait(inst.current) && gait(clip) ? 0.4 : clip === 'death' ? 0.2 : 0.3, false);
    inst.current = clip;
  }
  if (clip === 'walk' || clip === 'run') {
    // One clip cycle covers two steps of strideM: match it to the distance travelled.
    const a = inst.actions.get(clip)!;
    a.timeScale = locomotionRate(inst.entry, clip, a.getClip().duration, speed);
  }
  inst.mixer.update(dt);
}
