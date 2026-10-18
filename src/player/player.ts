import { clamp, damp } from '../core/math';
import { CollisionWorld } from '../world/collision';
import type { Terrain } from '../world/terrain';

/**
 * Character controller: acceleration-based movement on the heightfield and
 * walkable building surfaces, cylinder collision against trees, rocks, ruins
 * and buildings, jumping, crouching, swimming and fall damage.
 */
export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface MoveInput {
  x: number;
  y: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
}

export interface MoveEnv {
  terrain: Terrain;
  collision: CollisionWorld;
  waterLevel: number;
  speedMul: number;
  canSprint: boolean;
  biomeMul: number;
  /** Extra circles to collide with (large animals). */
  dynamic: { x: number; z: number; r: number }[];
  /** Flat floor height replacing the terrain (cave interiors). */
  groundOverride?: number;
  /** Keep the player inside this circle (cave interiors). */
  bounds?: { x: number; z: number; r: number };
  /** Max climbable rise per metre (skills). */
  slopeLimit?: number;
}

export const PLAYER_RADIUS = 0.38;
export const PLAYER_HEIGHT = 1.8;
const GRAVITY = 22;

export class PlayerController {
  vx = 0;
  vz = 0;
  vy = 0;
  onGround = true;
  swimming = false;
  crouching = false;
  sprinting = false;
  /** Strides travelled, drives leg animation. */
  stride = 0;
  /** Facing of the body (third person turns toward motion). */
  bodyYaw = 0;
  /** Downward speed at the last landing (for fall damage), consumed by the game. */
  landingImpact = 0;
  horizontalSpeed = 0;
  /**
   * Height used for drawing the body and placing the camera: follows s.y but
   * eases over small steps (foundations, rocks), so neither pops.
   */
  visualY: number;

  constructor(public s: PlayerState) {
    this.bodyYaw = s.yaw;
    this.visualY = s.y;
  }

  /** Step length for the current speed: continuous from walking to sprinting, so the gait never jumps. */
  stepLength(): number {
    return clamp(1.1 + ((this.horizontalSpeed - 3.3) / (6.4 - 3.3)) * 0.5, 1.1, 1.6);
  }

  forward(): [number, number] {
    return [Math.sin(this.s.yaw), Math.cos(this.s.yaw)];
  }

  update(dt: number, inp: MoveInput, env: MoveEnv, firstPerson: boolean): void {
    const s = this.s;
    this.crouching = inp.crouch && !this.swimming;
    const wantsSprint = inp.sprint && env.canSprint && inp.y > 0.1 && !this.crouching && !this.swimming;
    this.sprinting = wantsSprint;
    const base = this.swimming ? 1.9 : this.crouching ? 1.6 : wantsSprint ? 6.4 : 3.3;
    const speed = base * env.speedMul * (this.swimming ? 1 : env.biomeMul);

    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const rx = -Math.cos(s.yaw);
    const rz = Math.sin(s.yaw);
    let dx = fx * inp.y + rx * inp.x;
    let dz = fz * inp.y + rz * inp.x;
    const l = Math.hypot(dx, dz);
    if (l > 1) {
      dx /= l;
      dz /= l;
    }
    const tvx = dx * speed;
    const tvz = dz * speed;
    // Speeding up takes a little longer than slowing down; in the air there is little control.
    const grounded = this.onGround || this.swimming;
    const speeding = tvx * tvx + tvz * tvz > this.vx * this.vx + this.vz * this.vz;
    const k = damp(grounded ? (speeding ? 7 : 9) : 1.5, dt);
    this.vx += (tvx - this.vx) * k;
    this.vz += (tvz - this.vz) * k;

    // Slope limit: steep uphill movement is slowed and you slide back.
    const t = env.terrain;
    const ground = (x: number, z: number) => env.groundOverride ?? t.height(x, z);
    const h0 = ground(s.x, s.z);
    const ahead = ground(s.x + this.vx * 0.2, s.z + this.vz * 0.2);
    const rise = (ahead - h0) / Math.max(0.05, Math.hypot(this.vx, this.vz) * 0.2);
    if (rise > (env.slopeLimit ?? 1.1) && this.onGround) {
      this.vx *= 0.2;
      this.vz *= 0.2;
    }

    let nx = s.x + this.vx * dt;
    let nz = s.z + this.vz * dt;
    [nx, nz] = env.collision.resolve(nx, nz, PLAYER_RADIUS, s.y, this.crouching ? 1.1 : PLAYER_HEIGHT);
    for (const d of env.dynamic) {
      const p = CollisionWorld.penetration({ kind: 'circle', id: '', x: d.x, z: d.z, r: d.r, y0: 0, y1: 0 }, nx, nz, PLAYER_RADIUS);
      if (p) {
        nx += p[0];
        nz += p[1];
      }
    }
    if (env.bounds) {
      const dx = nx - env.bounds.x;
      const dz = nz - env.bounds.z;
      const d = Math.hypot(dx, dz);
      if (d > env.bounds.r) {
        nx = env.bounds.x + (dx / d) * env.bounds.r;
        nz = env.bounds.z + (dz / d) * env.bounds.r;
      }
    }
    s.x = nx;
    s.z = nz;

    // Vertical: ground is the terrain or a walkable surface (floors, foundations).
    const terrainY = ground(s.x, s.z);
    const surf = env.collision.surfaceAt(s.x, s.z, s.y + 0.6);
    const groundY = Math.max(terrainY, surf);
    const swimY = env.waterLevel - 1.25;
    this.swimming = env.groundOverride === undefined && groundY < swimY;

    if (this.swimming) {
      this.vy = 0;
      s.y += (swimY - s.y) * damp(4, dt);
      this.onGround = false;
    } else {
      if (inp.jump && this.onGround && !this.crouching) {
        this.vy = 6.2;
        this.onGround = false;
      }
      this.vy -= GRAVITY * dt;
      s.y += this.vy * dt;
      if (s.y <= groundY) {
        if (!this.onGround && this.vy < -11) this.landingImpact = -this.vy;
        s.y = groundY;
        this.vy = 0;
        this.onGround = true;
      } else if (s.y - groundY < 0.35 && this.vy <= 0) {
        // Stick to the ground when walking downhill.
        s.y = groundY;
        this.vy = 0;
        this.onGround = true;
      } else this.onGround = false;
    }

    this.horizontalSpeed = Math.hypot(this.vx, this.vz);
    this.stride += (this.horizontalSpeed * dt) / this.stepLength();
    const off = s.y - this.visualY;
    if (Math.abs(off) > 0.6 || !Number.isFinite(off)) this.visualY = s.y;
    else this.visualY += off * damp(this.onGround ? 16 : 30, dt);
    if (firstPerson) this.bodyYaw = s.yaw;
    else if (this.horizontalSpeed > 0.3) {
      const target = Math.atan2(this.vx, this.vz);
      let d = target - this.bodyYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.bodyYaw += d * damp(9, dt);
    }
    s.pitch = clamp(s.pitch, -1.45, 1.45);
  }

  /** How far the player's noise carries (m). */
  noiseRadius(): number {
    if (this.horizontalSpeed < 0.2) return 3;
    if (this.crouching) return 5;
    if (this.sprinting) return 40;
    return 14;
  }
}
