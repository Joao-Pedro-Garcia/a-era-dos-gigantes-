/** Global tunables. Gameplay constants live here so they can be balanced in one place. */
export const WORLD = {
  /** Size of a streaming sector in metres. */
  sectorSize: 128,
  /** Continent radius in metres (coastline is warped around this). */
  continentRadius: 4200,
  /** Hard world bound (ocean beyond); |x|,|z| clamp. */
  worldHalfSize: 5200,
  seaLevel: 0,
  /** Real seconds per in-game day at 1x time scale. */
  dayLengthSeconds: 1200,
  daysPerYear: 40,
};

export type Difficulty = 'peaceful' | 'normal' | 'hard';

export interface DifficultyProfile {
  needsRate: number;
  damageTaken: number;
  predatorBoldness: number;
  dropItemsOnDeath: boolean;
}

export const DIFFICULTY: Record<Difficulty, DifficultyProfile> = {
  peaceful: { needsRate: 0.5, damageTaken: 0.4, predatorBoldness: 0.3, dropItemsOnDeath: false },
  normal: { needsRate: 1, damageTaken: 1, predatorBoldness: 1, dropItemsOnDeath: true },
  hard: { needsRate: 1.5, damageTaken: 1.5, predatorBoldness: 1.4, dropItemsOnDeath: true },
};

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  pixelRatioCap: number;
  /** Render resolution multiplier on top of the device pixel ratio (0.5–1). */
  resolutionScale: number;
  /** Sectors loaded around the player (Chebyshev radius). */
  loadRadius: number;
  /** Sectors with vegetation/props. */
  detailRadius: number;
  vegetationDensity: number;
  shadows: boolean;
  shadowMapSize: number;
  maxActiveAnimals: number;
  /** Terrain detail texture resolution. */
  textures: 'low' | 'high';
  /** Particle amount multiplier (rain, fire, smoke). */
  particles: number;
  /** Extra effects: dynamic point lights, soft shadows, volcano smoke. */
  effects: boolean;
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: { pixelRatioCap: 1, resolutionScale: 0.75, loadRadius: 3, detailRadius: 1, vegetationDensity: 0.45, shadows: false, shadowMapSize: 512, maxActiveAnimals: 16, textures: 'low', particles: 0.35, effects: false },
  medium: { pixelRatioCap: 1.5, resolutionScale: 1, loadRadius: 4, detailRadius: 2, vegetationDensity: 0.75, shadows: true, shadowMapSize: 1024, maxActiveAnimals: 32, textures: 'low', particles: 0.7, effects: true },
  high: { pixelRatioCap: 2, resolutionScale: 1, loadRadius: 5, detailRadius: 2, vegetationDensity: 1, shadows: true, shadowMapSize: 2048, maxActiveAnimals: 48, textures: 'high', particles: 1, effects: true },
  ultra: { pixelRatioCap: 2.5, resolutionScale: 1, loadRadius: 6, detailRadius: 3, vegetationDensity: 1.25, shadows: true, shadowMapSize: 4096, maxActiveAnimals: 64, textures: 'high', particles: 1, effects: true },
};

/** Per-setting overrides chosen by the player (undefined = follow the preset). */
export interface GraphicsOverrides {
  resolutionScale?: number;
  shadows?: boolean;
  viewDistance?: number;
  vegetationDensity?: number;
  textures?: 'low' | 'high';
  particles?: number;
  effects?: boolean;
}

export function effectiveQuality(level: QualityLevel, o: GraphicsOverrides): QualityProfile {
  const q = { ...QUALITY[level] };
  if (o.resolutionScale !== undefined) q.resolutionScale = Math.min(1, Math.max(0.4, o.resolutionScale));
  if (o.shadows !== undefined) q.shadows = o.shadows;
  if (o.viewDistance !== undefined) {
    q.loadRadius = Math.min(7, Math.max(2, Math.round(o.viewDistance)));
    q.detailRadius = Math.min(q.detailRadius, q.loadRadius);
  }
  if (o.vegetationDensity !== undefined) q.vegetationDensity = Math.min(1.5, Math.max(0.1, o.vegetationDensity));
  if (o.textures !== undefined) q.textures = o.textures;
  if (o.particles !== undefined) q.particles = Math.min(1, Math.max(0, o.particles));
  if (o.effects !== undefined) q.effects = o.effects;
  return q;
}

