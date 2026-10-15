import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, QUALITY, effectiveQuality, sanitizeSettings } from '../src/core/config';

describe('settings', () => {
  it('offers low, medium, high and ultra profiles in increasing cost', () => {
    const order = ['low', 'medium', 'high', 'ultra'] as const;
    for (let i = 1; i < order.length; i++) {
      expect(QUALITY[order[i]].loadRadius).toBeGreaterThanOrEqual(QUALITY[order[i - 1]].loadRadius);
      expect(QUALITY[order[i]].maxActiveAnimals).toBeGreaterThan(QUALITY[order[i - 1]].maxActiveAnimals);
    }
  });
  it('per-setting overrides replace the profile within safe ranges', () => {
    const q = effectiveQuality('high', { shadows: false, viewDistance: 99, particles: -1, textures: 'low' });
    expect(q.shadows).toBe(false);
    expect(q.loadRadius).toBe(7);
    expect(q.particles).toBe(0);
    expect(q.textures).toBe('low');
    expect(effectiveQuality('low', {})).toEqual(QUALITY.low);
  });
  it('sanitizes stored settings', () => {
    const s = sanitizeSettings({ language: 'xx', quality: 'ultra', mouseSensitivity: 1e9, volume: { master: 3, music: -1 }, uiScale: 'big', evil: true });
    expect(s.language).toBe(DEFAULT_SETTINGS.language);
    expect(s.quality).toBe('ultra');
    expect(s.mouseSensitivity).toBe(5);
    expect(s.volume.master).toBe(1);
    expect(s.volume.music).toBe(0);
    expect(s.uiScale).toBe(1);
    expect('evil' in s).toBe(false);
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
  });
});
