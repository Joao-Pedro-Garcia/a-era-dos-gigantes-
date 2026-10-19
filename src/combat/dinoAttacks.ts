import { angleDiff, clamp } from '../core/math';
import type { DamageKind } from './combat';
import { SPECIES, type SpeciesDef } from '../animals/species';

/**
 * Phased dinosaur attacks: every blow goes through wind-up → strike → recover.
 * Damage is applied once, at the start of the strike window, and only if the
 * target is inside the move's hit area at that moment — so stepping back or
 * dodging during the wind-up really avoids it. Each species has its own set
 * of moves (bite, tail swipe, horn charge, stomp, club, claws, spit…).
 */
export type MoveKind =
  | 'bite' | 'shake' | 'claw' | 'pounce' | 'tail' | 'club' | 'spikes' | 'horns' | 'headbutt'
  | 'stomp' | 'thumb' | 'spit' | 'peck' | 'constrict' | 'roll' | 'roar';

export interface AttackMove {
  kind: MoveKind;
  /** Seconds (for a ~100 kg animal; bigger animals are slower, see timeScale). */
  windup: number;
  strike: number;
  recover: number;
  /** Multiplier on the species' attack range. */
  reach: number;
  /** Half-angle (rad) of the hit area around the attack direction. */
  arc: number;
  /** Where the blow comes from: the head, the tail or the forefeet. */
  from: 'head' | 'tail' | 'feet';
  /** Multiplier on the species' attack damage. */
  dmg: number;
  /** Push (m/s) given to a target of similar size. */
  knock: number;
  damage: DamageKind;
  /** The attacker lunges this many body lengths during the strike. */
  lunge?: number;
  /** Ranged (spit): range in metres, independent of body size. */
  range?: number;
  /** Holds the target in place for this many seconds (constrictors, death roll). */
  hold?: number;
  /** Relative chance of picking the move when it fits. */
  weight: number;
}

const M = (kind: MoveKind, o: Partial<AttackMove>): AttackMove => ({
  kind, windup: 0.45, strike: 0.15, recover: 0.5, reach: 1, arc: 0.6, from: 'head', dmg: 1, knock: 0.6, damage: 'bite', weight: 1, ...o,
});

export const MOVES = {
  bite: M('bite', {}),
  shake: M('shake', { windup: 0.6, strike: 0.2, recover: 0.9, reach: 1, arc: 0.5, dmg: 1.45, knock: 1.4, weight: 0.5 }),
  claw: M('claw', { windup: 0.3, strike: 0.15, recover: 0.4, reach: 0.85, arc: 0.9, dmg: 0.75, knock: 0.4, damage: 'cut' }),
  pounce: M('pounce', { windup: 0.5, strike: 0.25, recover: 0.75, reach: 2.2, arc: 0.45, dmg: 1.35, knock: 1.6, damage: 'cut', lunge: 0.9, weight: 0.6 }),
  tail: M('tail', { windup: 0.7, strike: 0.25, recover: 0.7, reach: 1.1, arc: 1.4, from: 'tail', dmg: 0.9, knock: 2.4, damage: 'blunt', weight: 0.8 }),
  club: M('club', { windup: 0.75, strike: 0.25, recover: 0.8, reach: 1.2, arc: 1.5, from: 'tail', dmg: 1.5, knock: 3.2, damage: 'blunt', weight: 1.4 }),
  spikes: M('spikes', { windup: 0.65, strike: 0.25, recover: 0.75, reach: 1.15, arc: 1.4, from: 'tail', dmg: 1.4, knock: 1.8, damage: 'pierce', weight: 1.4 }),
  horns: M('horns', { windup: 0.8, strike: 0.3, recover: 0.8, reach: 1.6, arc: 0.45, dmg: 1.4, knock: 3, damage: 'pierce', lunge: 0.5, weight: 1.3 }),
  headbutt: M('headbutt', { windup: 0.6, strike: 0.2, recover: 0.6, reach: 1.4, arc: 0.4, dmg: 1.2, knock: 2.6, damage: 'blunt', lunge: 0.45, weight: 1.3 }),
  stomp: M('stomp', { windup: 1, strike: 0.2, recover: 1, reach: 0.75, arc: 1.1, from: 'feet', dmg: 1.5, knock: 3, damage: 'blunt', weight: 1 }),
  thumb: M('thumb', { windup: 0.4, strike: 0.15, recover: 0.5, reach: 0.8, arc: 0.7, dmg: 1.1, knock: 0.8, damage: 'pierce' }),
  spit: M('spit', { windup: 0.7, strike: 0.1, recover: 0.6, reach: 1, arc: 0.3, dmg: 0.35, knock: 0, damage: 'bite', range: 11, weight: 1 }),
  peck: M('peck', { windup: 0.3, strike: 0.12, recover: 0.35, arc: 0.5, dmg: 1, knock: 0.3 }),
  constrict: M('constrict', { windup: 0.5, strike: 0.2, recover: 1.2, arc: 0.6, dmg: 1.2, knock: 0, hold: 2.5, weight: 0.7 }),
  roll: M('roll', { windup: 0.55, strike: 0.3, recover: 1.1, arc: 0.55, dmg: 1.5, knock: 0, hold: 1.8, weight: 0.6 }),
  // Alphas only: a deafening roar that staggers the player, scatters small
  // animals and puts birds to flight (no damage).
  roar: M('roar', { windup: 0.9, strike: 1.2, recover: 0.6, reach: 1, arc: Math.PI, dmg: 0, knock: 0, range: 22, weight: 0.45 }),
} satisfies Record<MoveKind, AttackMove>;

