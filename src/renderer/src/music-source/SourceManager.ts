/**
 * SourceManager — 统一数据源管理器。
 */

import type { MusicSource, UnifiedSearchResult, SearchResultItem } from './types';
import { neteaseMusicSource } from './NeteaseMusicSource';
import { localMusicSource } from './LocalMusicSource';

const sources = new Map<string, MusicSource>();
sources.set('netease', neteaseMusicSource);
sources.set('local', localMusicSource);

// 搜索缓存
const searchCache = new Map<string, { data: UnifiedSearchResult; ts: number }>();
const CACHE_TTL = 2 * 60 * 1000; // 2 分钟

function sortResults(items: SearchResultItem[], query: string): SearchResultItem[] {
  const q = query.toLowerCase();
  return [...items].sort((a, b) => {
    const aTitle = a.title.toLowerCase();
    const bTitle = b.title.toLowerCase();
    // 1. exact match
    if (aTitle === q && bTitle !== q) return -1;
    if (bTitle === q && aTitle !== q) return 1;
    // 2. starts with
    const aStarts = aTitle.startsWith(q);
    const bStarts = bTitle.startsWith(q);
    if (aStarts && !bStarts) return -1;
    if (bStarts && !aStarts) return 1;
    // 3. contains
    const aHas = aTitle.includes(q);
    const bHas = bTitle.includes(q);
    if (aHas && !bHas) return -1;
    if (bHas && !aHas) return 1;
    // 4. artist match
    const aArtist = a.artists.toLowerCase().includes(q);
    const bArtist = b.artists.toLowerCase().includes(q);
    if (aArtist && !bArtist) return -1;
    if (bArtist && !aArtist) return 1;
    return 0;
  });
}

export const SourceManager = {
  register(source: MusicSource) {
    sources.set(source.name, source);
  },

  get(name: string): MusicSource | undefined {
    return sources.get(name);
  },

  get netease(): MusicSource {
    return sources.get('netease')!;
  },

  get local(): MusicSource {
    return sources.get('local')!;
  },

  async searchAll(query: string, limit = 30): Promise<UnifiedSearchResult> {
    if (!query.trim()) return { items: [], total: 0 };

    const cacheKey = `search:${query.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

    // 并行搜索，互不影响
    const [localRes, neteaseRes] = await Promise.all([
      localMusicSource.search(query, limit).catch(() => ({ items: [], total: 0 } as UnifiedSearchResult)),
      neteaseMusicSource.search(query, limit).catch(() => ({ items: [], total: 0 } as UnifiedSearchResult)),
    ]);

    const allItems = sortResults([...localRes.items, ...neteaseRes.items], query).slice(0, limit);
    const result: UnifiedSearchResult = { items: allItems, total: localRes.total + neteaseRes.total };

    searchCache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  },

  clearSearchCache() {
    searchCache.clear();
  },

  list(): MusicSource[] {
    return [...sources.values()];
  },
};
