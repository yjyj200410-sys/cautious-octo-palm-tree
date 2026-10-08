import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FavoriteService } from '@renderer/utils/unifiedStorage';

describe('FavoriteService subscriptions', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    FavoriteService.refreshFavoriteCache();
  });

  it('notifies subscribers when one favorite changes', () => {
    const listener = vi.fn();
    const unsubscribe = FavoriteService.subscribe(listener);

    FavoriteService.addFavorite({ source: 'netease', sourceId: '123' });
    FavoriteService.addFavorite({ source: 'netease', sourceId: '123' });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(FavoriteService.isFavorite({ source: 'netease', sourceId: '123' })).toBe(true);
    unsubscribe();
  });

  it('adds a restored liked-song list with one notification', () => {
    const listener = vi.fn();
    const unsubscribe = FavoriteService.subscribe(listener);

    FavoriteService.addFavorites([
      { source: 'netease', sourceId: '123' },
      { source: 'netease', sourceId: '456' },
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(FavoriteService.isFavorite({ source: 'netease', sourceId: '456' })).toBe(true);
    unsubscribe();
  });
});
