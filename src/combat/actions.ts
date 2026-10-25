import { ITEMS } from '../inventory/items';
import type { DamageKind } from './combat';

/**
 * Combat and tool-use actions as a small state machine shared by every
 * input device and both camera modes.
 *
 * An action has phases: wind-up (preparation), strike (the fast part, with
 * the impact frame inside it), recovery and return. The game resolves the
 * hit only when the impact frame is reached, so the animation and the
 * damage can never disagree. Equipping is part of the same machine: the
 * shown item is lowered, swapped and raised, and an attack always uses the
 * item that is actually in the hands.
 */
export type ActionKind = 'punch' | 'chop' | 'mine' | 'slash' | 'thrust' | 'bash' | 'bow' | 'use' | 'drink';

export interface ActionDef {
  kind: ActionKind;
  windup: number;
  strike: number;
  recover: number;
  /** Fraction of the strike phase at which the hit is resolved. */
  impactAt: number;
  /** Horizontal reach from the chest (m). */
  reach: number;
  /** Minimum cosine between the attack direction and the target. */
  arc: number;
  damageKind: DamageKind;
  /** Heavy weapons push harder and sound deeper. */
  heavy: boolean;
  twoHanded: boolean;
}

const D = (kind: ActionKind, windup: number, strike: number, recover: number, reach: number, arc: number, damageKind: DamageKind, heavy = false, twoHanded = false, impactAt = 0.6): ActionDef => ({
  kind, windup, strike, recover, reach, arc, damageKind, heavy, twoHanded, impactAt,
});

export const ACTIONS: Record<ActionKind, ActionDef> = {
  punch: D('punch', 0.11, 0.09, 0.24, 1.55, 0.6, 'blunt'),
  chop: D('chop', 0.3, 0.13, 0.34, 2.3, 0.55, 'cut', true),
  mine: D('mine', 0.36, 0.13, 0.38, 2.3, 0.55, 'pierce', true, true),
  slash: D('slash', 0.1, 0.09, 0.22, 1.75, 0.5, 'cut'),
  thrust: D('thrust', 0.24, 0.1, 0.34, 3.2, 0.82, 'pierce', false, true),
  bash: D('bash', 0.26, 0.12, 0.3, 2.1, 0.55, 'blunt', true),
  // Bow: wind-up is nocking; the draw itself is variable (see BOW_*).
  bow: D('bow', 0.18, 0.06, 0.3, 0, 1, 'arrow', false, true, 0),
  use: D('use', 0.2, 0.1, 0.35, 0, 1, 'blunt', false, false, 0.5),
  drink: D('drink', 0.3, 0.4, 0.3, 0, 1, 'blunt', false, false, 0.5),
};

/** Seconds to reach full draw, minimum draw to release, slowest auto-release for a tap. */
export const BOW_DRAW = 0.7;
export const BOW_MIN = 0.35;

/** Which action an item performs. `null` = bare hands. */
export function actionKindFor(itemId: string | null | undefined): ActionKind {
  if (!itemId) return 'punch';
  if (itemId === 'bow') return 'bow';
  if (itemId.includes('spear')) return 'thrust';
  if (itemId.includes('pickaxe')) return 'mine';
  if (itemId.includes('axe')) return 'chop';
  if (itemId.includes('knife')) return 'slash';
  if (itemId === 'torch' || itemId === 'wooden_club') return 'bash';
  const def = ITEMS[itemId];
  if (def && (def.category === 'weapon' || def.damage)) return 'bash';
  return 'use';
}

/** Items drawn in the hands (everything else is put away and the fists are used). */
export function isHoldable(itemId: string | null | undefined): boolean {
  if (!itemId) return false;
  const def = ITEMS[itemId];
  return !!def && (def.category === 'tool' || def.category === 'weapon');
}

export type Phase = 'idle' | 'lower' | 'raise' | 'windup' | 'strike' | 'recover' | 'draw' | 'release';

export type CombatEvent =
  | { type: 'swing'; def: ActionDef; item: string; hand: 'L' | 'R' }
  | { type: 'impact'; def: ActionDef; item: string; hand: 'L' | 'R'; task: (() => void) | null }
  | { type: 'release'; item: string; draw: number }
  | { type: 'drawStart'; item: string }
  | { type: 'noAmmo' }
  | { type: 'unequip'; item: string }
  | { type: 'equip'; item: string }
  | { type: 'use'; item: string; task: (() => void) | null };

