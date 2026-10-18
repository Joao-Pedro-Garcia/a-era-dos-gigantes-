import { Building, type PieceType } from './building';

/**
 * State of the build screen's placement, independent of rendering and input
 * devices (unit-tested): the selected piece, where it is anchored, how far it
 * was raised or lowered, its rotation and the adjustment step.
 *
 * While nothing was adjusted the preview follows where the player aims; the
 * first nudge anchors it in the world, so it never drifts when the player or
 * camera moves. Placing a piece releases the anchor for the next one.
 */
export type BuildStep = 'fine' | 'normal' | 'fast';
export const BUILD_STEPS: Record<BuildStep, { move: number; lift: number; rot: number }> = {
  fine: { move: 0.1, lift: 0.05, rot: (5 * Math.PI) / 180 },
  normal: { move: 0.5, lift: 0.25, rot: (15 * Math.PI) / 180 },
  fast: { move: 2, lift: 1, rot: (45 * Math.PI) / 180 },
};
const STEP_ORDER: BuildStep[] = ['fine', 'normal', 'fast'];
/** Lift range (m) relative to the piece's natural height; validation decides what is acceptable. */
export const LIFT_RANGE: [number, number] = [-3, 6];
export type NudgeDir = 'forward' | 'back' | 'left' | 'right';

export class BuildController {
  selected: PieceType | null = null;
  /** World position chosen by the player (null = follow the aim). */
  anchor: { x: number; z: number } | null = null;
  lift = 0;
  /** Rotation: relative to the view while following, absolute once anchored. */
  rot = 0;
  /** Absolute rotation at the moment the piece was anchored ("original orientation"). */
  private rot0 = 0;
  step: BuildStep = 'normal';
  snap = true;

  select(type: PieceType): void {
    if (this.selected === type) return;
    this.selected = type;
    this.release();
    this.rot = 0;
  }

  /** Cancels the placement: nothing selected, nothing anchored. */
  cancel(): void {
    this.selected = null;
    this.release();
    this.rot = 0;
  }

  /** After a successful placement: keep the piece, follow the aim again. */
  placed(): void {
    this.release();
  }

  private release(): void {
    if (this.anchor) this.rot = 0;
    this.anchor = null;
    this.lift = 0;
  }

  /** Where the preview goes this frame and its absolute rotation. */
  target(aimX: number, aimZ: number, viewYaw: number): { x: number; z: number; rot: number } {
    if (this.anchor) return { x: this.anchor.x, z: this.anchor.z, rot: this.rot };
    return { x: aimX, z: aimZ, rot: this.rot + viewYaw };
  }

  /** Anchors the preview where it currently is (switching rotation to absolute). */
  private ensureAnchor(cur: { x: number; z: number }, viewYaw: number): void {
    if (this.anchor) return;
    this.anchor = { x: cur.x, z: cur.z };
    this.rot = this.rot + viewYaw;
    this.rot0 = this.rot;
  }

  /** Step used for moving: the precision setting, or a whole grid cell when snapping requires it. */
  moveStep(): number {
    return Math.max(BUILD_STEPS[this.step].move, this.selected ? Building.snapStep(this.selected, this.snap) : 0);
  }

  /** Moves the piece relative to the camera: forward/back along the view, left/right across it. */
  nudge(dir: NudgeDir, cur: { x: number; z: number }, viewYaw: number, times = 1): void {
    if (!this.selected) return;
    this.ensureAnchor(cur, viewYaw);
    const d = this.moveStep() * times;
    const fx = Math.sin(viewYaw);
    const fz = Math.cos(viewYaw);
    const rx = -Math.cos(viewYaw);
    const rz = Math.sin(viewYaw);
    const [ax, az] = dir === 'forward' ? [fx, fz] : dir === 'back' ? [-fx, -fz] : dir === 'right' ? [rx, rz] : [-rx, -rz];
    this.anchor!.x += ax * d;
    this.anchor!.z += az * d;
  }

  /** Raises (+1) or lowers (-1) the piece without moving it horizontally. */
  raise(sign: 1 | -1, cur: { x: number; z: number }, viewYaw: number, times = 1): void {
    if (!this.selected) return;
    this.ensureAnchor(cur, viewYaw);
    const v = this.lift + sign * BUILD_STEPS[this.step].lift * times;
    this.lift = Math.min(LIFT_RANGE[1], Math.max(LIFT_RANGE[0], Math.round(v * 1000) / 1000));
  }

  /** Rotates around the piece's own centre (90° while snapping, else the precision step). */
  rotate(sign: 1 | -1, times = 1): void {
    if (!this.selected) return;
    this.rot += sign * (this.snap ? Math.PI / 2 : BUILD_STEPS[this.step].rot) * times;
  }

  /** Back to the orientation the piece had when it was anchored (or facing the player). */
  resetRotation(): void {
    this.rot = this.anchor ? this.rot0 : 0;
  }

  cycleStep(): BuildStep {
    this.step = STEP_ORDER[(STEP_ORDER.indexOf(this.step) + 1) % STEP_ORDER.length];
    return this.step;
  }
}

/**
 * Press-and-hold repetition for adjustment buttons and keys: one step on the
 * press, then after a short delay a steady stream of steps while held.
 */
export class HoldRepeat {
  private held = new Map<string, { t: number; next: number }>();
  static readonly DELAY = 0.35;
  static readonly RATE = 0.07;

  /** Number of steps to apply this frame for an action. */
  steps(key: string, pressed: boolean, isHeld: boolean, dt: number): number {
    if (pressed) {
      this.held.set(key, { t: 0, next: HoldRepeat.DELAY });
      return 1;
    }
    const h = this.held.get(key);
    if (!isHeld || !h) {
      this.held.delete(key);
      return 0;
    }
    h.t += dt;
    let n = 0;
    // Capped so a long frame never produces a huge jump.
    while (h.t >= h.next && n < 5) {
      n++;
      h.next += HoldRepeat.RATE;
    }
    if (h.t >= h.next) h.next = h.t + HoldRepeat.RATE;
    return n;
  }

  clear(): void {
    this.held.clear();
  }
}
