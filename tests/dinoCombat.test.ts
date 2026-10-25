import { describe, expect, it } from 'vitest';
import { createAnimal } from '../src/animals/animal';
import { SPECIES } from '../src/animals/species';
import { Rng } from '../src/core/rng';
import { MOVES, chooseMove, hitRegion, knockback, movesFor, phaseOf, regionMultiplier, strikeHits, timeScale } from '../src/combat/dinoAttacks';
import { ctx, dryPlains, makeWorld, player } from './helpers';

describe('dinosaur attack moves', () => {
  it('every species has at least one move, all with wind-up, strike and recovery', () => {
    for (const sp of Object.values(SPECIES)) {
      const moves = movesFor(sp);
      expect(moves.length, sp.id).toBeGreaterThan(0);
      for (const m of moves) {
        expect(m.windup).toBeGreaterThan(0);
        expect(m.strike).toBeGreaterThan(0);
        expect(m.recover).toBeGreaterThan(0);
      }
    }
  });

  it('species fight with their own weapons', () => {
    const kinds = (id: string) => movesFor(SPECIES[id]).map((m) => m.kind);
    expect(kinds('tyrannosaurus')).toContain('bite');
    expect(kinds('ankylosaurus')).toEqual(['club']);
    expect(kinds('stegosaurus')).toEqual(['spikes']);
    expect(kinds('triceratops')).toContain('horns');
    expect(kinds('brachiosaurus')).toContain('stomp');
    expect(kinds('dilophosaurus')).toContain('spit');
    expect(kinds('pachycephalosaurus')).toEqual(['headbutt']);
    expect(kinds('anaconda')).toContain('constrict');
  });

  it('phases run in order and big animals are slower', () => {
    const at = { move: MOVES.bite, t: 0, ts: 1, resolved: false, landed: false, aim: 0 };
    expect(phaseOf(at).phase).toBe('windup');
    at.t = MOVES.bite.windup + 0.01;
    expect(phaseOf(at).phase).toBe('strike');
    at.t = MOVES.bite.windup + MOVES.bite.strike + 0.01;
    expect(phaseOf(at).phase).toBe('recover');
    at.t = 99;
    expect(phaseOf(at).phase).toBe('done');
    expect(timeScale(8000)).toBeGreaterThan(timeScale(70));
  });

  it('the hit area is real: a bite hits in front, misses behind; a tail swipe hits behind', () => {
    const rex = SPECIES.tyrannosaurus;
    // Facing +z (heading 0).
    expect(strikeHits(0, 0, 0, rex, MOVES.bite, 1, 0, 9, 0.4)).toBe(true);
    expect(strikeHits(0, 0, 0, rex, MOVES.bite, 1, 0, -9, 0.4)).toBe(false);
    expect(strikeHits(0, 0, 0, rex, MOVES.bite, 1, 0, 30, 0.4)).toBe(false);
    expect(strikeHits(0, 0, 0, rex, MOVES.tail, 1, 1, -9, 0.4)).toBe(true);
  });

  it('tail fighters only swing at what is beside or behind them; spit only at range', () => {
    const ank = SPECIES.ankylosaurus;
    const r = () => 0.5;
    expect(chooseMove(ank, 1, 0, 0, 0, 0, 4, 0.4, r)).toBeNull();
    expect(chooseMove(ank, 1, 0, 0, 0, 0, -5, 0.4, r)?.kind).toBe('club');
    const dilo = SPECIES.dilophosaurus;
    const far = chooseMove(dilo, 1, 0, 0, 0, 0, 9, 0.4, () => 0.99);
    expect(far?.kind).toBe('spit');
  });

  it('body regions: the head takes more damage than the tail, armoured heads do not', () => {
    // Velociraptor facing +z: snout end is the head, the far end the tail.
    const L = SPECIES.velociraptor.lengthM;
    expect(hitRegion('velociraptor', 0, 0, 0, 1, 0, L * 0.45, 0.8)).toBe('head');
    expect(hitRegion('velociraptor', 0, 0, 0, 1, 0, -L * 0.4, 0.8)).toBe('tail');
    expect(hitRegion('velociraptor', 0, 0, 0, 1, 0.2, 0, 0.2)).toBe('leg');
    expect(regionMultiplier('velociraptor', 'head')).toBeGreaterThan(regionMultiplier('velociraptor', 'tail'));
    expect(regionMultiplier('triceratops', 'head')).toBe(1);
  });

  it('knockback scales with the size difference', () => {
    expect(knockback(MOVES.tail, 7000, 80)).toBeGreaterThan(knockback(MOVES.tail, 300, 80));
    expect(knockback(MOVES.constrict, 7000, 80)).toBe(0);
  });
});

describe('attacks in the simulation', () => {
  const fight = (speciesId: string, dist: number, dodging = false) => {
    const { terrain, env, eco } = makeWorld(21);
    const s = dryPlains(terrain);
    const a = createAnimal({ id: 'atk', speciesId, x: s.x, z: s.z, bornAt: env.state.time - 1e7, groupId: 'ga', rng: new Rng(5) });
    a.personality.courage = 1;
    a.personality.aggression = 1;
    a.heading = 0;
    eco.animals.set(a.id, a);
    const hits: number[] = [];
    let evaded = 0;
    const p = player(s.x, s.z + dist, { dodging, hostileUntil: 1e12 });
    const c = ctx(p, { damagePlayer: (amt) => hits.push(amt), playerEvaded: () => evaded++ });
    eco.update(0.01, c);
    a.targetId = '__player__';
    eco.brain.setState(a, 'defend');
    const phases: string[] = [];
    let firstHitAt = -1;
    for (let i = 0; i < 120; i++) {
      eco.update(0.05, c);
      const st = eco.brain.attackState(a);
      if (st && phases[phases.length - 1] !== st.phase) phases.push(st.phase);
      if (hits.length && firstHitAt < 0) firstHitAt = i * 0.05;
    }
    return { hits, phases, evaded, firstHitAt, a, eco, env };
  };

  it('damage arrives after the wind-up, not on contact', () => {
    const r = fight('carnotaurus', 5);
    expect(r.phases.slice(0, 3)).toEqual(['windup', 'strike', 'recover']);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.firstHitAt).toBeGreaterThanOrEqual(0.3);
  });

  it('a dodging player is not hit and gets a counter-attack window', () => {
    const r = fight('carnotaurus', 5, true);
    expect(r.hits.length).toBe(0);
    expect(r.evaded).toBeGreaterThan(0);
  });

  it('a blow during the wind-up interrupts the attack', () => {
    const { terrain, env, eco } = makeWorld(22);
    const s = dryPlains(terrain);
    const a = createAnimal({ id: 'int', speciesId: 'carnotaurus', x: s.x, z: s.z, bornAt: env.state.time - 1e7, groupId: 'gi', rng: new Rng(6) });
    a.personality.courage = 1;
    a.personality.aggression = 1;
    a.heading = 0;
    eco.animals.set(a.id, a);
    const c = ctx(player(s.x, s.z + 5, { hostileUntil: 1e12 }));
    eco.update(0.01, c);
    a.targetId = '__player__';
    eco.brain.setState(a, 'defend');
    let interrupted = false;
    for (let i = 0; i < 60 && !interrupted; i++) {
      eco.update(0.05, c);
      if (eco.brain.attackState(a)?.phase === 'windup') interrupted = eco.brain.interruptAttack(a, env.state.time, 1);
    }
    expect(interrupted).toBe(true);
    expect(eco.brain.attackState(a)).toBeNull();
  });
});
