import { fetchNcmLyric } from '@renderer/ncm/ncm-lyric-adapter';
import { store } from '@renderer/store/store';

import { activeLyricIndex } from '../utils/lyricTimeline';

export interface LyricWord {
  text: string;
  start: number;
  end: number;
}
export interface LyricLine {
  text: string;
  secondaryText: string;
  start: number;
  end: number;
  words?: LyricWord[];
}
export interface LyricsState {
  line: LyricLine | null;
  index: number;
  progress: number;
  position: number;
  isPlaying: boolean;
  songId: number;
  lines: LyricLine[];
}
const empty = (): LyricsState => ({
  line: null,
  index: -1,
  progress: 0,
  position: 0,
  isPlaying: false,
  songId: 0,
  lines: []
});
let state = empty();
const listeners = new Set<(value: LyricsState) => void>();
let started = false;
let generation = 0;
let lastSongKey = '';
let unsubscribe: (() => void) | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let audio: HTMLAudioElement | undefined;
let backgroundActive = false;
const textOf = (value: any): string =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value.map((word) => word.text || '').join('')
      : '';
function notify() {
  for (const listener of listeners) listener({ ...state });
}
function tick() {
  const position = audio?.currentTime ?? 0;
  const isPlaying = !!audio && !audio.paused && !audio.ended;
  const index = activeLyricIndex(state.lines, position);
  const line = state.lines[index] ?? null;
  const duration = line ? line.end - line.start : 0;
  const progress =
    line && duration > 0 && Number.isFinite(duration)
      ? Math.max(0, Math.min(1, (position - line.start) / duration))
      : 0;
  if (
    position === state.position &&
    index === state.index &&
    isPlaying === state.isPlaying &&
    line === state.line
  )
    return;
  state = { ...state, position, index, line, progress, isPlaying };
  notify();
}
function manageClock() {
  tick();
  if (timer) clearInterval(timer);
  timer = undefined;
  if (audio && !audio.paused && !audio.ended && (!document.hidden || backgroundActive))
    timer = setInterval(tick, 100);
}
const audioEvents = ['play', 'pause', 'ended', 'seeked', 'timeupdate', 'loadedmetadata'] as const;
function attachAudio() {
  const next = (window as any).__noraPlayer?.audio as HTMLAudioElement | undefined;
  if (next === audio) return;
  if (audio) for (const event of audioEvents) audio.removeEventListener(event, manageClock);
  audio = next;
  if (audio) for (const event of audioEvents) audio.addEventListener(event, manageClock);
  manageClock();
}
async function loadSong(song: any) {
  const request = ++generation;
  state = { ...empty(), songId: song.songId };
  notify();
  const artists = Array.isArray(song.artists) ? song.artists.map((artist: any) => artist.name) : [];
  let result: SongLyrics | null | undefined;
  try {
    result =
      song.songId < 0
        ? await fetchNcmLyric({
            ncmId: -song.songId,
            title: song.title,
            artists,
            duration: song.duration || 0
          })
        : await window.api.lyrics.getSongLyrics({
            songTitle: song.title,
            songArtists: artists,
            album: song.album?.name,
            songPath: song.path,
            duration: song.duration
          });
    if (request !== generation) return;
  } catch (error) {
    console.error('[LyricsStore] load failed', error);
  }
  if (request !== generation) return;
  const lines =
    result?.lyrics?.parsedLyrics
      ?.map((line) => ({
        text: textOf(line.originalText),
        secondaryText: textOf(line.translatedTexts?.[0]?.text || line.romanizedText),
        start: line.start ?? 0,
        end: line.end ?? 0,
        words: Array.isArray(line.originalText)
          ? line.originalText.map((word) => ({ text: word.text, start: word.start, end: word.end }))
          : undefined
      }))
      .sort((a, b) => a.start - b.start) ?? [];
  state = { ...state, lines };
  tick();
  notify();
}
function checkSong() {
  attachAudio();
  const song = store.state.currentSongData;
  const key = song?.songId ? `${song.songId}|${song.path}|${song.title}` : '';
  if (key === lastSongKey) return;
  lastSongKey = key;
  if (key) void loadSong(song);
  else {
    ++generation;
    state = empty();
    notify();
  }
}
export const LyricsStore = {
  start() {
    if (started) return;
    started = true;
    checkSong();
    const subscription = store.subscribe(checkSong);
    unsubscribe = () => subscription.unsubscribe();
    document.addEventListener('visibilitychange', manageClock);
    document.addEventListener('player/positionChange', manageClock);
  },
  subscribe(listener: (value: LyricsState) => void) {
    listeners.add(listener);
    listener({ ...state });
    return () => {
      listeners.delete(listener);
    };
  },
  getState() {
    return { ...state };
  },
  setLines(songId: number, lines: LyricLine[]) {
    if (songId !== state.songId) return;
    state = { ...state, lines };
    tick();
    notify();
  },
  setBackgroundActive(active: boolean) {
    backgroundActive = active;
    manageClock();
  },
  stop() {
    ++generation;
    if (timer) clearInterval(timer);
    timer = undefined;
    unsubscribe?.();
    unsubscribe = undefined;
    if (audio) for (const event of audioEvents) audio.removeEventListener(event, manageClock);
    audio = undefined;
    document.removeEventListener('visibilitychange', manageClock);
    document.removeEventListener('player/positionChange', manageClock);
    started = false;
    lastSongKey = '';
    state = empty();
    backgroundActive = false;
  }
};
