/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { lazy, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import Button from '../Button';
import Img from '../Img';
import MultipleSelectionCheckbox from '../MultipleSelectionCheckbox';
import SongArtist from './SongArtist';

const AddSongsToPlaylistsPrompt = lazy(() => import('./AddSongsToPlaylistsPrompt'));
const NcmSelectPlaylistsPrompt = lazy(() => import('../NcmSelectPlaylistsPrompt'));


import { useNavigate } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';

import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import toggleSongIsFavorite from '../../other/toggleSongIsFavorite';
import { store } from '../../store/store';
import NavLink from '../NavLink';

interface SongCardProp {
  index: number;
  songId: number;
  artworkPath: string;
  path: string;
  title: string;
  artists?: { name: string; artistId: number }[];
  album?: { name: string; albumId: number };
  palette?: NodeVibrantPalette;
  isAFavorite: boolean;
  className?: string;
  isBlacklisted: boolean;
  selectAllHandler?: (_upToId?: number) => void;
}

const SongCard = (props: SongCardProp) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const queue = useStore(store, (state) => state.localStorage.queue);
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);

  const {
    playSong,
    updateContextMenuData,
    updateQueueData,
    addNewNotifications,
    changePromptMenuData,
    toggleIsFavorite,
    toggleMultipleSelections,
    updateMultipleSelections,
    createQueue
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();
  const navigate = useNavigate();

  const {
    title,
    artworkPath,
    index,
    isAFavorite,
    path,
    songId,
    artists,
    album,
    className,
    isBlacklisted,
    palette,
    selectAllHandler
  } = props;

  const [isSongAFavorite, setIsSongAFavorite] = useState(
    songId === currentSongData.songId ? currentSongData.isAFavorite : isAFavorite
  );
  const [isSongPlaying, setIsSongPlaying] = useState(
    currentSongData ? currentSongData.songId === songId && isCurrentSongPlaying : false
  );
  useEffect(() => {
    setIsSongPlaying(() => {
      if (currentSongData) return currentSongData.songId === songId && isCurrentSongPlaying;
      return false;
    });
    setIsSongAFavorite((prevState) => {
      if (currentSongData?.songId === songId) return currentSongData.isAFavorite;
      return prevState;
    });
  }, [currentSongData, isCurrentSongPlaying, songId]);

  const [h, s, l] = useMemo(() => {
    const swatch = palette?.LightVibrant;
    if (swatch?.hsl) {
      const { hsl } = swatch;

      return [`${hsl[0] * 360}`, `${hsl[1] * 100}%`, `${hsl[2] * 100}%`];
    }
    return ['0', '0%', '0%'];
  }, [palette?.LightVibrant]);

  const background = `linear-gradient(to top,hsl(${h} ${s} ${l} / 0.35) 0%, hsl(${h} ${s} ${l} / 0.15) 40%), linear-gradient(to top,rgba(0,0,0,0.8)0%,rgba(0,0,0,0.1) 60%)`;

  const handlePlayBtnClick = useCallback(() => {
    playSong(songId);
  }, [playSong, songId]);

  const isAMultipleSelection = useMemo(() => {
    if (!multipleSelectionsData.isEnabled) return false;
    if (multipleSelectionsData.selectionType !== 'songs') return false;
    if (multipleSelectionsData.multipleSelections.length <= 0) return false;
    if (multipleSelectionsData.multipleSelections.some((selectionId) => selectionId === songId))
      return true;
    return false;
  }, [multipleSelectionsData, songId]);

  const contextMenuItemData =
    isMultipleSelectionEnabled &&
    multipleSelectionsData.selectionType === 'songs' &&
    isAMultipleSelection
      ? {
          title: t('song.selectedSongCount', {
            count: multipleSelectionsData.multipleSelections.length
          }),
          artworkPath: DefaultSongCover
        }
      : {
          title: title || t('common.unknownTitle'),
          subTitle: artists?.map((artist) => artist.name).join(', ') ?? t('common.unknownArtist'),
          artworkPath
        };

  const handleLikeButtonClick = useCallback(() => {
    // NCM songs: use toggleSongIsFavorite (unified store + NCM API sync)
    if (songId < 0) {
      toggleSongIsFavorite(songId, isSongAFavorite)
        .then(() => {
          if (currentSongData.songId === songId)
            toggleIsFavorite(!currentSongData.isAFavorite, true);
          setIsSongAFavorite((prevData) => !prevData);
        })
        .catch((err) => console.error(err));
      return;
    }
    // Local songs: use main process toggleLikeSongs
    window.api.playerControls
      .toggleLikeSongs([songId], !isSongAFavorite)
      .then((res) => {
        if (res && res.likes.length + res.dislikes.length > 0) {
          if (currentSongData.songId === songId)
            toggleIsFavorite(!currentSongData.isAFavorite, true);
          return setIsSongAFavorite((prevData) => !prevData);
        }
        return undefined;
      })
      .catch((err) => console.error(err));
  }, [
    currentSongData.isAFavorite,
    currentSongData.songId,
    isSongAFavorite,
    songId,
    toggleIsFavorite
  ]);

  const contextMenuItems: ContextMenuItem[] = useMemo(() => {
    const isMultipleSelectionsEnabled =
      multipleSelectionsData.selectionType === 'songs' &&
      multipleSelectionsData.multipleSelections.length !== 1 &&
      isAMultipleSelection;

    const { multipleSelections: songIds } = multipleSelectionsData;

    const items: ContextMenuItem[] = [
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
        isDisabled: !isMultipleSelectionsEnabled
      },

      {
        label: t(`common.${isMultipleSelectionsEnabled ? 'playNextAll' : 'playNext'}`),
        iconName: 'shortcut',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            let currentSongIndex = queue.position ?? queue.songIds.indexOf(currentSongData.songId);
            const duplicateIds: number[] = [];

            const newQueue = queue.songIds.filter((id) => {
              const isADuplicate = songIds.includes(id);
              if (isADuplicate) duplicateIds.push(id);

              return !isADuplicate;
            });

            for (const duplicateId of duplicateIds) {
              const duplicateIdPosition = queue.songIds.indexOf(duplicateId);

              if (
                duplicateIdPosition !== -1 &&
                duplicateIdPosition < currentSongIndex &&
                currentSongIndex - 1 >= 0
              )
                currentSongIndex -= 1;
            }

            newQueue.splice(currentSongIndex + 1, 0, ...songIds);

            updateQueueData(currentSongIndex, newQueue, undefined, false);
            addNewNotifications([
              {
                id: `${title}PlayNext`,
                content: t('notifications.playingNextSongsWithCount', {
                  count: songIds.length
                }),
                iconName: 'shortcut'
              }
            ]);
          } else {
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
          }
          toggleMultipleSelections(false);
        }
      },
      {
        label: t('common.addToQueue'),
        iconName: 'queue',
        handlerFunction: () => {
          if (isMultipleSelectionsEnabled) {
            updateQueueData(undefined, [...queue.songIds, ...songIds], false);
            addNewNotifications([
              {
                id: `${songIds.length}AddedToQueueFromMultiSelection`,
                content: t('notifications.addedToQueue', {
                  count: songIds.length
                }),
                iconName: 'add'
              }
            ]);
          } else {
            updateQueueData(undefined, [...queue.songIds, songId], false);
            addNewNotifications([
              {
                id: `${title}AddedToQueue`,
                content: t('notifications.addedToQueue', {
                  count: 1
                }),
                icon: <Img src={artworkPath} loading="lazy" alt="Song Artwork" />
              }
            ]);
          }
          toggleMultipleSelections(false);
        }
      },
      {
        label: isMultipleSelectionsEnabled
          ? t('song.toggleLikeSongs')
          : t(`song.${isSongAFavorite ? 'unlikeSong' : 'likeSong'}`),
        iconName: `favorite`,
        iconClassName: isMultipleSelectionsEnabled
          ? 'material-icons-round-outlined mr-4 text-xl'
          : isSongAFavorite
            ? 'material-icons-round mr-4 text-xl'
            : 'material-icons-round-outlined mr-4 text-xl',
        handlerFunction: () => {
          const ids = isMultipleSelectionsEnabled ? [...songIds] : [songId];
          const hasNcmSong = ids.some((id) => id < 0);

          if (hasNcmSong) {
            // NCM songs: use toggleSongIsFavorite (optimistic update + API sync)
            for (const id of ids) {
              toggleSongIsFavorite(id, isSongAFavorite).catch((err) =>
                console.error(err)
              );
            }
            // Update UI immediately
            if (isMultipleSelectionsEnabled) {
              for (let i = 0; i < songIds.length; i += 1) {
                const id = songIds[i];
                if (currentSongData.songId === id)
                  toggleIsFavorite(!currentSongData.isAFavorite);
                if (id === songId) setIsSongAFavorite((prevState) => !prevState);
              }
            } else {
              if (currentSongData.songId === songId)
                toggleIsFavorite(!currentSongData.isAFavorite);
              setIsSongAFavorite((prevData) => !prevData);
            }
          } else {
            // Local songs: existing flow
            window.api.playerControls
              .toggleLikeSongs(ids)
              .then((res) => {
                if (res && res.likes.length + res.dislikes.length > 0) {
                  if (isMultipleSelectionsEnabled) {
                    for (let i = 0; i < songIds.length; i += 1) {
                      const id = songIds[i];
                      if (currentSongData.songId === id)
                        toggleIsFavorite(!currentSongData.isAFavorite);
                      if (id === songId) setIsSongAFavorite((prevState) => !prevState);
                    }
                  } else {
                    if (currentSongData.songId === songId)
                      toggleIsFavorite(!currentSongData.isAFavorite);
                    return setIsSongAFavorite((prevData) => !prevData);
                  }
                }
                return undefined;
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
            <AddSongsToPlaylistsPrompt
              songIds={isAMultipleSelection ? songIds : [songId]}
              title={title}
            />
          );
          toggleMultipleSelections(false);
        }
      },
      // NCM: add to Netease playlist (only for NCM songs)
      ...(isAMultipleSelection ? songIds.every((id: number) => id < 0) : songId < 0) ? [{
        label: t('ncm.addToNcmPlaylist'),
        iconName: 'playlist_add',
        handlerFunction: () => {
          changePromptMenuData(
            true,
            <NcmSelectPlaylistsPrompt
              songIds={(isAMultipleSelection ? songIds : [songId]).map((id: number) => -id)}
              title={title}
            />
          );
          toggleMultipleSelections(false);
        }
      }] : [],
      {
        label: t(`common.${isAMultipleSelection ? 'unselect' : 'select'}`),
        iconName: 'checklist',
        handlerFunction: () => {
          if (isMultipleSelectionEnabled) {
            updateMultipleSelections(
              songId,
              'songs',
              isAMultipleSelection ? 'remove' : 'add'
            );
            // 取消选择后全局退出多选模式
            if (isAMultipleSelection) toggleMultipleSelections(false);
          } else {
            toggleMultipleSelections(!isAMultipleSelection, 'songs', [songId]);
          }
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
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('song.showInFileExplorer'),
        class: 'reveal-file-explorer',
        iconName: 'folder_open',
        handlerFunction: () => window.api.songUpdates.revealSongInFileExplorer(songId),
        isDisabled: isMultipleSelectionsEnabled
      },
      {
        label: t('common.info'),
        class: 'info',
        iconName: 'info',
        handlerFunction: () =>
          navigate({ to: '/main-player/songs/$songId', params: { songId: String(songId) } }),
        isDisabled: isMultipleSelectionsEnabled
      },
    ];
    return items.filter((item): item is ContextMenuItem => !!item);
  }, [
    multipleSelectionsData,
    isAMultipleSelection,
    t,
    isSongAFavorite,
    album,
    isBlacklisted,
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
    artworkPath,
    toggleIsFavorite,
    changePromptMenuData,
    isMultipleSelectionEnabled,
    updateMultipleSelections,
    navigate,
    path
  ]);

  const songArtistComponents = useMemo(() => {
    if (Array.isArray(artists) && artists.length > 0) {
      return artists
        .map((artist, i) => {
          const arr = [
            <SongArtist
              key={artist.artistId}
              artistId={artist.artistId}
              name={artist.name}
              className="text-font-color-white/80! dark:text-font-color-white/80!"
            />
          ];

          if ((artists?.length ?? 1) - 1 !== i)
            arr.push(
              <span className="mr-1" key={`${artists[i].name}=>${artists[i + 1].name}`}>
                ,
              </span>
            );

          return arr;
        })
        .flat();
    }
    return <span className="text-xs font-normal">{t('common.unknownArtist')}</span>;
  }, [artists, t]);

  return (
    <div
      style={{
        animationDelay: `${50 * (index + 1)}ms`
      }}
      className={`song song-card appear-from-bottom ${songId} ${
        currentSongData.songId === songId && 'current-song'
      } ${
        isSongPlaying && 'playing'
      } group/songCard relative mr-2 mb-2 aspect-2/1 max-w-[24rem] min-w-[15rem] overflow-hidden rounded-2xl border-[transparent] shadow-xl transition-[border-color] ease-in-out ${
        className || ''
      } ${
        isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs' && 'border-4'
      } ${
        isAMultipleSelection &&
        'border-font-color-highlight! dark:border-dark-font-color-highlight!'
      }`}
      data-song-id={songId}
      onDoubleClick={handlePlayBtnClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        updateContextMenuData(true, contextMenuItems, e.pageX, e.pageY, contextMenuItemData);
      }}
      onClick={(e) => {
        e.preventDefault();
        if (e.getModifierState('Shift') === true && selectAllHandler) selectAllHandler(songId);
        else if (e.getModifierState('Control') === true && !isMultipleSelectionEnabled)
          toggleMultipleSelections(!isAMultipleSelection, 'songs', [songId]);
        else if (isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs')
          updateMultipleSelections(songId, 'songs', isAMultipleSelection ? 'remove' : 'add');
      }}
      title={isBlacklisted ? `'${title}' is blacklisted.` : undefined}
    >
      <div className="h-full w-full relative">
        <Img
          src={artworkPath}
          loading="eager"
          alt="Song cover"
          className={`h-full w-full object-cover object-center ${
            isBlacklisted && 'brightness-50! dark:brightness-[.40]!'
          }`}
          enableImgFadeIns={!isMultipleSelectionEnabled}
        />
        <div className="absolute bottom-0 left-0 right-0 h-[20%] pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }} />
      </div>
      <div
        className="song-info-and-controls-container absolute top-0 flex h-full w-full flex-col justify-between px-4 py-4"
        data-song-id={songId}
        style={{ background }}
      >
        <div className="song-states-container flex items-center justify-between">
          <div className="state-info flex">
            {typeof queue.position === 'number' &&
              Array.isArray(queue.songIds) &&
              queue.songIds.length > 0 &&
              queue?.songIds?.at(queue.position + 1) === songId && (
                <span className="text-font-color-white! mr-2 font-semibold uppercase opacity-70 last:mr-0">
                  {t('song.playingNext')}
                </span>
              )}
            {currentSongData.songId === songId && (
              <span className="text-font-color-white! mr-2 font-semibold uppercase opacity-70 last:mr-0">
                {t('song.playingNow')}
              </span>
            )}
            {isBlacklisted &&
              !(
                typeof queue.position === 'number' &&
                Array.isArray(queue.songIds) &&
                queue.songIds.length > 0 &&
                queue?.songIds?.at(queue.position + 1) === songId &&
                currentSongData.songId === songId
              ) && (
                <span className="text-font-color-white! mr-2 font-semibold uppercase opacity-70 last:mr-0">
                  {t('song.blacklisted')}
                </span>
              )}
          </div>
          <div className="state-icons flex">
            <Button
              className="order-2 m-0! rounded-none! border-0! bg-transparent p-1! text-inherit! opacity-50 outline-offset-1 transition-opacity opacity-100 hover:bg-transparent focus-visible:outline! dark:bg-transparent dark:hover:bg-transparent"
              iconName="favorite"
              iconClassName={`${
                isSongAFavorite ? 'material-icons-round' : 'material-icons-round-outlined'
              } !text-2xl !text-font-color-white !leading-none`}
              tooltipLabel={isSongAFavorite ? t('song.likedThisSong') : undefined}
              clickHandler={(e) => {
                e.stopPropagation();
                handleLikeButtonClick();
              }}
            />
          </div>
        </div>
        <div className="song-info-and-play-btn-container flex w-full items-center justify-between">
          <div className="song-info-container text-font-color-white dark:text-font-color-white max-w-[75%]">
            <NavLink
              to="/main-player/songs/$songId"
              params={{ songId: String(songId) }}
              preload={isMultipleSelectionEnabled ? false : undefined}
              className={`song-title cursor-pointer overflow-hidden text-xl font-normal text-ellipsis whitespace-nowrap outline-offset-1 transition-none hover:underline focus-visible:outline!`}
              title={title}
              tabIndex={0}
              disabled={isMultipleSelectionEnabled}
            >
              {title}
            </NavLink>
            <div
              className="song-artists w-full max-w-full truncate text-sm transition-none"
              title={artists ? artists.map((x) => x.name).join(', ') : t('common.unknownArtist')}
              data-song-id={songId}
            >
              {songArtistComponents}
            </div>
          </div>
          <div className="play-btn-and-multiple-selection-checkbox-container">
            {isMultipleSelectionEnabled ? (
              multipleSelectionsData.selectionType === 'songs' && (
                <MultipleSelectionCheckbox id={songId} selectionType="songs" className="mr-1!" />
              )
            ) : (
              <Button
                className={`!m-0 !rounded-none !border-0 bg-transparent !p-0 opacity-60 outline-offset-1 transition-opacity hover:bg-transparent focus-visible:!outline dark:bg-transparent dark:hover:bg-transparent ${
                  currentSongData.songId === songId && 'opacity-100!'
                } opacity-100`}
                iconName={isSongPlaying ? 'pause_circle' : 'play_circle'}
                iconClassName="text-4xl! leading-none! text-font-color-white transition-opacity"
                clickHandler={(e) => {
                  e.stopPropagation();
                  handlePlayBtnClick();
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SongCard;
