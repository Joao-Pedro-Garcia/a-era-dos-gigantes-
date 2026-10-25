import { describe, expect, it } from 'vitest';
import { createAnimal } from '../src/animals/animal';
import { SPECIES } from '../src/animals/species';
import { resolveDamage, snareable, weaponKind } from '../src/combat/combat';
import { Rng } from '../src/core/rng';
import { recallSubject } from '../src/ai/memory';
import { ctx, dryPlains, makeWorld, player } from './helpers';

const mk = (id: string) => createAnimal({ id: `c-${id}-${Math.random()}`, speciesId: id, x: 0, z: 0, bornAt: -1e7, groupId: `g${Math.random()}`, rng: new Rng(3) });

describe('combat rules', () => {
  it('armoured species resist damage; piercing weapons partly bypass armour', () => {
    const ank = mk('ankylosaurus');
    const gal = mk('gallimimus');
    expect(resolveDamage(ank, 100, 'cut')).toBeLessThan(resolveDamage(gal, 100, 'cut'));
    expect(resolveDamage(ank, 100, 'pierce')).toBeGreaterThan(resolveDamage(ank, 100, 'cut'));
    expect(resolveDamage(ank, 100, 'shock')).toBe(100);
    expect(weaponKind('metal_spear')).toBe('pierce');
    expect(weaponKind('stone_axe')).toBe('cut');
    expect(weaponKind(null)).toBe('blunt');
  });
  it('snares only hold small ground animals', () => {
    expect(snareable(mk('compsognathus'))).toBe(true);
    expect(snareable(mk('triceratops'))).toBe(false);
    expect(snareable(mk('archaeopteryx'))).toBe(false);
  });
});

describe('reactions to wounds', () => {
  const setup = (speciesId: string, healthFrac: number, courage: number) => {
    const { terrain, env, eco } = makeWorld(12);
    const s = dryPlains(terrain);
    const a = createAnimal({ id: 'w', speciesId, x: s.x, z: s.z, bornAt: env.state.time - 1e7, groupId: 'gw', rng: new Rng(1) });
    a.personality.courage = courage;
    a.personality.aggression = courage;
    eco.animals.set(a.id, a);
    eco.update(0.01, ctx(player(s.x, s.z - 6)));
    a.health = SPECIES[speciesId].health * healthFrac;
    eco.playerAttack(a, 1, s.x, s.z - 6);
    return a;
  };
  it('a brave defender retaliates against the attacker', () => {
    const a = setup('triceratops', 1, 0.9);
    expect(a.state).toBe('defend');
    expect(a.targetId).toBe('__player__');
  });
  it('a badly wounded animal flees instead', () => {
    const a = setup('triceratops', 0.2, 0.9);
    expect(a.state).toBe('flee');
  });
  it('the attack is remembered and lowers trust', () => {
    const a = setup('parasaurolophus', 1, 0.2);
    expect(recallSubject(a, 'injured', 'player', 0)).toBeGreaterThan(0);
    expect(a.trustPlayer).toBeLessThan(0);
  });
  it('a snared animal stays in place', () => {
    const { terrain, env, eco } = makeWorld(13);
    const s = dryPlains(terrain);
    const a = createAnimal({ id: 's', speciesId: 'compsognathus', x: s.x, z: s.z, bornAt: env.state.time - 1e7, groupId: 'gs', rng: new Rng(2) });
    a.heldUntil = env.state.time + 30;
    eco.animals.set(a.id, a);
    for (let i = 0; i < 100; i++) eco.update(0.1, ctx(player(s.x + 3, s.z)));
    expect(Math.hypot(a.x - s.x, a.z - s.z)).toBeLessThan(0.01);
  });
});
