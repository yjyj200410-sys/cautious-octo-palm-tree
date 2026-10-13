import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@tanstack/react-store';
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react';
import { Virtuoso } from 'react-virtuoso';

import { version } from '../../../../../package.json';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { useNcmUser } from '../../contexts/NcmUserContext';
import { LyricsStore, type LyricsState } from '../../hooks/LyricsStore';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import { proxyCoverUrl } from '../../ncm';
import { PlaybackBridge } from '../../ncm/playback/PlaybackBridge';
import { NcmRepository } from '../../ncm/repository';
import type { NcmSong } from '../../ncm/types';
import toggleSongIsFavorite from '../../other/toggleSongIsFavorite';
import { store } from '../../store/store';
import storage from '../../utils/localStorage';
import { FavoriteService } from '../../utils/unifiedStorage';
import ManagementDialog from '../ManagementDialog';
import WindowControlsContainer from '../TitleBar/WindowControlsContainer';

const LoginDialog = lazy(() => import('../LoginDialog/LoginDialog'));
type Tab = 'favorites' | 'recommend' | 'local';
type Source = 'netease' | 'local';
type Song = SongData | NcmSong;
const time = (n: number) =>
  `${Math.floor(Math.max(0, n || 0) / 60)}:${String(Math.floor(Math.max(0, n || 0) % 60)).padStart(2, '0')}`;
const artist = (song: Song | AudioPlayerData) =>
  song.artists?.map((a) => a.name).join(' / ') || '未知歌手';
const isNcm = (song: Song): song is NcmSong => 'ncmId' in song;
const identity = (id: number) => ({
  source: id < 0 ? ('netease' as const) : ('local' as const),
  sourceId: String(Math.abs(id))
});

