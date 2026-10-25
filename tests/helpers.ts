import { createEcosystemState, Ecosystem, type EcoContext } from '../src/animals/ecosystem';
import { Environment, createEnvState } from '../src/world/environment';
import { Terrain } from '../src/world/terrain';
import type { PlayerPercept } from '../src/ai/brain';

export function makeWorld(seed = 42) {
  const terrain = new Terrain(seed);
  const env = new Environment(createEnvState(seed), terrain);
  const eco = new Ecosystem(createEcosystemState(seed), terrain, env, seed);
  return { terrain, env, eco };
}

export function player(x: number, z: number, extra: Partial<PlayerPercept> = {}): PlayerPercept {
  return { x, z, alive: true, noiseRadius: 14, hostileUntil: 0, visibility: 1, running: false, hasFire: false, ...extra };
}

export function ctx(p: PlayerPercept, extra: Partial<EcoContext> = {}): EcoContext {
  return { player: p, predatorBoldness: 1, maxActive: 64, blocked: () => false, damagePlayer: () => {}, ...extra };
}

/** Finds dry, gentle plains ground near a point. */
export function dryPlains(terrain: Terrain, x = 300, z = 700) {
  return terrain.findDryGround(x, z);
}
