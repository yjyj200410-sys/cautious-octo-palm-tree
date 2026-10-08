/**
 * LocalMusicSource — 本地音乐数据源。
 */

import type { MusicSource, UnifiedSearchResult, SearchResultItem } from './types';

export const localMusicSource: MusicSource = {
  name: 'local',

  async search(query: string, limit = 20): Promise<UnifiedSearchResult> {
    if (!query.trim()) return { items: [], total: 0 };

    try {
      const raw = await window.api.search.search('All' as never, query, false, false);
      const result = raw as { songs?: Array<{
        songId: number; title: string; duration: number;
        artists?: { name: string }[];
        album?: { name: string };
        artworkPaths?: { artworkPath: string };
      }> };

      const songs = result.songs || [];
      const items: SearchResultItem[] = songs.slice(0, limit).map((s) => ({
        id: s.songId,
        title: s.title || '未知歌曲',
        artists: (s.artists || []).map((a) => a.name).join(' / ') || '未知歌手',
        album: s.album?.name || '',
        duration: s.duration || 0,
        cover: s.artworkPaths?.artworkPath || '',
        source: 'local' as const,
        sourceId: s.songId,
      }));

      return { items, total: songs.length };
    } catch {
      return { items: [], total: 0 };
    }
  },

  async getSongUrl(_id: number): Promise<string | null> {
    // Local songs don't need URLs - they play from path
    return null;
  },

  clearCache() {},
};
