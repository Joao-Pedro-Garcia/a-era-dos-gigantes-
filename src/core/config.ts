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

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualityProfile {
  pixelRatioCap: number;
  /** Sectors loaded around the player (Chebyshev radius). */
  loadRadius: number;
  /** Sectors with vegetation/props. */
  detailRadius: number;
  vegetationDensity: number;
  shadows: boolean;
  shadowMapSize: number;
  maxActiveAnimals: number;
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: { pixelRatioCap: 1, loadRadius: 3, detailRadius: 1, vegetationDensity: 0.45, shadows: false, shadowMapSize: 512, maxActiveAnimals: 18 },
  medium: { pixelRatioCap: 1.5, loadRadius: 4, detailRadius: 2, vegetationDensity: 0.75, shadows: true, shadowMapSize: 1024, maxActiveAnimals: 32 },
  high: { pixelRatioCap: 2, loadRadius: 5, detailRadius: 2, vegetationDensity: 1, shadows: true, shadowMapSize: 2048, maxActiveAnimals: 48 },
};

export interface Settings {
  language: 'pt-BR' | 'en';
  difficulty: Difficulty;
  quality: QualityLevel | 'auto';
  mouseSensitivity: number;
  touchSensitivity: number;
  invertY: boolean;
  firstPerson: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: 'pt-BR',
  difficulty: 'normal',
  quality: 'auto',
  mouseSensitivity: 1,
  touchSensitivity: 1,
  invertY: false,
  firstPerson: false,
};

const SETTINGS_KEY = 'edg.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable: defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
