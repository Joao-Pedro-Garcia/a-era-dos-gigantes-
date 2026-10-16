import { describe, expect, it } from 'vitest';
import { ACTIONS, BOW_DRAW, CombatController, DEBOUNCE, actionKindFor, isHoldable, type CombatEvent, type CombatInput } from '../src/combat/actions';

const DT = 1 / 60;

/** Runs the controller for `seconds`, collecting events. */
function run(c: CombatController, seconds: number, input: Partial<CombatInput> = {}, firstPress = false): CombatEvent[] {
  const ev: CombatEvent[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) ev.push(...c.update(DT, { pressed: firstPress && i === 0, held: false, wanted: c.shown, hasAmmo: true, ...input, ...(i > 0 && firstPress ? { pressed: false } : {}) }));
  return ev;
}

const types = (ev: CombatEvent[]) => ev.map((e) => e.type);

describe('combat actions', () => {
  it('maps items to actions', () => {
    expect(actionKindFor(null)).toBe('punch');
    expect(actionKindFor('stone_axe')).toBe('chop');
    expect(actionKindFor('metal_pickaxe')).toBe('mine');
    expect(actionKindFor('obsidian_spear')).toBe('thrust');
    expect(actionKindFor('stone_knife')).toBe('slash');
    expect(actionKindFor('wooden_club')).toBe('bash');
    expect(actionKindFor('torch')).toBe('bash');
    expect(actionKindFor('bow')).toBe('bow');
    expect(actionKindFor('spyglass')).toBe('use');
    expect(isHoldable('stone_axe')).toBe(true);
    expect(isHoldable('raw_meat')).toBe(false);
  });

  it('a punch goes through wind-up, strike (one impact) and recovery, then idles', () => {
    const c = new CombatController();
    const ev = run(c, 1, {}, true);
    expect(types(ev)).toEqual(['swing', 'impact']);
    expect(c.phase).toBe('idle');
    const impact = ev.find((e) => e.type === 'impact')!;
    expect(impact.type === 'impact' && impact.def.kind).toBe('punch');
  });

  it('the impact happens at the impact frame, not when the button is pressed', () => {
    const c = new CombatController();
    let t = 0;
    let at = -1;
    c.request();
    for (let i = 0; i < 60; i++) {
      const ev = c.update(DT, { pressed: false, held: false, wanted: '', hasAmmo: true });
      t += DT;
      if (ev.some((e) => e.type === 'impact')) at = t;
    }
    const d = ACTIONS.punch;
    expect(at).toBeGreaterThan(d.windup);
    expect(at).toBeLessThanOrEqual(d.windup + d.strike + DT * 2);
  });

  it('combo punches alternate right and left; a fresh punch starts with the right', () => {
    const c = new CombatController();
    const hands: string[] = [];
    for (let k = 0; k < 4; k++) {
      c.request();
      for (let i = 0; i < 40; i++) for (const e of c.update(DT, { pressed: false, held: false, wanted: '', hasAmmo: true })) if (e.type === 'impact') hands.push(e.hand);
    }
    expect(hands.slice(0, 4)).toEqual(['R', 'L', 'R', 'L']);
    run(c, 2);
    c.request();
    for (let i = 0; i < 40; i++) for (const e of c.update(DT, { pressed: false, held: false, wanted: '', hasAmmo: true })) if (e.type === 'impact') hands.push(e.hand);
    expect(hands[4]).toBe('R');
  });

  it('equipping lowers, swaps and raises; attacks use the item that is shown', () => {
    const c = new CombatController();
    const ev = run(c, 0.6, { wanted: 'stone_axe' });
    expect(types(ev)).toContain('equip');
    expect(c.shown).toBe('stone_axe');
    expect(c.phase).toBe('idle');
    // Swap to the spear and attack immediately: the attack waits for the swap and uses the spear.
    const ev2 = run(c, 1.6, { wanted: 'spear' }, true);
    const impact = ev2.find((e) => e.type === 'impact');
    expect(types(ev2).indexOf('equip')).toBeLessThan(types(ev2).indexOf('impact'));
    expect(impact && impact.type === 'impact' && impact.item).toBe('spear');
    expect(impact && impact.type === 'impact' && impact.def.kind).toBe('thrust');
  });

  it('swapping in the middle of a swing cancels it: no impact with the old item', () => {
    const c = new CombatController();
    run(c, 0.6, { wanted: 'stone_axe' });
    c.request();
    run(c, 0.1, { wanted: 'stone_axe' }); // in the wind-up
    expect(c.phase).toBe('windup');
    const ev = run(c, 1, { wanted: 'stone_pickaxe' });
    expect(ev.some((e) => e.type === 'impact' && e.item === 'stone_axe')).toBe(false);
    expect(c.shown).toBe('stone_pickaxe');
  });

  it('equip/unequip spam settles on the last choice without duplicates', () => {
    const c = new CombatController();
    const seq = ['stone_axe', '', 'spear', 'stone_axe', 'bow', '', 'stone_knife'];
    let equips = 0;
    for (let k = 0; k < 60; k++) {
      const wanted = seq[k % seq.length];
      for (const e of c.update(DT, { pressed: false, held: false, wanted, hasAmmo: true })) if (e.type === 'equip') equips++;
    }
    run(c, 1, { wanted: 'stone_knife' });
    expect(c.shown).toBe('stone_knife');
    expect(c.phase).toBe('idle');
    expect(c.lowered).toBe(0);
    expect(equips).toBeGreaterThan(0);
  });

  it('debounces duplicated presses (touch + synthetic mouse)', () => {
    const c = new CombatController();
    expect(c.request()).toBe(true);
    c.update(DEBOUNCE / 3, { pressed: false, held: false, wanted: '', hasAmmo: true });
    expect(c.request()).toBe(false);
    expect(c.stats.debounced).toBe(1);
    const ev = run(c, 1.2);
    expect(ev.filter((e) => e.type === 'impact')).toHaveLength(1);
  });

  it('holding the button repeats melee attacks at the action rate', () => {
    const c = new CombatController();
    const ev = run(c, 2, { held: true });
    const n = ev.filter((e) => e.type === 'impact').length;
    const per = ACTIONS.punch.windup + ACTIONS.punch.strike + ACTIONS.punch.recover;
    expect(n).toBeGreaterThanOrEqual(Math.floor(2 / per) - 1);
    expect(n).toBeLessThanOrEqual(Math.ceil(2 / per) + 1);
  });

  it('bow: nock, draw while held, release on let-go with the draw strength', () => {
    const c = new CombatController();
    run(c, 0.6, { wanted: 'bow' });
    const ev = run(c, 0.3 + BOW_DRAW, { wanted: 'bow', held: true }, true);
    expect(types(ev)).toContain('drawStart');
    expect(c.phase).toBe('draw');
    expect(c.draw).toBeCloseTo(1, 1);
    const rel = run(c, 0.6, { wanted: 'bow', held: false });
    const r = rel.find((e) => e.type === 'release');
    expect(r && r.type === 'release' && r.draw).toBeGreaterThan(0.95);
    expect(rel.filter((e) => e.type === 'release')).toHaveLength(1);
  });

  it('bow: a quick tap still shoots once drawn enough', () => {
    const c = new CombatController();
    run(c, 0.6, { wanted: 'bow' });
    const ev = run(c, 1.6, { wanted: 'bow' }, true);
    const r = ev.find((e) => e.type === 'release');
    expect(r).toBeTruthy();
    expect(r && r.type === 'release' && r.draw).toBeGreaterThanOrEqual(0.75);
  });

  it('bow without arrows does not draw and reports it', () => {
    const c = new CombatController();
    run(c, 0.6, { wanted: 'bow' });
    const ev = run(c, 0.5, { wanted: 'bow', hasAmmo: false }, true);
    expect(types(ev)).toEqual(['noAmmo']);
    expect(c.phase).toBe('idle');
  });

  it('a queued task replaces the normal hit at the impact frame (gathering)', () => {
    const c = new CombatController();
    run(c, 0.6, { wanted: 'stone_axe' });
    let done = 0;
    c.request(() => done++);
    const ev = run(c, 1, { wanted: 'stone_axe' });
    const imp = ev.find((e) => e.type === 'impact');
    expect(imp && imp.type === 'impact' && !!imp.task).toBe(true);
    if (imp && imp.type === 'impact') imp.task!();
    expect(done).toBe(1);
  });
});

