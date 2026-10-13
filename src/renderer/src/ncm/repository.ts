/**
 * NcmRepository — 网易云数据访问的唯一入口。
 *
 * UI 只能通过 Repository 获取数据，不得直接调 API Client 或解析原始 JSON。
 */

import { normalizeNcmSongQuality } from '@common/ncmQuality';

import { ncmApi, SearchType } from '../api/ncm-client';
import { NcmPlaybackResolver } from '../music-source/netease/NcmPlaybackResolver';
import storage from '../utils/localStorage';
import {
  adaptSong,
  adaptSongs,
  adaptPlaylist,
  adaptPlaylistList,
  adaptAlbum,
  adaptArtistSongs,
  adaptSearchResult,
  adaptLyric,
  coverToArtwork
} from './adapters';
import type { NcmSong, NcmPlaylist, NcmAlbum, NcmArtist, NcmSearchResult, NcmLyric } from './types';

// ---- 缓存 ----

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
let cacheEpoch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data as T;
  }
  cache.delete(key);
  return null;
}

function cacheSet<T>(key: string, data: T, epoch: number): void {
  if (epoch === cacheEpoch) cache.set(key, { data, timestamp: Date.now() });
}

// TTL-aware async cache helper (seconds)
async function withCache<T>(key: string, fn: () => Promise<T>, ttlSeconds: number): Promise<T> {
  const epoch = cacheEpoch;
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < ttlSeconds * 1000) {
    return entry.data as T;
  }
  const data = await fn();
  cacheSet(key, data, epoch);
  return data;
}

// ---- 错误 ----

class NcmRepositoryError extends Error {
  readonly originalError?: unknown;
  constructor(message: string, originalError?: unknown) {
    super(message);
    this.name = 'NcmRepositoryError';
    this.originalError = originalError;
  }
}

function handleError(context: string, err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  throw new NcmRepositoryError(`${context}: ${msg}`, err);
}

// ---- Repository ----

