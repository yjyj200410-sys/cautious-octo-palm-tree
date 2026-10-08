import { useContext, useEffect, useMemo, useState } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '../../../store/store';
import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import { LyricsStore } from '../../../hooks/LyricsStore';
import { buildDesktopLyricsConfig } from '../../../hooks/useDesktopLyricsSync';
import LyricCarousel from '../../LyricCarousel';

type Props = { isLyricsVisible: boolean; layoutMode: 'cover' | 'lyrics' | 'both'; lyricTx: Record<string, any>; };
export default function LyricsContainer({ isLyricsVisible, layoutMode, lyricTx }: Props) {
  const [lyrics, setLyrics] = useState(LyricsStore.getState);
  const preferences = useStore(store, value => value.localStorage.preferences);
  const [fontVersion, setFontVersion] = useState(0);
  useEffect(() => {
    const loaded = () => setFontVersion(version => version + 1);
    window.addEventListener('lumina:fontLoaded', loaded);
    return () => window.removeEventListener('lumina:fontLoaded', loaded);
  }, []);
  const config = useMemo(() => buildDesktopLyricsConfig(lyricTx), [lyricTx, fontVersion]);
  const onBattery = useStore(store, value => value.isOnBatteryPower);
  const { updateSongPosition } = useContext(AppUpdateContext);
  useEffect(() => {
    if (!isLyricsVisible) return;
    return LyricsStore.subscribe(setLyrics);
  }, [isLyricsVisible]);
  useEffect(() => {
    if (!isLyricsVisible) return;
    const skip = (event: KeyboardEvent) => {
      if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      if (event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable)) return;
      const current = LyricsStore.getState();
      const next = current.lines[current.index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (!next || !Number.isFinite(next.start)) return;
      event.preventDefault(); updateSongPosition(next.start);
    };
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [isLyricsVisible, updateSongPosition]);
  if (!isLyricsVisible) return null;
  return <div className="simple-fullscreen-lyrics" style={{ left: layoutMode === 'both' ? '50%' : 0 }}>
    <LyricCarousel lines={lyrics.lines} index={lyrics.index} position={lyrics.position}
      config={config} onSeek={updateSongPosition}
      reducedMotion={preferences.isReducedMotion || (onBattery && preferences.removeAnimationsOnBatteryPower)} />
  </div>;
}
