import * as THREE from 'three';
import { AudioSystem, type Surface } from '../audio/audio';
import { growthScale, lifeStage, type AIState, type AnimalData, type TameCommand } from '../animals/animal';
import { updateAlphaAura } from '../animals/alphaAura';
import { createAnimalView, createNestView, disposeAnimalView, hitAnimalView, poseAnimalView, prewarmAnimals, setAnimalContext, type AnimalView } from '../animals/animalView';
import { CombatController } from '../combat/actions';
import { ImpactFx } from '../graphics/impactFx';
import { Viewmodel } from '../player/viewmodel';
import { prewarmPlants } from '../world/plants';
import { Ecosystem, createEcosystemState, type EcoContext, type EcoEvent } from '../animals/ecosystem';
import { SPECIES } from '../animals/species';
import { Building, PIECES, type Piece, type PieceType, type Placement } from '../building/building';
import { applyBuildingTextures, createGhost, createPieceObject, disposeObject, syncPieceObject } from '../building/pieceViews';
import { resolveDamage, snareable } from '../combat/combat';
import { Crafting } from '../crafting/crafting';
import { RECIPES, type Station } from '../crafting/recipes';
import { Exploration, createExploration } from '../exploration/exploration';
import { Input, type Action } from '../input/input';
import { Inventory, createInventory, type ItemList, type Stack } from '../inventory/inventory';
import { ITEMS, type EquipSlot } from '../inventory/items';
import { language, setLanguage, t } from '../localization/i18n';
import { Mysteries, createMysteries } from '../mysteries/mysteries';
import { PerfMonitor } from '../performance/perf';
import { CameraRig } from '../player/cameraRig';
import { PlayerController } from '../player/player';
import { PlayerView } from '../player/playerView';
import { Progression, SKILLS, TREES, createProgression, type Tree } from '../progression/skills';
import { SAVE_VERSION, SaveError, type ItemBag, type SaveData } from '../save/saveData';
import { deleteSave, exportSave, importSave, loadWithFallback, readSave, writeSave } from '../save/storage';
import { Survival, createSurvival } from '../survival/survival';
import { TAME_PROFILES } from '../taming/profiles';
import { release } from '../taming/taming';
import { TamingController } from '../taming/tamingController';
import { Hud, type MapMarker, type PanelTab } from '../ui/hud';
import { BIOMES, type BiomeId } from '../world/biomes';
import { CollisionWorld } from '../world/collision';
import { Environment, createEnvState, type EnvEvent } from '../world/environment';
import { EnvironmentView } from '../world/environmentView';
import { buildFarTerrain, farTerrainGeometry } from '../world/farTerrain';
import { TerrainJobs } from '../world/terrainMesh';
import { GroundCover } from '../world/groundCover';
import { createVegetationDepthMaterial, createVegetationMaterial } from '../graphics/vegetationMaterial';
import { installAtmosphere } from '../graphics/atmosphere';
import { PostFx } from '../graphics/postfx';
import { TextureLibrary } from '../graphics/textureLibrary';
import { createTerrainMaterial, createTerrainUniforms } from '../graphics/terrainMaterial';
import { WIND } from '../graphics/wind';
import { loadExternalModels, warmupInstances, type ExternalInstance } from '../graphics/externalModels';
import { CAVE_RADIUS, CAVE_Y, SectorManager } from '../world/sectors';
import { PLANNED_SITES, SPAWN, Terrain, VOLCANO } from '../world/terrain';
import { DIFFICULTY, effectiveQuality, loadSettings, saveSettings, type QualityLevel, type QualityProfile, type Settings } from './config';
import { Interactions, type Interaction } from './interactions';
import { clamp } from './math';
import { Rng } from './rng';
import { BuildController, HoldRepeat, type NudgeDir } from '../building/buildMode';
import { PieceThumbs } from '../building/pieceThumbs';
import { Profiler } from '../performance/profiler';

type GameState = 'menu' | 'loading' | 'playing' | 'paused' | 'dead' | 'ending';
const SAVE_SLOT = 'main';
const FOOTPRINT_MAX = 400;

