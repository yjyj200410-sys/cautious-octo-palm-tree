import { describe, expect, it } from 'vitest';

import type { NcmSong } from '../../../../../src/renderer/src/ncm/types';
import { matchesLibrarySearch } from '../../../../../src/renderer/src/utils/librarySearch';

const song = {
  title: '夜曲 Live',
  artists: [{ name: '周杰伦' }, { name: 'Guest Singer' }],
  album: { name: '十一月的萧邦' }
} as NcmSong;

describe('playlist search', () => {
  it('matches multi-term queries across title and every participating artist', () => {
    expect(matchesLibrarySearch(song, '夜曲 guest')).toBe(true);
    expect(matchesLibrarySearch(song, '周杰伦 萧邦')).toBe(true);
    expect(matchesLibrarySearch(song, '夜曲 unknown')).toBe(false);
  });
  it('normalizes full width, case and whitespace without treating text as a regex', () => {
    expect(matchesLibrarySearch(song, '  ＬＩＶＥ　ＧＵＥＳＴ ')).toBe(true);
    expect(matchesLibrarySearch(song, '[Live]')).toBe(false);
    expect(matchesLibrarySearch(song, '　 ')).toBe(true);
  });
});
