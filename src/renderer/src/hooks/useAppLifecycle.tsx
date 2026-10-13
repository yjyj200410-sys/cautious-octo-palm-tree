import PlayerQueue from '@renderer/other/playerQueue';
import { useEffect } from 'react';

import { proxyCoverUrl } from '../ncm';
import type AudioPlayer from '../other/player';
import { dispatch, store } from '../store/store';
import storage from '../utils/localStorage';
import { FavoriteService } from '../utils/unifiedStorage';

/** Dependencies required by the app lifecycle hook */
export interface AppLifecycleDependencies {
  /** AudioPlayer instance or HTMLAudioElement for playback control */
  audio: AudioPlayer | HTMLAudioElement;

  /** PlayerQueue instance for queue management */
  playerQueue: PlayerQueue;

  /** Toggle shuffle mode */
  toggleShuffling: (isShuffling?: boolean) => void;

  /** Toggle repeat mode */
  toggleRepeat: (newState?: RepeatTypes) => void;

  /** Play a song from unknown source (file path) */
  playSongFromUnknownSource: (audioPlayerData: AudioPlayerData, isStartPlay?: boolean) => void;

  /** Play a song by ID */
  playSong: (songId: number, isStartPlay?: boolean, playAsCurrentSongIndex?: boolean) => void;

  /** Create a new queue */
  createQueue: (
    newQueue: number[],
    queueType: QueueTypes,
    isShuffleQueue?: boolean,
    queueId?: string,
    startPlaying?: boolean
  ) => void;

  /** Change up next song data */
  changeUpNextSongData: (upNextSongData?: AudioPlayerData) => void;

  /** Manage playback errors */
  managePlaybackErrors: (error: unknown) => void;

  /** Toggle song playback (play/pause) */
  toggleSongPlayback: (startPlay?: boolean) => void;

  /** Skip backward to previous song */
  handleSkipBackwardClick: () => void;

  /** Skip forward to next song */
  handleSkipForwardClick: (reason?: SongSkipReason) => void;

  /** Ref to control auto-play after song loads */
  refStartPlay: React.MutableRefObject<boolean>;

  /** Window management functions */
  windowManagement: {
    addSongTitleToTitleBar: () => void;
    resetTitleBarInfo: () => void;
  };
}

/**
 * Hook for managing app lifecycle events
 *
 * Handles application startup initialization including: - LocalStorage synchronization - Default
 * page navigation - Restore playback state (shuffle, repeat) - Resume playing previous song or
 * startup songs - Initialize queue from localStorage or create new queue - Player event listeners
 * (error, play, pause, canplay, ended) - IPC control listeners (playback controls, file
 * associations) - Title bar updates based on playback state
 *
 * This hook automatically sets up all lifecycle listeners and cleanup.
 *
 * @example
 *   ```tsx
 *   function App() {
 *     const { createQueue } = useQueueManagement();
 *     const { managePlaybackErrors } = usePlaybackErrors();
 *     const { toggleSongPlayback, refStartPlay } = usePlayerControl();
 *     const windowManagement = useWindowManagement();
 *     // ... other hooks
 *
 *     useAppLifecycle({
 *       playSong,
 *       createQueue,
 *       managePlaybackErrors,
 *       toggleSongPlayback,
 *       refStartPlay,
 *       windowManagement
 *       // ... other dependencies
 *     });
 *
 *     return <div>...</div>;
 *   }
 *   ```;
 *
 * @param dependencies - Object containing all required callback functions
 */
