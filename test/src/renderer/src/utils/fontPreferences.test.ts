import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearSavedFont, getEffectiveLyricsFontName, getSavedFontForScope, saveFont,
} from '../../../../../src/renderer/src/utils/fontLoader';

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('scoped font preferences', () => {
  it('saves interface and lyric fonts independently', () => {
    saveFont('Noto Sans SC', 'global');
    expect(getEffectiveLyricsFontName()).toBe('Noto Sans SC');
    saveFont('Ma Shan Zheng', 'lyrics');
    expect(getEffectiveLyricsFontName()).toBe('Ma Shan Zheng');
    expect(getSavedFontForScope('global')).toBe('Noto Sans SC');
    expect(getSavedFontForScope('lyrics')).toBe('Ma Shan Zheng');
    clearSavedFont('lyrics');
    expect(getEffectiveLyricsFontName()).toBe('Noto Sans SC');
    expect(getSavedFontForScope('global')).toBe('Noto Sans SC');
    expect(getSavedFontForScope('lyrics')).toBe('');
  });

  it('migrates the old single font selection when the other scope is edited', () => {
    values.set('lumina_fontFamily', 'Noto Sans SC');
    values.set('lumina_fontScope', 'global');
    expect(getSavedFontForScope('global')).toBe('Noto Sans SC');
    saveFont('Ma Shan Zheng', 'lyrics');
    expect(getSavedFontForScope('global')).toBe('Noto Sans SC');
    expect(getSavedFontForScope('lyrics')).toBe('Ma Shan Zheng');
    expect(values.has('lumina_fontFamily')).toBe(false);
  });

  it('uses a legacy lyric font until the scoped preference is written', () => {
    values.set('lumina_fontFamily', 'Ma Shan Zheng');
    values.set('lumina_fontScope', 'lyrics');
    expect(getEffectiveLyricsFontName()).toBe('Ma Shan Zheng');
    saveFont('Noto Sans SC', 'global');
    expect(getEffectiveLyricsFontName()).toBe('Ma Shan Zheng');
  });
});
