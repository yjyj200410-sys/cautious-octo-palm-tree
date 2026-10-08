/**
 * NetEase Cloud Music API Client for Nora
 *
 * 包含统一的 CookieManager —— 所有 Cookie 读写的唯一入口。
 */

import { SongQuality, type NcmSongQuality } from '@common/ncmQuality';

export { SongQuality } from '@common/ncmQuality';

// ---- CookieManager ----

const COOKIE_STORAGE_KEY = 'ncm_cookie';

class CookieManager {
  private cookie = '';

  constructor() {
    this.restore();
  }

  /** 仅用于迁移旧版本保存在 localStorage 的单账号 cookie。 */
  restore(): boolean {
    try {
      const saved = localStorage.getItem(COOKIE_STORAGE_KEY);
      if (saved) {
        this.cookie = saved;
        return true;
      }
    } catch {
      // localStorage 不可用
    }
    this.cookie = '';
    return false;
  }

  /** 获取当前 cookie 字符串 */
  get(): string {
    return this.cookie;
  }

  /** 活动 cookie 只保留在内存；持久化由主进程的加密账号库负责。 */
  set(cookie: string) {
    this.cookie = cookie;
  }

  clearLegacyStorage() {
    try {
      localStorage.removeItem(COOKIE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  /** 清空 cookie */
  clear() {
    this.cookie = '';
    this.clearLegacyStorage();
  }

  /** 是否有有效的 cookie (包含 MUSIC_U) */
  hasValidCookie(): boolean {
    return this.cookie.includes('MUSIC_U');
  }
}

// ---- 单例 ----
export const cookieManager = new CookieManager();

// ---- 枚举 ----

export const SearchType = {
  SONG: 1,
  ALBUM: 10,
  ARTIST: 100,
  PLAYLIST: 1000,
  USER: 1002,
  MV: 1004,
  LYRIC: 1006,
  RADIO: 1009,
  VIDEO: 1014
} as const;
export type SearchType = (typeof SearchType)[keyof typeof SearchType];

// ---- 类型 ----

export interface UserProfile {
  userId: number;
  nickname: string;
  avatarUrl: string;
  signature?: string;
  birthday?: number;
  gender?: number;
  [key: string]: unknown;
}

export interface LoginStatusResult {
  data?: {
    code: number;
    account?: { id: number; userName: string };
    profile?: UserProfile;
    [key: string]: unknown;
  };
  code?: number;
  [key: string]: unknown;
}

export interface QrKeyResult {
  data: {
    code: number;
    unikey: string;
  };
  code: number;
}

export interface QrCreateResult {
  data: {
    qrurl: string;
    qrimg: string;
  };
  code: number;
}

export interface QrCheckResult {
  code: number;
  cookie?: string;
  message?: string;
}

export interface SongItem {
  id: number;
  name: string;
  ar: { id: number; name: string }[];
  al: { id: number; name: string; picUrl: string };
  dt: number;
  mv: number;
  fee: number;
  [key: string]: unknown;
}

// ---- API 客户端 ----

class NeteaseApiClient {
  // -- 底层请求 --

  private async request<T>(
    path: string,
    params: Record<string, string> = {},
    cookieOverride?: string
  ): Promise<T> {
    const cookie = cookieOverride ?? cookieManager.get();

    // ★ 通过 IPC 调用（主进程直接调用 API，绕过 CORS/CORP）
    if (window.api?.ncm?.request) {
      return window.api.ncm.request(path, params, cookie) as Promise<T>;
    }

    // Fallback: HTTP fetch（测试页面用）
    const url = new URL(`http://127.0.0.1:25884/netease/${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = {};
    if (cookie) headers['Cookie'] = cookie;
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new Error(`NCM API error: ${res.status}`);
    return res.json();
  }

  // ---- 登录相关 ----

  /** 获取二维码 key */
  async loginQrKey(): Promise<QrKeyResult> {
    return this.request<QrKeyResult>('login/qr/key');
  }

  /** 创建二维码（返回 URL 和 base64 图片） */
  async loginQrCreate(key: string, qrimg = true): Promise<QrCreateResult> {
    return this.request<QrCreateResult>('login/qr/create', {
      key,
      qrimg: qrimg ? 'true' : 'false'
    });
  }

  /** 轮询二维码扫码状态 */
  async loginQrCheck(key: string): Promise<QrCheckResult> {
    return this.request<QrCheckResult>('login/qr/check', { key });
  }

  /** 获取当前登录状态 */
  async loginStatus(cookie?: string): Promise<LoginStatusResult> {
    return this.request<LoginStatusResult>('login/status', {}, cookie);
  }

  /** 退出登录 */
  async logout(): Promise<void> {
    await this.request('logout');
  }

  // ---- 搜索 ----

  async search(keywords: string, type = SearchType.SONG, limit = 30, offset = 0) {
    return this.request<{ result: { songs?: SongItem[]; songCount?: number } }>('search', {
      keywords,
      type: String(type),
      limit: String(limit),
      offset: String(offset)
    });
  }

  /** 综合搜索（多类型） */
  async cloudSearch(keywords: string, type = SearchType.SONG, limit = 30, offset = 0) {
    return this.request('cloudsearch', {
      keywords,
      type: String(type),
      limit: String(limit),
      offset: String(offset)
    });
  }

  /** 搜索建议（联想） */
  async searchSuggest(keywords: string) {
    return this.request<{
      result?: {
        albums?: unknown[];
        artists?: unknown[];
        songs?: unknown[];
        playlists?: unknown[];
        order?: string[];
      };
    }>('search/suggest/web', { s: keywords });
  }

  // ---- 歌曲 ----

  async getSongUrl(
    id: string | number,
    quality: NcmSongQuality = SongQuality.EXHIGH,
    unblock = false
  ) {
    return this.request<{ data: { id: number; url: string; type: string }[] }>('song/url/v1', {
      id: String(id),
      level: quality,
      ...(unblock ? { unblock: 'true' } : {})
    });
  }

  /**
   * 批量获取播放 URL（搜索可播性探测用）。 注意：song_url_v1 模块只读 query.id 并拼成 '[...]'，因此参数名必须是 id（逗号分隔）， 不能用 ids（否则
   * ids 字段为 '[undefined]'）。
   */
  async getSongUrls(ids: (string | number)[]) {
    return this.request<{ data: { id: number; url: string; freeTrialInfo?: unknown }[] }>(
      'song/url/v1',
      { id: ids.join(',') }
    );
  }

  /** 获取客户端下载链接（备选 VIP 解锁方案） */
  async getSongDownloadUrl(id: string | number, quality: NcmSongQuality = SongQuality.EXHIGH) {
    return this.request<{ data: { id: number; url: string; type: string } }>(
      'song/download/url/v1',
      {
        id: String(id),
        level: quality
      }
    );
  }

  async getSongDetail(ids: (string | number)[]) {
    return this.request<{ songs: SongItem[] }>('song/detail', { ids: ids.join(',') });
  }

  async getLyric(id: string | number) {
    return this.request<{ lrc?: { lyric: string }; tlyric?: { lyric: string } }>('lyric', {
      id: String(id)
    });
  }

  // ---- 歌单 ----

  async getPlaylistDetail(id: string | number) {
    return this.request('playlist/detail', { id: String(id) });
  }

  async getPlaylistTracks(id: string | number, limit = 1000, offset = 0) {
    return this.request('playlist/track/all', {
      id: String(id),
      limit: String(limit),
      offset: String(offset)
    });
  }

  // ---- 专辑 & 歌手 ----

  async getAlbum(id: string | number) {
    return this.request('album', { id: String(id) });
  }

  async getArtistDetail(id: string | number) {
    return this.request('artist/detail', { id: String(id) });
  }

  async getArtistSongs(id: string | number, limit = 50, offset = 0) {
    return this.request('artist/songs', {
      id: String(id),
      limit: String(limit),
      offset: String(offset)
    });
  }

  // ---- 用户 ----

  async getUserPlaylists(uid: number, limit = 30, offset = 0) {
    return this.request('user/playlist', {
      uid: String(uid),
      limit: String(limit),
      offset: String(offset)
    });
  }

  async getUserDetail(uid: number) {
    return this.request('user/detail', { uid: String(uid) });
  }

  // ---- 推荐 ----

  /** 相似歌曲 */
  async getSimiSong(id: number) {
    return this.request('simi/song', { id: String(id) });
  }

  /** 歌曲评论 */
  async getCommentMusic(id: number, limit = 20, offset = 0) {
    return this.request('comment/music', {
      id: String(id),
      limit: String(limit),
      offset: String(offset)
    });
  }

  async getBanners() {
    return this.request('banner');
  }

  async getPersonalized(limit = 30) {
    return this.request('personalized', { limit: String(limit) });
  }

  async getDailyRecommend() {
    return this.request('recommend/songs');
  }

  async getPersonalizedNewsongs(limit?: number) {
    return this.request('personalized/newsong', limit ? { limit: String(limit) } : {});
  }

  async getHomepageBlocks(refresh = false, cursor?: string) {
    return this.request('homepage/block/page', {
      refresh: String(refresh),
      ...(cursor === undefined ? {} : { cursor })
    });
  }

  async getPlaylistCategories() {
    return this.request('playlist/catlist');
  }

  async getToplistDetail() {
    return this.request('toplist/detail');
  }

  async getLikedSongs(uid: number) {
    return this.request('likelist', { uid: String(uid) });
  }

  // ---- 写入操作 ----

  /** 收藏/取消收藏歌曲 */
  async likeSong(id: number, like: boolean, uid: number) {
    return this.request('song/like', {
      id: String(id),
      like: String(like),
      uid: String(uid)
    });
  }

  /** 收藏歌单 */
  async subscribePlaylist(id: number) {
    return this.request('playlist/subscribe', { id: String(id), t: '1' });
  }

  /** 取消收藏歌单 */
  async unsubscribePlaylist(id: number) {
    return this.request('playlist/subscribe', { id: String(id), t: '2' });
  }

  /** 创建歌单 */
  async createPlaylist(name: string, privacy = '0') {
    return this.request('playlist/create', { name, privacy });
  }

  /** 重命名歌单 */
  async renamePlaylist(id: number, name: string) {
    return this.request('playlist/name/update', { id: String(id), name });
  }

  /** 删除歌单 */
  async deletePlaylist(id: number) {
    return this.request('playlist/delete', { id: String(id) });
  }

  /** 添加歌曲到歌单 */
  async addTracksToPlaylist(playlistId: number, trackIds: number[]) {
    return this.request('playlist/tracks', {
      op: 'add',
      pid: String(playlistId),
      tracks: trackIds.join(',')
    });
  }

  /** 从歌单移除歌曲 */
  async removeTracksFromPlaylist(playlistId: number, trackIds: number[]) {
    return this.request('playlist/tracks', {
      op: 'del',
      pid: String(playlistId),
      tracks: trackIds.join(',')
    });
  }

  /** 歌单广场 — 按分类获取歌单 */
  async topPlaylist(cat = '全部', order: 'hot' | 'new' = 'hot', limit = 60, offset = 0) {
    return this.request('top/playlist', { cat, order, limit, offset });
  }

  // -- 专辑 --

  /** 最新专辑（推荐） */
  async newestAlbums() {
    return this.request('album/newest');
  }

  /** 用户收藏的专辑列表 */
  async userAlbumSublist(limit = 50, offset = 0) {
    return this.request('album/sublist', { limit: String(limit), offset: String(offset) });
  }

  /** 收藏/取消收藏专辑 */
  async collectAlbum(id: number, collect: boolean) {
    return this.request('album/sub', { id: String(id), t: collect ? '1' : '0' });
  }
}

// ---- 单例 ----
export const ncmApi = new NeteaseApiClient();
export default NeteaseApiClient;
