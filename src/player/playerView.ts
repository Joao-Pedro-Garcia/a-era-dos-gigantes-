import * as THREE from 'three';
import type { PlayerController } from './player';

/** Simple articulated survivor model; legs follow travelled distance. */
export class PlayerView {
  readonly root = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private body: THREE.Group;
  private held = new THREE.Group();
  private heldId = '';
  private swing = 0;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xb98a6a, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x6b5a40, roughness: 0.95 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3028, roughness: 0.95 });
    this.body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 8), cloth);
    torso.position.y = 1.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skin);
    head.position.y = 1.65;
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), dark);
    hair.position.y = 1.67;
    this.body.add(torso, head, hair);
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.11, 0.9, 0);
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.7, 4, 6), dark);
      m.position.y = -0.45;
      leg.add(m);
      this.body.add(leg);
      this.legs.push(leg);
      const arm = new THREE.Group();
      arm.position.set(side * 0.3, 1.42, 0);
      const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.5, 4, 6), skin);
      a.position.y = -0.3;
      arm.add(a);
      this.body.add(arm);
      this.arms.push(arm);
    }
    this.arms[0].add(this.held);
    this.held.position.set(0, -0.6, 0.1);
    this.root.add(this.body);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
  }

  setHeld(itemId: string): void {
    if (itemId === this.heldId) return;
    this.heldId = itemId;
    this.held.clear();
    if (!itemId) return;
    const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.9 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 0.8 });
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, itemId.includes('spear') ? 1.8 : 0.6, 6), wood);
    handle.rotation.x = Math.PI / 2;
    this.held.add(handle);
    if (itemId === 'torch') {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 6), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      flame.position.z = 0.35;
      flame.rotation.x = Math.PI / 2;
      this.held.add(flame);
      const light = new THREE.PointLight(0xffa040, 25, 16, 1.5);
      light.position.z = 0.4;
      this.held.add(light);
    } else if (itemId !== 'bow') {
      const headMesh = new THREE.Mesh(itemId.includes('spear') ? new THREE.ConeGeometry(0.05, 0.25, 5) : new THREE.BoxGeometry(0.06, 0.18, 0.14), stone);
      headMesh.position.z = itemId.includes('spear') ? 0.95 : 0.3;
      headMesh.rotation.x = Math.PI / 2;
      this.held.add(headMesh);
    }
  }

  attackSwing(): void {
    this.swing = 1;
  }

  update(dt: number, p: PlayerController, firstPerson: boolean): void {
    const s = p.s;
    this.root.position.set(s.x, s.y + (p.swimming ? -0.9 : 0), s.z);
    this.root.rotation.y = p.bodyYaw;
    this.body.visible = !firstPerson;
    const amp = Math.min(0.7, p.horizontalSpeed * 0.15);
    const ph = p.stride * Math.PI;
    this.legs[0].rotation.x = Math.sin(ph) * amp;
    this.legs[1].rotation.x = -Math.sin(ph) * amp;
    this.arms[1].rotation.x = Math.sin(ph) * amp * 0.8;
    this.swing = Math.max(0, this.swing - dt * 3);
    this.arms[0].rotation.x = -Math.sin(ph) * amp * 0.8 - Math.sin(this.swing * Math.PI) * 1.6 - (this.heldId ? 0.4 : 0);
    this.body.position.y = p.crouching ? -0.4 : 0;
  }
}
