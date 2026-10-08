import {
  lyricTransformStore,
  updateLyricTransformSettings
} from '@renderer/store/lyricTransformStore';
import { openSettingsDrawer } from '@renderer/store/settingsStore';
import { store } from '@renderer/store/store';
import { immersiveStore } from '@renderer/store/immersiveStore';
import storage from '@renderer/utils/localStorage';
import { runPlayerViewTransition } from '@renderer/utils/playerViewTransition';
import { useStore } from '@tanstack/react-store';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import {
  buildDesktopLyricsConfig,
  updateDesktopLyricsConfig
} from '../../hooks/useDesktopLyricsSync';
import calculateTime from '../../utils/calculateTime';
import Button from '../Button';
import SeekBarSlider from '../SeekBarSlider';
import WindowControlsContainer from '../TitleBar/WindowControlsContainer';
import BilingualCapsule from './BilingualCapsule';
import BottomBarHover from './BottomBarHover';
import LyricsContainer from './containers/LyricsContainer';
import SongInfoContainer from './containers/SongInfoContainer';
import DesktopLyricsToggle from './DesktopLyricsToggle';
import HoverVisibleCapsule from './HoverVisibleCapsule';
import QueuePopup from './QueuePopup';
import TopSongInfo from './TopSongInfo';
import VolumeCapsule from './VolumeCapsule';

// type Props = {};

/** 歌词/封面显示模式:仅封面 → 封面+歌词共存 → 仅歌词 */
const COVER_LYRICS_ORDER: Array<'cover' | 'lyrics' | 'both'> = ['cover', 'both', 'lyrics'];
const COVER_LYRICS_LABEL: Record<'cover' | 'lyrics' | 'both', string> = {
  cover: '仅封面',
  lyrics: '仅歌词',
  both: '封面+歌词'
};
const COVER_LYRICS_OPTIONS = [
  ['cover', '封面', 'album'],
  ['both', '分栏', 'view_week'],
  ['lyrics', '歌词', 'lyrics']
] as const;