export const NcmRepository = {
  // -- 搜索 --

  /** 多类型搜索 */
  async search(
    keywords: string,
    type: number = SearchType.SONG,
    limit = 30,
    offset = 0
  ): Promise<NcmSearchResult> {
    const cacheKey = `search:${type}:${keywords}:${limit}:${offset}`;
    const cached = cacheGet<NcmSearchResult>(cacheKey);
    if (cached) return cached;
    const epoch = cacheEpoch;

    try {
      const raw = await ncmApi.cloudSearch(keywords, type, limit, offset);
      const result = adaptSearchResult(raw as Record<string, unknown>);
      cacheSet(cacheKey, result, epoch);
      return result;
    } catch (err) {
      handleError('搜索音乐失败', err);
    }
  },

  async searchSongs(keywords: string, limit = 30, offset = 0): Promise<NcmSearchResult> {
    return this.search(keywords, SearchType.SONG, limit, offset);
  },

  // -- 歌曲 --

  async songDetail(ids: number[]): Promise<NcmSong[]> {
    const cacheKey = `song:${ids.join(',')}`;
    const cached = cacheGet<NcmSong[]>(cacheKey);
    if (cached) return cached;
    const epoch = cacheEpoch;

    try {
      const raw = await ncmApi.getSongDetail(ids);
      const songs = adaptSongs(((raw as Record<string, unknown>).songs as never[]) || []);
      cacheSet(cacheKey, songs, epoch);
      return songs;
    } catch (err) {
      handleError('获取歌曲详情失败', err);
    }
  },

  async songUrl(id: number, opts?: { fromPrefetch?: boolean }): Promise<string | null> {
    try {
      // CDN 主机 fallback 已在 NcmPlaybackResolver.resolve 内统一处理(播放/预取/缓存全部受益)
      const result = await NcmPlaybackResolver.resolve(id, opts);
      return result.url;
    } catch (err) {
      handleError('获取播放URL失败', err);
    }
  },

  /** 获取原始 songUrl 响应（含 level/fee/privilege），供 Resolver 判断可播放性 */
  async getSongUrlRaw(id: number, unblock = false): Promise<Record<string, unknown>> {
    try {
      const quality = normalizeNcmSongQuality(
        storage.preferences.getPreferences('ncmPlaybackQuality')
      );
      return (await ncmApi.getSongUrl(id, quality, unblock)) as Record<string, unknown>;
    } catch (err) {
      handleError('获取播放URL详情失败', err);
    }
  },

  /** 获取客户端下载链接（VIP 备选方案） */
  async getSongDownloadUrlRaw(id: number): Promise<Record<string, unknown>> {
    try {
      const quality = normalizeNcmSongQuality(
        storage.preferences.getPreferences('ncmPlaybackQuality')
      );
      return (await ncmApi.getSongDownloadUrl(id, quality)) as Record<string, unknown>;
    } catch (err) {
      handleError('获取下载URL失败', err);
    }
  },

  async lyric(id: number): Promise<NcmLyric> {
    try {
      const raw = await ncmApi.getLyric(id);
      return adaptLyric(raw as Record<string, unknown>);
    } catch (err) {
      handleError('获取歌词失败', err);
    }
  },

  /** 相似歌曲 */
  async simiSong(ncmId: number): Promise<NcmSong[]> {
    try {
      const raw = await ncmApi.getSimiSong(ncmId);
      const data = raw as { songs?: Record<string, unknown>[] };
      return (data.songs || []).map((s) => adaptSong(s));
    } catch (err) {
      handleError('获取相似歌曲失败', err);
      return [];
    }
  },

  /** 歌曲评论 */
  async commentMusic(
    ncmId: number,
    limit = 20
  ): Promise<{ hotComments: unknown[]; total: number }> {
    try {
      const raw = await ncmApi.getCommentMusic(ncmId, limit);
      const data = raw as Record<string, unknown>;
      return {
        hotComments: (data.hotComments as unknown[]) || [],
        total: (data.total as number) || 0
      };
    } catch (err) {
      handleError('获取评论失败', err);
      return { hotComments: [], total: 0 };
    }
  },

  // -- 歌单列表 --

  async getUserPlaylists(uid: number): Promise<NcmPlaylist[]> {
    const cacheKey = `user_playlists:${uid}`;
    const cached = cacheGet<NcmPlaylist[]>(cacheKey);
    if (cached) return cached;
    const epoch = cacheEpoch;

    // load user playlists
    try {
      const raw = await ncmApi.getUserPlaylists(uid);
      const playlists = adaptPlaylistList(raw as Record<string, unknown>);
      cacheSet(cacheKey, playlists, epoch);
      return playlists;
    } catch (err) {
      handleError('获取用户歌单失败', err);
    }
  },

  // -- 歌单详情（含歌曲列表） --

  async playlistDetail(id: number): Promise<NcmPlaylist> {
    const cacheKey = `playlist:${id}`;
    const cached = cacheGet<NcmPlaylist>(cacheKey);
    if (cached) return cached;
    const epoch = cacheEpoch;

    // load playlist detail
    try {
      const raw = await ncmApi.getPlaylistDetail(id);
      const playlist = adaptPlaylist(raw as Record<string, unknown>);
      const trackIds =
        (raw as { playlist?: { trackIds?: { id: number; at?: number }[] } }).playlist?.trackIds ??
        [];
      const addedTimes = new Map(
        trackIds.filter((track) => track.at).map((track) => [track.id, track.at])
      );

      // 获取完整歌曲列表（playlist/detail 只返回前 10 首）
      if (playlist.tracks.length > 0 && playlist.songs.length < playlist.trackCount) {
        try {
          const allRaw = await ncmApi.getPlaylistTracks(id);
          playlist.tracks = adaptSongs(
            ((allRaw as Record<string, unknown>).songs as never[]) || []
          );
          playlist.songs = playlist.tracks.map((t) => ({ title: t.title, songId: t.songId }));
        } catch {
          // 获取全部歌曲失败，保留部分数据
        }
      }

      // 批量获取封面（歌单部分歌曲的详情可能缺少 picUrl）
      if (playlist.tracks.length > 0) {
        const ids = playlist.tracks.map((t) => t.ncmId);
        try {
          const detailRaw = await ncmApi.getSongDetail(ids);
          const detailSongs = adaptSongs(
            ((detailRaw as Record<string, unknown>).songs as Record<string, unknown>[]) || []
          );
          const map = new Map(detailSongs.map((s) => [s.ncmId, s]));
          playlist.tracks = playlist.tracks.map((t) => ({
            ...t,
            ...(map.get(t.ncmId) ?? {}),
            addedAt: t.addedAt
          }));
        } catch {
          // 失败则保留原数据
        }
      }

      playlist.tracks = playlist.tracks.map((track) => ({
        ...track,
        addedAt: addedTimes.get(track.ncmId) ?? track.addedAt
      }));
      cacheSet(cacheKey, playlist, epoch);
      return playlist;
    } catch (err) {
      handleError('获取歌单详情失败', err);
    }
  },

  async playlistTracks(id: number, limit = 1000, offset = 0): Promise<NcmSong[]> {
    try {
      const raw = await ncmApi.getPlaylistTracks(id, limit, offset);
      const songs = adaptSongs(((raw as Record<string, unknown>).songs as never[]) || []);
      return songs;
    } catch (err) {
      handleError('获取歌单歌曲失败', err);
    }
  },

  // -- 专辑 --

  async albumDetail(id: number): Promise<NcmAlbum> {
    const cacheKey = `album:${id}`;
    const cached = cacheGet<NcmAlbum>(cacheKey);
    if (cached) return cached;
    const epoch = cacheEpoch;

    try {
      const raw = await ncmApi.getAlbum(id);
      const album = adaptAlbum(raw as Record<string, unknown>);
      cacheSet(cacheKey, album, epoch);
      return album;
    } catch (err) {
      handleError('获取专辑详情失败', err);
    }
  },

  /** 最新专辑（推荐） */
  async newestAlbums(): Promise<NcmAlbum[]> {
    return withCache(
      'newest_albums',
      async () => {
        const raw = await ncmApi.newestAlbums();
        const data =
          (raw as { albums?: Record<string, unknown>[] })?.albums ||
          (raw as { data?: Record<string, unknown>[] })?.data ||
          [];
        return (data as Record<string, unknown>[]).map((a) => adaptAlbum({ album: a, songs: [] }));
      },
      1800
    );
  },

  /** 用户收藏的专辑列表 */
  async userAlbumSublist(limit = 50, offset = 0): Promise<NcmAlbum[]> {
    const raw = await ncmApi.userAlbumSublist(limit, offset);
    const data = (raw as { data?: Record<string, unknown>[] })?.data || [];
    return (data as Record<string, unknown>[]).map((a) => adaptAlbum({ album: a, songs: [] }));
  },

  /** 清除专辑收藏缓存（收藏/取消后调用） */
  invalidateAlbumSublist(): void {
    for (const key of cache.keys()) {
      if (key.startsWith('album_sublist:')) cache.delete(key);
    }
  },

  // -- 歌手 --

  async artistDetail(id: number): Promise<{ artist: NcmArtist; songs: NcmSong[] }> {
    const cacheKey = `artist:${id}`;
    const cached = cacheGet<{ artist: NcmArtist; songs: NcmSong[] }>(cacheKey);
    if (cached) return cached;
    const epoch = cacheEpoch;

    try {
      const [detailRaw, songsRaw] = await Promise.all([
        ncmApi.getArtistDetail(id),
        ncmApi.getArtistSongs(id, 50)
      ]);
      const detailData = detailRaw as Record<string, unknown>;
      const result = adaptArtistSongs({
        artist: ((detailData.data as Record<string, unknown>)?.artist ||
          detailData.artist) as Record<string, unknown>,
        songs: ((songsRaw as Record<string, unknown>).songs || []) as never[]
      });
      cacheSet(cacheKey, result, epoch);
      return result;
    } catch (err) {
      handleError('获取歌手详情失败', err);
    }
  },

  // -- 推荐 / 首页内容 --

  async dailyRecommend(): Promise<NcmSong[]> {
    return withCache(
      'daily_rec',
      async () => {
        const raw = await ncmApi.getDailyRecommend();
        const data =
          (raw as { data?: { dailySongs?: unknown[] } }).data ??
          (raw as { dailySongs?: unknown[] });
        const songs = (data as { dailySongs?: unknown[] })?.dailySongs ?? (raw as unknown[]);
        return adaptSongs(Array.isArray(songs) ? (songs as Record<string, unknown>[]) : []);
      },
      86400
    );
  },

  // 已知雷达歌单 ID（来自 SPlayer + 网易云固定雷达主题）
  _KNOWN_RADAR_IDS: new Set([
    3136952023, // 私人雷达
    8402996200, // 会员雷达
    5320167908, // 时光雷达
    5327906368, // 乐迷雷达
    5362359247, // 宝藏雷达
    5300458264, // 新歌雷达
    5341776086 // 神秘雷达
  ]),

  async _getPersonalizedPool(): Promise<NcmPlaylist[]> {
    return withCache(
      'personalized_pool',
      async () => {
        const raw = await ncmApi.getPersonalized(60);
        return adaptPlaylistList(raw as Record<string, unknown>);
      },
      1800
    );
  },

  // 雷达歌单判定：名称/文案含「雷达」，或 ID 在已知雷达列表中
  _isRadar(pl: NcmPlaylist): boolean {
    if (pl.name.includes('雷达') || (pl.copywriter || '').includes('雷达')) return true;
    // playlistId 是负的 ncmId，实际 ID = -playlistId
    if (this._KNOWN_RADAR_IDS.has(-pl.playlistId)) return true;
    // | 分隔符格式（如「推荐语|私人雷达」）
    const idx = pl.name.indexOf('|');
    if (idx > 0 && /(?:雷达|私人|怀旧|宝藏|为你)$/.test(pl.name.slice(idx + 1))) return true;
    return false;
  },

  async personalizedPlaylists(limit = 12): Promise<NcmPlaylist[]> {
    const pool = await this._getPersonalizedPool!();
    const recommend = pool.filter((pl) => !this._isRadar(pl));
    return recommend.slice(0, limit);
  },

  /** 热门歌单(歌单广场)— 分页接口,DiscoverProvider 无限流数据源 */
  async topPlaylists(limit = 20, offset = 0): Promise<NcmPlaylist[]> {
    const raw = await ncmApi.topPlaylist('全部', 'hot', limit, offset);
    return adaptPlaylistList(raw as Record<string, unknown>);
  },

  async radarPlaylists(limit = 8): Promise<NcmPlaylist[]> {
    // 用已知 ID 直接获取雷达歌单详情（SPlayer 方案）
    return withCache(
      'radar_playlists',
      async () => {
        const ids = [...this._KNOWN_RADAR_IDS];
        const results = await Promise.allSettled(ids.map((id) => this.playlistDetail(id)));
        const radarList: NcmPlaylist[] = [];
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) {
            radarList.push(r.value);
          }
        }
        return radarList.slice(0, limit);
      },
      1800
    );
  },

  /** 首页发现区块 — 返回第一个歌曲类区块 { title, songs } */
  async homepageSongBlock(): Promise<{ title: string; songs: NcmSong[] } | null> {
    const raw = await ncmApi.getHomepageBlocks(true);
    const data = (raw as { data?: { blocks?: unknown[] } })?.data;
    const blocks = (data?.blocks ?? []) as Record<string, unknown>[];
    for (const block of blocks) {
      const creatives = block.creatives as Record<string, unknown>[] | undefined;
      if (!creatives?.length) continue;
      // Find song-type blocks (have song data in creatives)
      const songs: NcmSong[] = [];
      for (const c of creatives) {
        const resources = Array.isArray(c.resources) ? c.resources : [];
        for (const resource of resources) {
          const songData = (resource?.resourceExtInfo?.songData ?? resource?.songData) as
            | Record<string, unknown>
            | undefined;
          if (songData?.id) songs.push(adaptSong(songData, ''));
        }
      }
      if (songs.length > 0) {
        const title =
          (((block.uiElement as Record<string, unknown>)?.subTitle as Record<string, unknown>)
            ?.title as string) ||
          ((block.uiElement as Record<string, unknown>)?.title as string) ||
          '';
        return { title: String(title), songs };
      }
    }
    return null;
  },

  /** 从首页 blocks 提取雷达歌单 — blocks 中标题含"雷达"的 playlist 类区块 */
  async _getHomepageRadarPlaylists(): Promise<NcmPlaylist[]> {
    try {
      const raw = await ncmApi.getHomepageBlocks(true);
      const data = (raw as { data?: { blocks?: unknown[] } })?.data;
      const blocks = (data?.blocks ?? []) as Record<string, unknown>[];
      const result: NcmPlaylist[] = [];
      for (const block of blocks) {
        const ui = block.uiElement as Record<string, unknown> | undefined;
        const blockTitle =
          ((ui?.subTitle as Record<string, unknown>)?.title as string) ||
          (ui?.title as string) ||
          '';
        // 只看标题含"雷达"的 block
        if (!blockTitle.includes('雷达')) continue;
        const creatives = block.creatives as Record<string, unknown>[] | undefined;
        if (!creatives?.length) continue;
        for (const c of creatives) {
          // 尝试从多种结构中提取 playlist 数据
          const res = c.resources?.[0] as Record<string, unknown> | undefined;
          const extInfo = res?.resourceExtInfo as Record<string, unknown> | undefined;
          const plData = (res?.playlistData ??
            extInfo?.playlistData ??
            c.playlistData ??
            c) as Record<string, unknown>;
          if (plData?.id && plData?.name) {
            result.push({
              playlistId: -(plData.id as number),
              name: (plData.name as string) || '',
              songs: [],
              createdDate: new Date(),
              isArtworkAvailable: true,
              artworkPaths: coverToArtwork(
                (plData.coverImgUrl as string) || (plData.picUrl as string) || ''
              ),
              coverUrl: (plData.coverImgUrl as string) || (plData.picUrl as string) || '',
              tracks: [],
              playCount: (plData.playCount as number) || 0,
              trackCount: (plData.trackCount as number) || 0,
              creatorName: ((plData.creator as Record<string, unknown>)?.nickname as string) || '',
              creatorId: ((plData.creator as Record<string, unknown>)?.userId as number) || 0,
              description: '',
              copywriter: ''
            });
          }
        }
      }
      return result;
    } catch {
      return [];
    }
  },

  /** 用户收藏歌曲（全量，保持 likelist 返回顺序） */
  async getUserLikedSongs(uid: number): Promise<NcmSong[]> {
    // 通过歌单列表找到"我喜欢的音乐"的 ID，再用 playlist/detail 获取正确排序
    const playlists = await ncmApi.getUserPlaylists(uid, 50);
    const list = ((playlists as { playlist?: Record<string, unknown>[] })?.playlist ??
      []) as Record<string, unknown>[];
    const liked = list.find(
      (pl) => pl.specialType === 5 || (pl.name as string)?.includes('喜欢的音乐')
    );
    if (liked?.id) {
      const raw = await ncmApi.getPlaylistDetail(String(liked.id));
      const pl = (
        raw as { playlist?: { tracks?: Record<string, unknown>[]; trackIds?: { id: number }[] } }
      )?.playlist;
      if (pl?.tracks?.length) {
        const orderedIds = pl.trackIds?.map((track) => track.id) || [];
        const resolved = new Map(adaptSongs(pl.tracks).map((song) => [song.ncmId, song]));
        const missing = orderedIds.filter((id) => !resolved.has(id));
        for (let i = 0; i < missing.length; i += 100) {
          const details = await ncmApi.getSongDetail(missing.slice(i, i + 100));
          for (const song of adaptSongs(
            (details as { songs?: Record<string, unknown>[] }).songs || []
          ))
            resolved.set(song.ncmId, song);
        }
        return orderedIds.length
          ? orderedIds.map((id) => resolved.get(id)).filter((song): song is NcmSong => !!song)
          : [...resolved.values()];
      }
    }
    // Fallback
    const fb = await ncmApi.getLikedSongs(uid);
    const ids = ((fb as { ids?: number[] })?.ids ?? []) as number[];
    if (!ids.length) return [];
    const allSongs: Record<string, NcmSong> = {};
    for (let i = 0; i < ids.length; i += 100) {
      const b = ids.slice(i, i + 100);
      const d = await ncmApi.getSongDetail(b);
      const a = ((d as { songs?: Record<string, unknown>[] })?.songs ?? []) as Record<
        string,
        unknown
      >[];
      for (const s of adaptSongs(a, [])) allSongs[s.ncmId] = s;
    }
    return ids.map((id) => allSongs[id]).filter(Boolean) as NcmSong[];
  },

  async personalizedSongs(limit = 120): Promise<NcmSong[]> {
    const raw = await ncmApi.getPersonalizedNewsongs(limit);
    const list = (raw as { result?: unknown[] })?.result ?? (raw as unknown[]);
    const arr = Array.isArray(list) ? list : [];
    const songs: NcmSong[] = [];
    for (const item of arr) {
      const entry = item as Record<string, unknown>;
      const songData = (entry.song ?? entry) as Record<string, unknown>;
      if (songData.id) {
        songs.push(adaptSong(songData, ''));
      }
    }
    return songs;
  },

  // -- 缓存管理 --

  invalidatePlaylist(id: number): void {
    cache.delete(`playlist:${id}`);
    // invalidate playlist cache
  },

  /**
   * 收藏/取消收藏后原地更新「我喜欢的音乐」歌单详情缓存(只改缓存内容、不删除 → 切回收藏列表 即时正确且不重新加载)。仅当用户歌单列表与歌单详情均已缓存时生效;冷缓存下次打开本就重新
   * 拉取,无需处理。新收藏置顶(网易云 likelist 新歌在顶部),取消收藏按 ncmId 移除。
   */
  updateLikedPlaylistTracks(uid: number, ncmId: number, like: boolean, song?: NcmSong): void {
    const pls = cacheGet<NcmPlaylist[]>('user_playlists:' + uid);
    if (!pls) return;
    const liked = pls.find((pl) => pl.name === '我喜欢的音乐' || pl.name.includes('喜欢的音乐'));
    if (!liked) return;
    const absId = Math.abs(liked.playlistId);
    const entry = cache.get(`playlist:${absId}`);
    if (!entry) return;
    const pl = entry.data as NcmPlaylist;
    if (!Array.isArray(pl.tracks)) return;
    const idx = pl.tracks.findIndex((s) => s.ncmId === ncmId);
    if (like) {
      if (idx >= 0) pl.tracks.splice(idx, 1); // 去重(收藏已存在的歌不重复)
      if (song) pl.tracks.unshift(song);
      else if (idx < 0) return; // 无完整歌曲数据可插,保持原状
    } else if (idx >= 0) {
      pl.tracks.splice(idx, 1);
    } else {
      return; // 本就不在收藏列表
    }
    pl.trackCount = pl.tracks.length;
    entry.timestamp = Date.now(); // 原地更新视为新鲜,避免被当作即将过期的冷缓存
  },

  invalidateUserPlaylists(uid: number): void {
    cache.delete(`user_playlists:${uid}`);
    // invalidate user playlists cache
  },

  invalidateUserLikedSongs(uid: number): void {
    cache.delete(`user_liked_songs:${uid}`);
    // invalidate liked songs cache
  },

  invalidateFavoritePlaylists(): void {
    // 清除收藏/订阅歌单相关缓存
    // 当前暂无独立缓存键，保留以便未来使用
    for (const key of cache.keys()) {
      if (key.startsWith('favorite_playlists')) {
        cache.delete(key);
      }
    }
  },

  clearCache(): void {
    cacheEpoch += 1;
    cache.clear();
    // cache cleared
  },

  getCacheSize(): number {
    return cache.size;
  }
};

export type { NcmSearchResult, NcmSong, NcmPlaylist, NcmAlbum, NcmArtist, NcmLyric };
export { NcmRepositoryError };
