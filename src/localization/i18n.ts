/** Brazilian Portuguese (default) and English strings. */
export type Lang = 'pt-BR' | 'en';

type Dict = Record<string, string>;

import { ptBR as ptBase } from './pt-BR';
import { en as enBase } from './en';
import { LORE_EN, LORE_PT } from './lore';
import { EXTRA_EN, EXTRA_PT } from './extra';

const pt: Dict = { ...ptBase, ...EXTRA_PT, ...LORE_PT };
const en: Dict = { ...enBase, ...EXTRA_EN, ...LORE_EN };


const DICTS: Record<Lang, Dict> = { 'pt-BR': pt, en };
let current: Lang = 'pt-BR';

export function setLanguage(l: Lang): void {
  current = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l;
}

export function language(): Lang {
  return current;
}

export function t(key: string, params?: Record<string, string | number>): string {
  let s = DICTS[current][key] ?? DICTS['pt-BR'][key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

export function missingKeys(): string[] {
  return Object.keys(pt).filter((k) => !(k in en));
}
