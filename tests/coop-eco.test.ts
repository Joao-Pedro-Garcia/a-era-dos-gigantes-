import { describe, expect, it } from 'vitest';
import { createAnimal } from '../src/animals/animal';
import { SPECIES } from '../src/animals/species';
import { Rng } from '../src/core/rng';
import type { RemotePercept } from '../src/animals/ecosystem';
import { ctx, dryPlains, makeWorld, player } from './helpers';

const DAY = 1200;

function spawn(eco: ReturnType<typeof makeWorld>['eco'], speciesId: string, x: number, z: number, now: number) {
  const sp = SPECIES[speciesId];
  const a = createAnimal({ id: `t-${speciesId}-${Math.random().toString(36).slice(2)}`, speciesId, x, z, bornAt: now - sp.reproduction.maturityDays * DAY * 2, groupId: `g-${Math.random()}`, rng: new Rng(5) });
  a.hunger = 0.1;
  a.thirst = 0.1;
  a.fatigue = 0.1;
  eco.animals.set(a.id, a);
  return a;
}

describe('co-op on the host: animals perceive every player', () => {
  it('an animal defending itself next to a guest strikes the guest, and the blow is routed to that guest', () => {
    const { terrain, env, eco } = makeWorld(21);
    const s = dryPlains(terrain);
    const a = createAnimal({ id: 'atk', speciesId: 'carnotaurus', x: s.x, z: s.z, bornAt: env.state.time - 1e7, groupId: 'ga', rng: new Rng(5) });
    a.personality.courage = 1;
    a.personality.aggression = 1;
    a.heading = 0;
    eco.animals.set(a.id, a);
    // The host is 150 m away; the guest stands 5 m in front of the animal.
    const host = player(s.x - 150, s.z);
    const guest: RemotePercept = { ...player(s.x, s.z + 5, { hostileUntil: 1e12 }), id: 'guest-1' };
    const toGuest: { id: string; amount: number }[] = [];
    let toHost = 0;
    const c = ctx(host, { others: [guest], damageRemote: (id, amount) => toGuest.push({ id, amount }), damagePlayer: () => toHost++ });
    eco.update(0.01, c);
    a.targetId = '__player__';
    eco.brain.setState(a, 'defend');
    for (let i = 0; i < 120 && !toGuest.length; i++) eco.update(0.05, c);
    expect(toGuest.length).toBeGreaterThan(0);
    expect(toGuest[0].id).toBe('guest-1');
    expect(toGuest[0].amount).toBeGreaterThan(0);
    expect(toHost).toBe(0);
  });

  it('keeps animals around a distant guest active (simulated), not only around the host', () => {
    const { terrain, env, eco } = makeWorld(6);
    const s = dryPlains(terrain, 500, 600);
    const far = dryPlains(terrain, s.x + 1500, s.z);
    const now = env.state.time;
    const nearGuest = spawn(eco, 'dodo', far.x + 5, far.z, now);
    const host = player(s.x, s.z);
    eco.update(0.1, ctx(host));
    expect(eco.active.includes(nearGuest)).toBe(false);
    const guest: RemotePercept = { ...player(far.x, far.z), id: 'g' };
    eco.update(0.1, ctx(host, { others: [guest] }));
    expect(eco.active.includes(nearGuest)).toBe(true);
  });
});