const FullScreenPlayer = () => {
  // (props: Props)
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  // 歌词/封面三种显示模式:仅封面 → 封面+歌词共存 → 仅歌词
  // ★ 初始化从 preferences 读取(持久化),切换时写回 → 重启后保持上次选择
  const [lyricsMode, setLyricsMode] = useState<'cover' | 'lyrics' | 'both'>(
    preferences?.fullScreenLyricsMode ?? 'cover'
  );
  const { active: isImmersive, region: immersiveRegion } = useStore(immersiveStore);
  const previousLayoutRef = useRef(lyricsMode);
  const wasImmersiveRef = useRef(false);
  useEffect(() => {
    if (isImmersive && !wasImmersiveRef.current) {
      previousLayoutRef.current = lyricsMode;
      setLyricsMode('both');
    } else if (!isImmersive && wasImmersiveRef.current) {
      setLyricsMode(previousLayoutRef.current);
    }
    wasImmersiveRef.current = isImmersive;
  }, [isImmersive, lyricsMode]);
  const activeLayoutIndex = COVER_LYRICS_ORDER.indexOf(lyricsMode);
  const isLyricsVisible = lyricsMode !== 'cover';
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [songPos, setSongPos] = useState(0);
  // 左上角返回按钮图标 hover 状态(hover 播放动画,默认显示动画初始态)
  const [fsRevHover, setFsRevHover] = useState(false);

  const [lyricTx, setLocalLyricTx] = useState(() => lyricTransformStore.state.settings);

  // 持久化 lyricTx
  useEffect(() => {
    localStorage.setItem('nora-lyric-tx', JSON.stringify(lyricTx));
  }, [lyricTx]);

  const setLyricTx = useCallback(
    (updater: (previous: Record<string, any>) => Record<string, any>) => {
      setLocalLyricTx(updater);
      updateLyricTransformSettings(updater);
    },
    []
  );

  useEffect(() => {
    const subscription = lyricTransformStore.subscribe(() => {
      setLocalLyricTx(lyricTransformStore.state.settings);
    });
    return () => subscription.unsubscribe();
  }, []);

  // 桌面歌词配置跟随主窗口实时推送:任何 lyricTx 变更(颜色/字号/显示模式/变换/节拍参数等)
  // 都立即经 updateDesktopLyricsConfig → sendState 同步到桌面窗口,不等节拍 tick。
  useEffect(() => {
    updateDesktopLyricsConfig(buildDesktopLyricsConfig(lyricTx));
  }, [lyricTx]);

  // 背景设置 — 全部从全局 preferences 读取

  const isMuted = useStore(store, (state) => state.player.volume.isMuted);
  const volume = useStore(store, (state) => state.player.volume.value);
  const {
    updateVolume,
    updatePlayerType,
    toggleIsFavorite,
    handleSkipBackwardClick,
    handleSkipForwardClick,
    toggleSongPlayback
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  const queueContainerRef = useRef<HTMLDivElement>(null);
  const controlsVisible = !isImmersive;
  useEffect(() => {
    if (preferences.allowToPreventScreenSleeping && !preferences.removeAnimationsOnBatteryPower)
      window.api.appControls.stopScreenSleeping();
    else window.api.appControls.allowScreenSleeping();
    return () => window.api.appControls.allowScreenSleeping();
  }, [preferences.allowToPreventScreenSleeping, preferences.removeAnimationsOnBatteryPower]);

  const songDuration = preferences.showSongRemainingTime
    ? currentSongData.duration - Math.floor(songPos) >= 0
      ? calculateTime(currentSongData.duration - Math.floor(songPos))
      : calculateTime(0)
    : calculateTime(songPos);

  // 歌词按钮:顺序切换 仅封面 → 仅歌词 → 封面+歌词共存(按钮横排位于进度条上方)
  // ★ 切换后写回 preferences → localStorage 持久化,重启后保持
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingLayoutSave = useRef<'cover' | 'lyrics' | 'both' | undefined>(undefined);
  const currentLayoutMode = useRef(lyricsMode);
  currentLayoutMode.current = lyricsMode;
  const flushLayoutSave = useCallback(() => {
    clearTimeout(layoutSaveTimer.current);
    const mode = pendingLayoutSave.current;
    pendingLayoutSave.current = undefined;
    if (mode !== undefined) storage.preferences.setPreferences('fullScreenLyricsMode', mode);
  }, []);
  useEffect(() => flushLayoutSave, [flushLayoutSave]);

  const selectLyricsMode = useCallback((mode: 'cover' | 'lyrics' | 'both') => {
    if (currentLayoutMode.current === mode) return;
    currentLayoutMode.current = mode;
    setLyricsMode(mode);
    pendingLayoutSave.current = mode;
    clearTimeout(layoutSaveTimer.current);
    // Persist the latest choice after motion; this dispatch updates all settings subscribers.
    layoutSaveTimer.current = setTimeout(flushLayoutSave, 700);
  }, [flushLayoutSave]);

  const handleLyricsToggle = useCallback(() => {
    const next = COVER_LYRICS_ORDER[(COVER_LYRICS_ORDER.indexOf(currentLayoutMode.current) + 1) % COVER_LYRICS_ORDER.length];
    selectLyricsMode(next);
  }, [selectLyricsMode]);

  const handleSkipForwardClickWithParams = useCallback(
    () => handleSkipForwardClick('USER_SKIP'),
    [handleSkipForwardClick]
  );

  const returnToMainPlayer = useCallback(() => {
    void runPlayerViewTransition(() => flushSync(() => updatePlayerType('normal')));
  }, [updatePlayerType]);

  return (
    <div
      className={`full-screen-player dark relative ${!isCurrentSongPlaying && 'paused'} ${
        preferences?.isReducedMotion ? 'reduced-motion' : ''
      } grid !h-full w-full grid-rows-[auto_1fr] overflow-hidden bg-transparent`}
    >
      {/* 占位：维持 grid 第一行高度，与原始 TitleBar h-10 一致 */}
      <div className="h-0" />
      {/* 退出全屏胶囊 */}
      <HoverVisibleCapsule className="hidden" isVisible={controlsVisible}>
        <div className="bg-background-color-1/60 dark:bg-dark-background-color-1/60 absolute top-3 left-3 rounded-full shadow-lg ring-1 ring-white/10 backdrop-blur-xl">
          <button
            className="flex h-11 w-11 cursor-pointer items-center justify-center text-white"
            title={t('player.goToMainPlayer')}
            onMouseEnter={() => setFsRevHover(true)}
            onMouseLeave={() => setFsRevHover(false)}
            onClick={returnToMainPlayer}
          >
            {/* 同心圆角正方形(全屏打开动画倒放):默认显示动画初始态,
                hover 播放:内方 30%→100% + 1→0.9,外方 100%→30% + 1.15→1 */}
            <span className="relative flex h-5 w-5 items-center justify-center">
              <span
                className="absolute rounded-[4px] border-2 border-white/80"
                style={
                  {
                    // 容器 20×20(偶数,中心 10px)— 外方扩到 22×22(偶数,中心同 10px)保持同心
                    top: -1,
                    left: -1,
                    right: -1,
                    bottom: -1,
                    opacity: fsRevHover ? undefined : 1,
                    transform: fsRevHover ? undefined : 'scale(1.15)',
                    animation: fsRevHover
                      ? 'fs-icon-outer-rev 600ms ease forwards, fs-icon-outer-scale-rev 600ms ease forwards'
                      : undefined
                  } as React.CSSProperties
                }
              />
              <span
                className="absolute inset-[4px] rounded-[2px] bg-white"
                style={{
                  opacity: fsRevHover ? undefined : 0.3,
                  transform: fsRevHover ? undefined : 'scale(1)',
                  animation: fsRevHover
                    ? 'fs-icon-inner-rev 600ms ease forwards, fs-icon-inner-scale-rev 600ms ease forwards'
                    : undefined
                }}
              />
            </span>
          </button>
        </div>
      </HoverVisibleCapsule>

      {/* 窗口控件胶囊 */}
      <HoverVisibleCapsule className="hidden" isVisible={controlsVisible}>
        <div className="bg-background-color-1/60 dark:bg-dark-background-color-1/60 absolute top-3 right-3 rounded-full shadow-lg ring-1 ring-white/10 backdrop-blur-xl">
          <WindowControlsContainer />
        </div>
      </HoverVisibleCapsule>

      {/* 全屏设置按钮 + 菜单 */}
      <HoverVisibleCapsule className="hidden" isVisible={controlsVisible}>
        <button
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/22 text-white shadow-lg ring-1 ring-white/14 backdrop-blur-xl transition-[background-color,transform] hover:bg-black/36 active:scale-95"
          onClick={() => openSettingsDrawer('lyrics')}
          title="全屏与歌词设置"
          aria-label="全屏与歌词设置"
        >
          <span className="material-icons-round text-xl">settings</span>
        </button>
      </HoverVisibleCapsule>

      {createPortal(
        <div
          className={`fullscreen-layout-switch-host fixed top-1/2 right-4 z-[60] ${
            (immersiveRegion === 'right-center') ? 'is-visible' : 'is-hidden'
          } ${
            preferences?.isReducedMotion ? 'reduced-motion' : ''
          }`}
        >
          <div
            className="fullscreen-layout-switch"
            role="radiogroup"
            aria-label="全屏显示模式"
            aria-orientation="vertical"
            style={
              {
                '--layout-index': activeLayoutIndex,
                WebkitAppRegion: 'no-drag',
                appRegion: 'no-drag'
              } as React.CSSProperties
            }
          >
            <span className="fullscreen-layout-switch__highlight" aria-hidden="true">
              <span key={lyricsMode} className="fullscreen-layout-switch__highlight-surface" />
            </span>
            {COVER_LYRICS_OPTIONS.map(([mode, label, icon]) => (
              <button
                key={mode}
                type="button"
                className={`fullscreen-layout-switch__option ${
                  lyricsMode === mode ? 'text-white' : 'text-white/55 hover:text-white/90'
                }`}
                onClick={() => selectLyricsMode(mode)}
                role="radio"
                aria-checked={lyricsMode === mode}
                aria-label={label}
                title={label}
                tabIndex={lyricsMode === mode ? 0 : -1}
                onKeyDown={(event) => {
                  const index = COVER_LYRICS_ORDER.indexOf(mode);
                  let next: number;
                  if (event.key === 'ArrowDown') next = (index + 1) % COVER_LYRICS_ORDER.length;
                  else if (event.key === 'ArrowUp') next = (index + COVER_LYRICS_ORDER.length - 1) % COVER_LYRICS_ORDER.length;
                  else if (event.key === 'Home') next = 0;
                  else if (event.key === 'End') next = COVER_LYRICS_ORDER.length - 1;
                  else return;
                  event.preventDefault();
                  selectLyricsMode(COVER_LYRICS_ORDER[next]);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                }}
              >
                <span className="material-icons-round-outlined text-[16px] transition-transform duration-300 group-active:scale-90">
                  {icon}
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      {/* 拖拽区 — 左右触及按钮边缘 */}
      <div className="hidden" style={{ WebkitAppRegion: 'drag', appRegion: 'drag' } as any} />
      <div className="hidden" style={{ WebkitAppRegion: 'drag', appRegion: 'drag' } as any} />

      {/* 歌名/歌手 — 常态持续显示，沉浸模式顶部感应显示 */}
      <TopSongInfo isVisible={!isImmersive || immersiveRegion === 'top-center'} />
      <LyricsContainer
        isLyricsVisible={isLyricsVisible}
        layoutMode={lyricsMode}
        lyricTx={lyricTx}
      />
      <div className="group/fullScreenPlayer pointer-events-none relative flex min-h-0 max-w-full flex-col justify-center">
        <SongInfoContainer
          lyricsMode={lyricsMode}
          />
      </div>


      {isLyricsVisible && (
        <div className="immersive-translation-control pointer-events-auto absolute right-6 bottom-20 z-50">
          <BilingualCapsule
            mode={(lyricTx as any).bilingualMode || 'original'}
            isVisible={immersiveRegion === 'bottom-right'}
            onChange={(mode) => setLyricTx((p: any) => ({ ...p, bilingualMode: mode }))}
          />
        </div>
      )}

      <div className="hidden">
        <DesktopLyricsToggle isVisible={controlsVisible} />
      </div>

      <BottomBarHover className="hidden" isVisible={controlsVisible}>
        {(show) => (
          <>
            {/* 控制按钮 — 横排,进度条上方,与进度条同显隐(鼠标活动/悬停时显现) */}
            <div
              className={`absolute bottom-[54px] left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-black/22 px-5 py-2 shadow-[0_16px_48px_rgba(0,0,0,.22)] ring-1 ring-white/12 backdrop-blur-xl transition-all duration-300 ${
                show ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
              }`}
            >
              {currentSongData.songId < 0 && (
                <Button
                  className="favorite-btn bg-background-color-3/15! text-font-color-white hover:bg-background-color-3/30! dark:text-font-color-white dark:after:bg-dark-font-color-highlight h-fit cursor-pointer border-0! p-3! outline-offset-1 backdrop-blur-lg! transition-[background] focus-visible:outline! active:scale-90"
                  iconClassName={`!text-2xl ${
                    currentSongData.isAFavorite
                      ? 'meterial-icons-round text-font-color-highlight! dark:text-dark-font-color-highlight!'
                      : 'material-icons-round-outlined'
                  }`}
                  isDisabled={!currentSongData.isKnownSource}
                  tooltipLabel={
                    currentSongData.isKnownSource
                      ? t('player.likeDislike')
                      : t('player.likeDislikeDisabled')
                  }
                  clickHandler={() =>
                    currentSongData.isKnownSource && toggleIsFavorite(!currentSongData.isAFavorite)
                  }
                  iconName="favorite"
                  removeFocusOnClick
                />
              )}
              <Button
                className="skip-backward-btn bg-background-color-3/15! text-font-color-white hover:bg-background-color-3/30! dark:text-font-color-white h-fit cursor-pointer border-0! p-2! outline-offset-1 backdrop-blur-lg! transition-[background] focus-visible:outline! active:scale-90"
                tooltipLabel={t('player.prevSong')}
                iconClassName="text-3xl! material-icons-round-outlined"
                clickHandler={handleSkipBackwardClick}
                iconName="skip_previous"
                removeFocusOnClick
              />
              <Button
                className="play-pause-btn bg-background-color-3/15! text-font-color-white hover:bg-background-color-3/30! dark:text-font-color-white h-fit scale-90 cursor-pointer border-0! p-2! outline-offset-1 backdrop-blur-lg! transition-[background] focus-visible:outline! active:scale-75"
                tooltipLabel={t('player.playPause')}
                iconClassName={`!text-4xl ${
                  isCurrentSongPlaying ? 'material-icons-round' : 'material-icons-round-outlined'
                }`}
                clickHandler={toggleSongPlayback}
                iconName={isCurrentSongPlaying ? 'pause' : 'play_arrow'}
                removeFocusOnClick
              />
              <Button
                className="skip-next-btn bg-background-color-3/15! text-font-color-white hover:bg-background-color-3/30! dark:text-font-color-white h-fit cursor-pointer border-0! p-2! outline-offset-1 backdrop-blur-lg! transition-[background] focus-visible:outline! active:scale-90"
                tooltipLabel={t('player.nextSong')}
                iconClassName="text-3xl! material-icons-round-outlined"
                clickHandler={handleSkipForwardClickWithParams}
                iconName="skip_next"
                removeFocusOnClick
              />
              <Button
                className="lyrics-btn !bg-background-color-3/15 text-font-color-white hover:!bg-background-color-3/30 dark:text-font-color-white h-fit cursor-pointer !border-0 !p-3 outline-offset-1 !backdrop-blur-lg transition-[background] focus-visible:!outline active:scale-90"
                iconClassName={`text-2xl! ${
                  lyricsMode !== 'cover' ? 'material-icons-round' : 'material-icons-round-outlined'
                }`}
                clickHandler={handleLyricsToggle}
                iconName="notes"
                tooltipLabel={`${t('player.lyrics')} · ${COVER_LYRICS_LABEL[lyricsMode]} (点击切换)`}
                removeFocusOnClick
              />
            </div>
            <div
              className={`absolute right-[2.5%] bottom-[48px] text-xs text-white/60 transition-opacity select-none ${show ? 'opacity-100' : 'opacity-0'}`}
            >
              {preferences?.showSongRemainingTime ? '-' : ''}
              {songDuration.minutes}:{songDuration.seconds}
            </div>
            <SeekBarSlider
              name="full-screen-player-seek-slider"
              id="fullScreenPlayerSeekSlider"
              sliderOpacity={0.25}
              onSeek={(currentPosition) => setSongPos(currentPosition)}
              className={`full-screen-player-seek-slider bg-background-color-3/25 absolute bottom-0 h-fit w-full appearance-none outline-hidden outline-offset-1 transition-all delay-200 ease-in-out before:absolute before:top-1/2 before:left-0 before:h-1 before:w-[var(--seek-before-width)] before:-translate-y-1/2 before:cursor-pointer before:rounded-3xl before:bg-white/55 before:backdrop-blur-lg before:transition-transform before:delay-200 before:ease-in-out before:content-[''] hover:before:h-3 focus-visible:!outline ${
                show ? '-translate-y-8 scale-x-95 opacity-100' : 'opacity-0'
              }`}
            />
          </>
        )}
      </BottomBarHover>
      {/* 播放队列(内) + 音量胶囊(外) — 右下角 */}
      <div className="hidden">
        <div
          style={
            {
              WebkitAppRegion: 'no-drag',
              appRegion: 'no-drag'
            } as React.CSSProperties
          }
        >
          <HoverVisibleCapsule isVisible={controlsVisible || isQueueOpen}>
            <div ref={queueContainerRef} className="relative">
              <Button
                className="!bg-background-color-3/15 text-font-color-white hover:!bg-background-color-3/30 dark:text-font-color-white h-fit cursor-pointer !border-0 !p-3 outline-offset-1 !backdrop-blur-lg transition-[background] focus-visible:!outline active:scale-90"
                tooltipLabel="播放队列"
                iconClassName="text-2xl!"
                iconName="queue_music"
                clickHandler={() => setIsQueueOpen((prev) => !prev)}
              />
              <QueuePopup
                isOpen={isQueueOpen}
                onClose={() => setIsQueueOpen(false)}
                containerRef={queueContainerRef}
              />
            </div>
          </HoverVisibleCapsule>
        </div>
        <VolumeCapsule
          volume={volume}
          isMuted={isMuted}
          isVisible={controlsVisible}
          onVolumeChange={(v) => updateVolume(v)}
        />
      </div>
    </div>
  );
};

export default FullScreenPlayer;
