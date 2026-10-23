import { describe, expect, it } from 'vitest';
import { matches, normalize } from '../src/ui/search';

describe('item menu search', () => {
  it('ignores case and accents', () => {
    expect(normalize('  Poção de CURA ')).toBe('pocao de cura');
    expect(matches('pocao', 'Poção de cura')).toBe(true);
    expect(matches('MACHADO', 'Machado de pedra')).toBe(true);
  });

  it('an empty query matches everything', () => {
    expect(matches('', 'qualquer')).toBe(true);
    expect(matches('   ', 'qualquer')).toBe(true);
  });

  it('every word must appear, in any field and any order', () => {
    expect(matches('pedra machado', 'Machado de pedra', 'Ferramenta')).toBe(true);
    expect(matches('pedra ferr', 'Machado de pedra', 'Ferramenta')).toBe(true);
    expect(matches('pedra metal', 'Machado de pedra', 'Ferramenta')).toBe(false);
  });
});
