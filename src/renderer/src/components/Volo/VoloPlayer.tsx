import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@tanstack/react-store';
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { Virtuoso, type VirtuosoHandle, type StateSnapshot } from 'react-virtuoso';

import { version } from '../../../../../package.json';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { useNcmUser } from '../../contexts/NcmUserContext';
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
import { PaperRecent, rememberTrack } from './PaperRecent';
import { NowPlayingBar } from './NowPlayingBar';
import { Icon, Key } from './PlaybackControls';

const TapePlayerPage = lazy(() => import('./TapePlayerPage'));

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
          <strong>深色模式</strong>
          <p>浅色与深色使用同一套布局</p>
        </div>
        <input
          aria-label="深色模式"
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
        Doto {version}
        <span>让音乐慢慢发生。</span>
      </div>
    </Modal>
  );
}

export default function VoloPlayer() {
  const user = useNcmUser(),
    controls = useContext(AppUpdateContext),
    queryClient = useQueryClient();
  const [view, setView] = useState<'library' | 'player'>(() =>
    localStorage.getItem('volo:view') === 'player' ? 'player' : 'library'
  );
  const [home, setHome] = useState(true);
  const libraryActive = view === 'library';
  const currentTrack = useStore(store, (s) => s.currentSongData);
  const [recentVersion, setRecentVersion] = useState(0);
  useEffect(() => { if (currentTrack.songId) { rememberTrack(currentTrack); setRecentVersion(n => n + 1); } }, [currentTrack.songId]);
  const libraryRef = useRef<VirtuosoHandle>(null);
  const librarySnapshot = useRef<{ key: string; state: StateSnapshot } | null>(null);
  const showPlayer = () => {
    libraryRef.current?.getState((state) => {
      librarySnapshot.current = { key: listKey, state };
    });
    setView('player');
  };
  useEffect(() => {
    localStorage.setItem('volo:view', view);
  }, [view]);
  const [tab, setTab] = useState<Tab>('local'),
    [source, setSource] = useState<Source>('local');
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
  const openSearch = useCallback(() => {
    setView('library');
    requestAnimationFrame(() => searchRef.current?.focus());
  }, []);

  useEffect(() => {
    const error = (e: Event) => setMessage((e as CustomEvent<string>).detail);
    const login = () => setLoginOpen(true);
    window.addEventListener('open-home-search', openSearch);
    window.addEventListener('volo-error', error);
    window.addEventListener('open-ncm-login', login);
    return () => {
      window.removeEventListener('open-home-search', openSearch);
      window.removeEventListener('volo-error', error);
      window.removeEventListener('open-ncm-login', login);
    };
  }, [openSearch]);
  const localMode = term
    ? source === 'local'
    : tab === 'local' || (tab === 'favorites' && source === 'local');
  const localIds = useQuery({
    queryKey: ['volo', 'local-ids', sort],
    queryFn: async () =>
      (await window.api.audioLibraryControls.getAllSongIds(sort)).data
        .filter((s) => !s.isBlacklisted)
        .map((s) => s.id),
    enabled: libraryActive && localMode && !term && tab === 'local',
    gcTime: 60_000
  });
  const localFavorites = useQuery({
    queryKey: ['volo', 'local-favorites', favoriteEpoch],
    queryFn: async () =>
      (await window.api.audioLibraryControls.getAllSongIds('aToZ', 'favorites')).data
        .filter((song) => !song.isBlacklisted)
        .map((song) => song.id),
    enabled: libraryActive && localMode && tab === 'favorites' && !term,
    gcTime: 60_000
  });
  const localSearch = useQuery({
    queryKey: ['volo', 'local-search', term],
    queryFn: () => window.api.search.songIds(term),
    enabled: libraryActive && localMode && !!term,
    gcTime: 60_000
  });
  const favorites = useQuery({
    queryKey: ['volo', 'favorites', user.activeUserId],
    queryFn: async () => {
      const list = await NcmRepository.getUserLikedSongs(user.profile!.userId);
      return list;
    },
    enabled: libraryActive && !localMode && !term && tab === 'favorites' && user.isLoggedIn,
    staleTime: 5 * 60_000,
    gcTime: 60_000
  });
  const recommended = useQuery({
    queryKey: ['volo', 'recommend', user.activeUserId],
    queryFn: () =>
      user.isLoggedIn ? NcmRepository.dailyRecommend() : NcmRepository.personalizedSongs(30),
    enabled: libraryActive && !term && tab === 'recommend',
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
    enabled: libraryActive && !!term && !localMode,
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
  const listKey = `${tab}-${source}-${term}-${sort}-${user.activeUserId}-${count}`;
  const notifications = useStore(store, (s) => s.notificationPanelData.notifications);
  const visibleNotifications = useMemo(
    () => notifications?.filter((n) => n.id !== 'LYRICS_FIND_FAILED'),
    [notifications]
  );
  return (
    <div className={`volo-shell ${view === 'player' ? 'tape-shell' : 'library-shell'}`}>
      <header className="volo-titlebar">
        <span className="volo-wordmark">volo.</span>
        <nav className="titlebar-page-keys" aria-label="主导航">
          <button className={libraryActive ? 'active' : ''} onClick={() => setView('library')}>
            <Icon name="library_music" />
            音乐库
          </button>
          <button className={!libraryActive ? 'active' : ''} onClick={showPlayer}>
            <Icon name="headphones" />
            正在播放
          </button>
        </nav>
        <div className="titlebar-actions">
          <Key label="设置" icon="settings" onClick={() => setSettingsOpen(true)} />
          <button
            className="deck-key account-trigger"
            aria-label={user.profile?.nickname || '登录网易云'}
            title={user.profile?.nickname || '登录网易云'}
            onClick={() =>
              user.isLoggedIn || user.savedAccounts.length
                ? setAccountOpen(true)
                : setLoginOpen(true)
            }
          >
            <Icon name="account_circle" />
          </button>
          <WindowControlsContainer />
        </div>
      </header>
      <aside className="paper-sidebar" aria-label="音乐库导航">
        <button className="paper-logo" onClick={() => { setHome(true); setTab('local'); setView('library'); setKeyword(''); setTerm(''); }}>volo.</button>
        <p className="paper-tagline">一处安静听音乐的地方</p>
        <nav><button className={libraryActive && home && tab === 'local' ? 'active' : ''} onClick={() => { setView('library'); setHome(true); setTab('local'); setKeyword(''); setTerm(''); }}>最近在听</button>{([['local', '全部歌曲'], ['favorites', '喜欢的音乐'], ['recommend', '每日推荐']] as const).map(([key,label]) => <button key={key} className={libraryActive && tab === key && !(home && key === 'local') ? 'active' : ''} onClick={() => { setView('library'); setHome(false); setTab(key); setSource(key === 'local' ? 'local' : 'netease'); setKeyword(''); setTerm(''); }}>{label}<span>{key === tab && libraryActive ? String(count).padStart(2,'0') : ''}</span></button>)}<button onClick={showPlayer}>正在播放<Icon name="arrow_outward" /></button></nav>
        <div className="paper-side-bottom"><p>世界很大，<br/>先听完这首歌。</p><button type="button" onClick={openSearch}><Icon name="search" />搜索</button><small>MADE FOR THE MOMENT</small></div>
      </aside>
      {view === 'player' ? (
        <Suspense
          fallback={
            <div className="tape-page-loading" role="status">
              正在打开播放页…
            </div>
          }
        >
          <TapePlayerPage onClose={() => { setView('library'); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.now-playing-track')?.focus({preventScroll:true})); }} />
        </Suspense>
      ) : (
        <main className="volo-workspace"><div className="paper-topline"><span>YOUR PERSONAL SOUNDTRACK</span><span>慢一点，也没关系。　✳</span></div>
          {home && tab === 'local' && !term && <PaperRecent version={recentVersion} onPlay={(id) => { void controls.playSong(id, true); }} /> }
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
                <h2>{tab === "local" && !term ? "全部歌曲" : title}</h2>
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
                  <button
                    className="plain-button"
                    disabled={adding}
                    onClick={() => void addFolder()}
                  >
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
                  key={listKey}
                  ref={libraryRef}
                  restoreStateFrom={
                    librarySnapshot.current?.key === listKey
                      ? librarySnapshot.current.state
                      : undefined
                  }
                  totalCount={count}
                  fixedItemHeight={76}
                  increaseViewportBy={152}
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
          <NowPlayingBar onOpen={showPlayer} />
        </main>
      )}
      {(!!message || !!visibleNotifications?.length) && (
        <div className="volo-toast" role="status">
          <span>{message || visibleNotifications.at(-1)?.content}</span>
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
