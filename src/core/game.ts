import * as THREE from 'three';
import { AudioSystem } from '../audio/audio';
import { type AIState } from '../animals/animal';
import { growthScale, lifeStage } from '../animals/animal';
import { createAnimalView, createNestView, poseAnimalView, type AnimalView } from '../animals/animalView';
import { Ecosystem, createEcosystemState, type EcoContext } from '../animals/ecosystem';
import { SPECIES } from '../animals/species';
import { Building, PIECES, type Piece, type PieceType } from '../building/building';
import { createGhost, createPieceObject, syncPieceObject } from '../building/pieceViews';
import { Crafting } from '../crafting/crafting';
import { RECIPES, type Station } from '../crafting/recipes';
import { Input } from '../input/input';
import { Inventory, createInventory, type ItemList, type Stack } from '../inventory/inventory';
import { ITEMS, type EquipSlot } from '../inventory/items';
import { language, setLanguage, t } from '../localization/i18n';
import { PerfMonitor } from '../performance/perf';
import { CameraRig } from '../player/cameraRig';
import { PlayerController } from '../player/player';
import { PlayerView } from '../player/playerView';
import { SAVE_VERSION, type ItemBag, type SaveData } from '../save/saveData';
import { exportSave, importSave, readSave, writeSave } from '../save/storage';
import { Survival, createSurvival } from '../survival/survival';
import { Hud, type GameApi } from '../ui/hud';
import { BIOMES, type BiomeId } from '../world/biomes';
import { CollisionWorld } from '../world/collision';
import { Environment, createEnvState, type EnvEvent } from '../world/environment';
import { EnvironmentView } from '../world/environmentView';
import { SectorManager, type ResourceNode } from '../world/sectors';
import { PLANNED_SITES, SPAWN, Terrain, VOLCANO } from '../world/terrain';
import { VEG_YIELD } from '../world/vegetationModels';
import { DIFFICULTY, QUALITY, loadSettings, saveSettings, type QualityLevel, type Settings } from './config';
import { clamp } from './math';
import { Rng } from './rng';

type GameState = 'menu' | 'loading' | 'playing' | 'paused' | 'dead';
const SAVE_SLOT = 'main';

interface Projectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  life: number;
}

interface Interaction {
  label: string;
  run: () => void;
}

/**
 * Top-level orchestrator: owns the renderer, the main loop and every system,
 * and implements the API the UI uses. Gameplay rules live in the systems; this
 * class wires them together.
 */
export class Game implements GameApi {
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
  eco: Ecosystem | null = null;
  buildingSys: Building | null = null;
  player: PlayerController | null = null;
  rig: CameraRig;
  playerView: PlayerView | null = null;
  survival: Survival | null = null;
  inventory = new Inventory();
  crafting = new Crafting();
  private worldRoot = new THREE.Group();
  private animalViews = new Map<string, AnimalView>();
  private nestViews = new Map<string, THREE.Object3D>();
  private pieceViews = new Map<string, THREE.Object3D>();
  private bagViews = new Map<string, THREE.Object3D>();
  private projectiles: Projectile[] = [];
  private lastStates = new Map<string, AIState>();
  bags: ItemBag[] = [];
  private nextBagId = 1;
  discovered = new Set<string>();
  seenSpecies = new Set<string>();
  selectedHotbar = 0;
  buildPiece: PieceType = 'foundation';
  buildSnap = true;
  building = false;
  private buildRot = 0;
  private ghost: THREE.Group | null = null;
  private ghostType: PieceType | null = null;
  private storageOpen: Piece | null = null;
  private hostileUntil = 0;
  private attackCooldown = 0;
  private respawnPoint: { x: number; z: number; pieceId?: string } | null = null;
  private deaths = 0;
  private lastBiome: BiomeId | null = null;
  private autosave = 0;
  private uiTimer = 0;
  private slowTimer = 0;
  private sleeping = false;
  private lastDamageSource = 'other';
  private needWarned = { food: false, water: false };
  private qualityLevel: QualityLevel;
  private last = performance.now();
  private interaction: Interaction | null = null;
  private time = 0;
  private showPerf = false;
  private rng = new Rng(Date.now() & 0xffffffff);

