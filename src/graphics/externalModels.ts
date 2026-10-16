import * as THREE from 'three';

/**
 * Optional artist-made models (GLB/glTF with animations) that replace the
 * procedural ones. They are listed in `public/models/manifest.json`; the game
 * ships with an empty manifest, so nothing is downloaded unless files are
 * added. See public/models/README.md for the format.
 *
 * Loaded models are cloned per individual (skeletons included) and driven by
 * an AnimationMixer: the clip is chosen from the animal/player state, and the
 * locomotion clips are time-scaled by real speed ÷ the clip's stride so feet
 * stay planted.
 */
export interface ModelEntry {
  url: string;
  scale: number;
  strideM: number;
  clips: Partial<Record<ClipName, string>>;
}
export type ClipName = 'idle' | 'walk' | 'run' | 'eat' | 'rest' | 'attack' | 'swim' | 'fly';
export interface ModelManifest {
  version: number;
  species: Record<string, ModelEntry>;
  player: ModelEntry | null;
}

const CLIPS: ClipName[] = ['idle', 'walk', 'run', 'eat', 'rest', 'attack', 'swim', 'fly'];

/** Validates a manifest read from disk (unknown or malformed entries are dropped). */
export function parseManifest(raw: unknown): ModelManifest {
  const out: ModelManifest = { version: 1, species: {}, player: null };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const entry = (e: unknown): ModelEntry | null => {
    if (!e || typeof e !== 'object') return null;
    const x = e as Record<string, unknown>;
    if (typeof x.url !== 'string' || !/^[\w\-./]+\.(glb|gltf)$/i.test(x.url) || x.url.includes('..') || /^[a-z]+:/i.test(x.url)) return null;
    const clips: Partial<Record<ClipName, string>> = {};
    if (x.clips && typeof x.clips === 'object') for (const c of CLIPS) if (typeof (x.clips as Record<string, unknown>)[c] === 'string') clips[c] = (x.clips as Record<string, string>)[c];
    const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return { url: x.url, scale: num(x.scale, 1, 0.001, 1000), strideM: num(x.strideM, 1, 0.05, 20), clips };
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
export function chooseClip(available: Set<ClipName>, state: string, speed: number, walkSpeed: number, runSpeed: number, airborne: boolean): ClipName | null {
  const want: ClipName[] = [];
  if (airborne) want.push('fly');
  if (speed > (walkSpeed + runSpeed) / 2) want.push('run', 'walk');
  else if (speed > 0.08) want.push('walk', 'run');
  else if (state === 'graze' || state === 'eat' || state === 'drink') want.push('eat', 'idle');
  else if (state === 'rest') want.push('rest', 'idle');
  else if (state === 'defend' || state === 'hunt') want.push('attack', 'idle');
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

/** Reads the manifest and loads the listed files (no-op with the default empty manifest). */
export async function loadExternalModels(base = './models/'): Promise<{ loaded: string[]; failed: string[] }> {
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
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  for (const [id, e] of jobs) {
    try {
      const gltf = await loader.loadAsync(`${base}${e.url}`);
      loaded.set(id, { scene: gltf.scene, animations: gltf.animations, entry: e });
      result.loaded.push(id);
    } catch {
      result.failed.push(id);
    }
  }
  return result;
}

export interface ExternalInstance {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<ClipName, THREE.AnimationAction>;
  current: ClipName | null;
  entry: ModelEntry;
  dispose(): void;
}

/** A per-individual clone of an external model (null when none is registered). */
export async function instantiate(id: string): Promise<ExternalInstance | null> {
  const src = loaded.get(id);
  if (!src) return null;
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  const root = clone(src.scene);
  root.scale.setScalar(src.entry.scale);
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<ClipName, THREE.AnimationAction>();
  for (const c of CLIPS) {
    const name = src.entry.clips[c];
    const clip = name ? src.animations.find((a) => a.name === name) : undefined;
    if (clip) actions.set(c, mixer.clipAction(clip));
  }
  return {
    root,
    mixer,
    actions,
    current: null,
    entry: src.entry,
    dispose: () => mixer.stopAllAction(),
  };
}

export function hasExternal(id: string): boolean {
  return loaded.has(id);
}

/** Drives an instance: cross-fades to the right clip and scales locomotion to the real speed. */
export function driveExternal(inst: ExternalInstance, dt: number, state: string, speed: number, walkSpeed: number, runSpeed: number, airborne: boolean): void {
  const clip = chooseClip(new Set(inst.actions.keys()), state, speed, walkSpeed, runSpeed, airborne);
  if (clip && clip !== inst.current) {
    const next = inst.actions.get(clip)!;
    next.reset().play();
    if (inst.current) inst.actions.get(inst.current)!.crossFadeTo(next, 0.25, false);
    inst.current = clip;
  }
  if (clip === 'walk' || clip === 'run') {
    // One clip cycle covers two steps of strideM: match it to the distance travelled.
    const a = inst.actions.get(clip)!;
    const cycle = a.getClip().duration || 1;
    a.timeScale = (speed * cycle) / (2 * inst.entry.strideM);
  }
  inst.mixer.update(dt);
}
