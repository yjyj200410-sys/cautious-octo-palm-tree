import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getUserPlaylists: vi.fn(),
  getPlaylistDetail: vi.fn(),
  getLikedSongs: vi.fn(),
  getSongDetail: vi.fn(),
  cloudSearch: vi.fn()
}));
vi.mock('../../../../../src/renderer/src/api/ncm-client', () => ({
  ncmApi: api,
  SearchType: { SONG: 1 }
}));
vi.mock('../../../../../src/renderer/src/music-source/netease/NcmPlaybackResolver', () => ({
  NcmPlaybackResolver: {}
}));
vi.mock('../../../../../src/renderer/src/utils/localStorage', () => ({
  default: { preferences: { getPreferences: () => 'standard' } }
}));
import { NcmRepository } from '../../../../../src/renderer/src/ncm/repository';
const rawSong = (id: number) => ({
  id,
  name: `Song ${id}`,
  ar: [],
  al: { id: 1, name: 'Album' },
  dt: 1000
});
beforeEach(() => {
  vi.resetAllMocks();
  NcmRepository.clearCache();
});
describe('retained Netease library behavior', () => {
  it('fills incomplete playlist tracks and preserves the complete liked order', async () => {
    api.getUserPlaylists.mockResolvedValue({ playlist: [{ id: 123, specialType: 5 }] });
    api.getPlaylistDetail.mockResolvedValue({
      playlist: { tracks: [rawSong(3), rawSong(1)], trackIds: [{ id: 3 }, { id: 2 }, { id: 1 }] }
    });
    api.getSongDetail.mockResolvedValue({ songs: [rawSong(2)] });
    const songs = await NcmRepository.getUserLikedSongs(42);
    expect(songs.map((song) => song.ncmId)).toEqual([3, 2, 1]);
    expect(api.getSongDetail).toHaveBeenCalledWith([2]);
  });
  it('uses the liked ID list when the playlist has no tracks', async () => {
    api.getUserPlaylists.mockResolvedValue({ playlist: [] });
    api.getLikedSongs.mockResolvedValue({ ids: [9, 4] });
    api.getSongDetail.mockResolvedValue({ songs: [rawSong(4), rawSong(9)] });
    expect((await NcmRepository.getUserLikedSongs(42)).map((song) => song.ncmId)).toEqual([9, 4]);
  });
  it('reports a failed search instead of showing a false empty result', async () => {
    api.cloudSearch.mockRejectedValue(new Error('offline'));
    await expect(NcmRepository.searchSongs('fixture')).rejects.toThrow('offline');
    expect(NcmRepository.getCacheSize()).toBe(0);
  });
});
