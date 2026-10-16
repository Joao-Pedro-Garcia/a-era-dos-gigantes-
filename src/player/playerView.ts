import * as THREE from 'three';
import type { TextureLibrary } from '../graphics/textureLibrary';
import { buildHumanRig, JOINTS, type BoneName, type HumanRig } from './humanModel';
import type { PlayerController } from './player';
import { createContactShadow } from '../graphics/contactShadow';
import { driveExternal, hasExternal, instantiate, type ExternalInstance } from '../graphics/externalModels';

/**
 * The survivor: a skinned human (see humanModel.ts) animated procedurally
 * from the controller state.
 *
 * - Gait: the cycle is driven by the distance actually travelled (the
 *   controller's stride), and the leg swing amplitude is derived from the
 *   step length, so the planted foot does not slide.
 * - Legs use two-bone IK: each ankle is placed on the real terrain height
 *   under it (slopes, steps), the pelvis drops so the stance leg never
 *   over-extends, and the swing foot is lifted.
 * - Weight shift: the pelvis bobs and sways over the stance leg and rotates
 *   with the stride while the chest counter-rotates; arms swing opposite to
 *   the legs; the body leans into runs; breathing when idle.
 * - Crouching, swimming strokes, airborne tuck, riding and tool swings are
 *   layered on top.
 */
const THIGH = JOINTS['thigh.L'][1] - JOINTS['shin.L'][1];
const SHIN = JOINTS['shin.L'][1] - JOINTS['foot.L'][1];
const LEG = THIGH + SHIN;
const HIP_Y = JOINTS['thigh.L'][1];
const ANKLE_Y = JOINTS['foot.L'][1];

export class PlayerView {
  readonly root = new THREE.Group();
  private rig: HumanRig;
  private held = new THREE.Group();
  private heldId = '';
  private swing = 0;
  private time = 0;
  private pelvis = HIP_Y;
  private lean = 0;
  private moveBlend = 0;
  private crouch = 0;
  private swim = 0;
  private air = 0;
  private shadow: THREE.Mesh;
  private materials: THREE.MeshStandardMaterial[];
  private tmp = new THREE.Vector3();
  /** Set by the game while mounted on an animal. */
  riding = false;
  /** Artist model replacing the procedural survivor (see externalModels.ts). */
  private ext: ExternalInstance | null = null;

