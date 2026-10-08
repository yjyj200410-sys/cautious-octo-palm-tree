import { useState } from 'react';
import { NcmRepository, type NcmSong, proxyCoverUrl } from '../ncm';
import { PlaybackBridge } from '../ncm/playback/PlaybackBridge';

export default function NcmTestPage() {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [songs, setSongs] = useState<NcmSong[]>([]);
  const [error, setError] = useState('');
  const [count, setCount] = useState(0);
  const [rawFirstSong, setRawFirstSong] = useState('');
  const [playingId, setPlayingId] = useState<number | null>(null);

  const doSearch = async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError('');
    setRawFirstSong('');
    try {
      const result = await NcmRepository.searchSongs(keyword.trim());
      setSongs(result.songs);
      setCount(result.songCount);
      if (result.songs.length > 0) {
        setRawFirstSong(JSON.stringify(result.songs[0], null, 2));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSongs([]);
      setCount(0);
    } finally {
      setLoading(false);
    }
  };

  const handlePlay = async (song: NcmSong, index: number) => {
    setPlayingId(song.songId);
    try {
      // 播放当前列表，从点击位置开始
      await PlaybackBridge.playSongs(songs, index);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPlayingId(null);
    }
  };

  const formatDuration = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold">网易云搜索</h1>

      <div className="mb-4 flex gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
          placeholder="搜索网易云歌曲..."
          className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm"
        />
        <button
          onClick={doSearch}
          disabled={loading}
          className="rounded-md bg-purple-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? '...' : '搜索'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-900/30 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {count > 0 && (
        <div className="mb-2 text-xs text-gray-400">共 {count} 首 · 点击播放</div>
      )}

      <div className="space-y-1">
        {songs.map((song, i) => (
          <div
            key={song.songId}
            onClick={() => handlePlay(song, i)}
            className={`flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-white/10 ${
              playingId === song.songId ? 'bg-purple-900/30' : ''
            }`}
          >
            <img
              src={proxyCoverUrl(song.coverUrl)}
              alt=""
              className="h-10 w-10 rounded"
              style={{ objectFit: 'cover' }}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">{song.title}</div>
              <div className="truncate text-xs text-gray-400">
                {song.artists.map((a) => a.name).join(' / ')}
                {song.album.name ? ` · ${song.album.name}` : ''}
              </div>
            </div>
            <div className="text-xs tabular-nums text-gray-500">
              {formatDuration(song.duration)}
            </div>
          </div>
        ))}
      </div>

      {!loading && !error && songs.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500">
          输入关键词搜索
        </div>
      )}

      {rawFirstSong && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-gray-400">首条原始数据</summary>
          <pre className="mt-2 max-h-[300px] overflow-auto rounded bg-black/30 p-3 text-xs text-gray-300">{rawFirstSong}</pre>
        </details>
      )}
    </div>
  );
}
