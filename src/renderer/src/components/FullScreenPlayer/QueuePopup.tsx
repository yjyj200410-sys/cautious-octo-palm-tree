import VipBadge from '../VipBadge';
import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { lazy, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { useQuery } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import { useQueueOperations } from '../../hooks/useQueueOperations';
import toggleSongIsFavorite from '../../other/toggleSongIsFavorite';
import { FavoriteService } from '../../utils/unifiedStorage';
import Img from '../Img';
import calculateTime from '../../utils/calculateTime';
import { useTranslation } from 'react-i18next';
import { motionDuration } from '@renderer/utils/motionPreference';
import { getQueue } from '../../other/queueSingleton';

const AddSongsToPlaylistsPrompt = lazy(() => import('../SongsPage/AddSongsToPlaylistsPrompt'));
const NcmSelectPlaylistsPrompt = lazy(() => import('../NcmSelectPlaylistsPrompt'));

type Props = {
  isOpen: boolean;
  onClose: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
};

type AnimPhase = 'entering' | 'visible' | 'exiting';

/** 单首歌独立浮动卡片 */
const QueueCard = ({
  song,
  isCurrent,
  isPlaying,
  onClick,
  onContextMenu,
}: {
  song: SongData;
  isCurrent: boolean;
  isPlaying: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) => {
  return (
    <button
      className={`queue-card-glass relative flex w-full shrink-0 items-center px-4 py-2 text-left cursor-pointer transition-colors`}
      data-current={isCurrent}
      aria-current={isCurrent ? 'true' : undefined}
      style={{
        gap: 14,
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
    <div className="relative shrink-0">
      <Img
        src={song.artworkPaths?.artworkPath}
        fallbackSrc={DefaultSongCover}
        className="aspect-square w-11 rounded-md object-cover"
        alt=""
        loading="eager"
      />
      {isCurrent && isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/40">
          <span className="material-icons-round text-xs text-white">play_arrow</span>
        </div>
      )}
    </div>
    <div className="min-w-0 flex-1">
      <div
        className={`queue-song-title truncate text-base font-medium leading-tight ${
          isCurrent
            ? 'text-font-color-highlight dark:text-dark-font-color-highlight'
            : 'text-white/90'
        }`}
      >
        {song.title} <VipBadge isVip={song.isVip} />
      </div>
      <div className="truncate text-[13px] text-white/40 leading-tight">
        {song.artists?.map((a) => a.name).join(', ') || '未知歌手'}
        <span className="mx-1 opacity-30">·</span>
        {calculateTime(song.duration).minutes}:{calculateTime(song.duration).seconds}
      </div>
    </div>
    {isCurrent && (
      isPlaying ? (
        <span className="eq-bars shrink-0 flex items-end" style={{ gap: 1, height: 16 }}>
          <span className="eq-bar w-[3px] rounded-full bg-font-color-highlight dark:bg-dark-font-color-highlight" style={{ animation: 'eq-bar-1 600ms ease-in-out infinite alternate' }} />
          <span className="eq-bar w-[3px] rounded-full bg-font-color-highlight dark:bg-dark-font-color-highlight" style={{ animation: 'eq-bar-2 500ms ease-in-out infinite alternate' }} />
          <span className="eq-bar w-[3px] rounded-full bg-font-color-highlight dark:bg-dark-font-color-highlight" style={{ animation: 'eq-bar-3 700ms ease-in-out infinite alternate' }} />
          <span className="eq-bar w-[3px] rounded-full bg-font-color-highlight dark:bg-dark-font-color-highlight" style={{ animation: 'eq-bar-4 450ms ease-in-out infinite alternate' }} />
        </span>
      ) : (
        <span className="material-icons-round shrink-0 text-base text-font-color-highlight dark:text-dark-font-color-highlight">music_note</span>
      )
    )}
  </button>
  );
};
const QueuePopup = ({ isOpen, onClose, containerRef }: Props) => {
  const queue = useStore(store, (state) => state.localStorage.queue);
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const isShuffling = useStore(store, (state) => state.player.isShuffling);
  const isRepeating = useStore(store, (state) => state.player.isRepeating);
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const {
    updateQueueData,
    toggleRepeat,
    toggleQueueShuffle,
    updateContextMenuData,
    changePromptMenuData,
    addNewNotifications,
    toggleMultipleSelections,
    toggleIsFavorite
  } = useContext(AppUpdateContext);
  const { addToNext } = useQueueOperations();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [phase, setPhase] = useState<AnimPhase | 'hidden'>('hidden');

  const songIds = queue.songIds ?? [];
  const { data: queriedSongs, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: ['fullscreen-queue', songIds],
    queryFn: () =>
      window.api.audioLibraryControls.getSongInfo(
        songIds,
        'addedOrder',
        undefined,
        undefined,
        true,
      ),
    enabled: isOpen && songIds.length > 0,
    placeholderData: keepPreviousData,
  });

  // NCM registration and the library query can finish in either order. The
  // player already holds queue metadata, so use it for missing query rows.
  const songs = useMemo(() => {
    const byId = new Map((queriedSongs ?? []).map((song) => [song.songId, song]));
    return songIds.flatMap((songId) => {
      const resolved = byId.get(songId);
      if (resolved) return [{ ...resolved, isVip: resolved.isVip ?? getQueue().getSongMetadata(songId)?.isVip }];
      const meta = getQueue().getSongMetadata(songId);
      if (!meta) return [];
      return [{
        songId: meta.songId,
        title: meta.title,
        isVip: meta.isVip,
        duration: meta.duration,
        artists: meta.artists,
        album: meta.album,
        path: '',
        artworkPaths: {
          isDefaultArtwork: !meta.artworkPath,
          artworkPath: meta.artworkPath ?? '',
          optimizedArtworkPath: meta.artworkPath ?? '',
        },
        isAFavorite: false,
        isBlacklisted: meta.isBlacklisted,
        isArtworkAvailable: !!meta.artworkPath,
        addedDate: 0,
      } satisfies SongData];
    });
  }, [queriedSongs, songIds]);

  const currentIndex = queue.position ?? -1;

  useLayoutEffect(() => {
    if (isOpen) {
      setPhase((prev) =>
        prev === 'hidden' || prev === 'exiting' ? 'entering' : prev,
      );
    } else {
      setPhase((prev) =>
        prev === 'visible' || prev === 'entering' ? 'exiting' : prev,
      );
    }
  }, [isOpen]);

  useEffect(() => {
    if (phase === 'entering') {
      const t = setTimeout(() => setPhase('visible'), motionDuration(200));
      return () => clearTimeout(t);
    }
    if (phase === 'exiting') {
      const t = setTimeout(() => setPhase('hidden'), motionDuration(180));
      return () => clearTimeout(t);
    }
    return undefined;
  }, [phase]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        // 点击全局右键菜单或弹窗时不关闭队列(菜单项动作完成后由用户决定何时收起)
        const target = e.target as HTMLElement;
        if (target.closest?.('.context-menu') || target.closest?.('.dialog-menu')) return;
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose, containerRef]);

  const isActuallyVisible = phase !== 'hidden';

  // 每首歌的右键菜单(结构与全站 Song 组件一致,动作对齐用户指定的菜单项)
  const buildContextMenuItems = useMemo(() => {
    return (song: SongData, index: number) => {
      const { songId, title, isAFavorite, artists } = song;
      const isNcmSong = songId < 0;

      const items: ContextMenuItem[] = [
        {
          label: t('common.removeFromQueue'),
          iconName: 'remove_circle_outline',
          handlerFunction: () => {
            updateQueueData(
              undefined,
              queue.songIds.filter((id) => id !== songId),
              false,
              false
            );
          }
        },
        {
          label: 'Hr',
          isContextMenuItemSeperator: true,
          handlerFunction: () => true
        },
        {
          label: t('common.play'),
          iconName: 'play_arrow',
          handlerFunction: () => {
            updateQueueData(index, undefined, undefined, true);
            toggleMultipleSelections(false);
          }
        },
        {
          label: t('common.playNext'),
          iconName: 'shortcut',
          handlerFunction: () => {
            addToNext([songId], { removeDuplicates: true });
            addNewNotifications([
              {
                id: `${title}PlayNext`,
                content: t('notifications.playingNext', { title }),
                iconName: 'shortcut'
              }
            ]);
            toggleMultipleSelections(false);
          }
        },
        {
          label: t(`song.${isAFavorite ? 'unlikeSong' : 'likeSong'}`),
          iconName: 'favorite',
          iconClassName: isAFavorite
            ? 'material-icons-round mr-4 text-xl'
            : 'material-icons-round-outlined mr-4 text-xl',
          handlerFunction: () => {
            if (isNcmSong) {
              toggleSongIsFavorite(songId, isAFavorite).catch((err) => console.error(err));
            } else {
              const identity = { source: 'local' as const, sourceId: String(songId) };
              if (isAFavorite) {
                FavoriteService.removeFavorite(identity);
              } else {
                FavoriteService.addFavorite(identity);
              }
              window.api.playerControls
                .toggleLikeSongs([songId])
                .then((res) => {
                  if (res && res.likes.length + res.dislikes.length > 0) {
                    if (currentSongData.songId === songId)
                      toggleIsFavorite(!currentSongData.isAFavorite);
                  }
                })
                .catch((err) => console.error(err));
            }
            toggleMultipleSelections(false);
          }
        },
        {
          label: t('song.addToPlaylists'),
          iconName: 'playlist_add',
          handlerFunction: () => {
            changePromptMenuData(
              true,
              <AddSongsToPlaylistsPrompt songIds={[songId]} title={title} />
            );
            toggleMultipleSelections(false);
          }
        },
        // 仅网易云歌曲可添加到网易云歌单(与全站一致)
        ...(isNcmSong
          ? [
              {
                label: t('ncm.addToNcmPlaylist'),
                iconName: 'playlist_add',
                handlerFunction: () => {
                  changePromptMenuData(
                    true,
                    <NcmSelectPlaylistsPrompt songIds={[-songId]} title={title} />
                  );
                  toggleMultipleSelections(false);
                }
              }
            ]
          : []),
        {
          label: t('common.select'),
          iconName: 'checklist',
          handlerFunction: () => {
            toggleMultipleSelections(true, 'songs', [songId]);
          }
        },
        {
          label: 'Hr',
          isContextMenuItemSeperator: true,
          handlerFunction: () => true
        },
        {
          label: t('common.info'),
          iconName: 'info',
          iconClassName: 'material-icons-round-outlined',
          handlerFunction: () => {
            navigate({ to: '/main-player/songs/$songId', params: { songId: String(songId) } });
          }
        }
      ];

      const contextMenuItemData: ContextMenuAdditionalData = {
        title: title || t('common.unknownTitle'),
        subTitle: artists?.map((a) => a.name).join(', ') ?? t('common.unknownArtist'),
        artworkPath:
          song.artworkPaths?.optimizedArtworkPath ||
          song.artworkPaths?.artworkPath ||
          DefaultSongCover
      };

      return { items, data: contextMenuItemData };
    };
  }, [
    t,
    queue.songIds,
    updateQueueData,
    addToNext,
    addNewNotifications,
    toggleMultipleSelections,
    toggleIsFavorite,
    currentSongData.songId,
    currentSongData.isAFavorite,
    changePromptMenuData,
    navigate
  ]);

  return (
    <>
      <div
        className="queue-popup-surface absolute right-5 bottom-full mb-1 rounded-2xl flex flex-col"
        data-open={isOpen}
        aria-label="播放队列"
        role="region"
        inert={!isOpen}
        style={{
          maxHeight: '60vh',
          width: 343,
          opacity: isOpen && isActuallyVisible ? 1 : 0,
          visibility: isActuallyVisible ? 'visible' : 'hidden',
          pointerEvents: isOpen ? 'auto' : 'none',
          transform: isOpen ? 'translateY(0)' : 'translateY(12px)',
          transition: 'opacity 180ms ease-out, transform 200ms ease-out',
          WebkitAppRegion: 'no-drag',
          appRegion: 'no-drag',
        } as React.CSSProperties}
      >
        {/* 固定头部：标题 + 随机 + 循环 */}
        <div
          className="flex items-center shrink-0 px-3 py-2.5"
          style={{ gap: 10, WebkitAppRegion: 'no-drag', appRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
            <span className="text-sm text-white/80 font-medium select-none">播放队列</span>
            <span className="text-xs text-white/45 select-none">{songIds.length} 首</span>
          </div>
          <button
            className="cursor-pointer active:scale-90 transition-transform p-0.5"
            onClick={() => toggleQueueShuffle()}
            title="随机播放"
          >
            <span className={`material-icons-round text-[22px] select-none pointer-events-none ${
              isShuffling ? 'text-font-color-highlight dark:text-dark-font-color-highlight' : 'text-white/45'
            }`}>shuffle</span>
          </button>
          <button
            className="cursor-pointer active:scale-90 transition-transform p-0.5"
            onClick={() => toggleRepeat()}
            title="循环模式"
          >
            <span className={`material-icons-round text-[22px] select-none pointer-events-none ${
              isRepeating !== 'false' ? 'text-font-color-highlight dark:text-dark-font-color-highlight' : 'text-white/45'
            }`}>{isRepeating === 'repeat-1' ? 'repeat_one' : 'repeat'}</span>
          </button>
        </div>

        {/* 滚动歌曲列表 */}
        <div
          className="flex flex-col overflow-y-auto flex-1 min-h-0"
          style={{
            gap: 0,
            padding: '0 0 4px',
            scrollbarWidth: 'none',
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent 0%, black 4%, black 96%, transparent 100%)',
            maskImage:
              'linear-gradient(to bottom, transparent 0%, black 4%, black 96%, transparent 100%)',
          } as React.CSSProperties}
        >
          {songs.map((song) => {
            const i = songIds.indexOf(song.songId);
            return (
              <div key={`${song.songId}-${i}`}>
                {i > 0 && <div className="h-px w-full bg-white/10" aria-hidden="true" />}
                <QueueCard
                  song={song}
                  isCurrent={i === currentIndex}
                  isPlaying={isCurrentSongPlaying}
                  onClick={() => {
                    if (i !== currentIndex) {
                      updateQueueData(i, undefined, undefined, true);
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const { items, data } = buildContextMenuItems(song, i);
                    updateContextMenuData(true, items, e.pageX, e.pageY, data);
                  }}
                />
              </div>
            );
          })}
          {songIds.length === 0 && <p className="px-5 py-8 text-center text-sm text-white/75">队列中还没有歌曲</p>}
          {songIds.length > 0 && songs.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-white/75">
              <p>{isPending || isFetching ? '正在读取播放队列…' : '暂时无法读取队列歌曲'}</p>
              {!isFetching && <button type="button" className="mt-3 rounded-full border border-white/25 px-3 py-1 text-xs hover:bg-white/10" onClick={() => refetch()}>{isError ? '重试' : '重新读取'}</button>}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .queue-card-glass {
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }
        @keyframes queue-popup-in {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes queue-popup-out {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(0.92); }
        }
        @keyframes queue-card-in {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes queue-card-out {
          from { opacity: 1; transform: translateY(0); }
          to   { opacity: 0; transform: translateY(20px); }
        }
        @keyframes eq-bar-1 { 0%,100% { height: 8px; } 50% { height: 14px; } }
        @keyframes eq-bar-2 { 0%,100% { height: 5px; } 50% { height: 16px; } }
        @keyframes eq-bar-3 { 0%,100% { height: 10px; } 50% { height: 4px; } }
        @keyframes eq-bar-4 { 0%,100% { height: 6px; } 50% { height: 15px; } }
      `}</style>
    </>
  );
};

export default QueuePopup;
