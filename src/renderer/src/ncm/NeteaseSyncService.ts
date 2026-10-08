/**
 * NeteaseSyncService — 网易云写入操作的唯一入口。
 *
 * 所有修改网易云账号数据的行为必须经过此 Service。
 * UI 不得直接调用 API Client，页面不得自己刷新缓存。
 */

import { ncmApi } from '../api/ncm-client';
import { NcmRepository } from './repository';
import type { NcmPlaylist } from './types';
import { adaptPlaylistList } from './adapters';

// ---- 错误 ----

class NeteaseSyncError extends Error {
  readonly originalError?: unknown;

  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = 'NeteaseSyncError';
    this.originalError = originalError;
  }
}

function handleError(context: string, err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  throw new NeteaseSyncError(`${context}: ${msg}`, err);
}

// Some API modules resolve HTTP 200 even when the operation's body reports a failure.
export function requireNcmWriteSuccess(result: unknown): void {
  const outer = result as { code?: number; body?: { code?: number; message?: string }; message?: string };
  const payload = outer?.code === undefined ? outer?.body : outer;
  if (payload?.code !== 200) throw new NeteaseSyncError(payload?.message || '网易云未确认操作成功');
}

// ---- 获取当前用户 uid ----
function getCurrentUid(): number {
  // 从 NcmUserContext 导出的模块变量获取
  // 由 NcmUserContext 在 login/restoreSession 时更新
  return 0; // uid 由调用方通过参数传入
}

// ---- SyncService ----

export const NeteaseSyncService = {
  // -- 收藏/取消收藏歌曲 --

  async toggleFavoriteSong(ncmId: number, uid: number, like: boolean): Promise<boolean> {
    try {
      requireNcmWriteSuccess(await ncmApi.likeSong(ncmId, like, uid || getCurrentUid()));
      // 收藏态改变会改「我喜欢的音乐」歌单内容:原地更新其 playlist 详情缓存(不删除缓存,
      // 切回收藏列表即时正确且不重新加载)。收藏时补拉完整歌曲数据以便置顶插入。
      const user = uid || getCurrentUid();
      if (user) {
        const absNcmId = Math.abs(ncmId);
        if (like) {
          NcmRepository.songDetail([absNcmId])
            .then((songs) => {
              const s = songs.find((x) => x.ncmId === absNcmId);
              NcmRepository.updateLikedPlaylistTracks(user, absNcmId, true, s);
            })
            .catch(() => {});
        } else {
          NcmRepository.updateLikedPlaylistTracks(user, absNcmId, false);
        }
      }
      return like;
    } catch (err) {
      handleError('收藏操作失败', err);
    }
  },

  // -- 收藏歌单 --

  async subscribePlaylist(playlistId: number, uid: number): Promise<void> {
    try {
      await ncmApi.subscribePlaylist(playlistId);
      NcmRepository.invalidateUserPlaylists(uid || getCurrentUid());
    } catch (err) {
      handleError('收藏歌单失败', err);
    }
  },

  // -- 取消收藏歌单 --

  async unsubscribePlaylist(playlistId: number, uid: number): Promise<void> {
    try {
      await ncmApi.unsubscribePlaylist(playlistId);
      NcmRepository.invalidateUserPlaylists(uid || getCurrentUid());
    } catch (err) {
      handleError('取消收藏歌单失败', err);
    }
  },

  // -- 创建歌单 --

  async createPlaylist(name: string, uid: number): Promise<NcmPlaylist> {
    try {
      const raw = await ncmApi.createPlaylist(name);
      const data = (raw as Record<string, unknown>);
      const playlist = data.playlist;
      const playlists = adaptPlaylistList({
        result: Array.isArray(playlist) ? playlist : playlist && typeof playlist === 'object' ? [playlist] : data.id ? [data] : []
      });
      NcmRepository.invalidateUserPlaylists(uid || getCurrentUid());
      if (playlists.length > 0) {
        return playlists[0];
      }
      throw new NeteaseSyncError('创建歌单成功但未能解析返回数据');
    } catch (err) {
      if (err instanceof NeteaseSyncError) throw err;
      handleError('创建歌单失败', err);
    }
  },

  // -- 重命名歌单 --

  async renamePlaylist(playlistId: number, newName: string, uid: number): Promise<void> {
    try {
      await ncmApi.renamePlaylist(playlistId, newName);
      NcmRepository.invalidatePlaylist(playlistId);
      NcmRepository.invalidateUserPlaylists(uid || getCurrentUid());
    } catch (err) {
      handleError('重命名歌单失败', err);
    }
  },

  // -- 删除歌单 --

  async deletePlaylist(playlistId: number, uid: number): Promise<void> {
    try {
      await ncmApi.deletePlaylist(playlistId);
      NcmRepository.invalidatePlaylist(playlistId);
      NcmRepository.invalidateUserPlaylists(uid || getCurrentUid());
    } catch (err) {
      handleError('删除歌单失败', err);
    }
  },

  // -- 添加歌曲到歌单 --

  async addSongsToPlaylist(playlistId: number, songIds: number[]): Promise<void> {
    try {
      await ncmApi.addTracksToPlaylist(playlistId, songIds);
      NcmRepository.invalidatePlaylist(playlistId);
    } catch (err) {
      handleError('添加歌曲到歌单失败', err);
    }
  },

  // -- 从歌单移除歌曲 --

  async removeSongsFromPlaylist(playlistId: number, songIds: number[]): Promise<void> {
    try {
      requireNcmWriteSuccess(await ncmApi.removeTracksFromPlaylist(playlistId, songIds));
      NcmRepository.invalidatePlaylist(playlistId);
    } catch (err) {
      handleError('从歌单移除歌曲失败', err);
    }
  },
};

export { NeteaseSyncError };