describe('arm IK (first and third person share it)', () => {
  it('places the grip on the key for every action phase that is within reach', async () => {
    const THREE = await import('three');
    const { buildHumanRig } = await import('../src/player/humanModel');
    const { actionPose, solveArm, UPPER_LEN, FORE_LEN } = await import('../src/player/armPose');
    const rig = buildHumanRig([new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]);
    const shoulder = new THREE.Vector3(-0.17, 1.385, -0.005);
    let checked = 0;
    for (const item of ['', 'stone_axe', 'stone_pickaxe', 'spear', 'stone_knife', 'wooden_club']) {
      const c = new CombatController();
      c.shown = item;
      c.def = ACTIONS[actionKindFor(item)];
      for (const [phase, t] of [['idle', 0], ['windup', c.def.windup], ['strike', c.def.strike * c.def.impactAt], ['recover', c.def.recover * 0.5]] as const) {
        c.phase = phase;
        c.t = t;
        const pose = actionPose(c, actionKindFor(item), true);
        if (!pose.R) continue;
        for (const b of Object.values(rig.bones)) b.quaternion.identity();
        rig.mesh.updateMatrixWorld(true);
        solveArm(rig.mesh, rig.bones, 'R', pose.R, 1);
        rig.mesh.updateMatrixWorld(true);
        const grip = rig.bones['hand.R'].localToWorld(new THREE.Vector3(0.02, -0.09, 0));
        const target = new THREE.Vector3(...pose.R.p);
        // Only keys the arm can physically reach must be met exactly.
        if (target.distanceTo(shoulder) < (UPPER_LEN + FORE_LEN) * 0.95) {
          expect(grip.distanceTo(target), `${item || 'fist'} ${phase}`).toBeLessThan(0.02);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(12);
  });
});
