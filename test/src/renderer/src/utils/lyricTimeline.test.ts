import { describe, expect, it } from 'vitest';
import { activeLyricIndex } from '../../../../../src/renderer/src/utils/lyricTimeline';

describe('plain lyric timeline', () => {
  const lines = [{ start: 5 }, { start: 10 }, { start: 10 }, { start: 25 }];
  it('keeps the previous sentence during gaps instead of jumping back to line zero', () => {
    expect(activeLyricIndex(lines, 23)).toBe(2);
  });
  it('handles backward seeks, repeated timestamps, and the first and last sentence', () => {
    expect(activeLyricIndex(lines, 30)).toBe(3);
    expect(activeLyricIndex(lines, 7)).toBe(0);
    expect(activeLyricIndex(lines, 10)).toBe(2);
    expect(activeLyricIndex(lines, 0)).toBe(0);
    expect(activeLyricIndex([], 10)).toBe(-1);
  });
});