  constructor(canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    setLanguage(this.settings.language);
    this.input = new Input(canvas);
    this.hud = new Hud(this);
    this.input.onModeChange = (m) => this.hud.setTouchMode(m === 'touch');
    this.qualityLevel = this.settings.quality === 'auto' ? PerfMonitor.initialGuess() : this.settings.quality;
    this.perf = new PerfMonitor(this.qualityLevel);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.qualityLevel !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene.add(this.worldRoot);
    this.rig = new CameraRig(this.camera);
    this.applyQuality();
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
        e.preventDefault();
      }
    });
    (window as unknown as { __edg: Game }).__edg = this;
  }

  async boot(): Promise<void> {
    try {
      this.hasSave = !!(await readSave(SAVE_SLOT));
    } catch {
      this.hasSave = false;
    }
    this.hud.mainMenu();
    this.hud.setGameplayVisible(false);
    requestAnimationFrame(this.loop);
  }

  private resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private applyQuality(): void {
    const q = QUALITY[this.qualityLevel];
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatioCap));
    this.renderer.shadowMap.enabled = q.shadows;
    this.envView?.applyQuality(q);
    this.camera.far = (q.loadRadius + 1) * 128 * 1.5;
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
      world: { harvested: {}, bags: [], nextBagId: 1, discovered: [] },
    };
  }

  newGame(seed: number): void {
    this.startWorld(this.freshSave(seed));
  }

  async continueGame(): Promise<void> {
    try {
      const res = await readSave(SAVE_SLOT);
      if (!res) return this.newGame(Date.now() % 1e6);
      if (res.issues.length) console.warn('Save repaired:', res.issues);
      this.startWorld(res.data);
    } catch (e) {
      console.error(e);
      this.hud.notify(t('menu.importFailed'), 'warn');
    }
  }

  private teardown(): void {
    this.sectors?.dispose();
    this.worldRoot.clear();
    for (const v of this.animalViews.values()) v.root.removeFromParent();
    this.animalViews.clear();
    this.nestViews.clear();
    this.pieceViews.clear();
    this.bagViews.clear();
    this.projectiles = [];
    this.lastStates.clear();
    this.collision = new CollisionWorld();
    if (this.envView) {
      // Rebuild the scene to drop environment objects.
      this.scene.clear();
      this.scene.add(this.worldRoot);
      this.envView = null;
    }
    this.ghost = null;
    this.ghostType = null;
    this.building = false;
  }

  private startWorld(save: SaveData): void {
    this.teardown();
    this.seed = save.seed;
    const terrain = (this.terrain = new Terrain(save.seed));
    this.env = new Environment(save.env, terrain);
    this.envView = new EnvironmentView(this.scene, this.env);
    this.envView.applyQuality(QUALITY[this.qualityLevel]);
    this.sectors = new SectorManager(terrain, this.collision, save.seed, save.world.harvested);
    this.worldRoot.add(this.sectors.root);
    this.eco = new Ecosystem(save.eco, terrain, this.env, save.seed);
    this.buildingSys = new Building(save.building, this.collision);
    this.inventory = new Inventory(save.inventory);
    this.crafting = new Crafting(new Set(save.crafting.unlocked));
    this.crafting.queue = save.crafting.queue ?? [];
    this.survival = new Survival(save.player.survival, DIFFICULTY[this.settings.difficulty]);
    this.player = new PlayerController({ x: save.player.x, y: save.player.y, z: save.player.z, yaw: save.player.yaw, pitch: -0.15 });
    this.playerView = new PlayerView();
    this.worldRoot.add(this.playerView.root);
    this.respawnPoint = save.player.respawn;
    this.deaths = save.player.deaths ?? 0;
    this.bags = save.world.bags;
    this.nextBagId = save.world.nextBagId;
    this.discovered = new Set(save.world.discovered);
    this.seenSpecies = new Set(save.world.seen ?? []);
    for (const p of this.buildingSys.pieces.values()) this.addPieceView(p);
    this.lastBiome = null;
    this.state = 'loading';
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
      },
    };
  }

  async save(silent = false): Promise<void> {
    if (!this.player || this.state === 'loading' || this.state === 'menu') return;
    try {
      this.sectors!.pruneHarvested(this.env!.state.time);
      // structuredClone detaches the snapshot from live objects mutated during the async write.
      await writeSave(SAVE_SLOT, structuredClone(this.snapshot()));
      this.hasSave = true;
      if (!silent) this.hud.notify(t('menu.saved'), 'good');
    } catch (e) {
      console.error(e);
      this.hud.notify(t('menu.saveFailed'), 'warn');
    }
  }

  exportSave(): void {
    if (!this.player) return;
    const blob = exportSave(this.snapshot());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `era-dos-gigantes-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async importSave(f: File): Promise<void> {
    try {
      const data = await importSave(f);
      await writeSave(SAVE_SLOT, data);
      this.hasSave = true;
      this.hud.notify(t('menu.imported'), 'good');
      this.startWorld(data);
    } catch (e) {
      console.error(e);
      this.hud.notify(t('menu.importFailed'), 'warn');
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
      this.applyQuality();
    }
  }

  // ------------------------------------------------------------------ main loop

  private loop = (now: number): void => {
    requestAnimationFrame(this.loop);
    const rawDt = (now - this.last) / 1000;
    const dt = Math.min(0.1, rawDt);
    this.last = now;
    this.time += dt;
    this.input.poll(dt);

    // Real elapsed time (not the clamped step) so slow devices are detected correctly.
    const adj = this.perf.frame(Math.min(rawDt, 1), this.settings.quality === 'auto' && this.state === 'playing');
    if (adj) {
      this.qualityLevel = adj;
      this.applyQuality();
    }
    this.hud.setPerf(this.showPerf ? `${t('perf.fps', { fps: Math.round(this.perf.fps), q: this.qualityLevel })} · ${this.renderer.info.render.calls} dc · ${this.eco?.active.length ?? 0}/${this.eco?.animals.size ?? 0} 🦖` : null);

    if (this.state === 'loading') this.updateLoading();
    else if (this.state === 'playing') this.update(dt);
    else if (this.state === 'paused') {
      if (this.input.consume('pause')) this.resume();
    }
    this.input.clearPresses();
    if (this.player && this.envView) this.renderer.render(this.scene, this.camera);
    else {
      this.renderer.setClearColor(0x1c1a16);
      this.renderer.clear();
    }
  };

  private updateLoading(): void {
    const p = this.player!;
    this.sectors!.update(p.s.x, p.s.z, QUALITY[this.qualityLevel], this.env!.state.time, 40);
    this.eco!.seedAround(p.s.x, p.s.z);
    const q = QUALITY[this.qualityLevel];
    const total = (q.loadRadius * 2 + 1) ** 2;
    this.hud.loading(Math.min(1, this.sectors!.loadedCount / total));
    this.rig.update(0.016, p, this.settings.firstPerson, this.terrain!, this.collision);
    this.envView!.update(0.016, this.camera, new THREE.Vector3(p.s.x, p.s.y, p.s.z), false);
    if (this.sectors!.isReady && this.sectors!.pending === 0) {
      // Settle the player on the ground now that colliders exist.
      p.s.y = Math.max(p.s.y, this.terrain!.height(p.s.x, p.s.z));
      this.state = 'playing';
      this.hud.hideMenu();
      this.hud.setGameplayVisible(true);
      this.hud.renderHotbar();
    }
  }

  private update(realDt: number): void {
    const p = this.player!;
    const env = this.env!;
    const surv = this.survival!;
    const input = this.input;
    const terrain = this.terrain!;
    const panel = this.hud.panelOpen;

    // --- UI toggles.
    if (input.consume('pause')) {
      if (panel) this.resume();
      else if (this.building) this.toggleBuild();
      else this.pause();
      return;
    }
    if (input.consume('inventory')) {
      if (panel) this.resume();
      else this.openPanel('inventory');
    }
    if (input.consume('map')) {
      if (panel && this.hud.tab === 'map') this.resume();
      else this.openPanel('map');
    }
    if (input.consume('build') && !panel) this.toggleBuild();
    if (input.consume('camera')) this.applySettings({ firstPerson: !this.settings.firstPerson });
    for (let i = 0; i < 6; i++) if (input.consume(`hot${i + 1}` as 'hot1')) this.selectedHotbar = i;
    if (input.wheel) {
      if (this.building) this.buildRot += input.wheel * (this.buildSnap ? Math.PI / 2 : Math.PI / 12);
      else if (!this.settings.firstPerson) this.rig.zoom(input.wheel);
      input.wheel = 0;
    }

    // --- Look.
    const look = input.consumeLook();
    if (!panel) {
      const sens = input.mode === 'touch' ? 0.004 : 0.0024 * this.settings.mouseSensitivity;
      p.s.yaw -= look.x * sens;
      p.s.pitch -= look.y * sens * (this.settings.invertY ? -1 : 1);
    }

    // --- Time (sleeping accelerates time).
    if (this.sleeping) {
      const done = (env.dayFraction > 0.27 && env.dayFraction < 0.5 && surv.d.energy > 60) || surv.d.energy >= 99;
      if (done || input.move.x || input.move.y) this.sleeping = false;
    }
    const timeScale = this.sleeping ? 40 : 1;
    const dt = realDt * timeScale;
    const events: EnvEvent[] = [];
    env.update(dt, p.s.x, p.s.z, events);
    this.handleEnvEvents(events);

    // --- Player movement.
    const sample = terrain.sample(p.s.x, p.s.z);
    const biome = this.sectors!.biomeCoarse(p.s.x, p.s.z);
    const weight = this.inventory.weight();
    const cap = this.inventory.capacity();
    const overweight = Math.max(0, weight / cap - 1);
    let biomeMul = BIOMES[biome].movement;
    if (env.flooding && sample.height < env.waterLevel + 0.5) biomeMul *= 0.6;
    const dynamic: { x: number; z: number; r: number }[] = [];
    for (const a of this.eco!.active) {
      const sp = SPECIES[a.speciesId];
      if (!a.alive || sp.lengthM < 2 || Math.abs(a.x - p.s.x) > 20 || Math.abs(a.z - p.s.z) > 20) continue;
      if (Math.abs(a.y - p.s.y) > sp.hipHeightM * 2 + 2) continue;
      dynamic.push({ x: a.x, z: a.z, r: sp.lengthM * 0.14 * growthScale(a, env.state.time) });
    }
    const moveEnabled = !panel && !this.sleeping;
    p.update(
      realDt,
      {
        x: moveEnabled ? input.move.x : 0,
        y: moveEnabled ? input.move.y : 0,
        sprint: input.held('sprint'),
        crouch: input.held('crouch'),
        jump: moveEnabled && input.consume('jump'),
      },
      {
        terrain,
        collision: this.collision,
        waterLevel: env.waterLevel,
        speedMul: surv.speedMultiplier() * (overweight > 0 ? Math.max(0.35, 1 - overweight * 1.5) : 1),
        canSprint: surv.canSprint() && overweight < 0.3,
        biomeMul,
        dynamic,
      },
      this.settings.firstPerson,
    );
    p.s.x = clamp(p.s.x, -5100, 5100);
    p.s.z = clamp(p.s.z, -5100, 5100);
    if (p.landingImpact > 0) {
      surv.damage((p.landingImpact - 11) * 6, this.armor(), 'fall');
      this.lastDamageSource = 'fall';
      p.landingImpact = 0;
      this.hud.damageFlash();
    }

    // --- Survival.
    const airTemp = env.temperatureAt(sample.temperature, biome);
    const held = this.heldItem();
    const nearCampfire = !!this.buildingSys!.nearest(p.s.x, p.s.z, 4.5, (pc) => pc.type === 'campfire');
    const nearWildfire = env.state.fires.some((f) => Math.hypot(f.x - p.s.x, f.z - p.s.z) < f.r + 15);
    const sheltered = this.buildingSys!.sheltered(p.s.x, p.s.z, p.s.y);
    const ctx = {
      airTemp,
      insulation: this.insulation(),
      exertion: p.sprinting ? 2 : p.horizontalSpeed > 0.5 ? 1 : 0,
      sprinting: p.sprinting && p.horizontalSpeed > 1,
      inWater: p.swimming,
      nearFire: nearCampfire || held?.id === 'torch' || nearWildfire,
      sheltered,
      resting: this.sleeping,
      overweight,
    };
    surv.update(dt, ctx);
    if (env.state.fires.some((f) => Math.hypot(f.x - p.s.x, f.z - p.s.z) < f.r * 0.8)) {
      surv.damage(6 * realDt, 0, 'burn');
      this.lastDamageSource = 'fire';
    }
    if (env.eruptionActive && Math.hypot(p.s.x - VOLCANO.x, p.s.z - VOLCANO.z) < 520) {
      surv.damage(4 * realDt, 0, 'burn');
      this.lastDamageSource = 'fire';
    }
    if (surv.d.bodyTemp < 34.5) this.lastDamageSource = 'cold';
    if (surv.d.bodyTemp > 40) this.lastDamageSource = 'heat';
    if (surv.d.food <= 0) this.lastDamageSource = 'starvation';
    if (surv.d.water <= 0) this.lastDamageSource = 'thirst';
    if (surv.d.bleeding > 0.2) this.lastDamageSource = this.lastDamageSource.startsWith('animal:') ? this.lastDamageSource : 'bleeding';
    this.warnNeeds();

    // --- Actions.
    this.attackCooldown -= realDt;
    if (this.building) this.updateBuild();
    else if (!panel) this.updateActions(realDt);
    if (!panel && input.consume('eat')) this.useHeld();
    this.updateProjectiles(realDt);

    // --- Ecosystem (sub-stepped while sleeping).
    const ecoCtx: EcoContext = {
      player: {
        x: p.s.x,
        z: p.s.z,
        alive: surv.alive,
        noiseRadius: this.sleeping ? 2 : p.noiseRadius(),
        hostileUntil: this.hostileUntil,
        visibility: (p.crouching ? 0.5 : 1) * (env.isNight ? (held?.id === 'torch' ? 1 : 0.5) : 1),
        running: p.sprinting,
        hasFire: held?.id === 'torch' || nearCampfire,
      },
      predatorBoldness: DIFFICULTY[this.settings.difficulty].predatorBoldness,
      maxActive: QUALITY[this.qualityLevel].maxActiveAnimals,
      blocked: (x, z, r) => this.collision.query(x, z, r + 1).some((c) => (c.kind === 'box' ? c.enabled : c.r > 1.5) && CollisionWorld.penetration(c, x, z, r) !== null),
      damagePlayer: (amount, a) => this.onAnimalHitsPlayer(amount, a.speciesId),
    };
    const steps = this.sleeping ? 6 : 1;
    for (let i = 0; i < steps; i++) this.eco!.update(Math.min(dt / steps, 0.5), ecoCtx);
    this.eco!.seedAround(p.s.x, p.s.z);

    // --- Crafting & base processes.
    const res = this.crafting.update(dt, this.inventory);
    for (const id of res.completed) this.hud.notify(t('craft.done', { what: t(`item.${RECIPES.find((r) => r.id === id)!.output}`) }), 'good');
    if (res.completed.length) this.inventory.autoHotbar();
    this.dropOverflow(res.overflow);
    this.buildingSys!.tick(dt, env.state.weather === 'rain' || env.state.weather === 'storm', env.growthFactor);

    // --- Streaming & visuals.
    this.sectors!.update(p.s.x, p.s.z, QUALITY[this.qualityLevel], env.state.time);
    this.syncViews(realDt);
    const focus = new THREE.Vector3(p.s.x, p.s.y, p.s.z);
    this.envView!.update(realDt, this.camera, focus, ctx.airTemp < 0 || biome === 'snow');
    this.envView!.groundFires((x, z) => terrain.height(x, z));
    this.rig.update(realDt, p, this.settings.firstPerson, terrain, this.collision);
    this.playerView!.setHeld(held && ['tool', 'weapon'].includes(ITEMS[held.id].category) ? held.id : '');
    this.playerView!.update(realDt, p, this.settings.firstPerson);

    // --- Audio.
    const [fx, fz] = p.forward();
    this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, fx, fz);
    const precip = env.state.weather === 'rain' || env.state.weather === 'storm' ? env.state.intensity : 0;
    this.audio.ambience(env.state.windSpeed * (sheltered ? 0.3 : 1), precip * (sheltered ? 0.5 : 1));
    if (env.lightning) this.audio.thunder(Math.hypot(env.lightning.x - p.s.x, env.lightning.z - p.s.z));

    // --- Slow checks (discoveries, biome changes).
    this.slowTimer -= realDt;
    if (this.slowTimer <= 0) {
      this.slowTimer = 0.5;
      this.slowChecks(biome);
    }

    // --- HUD.
    this.uiTimer -= realDt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.1;
      this.hud.updateStats(surv.d, surv.feltTemp(ctx), overweight > 0);
      this.hud.updateTop(env.day, env.dayFraction, env.state.weather, biome, p.s.yaw);
      this.hud.renderHotbar();
      this.interaction = this.building || panel ? null : this.findInteraction();
      this.hud.prompt(this.interaction?.label ?? this.observePrompt());
      if (this.hud.panelOpen && (this.hud.tab === 'crafting' || this.hud.tab === 'inventory') && this.crafting.queue.length) this.hud.renderPanel();
    }

    // --- Death.
    if (!surv.alive) this.die();

    // --- Autosave.
    this.autosave += realDt;
    if (this.autosave > 120) {
      this.autosave = 0;
      void this.save(true);
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

  private openPanel(tab: 'inventory' | 'crafting' | 'map' | 'storage'): void {
    this.hud.openPanel(tab);
    this.input.uiCapture = true;
    document.exitPointerLock?.();
  }

  private warnNeeds(): void {
    const d = this.survival!.d;
    if (d.food < 20 && !this.needWarned.food) {
      this.needWarned.food = true;
      this.hud.notify(t('notify.needFood'), 'warn');
    } else if (d.food > 30) this.needWarned.food = false;
    if (d.water < 20 && !this.needWarned.water) {
      this.needWarned.water = true;
      this.hud.notify(t('notify.needWater'), 'warn');
    } else if (d.water > 30) this.needWarned.water = false;
  }

  private handleEnvEvents(events: EnvEvent[]): void {
    for (const e of events) {
      if (e.type === 'weather' && e.weather !== 'cloudy') this.hud.notify(t(`notify.weather.${e.weather}`));
      else if (e.type === 'fireStarted') this.hud.notify(t('notify.fire'), 'warn');
      else if (e.type === 'eruption' && e.active) this.hud.notify(t('notify.eruption'), 'warn');
      else if (e.type === 'flood') this.hud.notify(t(e.active ? 'notify.flood' : 'notify.floodEnd'), e.active ? 'warn' : 'info');
      else if (e.type === 'drought') this.hud.notify(t(e.active ? 'notify.drought' : 'notify.droughtEnd'), e.active ? 'warn' : 'info');
    }
  }

  private onAnimalHitsPlayer(amount: number, speciesId: string): void {
    const surv = this.survival!;
    surv.damage(amount, this.armor(), 'bite');
    this.lastDamageSource = `animal:${speciesId}`;
    this.sleeping = false;
    this.hud.damageFlash();
    this.audio.hit();
  }

  private slowChecks(biome: BiomeId): void {
    const p = this.player!;
    if (biome !== this.lastBiome) {
      if (this.lastBiome) this.hud.notify(t('notify.biome', { biome: t(`biome.${biome}`) }));
      this.lastBiome = biome;
      if (biome === 'snow') this.unlock('visited_snow');
    }
    for (const s of PLANNED_SITES) {
      if (this.discovered.has(s.id)) continue;
      if (Math.hypot(s.x - p.s.x, s.z - p.s.z) < s.radius + 40) {
        this.discovered.add(s.id);
        this.hud.notify(t('notify.discovered', { what: t(`site.${s.id}`) }), 'good');
        if (s.kind === 'research') this.unlock('found_research_site');
      }
    }
    // Species sightings: close enough and roughly in view.
    const [fx, fz] = [Math.sin(p.s.yaw), Math.cos(p.s.yaw)];
    for (const a of this.eco!.active) {
      if (!a.alive || this.seenSpecies.has(a.speciesId)) continue;
      const dx = a.x - p.s.x;
      const dz = a.z - p.s.z;
      const d = Math.hypot(dx, dz);
      if (d < 80 && (dx * fx + dz * fz) / Math.max(1, d) > 0.4) {
        this.seenSpecies.add(a.speciesId);
        const sp = SPECIES[a.speciesId];
        this.hud.notify(t('notify.discovered', { what: `${sp.name[language()]} (${sp.scientificName})` }), 'good');
      }
    }
    if (this.inventory.count('obsidian') > 0) this.unlock('found_obsidian');
  }

  private unlock(flag: string): void {
    if (this.crafting.unlocked.has(flag)) return;
    this.crafting.unlocked.add(flag);
    for (const r of RECIPES) if (r.unlock === flag) this.hud.notify(t('notify.unlock', { what: t(`item.${r.output}`) }), 'good');
  }

  // ------------------------------------------------------------------ interaction

  private inFront(x: number, z: number, maxDist: number, minDot = 0.35): number | null {
    const p = this.player!;
    const dx = x - p.s.x;
    const dz = z - p.s.z;
    const d = Math.hypot(dx, dz);
    if (d > maxDist) return null;
    if (d < 1.2) return d;
    const dot = (dx * Math.sin(p.s.yaw) + dz * Math.cos(p.s.yaw)) / d;
    return dot > minDot ? d : null;
  }

  private nodeInFront(): ResourceNode | null {
    const p = this.player!;
    let best: ResourceNode | null = null;
    let bd = Infinity;
    for (const n of this.sectors!.nodesNear(p.s.x, p.s.z, 4)) {
      const reach = 2.2 + (n.kind === 'boulder' ? 2.4 : n.kind === 'rock' ? 0.6 : 0.3) * n.scale;
      const d = this.inFront(n.x, n.z, reach);
      if (d !== null && d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  private keyLabel(): string {
    return this.input.mode === 'touch' ? '' : this.input.mode === 'gamepad' ? '[X]' : `[${this.input.keys.interact[0].replace('Key', '')}]`;
  }

  private findInteraction(): Interaction | null {
    const p = this.player!;
    const key = this.keyLabel();
    // Item bags.
    for (const b of this.bags) {
      if (Math.hypot(b.x - p.s.x, b.z - p.s.z) < 2.5) return { label: t('prompt.bag', { key }), run: () => this.pickupBag(b) };
    }
    // Building pieces.
    const piece = this.buildingSys!.nearest(p.s.x, p.s.z, 3.2, (pc) => ['door', 'bed', 'storage', 'water_collector', 'crop_plot'].includes(pc.type) && this.inFront(pc.x, pc.z, 3.2, 0.2) !== null);
    if (piece) {
      if (piece.type === 'door') return { label: t('prompt.door', { key }), run: () => this.buildingSys!.toggleDoor(piece.id) };
      if (piece.type === 'bed') return { label: t('prompt.sleep', { key }), run: () => this.sleepIn(piece) };
      if (piece.type === 'storage') return { label: t('prompt.storage', { key }), run: () => this.openStorage(piece) };
      if (piece.type === 'water_collector' && (piece.water ?? 0) >= 1)
        return { label: t('prompt.collector', { key, n: Math.floor(piece.water ?? 0) }), run: () => this.drinkCollector(piece) };
      if (piece.type === 'crop_plot') {
        if ((piece.growth ?? 0) >= 1) return { label: t('prompt.crop', { key }), run: () => this.harvestCrop(piece) };
        return { label: t('prompt.cropGrowing', { n: Math.floor((piece.growth ?? 0) * 100) }), run: () => {} };
      }
    }
    // Carcasses.
    for (const a of this.eco!.active) {
      if (a.alive || a.meat <= 0) continue;
      const sp = SPECIES[a.speciesId];
      if (this.inFront(a.x, a.z, 2.2 + sp.lengthM * 0.45 * growthScale(a, this.env!.state.time), 0.1) !== null)
        return { label: t('prompt.butcher', { key, what: sp.name[language()] }), run: () => this.butcher(a.id) };
    }
    // Resource nodes.
    const n = this.nodeInFront();
    if (n) return { label: t('prompt.harvest', { key, what: this.nodeName(n) }), run: () => this.harvest(n) };
    // Water.
    const [fx, fz] = p.forward();
    const wx = p.s.x + fx * 1.6;
    const wz = p.s.z + fz * 1.6;
    const env = this.env!;
    if (p.swimming || this.terrain!.height(wx, wz) < env.waterLevel - 0.15) {
      const salty = this.terrain!.continentMask(wx, wz) < 0.85;
      if (!salty) {
        const skin = this.inventory.data.slots.findIndex((s) => s?.id === 'waterskin');
        if (this.heldItem()?.id === 'waterskin' && skin >= 0) return { label: t('prompt.fill', { key }), run: () => this.fillWaterskin(skin) };
        return { label: t('prompt.drink', { key }), run: () => this.survival!.drink(25) };
      }
    }
    return null;
  }

  private observePrompt(): string | null {
    const p = this.player!;
    let best: { name: string; state: string } | null = null;
    let bd = 35;
    for (const a of this.eco!.active) {
      const d = this.inFront(a.x, a.z, bd, 0.9);
      if (d === null) continue;
      bd = d;
      const sp = SPECIES[a.speciesId];
      const stage = lifeStage(a, this.env!.state.time);
      best = { name: `${sp.name[language()]}${stage === 'juvenile' ? ' (filhote)' : ''}`, state: a.alive ? t(`ai.${a.state}`) : t('ai.dead') };
    }
    void p;
    return best ? t('prompt.observe', { what: best.name, state: best.state }) : null;
  }

  private nodeName(n: ResourceNode): string {
    const def = VEG_YIELD[n.kind as keyof typeof VEG_YIELD];
    if (n.kind === 'crate' || n.kind === 'scrap') return t('item.metal_scrap');
    return def ? t(`item.${Object.keys(def.drops)[0]}`) : n.kind;
  }

  private updateActions(dt: number): void {
    void dt;
    if (this.input.consume('interact') && this.interaction) this.interaction.run();
    const wantsAttack = this.input.consume('attack') || (this.input.mode === 'touch' && this.input.held('attack'));
    if (wantsAttack && this.attackCooldown <= 0) this.attack();
  }

  private attack(): void {
    const p = this.player!;
    const held = this.heldItem();
    this.attackCooldown = held?.id === 'bow' ? 0.9 : 0.6;
    this.playerView!.attackSwing();
    if (held?.id === 'bow') {
      if (!this.inventory.remove('arrow', 1)) {
        this.hud.notify(t('notify.noArrows'), 'warn');
        return;
      }
      this.fireArrow();
      this.wearHeld();
      return;
    }
    const def = held ? ITEMS[held.id] : null;
    const reach = held?.id.includes('spear') ? 3.2 : held ? 2.4 : 1.8;
    const now = this.env!.state.time;
    let target = null;
    let bd = Infinity;
    for (const a of this.eco!.active) {
      if (!a.alive) continue;
      const sp = SPECIES[a.speciesId];
      const r = sp.lengthM * 0.3 * growthScale(a, now);
      if (Math.abs(a.y + sp.hipHeightM * growthScale(a, now) - p.s.y) > sp.hipHeightM * 2 + 2.5) continue;
      const d = this.inFront(a.x, a.z, reach + r, 0.5);
      if (d !== null && d < bd) {
        bd = d;
        target = a;
      }
    }
    if (target) {
      const dmg = def?.damage ?? 4;
      this.eco!.playerAttack(target, dmg, p.s.x, p.s.z);
      this.hostileUntil = now + 10;
      this.audio.hit();
      this.wearHeld();
      return;
    }
    const n = this.nodeInFront();
    if (n) this.harvest(n);
  }

  private fireArrow(): void {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const p = this.player!;
    const pos = new THREE.Vector3(p.s.x, p.s.y + 1.5, p.s.z).addScaledVector(dir, 0.8);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 4), new THREE.MeshStandardMaterial({ color: 0x6a4a2a }));
    this.worldRoot.add(mesh);
    this.projectiles.push({ mesh, pos, vel: dir.multiplyScalar(45), damage: ITEMS.arrow.damage ?? 20, life: 4 });
  }

  private updateProjectiles(dt: number): void {
    const now = this.env!.state.time;
    for (const pr of this.projectiles) {
      const prev = pr.pos.clone();
      pr.vel.y -= 9.8 * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.life -= dt;
      pr.mesh.position.copy(pr.pos);
      pr.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pr.vel.clone().normalize());
      if (pr.pos.y < this.terrain!.height(pr.pos.x, pr.pos.z)) pr.life = 0;
      for (const a of this.eco!.active) {
        if (!a.alive || pr.life <= 0) continue;
        const sp = SPECIES[a.speciesId];
        const g = growthScale(a, now);
        const center = new THREE.Vector3(a.x, a.y + sp.hipHeightM * g, a.z);
        const seg = new THREE.Line3(prev, pr.pos);
        const closest = new THREE.Vector3();
        seg.closestPointToPoint(center, true, closest);
        if (closest.distanceTo(center) < Math.max(0.4, sp.lengthM * 0.22 * g)) {
          this.eco!.playerAttack(a, pr.damage, this.player!.s.x, this.player!.s.z);
          this.hostileUntil = now + 10;
          this.audio.hit();
          pr.life = 0;
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => {
      if (pr.life > 0) return true;
      pr.mesh.removeFromParent();
      pr.mesh.geometry.dispose();
      return false;
    });
  }

  private wearHeld(): void {
    const i = this.heldSlotIndex();
    if (i === null) return;
    const s = this.inventory.data.slots[i];
    if (!s || s.dur === undefined) return;
    if (this.inventory.wear(i, 1)) this.hud.notify(t('notify.toolBroke', { what: t(`item.${s.id}`) }), 'warn');
  }

  private give(items: ItemList): void {
    const overflow: ItemList = {};
    for (const [id, q] of Object.entries(items)) {
      if (q <= 0) continue;
      const left = this.inventory.add(id, q);
      if (q - left > 0) this.hud.notify(t('notify.got', { n: q - left, what: t(`item.${id}`) }));
      if (left > 0) overflow[id] = left;
    }
    this.inventory.autoHotbar();
    this.dropOverflow(overflow);
  }

  private dropOverflow(overflow: ItemList): void {
    const stacks = Object.entries(overflow).filter(([, q]) => q > 0).map(([id, qty]) => ({ id, qty }));
    if (!stacks.length) return;
    this.hud.notify(t('notify.full'), 'warn');
    this.createBag(stacks, 'drop');
  }

  private harvest(n: ResourceNode): void {
    const held = this.heldItem();
    const def = VEG_YIELD[n.kind as keyof typeof VEG_YIELD];
    const now = this.env!.state.time;
    this.attackCooldown = 0.45;
    this.playerView!.attackSwing();
    if (n.kind === 'crate' || n.kind === 'scrap') {
      const loot: ItemList = n.kind === 'crate' ? { metal_scrap: 3, bandage: 2 } : { metal_scrap: 2 };
      if (n.kind === 'crate' && this.rng.chance(0.5)) loot.sulfur = 2;
      this.sectors!.hitNode(n, now, 99);
      this.give(loot);
      return;
    }
    if (!def) return;
    const tool = held ? ITEMS[held.id].gather?.[def.tool] ?? 0 : 0;
    const power = tool > 0 ? tool : def.tool === 'fiber' ? 1 : 0.5;
    const drops: ItemList = {};
    for (const [k, q] of Object.entries(def.drops)) drops[k] = Math.max(1, Math.round(q * (tool > 0 ? 1 : 0.5)));
    // Regional extras make different biomes worth visiting.
    const r = this.rng;
    if (n.kind === 'rock' || n.kind === 'boulder') {
      if (n.biome === 'volcanic') {
        if (r.chance(0.35)) drops.obsidian = 1;
        if (r.chance(0.25)) drops.sulfur = 1;
      } else if (n.biome === 'mountain' && r.chance(0.3)) drops.metal_ore = 1;
      else if (n.biome === 'snow' && r.chance(0.25)) drops.ice = 1;
      if ((n.biome === 'plains' || n.biome === 'beach' || n.biome === 'mountain') && r.chance(0.45)) drops.flint = 1;
    }
    if (n.kind === 'reeds' && n.biome === 'swamp' && r.chance(0.35)) drops.clay = 1;
    if ((n.kind === 'bush' || n.kind === 'fern') && (n.biome === 'jungle' || n.biome === 'swamp') && r.chance(0.35)) drops.herb = 1;
    this.give(drops);
    if (tool > 0) this.wearHeld();
    this.sectors!.hitNode(n, now, power);
    // Gathering makes noise.
    this.hostileUntil = Math.max(this.hostileUntil, 0);
  }

  private butcher(id: string): void {
    const a = this.eco!.get(id);
    if (!a) return;
    const held = this.heldItem();
    const knife = held ? ITEMS[held.id].gather?.meat ?? 0 : 0;
    const kg = this.eco!.harvestCarcass(a, 4 + knife * 4);
    if (kg <= 0) return;
    const sp = SPECIES[a.speciesId];
    const items: ItemList = { raw_meat: Math.max(1, Math.round(kg / 3)) };
    if (this.rng.chance(knife > 0 ? 0.7 : 0.3)) items.hide = 1;
    if (this.rng.chance(0.35)) items.bone = 1;
    if (sp.diet === 'piscivore' && this.rng.chance(0.3)) items.raw_fish = 1;
    this.give(items);
    if (knife > 0) this.wearHeld();
    this.playerView!.attackSwing();
  }

  private fillWaterskin(slot: number): void {
    const s = this.inventory.data.slots[slot];
    if (!s || s.id !== 'waterskin') return;
    this.inventory.data.slots[slot] = { id: 'waterskin_full', qty: 1 };
  }

  useHeld(): void {
    const i = this.heldSlotIndex();
    if (i !== null) this.useSlot(i);
  }

  useSlot(i: number): void {
    const s = this.inventory.data.slots[i];
    if (!s) return;
    const def = ITEMS[s.id];
    const surv = this.survival!;
    if (s.id === 'waterskin_full') {
      surv.drink(50);
      this.inventory.data.slots[i] = { id: 'waterskin', qty: 1 };
      return;
    }
    if (def.food) {
      if (!this.inventory.remove(s.id, 1)) return;
      if (surv.eat(def.food, this.rng.next())) this.hud.notify(t('notify.sick'), 'warn');
      return;
    }
    if (def.heal !== undefined) {
      if (!this.inventory.remove(s.id, 1)) return;
      surv.treat(def.heal, !!def.stopsBleeding);
    }
  }

  dropSlot(i: number): void {
    const s = this.inventory.takeSlot(i);
    if (s) this.createBag([s], 'drop');
  }

  equipSlot(i: number): void {
    this.inventory.equip(i);
  }

  unequip(slot: EquipSlot): void {
    this.inventory.unequip(slot);
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
    if (err === 'materials') this.hud.notify(t('craft.missing'), 'warn');
  }

  cancelCraft(i: number): void {
    this.dropOverflow(this.crafting.cancel(i, this.inventory));
  }

  // ------------------------------------------------------------------ bags, sleeping, storage

  private createBag(items: Stack[], reason: ItemBag['reason']): void {
    const p = this.player!;
    const bag: ItemBag = { id: `b${this.nextBagId++}`, x: p.s.x, y: p.s.y, z: p.s.z, items, createdAt: this.env!.state.time, reason };
    this.bags.push(bag);
  }

  private pickupBag(b: ItemBag): void {
    const remaining: Stack[] = [];
    for (const s of b.items) {
      const left = this.inventory.add(s.id, s.qty, s.dur);
      if (left > 0) remaining.push({ ...s, qty: left });
      else this.hud.notify(t('notify.got', { n: s.qty, what: t(`item.${s.id}`) }));
    }
    b.items = remaining;
    if (!remaining.length) this.bags = this.bags.filter((x) => x !== b);
    else this.hud.notify(t('notify.full'), 'warn');
  }

  private sleepIn(bed: Piece): void {
    this.respawnPoint = { x: bed.x, z: bed.z, pieceId: bed.id };
    this.sleeping = true;
    this.hud.notify(t('notify.sleep'));
  }

  private openStorage(p: Piece): void {
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
      if (free < 0) return this.hud.notify(t('notify.storageFull'), 'warn');
      const s = this.inventory.takeSlot(index);
      if (s) st[free] = s;
    } else {
      const s = st[index];
      if (!s) return;
      const left = this.inventory.add(s.id, s.qty, s.dur);
      st[index] = left > 0 ? { ...s, qty: left } : null;
    }
  }

  private drinkCollector(p: Piece): void {
    const amount = Math.min(p.water ?? 0, 5);
    p.water = (p.water ?? 0) - amount;
    this.survival!.drink(amount * 8);
  }

  private harvestCrop(p: Piece): void {
    p.growth = 0;
    this.give({ berries: 6, herb: this.rng.chance(0.5) ? 2 : 0 });
  }

  // ------------------------------------------------------------------ death

  private die(): void {
    if (this.state !== 'playing') return;
    const p = this.player!;
    this.state = 'dead';
    this.deaths++;
    this.sleeping = false;
    document.exitPointerLock?.();
    const dropItems = DIFFICULTY[this.settings.difficulty].dropItemsOnDeath;
    if (dropItems) {
      const stacks = this.inventory.takeEverything(false);
      if (stacks.length) {
        this.bags.push({ id: `b${this.nextBagId++}`, x: p.s.x, y: p.s.y, z: p.s.z, items: stacks, createdAt: this.env!.state.time, reason: 'death' });
      }
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
    this.hud.notify(t('notify.respawn'));
    if (this.bags.some((b) => b.reason === 'death')) this.hud.notify(t('notify.bagLeft'), 'warn');
    void this.save(true);
  }

  // ------------------------------------------------------------------ building

  toggleBuild(): void {
    this.building = !this.building;
    if (!this.building && this.ghost) {
      this.ghost.removeFromParent();
      this.ghost = null;
      this.ghostType = null;
    }
    this.hud.showBuild(this.building);
  }

  setBuildPiece(p: PieceType): void {
    this.buildPiece = p;
  }

  private updateBuild(): void {
    const p = this.player!;
    const input = this.input;
    if (input.consume('rotateLeft')) this.buildRot -= this.buildSnap ? Math.PI / 2 : Math.PI / 12;
    if (input.consume('rotateRight')) this.buildRot += this.buildSnap ? Math.PI / 2 : Math.PI / 12;
    if (input.consume('snapToggle')) this.buildSnap = !this.buildSnap;
    if (this.ghostType !== this.buildPiece) {
      this.ghost?.removeFromParent();
      this.ghost = createGhost(this.buildPiece);
      this.ghostType = this.buildPiece;
      this.worldRoot.add(this.ghost);
    }
    const dist = this.buildPiece === 'foundation' || this.buildPiece === 'platform' || this.buildPiece === 'floor' || this.buildPiece === 'roof' ? 5 : 3.5;
    const [fx, fz] = p.forward();
    const ax = p.s.x + fx * dist;
    const az = p.s.z + fz * dist;
    const pl = this.buildingSys!.preview(this.buildPiece, ax, az, this.buildRot + p.s.yaw, this.buildSnap, {
      height: (x, z) => this.terrain!.height(x, z),
      waterLevel: this.env!.waterLevel,
      collision: this.collision,
    }, p.s.x, p.s.z);
    const enough = this.inventory.has(PIECES[this.buildPiece].cost);
    if (pl.valid && !enough) {
      pl.valid = false;
      pl.reason = 'materials';
    }
    // Don't trap the player inside a solid piece.
    if (pl.valid && PIECES[pl.type].solid && !['foundation', 'floor', 'platform', 'roof'].includes(pl.type)) {
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
    this.hud.showBuild(true, pl.valid ? null : pl.reason ?? null);

    if (input.consume('attack') && this.attackCooldown <= 0) {
      this.attackCooldown = 0.25;
      if (pl.valid) {
        const piece = this.buildingSys!.place(pl, this.inventory);
        if (piece) {
          this.addPieceView(piece);
          this.audio.hit();
        }
      } else if (pl.reason) this.hud.notify(t(`build.invalid.${pl.reason}`), 'warn');
    }
    if (input.consume('demolish')) {
      const target = this.buildingSys!.nearest(p.s.x + fx * 2.5, p.s.z + fz * 2.5, 3);
      if (target) {
        if (this.storageOpen?.id === target.id) this.storageOpen = null;
        const res = this.buildingSys!.demolish(target.id, this.inventory);
        this.pieceViews.get(target.id)?.removeFromParent();
        this.pieceViews.delete(target.id);
        if (res?.overflow.length) this.createBag(res.overflow, 'drop');
        if (this.respawnPoint?.pieceId === target.id) this.respawnPoint = null;
        this.hud.notify(t('build.demolished'));
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
      if (!v) {
        v = createAnimalView(a.speciesId);
        this.animalViews.set(a.id, v);
        this.worldRoot.add(v.root);
      }
      poseAnimalView(v, a, eco.brain.stridePhase(a), eco.brain.altitude(a), now, dt, Math.hypot(a.x - cam.x, a.z - cam.z));
      // Vocalizations on meaningful state changes, plus occasional idle calls.
      const prev = this.lastStates.get(a.id);
      if (a.alive && prev !== a.state) {
        const sp = SPECIES[a.speciesId];
        if (a.state === 'flee' || a.state === 'defend' || (a.state === 'alert' && this.rng.chance(0.3))) this.audio.call(sp, a.x, a.y + sp.hipHeightM, a.z, growthScale(a, now), a.state === 'alert' ? 0 : 1);
        this.lastStates.set(a.id, a.state);
      } else if (a.alive && this.rng.chance(dt * 0.012)) {
        const sp = SPECIES[a.speciesId];
        this.audio.call(sp, a.x, a.y + sp.hipHeightM, a.z, growthScale(a, now));
      }
    }
    for (const [id, v] of this.animalViews) {
      if (!activeIds.has(id)) {
        v.root.removeFromParent();
        this.animalViews.delete(id);
        this.lastStates.delete(id);
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
        this.worldRoot.add(o);
        this.nestViews.set(n.id, o);
      }
    }
    for (const [id, o] of this.nestViews) {
      if (!near.has(id)) {
        o.removeFromParent();
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
        this.bagViews.delete(id);
      }
    }
    // Pieces with dynamic state.
    for (const [id, o] of this.pieceViews) {
      const pc = this.buildingSys!.pieces.get(id);
      if (pc && (pc.type === 'door' || pc.type === 'crop_plot' || pc.type === 'water_collector' || pc.type === 'campfire')) syncPieceObject(o, pc, this.time);
    }
  }

  mapMarkers(): ReturnType<GameApi['mapMarkers']> {
    const out: ReturnType<GameApi['mapMarkers']> = [];
    const p = this.player;
    if (!p) return out;
    for (const s of PLANNED_SITES) if (this.discovered.has(s.id)) out.push({ x: s.x, z: s.z, kind: 'site', label: t(`site.${s.id}`) });
    for (const b of this.bags) if (b.reason === 'death') out.push({ x: b.x, z: b.z, kind: 'bag' });
    if (this.respawnPoint) out.push({ x: this.respawnPoint.x, z: this.respawnPoint.z, kind: 'bed' });
    out.push({ x: p.s.x, z: p.s.z, kind: 'player', heading: p.s.yaw });
    return out;
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
