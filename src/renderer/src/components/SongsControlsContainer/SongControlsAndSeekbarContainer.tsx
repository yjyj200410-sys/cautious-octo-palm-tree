import { store } from "@renderer/store/store";
import { useStore } from "@tanstack/react-store";
import { useContext, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import gsap from "gsap";

import { AppUpdateContext } from "../../contexts/AppUpdateContext";
import { prefersReducedMotion } from "../../utils/motionPreference";
import Button from "../Button";

const SongControlsAndSeekbarContainer = () => {
  const controlsRef = useRef<HTMLDivElement>(null);
  const animationContextRef = useRef<gsap.Context | null>(null);
  const shuffleTimelineRef = useRef<gsap.core.Timeline | null>(null);
  const isAFavorite = useStore(
    store,
    (state) => state.currentSongData.isAFavorite,
  );
  const currentSongId = useStore(
    store,
    (state) => state.currentSongData.songId,
  );
  const isKnownSource = useStore(
    store,
    (state) => state.currentSongData.isKnownSource,
  );
  const isShuffling = useStore(store, (state) => state.player.isShuffling);
  const isRepeating = useStore(store, (state) => state.player.isRepeating);
  const isCurrentSongPlaying = useStore(
    store,
    (state) => state.player.isCurrentSongPlaying,
  );
  const isPlayerStalled = useStore(
    store,
    (state) => state.player.isPlayerStalled,
  );
  const {
    toggleQueueShuffle,
    toggleIsFavorite,
    toggleRepeat,
    toggleSongPlayback,
    handleSkipForwardClick,
    handleSkipBackwardClick,
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();

  useEffect(() => {
    const context = gsap.context(() => {}, controlsRef);
    animationContextRef.current = context;
    return () => {
      context.revert();
      animationContextRef.current = null;
      shuffleTimelineRef.current = null;
    };
  }, []);

  const nudgeSkipIcon = (button: HTMLButtonElement, direction: -1 | 1) => {
    if (prefersReducedMotion()) return;
    const icon = button.querySelector<HTMLElement>('.icon');
    if (!icon) return;
    animationContextRef.current?.add(() => {
      gsap.fromTo(icon, { x: direction * 4 }, {
        x: 0,
        duration: 0.2,
        ease: 'power2.out',
        overwrite: 'auto',
        clearProps: 'transform',
      });
    });
  };

  const animateShuffleIcon = (turningOn: boolean) => {
    if (prefersReducedMotion()) return;
    const icon = controlsRef.current?.querySelector<HTMLElement>('.shuffle-btn .icon');
    if (!icon) return;
    animationContextRef.current?.add(() => {
      shuffleTimelineRef.current?.kill();
      gsap.set(icon, { transformPerspective: 180, transformOrigin: '50% 50%' });
      const timeline = gsap.timeline({
        defaults: { overwrite: 'auto' },
        onComplete: () => { shuffleTimelineRef.current = null; gsap.set(icon, { clearProps: 'transform' }); },
      });
      shuffleTimelineRef.current = timeline;
      timeline
        .to(icon, { rotationX: turningOn ? 55 : -55, duration: 0.1, ease: 'power2.in' })
        .to(icon, { rotationX: 0, duration: 0.12, ease: 'power2.out' });
    });
  };

  const previousRepeatState = useRef(isRepeating);
  useEffect(() => {
    if (previousRepeatState.current === isRepeating) return;
    previousRepeatState.current = isRepeating;
    if (prefersReducedMotion()) return;
    const arrows = controlsRef.current?.querySelector<HTMLElement>('.repeat-btn .repeat-arrows');
    if (!arrows) return;
    animationContextRef.current?.add(() => {
      const currentRotation = Number(gsap.getProperty(arrows, 'rotation')) || 0;
      const targetRotation = Math.ceil((currentRotation + 180) / 180) * 180;
      gsap.to(arrows, {
        rotation: targetRotation,
        transformOrigin: '50% 50%',
        duration: 0.3 * (targetRotation - currentRotation) / 180,
        ease: 'power2.inOut',
        overwrite: 'auto',
      });
    });
  }, [isRepeating]);

  const bounceLikeHeart = (button: HTMLButtonElement) => {
    if (prefersReducedMotion()) return;
    const heart = button.querySelector<HTMLElement>('.like-heart');
    if (!heart) return;
    animationContextRef.current?.add(() => {
      gsap.fromTo(heart, { scale: 0.82 }, {
        scale: 1,
        duration: 0.32,
        ease: 'back.out(2)',
        overwrite: 'auto',
        clearProps: 'transform',
      });
    });
  };

  return (
    <div className="song-controls-and-seekbar-container flex h-full min-w-0 flex-col items-center justify-center gap-1 py-2">
      <div ref={controlsRef} className="desktop-player-primary-controls controls-container [&>div.active_span.icon]:text-font-color-highlight! dark:[&>div.active_span.icon]:text-dark-font-color-highlight! flex w-full max-w-md items-center justify-center gap-1 px-2 [&>div.active_span.icon]:opacity-100">
        {/* ★ 本地歌曲隐藏播放器收藏按钮，仅网易云歌曲显示 */}
        {currentSongId < 0 && (
          <button
            key={currentSongId}
            type="button"
            className="button like-btn m-0! border-0! bg-transparent p-0! text-font-color-black outline-offset-1 hover:bg-transparent focus-visible:outline! dark:bg-transparent dark:text-font-color-white dark:hover:bg-transparent"
            title={isKnownSource ? t('player.likeDislike') : t('player.likeDislikeDisabled')}
            aria-label={t('player.likeDislike')}
            aria-pressed={isAFavorite}
            data-liked={isAFavorite}
            disabled={!isKnownSource}
            onClick={(event) => {
              event.currentTarget.blur();
              bounceLikeHeart(event.currentTarget);
              toggleIsFavorite(!isAFavorite);
            }}
          >
            <span className="like-heart relative flex size-6 items-center justify-center text-2xl leading-none" aria-hidden="true">
              <span className="like-heart-outline material-icons-round-outlined absolute inset-0 flex items-center justify-center">favorite</span>
              <span className="like-heart-fill material-icons-round text-font-color-highlight dark:text-dark-font-color-highlight absolute inset-0 flex items-center justify-center">favorite</span>
            </span>
          </button>
        )}

        <Button
          className={`shuffle-btn after:bg-font-color-highlight dark:after:bg-dark-font-color-highlight !m-0 flex items-center justify-center !rounded-none !border-0 bg-transparent !p-0 outline-offset-1 after:absolute after:h-1 after:w-1 after:translate-y-4 after:rounded-full after:opacity-0 after:transition-opacity hover:bg-transparent focus-visible:!outline dark:bg-transparent dark:hover:bg-transparent ${
            isShuffling && "active after:opacity-100"
          }`}
          tooltipLabel={t("player.shuffle")}
          iconName="shuffle"
          iconClassName="material-icons-round text-2xl! opacity-60 transition-opacity hover:opacity-80"
          clickHandler={() => {
            animateShuffleIcon(!isShuffling);
            toggleQueueShuffle();
          }}
        />

        <Button
          className="skip-back-btn m-0! rounded-none! border-0! bg-transparent p-0! outline-offset-1 hover:bg-transparent focus-visible:outline! dark:bg-transparent dark:hover:bg-transparent"
          tooltipLabel={t("player.prevSong")}
          iconName="skip_previous"
          iconClassName="material-icons-round text-2xl! opacity-60 transition-opacity hover:opacity-80"
          clickHandler={(event) => {
            nudgeSkipIcon(event.currentTarget, -1);
            handleSkipBackwardClick();
          }}
        />

        <Button
          className={`play-pause-btn relative !m-0 !border-0 !p-0 outline-offset-1 focus-visible:!outline ${
            isPlayerStalled &&
            `after:animate-spin-ease after:border-t-font-color-black dark:after:border-t-font-color-white after:absolute after:h-5 after:w-5 after:rounded-full after:border-2 after:border-[transparent] after:content-['']`
          }`}
          tooltipLabel={t("player.playPause")}
          iconElement={
            <span className={`icon play-pause-icon-stack ${isPlayerStalled ? 'is-stalled' : ''}`} aria-hidden="true">
              <span className={`material-icons-round play-pause-glyph ${isCurrentSongPlaying ? '' : 'is-visible'}`}>play_arrow</span>
              <span className={`material-icons-round play-pause-glyph ${isCurrentSongPlaying ? 'is-visible' : ''}`}>pause</span>
            </span>
          }
          clickHandler={() => !isPlayerStalled && toggleSongPlayback()}
        />

        <Button
          className="skip-forward-btn m-0! flex rounded-none! border-0! bg-transparent p-0! outline-offset-1 hover:bg-transparent focus-visible:outline! dark:bg-transparent dark:hover:bg-transparent"
          tooltipLabel={t("player.nextSong")}
          iconName="skip_next"
          iconClassName="material-icons-round text-2xl! opacity-60 transition-opacity hover:opacity-80"
          clickHandler={(event) => {
            nudgeSkipIcon(event.currentTarget, 1);
            handleSkipForwardClick("USER_SKIP");
          }}
        />

        <Button
          className={`repeat-btn after:bg-font-color-highlight dark:after:bg-dark-font-color-highlight !m-0 !rounded-none !border-0 bg-transparent !p-0 outline-offset-1 after:absolute after:h-1 after:w-1 after:translate-y-4 after:rounded-full after:opacity-0 after:transition-opacity hover:bg-transparent focus-visible:!outline dark:bg-transparent dark:hover:bg-transparent ${
            isRepeating !== "false" && "active after:opacity-100"
          }`}
          tooltipLabel={t("player.repeat")}
          iconElement={
            <span className="icon relative flex size-6 items-center justify-center leading-none opacity-60 transition-opacity" aria-hidden="true">
              <span className="repeat-arrows material-icons-round text-2xl! leading-none">repeat</span>
              {isRepeating === "repeat-1" && <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-sans text-[9px] font-bold leading-none">1</span>}
            </span>
          }
          clickHandler={() => toggleRepeat()}
        />

      </div>
    </div>
  );
};

export default SongControlsAndSeekbarContainer;
