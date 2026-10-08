import DefaultSongCover from '@renderer/assets/images/webp/song_cover_default.webp';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import type { NcmSong } from '@renderer/ncm/types';
import toggleSongIsFavorite from '@renderer/other/toggleSongIsFavorite';
import { store } from '@renderer/store/store';
import { useNavigate } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { lazy, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SearchDropdown from './SearchDropdown';
import { getSongCover } from './songMeta';
import useSearch from './useSearch';

const AddSongsToPlaylistsPrompt = lazy(
  () => import('@renderer/components/SongsPage/AddSongsToPlaylistsPrompt')
);
const NcmSelectPlaylistsPrompt = lazy(
  () => import('@renderer/components/NcmSelectPlaylistsPrompt')
);

/**
 * Home 顶部悬浮搜索栏。 - 固定在 Home 顶部,点击聚焦展开下拉 - 调用现有搜索数据层(useSearch → searchQuery),不修改
 * Queue/Playback/Audio/NCM resolver - 点击外部或 ESC 关闭下拉 - 点击歌曲直接走现有播放流程(createQueue + playSong) -
 * 歌曲行右键弹出与歌曲卡片一致的上下文菜单
 */
const SearchBar = () => {
  const {
    createQueue,
    playSong,
    updateContextMenuData,
    updateQueueData,
    addNewNotifications,
    changePromptMenuData,
    toggleIsFavorite,
    toggleMultipleSelections
  } = useContext(AppUpdateContext);
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queue = useStore(store, (state) => state.localStorage.queue);
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const {
    keyword,
    setKeyword,
    results,
    isFetching,
    loadMoreSongs,
    recentSearches,
    deleteHistoryItem,
    clearAllHistory
  } = useSearch();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 点击外部关闭:监听 document mousedown,点击不在容器内则收起
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 全局快捷键 goToSearch → 回到 Home 并聚焦搜索栏
  useEffect(() => {
    const openSearch = () => {
      setIsOpen(true);
      inputRef.current?.focus();
    };
    window.addEventListener('open-home-search', openSearch);
    return () => window.removeEventListener('open-home-search', openSearch);
  }, []);

  // ESC 关闭并失焦
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation(); // 不触发全局快捷键(如全局搜索快捷键)
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const handleSongClick = (song: SongData) => {
    setIsOpen(false);
    // 网易云歌曲 (songId 为负) → 走 NCM 在线播放链路
    if (song.songId < 0) {
      PlaybackBridge.playSong(song as unknown as NcmSong).catch((err) =>
        console.error('NCM 播放失败:', err)
      );
      return;
    }
    const songIds = results?.songs.filter((s) => !s.isBlacklisted).map((s) => s.songId) ?? [];
    createQueue(songIds, 'songs', false, undefined, false);
    playSong(song.songId, true);
  };

  /** 歌曲行右键菜单:与 SongCard 菜单一致 */
  const handleSongContextMenu = useCallback(
    (e: React.MouseEvent, song: SongData) => {
      e.preventDefault();
      e.stopPropagation();
      const { songId, title } = song;
      const isNcm = songId < 0;
      const isFavorite = song.isAFavorite;

      const playNext = () => {
        const newQueue = queue.songIds.filter((id) => id !== songId);
        newQueue.splice(newQueue.indexOf(currentSongData.songId) + 1 || 0, 0, songId);
        const duplicateSongIndex = queue.songIds.indexOf(songId);
        const currentSongIndex =
          queue.position && duplicateSongIndex !== -1 && duplicateSongIndex < queue.position
            ? queue.position - 1
            : queue.position;
        updateQueueData(currentSongIndex, newQueue, undefined, false);
        addNewNotifications([
          {
            id: `${title}PlayNext`,
            content: t('notifications.playingNext', { title }),
            iconName: 'shortcut'
          }
        ]);
      };

      const addToQueueEnd = () => {
        updateQueueData(undefined, [...queue.songIds, songId], false);
        addNewNotifications([
          {
            id: `${title}AddedToQueue`,
            content: t('notifications.addedToQueue', { count: 1 }),
            icon: (
              <img
                src={getSongCover(song) || DefaultSongCover}
                alt="Song Artwork"
                className="h-8 w-8 rounded object-cover"
              />
            )
          }
        ]);
      };

      const toggleLike = () => {
        if (isNcm) {
          toggleSongIsFavorite(songId, isFavorite)
            .then(() => {
              if (currentSongData.songId === songId)
                toggleIsFavorite(!currentSongData.isAFavorite, true);
            })
            .catch((err) => console.error(err));
          return;
        }
        window.api.playerControls
          .toggleLikeSongs([songId], !isFavorite)
          .then((res) => {
            if (res && res.likes.length + res.dislikes.length > 0) {
              if (currentSongData.songId === songId)
                toggleIsFavorite(!currentSongData.isAFavorite, true);
            }
          })
          .catch((err) => console.error(err));
      };

      const contextMenuItems: ContextMenuItem[] = [
        {
          label: t('common.play'),
          handlerFunction: () => {
            if (isNcm) {
              PlaybackBridge.playSong(song as unknown as NcmSong).catch((err) =>
                console.error('NCM 播放失败:', err)
              );
            } else {
              playSong(songId);
            }
          },
          iconName: 'play_arrow'
        },
        {
          label: t('common.playNext'),
          iconName: 'shortcut',
          handlerFunction: playNext
        },
        {
          label: t('common.addToQueue'),
          iconName: 'queue',
          handlerFunction: addToQueueEnd
        },
        {
          label: t(`song.${isFavorite ? 'unlikeSong' : 'likeSong'}`),
          iconName: 'favorite',
          iconClassName: isFavorite
            ? 'material-icons-round mr-4 text-xl'
            : 'material-icons-round-outlined mr-4 text-xl',
          handlerFunction: toggleLike
        },
        {
          label: t('song.addToPlaylists'),
          iconName: 'playlist_add',
          handlerFunction: () => {
            changePromptMenuData(
              true,
              <AddSongsToPlaylistsPrompt songIds={[songId]} title={title} />
            );
          }
        },
        // NCM: 加入网易云歌单
        ...(isNcm
          ? [
              {
                label: t('ncm.addToNcmPlaylist'),
                iconName: 'playlist_add',
                handlerFunction: () => {
                  changePromptMenuData(
                    true,
                    <NcmSelectPlaylistsPrompt songIds={[-songId]} title={title} />
                  );
                }
              }
            ]
          : []),
        {
          label: 'Hr',
          isContextMenuItemSeperator: true,
          handlerFunction: () => true
        },
        {
          label: t('song.showInFileExplorer'),
          class: 'reveal-file-explorer',
          iconName: 'folder_open',
          handlerFunction: () => window.api.songUpdates.revealSongInFileExplorer(songId),
          isDisabled: isNcm
        },
        {
          label: t('common.info'),
          class: 'info',
          iconName: 'info',
          handlerFunction: () =>
            navigate({ to: '/main-player/songs/$songId', params: { songId: String(songId) } })
        }
      ];

      updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY, {
        title: title || t('common.unknownTitle'),
        subTitle: song.artists?.map((a) => a.name).join(', ') ?? t('common.unknownArtist'),
        artworkPath: getSongCover(song) || DefaultSongCover
      });
    },
    [
      addNewNotifications,
      changePromptMenuData,
      currentSongData.songId,
      currentSongData.isAFavorite,
      navigate,
      playSong,
      queue.position,
      queue.songIds,
      t,
      toggleIsFavorite,
      updateContextMenuData,
      updateQueueData
    ]
  );

  const handleArtistClick = (artist: Artist) => {
    setIsOpen(false);
    navigate({
      to: '/main-player/artists/$artistId',
      params: { artistId: String(artist.artistId) }
    });
  };

  const handlePlaylistClick = (playlist: Playlist) => {
    setIsOpen(false);
    navigate({
      to: '/main-player/playlists/$playlistId',
      params: { playlistId: String(playlist.playlistId) }
    });
  };

  // 点击历史条目 → 回填关键词并触发搜索
  const handleHistoryClick = (term: string) => {
    setKeyword(term);
    setIsOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <div className="global-search-field flex h-11 items-center gap-2 rounded-full px-3 transition-colors">
        <span aria-hidden="true" className="material-icons-round-outlined text-font-color-highlight dark:text-dark-font-color-highlight shrink-0 text-lg leading-none">
          search
        </span>
        <input
          ref={inputRef}
          type="text"
          value={keyword}
          aria-label="搜索歌曲或歌手"
          placeholder="搜索音乐…"
          className="text-font-color-black placeholder:text-font-color-highlight dark:text-font-color-white dark:placeholder:text-dark-font-color-highlight min-w-0 flex-1 bg-transparent text-sm outline-none focus:outline-none focus-visible:outline-none!"
          onChange={(e) => {
            setKeyword(e.currentTarget.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {keyword && (
          <button
            type="button"
            aria-label="Clear search"
            className="material-icons-round-outlined shrink-0 cursor-pointer text-base leading-none opacity-50 hover:opacity-100"
            onClick={() => {
              setKeyword('');
              inputRef.current?.focus();
            }}
          >
            close
          </button>
        )}
      </div>
      {isOpen && (keyword.trim().length > 0 || isFetching || recentSearches.length > 0) && (
        <SearchDropdown
          keyword={keyword}
          results={results}
          isFetching={isFetching}
          recentSearches={recentSearches}
          onSongClick={handleSongClick}
          onArtistClick={handleArtistClick}
          onPlaylistClick={handlePlaylistClick}
          onHistoryClick={handleHistoryClick}
          onDeleteHistoryItem={deleteHistoryItem}
          onClearAllHistory={clearAllHistory}
          onLoadMore={loadMoreSongs}
          onSongContextMenu={handleSongContextMenu}
        />
      )}
    </div>
  );
};

export default SearchBar;
