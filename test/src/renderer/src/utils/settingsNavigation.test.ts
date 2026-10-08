import { describe, expect, it } from 'vitest';

import { SETTINGS_SECTIONS } from '../../../../../src/renderer/src/store/settingsStore';

describe('settings navigation', () => {
  it('places Background directly below Lyrics', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.key)).toEqual([
      'appearance',
      'lyrics',
      'background',
      'player',
      'general',
    ]);
  });
});
