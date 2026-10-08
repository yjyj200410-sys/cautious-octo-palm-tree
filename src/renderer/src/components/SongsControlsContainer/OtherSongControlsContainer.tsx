import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import gsap from 'gsap';

import { prefersReducedMotion } from '../../utils/motionPreference';
import Button from '../Button';
import NcmPlaybackQualityControl from './NcmPlaybackQualityControl';
import PlaybackSpeedControl from './PlaybackSpeedControl';
import SoundEffectsControl from './SoundEffectsControl';
import StemSeparationControl from './StemSeparationControl';
import VolumeControl from './VolumeControl';

const OtherSongControlsContainer = ({
  isQueueOpen,
  onQueueToggle
}: {
  isQueueOpen: boolean;
  onQueueToggle: () => void;
}) => {
  const controlsRef = useRef<HTMLDivElement>(null);
  const animationContextRef = useRef<gsap.Context | null>(null);
  const [dlEnabled, setDlEnabled] = useState(false);
  const [miniPlayerVisible, setMiniPlayerVisible] = useState(false);

  useEffect(() => {
    const context = gsap.context(() => {}, controlsRef);
    animationContextRef.current = context;
    return () => {
      context.revert();
      animationContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    window.api.settingsHelpers.getDesktopLyricsState().then(setDlEnabled).catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    window.api.miniPlayerWindow.getState().then((visible) => {
      if (mounted) setMiniPlayerVisible(visible);
    }).catch(() => {});
    const unsubscribe = window.api.miniPlayerWindow.onVisibilityChanged(setMiniPlayerVisible);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const toggleDesktopLyrics = async () => {
    try {
      const enabled = await window.api.settingsHelpers.toggleDesktopLyrics();
      if (typeof enabled === 'boolean') setDlEnabled(enabled);
      return enabled;
    } catch (error) {
      console.error('Failed to toggle desktop lyrics', error);
      return undefined;
    }
  };

  const animateIcon = (button: HTMLButtonElement, from: gsap.TweenVars) => {
    if (prefersReducedMotion()) return;
    const icon = button.querySelector<HTMLElement>('.icon');
    if (!icon) return;
    animationContextRef.current?.add(() => {
      gsap.fromTo(icon, from, {
        x: 0,
        y: 0,
        scale: 1,
        duration: 0.25,
        ease: 'back.out(1.35)',
        overwrite: 'auto',
        clearProps: 'transform',
      });
    });
  };

  const { t } = useTranslation();

  return (
    <div ref={controlsRef} className="other-controls-container flex min-w-0 items-center justify-end gap-1">
      <PlaybackSpeedControl />
      <NcmPlaybackQualityControl />
      <SoundEffectsControl />
      <StemSeparationControl />

      {/* 桌面歌词开关 */}
      <Button
        className={`dl-lyrics-btn after:bg-font-color-highlight dark:after:bg-dark-font-color-highlight !m-0 !rounded-md !border-0 bg-transparent !p-0 outline-offset-1 after:absolute after:h-1 after:w-1 after:translate-y-4 after:rounded-full after:transition-opacity hover:bg-black/5 focus-visible:!outline dark:bg-transparent dark:hover:bg-white/7 ${
          dlEnabled ? 'active after:opacity-100' : 'after:opacity-0'
        }`}
        tooltipLabel="桌面歌词"
        iconName="lyrics"
        iconClassName={`!text-2xl opacity-60 transition-[color,_opacity] hover:opacity-80 ${dlEnabled ? 'material-icons-round' : 'material-icons-round-outlined'}`}
        clickHandler={(event) => {
          const button = event.currentTarget;
          void toggleDesktopLyrics().then((enabled) => {
            if (typeof enabled === 'boolean') {
              animateIcon(button, { y: enabled ? 4 : -4, scale: 0.94 });
            }
          });
        }}
      />

      <Button
        className={`mini-player-btn text-font-color-black text-opacity-60 dark:text-font-color-white m-0! rounded-md! border-0! bg-transparent p-0! outline-offset-1 hover:bg-black/5 focus-visible:outline! dark:bg-transparent dark:hover:bg-white/7 ${miniPlayerVisible ? 'active' : ''}`}
        clickHandler={(event) => {
          animateIcon(event.currentTarget, { x: 3, y: -3, scale: 0.86 });
          // 独立 Mini Player 窗口;已打开则隐藏/再开
          void window.api.miniPlayerWindow.toggle().then(setMiniPlayerVisible).catch(() => {});
        }}
        tooltipLabel={t('player.openInMiniPlayer')}
        iconName="pip"
        iconClassName="material-icons-round-outlined icon cursor-pointer text-xl text-font-color-black opacity-60 transition-opacity hover:opacity-80 dark:text-font-color-white"
      />

      <VolumeControl />
      <span
        aria-hidden="true"
        className="mx-1 h-5 w-px shrink-0 bg-black/15 dark:bg-white/18"
      />
      {/* 播放队列:打开底部胶囊上方的队列浮层(原 /main-player/queue 展开页已移除) */}
      <Button
        className={`queue-btn text-font-color-black after:bg-font-color-highlight dark:text-font-color-white dark:after:bg-dark-font-color-highlight !m-0 !rounded-md !border-0 bg-transparent !p-0 outline-offset-1 after:absolute after:h-1 after:w-1 after:translate-y-4 after:rounded-full after:transition-opacity hover:bg-black/5 focus-visible:!outline dark:bg-transparent dark:hover:bg-white/7 ${
          isQueueOpen ? 'active after:opacity-100' : 'after:opacity-0'
        }`}
        tooltipLabel={t('player.currentQueue')}
        iconName="queue_music"
        iconClassName={`!text-2xl opacity-60 transition-[color,_opacity] hover:opacity-80 ${isQueueOpen ? 'material-icons-round' : 'material-icons-round-outlined'}`}
        clickHandler={(event) => {
          animateIcon(event.currentTarget, { y: isQueueOpen ? -4 : 4, scale: 0.94 });
          onQueueToggle();
        }}
      />
    </div>
  );
};

export default OtherSongControlsContainer;

