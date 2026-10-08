import { searchQuery } from '@renderer/queries/search';
import { NcmRepository } from '@renderer/ncm/repository';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

/**
 * 首页搜索浮层的数据 hook:关键词状态 + 防抖 + 复用现有搜索数据层(searchQuery),
 * 同时合并网易云歌曲搜索结果(通过 NcmRepository.searchSongs)。
 * 不修改任何搜索 API/Queue/Playback/Audio/NCM resolver。
 * 返回结果按歌曲/歌手/歌单分组,供 SearchDropdown 渲染。
 * 网易云歌曲 songId 为负值,天然不与本地歌曲(正值)冲突,播放时按正负分流。
 * 另提供搜索历史:读 recentSearches + 删除单条/清空全部。
 */
const DEBOUNCE_MS = 300;
const NCM_PAGE_SIZE = 50;

export default function useSearch() {
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');

  // 防抖:输入停止 300ms 后才真正查询
  useEffect(() => {
    const trimmed = keyword.trim();
    if (!trimmed) {
      setDebouncedKeyword('');
      return;
    }
    const timer = window.setTimeout(() => setDebouncedKeyword(trimmed), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  // 本地数据库搜索(歌曲/歌手/歌单/专辑/流派),并写入搜索历史
  const localSearch = useQuery({
    ...searchQuery.query({
      keyword: debouncedKeyword,
      filter: 'All',
      updateSearchHistory: true,
      isSimilaritySearchEnabled: false
    }),
    enabled: debouncedKeyword.length > 0
  });

  // 网易云歌曲搜索:按页(50 首)无限分页,滚动到底部 fetchNextPage 追加
  const ncmSearch = useInfiniteQuery({
    queryKey: ['ncm-search-songs', debouncedKeyword],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => NcmRepository.searchSongs(debouncedKeyword, NCM_PAGE_SIZE, pageParam),
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      const nextOffset = lastPageParam + lastPage.songs.length;
      return lastPage.songCount > nextOffset ? nextOffset : undefined;
    },
    enabled: debouncedKeyword.length > 0
  });

  // 搜索历史(最近 10 条,由主进程 search.ts 维护)
  const recentSearchQuery = useQuery(searchQuery.recentResults);

  const results = useMemo<SearchResult | undefined>(() => {
    const local = localSearch.data;
    const ncmSongs = (ncmSearch.data?.pages?.flatMap((p) => p.songs) ?? []) as unknown as SongData[];
    if (!local && ncmSongs.length === 0) return undefined;
    return {
      songs: [...ncmSongs, ...(local?.songs ?? [])],

      // 本地搜索的歌手/歌单/专辑/流派——只取首屏,不做分页
      artists: local?.artists ?? [],
      albums: local?.albums ?? [],
      playlists: local?.playlists ?? [],
      genres: local?.genres ?? [],
      availableResults: local?.availableResults ?? []
    };
  }, [localSearch.data, ncmSearch.data]);

  const invalidateHistory = () => queryClient.invalidateQueries({ queryKey: searchQuery.recentResults.queryKey });

  /** 删除单条历史 */
  const deleteHistoryItem = async (term: string) => {
    await window.api.search.clearSearchHistory([term]);
    invalidateHistory();
  };

  /** 清空全部历史 */
  const clearAllHistory = async () => {
    await window.api.search.clearSearchHistory();
    invalidateHistory();
  };

  return {
    keyword,
    setKeyword,
    results,
    isFetching: localSearch.isFetching || ncmSearch.isFetching,
    loadMoreSongs: ncmSearch.fetchNextPage,
    recentSearches: recentSearchQuery.data ?? [],
    deleteHistoryItem,
    clearAllHistory
  };
}