export interface CombatInput {
  /** A new press this frame (any device). */
  pressed: boolean;
  /** The attack button is being held (mouse, touch button or gamepad). */
  held: boolean;
  /** Item the inventory says is in the hands ('' = none). */
  wanted: string;
  /** Bow only: arrows available. */
  hasAmmo: boolean;
}

/** Ignore a second press arriving this soon after an accepted one (touch + synthetic mouse, key bounce). */
export const DEBOUNCE = 0.06;
const LOWER = 0.16;
const RAISE = 0.2;
const BUFFER = 0.25;

/**
 * The per-player action state. Pure logic (no rendering), updated once per
 * frame; returns the events of that frame in order.
 */
export class CombatController {
  /** Item model shown in the hands and used by attacks. */
  shown = '';
  phase: Phase = 'idle';
  /** Time spent in the current phase. */
  t = 0;
  def: ActionDef = ACTIONS.punch;
  hand: 'L' | 'R' = 'R';
  /** Equip lowering amount 0..1 (0 = ready, 1 = out of view). */
  lowered = 0;
  /** Bow draw 0..1. */
  draw = 0;
  /** Time spent at full draw (arm fatigue shake). */
  aimTime = 0;
  private impactDone = false;
  private buffered = 0;
  private bufferedTask: (() => void) | null = null;
  private task: (() => void) | null = null;
  private sinceAccept = 1;
  private autoRelease = false;
  private wanted = '';
  private sinceIdle = 1;
  private lastWall = -1;
  /**
   * Optional wall clock (seconds). In the game, duplicated inputs are also
   * rejected by real time, so a slow frame cannot let a double tap through.
   */
  clock: (() => number) | null = null;
  /** Presses accepted / dropped by the debounce (diagnostics and tests). */
  readonly stats = { accepted: 0, debounced: 0, swings: 0, impacts: 0 };
  /** Last actions that reached their impact frame (diagnostics, tests). */
  readonly history: { kind: ActionKind; item: string; hand: 'L' | 'R' }[] = [];

  get busy(): boolean {
    return this.phase !== 'idle';
  }

  /** Progress 0..1 inside the current phase. */
  get progress(): number {
    const d = this.phaseDuration();
    return d > 0 ? Math.min(1, this.t / d) : 1;
  }

  /** Total duration of a full action (used as the attack cooldown). */
  static duration(def: ActionDef): number {
    return def.windup + def.strike + def.recover;
  }

  private phaseDuration(): number {
    switch (this.phase) {
      case 'lower':
        return LOWER;
      case 'raise':
        return RAISE;
      case 'windup':
        return this.def.windup;
      case 'strike':
        return this.def.strike;
      case 'recover':
        return this.def.recover;
      case 'release':
        return this.def.strike;
      case 'draw':
        return BOW_DRAW;
      default:
        return 0;
    }
  }

  /**
   * Requests an action. `task` replaces the normal hit resolution at the
   * impact frame (used for gathering a specific resource node).
   */
  request(task: (() => void) | null = null): boolean {
    const wall = this.clock?.() ?? 0;
    if (this.sinceAccept < DEBOUNCE || (this.clock && wall - this.lastWall < DEBOUNCE)) {
      this.stats.debounced++;
      return false;
    }
    this.sinceAccept = 0;
    this.lastWall = wall;
    this.stats.accepted++;
    this.buffered = BUFFER;
    this.bufferedTask = task;
    return true;
  }

  /** Cancels whatever is happening (death, mounting, opening a menu). */
  cancel(): void {
    if (this.phase !== 'lower' && this.phase !== 'raise') this.phase = 'idle';
    this.t = 0;
    this.draw = 0;
    this.buffered = 0;
    this.task = null;
  }

