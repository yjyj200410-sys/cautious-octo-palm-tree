/**
 * 第三方搜索兜底 — 网易云搜不到 / 无版权时，从主进程 unblock server 拉取
 * 歌曲宝(gequbao) + 酷我(kuwo) 候选，映射为 NcmSong 供搜索页展示与播放。
 *
 * 播放路径复用 NcmPlaybackResolver 的纯 keyword 解锁竞速（kuwo/bodian/gequbao）：
 *   合成 songId → resolve(songId, {meta}) → isThirdParty 分支（跳过官方/gd/download/试听）。
 */

import { ncmApi } from '../../api/ncm-client';
import { coverToArtwork } from '../../ncm/adapters';
import type { NcmSong } from '../../ncm/types';

/** 第三方条目合成 id 基址。songId 为负，-songId = ncmId。
 *  基址必须远高于网易云真实 id 上限：真实 id 早期 ~1e7，现已涨到 ~2.5–3.4e9
 *  （本机收藏队列里就有 -3384438343 / -2652731241 等真实 id）。旧基址 2e9 会把这些
 *  真实歌曲误判为第三方 → 跳过官方解析直接 keyword 解锁 → 大概率失败被自动切歌。
 *  取 1e11（合成段落在 [1e11, 1.22e11]），对当前真实 id 上限约 30x 余量，且 JS Number 完全容纳。 */
export const THIRD_PARTY_ID_BASE = 100_000_000_000;

/** 各 provider 的合成 id 段偏移，避免跨 provider 碰撞 */
const PROVIDER_OFFSET: Record<string, number> = {
  gequbao: 0,
  kuwo: 1_000_000_000,
};

/** 本模块请求 unblock server 的 base */
const UNBLOCK_BASE = 'http://127.0.0.1:25884/api/unblock';

/** 简单稳定的字符串 hash（djb2），无随机性，供 kuwo rid 等非数字 id 取合成 id */
export function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** songId（NcmSong 中为负值）是否为第三方合成条目 */
export function isThirdPartySong(songId: number): boolean {
  return Math.abs(songId) >= THIRD_PARTY_ID_BASE;
}

/** 由第三方候选 id 生成合成正数 ncmId：gequbao 直接用数字 id；kuwo 用 rid hash */
function syntheticId(provider: 'gequbao' | 'kuwo', id: string): number {
  const offset = PROVIDER_OFFSET[provider] ?? 0;
  let hash: number;
  if (provider === 'gequbao') {
    const n = Number(id);
    hash = Number.isFinite(n) && n > 0 ? n : hashCode(id);
  } else {
    hash = hashCode(id) % 1_000_000_000;
  }
  return THIRD_PARTY_ID_BASE + offset + hash;
}

/** 主进程候选 → NcmSong（合成负 id + provider 标注） */
function candidateToSong(item: {
  provider: 'gequbao' | 'kuwo';
  id: string;
  title: string;
  artist: string;
  durationSec?: number;
  cover?: string;
}): NcmSong {
  const ncmId = syntheticId(item.provider, item.id);
  const coverUrl = item.cover ?? '';
  return {
    songId: -ncmId,
    title: item.title,
    duration: (item.durationSec ?? 0) * 1000,
    artists: [{ name: item.artist, artistId: 0 }],
    album: { name: '', albumId: 0 },
    path: '',
    artworkPaths: coverToArtwork(coverUrl),
    isBlacklisted: false,
    coverUrl,
    url: null,
    ncmId,
    provider: item.provider,
  };
}

/**
 * 搜索第三方候选（主进程聚合歌曲宝+酷我，去重、过滤版本标记）。
 * 失败或空 → 返回 []。
 */
export async function searchThirdPartySongs(keyword: string): Promise<NcmSong[]> {
  if (!keyword.trim()) return [];
  try {
    const url = `${UNBLOCK_BASE}/search?keyword=${encodeURIComponent(keyword)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as { code?: number; items?: unknown[] };
    if (data.code !== 200 || !Array.isArray(data.items)) return [];
    const songs: NcmSong[] = [];
    for (const raw of data.items) {
      const item = raw as {
        provider?: string;
        id?: string;
        title?: string;
        artist?: string;
        durationSec?: number;
        cover?: string;
      };
      if (item.provider !== 'gequbao' && item.provider !== 'kuwo') continue;
      if (!item.id || !item.title) continue;
      songs.push(
        candidateToSong({
          provider: item.provider,
          id: item.id,
          title: item.title,
          artist: item.artist || '',
          ...(item.durationSec ? { durationSec: item.durationSec } : {}),
          ...(item.cover ? { cover: item.cover } : {}),
        }),
      );
    }
    return songs;
  } catch (err) {
    console.warn('[THIRD_PARTY_SEARCH] failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * 批量探测网易云歌曲是否全部不可播（下架/无版权灰歌）。
 * 免费/VIP 有试听 URL 都视为「可播」，不触发第三方兜底。
 * 探测失败（网络抖动）保守视为不可播 → 触发兜底，交给搜索页决定。
 */
export async function areNetEaseSongsUnplayable(songs: NcmSong[]): Promise<boolean> {
  const netease = songs.filter((s) => !isThirdPartySong(s.songId));
  if (!netease.length) return true;
  // 只探测前 20 首即可代表搜索结果的可播性
  const ids = netease.slice(0, 20).map((s) => s.ncmId);
  try {
    const raw = await ncmApi.getSongUrls(ids);
    const data = raw?.data;
    if (!Array.isArray(data)) return true;
    const anyPlayable = data.some((d) => !!d?.url);
    return !anyPlayable;
  } catch (err) {
    console.warn('[THIRD_PARTY_PROBE] failed:', err instanceof Error ? err.message : err);
    return true;
  }
}

/** 歌曲来源标签（搜索行徽章用） */
export type SongSourceTag = 'netease' | 'gequbao' | 'kuwo';

export function getSongSourceTag(song: NcmSong): SongSourceTag {
  return song.provider ?? 'netease';
}

/** 关键词与歌曲相关性评分（越高越靠前）。打分无关来源，纯按文本贴合度。 */
export function relevanceScore(song: NcmSong, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const title = song.title.toLowerCase();
  const artist = song.artists[0]?.name?.toLowerCase() ?? '';
  const qTokens = q.split(/[\s、,，.．·/]+/).filter(Boolean);
  const titleTokens = title.split(/[\s、,，.．·/]+/).filter(Boolean);

  let score = 0;
  if (title === q) score += 1000; // 标题完全相等
  else if (title.startsWith(q)) score += 800; // 标题前缀
  else if (title.includes(q)) score += 600; // 标题包含
  else if (titleTokens.length && qTokens.length) {
    // 分词命中：覆盖度比例
    const hit = titleTokens.filter((t) => qTokens.some((qt) => t.includes(qt) || qt.includes(t)));
    score += 400 * (hit.length / Math.max(titleTokens.length, 1));
  }

  // 歌手匹配加成（部分 query 本身是歌手名）
  if (qTokens.some((qt) => artist.includes(qt) || qt.includes(artist))) score += 150;
  if (q === artist) score += 200;

  return score;
}

/**
 * 合并网易云 + 第三方并按键相关性排序（来源混排，最接近的在前）。
 * 稳定排序：同分时保留原顺序（网易云在前）。
 */
export function mergeAndRankSongs(netEaseSongs: NcmSong[], thirdPartySongs: NcmSong[], keyword: string): NcmSong[] {
  const merged = [...netEaseSongs, ...thirdPartySongs];
  return merged
    .map((song, index) => ({ song, index, score: relevanceScore(song, keyword) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.song);
}
