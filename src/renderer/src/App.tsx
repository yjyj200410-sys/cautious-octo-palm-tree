// ? BASE IMPORTS
import { lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import './assets/styles/styles.css';
import './assets/styles/glass.css';
import 'material-symbols/rounded.css';
// ? MAIN APP COMPONENTS
import ErrorBoundary from './components/ErrorBoundary';
import ContextMenu from './components/ContextMenu/ContextMenu';
import FullScreenPlayer from './components/FullScreenPlayer/FullScreenPlayer';
import WebWallpaperFrame from './components/WebWallpaperFrame';
import { MaskBackgroundOverlay } from './utils/maskBackground';
import MusicStringBackground from './components/MusicStringBackground';
import { resolveBackgroundSource } from './utils/backgroundSource';
import { initColorBackground, applyColorBackground, ColorBackgroundLayer } from './utils/colorBackground';
import { immersiveStore } from './store/immersiveStore';
import PromptMenu from './components/PromptMenu/PromptMenu';
import SettingsDrawer from './components/SettingsDrawer/SettingsDrawer';
// ? CONTEXTS
import { AppUpdateContext, type AppUpdateContextType } from './contexts/AppUpdateContext';
import { NcmUserProvider } from './contexts/NcmUserContext';
import { HistoryService } from './utils/unifiedStorage';
// import { SongPositionContext } from './contexts/SongPositionContext';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useAppUpdates } from './hooks/useAppUpdates';
import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useContextMenu } from './hooks/useContextMenu';
import { useDataSync } from './hooks/useDataSync';
import { useDiscordRpc } from './hooks/useDiscordRpc';
import { useDynamicTheme } from './hooks/useDynamicTheme';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useListeningData } from './hooks/useListeningData';
import { useMediaSession } from './hooks/useMediaSession';
import { useMultiSelection } from './hooks/useMultiSelection';
// ? HOOKS
import useNetworkConnectivity from './hooks/useNetworkConnectivity';
import { useNotifications } from './hooks/useNotifications';
import { usePlaybackErrors } from './hooks/usePlaybackErrors';
import { usePlaybackSettings } from './hooks/usePlaybackSettings';
import { usePlayerControl } from './hooks/usePlayerControl';
import { LyricsStore } from './hooks/LyricsStore';
import { useDesktopLyricsSync, updateDesktopLyricsConfig, buildDesktopLyricsConfig } from './hooks/useDesktopLyricsSync';
import { useMiniPlayerSync } from './hooks/useMiniPlayerSync';
import { BUILTIN_FONTS, LOCAL_FONTS, initLocalFonts, loadGoogleFont, applyFont, getSavedFontForScope, waitForFont, restoreCustomFonts, getCustomFonts } from './utils/fontLoader';
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
import { dispatch, store } from './store/store';
import { useStore } from '@tanstack/react-store';
import { applyAccentColor } from './utils/accentColor';

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

    initColorBackground();
    // Restore saved font preference on app startup
    // Inject @font-face for bundled local fonts + restore imported fonts
    initLocalFonts();
    const importedFonts = restoreCustomFonts();
    for (const scope of ['global', 'lyrics'] as const) {
      const saved = getSavedFontForScope(scope);
      const font = [...BUILTIN_FONTS, ...LOCAL_FONTS, ...importedFonts, ...getCustomFonts()].find(f => f.name === saved);
      if (font) {
        if (!font.isLocal) loadGoogleFont(font.googleFamily);
        applyFont(font.name, scope);
        waitForFont(font.name);
      }
    }

  }, []);

  const playerType = useStore(store, (state) => state.playerType);
  const isImmersive = useStore(immersiveStore, (state) => state.active);
  const backgroundPreferences = useStore(store, state => state.localStorage.preferences);
  const backgroundSource = resolveBackgroundSource(backgroundPreferences);
  const customPath = backgroundPreferences.customBackgroundPath;
  const customType = backgroundPreferences.customBackgroundType;
  const customUrl = customPath && !customPath.startsWith('__') ? (/^https?:/i.test(customPath) ? customPath : `file:///${customPath.replace(/\\/g, '/')}`) : undefined;
  const cover = useStore(store, state => state.currentSongData.artworkPath);
  useEffect(() => { applyColorBackground(); }, [backgroundSource]);


  const [, setIsFullscreen] = useState(false);

  useEffect(() => {
    window.api.fullscreen.onEnterFullscreen(() => setIsFullscreen(true));
    window.api.fullscreen.onLeaveFullscreen(() => setIsFullscreen(false));
  }, []);

  // ? INITIALIZE ACCENT COLOR
  const accentColor = useStore(store, (state) => state.localStorage.preferences?.accentColor);
  const accentBrightness = useStore(store, (state) => (state.localStorage.preferences as any)?.accentBrightness ?? 100);

  // 用户手动选择的强调色
  useEffect(() => {
    applyAccentColor(accentColor, accentBrightness);
  }, [accentColor, accentBrightness]);

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
  const { updateBodyBackgroundImage } = useDynamicTheme();

  // Start LyricsStore — central lyrics service, independent of page visibility
  useEffect(() => { LyricsStore.start(); return () => LyricsStore.stop(); }, []);

  // 桌面歌词配置预热:任何入口(迷你播放器/主窗口)打开桌面歌词都能拿到完整参数,
  // 不依赖 FullScreenPlayer 的 LyricsContainer 挂载(挂载后仍会实时覆盖)
  useEffect(() => {
    let lyricTx: Record<string, any> = {};
    try { lyricTx = JSON.parse(localStorage.getItem('nora-lyric-tx') || '{}'); } catch {}
    updateDesktopLyricsConfig(buildDesktopLyricsConfig(lyricTx));
  }, []);

  // Bridge LyricsStore → desktop lyrics window via IPC
  useDesktopLyricsSync();

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
  const { recordListeningData } = useListeningData(audio);

  // ? WIRE UP LISTENING DATA RECORDING TO PLAYER EVENTS
  // Listen for songLoaded events from AudioPlayer to record listening data
  useEffect(() => {
    const handleSongLoaded = (songData: AudioPlayerData) => {
      recordListeningData(songData.songId, songData.duration, false, true);

      // Record unified history
      const isNcm = songData.songId < 0;
      HistoryService.record({
        identity: {
          source: isNcm ? 'netease' : 'local',
          sourceId: String(isNcm ? -songData.songId : songData.songId),
        },
        title: songData.title || '',
        artists: Array.isArray(songData.artists)
          ? songData.artists.map((a) => a.name).join(', ')
          : '',
        cover: songData.artworkPath || '',
        timestamp: Date.now(),
      });
    };

    player.on('songLoaded', handleSongLoaded);

    return () => {
      player.off('songLoaded', handleSongLoaded);
    };
  }, [player, recordListeningData]);

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
          content: t('songUnplayableErrorPrompt.title'),
        },
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
          content: t('songTrialPrompt.title'),
        },
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

  const updatePlayerType = useCallback((type: PlayerTypes) => {
    if (store.state.playerType !== type) {
      dispatch({ type: 'UPDATE_PLAYER_TYPE', data: type });
    }
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
  useDiscordRpc(audio);

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
  useMiniPlayerSync(appUpdateContextValues);

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
            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
              {backgroundSource === 'cover' && cover && <img src={cover} alt="" className="h-full w-full object-cover" />}
              {backgroundSource === 'custom' && customType === 'music-string' && <MusicStringBackground />}
              {backgroundSource === 'custom' && customUrl && (
                customType === 'we-web' || customType === 'we-scene' ? <WebWallpaperFrame src={customUrl} wallpaperId={backgroundPreferences.customBackgroundWallpaperId} />
                : customType === 'video' ? <video key={customUrl} src={customUrl} autoPlay loop muted playsInline className="h-full w-full object-cover" />
                : <img src={customUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <ColorBackgroundLayer />
            <MaskBackgroundOverlay />
            <div className="pointer-events-none absolute inset-0 z-[1]" style={{ backdropFilter: `blur(${backgroundPreferences.backgroundBlur ?? 32}px) brightness(${1 - Math.min(95, Math.max(0, backgroundPreferences.backgroundBrightness ?? 25)) / 100})` }} />
            <div className="app-main-layer relative z-[2] h-full w-full">
              <Outlet />
              {playerType === 'full' && (
                <div className="immersive-content-transition fixed inset-x-0 top-[var(--app-topbar-height)] bottom-[var(--app-playerbar-height)] z-[55]" style={isImmersive ? { top: 0, bottom: 0 } : undefined}>
                  <FullScreenPlayer />
                </div>
              )}
            </div>
            <SettingsDrawer />
            <ContextMenu />
            <PromptMenu />
          </div>
        </AppUpdateContext.Provider>
      </NcmUserProvider>
      {/* <TanStackRouterDevtools position="bottom-right" /> */}
    </ErrorBoundary>
  );
}
