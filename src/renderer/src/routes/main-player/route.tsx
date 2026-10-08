import BodyAndSideBarContainer from '@renderer/components/BodyAndSidebarContainer';
import QueuePopup from '@renderer/components/FullScreenPlayer/QueuePopup';
import SearchBar from '@renderer/components/Home/Search/SearchBar';
import Img from '@renderer/components/Img';
import SongControlsContainer from '@renderer/components/SongsControlsContainer/SongControlsContainer';
import MenuButton from '@renderer/components/TitleBar/MenuButton';
import NcmUserButton from '@renderer/components/TitleBar/NcmUserButton';
import WindowControlsContainer from '@renderer/components/TitleBar/WindowControlsContainer';
import usePageBack from '@renderer/hooks/usePageBack';
import { settingsQuery } from '@renderer/queries/settings';
import {
  floatingChromeStore,
  setFloatingPanel,
  toggleFloatingFocus
} from '@renderer/store/floatingChromeStore';
import { immersiveStore } from '@renderer/store/immersiveStore';
import { settingsStore } from '@renderer/store/settingsStore';
import { store } from '@renderer/store/store';
import { resolveBackgroundSource } from '@renderer/utils/backgroundSource';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useMatchRoute } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { useEffect, useRef, useState } from 'react';

export const Route = createFileRoute('/main-player')({
  component: RouteComponent
});

