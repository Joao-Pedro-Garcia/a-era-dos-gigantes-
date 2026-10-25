/**
 * Practice-based progression: each discipline has its own experience earned
 * by doing related things. Levels grant skill points spent in that
 * discipline's tree. Every skill has a concrete effect read by gameplay code
 * through `Progression.has()` or the numeric helpers below.
 */
export type Tree = 'survival' | 'exploration' | 'crafting' | 'building' | 'combat' | 'tracking' | 'taming' | 'environment';

export const TREES: Tree[] = ['survival', 'exploration', 'crafting', 'building', 'combat', 'tracking', 'taming', 'environment'];

export interface SkillDef {
  id: string;
  tree: Tree;
  /** Discipline level required. */
  level: number;
  /** Unlock flag granted to crafting/building (`skill:<id>`). */
  grantsUnlock?: boolean;
}

export const SKILLS: SkillDef[] = [
  { id: 'efficient_metabolism', tree: 'survival', level: 1 },
  { id: 'thick_skin', tree: 'survival', level: 3 },
  { id: 'field_medic', tree: 'survival', level: 6 },
  { id: 'light_step', tree: 'exploration', level: 1 },
  { id: 'eagle_eye', tree: 'exploration', level: 3 },
  { id: 'climber', tree: 'exploration', level: 6 },
  { id: 'artisan', tree: 'crafting', level: 1 },
  { id: 'thrifty', tree: 'crafting', level: 3 },
  { id: 'metallurgy', tree: 'crafting', level: 5, grantsUnlock: true },
  { id: 'carpenter', tree: 'building', level: 1 },
  { id: 'mason', tree: 'building', level: 3, grantsUnlock: true },
  { id: 'engineer', tree: 'building', level: 6, grantsUnlock: true },
  { id: 'precise_strike', tree: 'combat', level: 1 },
  { id: 'archer', tree: 'combat', level: 3 },
  { id: 'evasion', tree: 'combat', level: 6 },
  { id: 'tracker', tree: 'tracking', level: 1 },
  { id: 'silent', tree: 'tracking', level: 3 },
  { id: 'naturalist', tree: 'tracking', level: 6 },
  { id: 'calm_voice', tree: 'taming', level: 1 },
  { id: 'caretaker', tree: 'taming', level: 3 },
  { id: 'breeder', tree: 'taming', level: 6 },
  { id: 'herbalist', tree: 'environment', level: 1 },
  { id: 'weather_sense', tree: 'environment', level: 3 },
  { id: 'iron_stomach', tree: 'environment', level: 6 },
];

export const SKILL_BY_ID: Record<string, SkillDef> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export const MAX_LEVEL = 10;

/** Total XP needed to reach `level` (level 0 = 0 XP). */
export function xpForLevel(level: number): number {
  return Math.round(40 * Math.pow(level, 1.6));
}

export interface ProgressionData {
  xp: Record<Tree, number>;
  /** Points spent per tree are derived from learned skills. */
  learned: string[];
  /** In-game days survived (for stats and survival XP). */
  daysSurvived: number;
}

export function createProgression(): ProgressionData {
  return { xp: Object.fromEntries(TREES.map((t) => [t, 0])) as Record<Tree, number>, learned: [], daysSurvived: 0 };
}

export class Progression {
  /** Called when a tree levels up: (tree, newLevel). */
  onLevel: (tree: Tree, level: number) => void = () => {};

  constructor(public d: ProgressionData) {}

  level(tree: Tree): number {
    const xp = this.d.xp[tree] ?? 0;
    let l = 0;
    while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
    return l;
  }

  totalLevel(): number {
    return TREES.reduce((s, t) => s + this.level(t), 0);
  }

  /** Unspent skill points in a tree (one per level). */
  points(tree: Tree): number {
    return this.level(tree) - this.d.learned.filter((id) => SKILL_BY_ID[id]?.tree === tree).length;
  }

  gain(tree: Tree, amount: number): void {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    const before = this.level(tree);
    this.d.xp[tree] = Math.min(xpForLevel(MAX_LEVEL) * 2, (this.d.xp[tree] ?? 0) + amount);
    const after = this.level(tree);
    if (after > before) this.onLevel(tree, after);
  }

  has(skill: string): boolean {
    return this.d.learned.includes(skill);
  }

  canLearn(skill: string): boolean {
    const def = SKILL_BY_ID[skill];
    if (!def || this.has(skill)) return false;
    return this.level(def.tree) >= def.level && this.points(def.tree) > 0;
  }

  learn(skill: string): boolean {
    if (!this.canLearn(skill)) return false;
    this.d.learned.push(skill);
    return true;
  }

  /** Unlock flags for crafting/building from learned skills. */
  unlocks(): string[] {
    return this.d.learned.filter((id) => SKILL_BY_ID[id]?.grantsUnlock).map((id) => `skill:${id}`);
  }

  // ---- Numeric effects (single source of truth for skill bonuses) ----
  needsRate(): number { return this.has('efficient_metabolism') ? 0.85 : 1; }
  insulationBonus(): number { return this.has('thick_skin') ? 4 : 0; }
  healMultiplier(): number { return (this.has('field_medic') ? 1.5 : 1) * (this.has('herbalist') ? 1.15 : 1); }
  staminaDrain(): number { return this.has('light_step') ? 0.8 : 1; }
  revealMultiplier(): number { return this.has('eagle_eye') ? 1.6 : 1; }
  slopeLimit(): number { return this.has('climber') ? 1.7 : 1.1; }
  craftTime(): number { return this.has('artisan') ? 0.7 : 1; }
  refundChance(): number { return this.has('thrifty') ? 0.2 : 0; }
  buildCost(): number { return this.has('carpenter') ? 0.8 : 1; }
  meleeDamage(): number { return this.has('precise_strike') ? 1.25 : 1; }
  arrowDamage(): number { return this.has('archer') ? 1.3 : 1; }
  damageTaken(): number { return this.has('evasion') ? 0.85 : 1; }
  noise(): number { return this.has('silent') ? 0.6 : 1; }
  tamingRate(): number { return this.has('calm_voice') ? 1.5 : 1; }
  tamedNeeds(): number { return this.has('caretaker') ? 0.75 : 1; }
  bondRate(): number { return this.has('caretaker') ? 1.5 : 1; }
  incubation(): number { return this.has('breeder') ? 0.6 : 1; }
}

/** Sanitizes loaded progression data. */
export function sanitizeProgression(d: Partial<ProgressionData> | undefined): ProgressionData {
  const out = createProgression();
  if (!d || typeof d !== 'object') return out;
  for (const t of TREES) {
    const v = d.xp?.[t];
    out.xp[t] = Number.isFinite(v) && (v as number) >= 0 ? Math.min(v as number, xpForLevel(MAX_LEVEL) * 2) : 0;
  }
  const p = new Progression(out);
  for (const id of Array.isArray(d.learned) ? d.learned : []) if (typeof id === 'string') p.learn(id);
  out.daysSurvived = Number.isFinite(d.daysSurvived) ? Math.max(0, Math.floor(d.daysSurvived!)) : 0;
  return out;
}