export interface Settings {
  language: 'pt-BR' | 'en';
  difficulty: Difficulty;
  quality: QualityLevel | 'auto';
  graphics: GraphicsOverrides;
  mouseSensitivity: number;
  touchSensitivity: number;
  invertY: boolean;
  firstPerson: boolean;
  volume: { master: number; sfx: number; ambience: number; music: number };
  /** Accessibility. */
  uiScale: number;
  highContrast: boolean;
  reduceMotion: boolean;
  captions: boolean;
  toggleSprint: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'pt-BR',
  difficulty: 'normal',
  quality: 'auto',
  graphics: {},
  mouseSensitivity: 1,
  touchSensitivity: 1,
  invertY: false,
  firstPerson: false,
  volume: { master: 0.8, sfx: 1, ambience: 0.8, music: 0.45 },
  uiScale: 1,
  highContrast: false,
  reduceMotion: false,
  captions: false,
  toggleSprint: false,
};

/** Validates settings read from storage (unknown keys dropped, ranges clamped). */
export function sanitizeSettings(raw: unknown): Settings {
  const s: Settings = structuredClone(DEFAULT_SETTINGS);
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d);
  if (r.language === 'pt-BR' || r.language === 'en') s.language = r.language;
  if (r.difficulty === 'peaceful' || r.difficulty === 'normal' || r.difficulty === 'hard') s.difficulty = r.difficulty;
  if (['auto', 'low', 'medium', 'high', 'ultra'].includes(r.quality as string)) s.quality = r.quality as Settings['quality'];
  if (r.graphics && typeof r.graphics === 'object') {
    const g = r.graphics as Record<string, unknown>;
    if (typeof g.resolutionScale === 'number') s.graphics.resolutionScale = num(g.resolutionScale, 0.4, 1, 1);
    if (typeof g.shadows === 'boolean') s.graphics.shadows = g.shadows;
    if (typeof g.viewDistance === 'number') s.graphics.viewDistance = num(g.viewDistance, 2, 7, 4);
    if (typeof g.vegetationDensity === 'number') s.graphics.vegetationDensity = num(g.vegetationDensity, 0.1, 1.5, 1);
    if (g.textures === 'low' || g.textures === 'high') s.graphics.textures = g.textures;
    if (typeof g.particles === 'number') s.graphics.particles = num(g.particles, 0, 1, 1);
    if (typeof g.effects === 'boolean') s.graphics.effects = g.effects;
  }
  s.mouseSensitivity = num(r.mouseSensitivity, 0.1, 5, 1);
  s.touchSensitivity = num(r.touchSensitivity, 0.1, 5, 1);
  s.invertY = r.invertY === true;
  s.firstPerson = r.firstPerson === true;
  const v = (r.volume ?? {}) as Record<string, unknown>;
  s.volume = { master: num(v.master, 0, 1, 0.8), sfx: num(v.sfx, 0, 1, 1), ambience: num(v.ambience, 0, 1, 0.8), music: num(v.music, 0, 1, 0.45) };
  s.uiScale = num(r.uiScale, 0.8, 1.5, 1);
  s.highContrast = r.highContrast === true;
  s.reduceMotion = r.reduceMotion === true;
  s.captions = r.captions === true;
  s.toggleSprint = r.toggleSprint === true;
  return s;
}

const SETTINGS_KEY = 'edg.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupted: defaults */
  }
  return structuredClone(DEFAULT_SETTINGS);
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
