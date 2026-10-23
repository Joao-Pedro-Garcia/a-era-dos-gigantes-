import { describe, expect, it } from 'vitest';
import { language, missingKeys, setLanguage, t } from '../src/localization/i18n';
import { SKILLS, TREES } from '../src/progression/skills';
import { PIECES } from '../src/building/building';
import { ITEMS } from '../src/inventory/items';
import { RECIPES } from '../src/crafting/recipes';
import { SPECIES } from '../src/animals/species';
import { BIOMES } from '../src/world/biomes';
import { PLANNED_SITES } from '../src/world/terrain';
import { DEFAULT_KEYS } from '../src/input/input';

const families = (): string[] => {
  const keys: string[] = [];
  for (const s of SKILLS) keys.push(`skill.${s.id}.name`, `skill.${s.id}.desc`);
  for (const tr of TREES) keys.push(`tree.${tr}`, `tree.${tr}.how`);
  for (const p of Object.keys(PIECES)) keys.push(`piece.${p}`);
  for (const p of Object.values(PIECES)) if (p.unlock) keys.push(`unlock.${p.unlock}`);
  for (const i of Object.keys(ITEMS)) keys.push(`item.${i}`);
  for (const r of RECIPES) {
    keys.push(`cat.${r.category}`, `station.${r.station}`);
    if (r.unlock) keys.push(`unlock.${r.unlock}`);
  }
  for (const sp of Object.values(SPECIES)) keys.push(`social.${sp.social.type}`, `activity.${sp.activity}`, `threat.${sp.threat.response}`, `diet.${sp.diet}`);
  for (const b of Object.keys(BIOMES)) keys.push(`biome.${b}`);
  for (const s of PLANNED_SITES) keys.push(`site.${s.id}`);
  for (const a of Object.keys(DEFAULT_KEYS)) keys.push(`action.${a}`);
  for (const c of ['follow', 'stay', 'roam', 'guard']) keys.push(`tame.cmd.${c}`);
  for (const m of ['feeding', 'observation', 'imprint', 'none']) keys.push(`tame.method.${m}`);
  for (const u of ['companion', 'mount', 'guard', 'pack', 'gatherer', 'scout']) keys.push(`tame.use.${u}`);
  for (const r of ['notHungry', 'scared', 'wrongFood', 'tooSoon', 'untameable', 'imprintOnly']) keys.push(`tame.result.${r}`);
  for (const e of ['notObject', 'future', 'structure', 'checksum', 'json']) keys.push(`save.error.${e}`);
  for (const q of ['auto', 'low', 'medium', 'high', 'ultra']) keys.push(`quality.${q}`);
  for (const s of ['general', 'graphics', 'audio', 'access']) keys.push(`settings.tab.${s}`);
  for (const s of ['idle', 'wander', 'graze', 'drink', 'rest', 'follow', 'alert', 'investigate', 'flee', 'hunt', 'eat', 'defend', 'shelter', 'nest', 'ridden']) keys.push(`ai.${s}`);
  for (const m of ['logs', 'paintings', 'core', 'power']) keys.push(`mystery.missing.${m}`);
  return keys;
};

describe('localization', () => {
  it('every Portuguese key exists in English', () => {
    expect(missingKeys()).toEqual([]);
  });
  it('every dynamically built key resolves in both languages', () => {
    for (const lang of ['pt-BR', 'en'] as const) {
      setLanguage(lang);
      const missing = families().filter((k) => t(k) === k);
      expect(missing, lang).toEqual([]);
    }
    setLanguage('pt-BR');
  });
  it('switching language changes the text and parameters are filled', () => {
    setLanguage('en');
    expect(language()).toBe('en');
    expect(t('menu.continue')).toBe('Continue');
    expect(t('hud.day', { d: 3 })).toBe('Day 3');
    setLanguage('pt-BR');
    expect(t('menu.continue')).toBe('Continuar');
    expect(t('hud.day', { d: 3 })).toBe('Dia 3');
  });
});