/** The moves of each species (the first one is its basic attack). */
const BY_SPECIES: Record<string, MoveKind[]> = {
  tyrannosaurus: ['bite', 'shake', 'tail'],
  allosaurus: ['bite', 'shake', 'tail'],
  carnotaurus: ['bite', 'headbutt', 'tail'],
  spinosaurus: ['bite', 'claw', 'tail'],
  baryonyx: ['bite', 'claw'],
  velociraptor: ['bite', 'claw', 'pounce'],
  troodon: ['bite', 'claw', 'pounce'],
  dilophosaurus: ['bite', 'spit', 'claw'],
  compsognathus: ['bite'],
  microraptor: ['bite', 'claw'],
  archaeopteryx: ['peck'],
  triceratops: ['horns', 'stomp'],
  pachyrhinosaurus: ['horns', 'stomp'],
  protoceratops: ['bite', 'horns'],
  ankylosaurus: ['club'],
  stegosaurus: ['spikes'],
  brachiosaurus: ['stomp', 'tail'],
  parasaurolophus: ['tail', 'stomp'],
  iguanodon: ['thumb', 'tail'],
  pachycephalosaurus: ['headbutt'],
  gallimimus: ['peck', 'claw'],
  therizinosaurus: ['claw', 'stomp'],
  pteranodon: ['peck'],
  quetzalcoatlus: ['peck'],
  sarcosuchus: ['bite', 'roll', 'tail'],
  deinosuchus: ['bite', 'roll', 'tail'],
  mosasaurus: ['bite', 'shake'],
  megatherium: ['claw', 'stomp'],
  smilodon: ['bite', 'pounce', 'claw'],
  dodo: ['peck'],
  anaconda: ['bite', 'constrict'],
};

export function movesFor(sp: SpeciesDef): AttackMove[] {
  const ids = BY_SPECIES[sp.id] ?? (sp.diet === 'carnivore' || sp.diet === 'piscivore' ? ['bite'] : ['tail']);
  return ids.map((k) => MOVES[k]);
}

/** Bigger animals wind up and recover more slowly (a T. rex ≈1.35×, a raptor ≈1×). */
export function timeScale(massKg: number): number {
  return clamp(0.66 + Math.log10(Math.max(1, massKg)) / 5.8, 0.75, 1.4);
}

export interface ActiveAttack {
  move: AttackMove;
  /** Seconds since the attack started. */
  t: number;
  /** Duration scale for this animal. */
  ts: number;
  /** Damage already resolved (once per attack). */
  resolved: boolean;
  /** The strike connected. */
  landed: boolean;
  /** Direction the attack was aimed at (rad, world heading). */
  aim: number;
}

export type AttackPhase = 'windup' | 'strike' | 'recover' | 'done';

export function phaseOf(at: ActiveAttack): { phase: AttackPhase; u: number } {
  const w = at.move.windup * at.ts;
  const s = at.move.strike * at.ts;
  const r = at.move.recover * at.ts;
  if (at.t < w) return { phase: 'windup', u: at.t / w };
  if (at.t < w + s) return { phase: 'strike', u: (at.t - w) / s };
  if (at.t < w + s + r) return { phase: 'recover', u: (at.t - w - s) / r };
  return { phase: 'done', u: 1 };
}

export function totalTime(at: ActiveAttack): number {
  return (at.move.windup + at.move.strike + at.move.recover) * at.ts;
}

/** Reach (m) of a move from its origin point for an animal at growth scale g. */
export function moveReach(sp: SpeciesDef, move: AttackMove, g: number): number {
  if (move.range) return move.range;
  return sp.attack.range * (0.5 + 0.5 * g) * move.reach + (move.lunge ?? 0) * sp.lengthM * g;
}

/** Origin of the blow in world space: snout, tail tip area or forefeet. */
export function moveOrigin(x: number, z: number, heading: number, sp: SpeciesDef, move: AttackMove, g: number): [number, number] {
  const f = move.from === 'head' ? 0.42 : move.from === 'tail' ? -0.5 : 0.2;
  const d = sp.lengthM * g * f;
  return [x + Math.sin(heading) * d, z + Math.cos(heading) * d];
}

