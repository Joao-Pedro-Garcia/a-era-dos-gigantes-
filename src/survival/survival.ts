import { WORLD, type DifficultyProfile } from '../core/config';
import { clamp } from '../core/math';

/**
 * Player physiology. All values 0–100 except body temperature (°C).
 * Each stat has a clear, readable effect on play and recovers through
 * eating, drinking, resting, warming up or treating wounds.
 */
export interface SurvivalData {
  health: number;
  food: number;
  water: number;
  /** Long-term energy (fatigue). */
  energy: number;
  /** Short-term sprint stamina. */
  stamina: number;
  bodyTemp: number;
  bleeding: number;
  fracture: number;
  sickness: number;
}

export function createSurvival(): SurvivalData {
  return { health: 100, food: 85, water: 85, energy: 90, stamina: 100, bodyTemp: 37, bleeding: 0, fracture: 0, sickness: 0 };
}

export interface SurvivalContext {
  airTemp: number;
  insulation: number;
  /** 0 idle, 1 walking, 2 running, 3 heavy work. */
  exertion: number;
  sprinting: boolean;
  inWater: boolean;
  nearFire: boolean;
  sheltered: boolean;
  resting: boolean;
  overweight: number;
}

const DAY = WORLD.dayLengthSeconds;

export class Survival {
  constructor(public d: SurvivalData, public difficulty: DifficultyProfile) {}

  get alive(): boolean {
    return this.d.health > 0;
  }

  /** Effective "felt" temperature after clothing, fire and shelter. */
  feltTemp(c: SurvivalContext): number {
    return c.airTemp + c.insulation + (c.nearFire ? 18 : 0) + (c.sheltered ? 6 : 0) - (c.inWater ? 10 : 0);
  }

  update(dt: number, c: SurvivalContext): void {
    const d = this.d;
    const rate = this.difficulty.needsRate;
    const heat = Math.max(0, d.bodyTemp - 37.5);
    d.food = clamp(d.food - (dt * 100 * rate * (1 + c.exertion * 0.25 + d.sickness * 0.5)) / (DAY * 1.4), 0, 100);
    d.water = clamp(d.water - (dt * 100 * rate * (1 + c.exertion * 0.35 + heat * 0.8)) / (DAY * 0.95), 0, 100);
    if (c.resting) d.energy = clamp(d.energy + (dt * 100) / (DAY * 0.25), 0, 100);
    else d.energy = clamp(d.energy - (dt * 100 * rate * (1 + c.exertion * 0.4 + c.overweight)) / (DAY * 1.6), 0, 100);

    const maxStamina = 40 + d.energy * 0.6;
    if (c.sprinting) d.stamina = clamp(d.stamina - dt * (14 + c.overweight * 10), 0, maxStamina);
    else d.stamina = clamp(d.stamina + dt * (c.exertion > 0 ? 9 : 16), 0, maxStamina);

    // Body temperature drifts toward a target set by the felt temperature.
    const felt = this.feltTemp(c);
    let target = 37;
    if (felt < 14) target = 37 - (14 - felt) * 0.12;
    else if (felt > 32) target = 37 + (felt - 32) * 0.1;
    if (c.exertion >= 2) target += 0.4;
    d.bodyTemp += (target - d.bodyTemp) * Math.min(1, dt * 0.01);

    // Damage over time.
    let dmg = 0;
    if (d.food <= 0) dmg += 0.25;
    if (d.water <= 0) dmg += 0.4;
    if (d.bodyTemp < 35) dmg += (35 - d.bodyTemp) * 0.35;
    if (d.bodyTemp > 39.5) dmg += (d.bodyTemp - 39.5) * 0.35;
    dmg += d.bleeding * 0.8 + d.sickness * 0.08;
    d.health = clamp(d.health - dmg * dt * this.difficulty.damageTaken, 0, 100);

    // Wounds evolve.
    d.bleeding = clamp(d.bleeding - dt * 0.004, 0, 1);
    d.fracture = clamp(d.fracture - dt / (DAY * (c.resting ? 0.8 : 2.5)), 0, 1);
    d.sickness = clamp(d.sickness - dt / (DAY * 1.2), 0, 1);

    // Natural recovery when fed, hydrated, warm and not bleeding.
    if (d.health > 0 && dmg === 0 && d.food > 40 && d.water > 40) {
      const regen = (c.resting ? 3 : 0.5) * (d.energy > 20 ? 1 : 0.5);
      d.health = clamp(d.health + regen * dt * 0.05, 0, 100);
    }
  }

  /** Movement speed multiplier from wounds and exhaustion. */
  speedMultiplier(): number {
    const d = this.d;
    return (1 - d.fracture * 0.45) * (d.energy < 15 ? 0.8 : 1) * (d.health < 25 ? 0.85 : 1);
  }

  canSprint(): boolean {
    return this.d.stamina > 5 && this.d.fracture < 0.5;
  }

  damage(amount: number, armor: number, kind: 'bite' | 'impact' | 'fall' | 'burn' | 'other'): number {
    const d = this.d;
    const taken = amount * this.difficulty.damageTaken * (1 - clamp(armor, 0, 0.6));
    d.health = clamp(d.health - taken, 0, 100);
    if (kind === 'bite' && taken > 8) d.bleeding = clamp(d.bleeding + taken / 60, 0, 1);
    if ((kind === 'impact' || kind === 'fall') && taken > 25) d.fracture = clamp(d.fracture + taken / 50, 0, 1);
    return taken;
  }

  eat(food: { hunger: number; thirst?: number; health?: number; sickChance?: number }, roll: number): boolean {
    const d = this.d;
    d.food = clamp(d.food + food.hunger * 100, 0, 100);
    if (food.thirst) d.water = clamp(d.water + food.thirst * 100, 0, 100);
    if (food.health) d.health = clamp(d.health + food.health, 0, 100);
    if (food.sickChance && roll < food.sickChance) {
      d.sickness = clamp(d.sickness + 0.4, 0, 1);
      return true;
    }
    return false;
  }

  drink(amount: number): void {
    this.d.water = clamp(this.d.water + amount, 0, 100);
  }

  treat(heal: number, stopsBleeding: boolean): void {
    this.d.health = clamp(this.d.health + heal, 0, 100);
    if (stopsBleeding) this.d.bleeding = 0;
  }
}