  update(dt: number, input: CombatInput): CombatEvent[] {
    const ev: CombatEvent[] = [];
    this.sinceAccept += dt;
    this.sinceIdle += dt;
    if (input.pressed) this.request();
    // A press made while the hands are changing item waits for the new item to be ready.
    if (this.phase !== 'lower' && this.phase !== 'raise' && this.wanted === this.shown) this.buffered = Math.max(0, this.buffered - dt);
    this.wanted = input.wanted;

    // ---- Equip / swap: never strike with an item that is not the one shown.
    if (this.wanted !== this.shown) {
      if (this.phase !== 'lower' && this.phase !== 'raise') {
        // Cancel an action in progress (a swing that has not hit yet does nothing).
        this.phase = this.shown ? 'lower' : 'raise';
        this.t = 0;
        this.draw = 0;
        if (this.shown) ev.push({ type: 'unequip', item: this.shown });
        else {
          this.shown = this.wanted;
          ev.push({ type: 'equip', item: this.shown });
        }
      } else if (this.phase === 'raise') {
        // Changed mind while raising: lower again from the current height.
        const p = this.progress;
        this.phase = 'lower';
        this.t = (1 - p) * LOWER;
        ev.push({ type: 'unequip', item: this.shown });
      }
    }

    this.t += dt;
    switch (this.phase) {
      case 'lower':
        this.lowered = Math.min(1, this.t / LOWER);
        if (this.t >= LOWER) {
          this.shown = this.wanted;
          this.phase = 'raise';
          this.t = 0;
          if (this.shown) ev.push({ type: 'equip', item: this.shown });
        }
        break;
      case 'raise':
        this.lowered = Math.max(0, 1 - this.t / RAISE);
        if (this.t >= RAISE) this.toIdle();
        break;
      case 'idle':
        this.lowered = 0;
        break;
      case 'windup':
        if (this.t >= this.def.windup) {
          if (this.def.kind === 'bow') {
            this.next('draw');
            break;
          }
          this.next('strike');
          this.stats.swings++;
          ev.push({ type: 'swing', def: this.def, item: this.shown, hand: this.hand });
        }
        break;
      case 'strike':
        if (!this.impactDone && this.t >= this.def.strike * this.def.impactAt) {
          this.impactDone = true;
          this.stats.impacts++;
          this.history.push({ kind: this.def.kind, item: this.shown, hand: this.hand });
          if (this.history.length > 20) this.history.shift();
          if (this.def.kind === 'use' || this.def.kind === 'drink') ev.push({ type: 'use', item: this.shown, task: this.task });
          else ev.push({ type: 'impact', def: this.def, item: this.shown, hand: this.hand, task: this.task });
          this.task = null;
        }
        if (this.t >= this.def.strike) this.next('recover');
        break;
      case 'recover':
        if (this.t >= this.def.recover) this.toIdle();
        break;
      case 'draw': {
        this.draw = Math.min(1, this.draw + dt / BOW_DRAW);
        if (this.draw >= 1) this.aimTime += dt;
        const letGo = !input.held || this.autoRelease;
        if (!input.held && this.draw < BOW_MIN) this.autoRelease = true; // a tap still shoots once drawn enough
        if (letGo && this.draw >= (this.autoRelease ? 0.75 : BOW_MIN)) {
          ev.push({ type: 'release', item: this.shown, draw: this.draw });
          this.history.push({ kind: 'bow', item: this.shown, hand: 'R' });
          if (this.history.length > 20) this.history.shift();
          this.next('release');
        }
        break;
      }
      case 'release':
        this.draw = Math.max(0, this.draw - dt * 12);
        if (this.t >= this.def.strike) this.next('recover');
        break;
    }

    // ---- Start a new action (buffered press, or holding the button).
    const canStart = this.phase === 'idle' || (this.phase === 'recover' && this.progress > 0.55 && this.def.kind !== 'bow');
    const wantsStart = this.buffered > 0 || (input.held && this.phase === 'idle');
    if (canStart && wantsStart && this.shown === this.wanted) {
      const kind = actionKindFor(this.shown);
      if (kind === 'bow' && !input.hasAmmo) {
        if (this.buffered > 0) ev.push({ type: 'noAmmo' });
        this.buffered = 0;
      } else {
        // Bare hands alternate left/right; a combo keeps alternating.
        const combo = this.phase === 'recover' || this.sinceIdle < 0.45;
        this.hand = kind === 'punch' && combo && this.hand === 'R' ? 'L' : 'R';
        this.def = ACTIONS[kind];
        this.task = this.buffered > 0 ? this.bufferedTask : null;
        this.buffered = 0;
        this.bufferedTask = null;
        this.impactDone = false;
        this.autoRelease = false;
        this.aimTime = 0;
        this.draw = 0;
        this.next('windup');
        if (kind === 'bow') ev.push({ type: 'drawStart', item: this.shown });
      }
    }
    return ev;
  }

  private next(p: Phase): void {
    this.phase = p;
    this.t = 0;
  }

  private toIdle(): void {
    if (this.phase === 'recover') this.sinceIdle = 0;
    this.phase = 'idle';
    this.t = 0;
    this.lowered = 0;
    this.draw = 0;
  }
}
