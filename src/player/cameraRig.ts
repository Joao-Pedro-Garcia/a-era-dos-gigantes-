import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { CollisionWorld } from '../world/collision';
import type { Terrain } from '../world/terrain';
import type { PlayerController } from './player';

/** Third/first person camera with terrain and wall avoidance. */
export class CameraRig {
  distance = 5;
  private smoothed = new THREE.Vector3();
  private initialized = false;

  constructor(public camera: THREE.PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
  }

  zoom(steps: number): void {
    this.distance = clamp(this.distance + steps * 0.8, 2.2, 12);
  }

  update(dt: number, p: PlayerController, firstPerson: boolean, terrain: Terrain, collision: CollisionWorld): void {
    const s = p.s;
    const eye = p.crouching ? 1.05 : p.swimming ? 1.5 : 1.65;
    const head = new THREE.Vector3(s.x, s.y + eye, s.z);
    const cam = this.camera;
    if (firstPerson) {
      cam.position.copy(head);
      cam.rotation.set(s.pitch, s.yaw + Math.PI, 0);
      this.initialized = false;
      return;
    }
    // Orbit behind the look direction.
    const cp = Math.cos(s.pitch);
    const dir = new THREE.Vector3(Math.sin(s.yaw) * cp, Math.sin(s.pitch), Math.cos(s.yaw) * cp);
    const shoulder = new THREE.Vector3(-Math.cos(s.yaw), 0, Math.sin(s.yaw)).multiplyScalar(0.45);
    const target = head.clone().add(shoulder);
    let dist = this.distance;
    // March back from the head and stop before terrain or solid colliders.
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * this.distance;
      const x = target.x - dir.x * d;
      const y = target.y - dir.y * d;
      const z = target.z - dir.z * d;
      if (y < terrain.height(x, z) + 0.35 || collision.blocked(x, z, 0.2, y - 0.2, 0.4)) {
        dist = Math.max(0.6, ((i - 1) / steps) * this.distance);
        break;
      }
    }
    const desired = target.clone().addScaledVector(dir, -dist);
    if (!this.initialized) {
      this.smoothed.copy(desired);
      this.initialized = true;
    }
    // Snap closer immediately (avoid clipping), ease back out smoothly.
    const cur = this.smoothed.distanceTo(target);
    this.smoothed.lerp(desired, dist < cur ? 1 : damp(8, dt));
    cam.position.copy(this.smoothed);
    cam.lookAt(target.x + dir.x * 2, target.y + dir.y * 2, target.z + dir.z * 2);
  }
}
