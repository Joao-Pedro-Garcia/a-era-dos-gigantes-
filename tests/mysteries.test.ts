import { describe, expect, it } from 'vitest';
import { DOCS, LOG_COUNT, Mysteries, PAINTING_COUNT, createMysteries, sanitizeMysteries } from '../src/mysteries/mysteries';
import { LORE_EN, LORE_PT } from '../src/localization/lore';
import { PLANNED_SITES } from '../src/world/terrain';

describe('mysteries', () => {
  it('every document has text in both languages and sits at a real site', () => {
    for (const d of DOCS) {
      for (const k of ['title', 'body']) {
        expect(LORE_PT[`lore.${d.id}.${k}`], d.id).toBeTruthy();
        expect(LORE_EN[`lore.${d.id}.${k}`], d.id).toBeTruthy();
      }
      expect(PLANNED_SITES.some((s) => s.id === d.site)).toBe(true);
    }
    expect(Object.keys(LORE_PT).sort()).toEqual(Object.keys(LORE_EN).sort());
  });
  it('terminals need one battery the first time', () => {
    const m = new Mysteries(createMysteries());
    let batteries = 1;
    const use = () => (batteries > 0 ? (batteries--, true) : false);
    expect(m.read('outpost_log', false, use)).toBe('needsBattery');
    expect(m.read('outpost_log', true, use)).toBe('read');
    expect(batteries).toBe(0);
    expect(m.read('outpost_log', false, use)).toBe('already');
    expect(m.read('outpost_note', false, use)).toBe('read');
  });
  it('the secret ending needs every log, painting, the core and power', () => {
    const m = new Mysteries(createMysteries());
    expect(m.beaconMissing(false).sort()).toEqual(['core', 'logs', 'paintings', 'power']);
    for (const d of DOCS) m.read(d.id, true, () => true);
    expect(m.logsRead()).toBe(LOG_COUNT);
    expect(m.paintingsSeen()).toBe(PAINTING_COUNT);
    m.d.beaconPowered = true;
    expect(m.beaconMissing(false)).toEqual(['core']);
    expect(m.beaconMissing(true)).toEqual([]);
  });
  it('one-time pickups cannot be taken twice', () => {
    const m = new Mysteries(createMysteries());
    expect(m.take('keycard')).toBe(true);
    expect(m.take('keycard')).toBe(false);
  });
  it('sanitizes saved state', () => {
    const d = sanitizeMysteries({ read: ['outpost_log', 'fake', 7 as never, 'outpost_log'], ending: 'boom' as never, bunkerOpen: 'yes' as never });
    expect(d.read).toEqual(['outpost_log']);
    expect(d.ending).toBeNull();
    expect(d.bunkerOpen).toBe(false);
  });
  it('the radio points only to unvisited stations', () => {
    const all = Mysteries.radioTargets(new Set());
    expect(all.length).toBe(PLANNED_SITES.filter((s) => s.kind !== 'cave').length);
    expect(Mysteries.radioTargets(new Set([all[0].id])).length).toBe(all.length - 1);
  });
});
