import * as THREE from 'three';
import type { TextureLibrary } from '../graphics/textureLibrary';
import { buildHumanRig, HAND_GRIP, JOINTS, type BoneName, type HumanRig } from './humanModel';
import type { PlayerController } from './player';
import { createContactShadow } from '../graphics/contactShadow';
import { driveExternal, externalEntry, instantiate, whenModel, type ExternalInstance } from '../graphics/externalModels';
import { artistBody } from './artistBody';
import { blendPose, clipDuration, clipImpact, clipsReady, newPose, sampleClip, type ClipId, type Pose } from './humanClips';
import { actionKindFor, type CombatController } from '../combat/actions';
import { actionPose, lowerPose, pitchKey, solveArm, type ArmPose, type HandKey } from './armPose';
import { attachToHand, buildItemModel, disposeItemModel, type ItemModel } from './itemModels';

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
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const ANKLE_Y = JOINTS['foot.L'][1];

export class PlayerView {
  readonly root = new THREE.Group();
  private rig: HumanRig;
  private heldId = '';
  private item: ItemModel | null = null;
  private combat: CombatController | null = null;
  private torchLight = new THREE.PointLight(0xffa040, 25, 16, 1.5);
  private twist = 0;
  private wR = 0;
  private wL = 0;
  private lastR: HandKey | null = null;
  private lastL: HandKey | null = null;
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
  private tmpQ = new THREE.Quaternion();
  /** Dodge and hit reactions: time since, direction in the body frame (x right, z forward), strength. */
  private dodgeT = 9;
  private dodgeX = 0;
  private dodgeZ = 0;
  private hitT = 9;
  private hitX = 0;
  private hitZ = 0;
  private hitAmp = 0;
  private yaw = 0;
  /** Turning, inertia and landing (see update). */
  private prevYaw = 0;
  private yawRate = 0;
  private feetYaw = 0;
  private turnStep = -1;
  private prevSpeed = 0;
  private accel = 0;
  private landT = 9;
  private landAmp = 0;
  private fallVy = 0;
  /** Motion-captured clips (humanClips.ts) drive the body when loaded; false forces the procedural gait. */
  useClips = true;
  private poses: { idle: Pose; walk: Pose; jog: Pose; sprint: Pose; crouch: Pose; crouchMove: Pose; air: Pose; land: Pose; punch: Pose; out: Pose } | null = null;
  /** A motion-captured punch is playing (the procedural arm IK stays off). */
  private clipPunch = false;
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
    this.torchLight.visible = false;
    this.root.add(this.torchLight);
    this.shadow = createContactShadow(0.42);
    this.root.add(this.shadow);
    this.textures = textures ?? null;
    void whenModel('player').then((ok) => {
      if (!ok || this.disposed) return;
      // A rigged survivor takes over the procedural body on the same skeleton; a file with
      // its own clips replaces the whole figure.
      if (externalEntry('player')?.rig) this.useArtistBody();
      else
        void instantiate('player').then((inst) => {
          if (!inst || this.disposed) return;
          this.ext = inst;
          this.root.add(inst.root);
        });
    });
  }
  private textures: TextureLibrary | null;
  private disposed = false;
  /** The artist body is in use (its geometry is shared, never disposed here). */
  artist = false;

  private useArtistBody(): void {
    const body = artistBody();
    if (!body) return;
    this.rig.mesh.geometry.dispose();
    this.rig.mesh.geometry = body.geometry;
    this.rig.mesh.material = body.material;
    this.artist = true;
  }

  /** Starts the dodge animation toward a world direction. */
  dodge(dx: number, dz: number): void {
    const l = Math.hypot(dx, dz) || 1;
    const c = Math.cos(this.yaw);
    const sn = Math.sin(this.yaw);
    // World → body frame (x to the body's right… sign as the rig's +x, z forward).
    this.dodgeX = (dx * c - dz * sn) / l;
    this.dodgeZ = (dx * sn + dz * c) / l;
    this.dodgeT = 0;
  }

  /** Flinch from a blow coming along a world direction. */
  hitReact(dx: number, dz: number, strength: number): void {
    const l = Math.hypot(dx, dz) || 1;
    const c = Math.cos(this.yaw);
    const sn = Math.sin(this.yaw);
    this.hitX = (dx * c - dz * sn) / l;
    this.hitZ = (dx * sn + dz * c) / l;
    this.hitAmp = Math.min(1.2, strength);
    this.hitT = 0;
  }

  /** Shows the item that the combat state says is in the hands. */
  private setHeld(itemId: string): void {
    if (itemId === this.heldId) return;
    if (this.item) disposeItemModel(this.item);
    this.item = null;
    this.heldId = itemId;
    if (!itemId) return;
    this.item = buildItemModel(itemId, this.textures);
    const left = itemId === 'bow';
    attachToHand(this.item, this.rig.bones[left ? 'hand.L' : 'hand.R'], left ? 1 : -1);
  }

  /** World position of the bow's nock (third person arrow start). */
  nockWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.item?.nock) return null;
    this.root.updateMatrixWorld(true);
    return this.item.root.localToWorld(out.copy(this.item.nock));
  }

  /** World position of the working end of the held item (or the leading fist). */
  tipWorld(out: THREE.Vector3, hand: 'L' | 'R' = 'R'): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    if (this.item && hand === 'R') return this.item.root.localToWorld(out.copy(this.item.tip));
    return this.rig.bones[`hand.${hand}`].localToWorld(out.set(hand === 'R' ? HAND_GRIP[0] : -HAND_GRIP[0], HAND_GRIP[1], HAND_GRIP[2]));
  }

  /**
   * @param ground terrain height at a world position (for foot placement);
   *               omitted → flat ground at the player's feet.
   */
  update(dt: number, p: PlayerController, firstPerson: boolean, ground?: (x: number, z: number) => number, combat?: CombatController): void {
    const s = p.s;
    this.combat = combat ?? null;
    this.setHeld(combat?.shown ?? '');
    this.time += dt;
    this.root.position.set(s.x, p.visualY, s.z);
    this.root.rotation.y = p.bodyYaw;
    this.yaw = p.bodyYaw;
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
    const stepLen = p.stepLength();
    const mv = this.moveBlend;
    const inv = 1 / Math.max(dt, 1e-3);
    // Turn rate (smoothed; snaps such as respawns ignored) and ground acceleration.
    let dyaw = wrapAngle(p.bodyYaw - this.prevYaw);
    this.prevYaw = p.bodyYaw;
    if (Math.abs(dyaw) > 1.2) dyaw = 0;
    this.yawRate += (dyaw * inv - this.yawRate) * k(10);
    if (dt > 0 && dt < 0.2) this.accel += ((speed - this.prevSpeed) * inv - this.accel) * k(6);
    this.prevSpeed = speed;
    // Landing: a knee-and-hip dip scaled by the fall speed.
    const vy = (p as { vy?: number }).vy ?? 0;
    if (!p.onGround && !p.swimming) this.fallVy = Math.min(this.fallVy, vy);
    else if (this.fallVy < -2.5) {
      this.landT = 0;
      this.landAmp = Math.min(1, -this.fallVy / 9);
      this.fallVy = 0;
    } else this.fallVy = 0;
    if (this.landT < 1) this.landT += dt;
    const landDip = this.landT < 0.6 ? Math.sin(Math.min(1, this.landT / 0.07) * Math.PI * 0.5) * Math.exp(-this.landT * 7) * this.landAmp : 0;
    // Turning on the spot: the feet stay planted while the pelvis and chest follow the body;
    // past ~30° a quick two-step (the foot on the turning side first) brings the feet round.
    if (mv > 0.3 || !p.onGround || p.swimming || this.riding) {
      this.feetYaw = p.bodyYaw;
      this.turnStep = -1;
    }
    let off = wrapAngle(p.bodyYaw - this.feetYaw);
    if (this.turnStep < 0 && Math.abs(off) > 0.5) this.turnStep = 0;
    const stepLift = { 1: 0, [-1]: 0 } as Record<1 | -1, number>;
    if (this.turnStep >= 0) {
      this.turnStep += dt / 0.4;
      const u = Math.min(1, this.turnStep);
      const lead: 1 | -1 = off > 0 ? 1 : -1;
      stepLift[lead] = Math.sin(Math.min(1, u * 2) * Math.PI);
      stepLift[(-lead) as 1 | -1] = Math.sin(Math.max(0, u * 2 - 1) * Math.PI);
      this.feetYaw += off * Math.min(1, (dt / 0.4) * 2.5);
      if (u >= 1) this.turnStep = -1;
      off = wrapAngle(p.bodyYaw - this.feetYaw);
    }

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
    if (this.useClips && clipsReady()) {
      this.poseClips(p, ground, off, landDip, speed, mv);
      this.poseAction(dt, s.pitch);
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
        g = Math.max(-0.35, Math.min(0.45, ground(wx, wz) - p.visualY));
      }
      // Airborne: the feet tuck up (the IK bends the knees).
      legs.push({ side, fz, fy: g + ANKLE_Y + lift * up + stepLift[side] * 0.07 + this.air * 0.16, g, u, stance });
    }
    const phase = cycle * Math.PI * 2;
    // Pelvis: low enough that neither foot (on its ground) is out of reach.
    let hip = HIP_Y;
    for (const l of legs) hip = Math.min(hip, l.g + ANKLE_Y + Math.sqrt(Math.max(0, (LEG * 0.985) ** 2 - l.fz * l.fz)));
    // Vertical bob: lowest at mid-stance loading, highest in the flight phase.
    const bob = -Math.cos(phase * 2) * (0.012 + run * 0.025) * mv;
    // Braking sinks the hips a little (the knees absorb the momentum); landing dips them.
    const brake = Math.min(0.035, Math.max(0, -this.accel) * 0.004) * (p.onGround ? 1 : 0);
    hip += bob - this.crouch * 0.3 - this.air * 0.04 - brake - landDip * 0.15;
    const breathe = Math.sin(this.time * 1.7) * 0.004 * (1 - mv);
    this.pelvis += (hip - this.pelvis) * k(18);
    const sway = Math.sin(phase) * 0.022 * mv * (1 - run * 0.5);
    B.hips.position.y = this.pelvis - JOINTS.root[1] + breathe;
    B.hips.position.x = sway + Math.sin(this.time * 0.35) * 0.006 * (1 - mv);
    // Planted feet while turning on the spot: the legs stay with the feet (pelvis turned back).
    B.hips.rotation.y = Math.sin(phase) * 0.12 * mv - off * 0.85;
    // Banking into turns when moving.
    B.hips.rotation.z = Math.cos(phase) * 0.035 * mv + Math.max(-0.12, Math.min(0.12, -this.yawRate * speed * 0.012));

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
    // Inertia: leaning into acceleration, back against braking.
    const inertia = p.onGround ? Math.max(-0.14, Math.min(0.1, this.accel * 0.025)) : 0;
    const leanTarget = run * 0.22 + this.crouch * 0.35 + mv * 0.04 + inertia;
    this.lean += (leanTarget - this.lean) * k(6);
    B.spine.rotation.x = this.lean * 0.5 + Math.sin(phase * 2) * 0.015 * mv + landDip * 0.25;
    // The torso faces the body direction even while the pelvis stays with planted feet.
    B.spine.rotation.y = off * 0.85;
    B.chest.rotation.x = this.lean * 0.45 + Math.sin(this.time * 1.7) * 0.015 * (1 - mv);
    // Head and chest lead a turn.
    const leadTurn = Math.max(-0.35, Math.min(0.35, this.yawRate * 0.09));
    B.chest.rotation.y = -Math.sin(phase) * (0.14 + run * 0.08) * mv + leadTurn * 0.35;
    B.neck.rotation.x = -this.lean * 0.6 - s.pitch * 0.2;
    // The head follows the aim (camera pitch) and looks into turns.
    B.head.rotation.x = -this.lean * 0.3 + Math.sin(phase * 2) * 0.01 * mv - s.pitch * 0.3 - landDip * 0.15;
    B.head.rotation.y = -B.chest.rotation.y * 0.6 + leadTurn;

    const armAmp = (0.45 + run * 0.6) * mv;
    const elbow = 0.18 + run * 1.15 + this.crouch * 0.4;
    for (const side of [1, -1] as const) {
      const sfx = side > 0 ? '.L' : '.R';
      const ph = side > 0 ? phase : phase + Math.PI;
      const swingA = Math.sin(ph) * armAmp;
      B[`upperArm${sfx}` as BoneName].rotation.x = swingA - this.crouch * 0.3 + this.air * -0.4;
      B[`upperArm${sfx}` as BoneName].rotation.z = side * (0.09 + run * 0.08 + this.air * 0.3 + landDip * 0.3);
      B[`foreArm${sfx}` as BoneName].rotation.x = -(elbow + Math.max(0, -swingA) * 0.5);
      B[`hand${sfx}` as BoneName].rotation.x = -0.1;
    }
    this.poseAction(dt, s.pitch);
    this.finish(dt);
  }

  /**
   * Whole-body pose from the motion-captured clips: idle / walk / jog / sprint
   * blended by the real speed (all locomotion clips share the controller's
   * stride phase, so the feet stay in step with the distance travelled),
   * crouching, the airborne loop, the landing, and punches timed so the
   * clip's hit frame lands on the game's impact. Turning on the spot, banking,
   * aim pitch and the terrain offset are added on top.
   */
  private poseClips(p: PlayerController, ground: ((x: number, z: number) => number) | undefined, off: number, landDip: number, speed: number, mv: number): void {
    const P = (this.poses ??= { idle: newPose(), walk: newPose(), jog: newPose(), sprint: newPose(), crouch: newPose(), crouchMove: newPose(), air: newPose(), land: newPose(), punch: newPose(), out: newPose() });
    const B = this.rig.bones;
    const t = this.time;
    const cyc = p.stride / 2;
    const loopT = (id: ClipId) => t / Math.max(0.1, clipDuration(id));
    sampleClip('Idle_Loop', loopT('Idle_Loop'), true, P.idle);
    sampleClip('Walk_Loop', cyc, true, P.walk);
    sampleClip('Jog_Fwd_Loop', cyc, true, P.jog);
    sampleClip('Sprint_Loop', cyc, true, P.sprint);
    const out = P.out;
    // Walk → jog → sprint by speed, then idle ↔ moving by the move blend.
    const wJog = Math.min(1, Math.max(0, (speed - 1.9) / 1.3));
    const wSprint = Math.min(1, Math.max(0, (speed - 3.8) / 2.2));
    blendPose(P.walk, P.jog, wJog, out);
    blendPose(out, P.sprint, wSprint, out);
    blendPose(out, P.idle, 1 - mv, out);
    if (this.crouch > 0.01) {
      sampleClip('Crouch_Idle_Loop', loopT('Crouch_Idle_Loop'), true, P.crouch);
      sampleClip('Crouch_Fwd_Loop', cyc, true, P.crouchMove);
      blendPose(P.crouch, P.crouchMove, mv, P.crouch);
      blendPose(out, P.crouch, this.crouch, out);
    }
    if (this.air > 0.01) {
      sampleClip('Jump_Loop', loopT('Jump_Loop'), true, P.air);
      blendPose(out, P.air, this.air, out);
    }
    // Landing: the clip's knee bend and recovery, scaled by how hard the fall was.
    const landDur = clipDuration('Jump_Land');
    if (this.landT < landDur && this.landAmp > 0 && landDur > 0) {
      const u = this.landT / landDur;
      sampleClip('Jump_Land', u, false, P.land);
      blendPose(out, P.land, Math.min(1, this.landAmp * 1.4) * (1 - u * u), out);
    }
    // Punches: the motion-captured jab (left) or cross (right).
    const c = this.combat;
    this.clipPunch = false;
    if (c && c.def.kind === 'punch' && (c.phase === 'windup' || c.phase === 'strike' || c.phase === 'recover')) {
      const d = c.def;
      const total = d.windup + d.strike + d.recover;
      const el = c.phase === 'windup' ? c.progress * d.windup : c.phase === 'strike' ? d.windup + c.progress * d.strike : d.windup + d.strike + c.progress * d.recover;
      const hitAt = (d.windup + d.strike * d.impactAt) / total;
      const tn = el / total;
      const id: ClipId = c.hand === 'L' ? 'Punch_Jab' : 'Punch_Cross';
      const imp = clipImpact(id);
      const u = tn < hitAt ? (tn / hitAt) * imp : imp + ((tn - hitAt) / (1 - hitAt)) * (1 - imp);
      sampleClip(id, u, false, P.punch);
      // The legs keep walking when moving; standing still, the whole body punches.
      const ease = Math.min(1, Math.min(tn, 1 - tn) * 8);
      for (const [b, q] of out.rot) if (mv < 0.3 || !(b.startsWith('thigh') || b.startsWith('shin') || b.startsWith('foot') || b.startsWith('toe') || b === 'hips')) q.slerp(P.punch.rot.get(b)!, ease);
      if (mv < 0.3) out.hips.lerp(P.punch.hips, ease);
      this.clipPunch = true;
    }
    for (const [b, q] of out.rot) B[b].quaternion.copy(q);
    // Pelvis: the clip's offset, the terrain under the lower foot, and the landing dip.
    let g = 0;
    if (ground && p.onGround) {
      const cy = Math.cos(p.bodyYaw);
      const sy = Math.sin(p.bodyYaw);
      g = Infinity;
      for (const side of [1, -1]) {
        const lx = JOINTS[side > 0 ? 'foot.L' : 'foot.R'][0];
        g = Math.min(g, ground(p.s.x + lx * cy, p.s.z - lx * sy) - p.visualY);
      }
      g = Math.max(-0.35, Math.min(0.2, g));
    }
    B.hips.position.copy(this.rig.rest.hips).add(out.hips);
    B.hips.position.y += g - landDip * 0.05;
    this.pelvis = HIP_Y + out.hips.y + g;
    // Turning on the spot keeps the feet planted (pelvis turned back, torso with the body);
    // banking into turns when moving; the head follows the aim.
    const yawQ = (a: number) => this.tmpQ.setFromAxisAngle(Y_AXIS, a);
    B.hips.quaternion.premultiply(yawQ(-off * 0.85));
    B.spine.quaternion.premultiply(yawQ(off * 0.85));
    B.hips.quaternion.premultiply(this.tmpQ.setFromAxisAngle(Z_AXIS, Math.max(-0.12, Math.min(0.12, -this.yawRate * speed * 0.012))));
    const lead = Math.max(-0.35, Math.min(0.35, this.yawRate * 0.09));
    B.head.quaternion.premultiply(this.tmpQ.setFromAxisAngle(Y_AXIS, lead));
    B.neck.quaternion.multiply(this.tmpQ.setFromAxisAngle(X_AXIS, -p.s.pitch * 0.2));
    B.head.quaternion.multiply(this.tmpQ.setFromAxisAngle(X_AXIS, -p.s.pitch * 0.3));
  }

  /**
   * Upper body for actions (layered over the gait, so the survivor can
   * strike while walking or running): the same hand keys as the
   * first-person arms, reached with IK, plus the chest twist of the swing.
   */
  private poseAction(dt: number, pitch: number): void {
    const c = this.combat;
    const B = this.rig.bones;
    const k = 1 - Math.exp(-12 * dt);
    let pose: ArmPose = { R: null, L: null, twist: 0, lean: 0 };
    if (c) {
      pose = actionPose(c, c.shown ? actionKindFor(c.shown) : null, false);
      pose = lowerPose(pose, c.lowered, false);
      // Aim with the camera pitch: fully for the bow, partly for strikes.
      const aim = c.def.kind === 'bow' && c.busy ? 0.9 : c.busy ? 0.4 : 0;
      pose = { ...pose, R: pitchKey(pose.R, pitch * aim), L: pitchKey(pose.L, pitch * aim) };
    }
    // The motion-captured punch already moves the arms, chest and hips.
    if (this.clipPunch) pose = { R: null, L: null, twist: 0, lean: 0 };
    this.twist += (pose.twist - this.twist) * k;
    // The swing starts in the hips: the pelvis turns with it while the legs stay planted,
    // then the spine and chest add the rest.
    const hipTurn = this.twist * 0.3;
    B.hips.rotation.y += hipTurn;
    B['thigh.L'].rotation.y -= hipTurn;
    B['thigh.R'].rotation.y -= hipTurn;
    B.chest.rotation.y += this.twist * 0.45;
    B.spine.rotation.y += this.twist * 0.3;
    B.spine.rotation.x += pose.lean;
    // The shoulder of the striking arm comes forward with the chest (+twist turns the chest left: right arm leads).
    const prot = Math.min(0.06, Math.abs(this.twist) * 0.09);
    const lead = this.twist > 0 ? 'R' : 'L';
    B[`upperArm.${lead}`].position.z += prot;
    B[`upperArm.${lead}`].position.x += (lead === 'R' ? 1 : -1) * prot * 0.3;
    this.wR += ((pose.R ? 1 : 0) - this.wR) * k;
    this.wL += ((pose.L ? 1 : 0) - this.wL) * k;
    if (pose.R) this.lastR = pose.R;
    if (pose.L) this.lastL = pose.L;
    if (this.wR < 0.01 && this.wL < 0.01) return;
    this.rig.mesh.updateMatrixWorld(true);
    if (this.lastR) solveArm(this.rig.mesh, B, 'R', this.lastR, this.wR);
    if (this.lastL) solveArm(this.rig.mesh, B, 'L', this.lastL, this.wL);
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
    const B = this.rig.bones;
    // Dodge: a quick, low sidestep — the body drops and leans into the direction,
    // the head stays level with the horizon, arms swing out for balance.
    if (this.dodgeT < 0.5) {
      this.dodgeT += dt;
      const u = Math.min(1, this.dodgeT / 0.45);
      const f = Math.sin(u * Math.PI) * (1 - u * 0.3);
      B.hips.position.y -= 0.16 * f;
      B.hips.rotation.z += -this.dodgeX * 0.28 * f;
      B.hips.rotation.x += this.dodgeZ * 0.25 * f;
      B.spine.rotation.z += -this.dodgeX * 0.22 * f;
      B.spine.rotation.x += (0.18 + this.dodgeZ * 0.2) * f;
      B.chest.rotation.z += -this.dodgeX * 0.12 * f;
      B.head.rotation.z += this.dodgeX * 0.3 * f;
      B.head.rotation.x -= 0.15 * f;
      B['upperArm.L'].rotation.z += 0.5 * f;
      B['upperArm.R'].rotation.z -= 0.5 * f;
    }
    // Hit reaction: a sharp jolt away from the blow, then recovery.
    if (this.hitT < 0.8) {
      this.hitT += dt;
      const t = this.hitT;
      const f = Math.sin(Math.min(1, t / 0.07) * Math.PI * 0.5) * Math.exp(-t * 6) * this.hitAmp;
      B.spine.rotation.x += -this.hitZ * 0.35 * f;
      B.spine.rotation.z += this.hitX * 0.3 * f;
      B.chest.rotation.y += this.hitX * 0.25 * f;
      B.neck.rotation.x += -this.hitZ * 0.3 * f;
      B.head.rotation.z += this.hitX * 0.25 * f;
      B['upperArm.L'].rotation.x -= 0.6 * f;
      B['upperArm.R'].rotation.x -= 0.6 * f;
      B.hips.position.y -= 0.05 * f;
    }
    const it = this.item;
    if (it?.setDraw && this.combat) {
      it.setDraw(this.combat.draw);
      if (it.arrow) it.arrow.visible = this.combat.phase === 'draw' || (this.combat.phase === 'windup' && this.combat.def.kind === 'bow');
    }
    if (it?.flame) {
      const f = 1 + Math.sin(this.time * 23) * 0.08 + Math.sin(this.time * 37) * 0.05;
      it.flame.scale.set(f, f * (1 + Math.sin(this.time * 17) * 0.1), f);
    }
    // The torch lights the world in both camera modes (the body is hidden in first person).
    this.torchLight.visible = this.heldId === 'torch';
    if (this.torchLight.visible) {
      if (this.rig.mesh.visible && it) {
        this.root.updateMatrixWorld(true);
        it.root.localToWorld(this.torchLight.position.set(0, 0.5, 0));
        this.root.worldToLocal(this.torchLight.position);
      } else this.torchLight.position.set(-0.25, 1.5, 0.45);
      this.torchLight.intensity = 25 * (1 + Math.sin(this.time * 19) * 0.06 + Math.sin(this.time * 7.3) * 0.05);
    }
    // Contact shadow follows the pelvis over the ground.
    this.shadow.position.set(this.rig.bones.hips.position.x, 0.03, 0);
    const lift = Math.max(0, this.pelvis - HIP_Y + 0.05);
    (this.shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.max(0.2, 1 - lift * 2) * (1 - this.air * 0.6);
    void this.tmp;
  }

  dispose(): void {
    this.disposed = true;
    if (this.item) disposeItemModel(this.item);
    if (!this.artist) this.rig.mesh.geometry.dispose();
    for (const m of this.materials) {
      this.textures?.unbind(m);
      m.dispose();
    }
    this.shadow.geometry.dispose();
    (this.shadow.material as THREE.Material).dispose();
  }
}
