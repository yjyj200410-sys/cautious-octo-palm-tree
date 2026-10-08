import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  store: { state: { currentSongData: { songId: 0, title: '', path: '', artists: [] }, localStorage: { preferences: {} } }, subscribe: vi.fn() },
  fetch: vi.fn(),
}));
vi.mock('../../../../../src/renderer/src/store/store', () => ({ store: mocks.store }));
vi.mock('../../../../../src/renderer/src/ncm/ncm-lyric-adapter', () => ({ fetchNcmLyric: mocks.fetch }));
vi.mock('../../../../../src/renderer/src/i18n', () => ({ default: { language: 'zh' } }));
import { LyricsStore } from '../../../../../src/renderer/src/hooks/LyricsStore';

describe('shared plain lyrics service', () => {
  let storeChanged: () => void;
  let audio: EventTarget & { currentTime: number; paused: boolean; ended: boolean };
  let doc: EventTarget & { hidden: boolean };
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.store.state.currentSongData = { songId: 0, title: '', path: '', artists: [] };
    mocks.fetch.mockReset();
    mocks.store.subscribe.mockImplementation(callback => { storeChanged = callback; return { unsubscribe: vi.fn() }; });
    audio = Object.assign(new EventTarget(), { currentTime: 0, paused: true, ended: false });
    doc = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { __noraPlayer: { audio } });
  });
  afterEach(() => { LyricsStore.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const song = (id: number) => { mocks.store.state.currentSongData = { songId: id, title: `song ${id}`, path: `${id}`, artists: [] }; storeChanged(); };
  const result = (text: string) => ({ lyrics: { parsedLyrics: [{ originalText: text, start: 5, end: 10, translatedTexts: [] }] } });
  it('fetches the first NCM song (-1) once and drops stale results after changing songs', async () => {
    let resolveFirst!: (value: unknown) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; })).mockResolvedValueOnce(result('second'));
    LyricsStore.start();
    song(-1); storeChanged(); song(-2);
    await vi.waitFor(() => expect(LyricsStore.getState().lines[0]?.text).toBe('second'));
    resolveFirst(result('stale'));
    await Promise.resolve();
    expect(LyricsStore.getState().lines[0].text).toBe('second');
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it('stops the clock on pause and hidden pages, but keeps desktop lyrics synchronized', async () => {
    mocks.fetch.mockResolvedValue(result('line'));
    LyricsStore.start(); song(-1);
    await vi.waitFor(() => expect(LyricsStore.getState().lines).toHaveLength(1));
    audio.paused = false; audio.dispatchEvent(new Event('play'));
    expect(vi.getTimerCount()).toBe(1);
    audio.currentTime = 7; vi.advanceTimersByTime(100);
    expect(LyricsStore.getState().position).toBe(7);
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    LyricsStore.setBackgroundActive(true);
    expect(vi.getTimerCount()).toBe(1);
    audio.paused = true; audio.dispatchEvent(new Event('pause'));
    expect(vi.getTimerCount()).toBe(0);
    audio.currentTime = 6; audio.dispatchEvent(new Event('seeked'));
    expect(LyricsStore.getState().position).toBe(6);
  });
  it('publishes empty lyrics once without retrying forever', async () => {
    mocks.fetch.mockResolvedValue(null);
    LyricsStore.start(); song(-1);
    await Promise.resolve(); await Promise.resolve();
    for (let i = 0; i < 10; i++) storeChanged();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(LyricsStore.getState().lines).toEqual([]);
  });
});
