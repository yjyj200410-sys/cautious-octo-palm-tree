import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/renderer/src/store/store', () => ({
  dispatch: vi.fn(),
  store: { state: { currentSongData: {}, player: {} } }
}));
vi.mock('../../../../../src/renderer/src/utils/localStorage', () => ({
  default: { playback: { setCurrentSongOptions: vi.fn() } }
}));
vi.mock('../../../../../src/renderer/src/utils/unifiedStorage', () => ({
  FavoriteService: { isFavorite: () => false }
}));
vi.mock('../../../../../src/renderer/src/other/PlayTrace', () => ({
  createPlayTrace: () => ({}),
  getPlayTrace: () => null
}));
vi.mock('../../../../../src/renderer/src/other/equalizerData', () => ({
  equalizerBandHertzData: []
}));
vi.mock('tone', () => ({}));
import AudioPlayer from '../../../../../src/renderer/src/other/player';
import { dispatch, store } from '../../../../../src/renderer/src/store/store';

function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}
function createPlayer() {
  const audio = Object.assign(new EventTarget(), {
    src: '',
    readyState: 0,
    load: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    currentTime: 0,
    duration: 100
  });
  const player = Object.assign(Object.create(AudioPlayer.prototype), {
    audio,
    playRequestId: 0,
    playbackActionId: 0,
    playbackIntent: false,
    nextMssGeneration: 0,
    nextMssKey: '',
    currentMssTrack: null,
    currentMssRequestId: 0,
    listeners: new Map(),
    unavailableSourceCount: 0,
    queue: { getSongMetadata: () => undefined, nextSongId: null },
    prefetchMgr: { getCached: () => undefined },
    stemSeparation: {
      getSnapshot: () => ({ enabled: false }),
      reset: vi.fn(),
      setPlaying: vi.fn(),
      setCachedSource: vi.fn(),
      setCurrentTrack: vi.fn(),
      setNextTrack: vi.fn(),
      getPrepared: vi.fn().mockResolvedValue(null)
    },
    fadeInAudio: vi.fn().mockResolvedValue(undefined),
    fadeOutAudio: vi.fn().mockResolvedValue(undefined)
  });
  return player;
}
const song = (id: number) => ({
  songId: id,
  title: String(id),
  path: `/song-${id}.mp3`,
  duration: 100
});

describe('playback request ordering and intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.state.currentSongData = {};
    vi.stubGlobal('document', new EventTarget());
    vi.stubGlobal(
      'CustomEvent',
      class extends Event {
        constructor(
          type: string,
          public options?: unknown
        ) {
          super(type);
        }
      }
    );
  });
  it('assigns the original source immediately with real-time separation enabled', async () => {
    const player = createPlayer();
    player.stemSeparation.getSnapshot = () => ({ enabled: true });
    await player.loadSong(song(1), { autoPlay: true });
    expect(player.audio.src).toContain('song-1.mp3');
    expect(player.stemSeparation.reset).toHaveBeenCalledTimes(1);
    player.audio.dispatchEvent(new Event('canplay'));
    await Promise.resolve();
    expect(player.audio.play).toHaveBeenCalledTimes(1);
  });
  it('late local metadata cannot overwrite a newer song', async () => {
    const old = deferred<ReturnType<typeof song>>();
    vi.stubGlobal('window', {
      api: {
        audioLibraryControls: {
          getSong: vi.fn((id) => (id === 1 ? old.promise : Promise.resolve(song(id))))
        }
      }
    });
    const player = createPlayer();
    const first = player.loadSong(1, { autoPlay: true });
    await player.loadSong(2, { autoPlay: true });
    old.resolve(song(1));
    expect(await first).toBeNull();
    expect(player.audio.src).toContain('song-2.mp3');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('switches to completed current cache at the paused position without resuming', () => {
    const player = createPlayer();
    player.playRequestId = 1;
    player.currentMssRequestId = 1;
    player.currentMssTrack = { songId: 1, quality: 'standard' };
    player.audio.currentTime = 42;
    player.stemSeparation.getSnapshot = () => ({ enabled: true, cached: false });
    player.activatePreparedMss({ songId: 1, quality: 'standard', url: 'nora:///cache.wav' });
    player.audio.currentTime = 0;
    player.audio.dispatchEvent(new Event('canplay'));
    expect(player.audio.currentTime).toBe(42);
    expect(player.audio.play).not.toHaveBeenCalled();
    expect(player.audio.src).toBe('nora:///cache.wav');
  });
  it('a superseded current cache cannot replace a new song or resume it', () => {
    const player = createPlayer();
    player.playRequestId = 2;
    player.currentMssRequestId = 1;
    player.currentMssTrack = { songId: 1, quality: 'standard' };
    player.stemSeparation.getSnapshot = () => ({ enabled: true, cached: false });
    player.audio.src = '/new.mp3';
    player.activatePreparedMss({ songId: 1, quality: 'standard', url: 'nora:///old.wav' });
    expect(player.audio.src).toBe('/new.mp3');
    expect(player.audio.load).not.toHaveBeenCalled();
  });
  it('plays prepared network audio without re-resolving an expired original URL', async () => {
    const player = createPlayer();
    player.stemSeparation.getSnapshot = () => ({ enabled: true });
    player.stemSeparation.getPrepared = vi
      .fn()
      .mockResolvedValue({
        songId: -1,
        originalPath: 'https://example.com/expired.mp3',
        url: 'nora:///prepared.wav',
        trial: false
      });
    player.prefetchMgr.prefetch = vi.fn();
    await player.loadSong({ ...song(-1), artists: [] }, { autoPlay: false });
    expect(player.prefetchMgr.prefetch).not.toHaveBeenCalled();
    expect(player.audio.src).toBe('nora:///prepared.wav');
  });
  it('pause while resolving prevents autoplay when the source becomes ready', async () => {
    const pending = deferred<ReturnType<typeof song>>();
    vi.stubGlobal('window', { api: { audioLibraryControls: { getSong: () => pending.promise } } });
    const player = createPlayer();
    const loading = player.loadSong(1, { autoPlay: true });
    await player.pause();
    pending.resolve(song(1));
    await loading;
    player.audio.dispatchEvent(new Event('canplay'));
    expect(player.audio.play).not.toHaveBeenCalled();
  });
  it('pause after source assignment cancels buffered autoplay', async () => {
    const player = createPlayer();
    await player.loadSong(song(1), { autoPlay: true });
    await player.pause();
    player.audio.dispatchEvent(new Event('canplay'));
    expect(player.audio.play).not.toHaveBeenCalled();
  });
  it('native play rejection reaches the caller', async () => {
    const player = createPlayer();
    player.audio.play.mockRejectedValue(new Error('media unavailable'));
    await expect(player.play()).rejects.toThrow('media unavailable');
    expect(player.fadeInAudio).not.toHaveBeenCalled();
  });
  it('a delayed fade-out cannot pause newly resumed playback', async () => {
    vi.useFakeTimers();
    try {
      const player = createPlayer();
      delete player.fadeOutAudio;
      player.currentContext = { currentTime: 0 };
      player.gainNode = {
        gain: {
          value: 1,
          cancelScheduledValues: vi.fn(),
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn()
        }
      };
      const pausing = player.pause();
      await player.play();
      await vi.advanceTimersByTimeAsync(250);
      await pausing;
      expect(player.audio.pause).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