/**
 * Hit test at the start of the strike window: target circle (x, z, radius)
 * against the move's sector. Tail moves sweep around the rear, so their
 * direction is the opposite of the heading.
 */
export function strikeHits(ax: number, az: number, heading: number, sp: SpeciesDef, move: AttackMove, g: number, tx: number, tz: number, tr: number): boolean {
  const [ox, oz] = moveOrigin(ax, az, heading, sp, move, g);
  const reach = moveReach(sp, move, g);
  const d = Math.hypot(tx - ox, tz - oz);
  if (d - tr > reach) return false;
  if (d < tr + 0.3) return true;
  const dir = move.from === 'tail' ? heading + Math.PI : heading;
  // Angle to the target, widened by the target's own size at that distance.
  const ang = Math.abs(angleDiff(Math.atan2(tx - ox, tz - oz), dir));
  return ang <= move.arc + Math.atan2(tr, d);
}

/**
 * Picks the move for this situation: tail moves only when the target is
 * beside or behind, ranged ones only at range, the rest when it is in front
 * and in reach. Returns null when nothing fits (keep approaching).
 */
export function chooseMove(sp: SpeciesDef, g: number, ax: number, az: number, heading: number, tx: number, tz: number, tr: number, rnd: () => number, exclude?: MoveKind, alpha = false): AttackMove | null {
  const fits: AttackMove[] = [];
  const rel = Math.abs(angleDiff(Math.atan2(tx - ax, tz - az), heading));
  const moves = alpha && sp.massKg >= 150 ? [...movesFor(sp), MOVES.roar] : movesFor(sp);
  for (const m of moves) {
    if (m.kind === exclude && moves.length > 1) continue;
    if (m.kind === 'roar') {
      // Roars at a distance, facing the enemy, not every time.
      const d = Math.hypot(tx - ax, tz - az);
      if (d < 6 || d > 22 || rel > 0.8) continue;
      fits.push(m);
      continue;
    }
    const [ox, oz] = moveOrigin(ax, az, heading, sp, m, g);
    const d = Math.hypot(tx - ox, tz - oz) - tr;
    const reach = moveReach(sp, m, g);
    if (m.from === 'tail') {
      if (rel < 1.3 || d > reach * 0.95) continue;
    } else if (m.range) {
      // Spit only when not already in biting distance and roughly facing.
      if (d > reach || d < sp.lengthM * 0.8 || rel > 0.6) continue;
    } else {
      if (rel > 0.9 || d > reach * 0.9) continue;
    }
    fits.push(m);
  }
  if (!fits.length) return null;
  let sum = 0;
  for (const m of fits) sum += m.weight;
  let u = rnd() * sum;
  for (const m of fits) {
    u -= m.weight;
    if (u <= 0) return m;
  }
  return fits[fits.length - 1];
}

/** Body part of an animal hit at a world point (y relative to the ground under it). */
export type BodyRegion = 'head' | 'neck' | 'body' | 'tail' | 'leg';

export const REGION_MUL: Record<BodyRegion, number> = { head: 1.6, neck: 1.25, body: 1, tail: 0.65, leg: 0.85 };

/** Species whose head is armoured (frills, domes, plates): no head bonus. */
const ARMORED_HEAD = new Set(['triceratops', 'pachyrhinosaurus', 'pachycephalosaurus', 'ankylosaurus']);

export function hitRegion(speciesId: string, ax: number, az: number, heading: number, g: number, hx: number, hz: number, hy: number): BodyRegion {
  const sp = SPECIES[speciesId];
  const L = Math.max(0.2, sp.lengthM * g);
  const f = ((hx - ax) * Math.sin(heading) + (hz - az) * Math.cos(heading)) / L;
  const hip = sp.hipHeightM * g;
  if (sp.locomotion.plan === 'serpent') return f > 0.4 ? 'head' : f < -0.3 ? 'tail' : 'body';
  if (f > 0.3) return 'head';
  if (f > 0.17) return 'neck';
  if (f < -0.22) return 'tail';
  if (hy < hip * 0.55 && sp.hipHeightM > 0.5) return 'leg';
  return 'body';
}

export function regionMultiplier(speciesId: string, r: BodyRegion): number {
  if (r === 'head' && ARMORED_HEAD.has(speciesId)) return 1;
  return REGION_MUL[r];
}

/**
 * Push given by a blow: scaled by the attacker/target mass ratio (a T. rex
 * throws a man several metres, a raptor barely moves a triceratops).
 */
export function knockback(move: AttackMove, attackerKg: number, targetKg: number): number {
  if (move.knock <= 0) return 0;
  const ratio = attackerKg / Math.max(1, targetKg);
  return clamp(move.knock * Math.pow(ratio, 0.3), 0, 14);
}
