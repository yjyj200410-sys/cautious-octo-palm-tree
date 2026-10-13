// ? BASE IMPORTS
import { lazy, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import './assets/styles/styles.css';
import './components/Volo/volo.css';
import 'material-symbols/rounded.css';
import ContextMenu from './components/ContextMenu/ContextMenu';
// ? MAIN APP COMPONENTS
import ErrorBoundary from './components/ErrorBoundary';
import PromptMenu from './components/PromptMenu/PromptMenu';
// ? CONTEXTS
import { AppUpdateContext, type AppUpdateContextType } from './contexts/AppUpdateContext';
import { NcmUserProvider } from './contexts/NcmUserContext';
// import { SongPositionContext } from './contexts/SongPositionContext';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useAppUpdates } from './hooks/useAppUpdates';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useContextMenu } from './hooks/useContextMenu';
import { useDataSync } from './hooks/useDataSync';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useMediaSession } from './hooks/useMediaSession';
import { useMultiSelection } from './hooks/useMultiSelection';
// ? HOOKS
import useNetworkConnectivity from './hooks/useNetworkConnectivity';
import { useNotifications } from './hooks/useNotifications';
import { usePlaybackErrors } from './hooks/usePlaybackErrors';
import { usePlaybackSettings } from './hooks/usePlaybackSettings';
import { usePlayerControl } from './hooks/usePlayerControl';
import { usePlayerNavigation } from './hooks/usePlayerNavigation';
import { usePromptMenu } from './hooks/usePromptMenu';
import { useQueueManagement } from './hooks/useQueueManagement';
import { useUserPreferences } from './hooks/useUserPreferences';
import { useWindowManagement } from './hooks/useWindowManagement';
import { initializeQueue } from './other/queueSingleton';

// ? PROMPTS
const SongUnplayableErrorPrompt = lazy(() => import('./components/SongUnplayableErrorPrompt'));

// ? SCREENS

// import { TanStackRouterDevtools } from '@tanstack/react-router-devtools';
import { Outlet } from '@tanstack/react-router';

// ? UTILS
import { dispatch } from './store/store';

// ? / / / / / / /  PLAYER DEFAULT OPTIONS / / / / / / / / / / / / / /
// player.addEventListener('player/trackchange', (e) => {
//   if ('detail' in e) {
//     console.log(`player track changed to ${(e as DetailAvailableEvent<string>).detail}.`);
//   }
// });
// / / / / / / / /

const updateNetworkStatus = () => window.api.settingsHelpers.networkStatusChange(navigator.onLine);

updateNetworkStatus();
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

// console.log('Command line args', window.api.properties.commandLineArgs);

