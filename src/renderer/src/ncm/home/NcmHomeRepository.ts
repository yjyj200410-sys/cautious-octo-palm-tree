import { NcmRepository } from '../repository';
import { ncmApi } from '../../api/ncm-client';
import { adaptSong } from '../adapters';
import type { NcmSong, NcmPlaylist } from '../types';
import { FavoriteService } from '../../utils/unifiedStorage';

let dailySongsCache: NcmSong[] | null = null;
let recommendSongsCache: NcmSong[] | null = null;
let recommendPool: NcmSong[] = [];
let rotationIndex = 0;
let recommendSource: 'homepage' | 'newsong' = 'newsong';
let recommendTitle = '推荐新音乐';
let accountEpoch = 0;
const DISPLAY = 18;

type SongResource = { resourceExtInfo?: { songData?: Record<string, unknown> }; songData?: Record<string, unknown> };
type SongBlock = {
  uiElement?: { title?: string; mainTitle?: { title?: string }; subTitle?: { title?: string } };
  creatives?: Array<{ resources?: SongResource[] }>;
};

function homepageRecommendSongs(raw: unknown): { title: string; songs: NcmSong[] } | null {
  const blocks = (raw as { data?: { blocks?: SongBlock[] } })?.data?.blocks || [];
  for (const block of blocks) {
    const title = block.uiElement?.subTitle?.title || block.uiElement?.mainTitle?.title || block.uiElement?.title || '';
    if (!title.includes('喜爱的歌曲') || !title.includes('推荐')) continue;
    const songs = (block.creatives || []).flatMap((creative) =>
      (creative.resources || [])
        .map((resource) => resource.resourceExtInfo?.songData || resource.songData)
        .filter((song): song is Record<string, unknown> => Boolean(song?.id))
        .map((song) => adaptSong(song))
    );
    if (songs.length) return { title, songs };
  }
  return null;
}

/** Preserve source order while giving each album one slot before repeating an album. */
export function takeDiverseSongBatch(pool: NcmSong[], start: number, limit: number): NcmSong[] {
  if (!pool.length) return [];
  const ordered = [...pool.slice(start), ...pool.slice(0, start)];
  const seenSongs = new Set<number>();
  const unique = ordered.filter((song) => {
    if (seenSongs.has(song.ncmId)) return false;
    seenSongs.add(song.ncmId);
    return true;
  });
  const selected: NcmSong[] = [];
  const seenAlbums = new Set<number>();
  for (const song of unique) {
    if (song.album.albumId && seenAlbums.has(song.album.albumId)) continue;
    selected.push(song);
    if (song.album.albumId) seenAlbums.add(song.album.albumId);
    if (selected.length === limit) return selected;
  }
  const selectedIds = new Set(selected.map((song) => song.ncmId));
  for (const song of unique) {
    if (selectedIds.has(song.ncmId)) continue;
    selected.push(song);
    if (selected.length === limit) break;
  }
  return selected;
}

