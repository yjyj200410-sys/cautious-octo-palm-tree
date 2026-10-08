import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import {
  type CSSProperties,
  type ChangeEvent,
  type WheelEvent,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';

import { AppUpdateContext } from '../contexts/AppUpdateContext';
import calculateTime from '../utils/calculateTime';

type Props = {
  id: string;
  name: string;
  className?: string;
  sliderOpacity?: number;
  onSeek?: (currentPosition: number) => void;
};

const SeekBarSlider = (props: Props) => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const { updateSongPosition } = useContext(AppUpdateContext);

  const { id, name, className, sliderOpacity, onSeek } = props;

  const [songPos, setSongPos] = useState(0);
  const isMouseDownRef = useRef(false);
  const isMouseScrollRef = useRef(false);
  const wheelTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isKeyboardSeekingRef = useRef(false);
  const seekbarRef = useRef(null as HTMLInputElement | null);
  const lowResponseSongPositionRef = useRef(0);
  const durationRef = useRef(currentSongData.duration || 0);
  const onSeekRef = useRef(onSeek);

  durationRef.current = currentSongData.duration || 0;
  onSeekRef.current = onSeek;

  const seekBarCssProperties: CSSProperties = {};
  if (sliderOpacity !== undefined) seekBarCssProperties['--slider-opacity'] = `${sliderOpacity}`;

  const handleSongPositionChange = useCallback((e: Event) => {
    if ('detail' in e && typeof e.detail === 'number') {
      const songPosition = e.detail as number;

      lowResponseSongPositionRef.current = songPosition;
    }
  }, []);

  useEffect(() => {
    document.addEventListener('player/positionChange', handleSongPositionChange);

    return () => document.removeEventListener('player/positionChange', handleSongPositionChange);
  }, [handleSongPositionChange]);

  useEffect(() => {
    let animationFrameId = 0;
    let lastReactSyncAt = 0;

    const renderProgress = (position: number) => {
      const seekbar = seekbarRef.current;
      if (!seekbar) return;

      const duration = Math.max(durationRef.current, position, 0);
      const progress = duration > 0 ? Math.min(Math.max(position / duration, 0), 1) : 0;
      seekbar.value = String(position);
      seekbar.style.setProperty('--seek-before-width', `${progress * 100}%`);
      seekbar.style.setProperty('--seek-progress-scale', String(progress));
    };

    const updateProgress = (timestamp: number) => {
      if (!isMouseDownRef.current && !isMouseScrollRef.current && !isKeyboardSeekingRef.current) {
        const player = (
          window as typeof window & {
            __noraPlayer?: { currentTime: number };
          }
        ).__noraPlayer;
        const livePosition = Number.isFinite(player?.currentTime)
          ? (player?.currentTime ?? 0)
          : lowResponseSongPositionRef.current;

        renderProgress(livePosition);

        // Keep time labels and accessibility values current without forcing the
        // whole React tree to render at display refresh rate.
        if (timestamp - lastReactSyncAt >= 250) {
          lastReactSyncAt = timestamp;
          lowResponseSongPositionRef.current = livePosition;
          setSongPos(livePosition);
          onSeekRef.current?.(livePosition);
        }
      }

      animationFrameId = window.requestAnimationFrame(updateProgress);
    };

    animationFrameId = window.requestAnimationFrame(updateProgress);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      clearTimeout(wheelTimerRef.current);
    };
  }, []);

  // useEffect(() => {
  //   if (
  //     seekbarRef.current &&
  //     !isMouseDownRef.current &&
  //     !isMouseScrollRef.current
  //   ) {
  //     setSongPos(songPosition);
  //     if (onSeek) onSeek(songPosition);
  //   }
  //   //  ? Adding onSeek as a dependency makes the slider unresponsive while sliding for short times.
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [songPosition]);

  const currentSongPosition = calculateTime(songPos);

  const handleOnChange = (e: ChangeEvent<HTMLInputElement>) => {
    const pos = e.currentTarget.valueAsNumber;
    setSongPos(pos);
    const duration = Math.max(durationRef.current, pos, 0);
    const progress = duration > 0 ? Math.min(Math.max(pos / duration, 0), 1) : 0;
    e.currentTarget.style.setProperty('--seek-before-width', `${progress * 100}%`);
    e.currentTarget.style.setProperty('--seek-progress-scale', String(progress));
    if (onSeek) onSeek(pos);
  };

  const handleOnWheel = (e: WheelEvent<HTMLInputElement>) => {
    isMouseScrollRef.current = true;

    const max = parseInt(e.currentTarget.max);
    const scrollIncrement = preferences.seekbarScrollInterval;

    const incrementValue = e.deltaY > 0 ? -scrollIncrement : scrollIncrement;
    let value = (e.currentTarget.valueAsNumber || songPos || 0) + incrementValue;

    if (value > max) value = max;
    if (value < 0) value = 0;
    const progress = max > 0 ? value / max : 0;
    e.currentTarget.value = String(value);
    e.currentTarget.style.setProperty('--seek-before-width', `${progress * 100}%`);
    e.currentTarget.style.setProperty('--seek-progress-scale', String(progress));
    if (onSeek) onSeek(value);
    setSongPos(value);

    clearTimeout(wheelTimerRef.current);
    wheelTimerRef.current = setTimeout(() => {
      isMouseScrollRef.current = false;
      updateSongPosition(value);
    }, 250);
  };

  return (
    <input
      type="range"
      name={name}
      aria-label="播放进度"
      id={id}
      className={
        className ||
        "seek-bar-slider before:bg-seekbar-background-color/75 hover:before:bg-font-color-highlight dark:before:bg-dark-seekbar-background-color/75 dark:hover:before:bg-dark-font-color-highlight relative float-left m-0 h-6 w-full appearance-none bg-[transparent] p-0 outline-hidden outline-offset-1 before:absolute before:top-1/2 before:left-0 before:h-1 before:w-[var(--seek-before-width)] before:-translate-y-1/2 before:cursor-pointer before:rounded-3xl before:transition-[width,background] before:content-[''] focus-visible:outline!"
      }
      min={0}
      step={0.01}
      max={(currentSongData.duration || 0) >= songPos ? currentSongData.duration || 0 : songPos}
      defaultValue={0}
      onChange={handleOnChange}
      onWheel={handleOnWheel}
      onPointerDown={(event) => {
        clearTimeout(wheelTimerRef.current);
        isMouseScrollRef.current = false;
        isMouseDownRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerUp={(event) => {
        isMouseDownRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        updateSongPosition(event.currentTarget.valueAsNumber || 0);
      }}
      onPointerCancel={() => {
        isMouseDownRef.current = false;
      }}
      onKeyUp={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
          isKeyboardSeekingRef.current = false;
          updateSongPosition(event.currentTarget.valueAsNumber || 0);
        }
      }}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        clearTimeout(wheelTimerRef.current);
        isMouseScrollRef.current = false;
        isKeyboardSeekingRef.current = true;
        const input = event.currentTarget;
        const increment = preferences.seekbarScrollInterval || 5;
        const delta = ['ArrowLeft', 'PageDown'].includes(event.key) ? -increment : increment;
        const value =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? durationRef.current
              : Math.max(0, Math.min(durationRef.current, input.valueAsNumber + delta));
        input.value = String(value);
        const progress = durationRef.current > 0 ? value / durationRef.current : 0;
        input.style.setProperty('--seek-before-width', `${progress * 100}%`);
        input.style.setProperty('--seek-progress-scale', String(progress));
        setSongPos(value);
        onSeekRef.current?.(value);
      }}
      onBlur={(event) => {
        if (isKeyboardSeekingRef.current)
          updateSongPosition(event.currentTarget.valueAsNumber || 0);
        isKeyboardSeekingRef.current = false;
      }}
      ref={seekbarRef}
      style={seekBarCssProperties}
      title={`${currentSongPosition.minutes}:${currentSongPosition.seconds}`}
    />
  );
};

export default SeekBarSlider;
