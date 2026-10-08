import {
  getCustomFontEntries,
  getEffectiveLyricsFontName,
  getLocalFontUrls
} from '@renderer/utils/fontLoader';
import { useEffect } from 'react';

import { lyricTransformStore } from '../store/lyricTransformStore';
import { LyricsStore, type LyricLine } from './LyricsStore';

let config: Record<string, any> = {};
let active = false;
let lastLines: LyricLine[] | undefined;
let lastConfig: Record<string, any> | undefined;
export function buildDesktopLyricsConfig(settings: Record<string, any>): Record<string, any> {
  const family = getEffectiveLyricsFontName();
  return {
    scale: settings.scale ?? 100,
    lineSpacing: settings.lineSpacing ?? 100,
    letterSpacing: settings.letterSpacing ?? 0,
    lyricAlign: settings.lyricAlign ?? 'center',
    bilingualMode: settings.bilingualMode ?? 'original',
    ktvHighlight: settings.ktvHighlight !== false,
    lyricCustomLineCount: settings.lyricCustomLineCount ?? 5,
    lyricLayout: settings.lyricLayout ?? 'centered',
    lyricMotion: settings.lyricMotion ?? 'elegant',
    primaryColor: settings.lyricColor || '#ffffff',
    highlightColor: settings.highlightColor || '#fff0b8',
    fontFamily: family
      ? `"${family}", "Microsoft YaHei", sans-serif`
      : '"Microsoft YaHei", sans-serif',
    fontWeight: localStorage.getItem('lumina_fontWeight') || '600',
    customFonts: getCustomFontEntries(),
    localFonts: getLocalFontUrls()
  };
}
function sendState() {
  if (!active) return;
  const state = LyricsStore.getState();
  window.api.settingsHelpers.sendDesktopLyricsState?.({
    songId: state.songId,
    index: state.index,
    position: state.position,
    progress: state.progress,
    text: state.line?.text || '',
    secondaryText: state.line?.secondaryText || '',
    playing: state.isPlaying,
    ...(state.lines !== lastLines ? { lines: state.lines } : {}),
    ...(config !== lastConfig ? { config } : {})
  });
  lastLines = state.lines;
  lastConfig = config;
}
export function updateDesktopLyricsConfig(next: Record<string, any>) {
  config = next;
  sendState();
}
export function useDesktopLyricsSync() {
  useEffect(() => {
    let mounted = true;
    const setActive = (enabled: boolean) => {
      active = enabled;
      if (enabled) {
        lastLines = undefined;
        lastConfig = undefined;
      }
      LyricsStore.setBackgroundActive(enabled);
      if (enabled) sendState();
    };
    const api = window.api.settingsHelpers;
    api
      .getDesktopLyricsState?.()
      .then((enabled) => {
        if (mounted) setActive(!!enabled);
      })
      .catch(() => {});
    const off = api.onDesktopLyricsStateChanged?.((value) => setActive(!!value.enabled));
    const unsubscribe = LyricsStore.subscribe(sendState);
    const refreshConfig = () =>
      updateDesktopLyricsConfig(buildDesktopLyricsConfig(lyricTransformStore.state.settings));
    const settingsSubscription = lyricTransformStore.subscribe(refreshConfig);
    window.addEventListener('lumina:fontLoaded', refreshConfig);
    refreshConfig();
    return () => {
      mounted = false;
      off?.();
      unsubscribe();
      settingsSubscription.unsubscribe();
      window.removeEventListener('lumina:fontLoaded', refreshConfig);
      setActive(false);
    };
  }, []);
}
