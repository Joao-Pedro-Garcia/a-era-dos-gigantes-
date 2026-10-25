import * as THREE from 'three';

/**
 * Meteor shower: bright streaks crossing the night sky for a while. Each
 * streak is a short additive line that fades in and out; some fall toward
 * impact points near the player (where fragments can be picked up).
 */
interface Streak {
  line: THREE.Line;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
}

export class MeteorShower {
  readonly group = new THREE.Group();
  private streaks: Streak[] = [];
  private spawnAcc = 0;
  private until = 0;
  private mat = new THREE.LineBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

  start(now: number, seconds: number): void {
    this.until = now + seconds;
  }

  get active(): boolean {
    return this.streaks.length > 0 || this.spawnAcc > 0;
  }

  update(dt: number, now: number, camera: THREE.Vector3, rnd: () => number): void {
    if (now < this.until) {
      this.spawnAcc += dt * 2.2;
      while (this.spawnAcc > 1) {
        this.spawnAcc -= 1;
        const ang = rnd() * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
        const from = camera.clone().add(new THREE.Vector3((rnd() - 0.5) * 900, 380 + rnd() * 200, (rnd() - 0.5) * 900));
        const to = from.clone().addScaledVector(dir, 160 + rnd() * 160).add(new THREE.Vector3(0, -(80 + rnd() * 120), 0));
        const geo = new THREE.BufferGeometry().setFromPoints([from, from.clone()]);
        const line = new THREE.Line(geo, this.mat.clone());
        line.frustumCulled = false;
        this.group.add(line);
        this.streaks.push({ line, from, to, t: 0, dur: 0.6 + rnd() * 0.9 });
      }
    } else this.spawnAcc = 0;
    this.streaks = this.streaks.filter((s) => {
      s.t += dt;
      const u = Math.min(1, s.t / s.dur);
      const head = s.from.clone().lerp(s.to, u);
      const tail = s.from.clone().lerp(s.to, Math.max(0, u - 0.35));
      const attr = s.line.geometry.attributes.position as THREE.BufferAttribute;
      attr.setXYZ(0, tail.x, tail.y, tail.z);
      attr.setXYZ(1, head.x, head.y, head.z);
      attr.needsUpdate = true;
      (s.line.material as THREE.LineBasicMaterial).opacity = Math.sin(u * Math.PI) * 0.95;
      if (u >= 1) {
        s.line.removeFromParent();
        s.line.geometry.dispose();
        (s.line.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }
}
