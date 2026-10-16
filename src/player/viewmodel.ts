import * as THREE from 'three';
import { actionKindFor, type CombatController } from '../combat/actions';
import type { TextureLibrary } from '../graphics/textureLibrary';
import { FP_DRAW, actionPose, lowerPose, solveArm, type ArmPose, type HandKey } from './armPose';
import { buildArmsGeometry, buildHumanRig, type BoneName, type HumanRig } from './humanModel';
import { attachToHand, buildItemModel, disposeItemModel, type ItemModel } from './itemModels';

/**
 * First-person arms ("viewmodel"): the survivor's own forearms, hands and
 * the held item, drawn in a separate pass after the world with the depth
 * buffer cleared, from a camera that follows the player's view. They can
 * never clip into walls, trees or animals, and keep a fixed field of view so
 * they do not stretch when the world camera changes FOV.
 *
 * The arms are the same skinned surfaces as the third-person body (see
 * humanModel.buildArmsGeometry) and are posed by the same action keys and
 * IK (armPose.ts), so what the player sees in first person is what the body
 * does in third person.
 */
/** Where the view camera sits in body space (a little low and back, so the hands sit in view). */
const EYE = new THREE.Vector3(0, 1.56, -0.12);
/** First-person offset of the hand keys (raised and pushed forward into the view). */
const FP_OFFSET: [number, number, number] = [0.0, 0.12, 0.04];

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.01, 20);
  private anchor = new THREE.Group();
  private rig: HumanRig;
  private materials: THREE.MeshStandardMaterial[];
  private item: ItemModel | null = null;
  private itemId = '';
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4030, 0.5);
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private wR = 0;
  private wL = 0;
  private lastR: HandKey | null = null;
  private lastL: HandKey | null = null;
  private time = 0;
  private idle = 10;
  visible = false;

  constructor(private textures: TextureLibrary | null) {
    const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 });
    const cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    if (textures) {
      textures.bind(skin, 'skin');
      textures.bind(cloth, 'cloth');
    }
    this.materials = [skin, cloth];
    this.rig = buildHumanRig(this.materials, buildArmsGeometry());
    this.rig.mesh.castShadow = false;
    this.rig.mesh.receiveShadow = false;
    // Body faces +Z; the camera looks along −Z: turn the body around and put the eye at the camera.
    this.rig.mesh.rotation.y = Math.PI;
    this.rig.mesh.position.set(EYE.x, -EYE.y, EYE.z);
    this.anchor.add(this.rig.mesh);
    this.camera.add(this.anchor);
    this.scene.add(this.camera, this.sun, this.sun.target, this.hemi);
  }

  setItem(id: string): void {
    if (id === this.itemId) return;
    if (this.item) disposeItemModel(this.item);
    this.item = null;
    this.itemId = id;
    if (!id) return;
    this.item = buildItemModel(id, this.textures);
    this.item.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = false;
    });
    const left = id === 'bow';
    attachToHand(this.item, this.rig.bones[left ? 'hand.L' : 'hand.R'], left ? 1 : -1);
  }

  /**
   * @param look look delta this frame (radians) for weapon sway
   * @param speed horizontal speed (m/s) and @param stride gait phase for the walking bob
   */
  update(dt: number, main: THREE.PerspectiveCamera, c: CombatController, look: { x: number; y: number }, speed: number, stride: number, light: { dir: THREE.Vector3; color: THREE.Color; intensity: number; sky: THREE.Color; ground: THREE.Color; hemi: number; env: THREE.Texture | null }): void {
    this.time += dt;
    this.camera.position.copy(main.position);
    this.camera.quaternion.copy(main.quaternion);
    const aspect = main.aspect;
    if (this.camera.aspect !== aspect) {
      this.camera.aspect = aspect;
      this.camera.fov = aspect < 1 ? 70 : 58;
      this.camera.updateProjectionMatrix();
    }
    // Lighting follows the world's sun and sky.
    this.sun.position.copy(main.position).addScaledVector(light.dir, 10);
    this.sun.target.position.copy(main.position);
    this.sun.color.copy(light.color);
    this.sun.intensity = light.intensity * 0.85;
    this.hemi.color.copy(light.sky);
    this.hemi.groundColor.copy(light.ground);
    this.hemi.intensity = light.hemi;
    this.scene.environment = light.env;

    // Sway: the arms lag behind fast turns; walking bobs them.
    const k = 1 - Math.exp(-10 * dt);
    this.swayX += (THREE.MathUtils.clamp(-look.x * 0.6, -0.05, 0.05) - this.swayX) * k;
    this.swayY += (THREE.MathUtils.clamp(look.y * 0.6, -0.04, 0.04) - this.swayY) * k;
    this.bobAmp += (Math.min(1, speed / 5) - this.bobAmp) * k;
    this.bobPhase = stride * Math.PI;
    const bob = this.bobAmp * (c.busy ? 0.35 : 1);
    this.anchor.position.set(this.swayX + Math.sin(this.bobPhase) * 0.012 * bob, this.swayY - Math.abs(Math.cos(this.bobPhase)) * 0.014 * bob + Math.sin(this.time * 1.6) * 0.002, 0);
    this.anchor.rotation.z = this.swayX * 0.8;
    this.anchor.rotation.x = 0;

    this.setItem(c.shown);
    const holding = c.shown ? actionKindFor(c.shown) : 'punch';
    let pose: ArmPose = actionPose(c, holding, true);
    // Bare hands: the fists come up to fight and go down again after a few quiet seconds.
    this.idle = c.shown || c.busy ? 0 : this.idle + dt;
    if (!c.shown && this.idle > 2.5) pose = { ...pose, R: null, L: null };
    pose = lowerPose(pose, c.lowered, true);
    this.apply(pose, dt);
    if (this.item?.setDraw) {
      this.item.setDraw(c.draw * FP_DRAW);
      if (this.item.arrow) this.item.arrow.visible = c.phase === 'draw' || (c.phase === 'windup' && c.def.kind === 'bow');
    }
    if (this.item?.flame) {
      const f = 1 + Math.sin(this.time * 23) * 0.08 + Math.sin(this.time * 37) * 0.05;
      this.item.flame.scale.set(f, f * (1 + Math.sin(this.time * 17) * 0.1), f);
    }
  }

  private apply(pose: ArmPose, dt: number): void {
    const B = this.rig.bones;
    for (const name of Object.keys(B) as BoneName[]) {
      B[name].position.copy(this.rig.rest[name]);
      B[name].quaternion.identity();
    }
    // Arms hang by default (out of view below the camera).
    B['upperArm.L'].rotation.z = 0.1;
    B['upperArm.R'].rotation.z = -0.1;
    const k = 1 - Math.exp(-14 * dt);
    this.wR += ((pose.R ? 1 : 0) - this.wR) * k;
    this.wL += ((pose.L ? 1 : 0) - this.wL) * k;
    if (pose.R) this.lastR = pose.R;
    if (pose.L) this.lastL = pose.L;
    this.rig.mesh.updateMatrixWorld(true);
    const off = (key: HandKey): HandKey => ({ ...key, p: [key.p[0] + FP_OFFSET[0], key.p[1] + FP_OFFSET[1], key.p[2] + FP_OFFSET[2]] });
    if (this.lastR) solveArm(this.rig.mesh, B, 'R', off(this.lastR), this.wR);
    if (this.lastL) solveArm(this.rig.mesh, B, 'L', off(this.lastL), this.wL);
    // Arms fully out of view are not drawn.
    this.rig.mesh.visible = this.wR > 0.02 || this.wL > 0.02;
  }

  /** Impact jolt (the arms recoil a little on contact). */
  kick(amount: number): void {
    this.anchor.position.z += amount * 0.5;
    this.anchor.rotation.x += amount * 0.6;
  }

  /** World position of the arrow's nock (where a released arrow starts). */
  nockWorld(out: THREE.Vector3): THREE.Vector3 | null {
    if (!this.item?.nock) return null;
    this.scene.updateMatrixWorld(true);
    return this.item.root.localToWorld(out.copy(this.item.nock));
  }

  render(renderer: THREE.WebGLRenderer): void {
    if (!this.visible || !this.rig.mesh.visible) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }

  dispose(): void {
    if (this.item) disposeItemModel(this.item);
    this.rig.mesh.geometry.dispose();
    for (const m of this.materials) {
      this.textures?.unbind(m);
      m.dispose();
    }
  }
}
