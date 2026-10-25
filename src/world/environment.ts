import { WORLD } from '../core/config';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { BiomeId } from './biomes';
import { VOLCANO, type Terrain } from './terrain';

/**
 * Time, climate and dynamic events. Pure simulation (no rendering) so it can be
 * saved, restored and unit tested. Events arise from conditions: lightning
 * needs storms, wildfires need lightning plus dry vegetation, floods need
 * prolonged rain, and so on.
 */
export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';

export interface Fire {
  id: number;
  x: number;
  z: number;
  r: number;
  maxR: number;
  intensity: number;
}

export interface DiseaseOutbreak {
  speciesId: string;
  x: number;
  z: number;
  r: number;
  until: number;
}

export interface EnvState {
  time: number;
  weather: WeatherKind;
  weatherUntil: number;
  /** Smoothed 0..1 precipitation/cloud intensity for rendering. */
  intensity: number;
  windDir: number;
  windSpeed: number;
  drought: number;
  wetness: number;
  fires: Fire[];
  nextFireId: number;
  eruptionUntil: number;
  nextEruptionAt: number;
  disease: DiseaseOutbreak | null;
  nextDiseaseAt: number;
  rng: number;
}

export interface Lightning {
  x: number;
  z: number;
  at: number;
}

export type EnvEvent =
  | { type: 'weather'; weather: WeatherKind }
  | { type: 'fireStarted'; x: number; z: number }
  | { type: 'eruption'; active: boolean }
  | { type: 'flood'; active: boolean }
  | { type: 'drought'; active: boolean }
  | { type: 'disease'; speciesId: string };

const DAY = WORLD.dayLengthSeconds;

export function createEnvState(seed: number): EnvState {
  return {
    time: DAY * 0.3, // start in the morning
    weather: 'clear',
    weatherUntil: DAY * 0.4,
    intensity: 0,
    windDir: 0.6,
    windSpeed: 3,
    drought: 0.1,
    wetness: 0.4,
    fires: [],
    nextFireId: 1,
    eruptionUntil: 0,
    nextEruptionAt: DAY * 4,
    disease: null,
    nextDiseaseAt: DAY * 6,
    rng: seed ^ 0xabcdef,
  };
}

export class Environment {
  readonly rng: Rng;
  lightning: Lightning | null = null;
  private floodActive = false;
  private droughtActive = false;

  constructor(public state: EnvState, private terrain: Terrain) {
    this.rng = new Rng(state.rng);
    this.floodActive = state.wetness > 0.85;
    this.droughtActive = state.drought > 0.7;
  }

  get day(): number {
    return Math.floor(this.state.time / DAY);
  }
  /** 0 = midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  get dayFraction(): number {
    return (this.state.time / DAY) % 1;
  }
  get dayOfYear(): number {
    return this.day % WORLD.daysPerYear;
  }
  /** -1 (cold season) … 1 (warm season). */
  get season(): number {
    return Math.sin((this.dayOfYear / WORLD.daysPerYear) * Math.PI * 2);
  }
  get sunElevation(): number {
    return Math.sin((this.dayFraction - 0.25) * Math.PI * 2);
  }
  get daylight(): number {
    return clamp(this.sunElevation * 3 + 0.25, 0, 1);
  }
  get isNight(): boolean {
    return this.sunElevation < -0.08;
  }
  get eruptionActive(): boolean {
    return this.state.time < this.state.eruptionUntil;
  }
  get flooding(): boolean {
    return this.floodActive;
  }
  get inDrought(): boolean {
    return this.droughtActive;
  }
  /** Global water surface (sea level, raised during floods). */
  get waterLevel(): number {
    return WORLD.seaLevel + (this.floodActive ? (this.state.wetness - 0.85) * 10 : 0);
  }
  get fogDensity(): number {
    const s = this.state;
    let f = 0;
    if (s.weather === 'fog') f = 0.7;
    else if (s.weather === 'rain') f = 0.3;
    else if (s.weather === 'storm') f = 0.5;
    return f * s.intensity + (this.eruptionActive ? 0.25 : 0);
  }