/**
 * Top-level orchestrator: owns the renderer, the main loop and every system,
 * and implements the API the UI uses. Gameplay rules live in the systems;
 * this class wires them together. Player-facing interactions live in
 * `Interactions`, domestication glue in `TamingController`.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(65, 1, 0.1, 3000);
  settings: Settings;
  input: Input;
  hud: Hud;
  audio = new AudioSystem();
  perf: PerfMonitor;
  state: GameState = 'menu';
  hasSave = false;

  // World (created per session)
  seed = 0;
  terrain: Terrain | null = null;
  collision = new CollisionWorld();
  sectors: SectorManager | null = null;
  env: Environment | null = null;
  envView: EnvironmentView | null = null;
  /** Procedural PBR textures (generated progressively, shared by every world). */
  readonly textures: TextureLibrary;
  readonly terrainUniforms = createTerrainUniforms();
  private terrainMats: { detail: THREE.MeshStandardMaterial; flat: THREE.MeshStandardMaterial; far: THREE.MeshStandardMaterial } | null = null;
  private farTerrain: THREE.Mesh | null = null;
  private vegMats: { detail: THREE.MeshStandardMaterial; flat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial };
  private groundCover: GroundCover | null = null;
  private postfx: PostFx;
  eco: Ecosystem | null = null;
  buildingSys: Building | null = null;
  player: PlayerController | null = null;
  rig: CameraRig;
  playerView: PlayerView | null = null;
  survival: Survival | null = null;
  inventory = new Inventory();
  crafting = new Crafting();
  progression = new Progression(createProgression());
  exploration!: Exploration;
  mysteries = new Mysteries(createMysteries());
  taming = new TamingController();
  actions: Interactions;
  worldRoot = new THREE.Group();
  private animalViews = new Map<string, AnimalView>();
  private nestViews = new Map<string, THREE.Object3D>();
  private pieceViews = new Map<string, THREE.Object3D>();
  private bagViews = new Map<string, THREE.Object3D>();
  private lastStates = new Map<string, AIState>();
  private flares: { light: THREE.PointLight; until: number }[] = [];
  private footprints: THREE.InstancedMesh | null = null;
  private tracks = new Map<string, [number, number, number][]>();
  private shockCooldown = new Map<string, number>();
  private trapCooldown = new Map<string, number>();
  private lastStride = 0;
  private animalSteps = new Map<string, number>();
  bags: ItemBag[] = [];
  private nextBagId = 1;
  discovered = new Set<string>();
  seenSpecies = new Set<string>();
  selectedHotbar = 0;
  building = false;
  /** Build screen placement state (selected piece, anchor, lift, rotation, step). */
  readonly buildCtl = new BuildController();
  private buildRepeat = new HoldRepeat();
  /** 3D pictures of the build pieces (made lazily from the real models). */
  private thumbs: PieceThumbs | null = null;
  get pieceThumbs(): PieceThumbs {
    return (this.thumbs ??= new PieceThumbs(this.renderer));
  }
  /** Last validated placement shown by the preview (read by the build screen). */
  buildPlacement: Placement | null = null;
  get buildPiece(): PieceType | null {
    return this.buildCtl.selected;
  }
  get buildSnap(): boolean {
    return this.buildCtl.snap;
  }
  private ghost: THREE.Group | null = null;
  private ghostType: PieceType | null = null;
  private storageOpen: Piece | null = null;
  hostileUntil = 0;
  attackCooldown = 0;
  /** Combat/tool action state (shared by every input device and both camera modes). */
  readonly combat = new CombatController();
  /** First-person arms and held item. */
  readonly viewmodel: Viewmodel;
  /** Impact particles (splinters, chips, dust, splashes). */
  readonly fx = new ImpactFx();
  private kick = 0;
  private tmpSize = new THREE.Vector2();
  private lookDelta = { x: 0, y: 0 };
  private respawnPoint: { x: number; z: number; pieceId?: string } | null = null;
  private deaths = 0;
  private lastBiome: BiomeId | null = null;
  private autosave = 0;
  private uiTimer = 0;
  private slowTimer = 0;
  private sleeping = false;
  private lastDamageSource = 'other';
  private needWarned = { food: false, water: false };
  qualityLevel: QualityLevel;
  private last = performance.now();
  private interaction: Interaction | null = null;
  private time = 0;
  private showPerf = false;
  /** Section timings for the F3 diagnostics panel and performance tests. */
  readonly profiler = new Profiler();
  rng = new Rng(Date.now() & 0xffffffff);
  inCave: string | null = null;
  mountedId: string | null = null;
  private companionTarget: { id: string; until: number } | null = null;
  private lastDay = -1;
  private xpToast = new Map<Tree, number>();
  private xpToastTimer = 0;
  focusAnimal: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    setLanguage(this.settings.language);
    this.input = new Input(canvas);
    this.actions = new Interactions(this);
    this.hud = new Hud(this);
    this.hud.applyAccessibility(this.settings);
    this.input.onModeChange = (m) => this.hud.setTouchMode(m === 'touch');
    this.qualityLevel = this.settings.quality === 'auto' ? PerfMonitor.initialGuess() : this.settings.quality;
    this.perf = new PerfMonitor(this.qualityLevel);
    installAtmosphere();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.qualityLevel !== 'low', powerPreference: 'high-performance' });
    this.profiler.attachGl(this.renderer.getContext());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.textures = new TextureLibrary();
    const mk = (normals: boolean, far = false) => {
      const m = createTerrainMaterial(this.textures, this.terrainUniforms, { normals, far });
      m.userData.shared = true;
      return m;
    };
    this.terrainMats = { detail: mk(true), flat: mk(false), far: mk(false, true) };
    this.vegMats = {
      detail: createVegetationMaterial(this.textures.arrays.veg, { normals: true }),
      flat: createVegetationMaterial(this.textures.arrays.veg, { normals: false }),
      depth: createVegetationDepthMaterial(this.textures.arrays.veg),
    };
    for (const m of Object.values(this.vegMats)) m.userData.shared = true;
    this.postfx = new PostFx(this.renderer, this.scene, this.camera);
    this.viewmodel = new Viewmodel(this.textures);
    this.combat.clock = () => performance.now() / 1000;
    this.scene.add(this.fx.root);
    applyBuildingTextures(this.textures);
    this.scene.add(this.worldRoot);
    this.rig = new CameraRig(this.camera);
    this.applyQuality();
    this.audio.setVolumes(this.settings.volume);
    this.audio.onCaption = (text, x, z) => this.caption(text, x, z);
    this.progression.onLevel = (tree, level) => this.onLevelUp(tree, level);
    addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.onHidden();
      else this.audio.resume();
    });
    addEventListener('pagehide', () => this.onHidden());
    addEventListener('pointerdown', () => this.audio.unlock());
    addEventListener('keydown', (e) => {
      this.audio.unlock();
      if (e.code === 'F3') {
        this.showPerf = !this.showPerf;
        this.profiler.enabled = this.showPerf;
        this.profiler.reset();
        e.preventDefault();
      }
    });
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      void this.save(true);
      this.hud.fatal(t('error.contextLost'));
    });
    (window as unknown as { __edg: Game }).__edg = this;
  }

  async boot(): Promise<void> {
    // Optional artist models (empty manifest by default; failures fall back to procedural models).
    void loadExternalModels().then((r) => {
      if (r.failed.length) console.warn('Modelos externos não carregados:', r.failed.join(', '));
    });
    try {
      this.hasSave = !!(await readSave(SAVE_SLOT));
    } catch {
      // A corrupted main slot may still have a usable backup.
      this.hasSave = !!(await readSave(`${SAVE_SLOT}.backup`).catch(() => null));
    }
    this.hud.mainMenu();
    this.hud.setGameplayVisible(false);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ helpers used by modules

  /** Warning to show when the world finishes loading (e.g. a backup save was used). */
  private noticeOnStart: string | null = null;

  notify(key: string, params: Record<string, string | number> = {}, kind: 'info' | 'warn' | 'good' = 'info'): void {
    this.hud.notify(t(key, params), kind);
  }

  xp(tree: Tree, amount: number): void {
    this.progression.gain(tree, amount);
    this.xpToast.set(tree, (this.xpToast.get(tree) ?? 0) + amount);
  }

  private onLevelUp(tree: Tree, level: number): void {
    this.notify('skill.levelUp', { tree: t(`tree.${tree}`), n: level }, 'good');
    this.audio.sfx('craft');
  }

  learnSkill(id: string): void {
    if (this.progression.learn(id)) {
      this.notify('skill.learned', { what: t(`skill.${id}.name`) }, 'good');
      for (const u of this.progression.unlocks()) this.unlock(u);
    }
  }

  scanning(): boolean {
    return this.heldItem()?.id === 'research_scanner';
  }

  setCompanionTarget(id: string): void {
    this.companionTarget = { id, until: (this.env?.state.time ?? 0) + 20 };
  }

  addFlare(x: number, y: number, z: number): void {
    const light = new THREE.PointLight(0xff4a3a, 300, 60, 1.5);
    light.position.set(x, y, z);
    this.worldRoot.add(light);
    this.flares.push({ light, until: this.time + 20 });
  }

  private caption(text: string, x: number, z: number): void {
    if (!this.settings.captions || !this.player) return;
    const p = this.player.s;
    const ang = Math.atan2(x - p.x, z - p.z) - p.yaw;
    const a = Math.atan2(Math.sin(ang), Math.cos(ang));
    const dir = Math.abs(a) < 0.6 ? t('dir.front') : Math.abs(a) > 2.5 ? t('dir.behind') : a > 0 ? t('dir.left') : t('dir.right');
    this.hud.caption(`🔊 ${text} — ${dir}`);
  }

  // ------------------------------------------------------------------ rendering setup

  private resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.postfx?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  quality(): QualityProfile {
    return effectiveQuality(this.qualityLevel, this.settings.graphics);
  }

  private applyQuality(): void {
    const q = this.quality();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatioCap) * q.resolutionScale);
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = q.effects ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.envView?.applyQuality(q);
    this.textures.setAnisotropy(q.textures === 'high' ? Math.min(8, this.renderer.capabilities.getMaxAnisotropy()) : 2);
    this.textures.request(q.textureSize);
    this.sectors?.setMaterials({
      terrain: q.normalMaps ? this.terrainMats!.detail : this.terrainMats!.flat,
      vegetation: q.normalMaps ? this.vegMats.detail : this.vegMats.flat,
      vegetationDepth: this.vegMats.depth,
    });
    this.groundCover?.setQuality(q.groundCover, !q.normalMaps);
    this.postfx.enabled = q.postFx;
    this.fx.detail = q.normalMaps ? 1 : 0.5;
    this.postfx.setSize(innerWidth, innerHeight);
    // The far plane reaches the horizon (the continent is ~10 km across).
    this.camera.near = 0.2;
    this.camera.far = 14000;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ session lifecycle

  private freshSave(seed: number): SaveData {
    const terrain = new Terrain(seed);
    const spawn = terrain.findDryGround(SPAWN.x, SPAWN.z);
    const inv = new Inventory(createInventory());
    inv.add('field_journal', 1);
    inv.add('berries', 6);
    inv.autoHotbar();
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      seed,
      player: { x: spawn.x, y: terrain.height(spawn.x, spawn.z), z: spawn.z, yaw: Math.PI, survival: createSurvival(), respawn: null, deaths: 0 },
      inventory: inv.data,
      crafting: { queue: [], unlocked: [] },
      env: createEnvState(seed),
      eco: createEcosystemState(seed),
      building: { pieces: [], nextId: 1 },
      world: { harvested: {}, bags: [], nextBagId: 1, discovered: [], seen: [], flags: [], inCave: null },
      progression: createProgression(),
      exploration: createExploration(),
      mysteries: createMysteries(),
    };
  }

  newGame(seed: number): void {
    this.startWorld(this.freshSave(seed));
  }

  async continueGame(): Promise<void> {
    try {
      const res = await loadWithFallback(SAVE_SLOT);
      if (!res) return this.newGame(Date.now() % 1e6);
      // Shown once the world is on screen, so it is not lost behind the loading screen.
      if (res.fromBackup) this.noticeOnStart = 'save.usedBackup';
      if (res.issues.length) console.warn('Save repaired:', res.issues);
      this.startWorld(res.data);
    } catch (e) {
      console.error(e);
      this.hud.notify(`${t('save.loadFailed')} (${e instanceof SaveError ? e.code : 'erro'})`, 'warn');
    }
  }

  async restoreBackup(): Promise<void> {
    try {
      const b = await readSave(`${SAVE_SLOT}.backup`);
      if (!b) return this.notify('save.noBackup', {}, 'warn');
      this.startWorld(b.data);
    } catch (e) {
      console.error(e);
      this.notify('save.loadFailed', {}, 'warn');
    }
  }

  async deleteSave(): Promise<void> {
    await deleteSave(SAVE_SLOT);
    this.hasSave = false;
    this.hud.mainMenu();
  }

  /** Releases every GPU resource of the previous world. */
  private teardown(): void {
    this.dismount(true);
    this.playerView?.dispose();
    this.sectors?.terrainJobs?.dispose();
    this.sectors?.dispose();
    this.actions.clear();
    this.fx.clear();
    this.combat.cancel();
    for (const v of this.animalViews.values()) disposeAnimalView(v);
    this.animalViews.clear();
    for (const o of [...this.nestViews.values(), ...this.pieceViews.values(), ...this.bagViews.values()]) disposeObject(o);
    this.nestViews.clear();
    this.pieceViews.clear();
    this.bagViews.clear();
    this.lastStates.clear();
    this.tracks.clear();
    for (const f of this.flares) f.light.removeFromParent();
    this.flares = [];
    if (this.footprints) {
      this.footprints.geometry.dispose();
      (this.footprints.material as THREE.Material).dispose();
      this.footprints = null;
    }
    if (this.ghost) disposeObject(this.ghost);
    this.worldRoot.traverse((o) => o !== this.worldRoot && disposeObject(o));
    this.worldRoot.clear();
    this.collision = new CollisionWorld();
    this.farTerrain = null;
    this.groundCover?.clear();
    this.groundCover = null;
    if (this.envView) {
      this.envView.dispose();
      this.scene.environment = null;
      this.scene.traverse((o) => o !== this.worldRoot && o !== this.scene && disposeObject(o));
      this.scene.clear();
      this.scene.add(this.worldRoot);
      this.envView = null;
    }
    this.ghost = null;
    this.ghostType = null;
    this.building = false;
    this.inCave = null;
    this.renderer.renderLists.dispose();
  }

  private startWorld(save: SaveData): void {
    this.teardown();
    this.seed = save.seed;
    const terrain = (this.terrain = new Terrain(save.seed));
    this.env = new Environment(save.env, terrain);
    this.envView = new EnvironmentView(this.scene, this.env);
    this.sectors = new SectorManager(terrain, this.collision, save.seed, save.world.harvested, new Set(save.world.flags ?? []));
    this.worldRoot.add(this.sectors.root);
    // Terrain sector meshes are built off the main thread (no hitches when walking into new areas).
    try {
      this.sectors.terrainJobs = typeof Worker !== 'undefined' ? new TerrainJobs(save.seed) : null;
    } catch {
      this.sectors.terrainJobs = null;
    }
    // Whole-continent horizon mesh behind the streamed sectors (built in the worker when available).
    const addFar = (geo: THREE.BufferGeometry) => {
      if (this.terrain !== terrain) return; // world changed meanwhile
      this.farTerrain = new THREE.Mesh(geo, this.terrainMats!.far);
      this.farTerrain.userData.noAO = true;
      this.farTerrain.frustumCulled = false;
      // Drawn after the detailed sectors so the depth test discards the hidden parts.
      this.farTerrain.renderOrder = 5;
      this.worldRoot.add(this.farTerrain);
    };
    if (this.sectors.terrainJobs) void this.sectors.terrainJobs.far(this.quality().farRes, save.seed).then((d) => addFar(farTerrainGeometry(d)));
    else addFar(buildFarTerrain(terrain, (x, z) => this.sectors!.biomeCoarse(x, z), Math.min(160, this.quality().farRes)));
    this.envView.water.setHeightFn((x, z) => terrain.height(x, z));
    setAnimalContext(this.textures, (x, z) => terrain.height(x, z));
    this.sectors.applyTextures(this.textures);
    this.groundCover = new GroundCover(terrain, this.sectors.pools, (x, z) => this.sectors!.biomeCoarse(x, z), () => this.env!.waterLevel);
    this.eco = new Ecosystem(save.eco, terrain, this.env, save.seed);
    this.eco.onEvent = (e) => this.onEcoEvent(e);
    this.buildingSys = new Building(save.building, this.collision);
    this.inventory = new Inventory(save.inventory);
    this.progression = new Progression(save.progression);
    this.progression.onLevel = (tree, level) => this.onLevelUp(tree, level);
    this.crafting = new Crafting(new Set([...save.crafting.unlocked, ...this.progression.unlocks()]));
    this.crafting.queue = save.crafting.queue ?? [];
    this.exploration = new Exploration(save.exploration, terrain);
    this.exploration.onReveal = (n) => this.xp('exploration', Math.min(n, 20) * 0.5);
    this.mysteries = new Mysteries(save.mysteries);
    this.survival = new Survival(save.player.survival, DIFFICULTY[this.settings.difficulty]);
    this.player = new PlayerController({ x: save.player.x, y: save.player.y, z: save.player.z, yaw: save.player.yaw, pitch: -0.15 });
    this.playerView = new PlayerView(this.textures);
    this.worldRoot.add(this.playerView.root);
    this.respawnPoint = save.player.respawn;
    this.deaths = save.player.deaths ?? 0;
    this.bags = save.world.bags;
    this.nextBagId = save.world.nextBagId;
    this.discovered = new Set(save.world.discovered);
    this.seenSpecies = new Set(save.world.seen ?? []);
    this.inCave = save.world.inCave ?? null;
    this.envView.indoor = !!this.inCave;
    for (const p of this.buildingSys.pieces.values()) this.addPieceView(p);
    this.applyQuality();
    this.lastBiome = null;
    this.lastDay = this.env.day;
    this.state = 'loading';
    this.hud.closePanel();
    this.hud.setGameplayVisible(false);
    this.hud.loading(0);
  }

  private snapshot(): SaveData {
    const p = this.player!;
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      seed: this.seed,
      player: { x: p.s.x, y: p.s.y, z: p.s.z, yaw: p.s.yaw, survival: this.survival!.d, respawn: this.respawnPoint, deaths: this.deaths },
      inventory: this.inventory.data,
      crafting: { queue: this.crafting.queue, unlocked: [...this.crafting.unlocked] },
      env: this.env!.state,
      eco: this.eco!.serialize(),
      building: this.buildingSys!.serialize(),
      world: {
        harvested: this.sectors!.harvested,
        bags: this.bags,
        nextBagId: this.nextBagId,
        discovered: [...this.discovered],
        seen: [...this.seenSpecies],
        flags: [...this.sectors!.flags],
        inCave: this.inCave,
      },
      progression: this.progression.d,
      exploration: this.exploration.serialize(),
      mysteries: this.mysteries.d,
    };
  }

  async save(silent = false): Promise<void> {
    if (!this.player || this.state === 'loading' || this.state === 'menu') return;
    try {
      this.sectors!.pruneHarvested(this.env!.state.time);
      // structuredClone detaches the snapshot from live objects mutated during the async write.
      const snap = structuredClone(this.snapshot());
      for (const a of snap.eco.animals) if (a.tame) a.tame.ridden = false;
      await writeSave(SAVE_SLOT, snap);
      this.hasSave = true;
      if (!silent) this.hud.notify(t('menu.saved'), 'good');
    } catch (e) {
      console.error(e);
      this.hud.notify(`${t('menu.saveFailed')}: ${e instanceof Error ? e.message : String(e)}`, 'warn');
    }
  }

  exportSave(): void {
    if (!this.player) return;
    const blob = exportSave(structuredClone(this.snapshot()));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `era-dos-gigantes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async importSave(f: File): Promise<void> {
    try {
      const { data, issues } = await importSave(f);
      await writeSave(SAVE_SLOT, data);
      this.hasSave = true;
      this.hud.notify(issues.length ? t('save.importRepaired', { n: issues.length }) : t('menu.imported'), issues.length ? 'warn' : 'good');
      this.startWorld(data);
    } catch (e) {
      // Expected for invalid files: reported to the player, logged as a warning for diagnosis.
      console.warn('Import rejected:', e);
      const code = e instanceof SaveError ? e.code : 'json';
      this.hud.notify(`${t('menu.importFailed')}: ${t(`save.error.${code}`)}`, 'warn');
    }
  }

  private onHidden(): void {
    if (this.state === 'playing') {
      void this.save(true);
      this.pause();
    }
    this.audio.suspend();
  }

  quitToMenu(): void {
    void this.save(true).then(() => {
      this.teardown();
      this.player = null;
      this.state = 'menu';
      this.hud.closePanel();
      this.hud.setGameplayVisible(false);
      this.hud.mainMenu();
      this.audio.setMusicMood('off');
    });
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    document.exitPointerLock?.();
    this.hud.closePanel();
    this.hud.pauseMenu();
  }

  resume(): void {
    this.hud.closePanel();
    this.hud.closeDocument();
    this.storageOpen = null;
    if (this.state === 'paused') {
      this.state = 'playing';
      this.hud.hideMenu();
    }
    this.input.uiCapture = false;
  }

  applySettings(s: Partial<Settings>): void {
    Object.assign(this.settings, s);
    saveSettings(this.settings);
    if (s.language) setLanguage(s.language);
    if (s.difficulty && this.survival) this.survival.difficulty = DIFFICULTY[s.difficulty];
    if (s.quality) {
      this.qualityLevel = s.quality === 'auto' ? this.perf.level : s.quality;
      this.perf.level = this.qualityLevel;
    }
    if (s.quality || s.graphics) this.applyQuality();
    if (s.volume) this.audio.setVolumes(s.volume);
    this.hud.applyAccessibility(this.settings);
  }

  // ------------------------------------------------------------------ main loop

  /** Text of the F3 diagnostics panel: measured values only ("n/d" when unavailable). */
  private perfText(): string {
    const s = this.profiler.summary();
    const r = this.renderer.info;
    const memApi = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const f = (v: number) => v.toFixed(v < 10 ? 2 : 1);
    const top = (Object.entries(s.sections) as [string, number][])
      .filter(([, v]) => v >= 0.05)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${t(`perf.s.${k}`)} ${f(v)} (${t('perf.max')} ${f(s.sectionMax[k as keyof typeof s.sectionMax])})`);
    return [
      `${t('perf.fps', { fps: Math.round(this.perf.fps), q: this.qualityLevel })} · ${t('perf.frame')} ${f(s.frameAvg)} ms · 1% ${f(s.frameP99)} · ${t('perf.max')} ${f(s.frameMax)} ms`,
      `CPU ${f(s.cpuTotal)} ms · GPU ${s.gpu === null ? (this.profiler.gpuAvailable ? '…' : 'n/d') : `${f(s.gpu)} ms`} · ${t('perf.memory')} ${memApi ? `${Math.round(memApi.usedJSHeapSize / 1048576)} MB` : 'n/d'}`,
      `${r.render.calls} dc · ${Math.round(r.render.triangles / 1000)}k tri · ${r.memory.geometries} geo · ${r.memory.textures} tex · ${this.eco?.active.length ?? 0}/${this.eco?.animals.size ?? 0} ${t('perf.animals')}`,
      ...top,
    ].join('\n');
  }

  /** Frames rendered (diagnostics and automated tests). */
  frames = 0;
  /**
   * Shader warm-up on the loading screen: one instance of each artist model and
   * one procedural animal (every detail level, with shadows) are drawn hidden
   * behind the loading overlay, so their programs are compiled before play
   * starts instead of freezing a frame when the first animal comes close.
   */
  private warmup: { state: 'idle' | 'waiting' | 'drawing' | 'done'; frames: number; started: number; group: THREE.Group | null; inst: ExternalInstance[]; views: AnimalView[] } = { state: 'idle', frames: 0, started: 0, group: null, inst: [], views: [] };

  private warmupStep(): boolean {
    const w = this.warmup;
    if (w.state === 'done') return true;
    if (w.state === 'idle') {
      w.state = 'waiting';
      w.started = performance.now();
      void warmupInstances().then((inst) => {
        if (w.state !== 'waiting') {
          for (const i of inst) i.dispose();
          return;
        }
        w.inst = inst;
        const g = new THREE.Group();
        // Procedural bodies: the material set is the same for every species
        // (feathered and scaly), so one of each covers all programs.
        const ids = [...new Set([...(this.eco?.animals.values() ?? [])].map((a) => a.speciesId))];
        const feathered = ids.find((id) => SPECIES[id].look.features.includes('feathers'));
        const scaly = ids.find((id) => !SPECIES[id].look.features.includes('feathers'));
        for (const id of [feathered, scaly]) {
          if (!id) continue;
          // One of them as an alpha, so the ember aura's shader is compiled too.
          const v = createAnimalView(id, `warmup-${id}`, false, id === scaly);
          v.meshHi.visible = v.meshMid.visible = v.meshLo.visible = true;
          w.views.push(v);
        }
        // Spread in front of the camera, inside the shadow frustum.
        const fwd = new THREE.Vector3();
        this.camera.getWorldDirection(fwd);
        const roots = [...inst.map((it) => it.root), ...w.views.map((v) => v.root)];
        roots.forEach((r, k) => {
          r.position.copy(this.camera.position).addScaledVector(fwd, 10 + k * 3);
          r.position.x += (k - roots.length / 2) * 2;
          g.add(r);
        });
        this.scene.add(g);
        w.group = g;
        w.state = 'drawing';
      });
    }
    // Never hold the loading screen for long because of optional models.
    if (w.state === 'waiting' && performance.now() - w.started > 8000) w.state = 'done';
    if (w.state === 'drawing' && ++w.frames > 2) {
      w.group?.removeFromParent();
      for (const i of w.inst) i.dispose();
      for (const v of w.views) disposeAnimalView(v);
      w.inst = [];
      w.views = [];
      w.group = null;
      w.state = 'done';
    }
    return w.state === 'done';
  }

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    this.frames++;
    const rawDt = (now - this.last) / 1000;
    const dt = Math.min(0.1, rawDt);
    this.last = now;
    this.time += dt;
    this.profiler.frame(rawDt * 1000);
    this.profiler.begin('input');
    this.input.poll(dt);

    // Real elapsed time (not the clamped step) so slow devices are detected correctly.
    const adj = this.perf.frame(Math.min(rawDt, 1), this.settings.quality === 'auto' && this.state === 'playing');
    if (adj) {
      this.qualityLevel = adj;
      this.applyQuality();
      // Never change the look silently: say what happened and how to keep a fixed profile.
      this.notify('perf.autoChanged', { q: t(`quality.${adj}`) }, 'info');
    }
    this.hud.setPerf(this.showPerf ? this.perfText() : null);

    try {
      if (this.state === 'loading') this.updateLoading();
      else if (this.state === 'playing') this.update(dt);
      else if (this.state === 'paused' || this.state === 'ending') {
        if (this.input.consume('pause') && this.state === 'paused') this.resume();
      }
    } catch (e) {
      // Keep the loop alive and report; a broken frame should never silently freeze the game.
      console.error(e);
      this.hud.notify(`${t('error.frame')}: ${e instanceof Error ? e.message : String(e)}`, 'warn');
    }
    this.input.clearPresses();
    this.profiler.begin('render');
    if (this.player && this.envView) {
      this.profiler.gpuBegin();
      this.postfx.render();
      if (this.state === 'playing' || this.state === 'paused') this.viewmodel.render(this.renderer);
      this.profiler.gpuEnd();
    } else {
      this.renderer.setClearColor(0x1c1a16);
      this.renderer.clear();
    }
  };

  /** First-person arms: follow the camera, the action state and the world's light. */
  private updateViewmodel(dt: number, p: PlayerController, mounted: boolean): void {
    const vm = this.viewmodel;
    const env = this.envView!;
    const h = this.renderer.getDrawingBufferSize(this.tmpSize).y;
    this.fx.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    // Dust takes the brightness of the ambient light (dark at night, in caves).
    const amb = Math.min(1.2, env.hemi.intensity * 0.9 + (this.inCave ? 0.15 : env.sun.intensity * 0.15));
    this.fx.uniforms.uLight.value.setRGB(amb, amb, amb);
    vm.visible = !!this.settings.firstPerson && !mounted && !(p.swimming && !this.combat.busy) && !this.hud.panelOpen;
    if (!vm.visible) return;
    vm.update(dt, this.camera, this.combat, this.lookDelta, p.horizontalSpeed, p.stride, {
      dir: env.keyLightDir,
      color: env.sun.color,
      intensity: this.inCave ? 0 : env.sun.intensity,
      sky: env.hemi.color,
      ground: env.hemi.groundColor,
      hemi: env.hemi.intensity + (this.inCave ? 0.3 : 0),
      env: this.scene.environment,
    });
    vm.kick(this.kick);
  }

  /** Called by the combat code on contact. */
  hitStop(amount: number): void {
    this.kick = Math.max(this.kick, amount);
  }

  /** Hit reaction of an animal's view (size-scaled strength). */
  animalHit(id: string, dirX: number, dirZ: number, strength: number): void {
    const v = this.animalViews.get(id);
    const a = this.eco?.get(id);
    if (v && a) hitAnimalView(v, dirX, dirZ, a.heading, strength);
  }

  /** Per-frame shader inputs shared by terrain, vegetation and water. */
  private updateWorldShading(px: number, pz: number, q: QualityProfile): void {
    this.renderer.toneMappingExposure = this.envView!.exposure;
    const u = this.terrainUniforms;
    u.uWetness.value = this.envView!.wetness;
    u.uTime.value = WIND.uniforms.uWindTime.value;
    u.uHoleCenter.value.set(px, pz);
    u.uHoleRadius.value = q.loadRadius * 128 - 30;
    if (this.farTerrain) this.farTerrain.visible = !this.inCave;
    if (this.groundCover) {
      this.groundCover.enabled = !this.inCave && q.groundCover > 0.01;
      this.groundCover.update(px, pz, this.state === 'loading' ? 40 : 3);
    }
  }

  private updateLoading(): void {
    const p = this.player!;
    const q = this.quality();
    // Generate plant and animal models now rather than mid-game.
    // Juvenile bodies are only prepared for the young animals near the start (others are built when first seen).
    const now = this.env!.state.time;
    const young = [...this.eco!.animals.values()].filter((a) => lifeStage(a, now) === 'juvenile' && Math.hypot(a.x - p.s.x, a.z - p.s.z) < 260).map((a) => a.speciesId);
    const modelsReady = prewarmPlants(25) && prewarmAnimals([...new Set([...this.eco!.animals.values()].map((a) => a.speciesId))], 25, [...new Set(young)]) && this.warmupStep();
    this.sectors!.update(p.s.x, p.s.z, q, this.env!.state.time, 40);
    this.eco!.seedAround(p.s.x, p.s.z);
    const total = (q.loadRadius * 2 + 1) ** 2;
    this.hud.loading(Math.min(1, this.sectors!.loadedCount / total));
    this.rig.update(0.016, p, this.settings.firstPerson, this.groundFn(), this.collision);
    this.envView!.update(0.016, this.camera, new THREE.Vector3(p.s.x, p.s.y, p.s.z), false, this.renderer);
    this.updateWorldShading(p.s.x, p.s.z, q);
    if (this.sectors!.isReady && this.sectors!.pending === 0 && modelsReady) {
      if (!this.inCave) p.s.y = Math.max(p.s.y, this.terrain!.height(p.s.x, p.s.z));
      this.state = 'playing';
      this.hud.hideMenu();
      this.hud.setGameplayVisible(true);
      this.hud.renderHotbar();
      if (this.noticeOnStart) {
        this.notify(this.noticeOnStart, {}, 'warn');
        this.noticeOnStart = null;
      }
      this.audio.setMusicMood('calm');
    }
  }

  private groundFn(): (x: number, z: number) => number {
    return this.inCave ? () => CAVE_Y : (x, z) => this.terrain!.height(x, z);
  }

  private update(realDt: number): void {
    const p = this.player!;
    const env = this.env!;
    const surv = this.survival!;
    const input = this.input;
    const terrain = this.terrain!;
    const prog = this.progression;
    const panel = this.hud.panelOpen || this.hud.documentOpen;
    const q = this.quality();

    // --- UI toggles.
    if (input.consume('pause')) {
      if (this.hud.quickGraphicsOpen) this.toggleQuickGraphics(false);
      else if (panel) this.resume();
      else if (this.building && this.buildCtl.selected) this.cancelBuildPlacement();
      else if (this.building) this.toggleBuild();
      else this.pause();
      return;
    }
    if (input.consume('inventory')) {
      if (panel) this.resume();
      else this.openPanel('inventory');
    }
    if (input.consume('graphics')) this.toggleQuickGraphics();
    if (input.consume('map')) {
      if (panel && this.hud.tab === 'map') this.resume();
      else this.openPanel('map');
    }
    if (input.consume('build') && !panel && !this.mountedId && !this.inCave) this.toggleBuild();
    if (input.consume('camera')) this.applySettings({ firstPerson: !this.settings.firstPerson });
    for (let i = 0; i < 6; i++) if (input.consume(`hot${i + 1}` as 'hot1')) this.selectedHotbar = i;
    if (input.wheel) {
      if (this.building) this.buildCtl.rotate(input.wheel > 0 ? 1 : -1);
      else if (!this.settings.firstPerson) this.rig.zoom(input.wheel);
      input.wheel = 0;
    }

    // --- Look.
    const look = input.consumeLook();
    if (!panel) {
      const sens = input.mode === 'touch' ? 0.004 : 0.0024 * this.settings.mouseSensitivity;
      p.s.yaw -= look.x * sens;
      p.s.pitch -= look.y * sens * (this.settings.invertY ? -1 : 1);
      this.lookDelta.x = look.x * sens;
      this.lookDelta.y = look.y * sens;
    } else this.lookDelta.x = this.lookDelta.y = 0;

    // --- Skill effects into the systems.
    surv.mods = { needs: prog.needsRate(), damage: prog.damageTaken(), heal: prog.healMultiplier(), stamina: prog.staminaDrain(), ironStomach: prog.has('iron_stomach') };
    this.crafting.timeMultiplier = prog.craftTime();
    this.crafting.refundChance = prog.refundChance();
    this.crafting.random = () => this.rng.next();

    // --- Time (sleeping accelerates time).
    if (this.sleeping) {
      const done = (env.dayFraction > 0.27 && env.dayFraction < 0.5 && surv.d.energy > 60) || surv.d.energy >= 99;
      if (done || input.move.x || input.move.y) this.sleeping = false;
    }
    const timeScale = this.sleeping ? 40 : 1;
    const dt = realDt * timeScale;
    const events: EnvEvent[] = [];
    this.profiler.begin('world');
    env.update(dt, p.s.x, p.s.z, events);
    this.handleEnvEvents(events);
    if (env.day !== this.lastDay) {
      this.lastDay = env.day;
      prog.d.daysSurvived++;
      this.xp('survival', 20);
    }

    // --- Player movement (on foot or mounted).
    this.profiler.begin('player');
    const sample = terrain.sample(p.s.x, p.s.z);
    const biome = this.inCave ? 'mountain' : this.sectors!.biomeCoarse(p.s.x, p.s.z);
    this.inventory.extraCapacity = this.taming.packCapacity(this.eco!, p.s.x, p.s.z, env.state.time);
    const weight = this.inventory.weight();
    const cap = this.inventory.capacity();
    const overweight = Math.max(0, weight / cap - 1);
    const mount = this.mountedId ? this.eco!.get(this.mountedId) : undefined;
    if (this.mountedId && (!mount || !mount.alive || !mount.tame)) this.dismount();
    if (mount && mount.tame) this.rideUpdate(mount, panel);
    else this.walkUpdate(realDt, panel, biome, sample.height, overweight);
    if (p.landingImpact > 0) {
      const threshold = prog.has('climber') ? 14 : 11;
      if (p.landingImpact > threshold) {
        surv.damage((p.landingImpact - threshold) * 6, this.armor(), 'fall');
        this.lastDamageSource = 'fall';
        this.flash();
      }
      p.landingImpact = 0;
    }

    // --- Survival.
    this.profiler.begin('survival');
    const airTemp = this.inCave ? 12 : env.temperatureAt(sample.temperature, biome);
    const held = this.heldItem();
    const nearCampfire = !!this.buildingSys!.nearest(p.s.x, p.s.z, 4.5, (pc) => pc.type === 'campfire' || pc.type === 'forge' || pc.type === 'torch_post');
    const nearWildfire = env.state.fires.some((f) => Math.hypot(f.x - p.s.x, f.z - p.s.z) < f.r + 15);
    const sheltered = !!this.inCave || this.buildingSys!.sheltered(p.s.x, p.s.z, p.s.y);
    const ctx = {
      airTemp,
      insulation: this.insulation() + prog.insulationBonus(),
      exertion: p.sprinting ? 2 : p.horizontalSpeed > 0.5 ? 1 : 0,
      sprinting: !mount && p.sprinting && p.horizontalSpeed > 1,
      inWater: p.swimming,
      nearFire: nearCampfire || held?.id === 'torch' || nearWildfire,
      sheltered,
      resting: this.sleeping,
      overweight,
    };
    surv.update(dt, ctx);
    if (!this.inCave && env.state.fires.some((f) => Math.hypot(f.x - p.s.x, f.z - p.s.z) < f.r * 0.8)) {
      surv.damage(6 * realDt, 0, 'burn');
      this.lastDamageSource = 'fire';
    }
    if (!this.inCave && env.eruptionActive && Math.hypot(p.s.x - VOLCANO.x, p.s.z - VOLCANO.z) < 520) {
      surv.damage(4 * realDt, 0, 'burn');
      this.lastDamageSource = 'fire';
    }
    if (surv.d.bodyTemp < 34.5) this.lastDamageSource = 'cold';
    if (surv.d.bodyTemp > 40) this.lastDamageSource = 'heat';
    if (surv.d.food <= 0) this.lastDamageSource = 'starvation';
    if (surv.d.water <= 0) this.lastDamageSource = 'thirst';
    if (surv.d.bleeding > 0.2 && !this.lastDamageSource.startsWith('animal:')) this.lastDamageSource = 'bleeding';
    this.warnNeeds();

    // --- Actions.
    this.profiler.begin('actions');
    this.attackCooldown -= realDt;
    if (this.building) this.updateBuild(realDt);
    else if (!panel) this.actions.update(this.interaction);
    if (mount || this.sleeping) this.combat.cancel();
    this.actions.updateCombat(realDt, !panel && !this.building && !mount && !this.sleeping);
    if (!panel && input.consume('eat')) this.useHeld();
    this.actions.updateProjectiles(realDt);

    // --- Ecosystem (sub-stepped while sleeping).
    this.profiler.begin('ai');
    const companion = this.companionTarget && this.companionTarget.until > env.state.time ? this.companionTarget.id : null;
    const wind = { x: Math.cos(env.state.windDir), z: Math.sin(env.state.windDir) };
    const visibility = (p.crouching ? 0.5 : 1) * (env.isNight ? (held?.id === 'torch' ? 1 : 0.5) : 1) * (biome === 'jungle' ? 0.65 : biome === 'swamp' ? 0.8 : 1);
    const ecoCtx: EcoContext = {
      player: {
        x: p.s.x,
        z: p.s.z,
        alive: surv.alive && !this.inCave,
        noiseRadius: (this.sleeping ? 2 : p.noiseRadius()) * prog.noise(),
        hostileUntil: this.hostileUntil,
        visibility,
        running: p.sprinting,
        hasFire: held?.id === 'torch' || nearCampfire,
      },
      predatorBoldness: DIFFICULTY[this.settings.difficulty].predatorBoldness,
      maxActive: q.maxActiveAnimals,
      blocked: (x, z, r) => this.collision.query(x, z, r + 1).some((c) => (c.kind === 'box' ? c.enabled && !c.ramp : c.r > 1.5) && CollisionWorld.penetration(c, x, z, r) !== null),
      damagePlayer: (amount, a) => this.onAnimalHitsPlayer(amount, a),
      wind,
      playerCalm: prog.has('naturalist') ? 0.8 : 1,
      companionTarget: companion,
      troughFood: (a) => this.taming.troughFor(this.buildingSys!, a),
    };
    const steps = this.sleeping ? 6 : 1;
    for (let i = 0; i < steps; i++) this.eco!.update(Math.min(dt / steps, 0.5), ecoCtx);
    this.eco!.seedAround(p.s.x, p.s.z);
    this.profiler.begin('taming');
    this.taming.update(dt, {
      eco: this.eco!,
      building: this.buildingSys!,
      progression: prog,
      now: env.state.time,
      player: { x: p.s.x, z: p.s.z, quiet: p.crouching || p.horizontalSpeed < 0.3, hostile: env.state.time < this.hostileUntil, alive: surv.alive },
      language: language(),
      notify: (k, params, kind) => this.notify(k, params, kind),
      xp: (tree, n) => this.xp(tree, n),
      reveal: (x, z, r) => this.exploration.reveal(x, z, r),
    });
    this.updateTraps(env.state.time);

    // --- Crafting & base processes.
    this.profiler.begin('base');
    const res = this.crafting.update(dt, this.inventory);
    for (const id of res.completed) {
      const r = RECIPES.find((x) => x.id === id)!;
      this.notify('craft.done', { what: t(`item.${r.output}`) }, 'good');
      this.audio.sfx('craft');
      this.xp('crafting', r.time * 2);
    }
    if (res.completed.length) this.inventory.autoHotbar();
    this.dropOverflow(res.overflow);
    const tick = this.buildingSys!.tick(dt, {
      now: env.state.time,
      raining: env.state.weather === 'rain' || env.state.weather === 'storm',
      growth: env.growthFactor,
      windSpeed: env.state.windSpeed,
      warm: (x, z) => !!this.buildingSys!.nearest(x, z, 6, (pc) => pc.type === 'campfire' || pc.type === 'forge') || env.temperatureAt(terrain.temperatureBase(x, z, terrain.height(x, z)), this.sectors!.biomeCoarse(x, z)) >= 22,
      incubationSeconds: (sp) => SPECIES[sp].reproduction.incubationDays * 1200 * prog.incubation(),
    });
    for (const box of tick.hatched) this.taming.hatch(this.tamingHost(), box.id);

    // --- Streaming & visuals.
    this.profiler.begin('streaming');
    this.sectors!.update(p.s.x, p.s.z, q, env.state.time);
    this.sectors!.syncInteractables((id) => this.mysteries.d.taken.includes(id), this.scanning(), !!this.mysteries.d.ending);
    this.profiler.begin('animals');
    this.syncViews(realDt);
    this.profiler.begin('environment');
    const focus = new THREE.Vector3(p.s.x, p.s.y, p.s.z);
    this.envView!.indoor = !!this.inCave;
    this.envView!.update(realDt, this.camera, focus, ctx.airTemp < 0 || biome === 'snow', this.renderer);
    this.updateWorldShading(p.s.x, p.s.z, q);
    this.envView!.groundFires((x, z) => terrain.height(x, z));
    this.profiler.begin('character');
    this.rig.update(realDt, p, this.settings.firstPerson, this.groundFn(), this.collision, this.inCave ? 3.5 : mount ? 9 : Infinity);
    // First-person impact kick: a short jolt of the view on contact.
    if (this.kick > 0.001) {
      this.camera.rotation.x += this.kick * (this.settings.reduceMotion ? 0.05 : 0.25);
      this.kick *= Math.exp(-realDt * 18);
    }
    this.playerView!.riding = !!mount;
    this.playerView!.update(realDt, p, this.settings.firstPerson || false, this.inCave ? undefined : (x, z) => terrain.height(x, z), this.combat);
    this.updateViewmodel(realDt, p, !!mount);
    this.profiler.begin('effects');
    this.fx.ground = this.inCave ? () => CAVE_Y : (x, z) => terrain.height(x, z);
    this.fx.update(realDt);
    this.sectors!.updateShakes(realDt);
    if (mount) this.playerView!.root.position.y = mount.y + SPECIES[mount.speciesId].hipHeightM * growthScale(mount, env.state.time) * 1.15;
    this.updateFlares();

    // --- Audio.
    this.profiler.begin('audio');
    this.updateAudio(p, held?.id, sheltered, biome);

    // --- Slow checks (discoveries, biome changes, map).
    this.profiler.begin('hud');
    this.slowTimer -= realDt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.5;
      this.slowChecks(biome);
    }

    // --- HUD.
    this.uiTimer -= realDt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.1;
      this.updateHud(ctx, overweight > 0, biome);
    }
    this.xpToastTimer -= realDt;
    if (this.xpToastTimer <= 0) {
      this.xpToastTimer = 2;
      const parts = [...this.xpToast.entries()].filter(([, v]) => v >= 1).map(([k, v]) => `+${Math.round(v)} ${t(`tree.${k}`)}`);
      if (parts.length) this.hud.xpToast(parts.join(' · '));
      this.xpToast.clear();
    }

    if (!surv.alive) this.die();

    this.autosave += realDt;
    if (this.autosave > 120) {
      this.autosave = 0;
      void this.save(true);
    }
  }

  private walkUpdate(realDt: number, panel: boolean, biome: BiomeId, groundH: number, overweight: number): void {
    const p = this.player!;
    const env = this.env!;
    const surv = this.survival!;
    const input = this.input;
    let biomeMul = BIOMES[biome].movement;
    if (env.flooding && groundH < env.waterLevel + 0.5) biomeMul *= 0.6;
    const dynamic: { x: number; z: number; r: number }[] = [];
    if (!this.inCave)
      for (const a of this.eco!.active) {
        const sp = SPECIES[a.speciesId];
        if (!a.alive || sp.lengthM < 2 || Math.abs(a.x - p.s.x) > 20 || Math.abs(a.z - p.s.z) > 20) continue;
        if (Math.abs(a.y - p.s.y) > sp.hipHeightM * 2 + 2) continue;
        dynamic.push({ x: a.x, z: a.z, r: sp.lengthM * 0.14 * growthScale(a, env.state.time) });
      }
    const moveEnabled = !panel && !this.sleeping;
    const sprintHeld = this.settings.toggleSprint && input.mode === 'keyboard' ? this.sprintToggled(input.consume('sprint')) : input.held('sprint');
    const site = this.inCave ? PLANNED_SITES.find((s) => s.id === this.inCave) : undefined;
    p.update(
      realDt,
      {
        x: moveEnabled ? input.move.x : 0,
        y: moveEnabled ? input.move.y : 0,
        sprint: sprintHeld,
        crouch: input.held('crouch'),
        jump: moveEnabled && input.consume('jump'),
      },
      {
        terrain: this.terrain!,
        collision: this.collision,
        waterLevel: env.waterLevel,
        speedMul: surv.speedMultiplier() * (overweight > 0 ? Math.max(0.35, 1 - overweight * 1.5) : 1),
        canSprint: surv.canSprint() && overweight < 0.3,
        biomeMul,
        dynamic,
        groundOverride: this.inCave ? CAVE_Y : undefined,
        bounds: site ? { x: site.x, z: site.z, r: CAVE_RADIUS - 1.2 } : undefined,
        slopeLimit: this.progression.slopeLimit(),
      },
      this.settings.firstPerson,
    );
    p.s.x = clamp(p.s.x, -5100, 5100);
    p.s.z = clamp(p.s.z, -5100, 5100);
  }

  private sprintOn = false;
  private sprintToggled(pressed: boolean): boolean {
    if (pressed) this.sprintOn = !this.sprintOn;
    if (this.input.move.y <= 0) this.sprintOn = false;
    return this.sprintOn;
  }

  // ------------------------------------------------------------------ riding

  mount(a: AnimalData): void {
    if (!a.tame) return;
    this.mountedId = a.id;
    a.tame.ridden = true;
    this.notify('tame.mounted', { name: a.tame.name }, 'good');
  }

  dismount(silent = false): void {
    if (!this.mountedId) return;
    const a = this.eco?.get(this.mountedId);
    this.mountedId = null;
    if (a?.tame) {
      a.tame.ridden = false;
      this.eco!.brain.setRide(a, null);
      a.tame.command = 'stay';
      a.tame.anchorX = a.x;
      a.tame.anchorZ = a.z;
    }
    const p = this.player;
    if (p && a) {
      p.s.x = a.x + Math.cos(a.heading) * (SPECIES[a.speciesId].lengthM * 0.3 + 1.2);
      p.s.z = a.z - Math.sin(a.heading) * (SPECIES[a.speciesId].lengthM * 0.3 + 1.2);
      p.s.y = this.terrain!.height(p.s.x, p.s.z) + 0.2;
      p.vx = p.vz = p.vy = 0;
    }
    if (!silent) this.notify('tame.dismounted');
  }

  private rideUpdate(a: AnimalData, panel: boolean): void {
    const p = this.player!;
    const input = this.input;
    const prof = TAME_PROFILES[a.speciesId];
    const forward = panel ? 0 : Math.max(0, input.move.y);
    const speed = TamingController.mountSpeed(a, forward, input.held('sprint'), prof.mountSpeed ?? 0.8, this.env!.state.time);
    const heading = p.s.yaw + (panel ? 0 : -input.move.x * 0.9);
    this.eco!.brain.setRide(a, { heading, speed });
    p.s.x = a.x;
    p.s.z = a.z;
    p.s.y = a.y;
    p.vx = p.vz = p.vy = 0;
    p.horizontalSpeed = 0;
    p.bodyYaw = a.heading;
    p.swimming = false;
  }

  // ------------------------------------------------------------------ caves

  enterCave(siteId: string): void {
    const site = PLANNED_SITES.find((s) => s.id === siteId);
    if (!site || this.mountedId) return;
    this.inCave = siteId;
    const p = this.player!;
    p.s.x = site.x;
    p.s.z = site.z + 9;
    p.s.y = CAVE_Y;
    p.s.yaw = Math.PI;
    p.vx = p.vz = p.vy = 0;
    this.envView!.indoor = true;
    this.notify('cave.entered', { what: t(`site.${siteId}`) });
    this.audio.setMusicMood('cave');
  }

  exitCave(): void {
    const site = PLANNED_SITES.find((s) => s.id === this.inCave);
    this.inCave = null;
    this.envView!.indoor = false;
    if (!site) return;
    const p = this.player!;
    p.s.x = site.x;
    p.s.z = site.z + 6;
    p.s.y = this.terrain!.height(p.s.x, p.s.z) + 0.3;
    p.s.yaw = 0;
    p.vx = p.vz = p.vy = 0;
    this.audio.setMusicMood('calm');
  }

  // ------------------------------------------------------------------ ending

  showEnding(): void {
    this.state = 'ending';
    document.exitPointerLock?.();
    this.hud.closePanel();
    this.hud.endingScreen(
      () => {
        this.mysteries.d.ending = 'cross';
        void this.save(true);
        this.hud.endingText(t('ending.crossText'), () => this.quitToMenu());
      },
      () => {
        this.mysteries.d.ending = 'stay';
        void this.save(true);
        this.hud.endingText(t('ending.stayText'), () => {
          this.state = 'playing';
          this.hud.hideMenu();
          this.hud.setGameplayVisible(true);
        });
      },
    );
  }

  // ------------------------------------------------------------------ traps & defences

  private updateTraps(now: number): void {
    const traps = [...this.buildingSys!.pieces.values()].filter((pc) => pc.type === 'spike_trap' || pc.type === 'snare_trap' || (pc.type === 'electric_fence' && pc.powered));
    if (!traps.length) return;
    for (const a of this.eco!.active) {
      if (!a.alive || a.tame) continue;
      const sp = SPECIES[a.speciesId];
      const r = sp.lengthM * 0.15 * growthScale(a, now) + 0.4;
      for (const tp of traps) {
        const d = Math.hypot(a.x - tp.x, a.z - tp.z);
        if (tp.type === 'spike_trap' && d < 1.2 + r && (tp.uses ?? 0) > 0) {
          const key = `${tp.id}:${a.id}`;
          if ((this.trapCooldown.get(key) ?? 0) > now) continue;
          this.trapCooldown.set(key, now + 3);
          tp.uses = (tp.uses ?? 0) - 1;
          a.health -= resolveDamage(a, 30, 'trap');
          this.eco!.brain.onHurt(a, tp.x, tp.z, false, now);
          this.eco!.brain.onScare(a, tp.x, tp.z, now);
          if (a.health <= 0) this.eco!.kill(a, 'trap');
          this.audio.sfx('hit', [tp.x, tp.y, tp.z]);
        } else if (tp.type === 'snare_trap' && tp.armed && d < 0.9 + r && snareable(a)) {
          tp.armed = false;
          a.heldUntil = now + 40;
          this.audio.sfx('snap', [tp.x, tp.y, tp.z]);
          if (Math.hypot(tp.x - this.player!.s.x, tp.z - this.player!.s.z) < 200) this.notify('trap.caught', { what: sp.name[language()] }, 'good');
        } else if (tp.type === 'electric_fence') {
          const c = this.buildingSys!.colliderFor(tp);
          if (!c || !CollisionWorld.penetration(c, a.x, a.z, r + 0.3)) continue;
          if ((this.shockCooldown.get(a.id) ?? 0) > now) continue;
          this.shockCooldown.set(a.id, now + 2);
          a.health -= resolveDamage(a, 12, 'shock');
          this.eco!.brain.onScare(a, tp.x, tp.z, now);
          if (a.health <= 0) this.eco!.kill(a, 'shock');
          this.audio.sfx('shock', [tp.x, tp.y + 1, tp.z]);
        }
      }
    }
  }

  // ------------------------------------------------------------------ helpers

  private armor(): number {
    return Object.values(this.inventory.data.equipment).reduce((s, x) => s + (x ? ITEMS[x.id].armor ?? 0 : 0), 0);
  }

  private insulation(): number {
    return Object.values(this.inventory.data.equipment).reduce((s, x) => s + (x ? ITEMS[x.id].insulation ?? 0 : 0), 0);
  }

  private heldSlotIndex(): number | null {
    return this.inventory.data.hotbar[this.selectedHotbar] ?? null;
  }

  heldItem(): Stack | null {
    const i = this.heldSlotIndex();
    return i !== null ? this.inventory.data.slots[i] : null;
  }

  stations(): Set<Station> {
    const p = this.player;
    return p && this.buildingSys ? this.buildingSys.stationsNear(p.s.x, p.s.z) : new Set<Station>(['hand']);
  }

  openPanel(tab: PanelTab): void {
    this.hud.openPanel(tab);
    this.input.uiCapture = true;
    document.exitPointerLock?.();
  }

  openAnimalPanel(id: string): void {
    this.focusAnimal = id;
    this.openPanel('animals');
  }

  private flash(): void {
    if (!this.settings.reduceMotion) this.hud.damageFlash();
  }

  wearHeld(): void {
    const i = this.heldSlotIndex();
    if (i === null) return;
    const s = this.inventory.data.slots[i];
    if (!s || s.dur === undefined) return;
    if (this.inventory.wear(i, 1)) this.notify('notify.toolBroke', { what: t(`item.${s.id}`) }, 'warn');
  }

  dropOverflow(overflow: ItemList, sp?: string): void {
    const stacks = Object.entries(overflow)
      .filter(([, q]) => q > 0)
      .map(([id, qty]) => (sp ? { id, qty, sp } : { id, qty }));
    if (!stacks.length) return;
    this.notify('notify.full', {}, 'warn');
    this.createBag(stacks, 'drop');
  }

  private warnNeeds(): void {
    const d = this.survival!.d;
    if (d.food < 20 && !this.needWarned.food) {
      this.needWarned.food = true;
      this.notify('notify.needFood', {}, 'warn');
    } else if (d.food > 30) this.needWarned.food = false;
    if (d.water < 20 && !this.needWarned.water) {
      this.needWarned.water = true;
      this.notify('notify.needWater', {}, 'warn');
    } else if (d.water > 30) this.needWarned.water = false;
  }

  private handleEnvEvents(events: EnvEvent[]): void {
    for (const e of events) {
      if (e.type === 'weather' && e.weather !== 'cloudy') {
        this.notify(`notify.weather.${e.weather}`);
        if (!this.inCave) this.xp('environment', 3);
      } else if (e.type === 'fireStarted') this.notify('notify.fire', {}, 'warn');
      else if (e.type === 'eruption' && e.active) this.notify('notify.eruption', {}, 'warn');
      else if (e.type === 'flood') this.notify(e.active ? 'notify.flood' : 'notify.floodEnd', {}, e.active ? 'warn' : 'info');
      else if (e.type === 'drought') this.notify(e.active ? 'notify.drought' : 'notify.droughtEnd', {}, e.active ? 'warn' : 'info');
    }
  }

  private onEcoEvent(e: EcoEvent): void {
    if (e.type === 'tameLeft') this.notify('tame.left', { name: e.name }, 'warn');
    else if (e.type === 'tamedKilled') {
      this.notify('tame.died', { name: e.name }, 'warn');
      if (this.mountedId === e.id) this.dismount(true);
    }
  }

  private onAnimalHitsPlayer(amount: number, a: AnimalData): void {
    if (this.inCave) return;
    const surv = this.survival!;
    // A mount takes half of what is aimed at its rider.
    const mount = this.mountedId ? this.eco!.get(this.mountedId) : undefined;
    if (mount && mount !== a) {
      mount.health -= amount * 0.5;
      amount *= 0.5;
    }
    surv.damage(amount, this.armor(), 'bite');
    this.lastDamageSource = `animal:${a.speciesId}`;
    this.sleeping = false;
    if (!a.tame) this.setCompanionTarget(a.id);
    this.flash();
    this.audio.sfx('hit');
    this.xp('combat', 2);
  }

  private slowChecks(biome: BiomeId): void {
    const p = this.player!;
    const prog = this.progression;
    if (!this.inCave) {
      if (biome !== this.lastBiome) {
        if (this.lastBiome) this.notify('notify.biome', { biome: t(`biome.${biome}`) });
        if (!this.exploration.d.biomeCells[biome]) this.xp('exploration', 30);
        this.lastBiome = biome;
        if (biome === 'snow') this.unlock('visited_snow');
      }
      // Map knowledge: higher ground lets you see further.
      const around = (this.terrain!.height(p.s.x + 60, p.s.z) + this.terrain!.height(p.s.x - 60, p.s.z) + this.terrain!.height(p.s.x, p.s.z + 60) + this.terrain!.height(p.s.x, p.s.z - 60)) / 4;
      const high = p.s.y - around > 25 ? 150 : 0;
      this.exploration.reveal(p.s.x, p.s.z, (110 + high) * prog.revealMultiplier());
      this.exploration.track(p.s.x, p.s.z);
      for (const s of PLANNED_SITES) {
        if (this.discovered.has(s.id)) continue;
        if (Math.hypot(s.x - p.s.x, s.z - p.s.z) < s.radius + 40) {
          this.discovered.add(s.id);
          this.notify('notify.discovered', { what: t(`site.${s.id}`) }, 'good');
          this.xp('exploration', 50);
          if (s.kind === 'research') this.unlock('found_research_site');
        }
      }
    }
    // Species sightings and quiet observation.
    const [fx, fz] = [Math.sin(p.s.yaw), Math.cos(p.s.yaw)];
    for (const a of this.eco!.active) {
      if (!a.alive || this.inCave) continue;
      const dx = a.x - p.s.x;
      const dz = a.z - p.s.z;
      const d = Math.hypot(dx, dz);
      const inView = d < 80 && (dx * fx + dz * fz) / Math.max(1, d) > 0.4;
      if (!inView) continue;
      if (!this.seenSpecies.has(a.speciesId)) {
        this.seenSpecies.add(a.speciesId);
        const sp = SPECIES[a.speciesId];
        this.notify('notify.discovered', { what: `${sp.name[language()]} (${sp.scientificName})` }, 'good');
        this.xp('tracking', 40);
      } else if (d < 40 && a.state !== 'flee') this.xp('tracking', 0.25);
    }
    if (this.inventory.count('obsidian') > 0) this.unlock('found_obsidian');
    if (prog.has('tracker')) this.updateFootprints();
  }

  unlock(flag: string): void {
    if (this.crafting.unlocked.has(flag)) return;
    this.crafting.unlocked.add(flag);
    for (const r of RECIPES) if (r.unlock === flag) this.notify('notify.unlock', { what: t(`item.${r.output}`) }, 'good');
    for (const [type, def] of Object.entries(PIECES)) if (def.unlock === flag) this.notify('notify.unlockPiece', { what: t(`piece.${type}`) }, 'good');
  }

  recordFossil(id: string, speciesId: string): void {
    const ex = this.exploration.d;
    if (!ex.fossilsFound.includes(id)) ex.fossilsFound.push(id);
    const known = ex.fossilSpecies.includes(speciesId);
    if (!known) ex.fossilSpecies.push(speciesId);
    this.notify('explore.fossil', { what: SPECIES[speciesId].name[language()] }, 'good');
    this.xp('exploration', 25);
    this.xp('tracking', 10);
  }

  // ------------------------------------------------------------------ HUD & audio per frame

  private updateHud(ctx: { airTemp: number }, overweight: boolean, biome: BiomeId): void {
    const env = this.env!;
    const p = this.player!;
    const surv = this.survival!;
    const felt = surv.feltTemp({ ...ctx, insulation: this.insulation() + this.progression.insulationBonus() } as Parameters<Survival['feltTemp']>[0]);
    this.hud.updateStats(surv.d, felt, overweight);
    // Orientation: compass gives exact heading; otherwise only the sun (daytime, clear sky).
    const dirMode = this.inventory.count('compass') > 0 ? 'exact' : !this.inCave && !env.isNight && env.state.intensity < 0.6 ? 'sun' : 'none';
    const forecast = this.progression.has('weather_sense') ? env.forecast() : null;
    this.hud.updateTop(env.day, env.dayFraction, env.state.weather, this.inCave ? 'cave' : biome, p.s.yaw, dirMode, forecast);
    this.hud.renderHotbar();
    this.interaction = this.building || this.hud.panelOpen ? null : this.actions.find();
    this.hud.prompt(this.interaction?.label ?? this.actions.observePrompt());
    this.hud.radio(this.radioReading());
    if (this.hud.panelOpen && ['crafting', 'inventory', 'animals'].includes(this.hud.tab)) this.hud.renderPanel(true);
  }

  /** Radio receiver: bearing and strength toward the nearest unvisited station. */
  private radioReading(): { strength: number; bearing: number } | null {
    if (this.heldItem()?.id !== 'radio_receiver' || this.inCave) {
      this.audio.radioSignal(null);
      return null;
    }
    const p = this.player!;
    const targets = Mysteries.radioTargets(this.discovered);
    if (!targets.length) {
      this.audio.radioSignal(0);
      return { strength: 0, bearing: 0 };
    }
    let best = targets[0];
    for (const t2 of targets) if (Math.hypot(t2.x - p.s.x, t2.z - p.s.z) < Math.hypot(best.x - p.s.x, best.z - p.s.z)) best = t2;
    const d = Math.hypot(best.x - p.s.x, best.z - p.s.z);
    const strength = clamp(1 - d / 4000, 0.05, 1);
    const ang = Math.atan2(best.x - p.s.x, best.z - p.s.z) - p.s.yaw;
    this.audio.radioSignal(strength);
    return { strength, bearing: Math.atan2(Math.sin(ang), Math.cos(ang)) };
  }

  private updateAudio(p: PlayerController, heldId: string | undefined, sheltered: boolean, biome: BiomeId): void {
    const env = this.env!;
    const [fx, fz] = p.forward();
    this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, fx, fz);
    const precip = env.state.weather === 'rain' || env.state.weather === 'storm' ? env.state.intensity : 0;
    let water = 0;
    if (!this.inCave) {
      for (const [dx, dz] of [[25, 0], [-25, 0], [0, 25], [0, -25], [12, 12], [-12, -12]]) if (this.terrain!.height(p.s.x + dx, p.s.z + dz) < env.waterLevel) water += 1 / 6;
    }
    this.audio.ambience({ wind: env.state.windSpeed, rain: precip, biome, night: env.isNight, water, indoor: this.inCave ? 'cave' : sheltered ? 'sheltered' : 'open' });
    if (env.lightning && !this.inCave) this.audio.thunder(Math.hypot(env.lightning.x - p.s.x, env.lightning.z - p.s.z));
    // Footsteps follow the stride (no fixed timer).
    if (!this.mountedId && p.onGround && Math.floor(p.stride) !== Math.floor(this.lastStride) && p.horizontalSpeed > 0.5) {
      const surface: Surface = this.inCave ? 'rock' : p.swimming ? 'water' : biome === 'snow' ? 'snow' : biome === 'beach' ? 'sand' : biome === 'swamp' ? 'mud' : biome === 'mountain' || biome === 'volcanic' || biome === 'ruins' ? 'rock' : this.collision.surfaceAt(p.s.x, p.s.z, p.s.y + 0.3) > -Infinity ? 'wood' : 'grass';
      this.audio.footstep(surface, p.crouching ? 0.3 : p.sprinting ? 1.4 : 0.8);
    }
    this.lastStride = p.stride;
    // Music mood: tension when something is hunting the player.
    const hunted = this.eco!.active.some((a) => a.alive && a.state === 'hunt' && a.targetId === '__player__');
    this.audio.setMusicMood(this.inCave ? 'cave' : hunted ? 'tension' : env.isNight ? 'night' : 'calm');
    void heldId;
  }

  private updateFlares(): void {
    this.flares = this.flares.filter((f) => {
      if (this.time < f.until) {
        f.light.intensity = 250 + Math.sin(this.time * 30) * 50;
        return true;
      }
      f.light.removeFromParent();
      return false;
    });
  }

  /** Tracker skill: recent footprints of nearby animals. */
  private updateFootprints(): void {
    const now = this.env!.state.time;
    if (!this.footprints) {
      const geo = new THREE.CircleGeometry(0.25, 8);
      geo.rotateX(-Math.PI / 2);
      this.footprints = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x2a2018, transparent: true, opacity: 0.55, depthWrite: false }), FOOTPRINT_MAX);
      this.footprints.frustumCulled = false;
      this.worldRoot.add(this.footprints);
    }
    for (const a of this.eco!.active) {
      if (!a.alive || SPECIES[a.speciesId].locomotion.flies) continue;
      const list = this.tracks.get(a.id) ?? [];
      const last = list[list.length - 1];
      if (!last || Math.hypot(last[0] - a.x, last[1] - a.z) > 2.5) list.push([a.x, a.z, growthScale(a, now) * Math.min(3, SPECIES[a.speciesId].lengthM * 0.15 + 0.4)]);
      if (list.length > 12) list.shift();
      this.tracks.set(a.id, list);
    }
    const m = new THREE.Matrix4();
    let i = 0;
    const p = this.player!.s;
    for (const list of this.tracks.values())
      for (const [x, z, s] of list) {
        if (i >= FOOTPRINT_MAX || Math.hypot(x - p.x, z - p.z) > 60) continue;
        m.makeScale(s, 1, s * 1.4).setPosition(x, this.terrain!.height(x, z) + 0.05, z);
        this.footprints.setMatrixAt(i++, m);
      }
    this.footprints.count = i;
    this.footprints.instanceMatrix.needsUpdate = true;
    for (const id of this.tracks.keys()) if (!this.eco!.get(id)) this.tracks.delete(id);
  }

  // ------------------------------------------------------------------ inventory API (UI)

  useHeld(): void {
    const i = this.heldSlotIndex();
    if (i !== null) this.actions.useSlot(i);
  }

  useSlot(i: number): void {
    this.actions.useSlot(i);
  }

  dropSlot(i: number): void {
    const s = this.inventory.takeSlot(i);
    if (s) this.createBag([s], 'drop');
  }

  equipSlot(i: number): void {
    this.inventory.equip(i);
  }

  unequip(slot: EquipSlot): void {
    if (!this.inventory.unequip(slot)) this.notify('notify.full', {}, 'warn');
  }

  moveSlot(a: number, b: number): void {
    this.inventory.moveSlot(a, b);
  }

  assignHotbar(slot: number, hot: number): void {
    const hb = this.inventory.data.hotbar.map((h) => (h === slot ? null : h));
    hb[hot] = slot;
    this.inventory.data.hotbar = hb;
  }

  sortInventory(): void {
    this.inventory.sort();
  }

  craft(id: string): void {
    const err = this.crafting.start(id, this.inventory, this.stations());
    if (err === 'materials') this.notify('craft.missing', {}, 'warn');
    else if (err === 'tool') this.notify('craft.needTool', {}, 'warn');
  }

  cancelCraft(i: number): void {
    this.dropOverflow(this.crafting.cancel(i, this.inventory));
  }

  private createBag(items: Stack[], reason: ItemBag['reason']): void {
    const p = this.player!;
    this.bags.push({ id: `b${this.nextBagId++}`, x: p.s.x, y: p.s.y, z: p.s.z, items, createdAt: this.env!.state.time, reason });
  }

  sleepIn(bed: Piece): void {
    this.respawnPoint = { x: bed.x, z: bed.z, pieceId: bed.id };
    this.sleeping = true;
    this.notify('notify.sleep');
  }

  openStorage(p: Piece): void {
    this.storageOpen = p;
    this.openPanel('storage');
  }

  openStorageItems(): (Stack | null)[] | null {
    return this.storageOpen?.storage ?? null;
  }

  storageTransfer(dir: 'in' | 'out', index: number): void {
    const st = this.storageOpen?.storage;
    if (!st) return;
    if (dir === 'in') {
      const free = st.findIndex((s) => !s);
      if (free < 0) return this.notify('notify.storageFull', {}, 'warn');
      const s = this.inventory.takeSlot(index);
      if (s) st[free] = s;
    } else {
      const s = st[index];
      if (!s) return;
      const left = this.inventory.add(s.id, s.qty, s.dur, s.sp);
      st[index] = left > 0 ? { ...s, qty: left } : null;
      if (left > 0) this.notify('notify.full', {}, 'warn');
    }
  }

  // ------------------------------------------------------------------ taming API (UI)

  tamedAnimals(): AnimalData[] {
    return this.eco ? this.taming.tamed(this.eco) : [];
  }

  animalCommand(id: string, cmd: TameCommand): void {
    const a = this.eco?.get(id);
    if (a?.tame) this.actions.command(a, cmd);
  }

  animalAction(id: string, action: 'mount' | 'feed' | 'rename' | 'release', arg?: string): void {
    const a = this.eco?.get(id);
    if (!a?.tame) return;
    if (action === 'mount') {
      this.resume();
      this.actions.mount(a);
    } else if (action === 'feed') {
      const held = this.heldItem();
      const p = this.player!;
      if (!held) return this.notify('tame.needFood', {}, 'warn');
      if (Math.hypot(a.x - p.s.x, a.z - p.s.z) > 6) return this.notify('tame.tooFar', { name: a.tame.name }, 'warn');
      this.actions.feed(a, held);
    } else if (action === 'rename' && arg) {
      a.tame.name = arg.trim().slice(0, 30) || a.tame.name;
    } else if (action === 'release') {
      if (this.mountedId === a.id) this.dismount();
      const name = a.tame.name;
      release(a, this.env!.state.time);
      this.notify('tame.released', { name });
    }
  }

  private tamingHost() {
    const p = this.player!;
    return {
      eco: this.eco!,
      building: this.buildingSys!,
      progression: this.progression,
      now: this.env!.state.time,
      player: { x: p.s.x, z: p.s.z, quiet: true, hostile: false, alive: true },
      language: language(),
      notify: (k: string, params?: Record<string, string | number>, kind?: 'info' | 'warn' | 'good') => this.notify(k, params, kind),
      xp: (tree: 'taming', n: number) => this.xp(tree, n),
      reveal: (x: number, z: number, r: number) => this.exploration.reveal(x, z, r),
    };
  }

  // ------------------------------------------------------------------ death

  private die(): void {
    if (this.state !== 'playing') return;
    const p = this.player!;
    this.dismount(true);
    if (this.inCave) this.exitCave();
    this.state = 'dead';
    this.deaths++;
    this.sleeping = false;
    document.exitPointerLock?.();
    if (DIFFICULTY[this.settings.difficulty].dropItemsOnDeath) {
      const stacks = this.inventory.takeEverything(false);
      if (stacks.length) this.bags.push({ id: `b${this.nextBagId++}`, x: p.s.x, y: p.s.y, z: p.s.z, items: stacks, createdAt: this.env!.state.time, reason: 'death' });
    }
    const src = this.lastDamageSource;
    const cause = src.startsWith('animal:')
      ? t('cause.animal', { what: SPECIES[src.slice(7)]?.name[language()] ?? '?' })
      : t(`cause.${['starvation', 'thirst', 'cold', 'heat', 'fall', 'bleeding', 'fire'].includes(src) ? src : 'other'}`);
    this.hud.closePanel();
    this.hud.setGameplayVisible(false);
    this.hud.deathScreen(cause);
    // Persist immediately so a reload can't recover the dropped inventory twice.
    void this.save(true);
  }

  respawn(): void {
    if (this.state !== 'dead') return;
    const p = this.player!;
    const s = this.survival!.d;
    let spot = this.respawnPoint;
    if (spot?.pieceId && !this.buildingSys!.pieces.has(spot.pieceId)) spot = null;
    const dest = spot ?? this.terrain!.findDryGround(SPAWN.x, SPAWN.z);
    p.s.x = dest.x + 1.2;
    p.s.z = dest.z;
    p.s.y = this.terrain!.height(p.s.x, p.s.z) + 0.5;
    const surf = this.collision.surfaceAt(p.s.x, p.s.z, p.s.y + 5);
    if (surf > p.s.y) p.s.y = surf;
    p.vx = p.vz = p.vy = 0;
    Object.assign(s, { health: 70, food: Math.max(s.food, 45), water: Math.max(s.water, 45), energy: Math.max(s.energy, 60), stamina: 100, bodyTemp: 37, bleeding: 0, fracture: 0, sickness: 0 });
    this.state = 'playing';
    this.hostileUntil = 0;
    this.hud.hideMenu();
    this.hud.setGameplayVisible(true);
    this.notify('notify.respawn');
    if (this.bags.some((b) => b.reason === 'death')) this.notify('notify.bagLeft', {}, 'warn');
    void this.save(true);
  }

  // ------------------------------------------------------------------ building

  pieceAvailable(type: PieceType): boolean {
    const u = PIECES[type].unlock;
    return !u || this.crafting.unlocked.has(u);
  }

  pieceCost(type: PieceType): ItemList {
    return Building.cost(type, this.progression.buildCost());
  }

  /**
   * In-game graphics popover: changes apply at once and the game keeps
   * running. With a mouse the cursor is released while it is open.
   */
  toggleQuickGraphics(open = !this.hud.quickGraphicsOpen): void {
    if (this.state !== 'playing') open = false;
    this.hud.showQuickGraphics(open);
    const mouse = this.input.mode !== 'touch';
    if (open && mouse) {
      this.input.uiCapture = true;
      document.exitPointerLock?.();
    } else if (!open && !this.hud.panelOpen && !this.hud.documentOpen) this.input.uiCapture = false;
  }

  toggleBuild(): void {
    this.building = !this.building;
    // With a mouse the cursor is released to aim and to use the build screen.
    this.input.freeCursor = this.building && this.input.mode !== 'touch';
    if (this.input.freeCursor && this.input.pointerLocked) document.exitPointerLock?.();
    if (!this.building) {
      this.buildCtl.cancel();
      this.removeGhost();
    }
    this.buildRepeat.clear();
    this.buildPlacement = null;
    this.hud.showBuild(this.building);
  }

  setBuildPiece(p: PieceType): void {
    this.buildCtl.select(p);
  }

  /** Drops the preview without building anything or spending materials. */
  cancelBuildPlacement(): void {
    this.buildCtl.cancel();
    this.removeGhost();
    this.buildPlacement = null;
  }

  private removeGhost(): void {
    if (!this.ghost) return;
    this.ghost.removeFromParent();
    disposeObject(this.ghost);
    this.ghost = null;
    this.ghostType = null;
  }

  private updateBuild(dt: number): void {
    const p = this.player!;
    const input = this.input;
    const bc = this.buildCtl;
    const rr = this.buildRepeat;
    if (input.consume('snapToggle')) bc.snap = !bc.snap;
    if (input.consume('buildStep')) bc.cycleStep();
    if (input.consume('buildRotReset')) bc.resetRotation();
    const yaw = p.s.yaw;
    const held = (a: Action) => rr.steps(a, input.consume(a), input.isHeld(a), dt);
    const rotL = held('rotateLeft');
    const rotR = held('rotateRight');
    const moves: [Action, NudgeDir][] = [['buildForward', 'forward'], ['buildBack', 'back'], ['buildLeft', 'left'], ['buildRight', 'right']];
    const nudges = moves.map(([a, d]) => [d, held(a)] as const);
    const up = held('buildRaise');
    const down = held('buildLower');

    if (!bc.selected) {
      // Catalogue only: no preview until a piece is chosen.
      this.removeGhost();
      this.buildPlacement = null;
      input.consume('attack');
      this.hud.showBuild(true);
      this.demolishInFront();
      return;
    }
    const type = bc.selected;
    if (this.ghostType !== type) {
      this.removeGhost();
      this.ghost = createGhost(type);
      this.ghostType = type;
      this.worldRoot.add(this.ghost);
    }
    const big = ['foundation', 'stone_foundation', 'platform', 'floor', 'roof'].includes(type);
    const dist = big ? 5 : 3.5;
    const [fx, fz] = p.forward();
    let aimX = p.s.x + fx * dist;
    let aimZ = p.s.z + fz * dist;
    // Free cursor: the preview goes where the mouse points on the ground.
    const hit = input.freeCursor && !input.pointerLocked && input.cursor.valid ? this.groundUnderCursor() : null;
    if (hit) {
      aimX = hit.x;
      aimZ = hit.z;
    }
    // Adjustments start from where the preview is shown now (already snapped).
    const cur = this.buildPlacement && this.buildPlacement.type === type ? { x: this.buildPlacement.x, z: this.buildPlacement.z } : bc.target(aimX, aimZ, yaw);
    for (const [d, n] of nudges) if (n) bc.nudge(d, cur, yaw, n);
    if (up) bc.raise(1, cur, yaw, up);
    if (down) bc.raise(-1, cur, yaw, down);
    if (rotL) bc.rotate(-1, rotL);
    if (rotR) bc.rotate(1, rotR);
    const tg = bc.target(aimX, aimZ, yaw);
    const pl = this.buildingSys!.preview(type, tg.x, tg.z, tg.rot, bc.snap, {
      height: (x, z) => this.terrain!.height(x, z),
      waterLevel: this.env!.waterLevel,
      collision: this.collision,
    }, p.s.x, p.s.z, bc.lift);
    if (pl.valid && !this.pieceAvailable(pl.type)) {
      pl.valid = false;
      pl.reason = 'locked';
    }
    if (pl.valid && !this.inventory.has(this.pieceCost(pl.type))) {
      pl.valid = false;
      pl.reason = 'materials';
    }
    // Don't trap the player inside a solid piece.
    if (pl.valid && PIECES[pl.type].solid && !['foundation', 'stone_foundation', 'floor', 'platform', 'roof', 'stairs'].includes(pl.type)) {
      const c = this.buildingSys!.colliderFor({ id: '_', type: pl.type, x: pl.x, y: pl.y, z: pl.z, rot: pl.rot });
      if (c && CollisionWorld.penetration(c, p.s.x, p.s.z, 0.4) && p.s.y < c.y1 && p.s.y + 1.8 > c.y0) {
        pl.valid = false;
        pl.reason = 'blocked';
      }
    }
    const g = this.ghost!;
    g.position.set(pl.x, pl.y, pl.z);
    g.rotation.y = -pl.rot;
    (g.userData.mat as THREE.MeshBasicMaterial).color.set(pl.valid ? 0x55ff77 : 0xff5544);
    this.buildPlacement = pl;
    this.hud.showBuild(true, pl.valid ? null : pl.reason ?? null);

    // Confirm: the placement was validated this very frame (position, support,
    // obstacles, materials); materials are only taken if the piece is created.
    // The cooldown absorbs double clicks/taps.
    if (input.consume('attack') && this.attackCooldown <= 0) {
      this.attackCooldown = 0.25;
      if (pl.valid) {
        const piece = this.buildingSys!.place(pl, this.inventory, this.progression.buildCost());
        if (piece) {
          this.addPieceView(piece);
          this.audio.sfx('place', [piece.x, piece.y, piece.z]);
          this.xp('building', 5);
          bc.placed();
          this.notify('build.placed', { what: t(`piece.${piece.type}`) }, 'good');
        }
      } else if (pl.reason) this.notify(`build.invalid.${pl.reason}`, {}, 'warn');
    }
    this.demolishInFront();
  }

  private readonly rayDir = new THREE.Vector3();
  /** Ground (terrain or a walkable piece) under the mouse cursor, within building reach. */
  private groundUnderCursor(): { x: number; z: number } | null {
    const c = this.input.cursor;
    const o = this.camera.position;
    const d = this.rayDir.set(c.x, c.y, 0.5).unproject(this.camera).sub(o).normalize();
    const p = this.player!.s;
    for (let s = 0.5; s < 30; s += 0.25) {
      const x = o.x + d.x * s;
      const y = o.y + d.y * s;
      const z = o.z + d.z * s;
      const ground = Math.max(this.terrain!.height(x, z), this.collision.surfaceAt(x, z, y + 0.3));
      if (y <= ground) return Math.hypot(x - p.x, z - p.z) <= 11 ? { x, z } : null;
    }
    return null;
  }

  private demolishInFront(): void {
    const input = this.input;
    if (input.consume('demolish')) {
      // The piece the player is looking at (closest in front, within 7 m).
      let target: Piece | null = null;
      let best = Infinity;
      for (const pc of this.buildingSys!.pieces.values()) {
        const d = this.actions.inFront(pc.x, pc.z, 7, 0.6, pc.y);
        if (d !== null && d < best) {
          best = d;
          target = pc;
        }
      }
      if (target) {
        if (this.storageOpen?.id === target.id) this.storageOpen = null;
        const res = this.buildingSys!.demolish(target.id, this.inventory);
        const view = this.pieceViews.get(target.id);
        if (view) {
          view.removeFromParent();
          disposeObject(view);
        }
        this.pieceViews.delete(target.id);
        if (res?.overflow.length) this.createBag(res.overflow, 'drop');
        if (this.respawnPoint?.pieceId === target.id) this.respawnPoint = null;
        this.audio.sfx('demolish', [target.x, target.y, target.z]);
        this.notify('build.demolished');
      }
    }
  }

  private addPieceView(p: Piece): void {
    const o = createPieceObject(p.type);
    syncPieceObject(o, p, this.time);
    this.worldRoot.add(o);
    this.pieceViews.set(p.id, o);
  }

  // ------------------------------------------------------------------ view sync

  private syncViews(dt: number): void {
    const eco = this.eco!;
    const now = this.env!.state.time;
    const cam = this.camera.position;
    const activeIds = new Set<string>();
    for (const a of eco.active) {
      activeIds.add(a.id);
      let v = this.animalViews.get(a.id);
      // Juveniles have their own proportions: swap the model when the animal grows up.
      const young = lifeStage(a, now) === 'juvenile';
      if (v && (v.juvenile !== young || v.alpha !== !!a.alpha)) {
        disposeAnimalView(v);
        this.animalViews.delete(a.id);
        v = undefined;
      }
      if (!v) {
        v = createAnimalView(a.speciesId, a.id, young, !!a.alpha);
        this.animalViews.set(a.id, v);
        this.worldRoot.add(v.root);
      }
      const camDist = Math.hypot(a.x - cam.x, a.z - cam.z);
      v.root.visible = !this.inCave;
      poseAnimalView(v, a, eco.brain.stridePhase(a), eco.brain.altitude(a), now, dt, camDist, this.quality().animalLod);
      if (v.aura) updateAlphaAura(v.aura, now, a.state === 'alert' || a.state === 'defend' || a.state === 'hunt', a.alive && !this.inCave, dt, this.renderer.domElement.height);
      if (this.inCave || !a.alive) continue;
      const sp = SPECIES[a.speciesId];
      const label = a.tame ? a.tame.name : sp.name[language()];
      // Vocalizations on meaningful state changes, plus occasional idle calls.
      const prev = this.lastStates.get(a.id);
      const occluded = this.occluded(a.x, a.y + sp.hipHeightM, a.z);
      if (prev !== a.state) {
        // Alphas always answer with a deep dominance roar when they turn to face something.
        const voice = growthScale(a, now) * (a.alpha ? 1.6 : 1);
        if (a.state === 'flee' || a.state === 'defend' || (a.state === 'alert' && (a.alpha || this.rng.chance(0.3)))) this.audio.call(sp, a.x, a.y + sp.hipHeightM, a.z, voice, a.state === 'alert' ? 0 : 1, occluded, label);
        this.lastStates.set(a.id, a.state);
      } else if (this.rng.chance(dt * 0.012)) this.audio.call(sp, a.x, a.y + sp.hipHeightM, a.z, growthScale(a, now), 0, occluded, label);
      if ((a.state === 'graze' || a.state === 'eat') && a.speed < 0.1 && camDist < 40) this.audio.feeding(a.x, a.y + 1, a.z, sp.massKg > 1000);
      // Heavy footfalls of big animals.
      if (sp.massKg > 1500 && a.speed > 0.3 && camDist < 90) {
        const stride = Math.floor(eco.brain.stridePhase(a));
        if (stride !== this.animalSteps.get(a.id)) {
          this.animalSteps.set(a.id, stride);
          this.audio.footstep('grass', 1, [a.x, a.y, a.z], Math.min(0.6, sp.massKg / 15000) * (1 - camDist / 100));
        }
      }
    }
    for (const [id, v] of this.animalViews) {
      if (!activeIds.has(id)) {
        disposeAnimalView(v);
        this.animalViews.delete(id);
        this.lastStates.delete(id);
        this.animalSteps.delete(id);
      }
    }
    // Nests near the player.
    const p = this.player!;
    const near = new Set<string>();
    for (const n of eco.nests.values()) {
      if (Math.hypot(n.x - p.s.x, n.z - p.s.z) > 150) continue;
      near.add(n.id);
      if (!this.nestViews.has(n.id)) {
        const o = createNestView(n.eggs, Math.max(0.6, Math.min(3, SPECIES[n.speciesId].lengthM * 0.15)));
        o.position.set(n.x, this.terrain!.height(n.x, n.z), n.z);
        o.userData.eggs = n.eggs;
        this.worldRoot.add(o);
        this.nestViews.set(n.id, o);
      }
    }
    for (const [id, o] of this.nestViews) {
      const n = eco.nests.get(id);
      if (!near.has(id) || !n || n.eggs !== o.userData.eggs) {
        o.removeFromParent();
        disposeObject(o);
        this.nestViews.delete(id);
      }
    }
    // Item bags.
    const bagIds = new Set(this.bags.map((b) => b.id));
    for (const b of this.bags) {
      if (this.bagViews.has(b.id)) continue;
      const o = new THREE.Group();
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshStandardMaterial({ color: b.reason === 'death' ? 0x8a3a2a : 0x7a6a48, roughness: 0.9 }));
      m.scale.y = 0.7;
      m.position.y = 0.25;
      m.castShadow = true;
      o.add(m);
      if (b.reason === 'death') {
        const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 30, 6), new THREE.MeshBasicMaterial({ color: 0xff6a3a, transparent: true, opacity: 0.5 }));
        beacon.position.y = 15;
        o.add(beacon);
      }
      o.position.set(b.x, b.y, b.z);
      this.worldRoot.add(o);
      this.bagViews.set(b.id, o);
    }
    for (const [id, o] of this.bagViews) {
      if (!bagIds.has(id)) {
        o.removeFromParent();
        disposeObject(o);
        this.bagViews.delete(id);
      }
    }
    // Pieces with dynamic state.
    for (const [id, o] of this.pieceViews) {
      const pc = this.buildingSys!.pieces.get(id);
      if (pc) syncPieceObject(o, pc, this.time);
    }
  }

  /** Terrain between the listener and a sound source muffles it. */
  private occluded(x: number, y: number, z: number): boolean {
    const c = this.camera.position;
    for (let i = 1; i < 6; i++) {
      const f = i / 6;
      const px = c.x + (x - c.x) * f;
      const pz = c.z + (z - c.z) * f;
      const py = c.y + (y - c.y) * f;
      if (this.terrain!.height(px, pz) > py + 1) return true;
    }
    return this.collision.blocked((c.x + x) / 2, (c.z + z) / 2, 0.1, (c.y + y) / 2 - 0.5, 1);
  }

  mapMarkers(): MapMarker[] {
    const out: MapMarker[] = [];
    const p = this.player;
    if (!p) return out;
    for (const s of PLANNED_SITES) if (this.discovered.has(s.id)) out.push({ x: s.x, z: s.z, kind: 'site', label: t(`site.${s.id}`) });
    for (const b of this.bags) if (b.reason === 'death') out.push({ x: b.x, z: b.z, kind: 'bag' });
    if (this.respawnPoint) out.push({ x: this.respawnPoint.x, z: this.respawnPoint.z, kind: 'bed' });
    for (const m of this.exploration.d.markers) out.push({ x: m.x, z: m.z, kind: 'marker', label: m.icon });
    for (const a of this.tamedAnimals()) out.push({ x: a.x, z: a.z, kind: 'tame', label: a.tame!.name });
    // The volcano is a landmark visible from far away.
    out.push({ x: VOLCANO.x, z: VOLCANO.z, kind: 'landmark', label: t('landmark.volcano') });
    out.push({ x: p.s.x, z: p.s.z, kind: 'player', heading: p.s.yaw });
    return out;
  }

  mapClick(x: number, z: number): void {
    this.exploration.toggleMarker(x, z);
  }

  skillTrees(): { tree: Tree; level: number; xp: number; next: number; points: number }[] {
    return TREES.map((tree) => {
      const level = this.progression.level(tree);
      return { tree, level, xp: this.progression.d.xp[tree], next: level >= 10 ? 0 : Math.round(40 * Math.pow(level + 1, 1.6)), points: this.progression.points(tree) };
    });
  }

  skillList(): typeof SKILLS {
    return SKILLS;
  }

  isJuvenile(a: AnimalData): boolean {
    return lifeStage(a, this.env?.state.time ?? 0) === 'juvenile';
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
