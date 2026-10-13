import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ uid: 7, like: vi.fn(), local: vi.fn() }));
vi.mock('../../../../../src/renderer/src/ncm/NeteaseSyncService', () => ({
  NeteaseSyncService: { toggleFavoriteSong: state.like }
}));
vi.mock('../../../../../src/renderer/src/contexts/NcmUserContext', () => ({
  get currentNcmUid() {
    return state.uid;
  }
}));
import toggle from '../../../../../src/renderer/src/other/toggleSongIsFavorite';
import { FavoriteService } from '../../../../../src/renderer/src/utils/unifiedStorage';

beforeEach(() => {
  vi.clearAllMocks();
  state.uid = 7;
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => data.set(key, value)
  });
  FavoriteService.refreshFavoriteCache();
  vi.stubGlobal(
    'window',
    Object.assign(new EventTarget(), { api: { playerControls: { toggleLikeSongs: state.local } } })
  );
  vi.stubGlobal(
    'CustomEvent',
    class extends Event {
      constructor(
        type: string,
        public options?: unknown
      ) {
        super(type);
      }
    }
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
describe('authoritative favorite state', () => {
  it('does not publish a failed local write', async () => {
    state.local.mockRejectedValueOnce(new Error('disk failure'));
    expect(await toggle(1, false, true)).toBeUndefined();
    expect(FavoriteService.isFavorite({ source: 'local', sourceId: '1' })).toBe(false);
  });
  it('preserves a favorite when the database did not confirm removal', async () => {
    FavoriteService.addFavorite({ source: 'local', sourceId: '1' });
    state.local.mockResolvedValueOnce({ likes: [], dislikes: [] });
    expect(await toggle(1, true, false)).toBeUndefined();
    expect(FavoriteService.isFavorite({ source: 'local', sourceId: '1' })).toBe(true);
  });
  it('publishes a confirmed local write', async () => {
    state.local.mockResolvedValueOnce({ likes: [1], dislikes: [] });
    expect(await toggle(1, false, true)).toBe(true);
    expect(FavoriteService.isFavorite({ source: 'local', sourceId: '1' })).toBe(true);
  });
  it('does not apply an old account response to the new account', async () => {
    state.like.mockImplementationOnce(async () => {
      state.uid = 8;
    });
    expect(await toggle(-1, false, true)).toBeUndefined();
    expect(FavoriteService.isFavorite({ source: 'netease', sourceId: '1' })).toBe(false);
    expect(state.like).toHaveBeenCalledWith(1, 7, true);
  });
  it('replaces cloud favorites without altering local favorites or repeatedly notifying', () => {
    FavoriteService.addFavorite({ source: 'local', sourceId: '1' });
    FavoriteService.addFavorite({ source: 'netease', sourceId: '1' });
    const listener = vi.fn();
    const unsubscribe = FavoriteService.subscribe(listener);
    FavoriteService.replaceSource('netease', [{ source: 'netease', sourceId: '2' }]);
    FavoriteService.replaceSource('netease', [{ source: 'netease', sourceId: '2' }]);
    expect(FavoriteService.isFavorite({ source: 'local', sourceId: '1' })).toBe(true);
    expect(FavoriteService.isFavorite({ source: 'netease', sourceId: '1' })).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
