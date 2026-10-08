/**
 * NeteaseMusicSource — 网易云音乐数据源。
 */

import type { MusicSource, UnifiedSearchResult, SearchResultItem } from './types';
import { NcmRepository } from '../ncm/repository';
import { NeteaseSyncService } from '../ncm/NeteaseSyncService';
import { NcmPlaybackResolver } from './netease/NcmPlaybackResolver';

export const neteaseMusicSource: MusicSource = {
  name: 'netease',

  async search(query: string, limit = 20): Promise<UnifiedSearchResult> {
    if (!query.trim()) return { items: [], total: 0 };

    try {
      const raw = await NcmRepository.searchSongs(query, limit);
      const items: SearchResultItem[] = raw.songs.map((s) => ({
        id: s.songId,        // negative
        title: s.title || '',
        artists: s.artists.map((a) => a.name).join(' / ') || '',
        album: s.album?.name || '',
        duration: Math.round(s.duration / 1000), // ms → seconds
        cover: s.coverUrl || '',
        source: 'netease' as const,
        sourceId: s.ncmId,   // positive original
      }));

      return { items, total: raw.songCount };
    } catch {
      return { items: [], total: 0 };
    }
  },

  async getSongUrl(id: number): Promise<string | null> {
    const absId = id > 0 ? id : -id;
    const result = await NcmPlaybackResolver.resolve(absId);
    return result.url;
  },

  async getUserPlaylists(uid: number) {
    return NcmRepository.getUserPlaylists(uid);
  },

  async getPlaylistDetail(id: number) {
    return NcmRepository.playlistDetail(id);
  },

  clearCache() {
    NcmRepository.clearCache();
  },

  // -- 写入操作 —— 委托给 NeteaseSyncService --

  async toggleFavoriteSong(ncmId: number, uid: number, like: boolean) {
    return NeteaseSyncService.toggleFavoriteSong(ncmId, uid, like);
  },

  async subscribePlaylist(playlistId: number, uid: number) {
    return NeteaseSyncService.subscribePlaylist(playlistId, uid);
  },

  async unsubscribePlaylist(playlistId: number, uid: number) {
    return NeteaseSyncService.unsubscribePlaylist(playlistId, uid);
  },

  async createPlaylist(name: string, uid: number) {
    return NeteaseSyncService.createPlaylist(name, uid);
  },

  async renamePlaylist(playlistId: number, newName: string, uid: number) {
    return NeteaseSyncService.renamePlaylist(playlistId, newName, uid);
  },

  async deletePlaylist(playlistId: number, uid: number) {
    return NeteaseSyncService.deletePlaylist(playlistId, uid);
  },

  async addSongsToPlaylist(playlistId: number, songIds: number[]) {
    return NeteaseSyncService.addSongsToPlaylist(playlistId, songIds);
  },

  async removeSongsFromPlaylist(playlistId: number, songIds: number[]) {
    return NeteaseSyncService.removeSongsFromPlaylist(playlistId, songIds);
  },
};
