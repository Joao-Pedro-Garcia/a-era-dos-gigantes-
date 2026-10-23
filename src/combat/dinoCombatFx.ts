import * as THREE from 'three';
import type { AnimalData } from '../animals/animal';
import { growthScale } from '../animals/animal';
import { reactionScale } from '../animals/animalView';
import { SPECIES } from '../animals/species';
import type { AttackMove } from './dinoAttacks';
import type { Game } from '../core/game';

/**
 * Game-side consequences of dinosaur blows: impact effects and sounds, hit
 * reactions of struck animals and of the player, and the Dilophosaurus' spit
 * (a real projectile that can be dodged; it blinds on contact).
 */
interface Glob {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  from: AnimalData;
}

const HEAVY = new Set(['stomp', 'club', 'tail', 'horns', 'headbutt', 'shake', 'spikes']);

export class DinoCombatFx {
  private globs: Glob[] = [];
  private globGeo: THREE.SphereGeometry | null = null;
  private globMat: THREE.MeshStandardMaterial | null = null;

  constructor(private g: Game) {}

  /** A blow connected: effects at the contact point, reactions, camera kick near the player. */
  landed(a: AnimalData, target: AnimalData | null, move: AttackMove): void {
    const g = this.g;
    const now = g.env?.state.time ?? 0;
    const p = g.player;
    if (!p) return;
    const tx = target ? target.x : p.s.x;
    const tz = target ? target.z : p.s.z;
    const ty = target ? target.y + SPECIES[target.speciesId].hipHeightM * growthScale(target, now) : p.s.y + 1.2;
    const dir = new THREE.Vector3(tx - a.x, 0, tz - a.z).normalize();
    const heavy = HEAVY.has(move.kind);
    g.fx.spawn(move.from === 'feet' ? 'dirt' : 'flesh', new THREE.Vector3(tx, ty, tz), dir, heavy ? 1.4 : 0.9);
    g.audio.sfx(heavy ? 'swingHeavy' : 'punch', [tx, ty, tz]);
    if (target) {
      const tsp = SPECIES[target.speciesId];
      g.animalHit(target.id, dir.x, dir.z, (heavy ? 1 : 0.7) * reactionScale(tsp.massKg * growthScale(target, now) ** 3));
    } else {
      g.playerView?.hitReact(dir.x, dir.z, heavy ? 1 : 0.6);
    }
    // Ground-shaking blows are felt nearby even when they miss you.
    const d = Math.hypot(tx - p.s.x, tz - p.s.z);
    if (heavy && d < 25) g.hitStop(0.05 * (1 - d / 25) + (target ? 0 : 0.04));
  }

  /** Launches a spit glob from the animal's mouth toward a point on the ground (aimed at chest height). */
  spit(a: AnimalData, tx: number, tz: number): void {
    const g = this.g;
    if (!g.env || !g.terrain) return;
    const now = g.env.state.time;
    const sp = SPECIES[a.speciesId];
    const s = growthScale(a, now);
    if (!this.globGeo) {
      this.globGeo = new THREE.SphereGeometry(0.09, 10, 8);
      this.globMat = new THREE.MeshStandardMaterial({ color: 0xb6c23a, emissive: 0x2a3008, roughness: 0.15, metalness: 0, transparent: true, opacity: 0.85 });
    }
    const hx = a.x + Math.sin(a.heading) * sp.lengthM * s * 0.45;
    const hz = a.z + Math.cos(a.heading) * sp.lengthM * s * 0.45;
    const pos = new THREE.Vector3(hx, a.y + sp.hipHeightM * s * 1.45, hz);
    const aim = new THREE.Vector3(tx, g.terrain.height(tx, tz) + 1.45, tz);
    const dist = pos.distanceTo(aim);
    const speed = 17;
    const t = dist / speed;
    // Ballistic: aim a little high so gravity brings it onto the target.
    const vel = aim.clone().sub(pos).divideScalar(Math.max(0.05, t));
    vel.y += 0.5 * 9.8 * t;
    const mesh = new THREE.Mesh(this.globGeo, this.globMat!);
    mesh.position.copy(pos);
    mesh.scale.set(1, 1, 1.8);
    g.worldRoot.add(mesh);
    this.globs.push({ mesh, pos, vel, life: 2, damage: sp.attack.damage * 0.35, from: a });
    g.audio.sfx('swingLight', [pos.x, pos.y, pos.z]);
  }

  update(dt: number): void {
    const g = this.g;
    const p = g.player;
    if (!p || !g.terrain) return;
    const chest = new THREE.Vector3(p.s.x, p.s.y + 1.3, p.s.z);
    for (const b of this.globs) {
      b.life -= dt;
      b.vel.y -= 9.8 * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      b.mesh.lookAt(b.pos.clone().add(b.vel));
      if (b.pos.distanceTo(chest) < 0.75) {
        b.life = 0;
        if (p.dodging) continue;
        g.animalDamagesPlayer(b.damage, b.from);
        g.hud.blind(3.5);
        g.notify('combat.spit', {}, 'warn');
        g.fx.spawn('plant', b.pos.clone(), b.vel.clone().normalize(), 0.6);
        continue;
      }
      if (b.pos.y < g.terrain.height(b.pos.x, b.pos.z)) {
        b.life = 0;
        g.fx.spawn('plant', b.pos.clone(), b.vel.clone().normalize(), 0.5);
      }
    }
    this.globs = this.globs.filter((b) => {
      if (b.life > 0) return true;
      b.mesh.removeFromParent();
      return false;
    });
  }

  clear(): void {
    for (const b of this.globs) b.mesh.removeFromParent();
    this.globs = [];
  }
}
