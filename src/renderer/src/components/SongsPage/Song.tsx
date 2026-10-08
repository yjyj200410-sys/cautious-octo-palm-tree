import { type DraggableProvided } from '@hello-pangea/dnd';
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import {
  type CSSProperties,
  type ForwardedRef,
  forwardRef,
  lazy,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Img from '../Img';
import MultipleSelectionCheckbox from '../MultipleSelectionCheckbox';

const AddSongsToPlaylistsPrompt = lazy(() => import('./AddSongsToPlaylistsPrompt'));
const NcmSelectPlaylistsPrompt = lazy(() => import('../NcmSelectPlaylistsPrompt'));

import { useStore } from '@tanstack/react-store';

import { appPreferences } from '../../../../../package.json';
import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import { useQueueOperations } from '../../hooks/useQueueOperations';
import { FavoriteService } from '../../utils/unifiedStorage';
import toggleSongIsFavorite from '../../other/toggleSongIsFavorite';
import { store } from '../../store/store';
import Button from '../Button';
import NavLink from '../NavLink';
import SongArtist from './SongArtist';
import { isThirdPartySong } from '../../music-source/third-party';

interface SongProp {
  songId: number;
  artworkPaths: ArtworkPaths;
  title: string;
  artists?: { name: string; artistId: number }[];
  album?: { name: string; albumId: number };
  duration: number;
  year?: number;
  path: string;
  isBlacklisted?: boolean;
  additionalContextMenuItems?: ContextMenuItem[];
  currentPlaylistId?: number;
  index: number;
  trackNo?: number | string;
  isIndexingSongs: boolean;
  isAFavorite: boolean;
  /** 来源标签（搜索页混排标注：网易云 / 歌曲宝 / 酷我）；缺省不渲染徽章 */
  sourceTag?: 'netease' | 'gequbao' | 'kuwo';
  /** 需要隐藏的菜单项 label key 列表，如 ['addToQueue', 'showInFileExplorer'] */
  suppressedMenuItems?: string[];
  className?: string;
  onPlayClick?: (currSongId: number) => void;
  onAddToNext?: (songId: number) => void;
  onAddToEnd?: (songId: number) => void;
  style?: CSSProperties;
  isDraggable?: boolean;
  provided?: DraggableProvided;
  selectAllHandler?: (_upToId?: number) => void;
}

const Song = memo(
  forwardRef((props: SongProp, ref: ForwardedRef<HTMLDivElement>) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const queue = useStore(store, (state) => state.localStorage.queue);
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const localStorageData = useStore(store, (state) => state.localStorage);
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);

  const {
    playSong,
    updateContextMenuData,
    updateQueueData,
    changePromptMenuData,
    addNewNotifications,
    toggleIsFavorite,
    toggleMultipleSelections,
    updateMultipleSelections,
    createQueue
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  // Queue operations for context menu actions
  const { addToNext, addToEnd } = useQueueOperations();

  const {
    index,
    songId,
    duration,
    artworkPaths,
    isIndexingSongs,
    isBlacklisted = false,
    path: _path,
    title,
    additionalContextMenuItems,
    artists,
    album,
    style,
    year,
    trackNo,
    selectAllHandler,
    suppressedMenuItems,
    sourceTag,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provided = {} as any,
    onPlayClick,
    onAddToNext,
    onAddToEnd
  } = props;

  // ★ 第三方合成条目（songId 为合成负值，非网易云 id）：
  //   隐藏收藏按钮 / 网易云歌单菜单 / 禁用标题跳转（网易云歌曲详情页查不到）
  const isThirdParty = isThirdPartySong(songId);

  const [isAFavorite, setIsAFavorite] = useState(props.isAFavorite);
  const [isSongPlaying, setIsSongPlaying] = useState(false);
  const clickTimeoutRef = useRef<NodeJS.Timeout>(undefined);

  useEffect(() => {
    setIsSongPlaying(() => currentSongData?.songId === songId && isCurrentSongPlaying);
    setIsAFavorite((prevState) => {
      if (currentSongData?.songId === songId) return currentSongData.isAFavorite;
      return prevState;
    });
  }, [currentSongData.songId, currentSongData.isAFavorite, isCurrentSongPlaying, songId]);

  const handlePlayBtnClick = useCallback(() => {
    if (onPlayClick) return onPlayClick(songId);
    return playSong(songId);
  }, [onPlayClick, playSong, songId]);

  const handleLikeButtonClick = useCallback(() => {
    // Sync to unified store
    const identity = { source: 'local' as const, sourceId: String(songId) };
    if (isAFavorite) {
      FavoriteService.removeFavorite(identity);
    } else {
      FavoriteService.addFavorite(identity);
    }

    window.api.playerControls
      .toggleLikeSongs([songId], !isAFavorite)
      .then((res) => {
        if (res && res.likes.length + res.dislikes.length > 0) {
          if (currentSongData.songId === songId)
            toggleIsFavorite(!currentSongData.isAFavorite, true);
          return setIsAFavorite((prevData) => !prevData);
        }
        setIsAFavorite((prevData) => !prevData);
        return undefined;
      })
      .catch((err) => console.error(err));
  }, [currentSongData.isAFavorite, currentSongData.songId, isAFavorite, songId, toggleIsFavorite]);

  const { minutes, seconds } = useMemo(() => {
    const addZero = (num: number) => {
      if (num < 10) return `0${num}`;
      return num.toString();
    };

    const min = Math.floor((duration || 0) / 60);
    const sec = Math.floor((duration || 0) % 60);

    return {
      minutes: Number.isNaN(min) ? undefined : addZero(min),
      seconds: Number.isNaN(sec) ? undefined : addZero(sec)
    };
  }, [duration]);

  const isAMultipleSelection = useMemo(() => {
    if (!multipleSelectionsData.isEnabled) return false;
    if (multipleSelectionsData.selectionType !== 'songs') return false;
    if (multipleSelectionsData.multipleSelections.length <= 0) return false;
    if (multipleSelectionsData.multipleSelections.some((selectionId) => selectionId === songId))
      return true;
    return false;
  }, [
    multipleSelectionsData.isEnabled,
    multipleSelectionsData.selectionType,
    multipleSelectionsData.multipleSelections,
    songId
  ]);

  const songArtists = useMemo(() => {
    if (Array.isArray(artists) && artists.length > 0) {
      return artists
        .map((artist, i) => {
          const arr = [
            <SongArtist
              key={artist.artistId}
              artistId={artist.artistId}
              name={artist.name}
              className={`${
                (currentSongData.songId === songId || isAMultipleSelection) &&
                'dark:text-font-color-black!'
              }`}
            />
          ];

          if ((artists?.length ?? 1) - 1 !== i) arr.push(<span className="mr-1">,</span>);

          return arr;
        })
        .flat();
    }
    return <span className="text-xs font-normal">{t('common.unknownArtist')}</span>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artists, currentSongData.songId, isAMultipleSelection, songId]);

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    const isMultipleSelectionsEnabled =
      multipleSelectionsData.selectionType === 'songs' &&
      multipleSelectionsData.multipleSelections.length !== 1 &&
      isAMultipleSelection;

    const { multipleSelections: songIds } = multipleSelectionsData;

    const items: ContextMenuItem[] = [
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: additionalContextMenuItems === undefined
      },
      {
        label: t('common.play'),
        handlerFunction: () => {
          handlePlayBtnClick();
          toggleMultipleSelections(false);
        },
        iconName: 'play_arrow',
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('common.createAQueue'),
        handlerFunction: () => {
          createQueue(songIds, 'songs', false, undefined, true);
          toggleMultipleSelections(false);
        },
        iconName: 'queue_music',
        isDisabled: songId < 0 || !isMultipleSelectionsEnabled
      },
      {
        label: t(`common.${isMultipleSelectionsEnabled ? 'playNextAll' : 'playNext'}`),
        iconName: 'shortcut',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            // Add multiple songs to play next (keeps duplicates)
            addToNext(songIds, { removeDuplicates: true });
            addNewNotifications([
              {
                id: `${title}PlayNext`,
                content: t('notifications.playingNextSongsWithCount', {
                  count: songIds.length
                }),
                iconName: 'shortcut'
              }
            ]);
          } else if (onAddToNext) {
            onAddToNext(songId);
          } else {
            // Add single song to play next (keeps duplicates)
            addToNext([songId], { removeDuplicates: true });
            addNewNotifications([
              {
                id: `${title}PlayNext`,
                content: t('notifications.playingNext', { title }),
                iconName: 'shortcut'
              }
            ]);
          }
          toggleMultipleSelections(false);
        }
      },
      {
        label: t('common.addToQueue'),
        iconName: 'queue',
        isDisabled: songId < 0,
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            // Add multiple songs to end (keeps duplicates)
            addToEnd(songIds, { removeDuplicates: false });
            addNewNotifications([
              {
                id: `${songIds.length}AddedToQueueFromMultiSelection`,
                content: t('notifications.addedToQueue', {
                  count: songIds.length
                }),
                iconName: 'add'
              }
            ]);
          } else if (onAddToEnd) {
            onAddToEnd(songId);
          } else {
            // Add single song to end (keeps duplicates)
            addToEnd([songId], { removeDuplicates: false });
            addNewNotifications([
              {
                id: `${title}AddedToQueue`,
                content: t('notifications.addedToQueue', {
                  count: 1
                }),
                icon: (
                  <Img
                    src={artworkPaths?.optimizedArtworkPath || DefaultSongCover}
                    loading="lazy"
                    alt="Song Artwork"
                  />
                )
              }
            ]);
          }
          toggleMultipleSelections(false);
        }
      },
      { label: 'Hr', isContextMenuItemSeperator: true, handlerFunction: () => true, isDisabled: songId >= 0 },
      // ★ 本地歌曲隐藏收藏菜单项；多选时保留（可能包含网易云歌曲）
      ...(songId < 0 || isMultipleSelectionsEnabled ? [{
        label: isMultipleSelectionsEnabled
          ? t('song.toggleLikeSongs')
          : t(`song.${isAFavorite ? 'unlikeSong' : 'likeSong'}`),
        iconName: `favorite`,
        iconClassName: isMultipleSelectionsEnabled
          ? 'material-icons-round-outlined mr-4 text-xl'
          : isAFavorite
            ? 'material-icons-round mr-4 text-xl'
            : 'material-icons-round-outlined mr-4 text-xl',
        handlerFunction: () => {
          const ids = isMultipleSelectionsEnabled ? [...songIds] : [songId];
          const hasNcmSong = ids.some((id) => id < 0);

          if (hasNcmSong) {
            // NCM songs: use toggleSongIsFavorite (optimistic update + API sync)
            for (const id of ids) {
              toggleSongIsFavorite(id, isAFavorite).catch((err) =>
                console.error(err)
              );
            }
          } else {
            // Local songs: existing flow
            for (const id of ids) {
              const identity = { source: 'local' as const, sourceId: String(id) };
              if (isMultipleSelectionsEnabled || !isAFavorite) {
                FavoriteService.addFavorite(identity);
              } else {
                FavoriteService.removeFavorite(identity);
              }
            }

            window.api.playerControls
              .toggleLikeSongs(ids)
              .then((res) => {
                if (res && res.likes.length + res.dislikes.length > 0) {
                  if (currentSongData.songId === songId)
                    toggleIsFavorite(!currentSongData.isAFavorite);
                  return setIsAFavorite((prevData) => !prevData);
                }
                return undefined;
              })
              .catch((err) => console.error(err));
          }
          toggleMultipleSelections(false);
        }
      }] : []),
      {
        label: t('song.addToPlaylists'),
        iconName: 'playlist_add',
        isDisabled: songId < 0,
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <AddSongsToPlaylistsPrompt
              songIds={isAMultipleSelection ? songIds : [songId]}
              title={title}
            />
          );
          toggleMultipleSelections(false);
        }
      },
      // NCM: add to Netease playlist (only for real NCM songs, 排除第三方合成条目)
      ...(isAMultipleSelection
        ? songIds.every((id: number) => id < 0 && !isThirdPartySong(id))
        : songId < 0 && !isThirdParty) ? [{
        label: '添加到歌单',
        iconName: 'playlist_add',
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <NcmSelectPlaylistsPrompt
              songIds={(isAMultipleSelection ? songIds : [songId]).map((id: number) => -id)}
              title={title}
              currentPlaylistId={props.currentPlaylistId}
            />
          );
          toggleMultipleSelections(false);
        }
      }] : [],
      {
        label: t(`common.${isAMultipleSelection ? 'unselect' : 'select'}`),
        iconName: 'checklist',
        isDisabled: songId < 0,
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) {
            updateMultipleSelections(songId, 'songs', isAMultipleSelection ? 'remove' : 'add');
            // 取消选择后全局退出多选模式
            if (isAMultipleSelection) toggleMultipleSelections(false);
          } else toggleMultipleSelections(!isAMultipleSelection, 'songs', [songId]);
        }
      },
      // {
      //   label: 'Select/Unselect All',
      //   iconName: 'checklist',
      //   isDisabled: !selectAllHandler,
      //   handlerFunction: () => selectAllHandler && selectAllHandler(),
      // },
      {
        label: 'Hr',
        isContextMenuItemSeperator: true,
        handlerFunction: () => true,
        isDisabled: songId < 0 || isMultipleSelectionsEnabled
      },
      {
        label: t('song.showInFileExplorer'),
        class: 'reveal-file-explorer',
        iconName: 'folder_open',
        handlerFunction: () => window.api.songUpdates.revealSongInFileExplorer(songId),
        isDisabled: songId < 0 || isMultipleSelectionsEnabled
      }
    ];

    if (additionalContextMenuItems) items.unshift(...additionalContextMenuItems);

    const suppressSet = new Set(suppressedMenuItems);
    return items
      .filter((item): item is ContextMenuItem => !!item)
      .filter((item) => !item.iconName || !suppressSet.has(item.iconName));
  }, [
    multipleSelectionsData,
    isAMultipleSelection,
    additionalContextMenuItems,
    suppressedMenuItems,
    t,
    isAFavorite,
    album,
    isBlacklisted,
    isThirdParty,
    handlePlayBtnClick,
    toggleMultipleSelections,
    createQueue,
    queue.position,
    queue.songIds,
    currentSongData.songId,
    currentSongData.isAFavorite,
    updateQueueData,
    addNewNotifications,
    title,
    songId,
    artworkPaths?.optimizedArtworkPath,
    artworkPaths.artworkPath,
    toggleIsFavorite,
    changePromptMenuData,
    props.currentPlaylistId,
    isMultipleSelectionEnabled,
    updateMultipleSelections,
  ]);

  return (
    <div
      style={style}
      data-index={index}
      {...provided?.draggableProps}
      {...provided?.dragHandleProps}
      className={`${songId} song-row group relative mr-4 mb-2 flex h-13 w-[98%] overflow-hidden rounded-lg p-[0.2rem] px-2 -outline-offset-2 transition-[background,color,opacity] ease-in-out focus-visible:outline! ${
        currentSongData.songId === songId
          ? 'bg-background-color-3/40 text-font-color-black dark:bg-dark-background-color-3/40 before:absolute before:left-0 before:top-1 before:bottom-1 before:w-[3px] before:rounded-full before:bg-font-color-highlight dark:before:bg-dark-font-color-highlight'
          : isAMultipleSelection
            ? 'bg-background-color-3/20 dark:bg-dark-background-color-3/20'
            : 'bg-transparent hover:bg-background-color-2/40 dark:hover:bg-dark-background-color-2/40'
      } ${!isAMultipleSelection && isBlacklisted && 'opacity-30!'}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY);
      }}
      onClick={(e) => {
        e.preventDefault();
        if (e.getModifierState('Shift') === true && selectAllHandler) selectAllHandler(songId);
        else if (e.getModifierState('Control') === true && !isMultipleSelectionEnabled)
          toggleMultipleSelections(!isAMultipleSelection, 'songs', [songId]);
        else if (isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs')
          updateMultipleSelections(songId, 'songs', isAMultipleSelection ? 'remove' : 'add');
      }}
      onDoubleClick={() => {
        if (clickTimeoutRef.current) clearTimeout(clickTimeoutRef.current);
        handlePlayBtnClick();
      }}
      ref={ref}
    >
      <div
        className={`song-cover-and-play-btn-container flex w-[clamp(6rem,15%,9rem)] shrink-0 items-center justify-center ${
          !isIndexingSongs && 'w-[clamp(4rem,10%,6rem)]!'
        }`}
      >
        {isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs' ? (
          <div className="bg-background-color-1 text-font-color-highlight dark:bg-dark-background-color-1 dark:text-dark-background-color-3 relative mx-1 flex h-fit items-center rounded-lg p-1">
            <MultipleSelectionCheckbox id={songId} selectionType="songs" />
          </div>
        ) : isBlacklisted ? (
          <div
            className={`relative mr-2 flex h-full items-center justify-center ${
              index < 10
                ? 'min-w-7'
                : index < 100
                  ? 'min-w-10'
                  : index < 1000
                    ? 'min-w-12'
                    : 'min-w-15'
            }`}
            title={t('notifications.songBlacklisted', { title })}
          >
            <span
              className={`material-icons-round text-font-color-black dark:text-font-color-white mx-2 text-2xl ${
                currentSongData.songId === songId && 'dark:text-font-color-black!'
              } `}
            >
              block
            </span>
          </div>
        ) : isIndexingSongs ||
          (trackNo && localStorageData.preferences.showTrackNumberAsSongIndex) ? (
          <div
            className={`bg-background-color-1 text-font-color-highlight group-even:bg-background-color-2/75 group-hover:bg-background-color-1 dark:bg-dark-background-color-1 dark:text-dark-background-color-3 dark:group-even:bg-dark-background-color-2/50 dark:group-hover:bg-dark-background-color-1 relative mx-1 flex items-center justify-center rounded-2xl px-3 py-1 text-center ${
              index < 10
                ? 'min-w-7'
                : index < 100
                  ? 'min-w-10'
                  : index < 1000
                    ? 'min-w-12'
                    : 'min-w-15'
            }`}
          >
            <span className="min-w-2 text-sm leading-tight font-medium">
              {trackNo ?? index + 1}
            </span>
          </div>
        ) : (
          ''
        )}
        <div
          className={`song-cover-container relative mr-4 ml-2 flex h-[90%] min-w-12 flex-row items-center justify-center overflow-hidden rounded-md ${
            (isIndexingSongs || isMultipleSelectionEnabled || isBlacklisted) && 'sm:hidden'
          }`}
        >
          <div className="play-btn-container absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
            <Button
              className="m-0! rounded-none! border-0! bg-transparent p-0! outline-offset-1 transition-colors! hover:bg-transparent focus-visible:outline! dark:bg-transparent dark:hover:bg-transparent"
              iconClassName={`text-3xl! text-font-color-white/0 leading-none! ${
                currentSongData.songId === songId && 'text-font-color-white/100'
              } text-font-color-white/100 ${
                isSongPlaying && 'text-font-color-white/75!'
              }`}
              clickHandler={handlePlayBtnClick}
              iconName={isSongPlaying ? 'pause_circle' : 'play_circle'}
            />
          </div>
          <Img
            src={artworkPaths?.optimizedArtworkPath || DefaultSongCover}
            loading="lazy"
            alt="Song cover"
            className={`aspect-square max-h-full min-w-full object-contain py-[0.1rem] ${
              isSongPlaying ? 'brightness-50' : ''
            }`}
            enableImgFadeIns={false}
          />
        </div>
      </div>
      <div
        className={`song-info-container text-font-color-black dark:text-font-color-white grid grow grid-cols-[35%_2fr_1fr_minmax(4rem,5rem)_minmax(4.5rem,6.5rem)] items-center gap-3 sm:grid-cols-[45%_1fr_minmax(4.5rem,6rem)] sm:gap-2 lg:grid-cols-[40%_1fr_minmax(4rem,5rem)_minmax(4.5rem,6.5rem)] lg:gap-0! ${
          (currentSongData.songId === songId || isAMultipleSelection) &&
          'dark:text-font-color-black!'
        }`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <NavLink
            to="/main-player/songs/$songId"
            params={{ songId: String(songId) }}
            title={title}
            className="song-title truncate min-w-0 flex-1 text-base font-normal outline-offset-1 transition-none focus-visible:outline!"
            disabled={isMultipleSelectionEnabled || isThirdParty}
          >
            {window.api.properties.isInDevelopment && `(${songId})`} {title}
          </NavLink>
          {/* ★ 搜索页混排来源徽章：网易云 / 歌曲宝 / 酷我 */}
          {sourceTag && (
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[0.6rem] leading-none font-medium ${
                sourceTag === 'netease'
                  ? 'bg-background-color-2 text-font-color-black dark:bg-dark-background-color-3 dark:text-dark-font-color-white'
                  : 'bg-background-color-3 text-font-color-black dark:bg-dark-background-color-2 dark:text-dark-font-color-highlight'
              }`}
            >
              {sourceTag === 'netease' ? '网易云' : sourceTag === 'gequbao' ? '歌曲宝' : '酷我'}
            </span>
          )}
        </div>
        <div className="song-artists w-full truncate text-xs font-normal transition-none text-font-color-black dark:text-font-color-white">
          {songArtists}
        </div>
        <div className="song-album w-full truncate text-xs transition-none sm:hidden md:hidden lg:hidden">
          {album?.name ? (
            <NavLink
              to="/main-player/albums/$albumId"
              params={{ albumId: String(album?.albumId) }}
              disabled={album?.albumId === undefined || isMultipleSelectionEnabled}
              className="cursor-pointer -outline-offset-1 hover:underline focus-visible:outline!"
              title={album.name}
            >
              {album.name}
            </NavLink>
          ) : (
            t('common.unknownAlbum')
          )}
        </div>
        <div className="song-year flex items-center justify-center text-center text-xs transition-none sm:hidden">
          {window.api.properties.isInDevelopment && appPreferences.showSongIdInsteadOfSongYear
            ? songId
            : (year ?? '----')}
        </div>
        <div className="song-duration flex w-full! items-center justify-between pr-4 pl-2 text-center transition-none sm:pr-1">
          {/* ★ 本地/第三方合成歌曲隐藏收藏按钮，仅真网易云歌曲显示 */}
          {songId < 0 && !isThirdParty && (
          <Button
            className="mt-1 mr-0! rounded-none! border-0! bg-transparent p-0! text-inherit! outline-offset-1 focus-visible:outline! dark:bg-transparent"
            iconName="favorite"
            iconClassName={`${
              isAFavorite ? 'material-icons-round' : 'material-icons-round-outlined'
            } leading-none! text-xl! font-light! md:hidden ${
              isAFavorite
                ? currentSongData.songId === songId || isAMultipleSelection
                  ? 'text-font-color-black! dark:text-font-color-black!'
                  : 'text-font-color-highlight! dark:text-dark-background-color-3!'
                : currentSongData.songId === songId || isAMultipleSelection
                  ? 'text-font-color-black! dark:text-font-color-black!'
                  : 'text-font-color-highlight! dark:text-dark-background-color-3!'
            }`}
            tooltipLabel={t(`song.${isAFavorite ? 'likedThisSong' : 'dislikedThisSong'}`)}
            clickHandler={(e) => {
              e.stopPropagation();
              handleLikeButtonClick();
            }}
          />
          )}
          <span className="">
            {minutes ?? '--'}:{seconds ?? '--'}
          </span>
        </div>
      </div>
    </div>
  );
  })
);

Song.displayName = 'Song';
export default Song;
