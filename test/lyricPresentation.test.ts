import { describe, expect, it } from 'vitest';

import {
  lyricWordProgress,
  resolveLyricLayout,
  resolveLyricMotion
} from '../src/renderer/src/utils/lyricPresentation';

describe('lyric presentation presets', () => {
  it('falls back safely for settings from older or unknown presets', () => {
    expect(resolveLyricLayout(undefined)).toBe(resolveLyricLayout('centered'));
    expect(resolveLyricMotion('removed')).toBe(resolveLyricMotion('elegant'));
  });
  it('allows layout and motion to be selected independently', () => {
    expect(resolveLyricLayout('reading').align).toBe('left');
    expect(resolveLyricMotion('direct').duration).toBe(0);
  });
  it('tracks word progress and handles seeks and malformed timestamps', () => {
    expect(lyricWordProgress(1, 2, 4)).toBe(0);
    expect(lyricWordProgress(3, 2, 4)).toBe(0.5);
    expect(lyricWordProgress(5, 2, 4)).toBe(1);
    expect(lyricWordProgress(2, 2, 2)).toBe(1);
    expect(lyricWordProgress(NaN, 2, 4)).toBe(0);
  });
});
