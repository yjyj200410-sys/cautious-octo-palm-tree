/**
 * NcmUnifiedSearch — 统一搜索页面。
 * 同时搜索本地和网易云，合并显示。
 */

import { useState } from 'react';
import { SourceManager, type SearchResultItem } from '../music-source';
import { proxyCoverUrl } from '../ncm';
import { PlaybackBridge } from '../ncm/playback/PlaybackBridge';
import { NcmRepository } from '../ncm/repository';
import type { NcmSong } from '../ncm/types';

export default function NcmUnifiedSearch() {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await SourceManager.searchAll(keyword.trim(), 30);
      setItems(result.items);
      setTotal(result.total);
      if (result.items.length === 0) setError('未找到结果');
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = async (item: SearchResultItem) => {
    try {
      if (item.source === 'local') {
        // 本地歌曲：直接调用 playSong（songId > 0）
        const player = (window as unknown as Record<string, unknown>).__noraPlayer as {
          queue: { replaceQueue: (ids: number[], pos: number, clearShuffle: boolean, meta: Record<string, unknown>) => void };
          playSongById: (id: number, opts?: Record<string, unknown>) => Promise<void>;
        } | undefined;
        if (player) {
          player.queue.replaceQueue([item.id], 0, true, { queueType: 'songs', queueId: 'local' });
          await player.playSongById(item.id, { autoPlay: true });
        }
      } else {
        // 网易云歌曲：通过 PlaybackBridge
        const detail = await NcmRepository.songDetail([item.sourceId]);
        if (detail.length > 0) {
          await PlaybackBridge.playSong(detail[0] as unknown as NcmSong);
        }
      }
    } catch (err) {
      console.error('Play error:', err);
    }
  };

  const formatDuration = (s: number) => {
    if (!s || s <= 0) return '--:--';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };

  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold">搜索</h2>

      <div className="mb-4 flex gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="搜索本地或网易云歌曲..."
          className="flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
        <button
          onClick={doSearch}
          disabled={loading}
          className="rounded-md bg-purple-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? '...' : '搜索'}
        </button>
      </div>

      {error && !loading && (
        <div className="mb-4 rounded-md bg-red-900/30 px-3 py-2 text-sm text-red-300">{error}</div>
      )}

      {total > 0 && (
        <div className="mb-2 text-xs text-gray-400">共 {total} 条结果</div>
      )}

      <div className="space-y-1">
        {items.map((item) => (
          <div
            key={`${item.source}-${item.id}`}
            onClick={() => handlePlay(item)}
            className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-white/10"
          >
            {/* 封面 */}
            {item.source === 'netease' && item.cover ? (
              <img src={proxyCoverUrl(item.cover)} alt="" className="h-10 w-10 rounded" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded bg-white/10 text-xs text-gray-500">
                本地
              </div>
            )}

            {/* 信息 */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{item.title}</div>
              <div className="truncate text-xs text-gray-400">
                {item.artists}{item.album ? ` · ${item.album}` : ''}
              </div>
            </div>

            {/* 来源标签 */}
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                item.source === 'netease'
                  ? 'bg-red-900/40 text-red-300'
                  : 'bg-blue-900/40 text-blue-300'
              }`}
            >
              {item.source === 'netease' ? '网易云' : '本地'}
            </span>

            {/* 时长 */}
            <div className="text-xs tabular-nums text-gray-500">
              {formatDuration(item.duration)}
            </div>
          </div>
        ))}
      </div>

      {!loading && !error && items.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500">输入关键词开始搜索</div>
      )}
    </div>
  );
}
