import * as THREE from 'three';
import { clamp, damp } from '../core/math';
import type { CollisionWorld } from '../world/collision';
import type { Terrain } from '../world/terrain';
import type { PlayerController } from './player';

/** Third/first person camera with terrain and wall avoidance. */
export class CameraRig {
  distance = 4.4;
  private smoothed = new THREE.Vector3();
  private initialized = false;

  constructor(public camera: THREE.PerspectiveCamera) {
    camera.rotation.order = 'YXZ';
  }

  zoom(steps: number): void {
    this.distance = clamp(this.distance + steps * 0.8, 2.2, 12);
  }

  update(dt: number, p: PlayerController, firstPerson: boolean, terrain: Terrain | ((x: number, z: number) => number), collision: CollisionWorld, maxDistance = Infinity): void {
    const height = typeof terrain === 'function' ? terrain : (x: number, z: number) => terrain.height(x, z);
    const s = p.s;
    const eye = p.crouching ? 1.05 : p.swimming ? 1.5 : 1.65;
    const head = new THREE.Vector3(s.x, s.y + eye, s.z);
    const cam = this.camera;
    // Natural field of view: wider in first person, tighter over the shoulder.
    // Portrait screens (phones held upright) get a wider vertical view and a bit more distance.
    const portrait = cam.aspect < 1 ? Math.min(1, (1 - cam.aspect) * 1.6) : 0;
    const fov = (firstPerson ? 72 : 58) + portrait * 12;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 8 + 0.05);
      if (Math.abs(cam.fov - fov) < 0.05) cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    if (firstPerson) {
      cam.position.copy(head);
      cam.rotation.set(s.pitch, s.yaw + Math.PI, 0);
      this.initialized = false;
      return;
    }
    // Orbit behind the look direction.
    const cp = Math.cos(s.pitch);
    const dir = new THREE.Vector3(Math.sin(s.yaw) * cp, Math.sin(s.pitch), Math.cos(s.yaw) * cp);
    // Over-the-shoulder framing: the survivor sits left of centre, below the horizon line.
    const shoulder = new THREE.Vector3(-Math.cos(s.yaw), 0, Math.sin(s.yaw)).multiplyScalar(0.55);
    const target = head.clone().add(shoulder).add(new THREE.Vector3(0, 0.18, 0));
    const wanted = Math.min(this.distance * (1 + portrait * 0.25), maxDistance);
    let dist = wanted;
    // March back from the head and stop before terrain or solid colliders.
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * wanted;
      const x = target.x - dir.x * d;
      const y = target.y - dir.y * d;
      const z = target.z - dir.z * d;
      if (y < height(x, z) + 0.35 || collision.blocked(x, z, 0.2, y - 0.2, 0.4)) {
        dist = Math.max(0.6, ((i - 1) / steps) * wanted);
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