  /** Air temperature (°C) at a location for the current time and weather. */
  temperatureAt(baseTemp: number, biome: BiomeId): number {
    const diurnal = -Math.cos(this.dayFraction * Math.PI * 2 - 0.5) * (biome === 'jungle' || biome === 'swamp' ? 3 : 6);
    const seasonal = this.season * 5;
    const s = this.state;
    const weather = s.weather === 'storm' ? -5 : s.weather === 'rain' ? -3 : s.weather === 'cloudy' ? -1 : 0;
    return baseTemp + diurnal + seasonal + weather * s.intensity - s.windSpeed * 0.15;
  }

  /** Forage regrowth multiplier from climate. */
  get growthFactor(): number {
    const s = this.state;
    const rain = s.weather === 'rain' || s.weather === 'storm' ? 1.6 : 1;
    return rain * (1 - this.state.drought * 0.75) * (0.75 + this.season * 0.25);
  }

  /** Most likely next weather (same transition table as `update`, without using the RNG). */
  forecast(): { next: WeatherKind; inSeconds: number } {
    const s = this.state;
    const wet = 0.5 + this.season * 0.15 - s.drought * 0.25;
    const probs: Partial<Record<WeatherKind, number>> = {};
    if (s.weather === 'storm') {
      probs.rain = 0.6;
      probs.cloudy = 0.4;
    } else {
      const clear = 0.36 * (1 - wet * 0.4);
      probs.clear = clear;
      probs.cloudy = 0.58 - clear;
      probs.rain = 0.24 * wet;
      const stormish = 0.08;
      if (s.weather === 'rain' || s.weather === 'cloudy') probs.storm = stormish;
      else probs.rain = (probs.rain ?? 0) + stormish;
      probs.fog = 1 - Object.values(probs).reduce((a, b) => a + (b ?? 0), 0);
    }
    let next: WeatherKind = 'clear';
    let best = -1;
    for (const [k, v] of Object.entries(probs)) if ((v ?? 0) > best) {
      best = v ?? 0;
      next = k as WeatherKind;
    }
    return { next, inSeconds: Math.max(0, s.weatherUntil - s.time) };
  }