function RouteComponent() {
  const isReducedMotion = useStore(store, (state) => {
    // storeRef.current = state;

    return (
      state.localStorage.preferences.isReducedMotion ||
      (state.isOnBatteryPower && state.localStorage.preferences.removeAnimationsOnBatteryPower)
    );
  });
  const {
    data: { isDarkMode }
  } = useSuspenseQuery({
    ...settingsQuery.all,
    select: (data) => ({ isDarkMode: data.isDarkMode })
  });
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);
  const customBackgroundPath = useStore(
    store,
    (state) => state.localStorage.preferences?.customBackgroundPath
  );
  const customBackgroundType = useStore(
    store,
    (state) => state.localStorage.preferences?.customBackgroundType
  );
  const backgroundSource = useStore(store, (state) =>
    resolveBackgroundSource(state.localStorage.preferences)
  );
  const currentSongCover = useStore(store, (state) => state.currentSongData.artworkPath);
  const playerType = useStore(store, (state) => state.playerType);
  const isImmersive = useStore(immersiveStore, (state) => state.active);
  const isSettingsOpen = useStore(settingsStore, (state) => state.isOpen);
  const focusMode = useStore(floatingChromeStore, (state) => state.focusMode);
  const floatingPanels = useStore(floatingChromeStore, (state) => state.panels);
  const toolsOpen = floatingPanels.tools;
  useEffect(() => {
    document.body.classList.add('volo-floating-shell');
    document.body.classList.toggle('volo-reduced-motion', isReducedMotion);
    return () => {
      document.body.classList.remove('volo-floating-shell', 'volo-reduced-motion');
    };
  }, [isReducedMotion]);
  const hasCustomVisualBackground =
    backgroundSource === 'custom' &&
    customBackgroundType !== 'transparent' &&
    Boolean(
      customBackgroundPath &&
      customBackgroundPath !== '__none__' &&
      customBackgroundPath !== '__transparent__'
    );
  const hasVisualBackground = Boolean(
    bodyBackgroundImage ||
    (backgroundSource === 'cover' && currentSongCover) ||
    backgroundSource === 'color' ||
    hasCustomVisualBackground
  );
  const useHighContrastForeground = isDarkMode || hasVisualBackground;

  // 底部胶囊的播放队列浮层(原 /main-player/queue 展开页已被此弹窗替换)
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const queueContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isImmersive || focusMode || !toolsOpen) setIsQueueOpen(false);
  }, [isImmersive, focusMode, toolsOpen]);

  // 全局快捷键 goToQueue → 打开队列浮层
  useEffect(() => {
    const openQueue = () => {
      if (floatingChromeStore.state.focusMode) toggleFloatingFocus();
      setFloatingPanel('tools', true);
      setIsQueueOpen(true);
    };
    window.addEventListener('open-queue-popup', openQueue);
    return () => window.removeEventListener('open-queue-popup', openQueue);
  }, []);

  // 搜索浮层只在 Home 页显示(搜索已从独立页面改为 Home 内浮层)
  const isHome = useMatchRoute()({ to: '/main-player/home' });
  const goBack = usePageBack();

  return (
    <div
      data-focus-mode={focusMode}
      data-sidebar-open={floatingPanels.sidebar && !focusMode}
      data-library-open={floatingPanels.library && !focusMode}
      data-tools-open={toolsOpen && !focusMode}
      className={`App floating-app relative select-none ${isHome ? 'home-active' : ''} ${useHighContrastForeground ? 'dark' : ''} ${
        hasVisualBackground ? 'wallpaper-contrast' : ''
      } ${
        isReducedMotion
          ? 'reduced-motion animate-none transition-none delay-0! duration-0! [&.dialog-menu]:backdrop-blur-none!'
          : 'transition-colors duration-200'
      } after:text-font-color-white dark:after:text-font-color-white grid !h-screen min-h-screen w-full grid-rows-[minmax(0,1fr)_80px] items-center after:invisible after:absolute after:-z-10 after:grid after:h-full after:w-full after:place-items-center after:bg-[rgba(0,0,0,0)] after:text-4xl after:font-medium after:content-["Drop_your_song_here"] dark:after:bg-[rgba(0,0,0,0)] [&.blurred_#title-bar]:opacity-40 [&.song-drop]:after:visible [&.song-drop]:after:z-20 [&.song-drop]:after:border-4 [&.song-drop]:after:border-dashed [&.song-drop]:after:border-[#ccc] [&.song-drop]:after:bg-[rgba(0,0,0,0.7)] [&.song-drop]:after:transition-[background,visibility,color] dark:[&.song-drop]:after:border-[#ccc] dark:[&.song-drop]:after:bg-[rgba(0,0,0,0.7)]`}
    >
      {bodyBackgroundImage && (
        <div className="body-background-image-container absolute h-full w-full overflow-hidden bg-center">
          <Img
            className={`blur-0 w-full bg-cover opacity-100 brightness-100 transition-[filter,opacity] duration-500 ${
              bodyBackgroundImage &&
              'opacity-100! blur-[.45rem]! brightness-[.92]! dark:brightness-[.72]!'
            }`}
            loading="eager"
            src={bodyBackgroundImage}
            alt=""
          />
        </div>
      )}
      <div
        className={`player-workspace-transition h-full min-h-0 min-w-0 overflow-hidden ${
          playerType === 'full' ? 'pointer-events-none invisible' : 'visible'
        }`}
        aria-hidden={playerType === 'full'}
        inert={playerType === 'full'}
      >
        <BodyAndSideBarContainer />
      </div>
      <div
        className="floating-window-drag-handle"
        style={
          {
            WebkitAppRegion: isSettingsOpen ? 'no-drag' : 'drag'
          } as React.CSSProperties
        }
      />
      {/* 顶部内容共用页面背景；空白处负责拖动，交互控件保持可点击。 */}
      {/* Chromium caches native drag regions while the drawer slides in. Disable
          the covered titlebar's drag region for the modal's entire open state. */}
      <div
        className={`app-top-bar absolute inset-x-0 top-0 z-50 grid items-center gap-2 px-3 ${isSettingsOpen ? '[-webkit-app-region:no-drag]' : '[-webkit-app-region:drag]'} [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag]`}
      >
        <div
          className="app-top-bar-left flex min-w-0 items-center gap-2"
          inert={focusMode}
          aria-hidden={focusMode}
        >
          <MenuButton />
          {!isHome && playerType !== 'full' && (
            <button
              type="button"
              onClick={goBack}
              aria-label="返回上一页"
              title="返回上一页"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-black/8 dark:hover:bg-white/10"
            >
              <span className="material-icons-round text-xl">arrow_back</span>
            </button>
          )}
          <span className="lumina-wordmark text-font-color-black/85 dark:text-font-color-white/90 ml-1 text-sm font-semibold tracking-[-0.02em]">
            Volo
          </span>
          {/* 搜索与导航共用顶栏，搜索保持在左侧。 */}
          {playerType !== 'full' && (
            <div className="global-search-slot min-w-0 flex-1 [-webkit-app-region:no-drag]">
              <SearchBar />
            </div>
          )}
        </div>
        <div
          id="home-navigation-slot"
          inert={focusMode}
          aria-hidden={focusMode}
          className={`app-top-bar-navigation ${isHome && playerType !== 'full' ? '' : 'hidden'}`}
        />
        <div
          className="app-top-bar-actions flex h-full items-center gap-1 justify-self-end [-webkit-app-region:no-drag]"
          inert={focusMode}
          aria-hidden={focusMode}
        >
          <div className="relative">
            <NcmUserButton />
          </div>
          <WindowControlsContainer />
        </div>
        <button
          type="button"
          className="floating-focus-toggle"
          aria-label={focusMode ? '展开全部控件' : '收起全部控件'}
          title={focusMode ? '展开全部控件' : '收起全部控件'}
          aria-pressed={focusMode}
          onClick={toggleFloatingFocus}
        >
          <span className="material-icons-round-outlined" aria-hidden="true">
            {focusMode ? 'widgets' : 'visibility_off'}
          </span>
        </button>
      </div>
      {/* 桌面底部播放控制台 + 从控制台上方展开的播放队列。 */}
      <div
        ref={queueContainerRef}
        className={`player-controls-transition relative h-full min-h-0 w-full self-stretch ${isQueueOpen ? 'z-[56]' : 'z-40'}`}
      >
        <SongControlsContainer
          isQueueOpen={isQueueOpen}
          onQueueToggle={() => setIsQueueOpen((prev) => !prev)}
        />
        <QueuePopup
          isOpen={isQueueOpen}
          onClose={() => setIsQueueOpen(false)}
          containerRef={queueContainerRef}
        />
      </div>
    </div>
  );
}