export default function App() {
  // ? INITIALIZE QUEUE (singleton with store sync)
  // This must be called before useAudioPlayer to ensure queue is ready
  useEffect(() => {
    initializeQueue();
    // 禁用全局拖拽（文字/图片被当作链接拖动）
    document.addEventListener('dragstart', (e) => e.preventDefault());
  }, []);

  // ? INITIALIZE PLAYER AND QUEUE (singleton instances via custom hooks)
  const player = useAudioPlayer();
  const audio = player.audio;
  const playerQueue = player.queue; // Access properties directly from AudioPlayer instance

  // const [content, dispatch] = useReducer(reducer, DEFAULT_REDUCER_DATA);
  // // Had to use a Ref in parallel with the Reducer to avoid an issue that happens when using content.* not giving the intended data in useCallback functions even though it was added as a dependency of that function.
  // const contentRef = useRef(DEFAULT_REDUCER_DATA);

  const AppRef = useRef(null as HTMLDivElement | null);
  // const storeRef = useRef<AppReducer>(undefined);

  const { isOnline } = useNetworkConnectivity();

  // ? INITIALIZE NOTIFICATIONS
  // Notifications hook handles adding/updating notifications and IPC messages from main
  const { addNewNotifications, updateNotifications } = useNotifications();
  const { t } = useTranslation();

  // ? INITIALIZE DYNAMIC THEME
  // Dynamic theme hook handles theme generation from song palettes and background images
  // Theme is automatically applied/removed based on preferences and song data
  const updateBodyBackgroundImage = useCallback(() => {}, []);

  // ? INITIALIZE MULTI-SELECTION
  // Multi-selection hook handles selecting multiple items for batch operations
  const { updateMultipleSelections, toggleMultipleSelections } = useMultiSelection();

  // ? INITIALIZE PROMPT MENU
  // Prompt menu hook handles modal dialogs, error messages, and overlay content
  const { changePromptMenuData, updatePromptMenuHistoryIndex } = usePromptMenu();

  // ? INITIALIZE CONTEXT MENU
  // Context menu hook handles right-click menu state and visibility
  // Note: Global click listener is now handled automatically inside the hook
  const { updateContextMenuData } = useContextMenu();

  // ? INITIALIZE USER PREFERENCES
  // User preferences hook loads keyboard shortcuts, equalizer preset, and ignored items from database
  useUserPreferences();

  // ? INITIALIZE KEYBOARD SHORTCUTS
  // Keyboard shortcuts hook handles all keyboard shortcuts and their actions
  // Will be initialized after all other dependencies are defined
  // Note: Hook call moved to after all callbacks are defined due to dependencies

  // ? INITIALIZE DATA SYNC
  // Data sync hook handles IPC data update events and query cache invalidation
  useDataSync();

  // ? INITIALIZE PLAYBACK ERRORS
  // Playback errors hook handles error management and retry logic
  const { managePlaybackErrors } = usePlaybackErrors(audio, changePromptMenuData);

  // ? INITIALIZE PLAYBACK SETTINGS
  // Playback settings hook handles repeat, volume, mute, position, favorites, and equalizer
  const {
    toggleRepeat,
    toggleMutedState,
    updateVolume,
    updateSongPosition,
    toggleIsFavorite,
    updateEqualizerOptions
  } = usePlaybackSettings(audio);

  // ? INITIALIZE LISTENING DATA
  // Listening data hook handles recording song playback sessions for analytics
  const recordListeningData = useCallback(() => {}, []);

  // ? SURFACE LOAD FAILURES
  // player 在任一加载失败时派发 player/loadFailed（手动点击 / auto-skip 均覆盖）。
  // 此前失败无任何 UI 反馈（网络故障时用户只见"点了没反应"）；这里按 id 去重弹通知。
  useEffect(() => {
    const handleLoadFailed = (): void => {
      addNewNotifications([
        {
          id: 'playbackLoadFailed',
          duration: 10000,
          iconName: 'error_outline',
          content: t('songUnplayableErrorPrompt.title')
        }
      ]);
    };
    document.addEventListener('player/loadFailed', handleLoadFailed);
    return () => document.removeEventListener('player/loadFailed', handleLoadFailed);
  }, [addNewNotifications, t]);

  // ? SURFACE TRIAL PLAYBACK (VIP 歌曲解锁失败 → 官方 30s 试听)
  // resolver 在解锁全失败且官方给了试听 URL 时回退到 30s 试听并派发 player/trialStarted。
  // 这里弹通知提示用户当前播放的是「会员歌曲试听」，而非完整版。
  useEffect(() => {
    const handleTrialStarted = (): void => {
      addNewNotifications([
        {
          id: 'playbackTrial',
          duration: 6000,
          iconName: 'music_note',
          content: t('songTrialPrompt.title')
        }
      ]);
    };
    document.addEventListener('player/trialStarted', handleTrialStarted);
    return () => document.removeEventListener('player/trialStarted', handleTrialStarted);
  }, [addNewNotifications, t]);

  // ? INITIALIZE PLAYER CONTROL
  // Player control hook handles play/pause, song loading, and player state management
  const {
    toggleSongPlayback,
    playSong,
    playSongFromUnknownSource,
    updateCurrentSongData,
    clearAudioPlayerData,
    updateCurrentSongPlaybackState,
    refStartPlay
  } = usePlayerControl(
    player, // Pass AudioPlayer instance instead of audio element
    playerQueue,
    recordListeningData,
    managePlaybackErrors,
    changePromptMenuData,
    addNewNotifications
  );

  // ? INITIALIZE PLAYER NAVIGATION
  // Player navigation hook handles skip forward/backward and queue navigation
  // Songs are auto-loaded by AudioPlayer on queue position changes
  const { changeQueueCurrentSongIndex, handleSkipBackwardClick, handleSkipForwardClick } =
    usePlayerNavigation(player, playerQueue, toggleSongPlayback, recordListeningData);

  // ? INITIALIZE APP UPDATES
  // App updates hook handles checking for updates and showing release notes
  const { updateAppUpdatesState } = useAppUpdates({
    changePromptMenuData,
    isOnline
  });

  const fetchSongFromUnknownSource = useCallback(
    (songPath: string) => {
      window.api.unknownSource
        .getSongFromUnknownSource(songPath)
        .then((res) => playSongFromUnknownSource(res, true))
        .catch((err) => {
          console.error(err);
          changePromptMenuData(true, <SongUnplayableErrorPrompt err={err} />);
        });
    },
    [playSongFromUnknownSource, changePromptMenuData]
  );

  // ? INITIALIZE WINDOW MANAGEMENT
  // Window management hook handles blur/focus, fullscreen, drag-and-drop, and title bar updates
  const windowManagement = useWindowManagement(AppRef, {
    changePromptMenuData,
    fetchSongFromUnknownSource
  });

  // ? INITIALIZE QUEUE MANAGEMENT
  // Queue management hook handles queue creation, updates, and shuffle operations
  const {
    createQueue,
    updateQueueData,
    toggleQueueShuffle,
    toggleShuffling,
    changeUpNextSongData
  } = useQueueManagement({
    playerQueue,
    playSong
  });

  const updatePlayerType = useCallback(() => {
    dispatch({ type: 'UPDATE_PLAYER_TYPE', data: 'normal' });
  }, []);

  // ? INITIALIZE MEDIA SESSION
  // Media session hook handles OS-level media controls and browser media notifications
  useMediaSession(audio, {
    toggleSongPlayback,
    handleSkipBackwardClick,
    handleSkipForwardClick,
    updateSongPosition
  });

  // ? INITIALIZE DISCORD RPC
  // Discord RPC hook handles Discord Rich Presence integration

  // Set up keyboard shortcuts with all required dependencies
  useKeyboardShortcuts({
    toggleSongPlayback,
    toggleMutedState,
    handleSkipForwardClick,
    handleSkipBackwardClick,
    updateVolume,
    toggleShuffling,
    toggleRepeat,
    toggleIsFavorite,
    addNewNotifications,
    updatePlayerType,
    toggleMultipleSelections,
    changePromptMenuData
  });

  // Initialize app lifecycle (startup, localStorage sync, queue initialization, event listeners)
  // Must be called after all dependencies are defined
  // This hook now manages all player event listeners, IPC controls, and lifecycle events
  useAppLifecycle({
    audio: player, // Pass AudioPlayer instance
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
  });

  const appUpdateContextValues = useMemo<AppUpdateContextType>(() => {
    const contextValue: AppUpdateContextType = {
      updateCurrentSongData,
      updateContextMenuData,
      changePromptMenuData,
      changeUpNextSongData,
      updatePromptMenuHistoryIndex,
      playSong,
      addNewNotifications,
      updateNotifications,
      createQueue,
      changeQueueCurrentSongIndex,
      updateCurrentSongPlaybackState,
      updatePlayerType,
      handleSkipBackwardClick,
      handleSkipForwardClick,
      updateSongPosition,
      updateVolume,
      toggleMutedState,
      toggleRepeat,
      toggleShuffling,
      toggleQueueShuffle,
      toggleIsFavorite,
      toggleSongPlayback,
      updateQueueData,
      clearAudioPlayerData,
      updateBodyBackgroundImage,
      updateMultipleSelections,
      toggleMultipleSelections,
      updateAppUpdatesState,
      updateEqualizerOptions
    };
    return contextValue;
  }, [
    updateCurrentSongData,
    updateContextMenuData,
    changePromptMenuData,
    changeUpNextSongData,
    updatePromptMenuHistoryIndex,
    playSong,
    addNewNotifications,
    updateNotifications,
    createQueue,
    changeQueueCurrentSongIndex,
    updateCurrentSongPlaybackState,
    updatePlayerType,
    handleSkipBackwardClick,
    handleSkipForwardClick,
    updateSongPosition,
    updateVolume,
    toggleMutedState,
    toggleRepeat,
    toggleShuffling,
    toggleQueueShuffle,
    toggleIsFavorite,
    toggleSongPlayback,
    updateQueueData,
    clearAudioPlayerData,
    updateBodyBackgroundImage,
    updateMultipleSelections,
    toggleMultipleSelections,
    updateAppUpdatesState,
    updateEqualizerOptions
  ]);

  // Mini Player 独立窗口:状态推送 + 命令执行

  return (
    <ErrorBoundary>
      <NcmUserProvider>
        <AppUpdateContext.Provider value={appUpdateContextValues}>
          <div
            className={`main-app relative h-screen! min-h-screen w-full ${''}`}
            ref={AppRef}
            onDragEnter={windowManagement.addSongDropPlaceholder}
            onDragLeave={windowManagement.removeSongDropPlaceholder}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={windowManagement.onSongDrop}
          >
            <div className="app-main-layer h-full w-full">
              <Outlet />
            </div>
            <ContextMenu />
            <PromptMenu />
          </div>
        </AppUpdateContext.Provider>
      </NcmUserProvider>
      {/* <TanStackRouterDevtools position="bottom-right" /> */}
    </ErrorBoundary>
  );
}
