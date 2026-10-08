import { useEffect, useRef, useState } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '../../store/store';
import storage from '../../utils/localStorage';

const snapRate = (value: number) => Math.round(Math.min(1.5, Math.max(.5, value)) * 10) / 10;

export default function PlaybackSpeedControl() {
  const rate = useStore(store, state => state.player.playbackRate || 1);
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const changeRate = (value: number) => {
    const next = snapRate(value);
    store.setState(state => ({ ...state, player: { ...state.player, playbackRate: next } }));
    storage.playback.setPlaybackOptions('playbackRate', next);
  };
  useEffect(() => {
    if (rate !== snapRate(rate)) changeRate(rate);
  }, [rate]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div ref={container} className="playback-speed-control relative flex shrink-0 items-center">
      <button type="button" className="playback-speed-button" title="播放速度" aria-label="播放速度" aria-expanded={open} aria-controls="playback-speed-popup" onClick={() => setOpen(value => !value)}>
        {snapRate(rate).toFixed(1)}×
      </button>
      <div id="playback-speed-popup" role="dialog" aria-label="播放速度" className="queue-popup-surface playback-speed-popup" data-open={open} inert={!open}>
        <div className="playback-speed-scale">
          <div className="playback-speed-ticks" aria-hidden="true">
            {Array.from({ length: 11 }, (_, index) => <span key={index} className={index % 5 === 0 ? 'major' : ''} />)}
          </div>
          <input type="range" aria-label="播放速度" aria-valuetext={`${snapRate(rate).toFixed(1)}倍`} min="0.5" max="1.5" step="0.1" value={snapRate(rate)} onChange={event => changeRate(event.currentTarget.valueAsNumber)} />
        </div>
      </div>
    </div>
  );
}