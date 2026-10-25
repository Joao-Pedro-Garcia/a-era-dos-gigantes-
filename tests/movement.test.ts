import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlayerController, type MoveEnv, type MoveInput } from '../src/player/player';
import { CameraRig } from '../src/player/cameraRig';
import { CollisionWorld } from '../src/world/collision';
import type { Terrain } from '../src/world/terrain';
import { chooseClip } from '../src/graphics/externalModels';
import { createAnimal } from '../src/animals/animal';
import { SPECIES } from '../src/animals/species';
import { Rng } from '../src/core/rng';
import { ctx, dryPlains, makeWorld, player } from './helpers';

const DT = 1 / 60;
const flatTerrain = { height: () => 0 } as unknown as Terrain;
const envAt = (floor = 0): MoveEnv => ({
  terrain: flatTerrain, collision: new CollisionWorld(), waterLevel: -50, speedMul: 1, canSprint: true, biomeMul: 1, dynamic: [], groundOverride: floor,
});
const go = (extra: Partial<MoveInput> = {}): MoveInput => ({ x: 0, y: 1, sprint: false, crouch: false, jump: false, ...extra });

describe('player movement feels continuous', () => {
  it('speeds up and slows down over a fraction of a second, not instantly', () => {
    const p = new PlayerController({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
    const env = envAt();
    p.update(DT, go(), env, false);
    expect(p.horizontalSpeed).toBeLessThan(1);
    for (let i = 0; i < 60; i++) p.update(DT, go(), env, false);
    expect(p.horizontalSpeed).toBeGreaterThan(3.2);
    for (let i = 0; i < 3; i++) p.update(DT, go({ y: 0 }), env, false);
    expect(p.horizontalSpeed).toBeGreaterThan(1);
    for (let i = 0; i < 60; i++) p.update(DT, go({ y: 0 }), env, false);
    expect(p.horizontalSpeed).toBeLessThan(0.05);
  });

  it('the stride length changes gradually from walking to sprinting', () => {
    const p = new PlayerController({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
    const env = envAt();
    for (let i = 0; i < 60; i++) p.update(DT, go(), env, false);
    let last = p.stepLength();
    let maxJump = 0;
    let frames = 0;
    for (let i = 0; i < 90; i++) {
      p.update(DT, go({ sprint: true }), env, false);
      const d = Math.abs(p.stepLength() - last);
      maxJump = Math.max(maxJump, d);
      if (d > 0.001) frames++;
      last = p.stepLength();
    }
    expect(last).toBeCloseTo(1.6, 1);
    expect(maxJump).toBeLessThan(0.08); // never the whole 0.5 m change at once
    expect(frames).toBeGreaterThan(10); // spread over many frames
  });

  it('small steps are eased for the body and camera; large drops snap', () => {
    const p = new PlayerController({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
    p.update(DT, go({ y: 0 }), envAt(0), false);
    p.update(DT, go({ y: 0 }), envAt(0.3), false); // stepped onto a foundation
    expect(p.s.y).toBeCloseTo(0.3, 6);
    expect(p.visualY).toBeLessThan(0.3);
    expect(p.visualY).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) p.update(DT, go({ y: 0 }), envAt(0.3), false);
    expect(p.visualY).toBeCloseTo(0.3, 2);
    p.s.y = 20; // teleport (respawn, cave)
    p.update(DT, go({ y: 0 }), { ...envAt(20) }, false);
    expect(p.visualY).toBeCloseTo(20, 6);
  });

  it('the third-person camera keeps a constant distance while running (no lag or swing)', () => {
    const cam = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 1000);
    const rig = new CameraRig(cam);
    const p = new PlayerController({ x: 0, y: 0, z: 0, yaw: 0, pitch: -0.2 });
    const env = envAt();
    const col = new CollisionWorld();
    const dists: number[] = [];
    for (let i = 0; i < 120; i++) {
      p.update(DT, go({ sprint: i > 30 }), env, false);
      rig.update(DT, p, false, () => -10, col);
      dists.push(cam.position.distanceTo(new THREE.Vector3(p.s.x, p.visualY + 1.65, p.s.z)));
    }
    expect(Math.max(...dists) - Math.min(...dists)).toBeLessThan(0.01);
  });
});

describe('dinosaur movement feels continuous', () => {
  it('turns start and end smoothly and never exceed the species turn rate', () => {
    const { terrain, env, eco } = makeWorld(4);
    const s = dryPlains(terrain);
    const now = env.state.time;
    const sp = SPECIES.triceratops;
    const a = createAnimal({ id: 'turner', speciesId: 'triceratops', x: s.x, z: s.z, bornAt: now - sp.reproduction.maturityDays * 1200 * 2, groupId: 'g', rng: new Rng(2) });
    a.hunger = a.thirst = a.fatigue = 0.05;
    a.heading = 0;
    eco.animals.set(a.id, a);
    // Close enough to be simulated every frame (far animals update less often).
    const p = player(s.x + 60, s.z, { visibility: 0, noiseRadius: 0 });
    eco.update(DT, ctx(p));
    // Ask for a walk to a point behind it (a 180° turn).
    a.tx = a.x;
    a.tz = a.z - 40;
    a.state = 'wander';
    a.stateTime = 0;
    const rates: number[] = [];
    let h = a.heading;
    for (let i = 0; i < 120; i++) {
      a.state = 'wander';
      a.tx = a.x;
      a.tz = s.z - 40;
      eco.update(DT, ctx(p));
      env.update(DT, 0, 0, []);
      const d = Math.atan2(Math.sin(a.heading - h), Math.cos(a.heading - h));
      rates.push(Math.abs(d) / DT);
      h = a.heading;
    }
    const max = sp.locomotion.turnRate * 1.2 * 1.001;
    expect(Math.max(...rates)).toBeLessThanOrEqual(max);
    // Eased start: the first frames turn much slower than the peak.
    expect(rates[0]).toBeLessThan(Math.max(...rates) * 0.3);
    // Consecutive frames never jump in turning speed.
    for (let i = 1; i < rates.length; i++) expect(Math.abs(rates[i] - rates[i - 1])).toBeLessThan(max * 0.2);
  });

  it('artist-model clips do not flicker when the speed hovers at a threshold', () => {
    const all = new Set(['idle', 'walk', 'run'] as const);
    const mid = (2 + 7) / 2;
    // Rising just above the midpoint does not switch to running yet…
    expect(chooseClip(all, 'wander', mid * 1.02, 2, 7, false, 'walk')).toBe('walk');
    expect(chooseClip(all, 'wander', mid * 1.2, 2, 7, false, 'walk')).toBe('run');
    // …and once running, dipping slightly below keeps running.
    expect(chooseClip(all, 'wander', mid * 0.95, 2, 7, false, 'run')).toBe('run');
    expect(chooseClip(all, 'wander', mid * 0.7, 2, 7, false, 'run')).toBe('walk');
    // Creeping speeds near zero keep the current choice.
    expect(chooseClip(all, 'wander', 0.1, 2, 7, false, 'idle')).toBe('idle');
    expect(chooseClip(all, 'wander', 0.1, 2, 7, false, 'walk')).toBe('walk');
  });
});
