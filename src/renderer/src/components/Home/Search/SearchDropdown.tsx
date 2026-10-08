import { useEffect, useRef, useState } from 'react';

import SearchResultItem from './SearchResultItem';
import { formatSongDuration, getSongCover } from './songMeta';

/**
 * 搜索下拉浮层:从搜索栏下方展开,最大高度 + 滚动。
 * - 空关键词:显示搜索历史(recentSearches),每条可单独删除,底部一键清空
 * - 有关键词:分组展示 歌曲 / 歌手 / 歌单;歌曲行带封面 + 时长,
 *   点击歌曲直接走现有播放流程,歌手/歌单跳转对应详情页。
 * - 歌曲列表首次展示 PAGE_STEP 条,滚动到底自动加载更多(NCM 每页 50,本地全量)。
 * - NCM 歌曲(songId<0)封面走代理、时长按毫秒换算。
 */
interface SearchDropdownProps {
  keyword: string;
  results?: SearchResult;
  isFetching: boolean;
  recentSearches: string[];
  onSongClick: (song: SongData) => void;
  onArtistClick: (artist: Artist) => void;
  onPlaylistClick: (playlist: Playlist) => void;
  onHistoryClick: (term: string) => void;
  onDeleteHistoryItem: (term: string) => void;
  onClearAllHistory: () => void;
  /** 滚动到底触发,追加下一页歌曲(NCM) */
  onLoadMore: () => void;
  /** 歌曲行右键菜单 */
  onSongContextMenu: (e: React.MouseEvent, song: SongData) => void;
}

const MAX_SONGS = 50;
const MAX_ARTISTS = 3;
const MAX_PLAYLISTS = 3;

const SearchDropdown = ({
  keyword,
  results,
  isFetching,
  recentSearches,
  onSongClick,
  onArtistClick,
  onPlaylistClick,
  onHistoryClick,
  onDeleteHistoryItem,
  onClearAllHistory,
  onLoadMore,
  onSongContextMenu
}: SearchDropdownProps) => {
  // 首次展示 MAX_SONGS 条,滚动到底每次追加 MAX_SONGS 条
  const [visibleCount, setVisibleCount] = useState(MAX_SONGS);
  const listRef = useRef<HTMLDivElement>(null);

  // 关键词变化时重置分页
  useEffect(() => {
    setVisibleCount(MAX_SONGS);
  }, [keyword]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el || el.scrollTop + el.clientHeight < el.scrollHeight - 40) return;
    if (visibleCount >= (results?.songs.length ?? 0)) return; // 已显示完当前全部,等 onLoadMore 追加
    setVisibleCount((c) => c + MAX_SONGS);
    onLoadMore();
  };

  const allSongs = results?.songs ?? [];
  const songs = allSongs.slice(0, visibleCount);
  const artists = results?.artists.slice(0, MAX_ARTISTS) ?? [];
  const playlists = results?.playlists.slice(0, MAX_PLAYLISTS) ?? [];
  const isEmpty =
    keyword.trim().length > 0 && songs.length === 0 && artists.length === 0 && playlists.length === 0;

  const historyVisible = keyword.trim().length === 0 && recentSearches.length > 0;

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="absolute left-0 top-full z-50 mt-2 w-[clamp(18rem,32vw,26rem)] max-w-[calc(100vw_-_24px)] max-h-[50vh] overflow-y-auto rounded-xl py-1 shadow-2xl"
      style={{
        background: 'rgba(102,102,102,0.18)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)'
      }}
    >
      {isFetching && (
        <div className="px-4 py-3 text-sm text-white/45">Searching…</div>
      )}

      {/* 搜索历史:空关键词时展示 */}
      {historyVisible && (
        <>
          <div className="flex items-center px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-white/35">
            <span className="flex-1">Recent</span>
            <button
              type="button"
              className="cursor-pointer px-1 py-0.5 text-[11px] font-normal normal-case tracking-normal text-white/45 transition-colors hover:text-white/80"
              onClick={onClearAllHistory}
            >
              清除全部
            </button>
          </div>
          {recentSearches.map((term) => (
            <div
              key={term}
              className="group flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-[background] duration-150 hover:bg-white/10"
              onClick={() => onHistoryClick(term)}
            >
              <span className="material-icons-round-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-white/5 text-lg leading-none text-white/45">
                history
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-white/85">{term}</span>
              <button
                type="button"
                aria-label={`删除 ${term}`}
                className="material-icons-round-outlined cursor-pointer p-1 text-base leading-none text-white/35 opacity-0 transition-all hover:text-white/80 focus-visible:opacity-100 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteHistoryItem(term);
                }}
              >
                close
              </button>
            </div>
          ))}
        </>
      )}

      {!isFetching && isEmpty && (
        <div className="px-4 py-3 text-sm text-white/45">No results for “{keyword.trim()}”</div>
      )}

      {!historyVisible && songs.length > 0 && (
        <>
          <div className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-white/35">
            Songs
          </div>
          {songs.map((song) => (
            <SearchResultItem
              key={`song-${song.songId}`}
              iconName="music_note"
              cover={getSongCover(song)}
              title={song.title}
              subtitle={song.artists?.map((a) => a.name).join(', ')}
              duration={formatSongDuration(song)}
              onClick={() => onSongClick(song)}
              onContextMenu={(e) => onSongContextMenu(e, song)}
            />
          ))}
        </>
      )}
      {!historyVisible && artists.length > 0 && (
        <>
          <div className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-white/35">
            Artists
          </div>
          {artists.map((artist) => (
            <SearchResultItem
              key={`artist-${artist.artistId}`}
              iconName="person"
              title={artist.name}
              onClick={() => onArtistClick(artist)}
            />
          ))}
        </>
      )}
      {!historyVisible && playlists.length > 0 && (
        <>
          <div className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-white/35">
            Playlists
          </div>
          {playlists.map((playlist) => (
            <SearchResultItem
              key={`playlist-${playlist.playlistId}`}
              iconName="queue_music"
              title={playlist.name}
              onClick={() => onPlaylistClick(playlist)}
            />
          ))}
        </>
      )}
    </div>
  );
};

export default SearchDropdown;
