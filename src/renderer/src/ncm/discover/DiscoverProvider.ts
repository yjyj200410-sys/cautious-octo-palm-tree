/**
 * DiscoverProvider — 发现音乐(DiscoverPool)数据层。
 *
 * PlaylistRail 的 discover 数据源。混合多数据源、按 playlistId 去重、支持无限加载、
 * 缓存上限裁剪——不再依赖单一 personalized 接口(该接口不支持分页)。
 *
 * 数据源:
 * 1. personalized 推荐(已去雷达,前 10)   — NcmRepository.personalizedPlaylists
 * 2. 热门歌单 top/playlist(每页 20,分页) — NcmRepository.topPlaylists
 *
 * 缓存:内部 Map<playlistId, NcmPlaylist> 去重,超出 MAX_CACHE 移除最早加载(远离视口的头部),
 * 防止非虚拟列表的 PlaylistRail DOM 无限增长。
 */
import { NcmRepository } from '../repository';
import type { NcmPlaylist } from '../types';

const INITIAL_PERSONALIZED = 10;
const TOP_PAGE_SIZE = 20;
const MAX_CACHE = 50;

/** 按 playlistId 去重的缓存池(插入序 = 加载序) */
const pool = new Map<number, NcmPlaylist>();
let topOffset = 0;
let loading = false;
let initialized = false;
let hasMore = true;
let accountEpoch = 0;
/** 受保护 playlistId 集合(正被中心卡/LibraryPanel 使用,trim 跳过) */
const pinnedIds = new Set<number>();

/** 追加并去重,随后裁剪到上限 */
function pushFresh(list: NcmPlaylist[]): void {
  for (const pl of list) {
    if (!pool.has(pl.playlistId)) pool.set(pl.playlistId, pl);
  }
  trim();
}

/**
 * 缓存上限裁剪:超出 MAX_CACHE 时按「最早插入」淘汰。受保护 id(pinnedIds)跳过——
 * 避免正在浏览的中心卡/正展示的 LibraryPanel 歌单被剔除。
 */
function trim(): void {
  const excess = pool.size - MAX_CACHE;
  if (excess <= 0) return;
  let removed = 0;
  for (const key of pool.keys()) {
    if (removed >= excess) break;
    if (pinnedIds.has(key)) continue;
    pool.delete(key);
    removed++;
  }
}

async function loadTopPage(offset: number): Promise<NcmPlaylist[]> {
  const pls = await NcmRepository.topPlaylists(TOP_PAGE_SIZE, offset);
  return pls.filter((pl) => !NcmRepository._isRadar(pl));
}

export interface DiscoverProvider {
  readonly items: NcmPlaylist[];
  readonly loading: boolean;
  readonly hasMore: boolean;
  loadInitial(): Promise<void>;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
  resetAccount(): void;
  /** 声明当前受保护的 playlistId 集合(trim 淘汰时跳过) */
  setPinnedIds(ids: Set<number>): void;
}

export const DiscoverProvider: DiscoverProvider = {
  get items(): NcmPlaylist[] {
    return [...pool.values()];
  },
  get loading(): boolean {
    return loading;
  },
  get hasMore(): boolean {
    return hasMore;
  },

  /** 首次加载:personalized 10 + 热门歌单第一页 20 → 30 个 */
  async loadInitial(): Promise<void> {
    if (initialized) return;
    const epoch = accountEpoch;
    loading = true;
    try {
      const [personalized, top] = await Promise.all([
        NcmRepository.personalizedPlaylists(60).then((pls) =>
          pls.slice(0, INITIAL_PERSONALIZED)
        ),
        loadTopPage(0),
      ]);
      if (epoch !== accountEpoch) return;
      topOffset = TOP_PAGE_SIZE;
      pushFresh([...personalized, ...top]);
      initialized = true;
    } finally {
      if (epoch === accountEpoch) loading = false;
    }
  },

  /** 追加热门歌单下一页(每页 20);hasMore 为 false 后不再请求 */
  async loadMore(): Promise<void> {
    if (!initialized || loading || !hasMore) return;
    const epoch = accountEpoch;
    loading = true;
    try {
      const next = await loadTopPage(topOffset);
      if (epoch !== accountEpoch) return;
      if (next.length === 0) {
        hasMore = false;
        return;
      }
      topOffset += TOP_PAGE_SIZE;
      pushFresh(next);
    } catch {
      // 单次失败保留 hasMore,下次滚动重试;不永久终止无限流
    } finally {
      if (epoch === accountEpoch) loading = false;
    }
  },

  /** 全量刷新:清空池子重新 loadInitial */
  async refresh(): Promise<void> {
    this.resetAccount();
    await this.loadInitial();
  },

  resetAccount(): void {
    accountEpoch += 1;
    pool.clear();
    topOffset = 0;
    loading = false;
    initialized = false;
    hasMore = true;
    pinnedIds.clear();
  },

  /** 覆盖受保护 id 集合:loadMore 前由调用方传入当前中心卡 + LibraryPanel 展示 id */
  setPinnedIds(ids: Set<number>): void {
    pinnedIds.clear();
    for (const id of ids) pinnedIds.add(id);
  },
};