  constructor(textures?: TextureLibrary) {
    const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
    const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    const leather = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
    const hair = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, alphaTest: 0.35, side: THREE.DoubleSide });
    const eye = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0 });
    if (textures) {
      textures.bind(skin, 'skin');
      textures.bind(cloth, 'cloth');
      textures.bind(leather, 'leather');
      textures.bind(hair, 'hair');
    }
    this.materials = [skin, cloth, leather, hair, eye];
    this.rig = buildHumanRig(this.materials);
    this.root.add(this.rig.mesh);
    this.rig.bones['hand.R'].add(this.held);
    this.held.position.set(0, -0.07, 0.01);
    this.shadow = createContactShadow(0.42);
    this.root.add(this.shadow);
    this.textures = textures ?? null;
    if (hasExternal('player'))
      void instantiate('player').then((inst) => {
        if (!inst) return;
        this.ext = inst;
        this.root.add(inst.root);
      });
  }
  private textures: TextureLibrary | null;

  setHeld(itemId: string): void {
    if (itemId === this.heldId) return;
    this.heldId = itemId;
    for (const c of this.held.children) c.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
    this.held.clear();
    if (!itemId) return;
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.85 });
    if (this.textures) this.textures.bind(wood, 'bark', { map: true, normal: true, rough: false });
    const stone = new THREE.MeshStandardMaterial({ color: 0x6a665e, roughness: 0.7 });
    const spear = itemId.includes('spear');
    const len = spear ? 1.8 : itemId === 'torch' ? 0.55 : 0.6;
    // The hand hangs along -Y in the rest pose: tools extend along the hand's -Y axis, slightly forward.
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, len, 8), wood);
    handle.position.y = spear ? -0.2 : -len * 0.32;
    handle.castShadow = true;
    const holder = new THREE.Group();
    holder.rotation.x = 1.35;
    holder.add(handle);
    if (itemId === 'torch') {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 1 }));
      head.position.y = handle.position.y - len / 2;
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 8), new THREE.MeshBasicMaterial({ color: 0xffa040 }));
      flame.position.y = head.position.y - 0.13;
      flame.rotation.x = Math.PI;
      const light = new THREE.PointLight(0xffa040, 25, 16, 1.5);
      light.position.y = flame.position.y - 0.1;
      holder.add(head, flame, light);
    } else if (itemId !== 'bow') {
      const geo = spear ? new THREE.ConeGeometry(0.03, 0.2, 6) : new THREE.DodecahedronGeometry(0.06, 0);
      const h = new THREE.Mesh(geo, stone);
      if (spear) {
        h.rotation.x = Math.PI;
        h.position.y = handle.position.y - len / 2 - 0.08;
      } else {
        h.scale.set(0.8, 1.5, 0.45);
        h.position.set(0, handle.position.y - len / 2 + 0.06, 0.03);
      }
      h.castShadow = true;
      holder.add(h);
    }
    this.held.add(holder);
  }

  attackSwing(): void {
    this.swing = 1;
  }

  /**
   * @param ground terrain height at a world position (for foot placement);
   *               omitted → flat ground at the player's feet.
   */
  update(dt: number, p: PlayerController, firstPerson: boolean, ground?: (x: number, z: number) => number): void {
    const s = p.s;
    this.time += dt;
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = p.bodyYaw;
    this.rig.mesh.visible = !firstPerson && !this.ext;
    this.shadow.visible = !firstPerson && !p.swimming;
    if (this.ext) {
      this.ext.root.visible = !firstPerson;
      driveExternal(this.ext, dt, p.crouching ? 'rest' : 'idle', p.horizontalSpeed, 1.6, 5, !p.onGround && !p.swimming);
    }

    const B = this.rig.bones;
    const R = this.rig.rest;
    // Reset to the rest pose; everything below is relative to it.
    for (const name of Object.keys(B) as BoneName[]) {
      B[name].position.copy(R[name]);
      B[name].rotation.set(0, 0, 0);
    }

    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    const speed = p.horizontalSpeed;
    const moving = speed > 0.12 && (p.onGround || p.swimming);
    this.moveBlend += ((moving ? 1 : 0) - this.moveBlend) * k(8);
    this.crouch += ((p.crouching ? 1 : 0) - this.crouch) * k(10);
    this.swim += ((p.swimming ? 1 : 0) - this.swim) * k(5);
    this.air += ((!p.onGround && !p.swimming && !this.riding ? 1 : 0) - this.air) * k(10);
    const run = Math.max(0, Math.min(1, (speed - 2.2) / 3));
    const stepLen = p.sprinting ? 1.6 : 1.1;
    const mv = this.moveBlend;

    if (this.riding) {
      this.poseRiding();
      this.finish(dt);
      return;
    }
    if (this.swim > 0.5) {
      this.poseSwim(p.stride * Math.PI, mv);
      this.finish(dt);
      return;
    }

    // ---- Legs (IK on terrain) --------------------------------------------
    // Duty-factor gait: during stance the foot moves back at exactly the body's
    // speed (planted, no sliding); the rest of the cycle is the swing, with the
    // foot lifted and carried forward. The stance length is what the leg can
    // reach; the controller's step length then fixes the duty factor (jogging
    // and sprinting get a flight phase).
    const reachLen = 0.92 * (1 - this.crouch * 0.25);
    const duty = Math.min(0.62, reachLen / (2 * stepLen));
    const stanceLen = 2 * stepLen * duty * mv;
    const lift = (0.09 + run * 0.18 + (1 - duty) * 0.06) * mv;
    const cycle = p.stride / 2;
    const yaw = p.bodyYaw;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const legs: { side: 1 | -1; fz: number; fy: number; g: number; u: number; stance: number }[] = [];
    for (const side of [1, -1] as const) {
      const u = (((cycle + (side > 0 ? 0 : 0.5)) % 1) + 1) % 1;
      let fz: number;
      let up = 0;
      let stance: number;
      if (u < duty) {
        fz = stanceLen * (0.5 - u / duty);
        stance = 1;
      } else {
        const w = (u - duty) / (1 - duty);
        fz = stanceLen * (-0.5 + (1 - Math.cos(w * Math.PI)) / 2);
        up = Math.sin(w * Math.PI);
        stance = 0;
      }
      // Ground under this foot, relative to the player's feet.
      let g = 0;
      if (ground && p.onGround) {
        const lx = JOINTS[side > 0 ? 'foot.L' : 'foot.R'][0];
        const wx = s.x + lx * cy + fz * sy;
        const wz = s.z - lx * sy + fz * cy;
        g = Math.max(-0.35, Math.min(0.45, ground(wx, wz) - s.y));
      }
      legs.push({ side, fz, fy: g + ANKLE_Y + lift * up, g, u, stance });
    }
    const phase = cycle * Math.PI * 2;
    // Pelvis: low enough that neither foot (on its ground) is out of reach.
    let hip = HIP_Y;
    for (const l of legs) hip = Math.min(hip, l.g + ANKLE_Y + Math.sqrt(Math.max(0, (LEG * 0.985) ** 2 - l.fz * l.fz)));
    // Vertical bob: lowest at mid-stance loading, highest in the flight phase.
    const bob = -Math.cos(phase * 2) * (0.012 + run * 0.025) * mv;
    hip += bob - this.crouch * 0.3 - this.air * 0.04;
    const breathe = Math.sin(this.time * 1.7) * 0.004 * (1 - mv);
    this.pelvis += (hip - this.pelvis) * k(18);
    const sway = Math.sin(phase) * 0.022 * mv * (1 - run * 0.5);
    B.hips.position.y = this.pelvis - JOINTS.root[1] + breathe;
    B.hips.position.x = sway + Math.sin(this.time * 0.35) * 0.006 * (1 - mv);
    B.hips.rotation.y = Math.sin(phase) * 0.12 * mv;
    B.hips.rotation.z = Math.cos(phase) * 0.035 * mv;

    for (const l of legs) {
      const sfx = l.side > 0 ? '.L' : '.R';
      // Hip joint in the hips' frame ≈ model space (small pelvis rotations ignored).
      const hipY = this.pelvis;
      const dy = hipY - l.fy;
      const dz = l.fz;
      let d = Math.hypot(dy, dz);
      d = Math.min(d, LEG * 0.999);
      // Law of cosines: knee flexion and thigh pitch.
      const cosK = (THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN);
      const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, cosK)));
      const cosA = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
      const toTarget = Math.atan2(dz, dy); // forward angle of the hip→ankle line
      const thigh = -(toTarget + Math.acos(Math.max(-1, Math.min(1, cosA))));
      B[`thigh${sfx}` as BoneName].rotation.x = thigh - B.hips.rotation.x;
      B[`thigh${sfx}` as BoneName].rotation.z = l.side * 0.02;
      B[`shin${sfx}` as BoneName].rotation.x = knee;
      // Foot: sole parallel to the ground in stance, heel lifts at toe-off.
      const toeOff = l.stance * Math.max(0, l.u / duty - 0.7) / 0.3;
      const footPitch = -(thigh + knee) + toeOff * 0.6 - (1 - l.stance) * 0.18 * mv;
      B[`foot${sfx}` as BoneName].rotation.x = footPitch;
      B[`toe${sfx}` as BoneName].rotation.x = -toeOff * 0.5;
    }

    // ---- Upper body ----------------------------------------------------------
    const leanTarget = run * 0.22 + this.crouch * 0.35 + mv * 0.04;
    this.lean += (leanTarget - this.lean) * k(6);
    B.spine.rotation.x = this.lean * 0.5 + Math.sin(phase * 2) * 0.015 * mv;
    B.chest.rotation.x = this.lean * 0.45 + Math.sin(this.time * 1.7) * 0.015 * (1 - mv);
    B.chest.rotation.y = -Math.sin(phase) * (0.14 + run * 0.08) * mv;
    B.neck.rotation.x = -this.lean * 0.6;
    B.head.rotation.x = -this.lean * 0.3 + Math.sin(phase * 2) * 0.01 * mv;
    B.head.rotation.y = -B.chest.rotation.y * 0.6;

    const armAmp = (0.45 + run * 0.6) * mv;
    const elbow = 0.18 + run * 1.15 + this.crouch * 0.4;
    for (const side of [1, -1] as const) {
      const sfx = side > 0 ? '.L' : '.R';
      const ph = side > 0 ? phase : phase + Math.PI;
      const swingA = Math.sin(ph) * armAmp;
      B[`upperArm${sfx}` as BoneName].rotation.x = swingA - this.crouch * 0.3 + this.air * -0.4;
      B[`upperArm${sfx}` as BoneName].rotation.z = side * (0.09 + run * 0.08 + this.air * 0.3);
      B[`foreArm${sfx}` as BoneName].rotation.x = -(elbow + Math.max(0, -swingA) * 0.5);
      B[`hand${sfx}` as BoneName].rotation.x = -0.1;
    }
    this.poseTool();
    this.finish(dt);
  }

  /** Right arm: carrying a tool forward and the strike motion. */
  private poseTool(): void {
    const B = this.rig.bones;
    if (this.heldId) {
      B['upperArm.R'].rotation.x = B['upperArm.R'].rotation.x * 0.4 - 0.25;
      B['foreArm.R'].rotation.x = -0.75;
    }
    if (this.swing > 0) {
      const u = 1 - this.swing;
      // Wind-up above the shoulder, then a fast downward strike.
      const a = u < 0.3 ? -2.5 * (u / 0.3) : -2.5 + 2.3 * Math.min(1, (u - 0.3) / 0.35);
      B['upperArm.R'].rotation.x = a;
      B['upperArm.R'].rotation.z = -0.25;
      B['foreArm.R'].rotation.x = -0.5 - (u < 0.3 ? 0.8 : 0);
      B.chest.rotation.y += (u < 0.3 ? 0.35 : -0.25) * (1 - Math.abs(u - 0.3));
    }
  }

  private poseSwim(phase: number, mv: number): void {
    const B = this.rig.bones;
    const t = this.time;
    // Body nearly horizontal at the surface; breaststroke-like arms, flutter kick.
    B.hips.position.y = 0.95 - JOINTS.root[1] + 0.35;
    B.hips.rotation.x = 1.25;
    B.neck.rotation.x = -0.9;
    B.head.rotation.x = -0.35;
    const stroke = mv > 0.1 ? phase : t * 1.2;
    for (const side of [1, -1] as const) {
      const sfx = side > 0 ? '.L' : '.R';
      const a = Math.sin(stroke + (side > 0 ? 0 : Math.PI));
      B[`upperArm${sfx}` as BoneName].rotation.x = -2.2 + a * 0.9;
      B[`upperArm${sfx}` as BoneName].rotation.z = side * (0.5 + Math.cos(stroke) * 0.3);
      B[`foreArm${sfx}` as BoneName].rotation.x = -0.4 - Math.max(0, a) * 0.6;
      B[`thigh${sfx}` as BoneName].rotation.x = Math.sin(t * 6 + (side > 0 ? 0 : Math.PI)) * 0.25 * (0.4 + mv);
      B[`shin${sfx}` as BoneName].rotation.x = 0.2 + Math.max(0, Math.sin(t * 6 + side)) * 0.3;
      B[`foot${sfx}` as BoneName].rotation.x = 0.7;
    }
  }

  private poseRiding(): void {
    const B = this.rig.bones;
    const t = this.time;
    B.hips.position.y = 0.0;
    for (const side of [1, -1] as const) {
      const sfx = side > 0 ? '.L' : '.R';
      B[`thigh${sfx}` as BoneName].rotation.x = -1.1;
      B[`thigh${sfx}` as BoneName].rotation.z = side * 0.55;
      B[`shin${sfx}` as BoneName].rotation.x = 1.3;
      B[`upperArm${sfx}` as BoneName].rotation.x = -0.5;
      B[`foreArm${sfx}` as BoneName].rotation.x = -0.9;
    }
    B.spine.rotation.x = 0.12 + Math.sin(t * 3) * 0.02;
  }

  private finish(dt: number): void {
    this.swing = Math.max(0, this.swing - dt * 2.6);
    // Contact shadow follows the pelvis over the ground.
    this.shadow.position.set(this.rig.bones.hips.position.x, 0.03, 0);
    const lift = Math.max(0, this.pelvis - HIP_Y + 0.05);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.max(0.2, 1 - lift * 2) * (1 - this.air * 0.6);
    void this.tmp;
  }

  dispose(): void {
    this.rig.mesh.geometry.dispose();
    for (const m of this.materials) {
      this.textures?.unbind(m);
      m.dispose();
    }
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}