export function Icon({ name }: { name: string }) {
  return (
    <span className="material-icons-round" aria-hidden="true">
      {name}
    </span>
  );
}
function Key({
  label,
  icon,
  onClick,
  active = false,
  disabled = false,
  className = ''
}: {
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`deck-key ${active ? 'selected' : ''} ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}
function Cover({ src, className = '' }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <div className={`volo-cover ${className}`}>
      {src && !failed ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      ) : (
        <Icon name="music_note" />
      )}
    </div>
  );
}

const PlaybackProgress = memo(function PlaybackProgress() {
  const player = useAudioPlayer();
  const duration = useStore(store, (s) => s.currentSongData.duration);
  const { updateSongPosition } = useContext(AppUpdateContext);
  const [position, setPosition] = useState(player.currentTime || 0);
  const dragging = useRef(false);
  useEffect(() => {
    const update = () => {
      if (!document.hidden && !dragging.current) setPosition(player.currentTime || 0);
    };
    for (const e of ['timeupdate', 'loadedmetadata', 'seeked', 'emptied'])
      player.audio.addEventListener(e, update);
    document.addEventListener('visibilitychange', update);
    return () => {
      for (const e of ['timeupdate', 'loadedmetadata', 'seeked', 'emptied'])
        player.audio.removeEventListener(e, update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [player]);
  return (
    <div className="deck-progress">
      <time>{time(position)}</time>
      <input
        aria-label="播放进度"
        type="range"
        min="0"
        max={duration || 1}
        step="0.1"
        value={Math.min(position, duration || 1)}
        disabled={!duration}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={() => {
          dragging.current = false;
          updateSongPosition(position);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setPosition(player.currentTime || 0);
        }}
        onChange={(e) => {
          const value = Number(e.target.value);
          setPosition(value);
          if (!dragging.current) updateSongPosition(value);
        }}
      />
      <time>{time(duration)}</time>
    </div>
  );
});

function StemPanel() {
  const { stemSeparation: stem } = useAudioPlayer();
  const state = useSyncExternalStore(stem.subscribe, stem.getSnapshot);
  return (
    <div className="deck-extra stem-panel">
      <div className="extra-heading">
        <div>
          <strong>音频分轨</strong>
          <p>分别调整人声与伴奏</p>
        </div>
        <button
          className={`plain-button ${state.enabled ? 'accent' : ''}`}
          onClick={() => void stem.setEnabled(!state.enabled)}
          disabled={state.loading}
          aria-pressed={state.enabled}
        >
          {state.loading ? '准备中…' : state.enabled ? '关闭分轨' : '开启分轨'}
        </button>
      </div>
      <div className="stem-sliders">
        {(['vocals', 'accompaniment'] as const).map((key) => (
          <label key={key}>
            <span>
              {key === 'vocals' ? '人声' : '伴奏'}
              <b>{state[key]}%</b>
            </span>
            <input
              type="range"
              min="0"
              max={key === 'vocals' ? 150 : 100}
              value={state[key]}
              disabled={!state.enabled || state.loading}
              onChange={(e) =>
                stem.setMix(
                  key === 'vocals' ? Number(e.target.value) : state.vocals,
                  key === 'accompaniment' ? Number(e.target.value) : state.accompaniment
                )
              }
            />
          </label>
        ))}
      </div>
      <p className="status-text" role="status">
        {state.error ||
          state.cacheError ||
          (state.enabled
            ? state.cached
              ? '已使用分轨缓存'
              : state.currentPreparing
                ? `正在准备当前歌曲 · ${state.currentProgress}%`
                : '实时分轨已开启'
            : '关闭时释放处理任务，正常播放原始音频')}
      </p>
    </div>
  );
}
function LyricsPanel() {
  const [lyrics, setLyrics] = useState<LyricsState>(LyricsStore.getState);
  useEffect(() => {
    LyricsStore.start();
    const unsubscribe = LyricsStore.subscribe(setLyrics);
    return () => {
      unsubscribe();
      LyricsStore.stop();
    };
  }, []);
  return (
    <div className="deck-extra lyrics-panel">
      <span className="eyebrow">歌词</span>
      <p>{lyrics.line?.text || (lyrics.lines.length ? '等待歌词开始' : '暂无歌词')}</p>
    </div>
  );
}
function QueueRow({ ids, index }: { ids: number[]; index: number }) {
  const controls = useContext(AppUpdateContext);
  const group = ids.slice(Math.floor(index / 40) * 40, (Math.floor(index / 40) + 1) * 40);
  const { data } = useQuery({
    queryKey: ['volo', 'queue-chunk', group],
    queryFn: async () => {
      const localIds = group.filter((id) => id > 0);
      const local = localIds.length
        ? await window.api.audioLibraryControls.getSongInfo(
            localIds,
            undefined,
            undefined,
            undefined,
            true
          )
        : [];
      const online = await Promise.all(
        group.filter((id) => id < 0).map((id) => window.api.ncm.getSong(id))
      );
      return [...(local || []), ...online.filter(Boolean)] as Song[];
    },
    staleTime: 60_000,
    gcTime: 60_000
  });
  const song = data?.find((item) => item.songId === ids[index]);
  return (
    <button
      className="queue-row"
      disabled={!song}
      onClick={() => song && void controls.playSong(song.songId, true)}
    >
      <span className="track-number">{index + 1}</span>
      <span>
        {song?.title || '正在读取歌曲…'}
        <small>{song && artist(song)}</small>
      </span>
      <Icon name="play_arrow" />
    </button>
  );
}
function QueuePanel() {
  const player = useAudioPlayer();
  useStore(store, (s) => s.localStorage.queue);
  const ids = player.queue.getAllSongIds();
  return (
    <div className="deck-extra queue-panel">
      <div className="extra-heading">
        <strong>播放队列</strong>
        <span>{ids.length} 首</span>
      </div>
      <div className="queue-list">
        <Virtuoso
          totalCount={ids.length}
          style={{ height: 180 }}
          itemContent={(index) => <QueueRow ids={ids} index={index} />}
        />
      </div>
      {!ids.length && <p>从列表选择一首音乐开始</p>}
    </div>
  );
}

const CassetteDeck = memo(function CassetteDeck() {
  const song = useStore(store, (s) => s.currentSongData);
  const playing = useStore(store, (s) => s.player.isCurrentSongPlaying);
  const volume = useStore(store, (s) => s.player.volume);
  const shuffle = useStore(store, (s) => s.player.isShuffling);
  const repeat = useStore(store, (s) => s.player.isRepeating);
  const c = useContext(AppUpdateContext);
  const [panel, setPanel] = useState<'stem' | 'lyrics' | 'queue' | null>(null);
  const togglePanel = (next: typeof panel) => setPanel((old) => (old === next ? null : next));
  useEffect(() => {
    const show = () => setPanel('queue');
    window.addEventListener('open-queue-popup', show);
    return () => window.removeEventListener('open-queue-popup', show);
  }, []);
  return (
    <section className="cassette-deck" aria-label="磁带机播放控制">
      <div className="deck-layout">
        <div className="deck-caption">
          <span className="eyebrow">VOLO / STEREO</span>
          <h1>
            让音乐
            <br />
            慢慢发生。
          </h1>
          <span className="deck-smallprint">选一首，听一会儿。</span>
        </div>
        <div className="cassette">
          <i className="cassette-screw top-left" />
          <i className="cassette-screw top-right" />
          <i className="cassette-screw bottom-left" />
          <i className="cassette-screw bottom-right" />
          <div className="cassette-label">
            <span className="side-mark">A</span>
            <Cover src={song.artworkPath} />
            <div className="cassette-track">
              <strong title={song.title}>{song.title || '此刻，想听什么？'}</strong>
              <span>{song.songId ? artist(song) : '你的下一首好音乐，正在这里等你'}</span>
            </div>
            <button
              className={`icon-button like-button ${song.isAFavorite ? 'is-liked' : ''}`}
              aria-label={song.isAFavorite ? '取消喜欢当前歌曲' : '喜欢当前歌曲'}
              disabled={!song.songId}
              onClick={() => c.toggleIsFavorite(!song.isAFavorite)}
            >
              <Icon name={song.isAFavorite ? 'favorite' : 'favorite_border'} />
            </button>
          </div>
          <div className="tape-window" aria-hidden="true">
            <div className="tape-reel">
              <i />
            </div>
            <div className="tape-bridge">
              <span>{playing ? 'PLAY' : 'PAUSE'}</span>
              <b>TYPE I / NORMAL</b>
            </div>
            <div className="tape-reel">
              <i />
            </div>
          </div>
          <PlaybackProgress />
          <div className="cassette-foot">
            <span>VOLO C-60</span>
            <span>HIGH FIDELITY · LOW DISTRACTION</span>
            <span>STEREO</span>
          </div>
        </div>
        <div className="deck-caption right">
          <span className="eyebrow">只留下好音乐</span>
          <div className={`status-light ${playing ? 'on' : ''}`} />
          <span>{playing ? '正在播放' : '准备就绪'}</span>
          <span className="deck-smallprint">NETEASE + LOCAL</span>
        </div>
      </div>
      <div className="deck-controls">
        <div className="transport">
          <Key label="上一首" icon="skip_previous" onClick={c.handleSkipBackwardClick} />
          <Key
            label={playing ? '暂停' : '播放'}
            icon={playing ? 'pause' : 'play_arrow'}
            className="play-key"
            onClick={() => c.toggleSongPlayback()}
            active={playing}
          />
          <Key
            label="下一首"
            icon="skip_next"
            onClick={() => c.handleSkipForwardClick('USER_SKIP')}
          />
        </div>
        <div className="mode-controls">
          <button
            className={`icon-button ${shuffle ? 'is-active' : ''}`}
            aria-label="随机播放"
            title="随机播放"
            aria-pressed={shuffle}
            onClick={() => c.toggleShuffling()}
          >
            <Icon name="shuffle" />
          </button>
          <button
            className={`icon-button ${repeat !== 'false' ? 'is-active' : ''}`}
            aria-label={`循环模式：${repeat === 'repeat-1' ? '单曲' : repeat === 'repeat' ? '列表' : '关闭'}`}
            title="切换循环模式"
            onClick={() => c.toggleRepeat()}
          >
            <Icon name={repeat === 'repeat-1' ? 'repeat_one' : 'repeat'} />
          </button>
        </div>
        <label className="deck-volume">
          <button
            className="icon-button"
            aria-label={volume.isMuted ? '取消静音' : '静音'}
            onClick={() => c.toggleMutedState()}
          >
            <Icon name={volume.isMuted ? 'volume_off' : 'volume_up'} />
          </button>
          <input
            aria-label="音量"
            type="range"
            min="0"
            max="100"
            value={volume.value}
            onChange={(e) => c.updateVolume(Number(e.target.value))}
          />
          <span>{volume.value}</span>
        </label>
        <div className="deck-tools">
          <Key
            label="歌词"
            icon="notes"
            onClick={() => togglePanel('lyrics')}
            active={panel === 'lyrics'}
          />
          <Key
            label="分轨"
            icon="tune"
            onClick={() => togglePanel('stem')}
            active={panel === 'stem'}
          />
          <Key
            label="队列"
            icon="queue_music"
            onClick={() => togglePanel('queue')}
            active={panel === 'queue'}
          />
        </div>
      </div>
      {panel === 'stem' && <StemPanel />}
      {panel === 'lyrics' && <LyricsPanel />}
      {panel === 'queue' && <QueuePanel />}
    </section>
  );
});

const SongRow = memo(function SongRow({
  song,
  index,
  onPlay
}: {
  song: Song;
  index: number;
  onPlay: (song: Song) => void;
}) {
  const current = useStore(store, (s) => s.currentSongData.songId === song.songId);
  const [favorite, setFavorite] = useState(FavoriteService.isFavorite(identity(song.songId)));
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const sync = () => setFavorite(FavoriteService.isFavorite(identity(song.songId)));
    sync();
    return FavoriteService.subscribe(sync);
  }, [song.songId]);
  const toggle = async () => {
    setPending(true);
    try {
      const result = await toggleSongIsFavorite(song.songId, favorite, !favorite);
      if (result === undefined) throw new Error('喜欢操作失败，请检查登录或网络');
    } catch (e) {
      window.dispatchEvent(new CustomEvent('volo-error', { detail: String(e) }));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className={`volo-song-row ${current ? 'current' : ''}`}>
      <span className="track-number">
        {current ? <Icon name="play_arrow" /> : String(index + 1).padStart(2, '0')}
      </span>
      <button className="song-hit" onClick={() => onPlay(song)} aria-label={`播放 ${song.title}`}>
        <Cover
          src={
            isNcm(song)
              ? proxyCoverUrl(song.coverUrl)
              : song.artworkPaths?.optimizedArtworkPath || song.artworkPaths?.artworkPath
          }
        />
        <span className="song-title">
          <strong title={song.title}>{song.title}</strong>
          <small>{artist(song)}</small>
        </span>
      </button>
      <span className="album-column" title={song.album?.name}>
        {song.album?.name || '—'}
      </span>
      <time>{time(isNcm(song) ? song.duration / 1000 : song.duration)}</time>
      <button
        className={`icon-button ${favorite ? 'is-liked' : ''}`}
        onClick={() => void toggle()}
        disabled={pending}
        aria-label={`${favorite ? '取消喜欢' : '喜欢'} ${song.title}`}
        aria-pressed={favorite}
      >
        <Icon name={favorite ? 'favorite' : 'favorite_border'} />
      </button>
    </div>
  );
});

function LocalRow({
  ids,
  index,
  onPlay
}: {
  ids: number[];
  index: number;
  onPlay: (song: Song) => void;
}) {
  const chunk = Math.floor(index / 40),
    group = ids.slice(chunk * 40, (chunk + 1) * 40);
  const { data } = useQuery({
    queryKey: ['volo', 'local-chunk', group],
    queryFn: () =>
      window.api.audioLibraryControls.getSongInfo(group, undefined, undefined, undefined, true),
    staleTime: 60_000,
    gcTime: 60_000
  });
  const song = data?.find((s) => s.songId === ids[index]);
  return song ? (
    <SongRow song={song} index={index} onPlay={onPlay} />
  ) : (
    <div className="volo-song-row skeleton-row">正在读取歌曲…</div>
  );
}

function Modal({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ManagementDialog open onClose={onClose} label={title} className="volo-modal">
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="关闭">
          <Icon name="close" />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </ManagementDialog>
  );
}
function Settings({ onClose, onAddFolder }: { onClose: () => void; onAddFolder: () => void }) {
  const player = useAudioPlayer();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [dark, setDark] = useState(document.documentElement.dataset.voloTheme === 'dark');
  const preferences = useStore(store, (s) => s.localStorage.preferences);
  const [folders, setFolders] = useState<MusicFolder[]>([]);
  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((list) => setDevices(list.filter((d) => d.kind === 'audiooutput')))
      .catch(() => {});
    window.api.folderData
      .getFolderData([])
      .then(setFolders)
      .catch(() => {});
  }, []);
  const setTheme = (value: boolean) => {
    setDark(value);
    localStorage.setItem('volo:theme', value ? 'dark' : 'light');
    document.documentElement.dataset.voloTheme = value ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', value);
  };
  return (
    <Modal title="设置" onClose={onClose}>
      <div className="setting-row">
        <div>
          <strong>深色机身</strong>
          <p>浅色与深色使用同一套布局</p>
        </div>
        <input
          aria-label="深色机身"
          type="checkbox"
          checked={dark}
          onChange={(e) => setTheme(e.target.checked)}
        />
      </div>
      <div className="setting-row">
        <strong>网易云音质</strong>
        <select
          aria-label="网易云音质"
          value={preferences.ncmPlaybackQuality || 'standard'}
          onChange={(e) =>
            storage.preferences.setPreferences(
              'ncmPlaybackQuality',
              e.target.value as typeof preferences.ncmPlaybackQuality
            )
          }
        >
          <option value="standard">标准</option>
          <option value="higher">较高</option>
          <option value="exhigh">极高</option>
          <option value="lossless">无损</option>
          <option value="hires">Hi-Res</option>
        </select>
      </div>
      <div className="setting-row">
        <strong>输出设备</strong>
        <select
          aria-label="输出设备"
          defaultValue={localStorage.getItem('volo:output-device') || ''}
          onChange={(e) => {
            void player.setOutputDevice(e.target.value).catch((err) => setError(String(err)));
          }}
        >
          <option value="">系统默认</option>
          {devices
            .filter((d) => d.deviceId !== 'default')
            .map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `音频设备 ${i + 1}`}
              </option>
            ))}
        </select>
      </div>
      <div className="setting-row">
        <div>
          <strong>本地音乐目录</strong>
          <p>添加后在后台建立索引</p>
        </div>
        <button className="plain-button" onClick={onAddFolder}>
          添加目录
        </button>
      </div>
      <ul className="folder-list">
        {folders.map((folder) => (
          <li key={folder.path}>
            <span title={folder.path}>{folder.path}</span>
            <button
              className="icon-button"
              aria-label={`移除目录 ${folder.path}`}
              onClick={() => {
                void window.api.folderData
                  .removeAMusicFolder(folder.path)
                  .then(() => {
                    setFolders((old) => old.filter((f) => f.path !== folder.path));
                    void queryClient.invalidateQueries({ queryKey: ['volo'] });
                  })
                  .catch((e) => setError(String(e)));
              }}
            >
              <Icon name="remove_circle_outline" />
            </button>
          </li>
        ))}
      </ul>
      <div className="setting-row">
        <div>
          <strong>分轨缓存</strong>
          <p>只处理当前歌曲，最多保留 512 MiB</p>
        </div>
        <button
          className="plain-button"
          onClick={() => {
            void player.stemSeparation
              .setEnabled(false)
              .then(() => window.api.stemSeparation.clearCache())
              .then(() => setError('缓存已清理'))
              .catch((e) => setError(String(e)));
          }}
        >
          清理缓存
        </button>
      </div>
      <p className="status-text" role="status">
        {error}
      </p>
      <div className="volo-version">
        Volo {version}
        <span>让音乐慢慢发生。</span>
      </div>
    </Modal>
  );
}

export default function VoloPlayer() {
  const user = useNcmUser(),
    controls = useContext(AppUpdateContext),
    queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('favorites'),
    [source, setSource] = useState<Source>('netease');
  const [keyword, setKeyword] = useState(''),
    [term, setTerm] = useState(''),
    [sort, setSort] = useState<SongSortTypes>('aToZ');
  const [loginOpen, setLoginOpen] = useState(false),
    [accountOpen, setAccountOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false);
  const [message, setMessage] = useState(''),
    [adding, setAdding] = useState(false),
    [favoriteEpoch, setFavoriteEpoch] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const closeLogin = useCallback(() => setLoginOpen(false), []);
  useEffect(() => {
    document.documentElement.dataset.voloTheme = localStorage.getItem('volo:theme') || 'light';
    document.documentElement.classList.toggle(
      'dark',
      document.documentElement.dataset.voloTheme === 'dark'
    );
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(keyword.trim()), 300);
    return () => clearTimeout(timer);
  }, [keyword]);
  useEffect(
    () =>
      FavoriteService.subscribe(() => {
        setFavoriteEpoch((n) => n + 1);
        void queryClient.invalidateQueries({ queryKey: ['volo', 'favorites', user.activeUserId] });
      }),
    [queryClient, user.activeUserId]
  );
  useEffect(() => {
    const search = () => searchRef.current?.focus();
    const error = (e: Event) => setMessage((e as CustomEvent<string>).detail);
    const login = () => setLoginOpen(true);
    window.addEventListener('open-home-search', search);
    window.addEventListener('volo-error', error);
    window.addEventListener('open-ncm-login', login);
    return () => {
      window.removeEventListener('open-home-search', search);
      window.removeEventListener('volo-error', error);
      window.removeEventListener('open-ncm-login', login);
    };
  }, []);
  const localMode = term
    ? source === 'local'
    : tab === 'local' || (tab === 'favorites' && source === 'local');
  const localIds = useQuery({
    queryKey: ['volo', 'local-ids', sort],
    queryFn: async () =>
      (await window.api.audioLibraryControls.getAllSongIds(sort)).data
        .filter((s) => !s.isBlacklisted)
        .map((s) => s.id),
    enabled: localMode && !term && tab === 'local',
    gcTime: 60_000
  });
  const localFavorites = useQuery({
    queryKey: ['volo', 'local-favorites', favoriteEpoch],
    queryFn: async () =>
      (await window.api.audioLibraryControls.getAllSongIds('aToZ', 'favorites')).data
        .filter((song) => !song.isBlacklisted)
        .map((song) => song.id),
    enabled: localMode && tab === 'favorites' && !term,
    gcTime: 60_000
  });
  const localSearch = useQuery({
    queryKey: ['volo', 'local-search', term],
    queryFn: () => window.api.search.songIds(term),
    enabled: localMode && !!term,
    gcTime: 60_000
  });
  const favorites = useQuery({
    queryKey: ['volo', 'favorites', user.activeUserId],
    queryFn: async () => {
      const list = await NcmRepository.getUserLikedSongs(user.profile!.userId);
      return list;
    },
    enabled: !localMode && !term && tab === 'favorites' && user.isLoggedIn,
    staleTime: 5 * 60_000,
    gcTime: 60_000
  });
  const recommended = useQuery({
    queryKey: ['volo', 'recommend', user.activeUserId],
    queryFn: () =>
      user.isLoggedIn ? NcmRepository.dailyRecommend() : NcmRepository.personalizedSongs(30),
    enabled: !term && tab === 'recommend',
    staleTime: 15 * 60_000,
    gcTime: 60_000
  });
  useEffect(() => {
    if (favorites.data && user.isLoggedIn) {
      FavoriteService.replaceSource(
        'netease',
        favorites.data.map((song) => identity(song.songId))
      );
    }
  }, [favorites.data, user.activeUserId, user.isLoggedIn]);
  const onlineSearch = useInfiniteQuery({
    queryKey: ['volo', 'search', term, user.activeUserId],
    queryFn: ({ pageParam }) => NcmRepository.searchSongs(term, 50, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, _pages, offset) =>
      last.songs.length && offset + last.songs.length < last.songCount
        ? offset + last.songs.length
        : undefined,
    enabled: !!term && !localMode,
    gcTime: 60_000
  });
  const ids =
    term && localMode
      ? localSearch.data || []
      : localMode && tab === 'favorites'
        ? localFavorites.data || []
        : localIds.data || [];
  const songs: Song[] = term
    ? localMode
      ? []
      : onlineSearch.data?.pages.flatMap((p) => p.songs) || []
    : localMode
      ? []
      : tab === 'recommend'
        ? recommended.data || []
        : favorites.data || [];
  const loading = term
    ? localMode
      ? localSearch.isFetching
      : onlineSearch.isFetching
    : localMode
      ? tab === 'local'
        ? localIds.isFetching
        : localFavorites.isFetching
      : tab === 'recommend'
        ? recommended.isFetching
        : user.isLoggedIn && favorites.isFetching;
  const queryError = term
    ? localMode
      ? localSearch.error
      : onlineSearch.error
    : localMode
      ? tab === 'local'
        ? localIds.error
        : localFavorites.error
      : tab === 'recommend'
        ? recommended.error
        : favorites.error;
  const localIndexed = localMode;
  const count = localIndexed ? ids.length : songs.length;
  const play = useCallback(
    (song: Song) => {
      if (isNcm(song))
        void PlaybackBridge.playSongs(
          songs.filter(isNcm),
          songs.findIndex((s) => s.songId === song.songId),
          'ncmPlaylist',
          tab
        ).catch((e) => setMessage(String(e)));
      else {
        const queueIds = localIndexed ? ids : songs.map((s) => s.songId);
        controls.createQueue(queueIds, 'songs', false);
        void controls.playSong(song.songId, true);
      }
    },
    [songs, ids, localIndexed, controls, tab]
  );
  const addFolder = async () => {
    setAdding(true);
    try {
      const structures = await window.api.folderData.getFolderStructures();
      if (!structures.length) return;
      await window.api.audioLibraryControls.addSongsFromFolderStructures(structures);
      await queryClient.invalidateQueries({ queryKey: ['volo'] });
      setTab('local');
      setKeyword('');
      setMessage('音乐目录已添加');
    } catch (e) {
      setMessage(String(e));
    } finally {
      setAdding(false);
    }
  };
  const title = term
    ? `搜索 “${term}”`
    : tab === 'favorites'
      ? '喜欢的音乐'
      : tab === 'recommend'
        ? user.isLoggedIn
          ? '今日，值得一听'
          : '发现下一首好音乐'
        : '本地音乐';
  const notifications = useStore(store, (s) => s.notificationPanelData.notifications);
  return (
    <div className="volo-shell">
      <header className="volo-titlebar">
        <span className="volo-wordmark">
          volo<span>随心听。</span>
        </span>
        <div className="titlebar-actions">
          <button
            className="plain-button account-trigger"
            onClick={() =>
              user.isLoggedIn || user.savedAccounts.length
                ? setAccountOpen(true)
                : setLoginOpen(true)
            }
          >
            <Icon name="account_circle" />
            {user.loading ? '连接中…' : user.profile?.nickname || '登录网易云'}
          </button>
          <button className="icon-button" aria-label="设置" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" />
          </button>
          <WindowControlsContainer />
        </div>
      </header>
      <main className="volo-workspace">
        <CassetteDeck />
        <section className="volo-library" aria-label="音乐库">
          <div className="library-toolbar">
            <nav className="source-tabs" aria-label="音乐库分类">
              {(
                [
                  ['favorites', 'favorite_border', '喜欢'],
                  ['recommend', 'auto_awesome', '推荐'],
                  ['local', 'folder_open', '本地']
                ] as const
              ).map(([key, icon, label]) => (
                <button
                  key={key}
                  className={tab === key ? 'active' : ''}
                  onClick={() => {
                    setTab(key);
                    if (key !== 'favorites') setSource(key === 'local' ? 'local' : 'netease');
                    setKeyword('');
                    setTerm('');
                  }}
                  aria-current={tab === key ? 'page' : undefined}
                >
                  <Icon name={icon} />
                  {label}
                </button>
              ))}
            </nav>
            <div className="library-search">
              <Icon name="search" />
              <input
                ref={searchRef}
                aria-label="搜索音乐"
                placeholder="搜索一首歌，或一位歌手"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              {keyword && (
                <button
                  className="icon-button"
                  aria-label="清除搜索"
                  onClick={() => {
                    setKeyword('');
                    setTerm('');
                  }}
                >
                  <Icon name="close" />
                </button>
              )}
            </div>
          </div>
          <div className="library-heading">
            <div>
              <h2>{title}</h2>
              <p>
                {loading ? '正在加载…' : `${count} 首音乐`}
                {tab === 'recommend' && !term ? ' · 为这一天留一点好声音' : ''}
              </p>
            </div>
            <div className="library-actions">
              {(!!keyword || tab === 'favorites') && (
                <select
                  aria-label="音乐来源"
                  value={source}
                  onChange={(e) => setSource(e.target.value as Source)}
                >
                  <option value="netease">网易云</option>
                  <option value="local">本地</option>
                </select>
              )}
              {tab === 'local' && !keyword && (
                <select
                  aria-label="排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SongSortTypes)}
                >
                  <option value="aToZ">名称 A–Z</option>
                  <option value="zToA">名称 Z–A</option>
                  <option value="addedOrder">最近添加</option>
                </select>
              )}
              {tab === 'local' && (
                <button className="plain-button" disabled={adding} onClick={() => void addFolder()}>
                  <Icon name="add" />
                  {adding ? '正在添加…' : '添加目录'}
                </button>
              )}
              <button
                className="icon-button"
                aria-label="刷新音乐"
                onClick={() => void queryClient.invalidateQueries({ queryKey: ['volo'] })}
              >
                <Icon name="refresh" />
              </button>
              <button
                className="plain-button accent"
                disabled={!count}
                onClick={async () => {
                  if (localIndexed) {
                    controls.createQueue(ids, 'songs', false, undefined, true);
                  } else if (songs[0]) play(songs[0]);
                }}
              >
                <Icon name="play_arrow" />
                播放全部
              </button>
            </div>
          </div>
          <div className="track-head">
            <span>#</span>
            <span>歌曲 / 歌手</span>
            <span className="album-column">专辑</span>
            <span>时长</span>
            <span />
          </div>
          <div className="library-list">
            {queryError ? (
              <div className="library-empty">
                <Icon name="wifi_off" />
                <h3>暂时无法加载</h3>
                <p>{String(queryError)}</p>
                <button
                  className="plain-button"
                  onClick={() => void queryClient.invalidateQueries({ queryKey: ['volo'] })}
                >
                  重试
                </button>
              </div>
            ) : count ? (
              <Virtuoso
                key={`${tab}-${source}-${term}-${sort}-${user.activeUserId}`}
                totalCount={count}
                fixedItemHeight={58}
                increaseViewportBy={116}
                itemContent={(index) =>
                  localIndexed ? (
                    <LocalRow ids={ids} index={index} onPlay={play} />
                  ) : (
                    <SongRow song={songs[index]} index={index} onPlay={play} />
                  )
                }
                endReached={() => {
                  if (
                    term &&
                    !localMode &&
                    onlineSearch.hasNextPage &&
                    !onlineSearch.isFetchingNextPage
                  )
                    void onlineSearch.fetchNextPage();
                }}
              />
            ) : (
              <div className="library-empty">
                <Icon
                  name={
                    loading ? 'hourglass_empty' : tab === 'local' ? 'library_music' : 'headphones'
                  }
                />
                <h3>
                  {loading
                    ? '正在找到你的音乐'
                    : !term && tab === 'favorites' && !localMode && !user.isLoggedIn
                      ? '把喜欢的音乐带过来'
                      : term
                        ? '没有找到这首音乐'
                        : '这里，留给你的好音乐'}
                </h3>
                <p>
                  {!term && tab === 'favorites' && !localMode && !user.isLoggedIn
                    ? '登录网易云，听你收藏的每一首。也可以直接播放本地音乐。'
                    : tab === 'local'
                      ? '添加音乐目录，开始你的私人音乐库。'
                      : '试试另一首歌，或换一个来源。'}
                </p>
                {!loading && !term && tab === 'favorites' && !localMode && !user.isLoggedIn && (
                  <button className="plain-button accent" onClick={() => setLoginOpen(true)}>
                    登录网易云
                  </button>
                )}
                {!loading && tab === 'local' && (
                  <button
                    className="plain-button accent"
                    onClick={() => void addFolder()}
                    disabled={adding}
                  >
                    添加音乐目录
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
      <footer className="volo-footer">
        <span>
          <i /> VOLO · MUSIC FIRST
        </span>
        <span>喜欢的歌，值得认真听。</span>
        <span>{count ? `${count} TRACKS` : 'PRESS PLAY'}</span>
      </footer>
      {(!!message || !!notifications?.length) && (
        <div className="volo-toast" role="status">
          <span>{message || notifications.at(-1)?.content}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => {
              setMessage('');
              controls.updateNotifications(() => []);
            }}
          >
            <Icon name="close" />
          </button>
        </div>
      )}
      {loginOpen && (
        <Suspense fallback={null}>
          <LoginDialog open onClose={closeLogin} />
        </Suspense>
      )}
      {settingsOpen && (
        <Settings onClose={() => setSettingsOpen(false)} onAddFolder={() => void addFolder()} />
      )}
      {accountOpen && (
        <Modal title="网易云账号" onClose={() => setAccountOpen(false)}>
          <p>{user.isLoggedIn ? `当前账号：${user.profile?.nickname}` : '请选择账号或重新登录'}</p>
          <div className="account-list">
            {user.savedAccounts.map((account) => (
              <button
                key={account.userId}
                className="plain-button"
                onClick={() => {
                  void user
                    .switchAccount(account.userId)
                    .then(() => setAccountOpen(false))
                    .catch((e) => setMessage(String(e)));
                }}
              >
                {account.nickname}
                {account.userId === user.activeUserId ? ' · 当前' : ''}
              </button>
            ))}
          </div>
          <div className="account-actions">
            <button
              className="plain-button"
              onClick={() => {
                setAccountOpen(false);
                setLoginOpen(true);
              }}
            >
              添加账号
            </button>
            {user.isLoggedIn && (
              <button
                className="plain-button"
                onClick={() => {
                  void user
                    .logout()
                    .then(() => {
                      queryClient.removeQueries({ queryKey: ['volo', 'favorites'] });
                      setAccountOpen(false);
                    })
                    .catch((e) => setMessage(String(e)));
                }}
              >
                退出登录
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