export const NcmHomeRepository = {
  async getDailySongs(): Promise<NcmSong[]> {
    if (dailySongsCache) return dailySongsCache;
    const epoch = accountEpoch;
    const songs = await NcmRepository.dailyRecommend();
    if (epoch === accountEpoch) dailySongsCache = songs;
    return songs;
  },

  getCachedDailySongs(): NcmSong[] {
    return dailySongsCache ?? [];
  },

  /** Prefer the account's homepage song block; use new-song recommendations only as a fallback. */
  async getRecommendSongs(): Promise<NcmSong[]> {
    if (recommendSongsCache) return recommendSongsCache;
    const epoch = accountEpoch;
    let songs: NcmSong[] = [];
    let source: 'homepage' | 'newsong' = 'newsong';
    let title = '推荐新音乐';
    try {
      const block = homepageRecommendSongs(await ncmApi.getHomepageBlocks(true));
      if (block) {
        songs = block.songs;
        source = 'homepage';
        title = block.title;
      }
    } catch {
      // The homepage block is optional; the new-song feed remains available.
    }
    if (!songs.length) songs = await NcmRepository.personalizedSongs(100);
    const batch = takeDiverseSongBatch(songs, 0, DISPLAY);
    if (epoch === accountEpoch) {
      rotationIndex = 0;
      recommendPool = songs;
      recommendSource = source;
      recommendTitle = title;
      recommendSongsCache = batch;
    }
    return batch;
  },

  getRecommendSongsTitle(): string {
    return recommendTitle;
  },

  getCachedRecommendSongs(): NcmSong[] {
    return recommendSongsCache ?? [];
  },

  /** Rotate through the available pool, keeping repeated albums apart. */
  async refreshRecommendSongs(): Promise<NcmSong[]> {
    if (recommendPool.length === 0) return this.getRecommendSongs();
    if (recommendSource === 'homepage' && recommendPool.length <= DISPLAY) {
      try {
        const block = homepageRecommendSongs(await ncmApi.getHomepageBlocks(true));
        if (block?.songs.length) {
          recommendPool = block.songs;
          recommendTitle = block.title;
          rotationIndex = 0;
        }
      } catch {
        // Keep the current batch when refreshing the homepage fails.
      }
    }
    rotationIndex = (rotationIndex + DISPLAY) % recommendPool.length;
    recommendSongsCache = takeDiverseSongBatch(recommendPool, rotationIndex, DISPLAY);
    return recommendSongsCache;
  },

  async getRecommendPlaylists(limit = 12): Promise<NcmPlaylist[]> {
    return NcmRepository.personalizedPlaylists(limit);
  },

  async getRadarPlaylists(limit = 8): Promise<NcmPlaylist[]> {
    return NcmRepository.radarPlaylists(limit);
  },

  /** 首页发现区块 — 动态标题歌单 */
  async getHomepageSongBlock(): Promise<{ title: string; songs: NcmSong[] } | null> {
    return NcmRepository.homepageSongBlock();
  },

  // ---- 我喜欢的音乐 ----

  _likedSongsCache: null as NcmSong[] | null,
  _likedCoverCache: '',
  _likedMetaCache: null as { coverUrl: string; trackCount: number } | null,

  /** 快速获取封面和歌曲数 — 不等待全量歌曲，封面优先显示 */
  async prefetchLikedMeta(uid: number): Promise<{ coverUrl: string; trackCount: number }> {
    if (this._likedMetaCache) return this._likedMetaCache;
    const epoch = accountEpoch;
    try {
      const playlists = await NcmRepository.getUserPlaylists(uid);
      // 通过名称匹配找到「我喜欢的音乐」歌单
      const liked = playlists.find(
        (pl) => pl.name === '我喜欢的音乐' || pl.name.includes('喜欢的音乐')
      );
      if (liked?.coverUrl && epoch === accountEpoch) {
        this._likedMetaCache = { coverUrl: liked.coverUrl, trackCount: liked.trackCount };
        this._likedCoverCache = liked.coverUrl;
        return this._likedMetaCache;
      }
    } catch {
      // 元数据获取失败不阻塞
    }
    return { coverUrl: '', trackCount: 0 };
  },

  async prefetchLikedSongs(uid: number): Promise<NcmSong[]> {
    if (this._likedSongsCache) return this._likedSongsCache;
    const epoch = accountEpoch;
    const songs = await NcmRepository.getUserLikedSongs(uid);
    if (epoch !== accountEpoch) return songs;
    this._likedSongsCache = songs;
    if (songs.length > 0 && !this._likedCoverCache) {
      this._likedCoverCache = songs[0].coverUrl || '';
    }
    // 批量同步并只通知一次，保证启动恢复的当前歌曲立即刷新收藏状态。
    FavoriteService.addFavorites(
      songs.map((song) => ({ source: 'netease', sourceId: String(song.ncmId) }))
    );
    return songs;
  },

  getCachedLikedSongs(): NcmSong[] {
    return this._likedSongsCache ?? [];
  },

  getCachedLikedMeta(): { coverUrl: string; trackCount: number } | null {
    return this._likedMetaCache;
  },

  getLikedCover(): string {
    return this._likedCoverCache;
  },

  clearAccountCache(): void {
    accountEpoch += 1;
    dailySongsCache = null;
    recommendSongsCache = null;
    recommendPool = [];
    rotationIndex = 0;
    recommendSource = 'newsong';
    recommendTitle = '推荐新音乐';
    this._likedSongsCache = null;
    this._likedCoverCache = '';
    this._likedMetaCache = null;
  },
};