  update(dt: number, px: number, pz: number, events: EnvEvent[]): void {
    const s = this.state;
    s.time += dt;
    const rng = this.rng;

    // Weather Markov chain, biased by season and drought.
    if (s.time >= s.weatherUntil) {
      const wet = 0.5 + this.season * 0.15 - s.drought * 0.25;
      const roll = rng.next();
      let next: WeatherKind;
      if (s.weather === 'storm') next = roll < 0.6 ? 'rain' : 'cloudy';
      else if (roll < 0.36 * (1 - wet * 0.4)) next = 'clear';
      else if (roll < 0.58) next = 'cloudy';
      else if (roll < 0.58 + 0.24 * wet) next = 'rain';
      else if (roll < 0.66 + 0.24 * wet) next = s.weather === 'rain' || s.weather === 'cloudy' ? 'storm' : 'rain';
      else next = this.dayFraction < 0.35 || this.dayFraction > 0.8 ? 'fog' : 'clear';
      if (next !== s.weather) events.push({ type: 'weather', weather: next });
      s.weather = next;
      s.weatherUntil = s.time + DAY * rng.range(0.12, 0.45);
      s.windDir += rng.gauss(0, 0.6);
      s.windSpeed = next === 'storm' ? rng.range(10, 18) : rng.range(1, 7);
    }
    const target = s.weather === 'clear' ? 0 : s.weather === 'cloudy' ? 0.35 : s.weather === 'fog' ? 0.8 : s.weather === 'rain' ? 0.75 : 1;
    s.intensity += (target - s.intensity) * Math.min(1, dt * 0.02);

    // Soil moisture, drought and floods.
    const raining = s.weather === 'rain' || s.weather === 'storm';
    s.wetness = clamp(s.wetness + dt * (raining ? 0.00045 * (s.weather === 'storm' ? 2 : 1) : -0.00012), 0, 1);
    s.drought = clamp(s.drought + dt * (raining ? -0.0006 : s.weather === 'clear' ? 0.00008 * (1 + Math.max(0, this.season)) : 0.00002), 0, 1);
    const flood = s.wetness > 0.85;
    if (flood !== this.floodActive) {
      this.floodActive = flood;
      events.push({ type: 'flood', active: flood });
    }
    const drought = s.drought > 0.7;
    if (drought !== this.droughtActive) {
      this.droughtActive = drought;
      events.push({ type: 'drought', active: drought });
    }

    // Lightning during storms; may ignite dry vegetation.
    this.lightning = null;
    if (s.weather === 'storm' && s.intensity > 0.6 && rng.next() < dt * 0.12) {
      const ang = rng.range(0, Math.PI * 2);
      const d = rng.range(80, 700);
      const x = px + Math.cos(ang) * d;
      const z = pz + Math.sin(ang) * d;
      this.lightning = { x, z, at: s.time };
      const biome = this.terrain.biomeAt(x, z);
      const flammable = biome === 'plains' || biome === 'jungle' || biome === 'mountain';
      if (flammable && rng.next() < 0.08 + s.drought * 0.5) this.startFire(x, z, events);
    }
    // Rare dry-season spontaneous fires from lava/volcanic areas.
    if (this.eruptionActive && rng.next() < dt * 0.01) {
      const ang = rng.range(0, Math.PI * 2);
      this.startFire(VOLCANO.x + Math.cos(ang) * 900, VOLCANO.z + Math.sin(ang) * 900, events);
    }

    // Fire spread and extinction.
    for (const f of s.fires) {
      const fuel = 1 - (raining ? 0.8 * s.intensity : 0);
      f.r = Math.min(f.maxR, f.r + dt * 0.25 * fuel * (1 + s.windSpeed * 0.05));
      f.x += Math.cos(s.windDir) * dt * 0.05 * s.windSpeed;
      f.z += Math.sin(s.windDir) * dt * 0.05 * s.windSpeed;
      f.intensity -= dt * (raining ? 0.01 * (1 + s.intensity * 3) : 0.0012);
    }
    s.fires = s.fires.filter((f) => f.intensity > 0);

    // Volcano.
    if (s.time >= s.nextEruptionAt) {
      s.eruptionUntil = s.time + DAY * rng.range(0.15, 0.35);
      s.nextEruptionAt = s.time + DAY * rng.range(5, 12);
      events.push({ type: 'eruption', active: true });
    }

    // Disease outbreaks are rare and local.
    if (s.disease && s.time > s.disease.until) s.disease = null;
    if (!s.disease && s.time >= s.nextDiseaseAt) {
      s.nextDiseaseAt = s.time + DAY * rng.range(8, 16);
      // The ecosystem picks the species; we only record the area.
      s.disease = { speciesId: '', x: px + rng.range(-800, 800), z: pz + rng.range(-800, 800), r: 350, until: s.time + DAY * 2 };
    }

    s.rng = rng.getState();
  }

  startFire(x: number, z: number, events: EnvEvent[]): void {
    const s = this.state;
    if (s.fires.length >= 6) return;
    const h = this.terrain.height(x, z);
    if (h < 0.5) return;
    const biome = this.terrain.biomeAt(x, z, h);
    if (biome === 'snow' || biome === 'swamp' || biome === 'beach' || biome === 'ocean') return;
    s.fires.push({ id: s.nextFireId++, x, z, r: 6, maxR: this.rng.range(60, 180), intensity: 1 });
    events.push({ type: 'fireStarted', x, z });
  }
}