export function useAppLifecycle(dependencies: AppLifecycleDependencies): void {
  const {
    audio: playerInstance,
    playerQueue,
    toggleShuffling,
    toggleRepeat,
    playSongFromUnknownSource,
    playSong,
    createQueue,
    changeUpNextSongData,
    managePlaybackErrors,
    toggleSongPlayback,
    handleSkipBackwardClick,
    handleSkipForwardClick,
    refStartPlay,
    windowManagement
  } = dependencies;

  // Extract audio element from AudioPlayer or use HTMLAudioElement directly
  const player =
    playerInstance instanceof HTMLAudioElement
      ? playerInstance
      : (playerInstance as AudioPlayer).audio;

  useEffect(() => {
    // LOCAL STORAGE
    const { playback, preferences, queue } = storage.getAllItems();

    const syncCurrentSongFavorite = () => {
      const currentSong = store.state.currentSongData;
      if (!currentSong?.songId) return;
      const identity =
        currentSong.songId < 0
          ? { source: 'netease' as const, sourceId: String(-currentSong.songId) }
          : { source: 'local' as const, sourceId: String(currentSong.songId) };
      const isFavorite = FavoriteService.isFavorite(identity);
      if (currentSong.isAFavorite !== isFavorite) {
        dispatch({ type: 'TOGGLE_IS_FAVORITE_STATE', data: isFavorite });
      }
    };
    const unsubscribeFavoriteChanges = FavoriteService.subscribe(syncCurrentSongFavorite);
    syncCurrentSongFavorite();

    // The local database is authoritative; read IDs instead of full song metadata.
    window.api.audioLibraryControls
      .getAllSongIds('aToZ', 'favorites')
      .then((result) => {
        FavoriteService.replaceSource(
          'local',
          result.data.map((song) => ({ source: 'local', sourceId: String(song.id) }))
        );
        localStorage.setItem('unified_favorites_migrated', 'true');
      })
      .catch((error) => console.error('Local favorites could not be restored', error));

    const syncLocalStorage = () => {
      const allItems = storage.getAllItems();
      dispatch({ type: 'UPDATE_LOCAL_STORAGE', data: allItems });

      console.log('local storage updated');
    };

    document.addEventListener('localStorage', syncLocalStorage);

    // Navigate to default page on startup if needed
    if (
      playback?.currentSong?.songId &&
      preferences?.defaultPageOnStartUp &&
      window.location.pathname !== `/main-player/${preferences.defaultPageOnStartUp}`
    ) {
      // TODO: Implement default page navigation
      // navigate(preferences.defaultPageOnStartUp);
    }

    // Restore playback state
    toggleShuffling(playback?.isShuffling);
    toggleRepeat(playback?.isRepeating);

    // ★ 保存 mount 时的队列快照，用于竞态检测
    const mountQueueSnapshot = queue ? PlayerQueue.fromJSON(queue) : null;
    const mountQueueHash = mountQueueSnapshot
      ? mountQueueSnapshot.songIds.slice(0, 10).join(',') + '|' + mountQueueSnapshot.songIds.length
      : '';

    // Check for startup songs (e.g., songs opened via file association)
    window.api.audioLibraryControls
      .checkForStartUpSongs()
      .then(async (startUpSongData) => {
        if (startUpSongData) {
          playSongFromUnknownSource(startUpSongData, false);
          return;
        }

        // 从旧队列 + NCM registry 恢复混合队列
        const savedSongId = playback?.currentSong?.songId;
        if (!savedSongId || !queue) return;

        // ★ 竞态检测：用户是否在异步回调期间已经播放了新歌单
        const currentQueueLen = playerQueue.length;
        const currentQueueHash =
          playerQueue.getAllSongIds().slice(0, 10).join(',') + '|' + currentQueueLen;
        if (mountQueueHash && currentQueueHash !== mountQueueHash) {
          console.log(
            `[QUEUE_RESTORE_SKIP] reason=user_queue_changed ` +
              `mountLen=${mountQueueSnapshot?.songIds.length ?? 0} currentLen=${currentQueueLen}`
          );
          return;
        }

        try {
          const regMapRaw = localStorage.getItem('ncm_registry_map');
          const regMap = regMapRaw ? JSON.parse(regMapRaw) : {};
          const oldQueue = PlayerQueue.fromJSON(queue);
          const hasNcm = oldQueue.songIds.some((id: number) => id < 0);

          if (hasNcm) {
            const t0 = performance.now();
            const newIds: number[] = [];
            const entryByNewId: Record<number, AudioPlayerData> = {};
            const ncmMetas: { id: number; meta: Record<string, unknown> }[] = [];
            for (const oldId of oldQueue.songIds) {
              if (oldId > 0) {
                newIds.push(oldId);
              } else {
                const meta = regMap[String(oldId)];
                if (meta) {
                  ncmMetas.push({ id: oldId, meta });
                  newIds.push(oldId);
                }
              }
            }

            // 启动恢复：批量注册 metadata，一次 IPC 调用
            // URL 在 playSong 时懒加载，避免启动时 N 次网络请求
            const restorePos = Math.min(oldQueue.position, newIds.length - 1);
            const batchEntries: AudioPlayerData[] = [];
            for (const { id, meta } of ncmMetas) {
              const entry: AudioPlayerData = {
                songId: id,
                title: meta.title as string,
                duration: Math.round((meta.duration as number) / 1000),
                artists: [{ artistId: 0, name: meta.artists as string }],
                album: { albumId: 0, name: meta.album as string },
                path: '', // lazy — resolved on first play
                artworkPath: proxyCoverUrl(meta.cover as string),
                isAFavorite: FavoriteService.isFavorite({
                  source: 'netease',
                  sourceId: String(meta.sourceId)
                }),
                isKnownSource: true,
                isBlacklisted: false
              };
              batchEntries.push(entry);
              entryByNewId[id] = entry;
            }
            if (batchEntries.length > 0) {
              window.api.ncm?.registerSongs(batchEntries).catch(() => {});
            }

            if (newIds.length > 0) {
              console.log(`[QUEUE_RESTORE_APPLY] queueLength=${newIds.length}`);
              window.__noraPlayer?.queue?.replaceQueue(newIds, restorePos, true, {
                queueType: 'songs',
                queueId: ''
              });

              const curId = newIds[restorePos];
              const curEntry = curId < 0 ? entryByNewId[curId] : null;
              if (curEntry) {
                playSongFromUnknownSource(curEntry, false);
              } else if (curId > 0) {
                playSong(curId, false);
              }
              player.currentTime = Number(playback.currentSong.stoppedPosition);
            }
            console.log('[STARTUP_RESTORE]', {
              totalSongs: newIds.length,
              ncmCount: ncmMetas.length,
              resolvedUrls: 0,
              duration: Math.round(performance.now() - t0)
            });
          } else {
            playSong(savedSongId, false);
            player.currentTime = Number(playback.currentSong.stoppedPosition);
            dispatch({
              type: 'UPDATE_SONG_POSITION',
              data: Number(playback.currentSong.stoppedPosition)
            });
          }
        } catch {
          /* fail silently */
        }
      })
      .catch((err) => console.error(err));

    // Initialize queue from localStorage or create new queue
    const hasNcmQueue = queue && PlayerQueue.fromJSON(queue).songIds.some((id: number) => id < 0);
    if (!queue) {
      window.api.audioLibraryControls
        .getAllSongs()
        .then((audioData) => {
          if (!audioData) return undefined;
          createQueue(
            audioData.data.map((song) => song.songId),
            'songs'
          );
          return undefined;
        })
        .catch((err) => console.error(err));
    } else if (!hasNcmQueue) {
      const storedQueue = PlayerQueue.fromJSON(queue);
      if (storedQueue.length !== playerQueue.length) {
        console.warn('Queue mismatch detected, reinitializing from localStorage');
        playerQueue.replaceQueue(storedQueue.songIds, storedQueue.position, false);
      }
    }
    // hasNcmQueue: restore code above handles it

    return () => {
      document.removeEventListener('localStorage', syncLocalStorage);
      unsubscribeFavoriteChanges();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Setup player queue event listeners
  useEffect(() => {
    // Note: localStorage queue persistence is now handled by queueSingleton.ts
    // to avoid duplicate writes on every queue/position change

    // Update up next song when position changes
    const unsubscribeUpNext = playerQueue.on('positionChange', async () => {
      const nextSongId = playerQueue.nextSongId;
      if (nextSongId) {
        try {
          const songData = await window.api.audioLibraryControls.getSong(nextSongId);
          if (songData) changeUpNextSongData(songData);
        } catch (err) {
          console.error('Failed to fetch up next song:', err);
        }
      } else {
        changeUpNextSongData(undefined);
      }
    });

    // Cleanup
    return () => {
      unsubscribeUpNext();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Setup player event listeners for error, play, pause, and quit events
  useEffect(() => {
    const handlePlayerErrorEvent = (err: unknown) => managePlaybackErrors(err);
    const handlePlayerPlayEvent = () => {
      dispatch({
        type: 'CURRENT_SONG_PLAYBACK_STATE',
        data: true
      });
      window.api.playerControls.songPlaybackStateChange(true);
    };
    const handlePlayerPauseEvent = () => {
      dispatch({
        type: 'CURRENT_SONG_PLAYBACK_STATE',
        data: false
      });
      window.api.playerControls.songPlaybackStateChange(false);
    };
    const handleBeforeQuitEvent = async () => {
      storage.playback.setCurrentSongOptions('stoppedPosition', player.currentTime);
      storage.playback.setPlaybackOptions('isRepeating', store.state.player.isRepeating);
      storage.playback.setPlaybackOptions('isShuffling', store.state.player.isShuffling);
    };

    player.addEventListener('error', handlePlayerErrorEvent);
    player.addEventListener('play', handlePlayerPlayEvent);
    player.addEventListener('pause', handlePlayerPauseEvent);
    window.api.quitEvent.beforeQuitEvent(handleBeforeQuitEvent);

    return () => {
      player.removeEventListener('error', handlePlayerErrorEvent);
      player.removeEventListener('play', handlePlayerPlayEvent);
      player.removeEventListener('pause', handlePlayerPauseEvent);
      window.api.quitEvent.removeBeforeQuitEventListener(handleBeforeQuitEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [managePlaybackErrors]);

  // Setup player lifecycle event listeners for canplay and title bar updates
  useEffect(() => {
    const displayDefaultTitleBar = () => {
      windowManagement.resetTitleBarInfo();
      storage.playback.setCurrentSongOptions('stoppedPosition', player.currentTime);
    };
    const playSongIfPlayable = () => {
      if (refStartPlay.current) toggleSongPlayback(true);
    };
    // Note: 'ended' event is now handled entirely by AudioPlayer.handleSongEnd()
    // which automatically moves to the next song and resumes playback

    player.addEventListener('canplay', playSongIfPlayable);
    player.addEventListener('play', windowManagement.addSongTitleToTitleBar);
    player.addEventListener('pause', displayDefaultTitleBar);

    return () => {
      toggleSongPlayback(false);
      player.removeEventListener('canplay', playSongIfPlayable);
      player.removeEventListener('play', windowManagement.addSongTitleToTitleBar);
      player.removeEventListener('pause', displayDefaultTitleBar);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Setup IPC control listeners from main process
  useEffect(() => {
    const handleToggleSongPlayback = () => toggleSongPlayback();
    const handleSkipForwardClickListener = () => handleSkipForwardClick('PLAYER_SKIP');
    const handlePlaySongFromUnknownSource = (_: unknown, data: AudioPlayerData) =>
      playSongFromUnknownSource(data, true);

    window.api.unknownSource.playSongFromUnknownSource(handlePlaySongFromUnknownSource);
    window.api.playerControls.toggleSongPlayback(handleToggleSongPlayback);
    window.api.playerControls.skipBackwardToPreviousSong(handleSkipBackwardClick);
    window.api.playerControls.skipForwardToNextSong(handleSkipForwardClickListener);

    return () => {
      window.api.unknownSource.removePlaySongFromUnknownSourceEvent(handleToggleSongPlayback);
      window.api.playerControls.removeTogglePlaybackStateEvent(handleToggleSongPlayback);
      window.api.playerControls.removeSkipBackwardToPreviousSongEvent(handleSkipBackwardClick);
      window.api.playerControls.removeSkipForwardToNextSongEvent(handleSkipForwardClickListener);
      window.api.dataUpdates.removeDataUpdateEventListeners();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
