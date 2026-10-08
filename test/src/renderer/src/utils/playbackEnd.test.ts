import { describe, expect, it } from 'vitest';
import { getPlaybackEndBehavior } from '../../../../../src/renderer/src/utils/playbackEnd';

describe('playback completion', () => {
  it.each([false, true])('advances after a trial with repeat-one=%s', repeatOne => {
    expect(getPlaybackEndBehavior(true, 30, 240, repeatOne)).toBe('advance');
    expect(getPlaybackEndBehavior(true, 30, 30, repeatOne)).toBe('advance');
  });
  it('retains recovery for interrupted full tracks', () => {
    expect(getPlaybackEndBehavior(false, 30, 240, false)).toBe('recover');
  });
  it('retains normal full-track completion and repeat behavior', () => {
    expect(getPlaybackEndBehavior(false, 240, 240, false)).toBe('advance');
    expect(getPlaybackEndBehavior(false, 240, 240, true)).toBe('repeat');
  });
});