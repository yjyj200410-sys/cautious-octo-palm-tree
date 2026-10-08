import {
  NCM_SONG_QUALITIES,
  normalizeNcmSongQuality,
  type NcmSongQuality
} from '@common/ncmQuality';
import { cookieManager } from '@renderer/api/ncm-client';
import DefaultSongCover from '@renderer/assets/images/webp/song_cover_default.webp';
import CDCanvas from '@renderer/components/CDLibrary/CDCanvas';
import FloatingPanel from '@renderer/components/FloatingChrome/FloatingPanel';
import Img from '@renderer/components/Img';
import ManagementDialog from '@renderer/components/ManagementDialog';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import { useNcmUser } from '@renderer/contexts/NcmUserContext';
import useLibraryView from '@renderer/hooks/useLibraryView';
import { useQueueOperations } from '@renderer/hooks/useQueueOperations';
import { getAllLocalSongs } from '@renderer/localMusic/localLibrary';
import { proxyCoverUrl } from '@renderer/ncm';
import { NcmHomeRepository } from '@renderer/ncm/home/NcmHomeRepository';
import { NeteaseSyncService } from '@renderer/ncm/NeteaseSyncService';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import { NcmRepository } from '@renderer/ncm/repository';
import type { NcmPlaylist, NcmSong } from '@renderer/ncm/types';
import toggleSongIsFavorite from '@renderer/other/toggleSongIsFavorite';
import { store } from '@renderer/store/store';
import calculateTime from '@renderer/utils/calculateTime';
import { matchesLibrarySearch } from '@renderer/utils/librarySearch';
import storage from '@renderer/utils/localStorage';
import { motionDuration } from '@renderer/utils/motionPreference';
import { NCM_QUALITY_LABEL_KEYS } from '@renderer/utils/ncmQualityLabels';
import { FavoriteService } from '@renderer/utils/unifiedStorage';
import { useStore } from '@tanstack/react-store';
import { lazy, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtuoso } from 'react-virtuoso';

import VipBadge from '../VipBadge';
import FavoriteFilters, { emptyFavoriteFilter, type FavoriteFilter } from './FavoriteFilters';
import LibrarySearch from './LibrarySearch';

const AddSongsToPlaylistsPrompt = lazy(
  () => import('@renderer/components/SongsPage/AddSongsToPlaylistsPrompt')
);
const NcmSelectPlaylistsPrompt = lazy(
  () => import('@renderer/components/NcmSelectPlaylistsPrompt')
);

function ncmToSongData(song: NcmSong): SongData {
  // 本地曲目(正 songId)不走 NCM 代理/收藏:artworkPaths 直接用本地路径
  if (song.songId > 0) {
    return {
      songId: song.songId,
      title: song.title,
      isVip: song.isVip,
      duration: Math.round(song.duration / 1000),
      artists: song.artists,
      album: song.album ?? { name: '', albumId: 0 },
      path: song.path,
      artworkPaths: song.artworkPaths,
      isAFavorite: FavoriteService.isFavorite({ source: 'local', sourceId: String(song.songId) }),
      isBlacklisted: song.isBlacklisted,
      isArtworkAvailable: !song.artworkPaths.isDefaultArtwork,
      addedDate: 0
    };
  }
  return {
    songId: song.songId,
    title: song.title,
    isVip: song.isVip,
    duration: Math.round(song.duration / 1000),
    artists: song.artists,
    album: song.album ?? { name: '', albumId: 0 },
    path: '',
    artworkPaths: {
      isDefaultArtwork: !song.coverUrl,
      artworkPath: proxyCoverUrl(song.coverUrl),
      optimizedArtworkPath: proxyCoverUrl(song.coverUrl)
    },
    isAFavorite: FavoriteService.isFavorite({ source: 'netease', sourceId: String(song.ncmId) }),
    isBlacklisted: false,
    isArtworkAvailable: !!song.coverUrl,
    addedDate: 0
  };
}

/** 阶段 3.8 歌曲列表切换动画时长:退场 220ms / 进场 300ms(样式见 styles.css songListExit/songListEnter 类) */
const SONG_EXIT_MS = 60;
const ENTER_HOLD_MS = 160;
// Each existing row is 53px tall with a 3px spacer. Explicit sizing avoids
// probing an empty/hidden row while asynchronous playlist data is committed.
const LIBRARY_ROW_HEIGHT = 56;
const libraryListComponents = {
  Footer: () => <div aria-hidden="true" className="h-5" />
};

/**
 * 阶段 4.8:歌曲列表缓存(会话内存)——再打开同一歌单不重新请求。模块级 Map, key = `userId:${kind}-${id}`(按用户隔离,防切换账号串数据),只缓存成功结果
 * (失败不缓存,下次可重试);上限防止浏览海量歌单时内存无界增长(FIFO 淘汰最早插入)。
 */
type SongListCacheEntry = { detail: NcmPlaylist | null; songs: NcmSong[]; error: string };
const MAX_SONG_LIST_CACHE = 20;
const songListCache = new Map<string, SongListCacheEntry>();

/** 歌单歌曲请求(缓存/数据 effect 共用同一请求路径;不触碰播放/队列)。 抛错携带展示文案;失败由调用方决定是否写缓存。 */
async function fetchLibrarySongs(
  kind: 'favorites' | 'daily' | 'playlist' | 'ncm' | 'local',
  id: number | undefined,
  profile: { userId?: number } | null,
  isLoggedIn: boolean
): Promise<{ detail: NcmPlaylist | null; songs: NcmSong[] }> {
  if (kind === 'local') {
    return { detail: null, songs: await getAllLocalSongs() };
  }
  if (kind === 'favorites') {
    if (!isLoggedIn || !profile?.userId) throw new Error('请先登录网易云');
    // 先找「我喜欢的音乐」歌单 ID,再走标准 playlistDetail 流程
    const playlists = await NcmRepository.getUserPlaylists(profile.userId);
    const liked = playlists.find(
      (pl) => pl.name === '我喜欢的音乐' || pl.name.includes('喜欢的音乐')
    );
    if (!liked) throw new Error('未找到收藏歌单');
    const absId = liked.playlistId > 0 ? liked.playlistId : -liked.playlistId;
    const d = await NcmRepository.playlistDetail(absId);
    if (!d) throw new Error('加载失败');
    return { detail: d, songs: d.tracks };
  }
  if (kind === 'daily') {
    return { detail: null, songs: await NcmHomeRepository.getDailySongs() };
  }
  if (kind === 'ncm') {
    if (!id) throw new Error('缺少歌单 ID');
    const d = await NcmRepository.playlistDetail(id);
    if (!d) throw new Error('加载失败');
    return { detail: d, songs: d.tracks };
  }
  // kind === 'playlist'(本地歌单):阶段 3「我的歌单」区块接入时实现
  throw new Error('本地歌单暂未接入');
}

/** 写入歌曲列表缓存(成功结果;FIFO 淘汰最早条目,防内存无界增长) */
function cacheSongs(cacheKey: string, detail: NcmPlaylist | null, songs: NcmSong[], error: string) {
  if (songListCache.size >= MAX_SONG_LIST_CACHE) {
    const oldest = songListCache.keys().next().value;
    if (oldest !== undefined) songListCache.delete(oldest);
  }
  songListCache.set(cacheKey, { detail, songs, error });
}

type Props = {
  kind: 'favorites' | 'daily' | 'playlist' | 'ncm' | 'local';
  id?: number;
  /** 兼容调用方的歌单快照；列表头部不再显示名称与封面。 */
  title?: string;
  cover?: string;
};

/**
 * Role="button" 元素的无障碍键盘触发:Enter/空格激活回调(与 Notification 的 close 按钮同款 a11y
 * 约定——仅键盘可达的点击元素须配键盘监听)。stopPropagation 隔离内层按钮,不触发行点击。
 */
const activateOnKeyDown = (onActivate: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    onActivate();
  }
};

/**
 * 单首歌行:视觉与 QueuePopup 的 QueueCard 完全一致 (44px 封面 + 歌名 + 「歌手 · 时长」)。阶段 4.1:当前播放状态移至封面(当前曲封面常驻
 * 深色遮罩——播放时跳动 equalizer / 暂停时 play_arrow),行尾改为固定宽度 hover 操作区 (下一首播放 / 加入队列 /
 * 收藏,鼠标进入显示、离开隐藏,不改变行布局)。 阶段 4.3:批量选择模式——行/封面点击切换选中,封面左上角 checkbox 动画浮现 (绝对定位,不改变行高度/布局),不影响 hover
 * 按钮与当前播放高亮。
 */
const LibraryRow = memo(
  ({
    song,
    isCurrent,
    isPlaying,
    selectionMode,
    isSelected,
    onClick,
    onCoverClick,
    onAction,
    onToggleSelect,
    onContextMenu
  }: {
    song: SongData;
    isCurrent: boolean;
    isPlaying: boolean;
    selectionMode: boolean;
    isSelected: boolean;
    onClick: (songId: number) => void;
    onCoverClick: (song: SongData) => void;
    onAction: (action: 'next' | 'queue' | 'favorite', song: SongData) => void;
    onToggleSelect: (songId: number) => void;
    onContextMenu: (e: React.MouseEvent, song: SongData) => void;
  }) => (
    <button
      type="button"
      className={`library-song-row group relative flex h-[53px] w-full shrink-0 cursor-pointer items-center rounded-md px-3 py-1 text-left transition-colors hover:bg-black/4 dark:hover:bg-white/5 ${
        selectionMode && isSelected ? 'bg-black/5 dark:bg-white/7' : ''
      }`}
      style={{ gap: 14 } as React.CSSProperties}
      onClick={() => (selectionMode ? onToggleSelect(song.songId) : onClick(song.songId))}
      onContextMenu={(e) => onContextMenu(e, song)}
    >
      {isCurrent && (
        <div className="bg-font-color-highlight dark:bg-dark-font-color-highlight absolute top-1/2 left-0 h-4/5 w-[4px] -translate-y-1/2 rounded-r-full" />
      )}
      {/* 封面:当前播放状态显示于此——播放时深色遮罩 + 跳动 equalizer(复用全局 eq-bar keyframes),
        暂停时深色遮罩 + play_arrow。点击封面:当前曲 toggle 播放/暂停,其他曲播放该曲(onCoverClick)。 */}
      <div
        className="relative shrink-0 cursor-pointer"
        role="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          if (selectionMode) onToggleSelect(song.songId);
          else onCoverClick(song);
        }}
        onKeyDown={activateOnKeyDown(() => {
          if (selectionMode) onToggleSelect(song.songId);
          else onCoverClick(song);
        })}
      >
        <Img
          key={`${song.songId}:${song.artworkPaths?.artworkPath ?? ''}`}
          src={song.artworkPaths?.artworkPath}
          fallbackSrc={DefaultSongCover}
          className="aspect-square w-11 rounded-md object-cover"
          alt=""
          loading="lazy"
        />
        {/* 选中歌曲仅显示无边框对勾；行底色仍标识选中状态。 */}
        {selectionMode && isSelected && (
          <span
            className="text-font-color-highlight dark:text-dark-font-color-highlight absolute -top-1.5 -left-1.5 z-10 flex h-5 w-5 items-center justify-center drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
            style={{ animation: 'selectionCheckIn 150ms ease-out both' }}
          >
            <span className="material-icons-round text-xl leading-none">check</span>
          </span>
        )}
        {isCurrent && (
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50">
            {isPlaying ? (
              <span
                className="eq-bars flex items-end"
                style={{ gap: 1, height: 14 } as React.CSSProperties}
              >
                <span
                  className="eq-bar w-[3px] rounded-full bg-white"
                  style={{ animation: 'eq-bar-1 600ms ease-in-out infinite alternate' }}
                />
                <span
                  className="eq-bar w-[3px] rounded-full bg-white"
                  style={{ animation: 'eq-bar-2 500ms ease-in-out infinite alternate' }}
                />
                <span
                  className="eq-bar w-[3px] rounded-full bg-white"
                  style={{ animation: 'eq-bar-3 700ms ease-in-out infinite alternate' }}
                />
                <span
                  className="eq-bar w-[3px] rounded-full bg-white"
                  style={{ animation: 'eq-bar-4 450ms ease-in-out infinite alternate' }}
                />
              </span>
            ) : (
              <span className="material-icons-round text-2xl text-white">play_arrow</span>
            )}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-base leading-tight font-medium ${
            isCurrent
              ? 'text-font-color-highlight dark:text-dark-font-color-highlight'
              : 'text-font-color-black/88 dark:text-font-color-white/90'
          }`}
        >
          {song.title} <VipBadge isVip={song.isVip} />
        </div>
        <div className="text-font-color-black/65 dark:text-font-color-white/72 truncate text-[13px] leading-tight">
          {song.artists?.map((a) => a.name).join(', ') || '未知歌手'}
          <span className="mx-1 opacity-30">·</span>
          {calculateTime(song.duration).minutes}:{calculateTime(song.duration).seconds}
        </div>
      </div>
      {/* hover 操作区:固定 w-[80px] 常驻占位(不随 hover 增删)→ 不改变行布局、不造成列表跳动;
        opacity 由 group-hover 控制(进入显示/离开隐藏)。三个按钮复用现有能力——下一首播放/
        加入队列走 useQueueOperations,收藏走 handleToggleFavorite;点击 stopPropagation
        不触发行点击。当前播放状态已移至封面,行尾不再显示 eq/music_note。 */}
      <div className="flex w-[80px] shrink-0 items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <span
          role="button"
          tabIndex={0}
          title="下一首播放"
          className="text-font-color-black/50 hover:text-font-color-black dark:text-font-color-white/50 dark:hover:text-font-color-white flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-black/6 dark:hover:bg-white/10"
          onClick={(e) => {
            e.stopPropagation();
            onAction('next', song);
          }}
          onKeyDown={activateOnKeyDown(() => onAction('next', song))}
        >
          <span className="material-icons-round text-base leading-none">shortcut</span>
        </span>
        <span
          role="button"
          tabIndex={0}
          title="加入队列"
          aria-label="加入队列"
          className="text-font-color-black/50 hover:text-font-color-black dark:text-font-color-white/50 dark:hover:text-font-color-white flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-black/6 dark:hover:bg-white/10"
          onClick={(e) => {
            e.stopPropagation();
            onAction('queue', song);
          }}
          onKeyDown={activateOnKeyDown(() => onAction('queue', song))}
        >
          <span className="material-icons-round text-base leading-none">queue</span>
        </span>
        <span
          role="button"
          tabIndex={0}
          title={song.isAFavorite ? '取消收藏' : '收藏'}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-black/6 dark:hover:bg-white/10"
          onClick={(e) => {
            e.stopPropagation();
            onAction('favorite', song);
          }}
          onKeyDown={activateOnKeyDown(() => onAction('favorite', song))}
        >
          <span
            className={`${
              song.isAFavorite
                ? 'material-icons-round text-font-color-highlight dark:text-dark-font-color-highlight'
                : 'material-icons-round-outlined text-font-color-black/50 dark:text-font-color-white/50'
            } text-base leading-none`}
          >
            favorite
          </span>
        </span>
      </div>
    </button>
  )
);
LibraryRow.displayName = 'LibraryRow';

/** LibraryPanel 内容:紧凑操作栏(播放/选择 + 搜索/排序) + QueuePopup 同款紧凑歌曲行。数据加载与播放桥接(PlaybackBridge)与旧版一致。 */
export default function LibraryContent({ kind, id }: Props) {
  const { profile, isLoggedIn } = useNcmUser();
  const { t } = useTranslation();

  const currentSongData = useStore(store, (state) => state.currentSongData);
  const isCurrentSongPlaying = useStore(store, (state) => state.player.isCurrentSongPlaying);

  const {
    updateContextMenuData,
    changePromptMenuData,
    addNewNotifications,
    toggleMultipleSelections,
    toggleIsFavorite,
    toggleSongPlayback,
    createQueue,
    updateQueueData
  } = useContext(AppUpdateContext);
  const { addToNext, addToEnd } = useQueueOperations();

  const [detail, setDetail] = useState<NcmPlaylist | null>(null);
  const [songs, setSongs] = useState<NcmSong[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryAttempt, setRetryAttempt] = useState(0);
  // 阶段 4.2:歌单内搜索关键字 + 排序方式(纯显示层状态,不影响 songs 原始数据/播放/Queue)
  const {
    view,
    scroller,
    setQuery: setSearchQuery
  } = useLibraryView(`${profile?.userId ?? 0}:${kind}-${id}`);
  const searchQuery = view.query;
  const [favoriteFilter, setFavoriteFilter] = useState<FavoriteFilter>(emptyFavoriteFilter);
  const [batchBusy, setBatchBusy] = useState(false);
  const batchBusyRef = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingDownload, setPendingDownload] = useState<{
    songs: NcmSong[];
    originView: typeof view;
  } | null>(null);
  const [downloadQuality, setDownloadQuality] = useState<NcmSongQuality>(() =>
    normalizeNcmSongQuality(storage.preferences.getPreferences('ncmDownloadQuality'))
  );
  const [batchMessage, setBatchMessage] = useState('');
  useEffect(() => {
    setFavoriteFilter(emptyFavoriteFilter);
    setConfirmDelete(false);
    setPendingDownload(null);
    setBatchMessage('');
  }, [kind, id, profile?.userId]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const restoreScrollRef = useRef(0);
  // 阶段 4.3:本地批量选择模式。selectedSongIds 用 Set<string>(key = String(songId)),不用数组;
  // 兼容搜索/排序——选择跟随 songId,displaySongs 变化后选中态保留。
  const [selectionMode, setSelectionMode] = useState(false);
  const [surface, setSurface] = useState<'cd' | 'list'>(() => {
    try {
      return window.localStorage.getItem('volo-library-surface') === 'list' ? 'list' : 'cd';
    } catch {
      return 'cd';
    }
  });
  const [selectedSongIds, setSelectedSongIds] = useState<Set<string>>(() => new Set());

  // 阶段 3.8 优化 切换动画状态机:idle 常态 / exit 旧列表立即退场 / loading 加载占位 /
  // enter 新列表进场。点击切换立即退场(不依赖数据更新),数据就绪后再进场。
  // 切换不重挂 LibraryPanel/LibraryContent,只给歌曲列表区域加过渡生命周期。
  const key = `${kind}-${id}`;
  const [transition, setTransition] = useState<'idle' | 'exit' | 'loading' | 'enter'>('idle');
  /** 歌曲列表滚动容器:切换进场时复位到顶部,避免新歌单从旧滚动位置展示 */
  /** 歌曲列表视口高度 → 底部留白 = 视口 1/3(末曲可滚动至「下三分之一」处,不贴底) */
  const keyRef = useRef(key);
  keyRef.current = key;
  /** 已展示内容的 key 与歌曲/详情/错误备份:commit 切换时旧内容保留供退场,可据此恢复 */
  const displayedKeyRef = useRef<string | null>(null);
  const displayedSongsRef = useRef<NcmSong[]>([]);
  const displayedDetailRef = useRef<NcmPlaylist | null>(null);
  const displayedErrorRef = useRef('');
  /** Transition 状态镜像:回调/effect 读最新值 */
  const transitionRef = useRef(transition);
  transitionRef.current = transition;
  /** 上次触发切换的 key(初始即首 key,避免首挂载误触发退场) */
  const prevKeyRef = useRef(key);
  const exitTimerRef = useRef(0);
  const enterTimerRef = useRef(0);
  /** 当前正朝其过渡的目标 key(commit 设置;提交后置空)。它就是「过渡请求的 id」—— 歌曲数据只有 key 与之一致(最新目标)才被接纳,过期目标的结果被丢弃 */
  const pendingKeyRef = useRef<string | null>(null);
  /** 暂存数据所属 key 与内容(歌曲请求完成时写入;与 pendingKeyRef 一致才有资格进场) */
  const stagedKeyRef = useRef<string | null>(null);
  const stagedSongsRef = useRef<NcmSong[]>([]);
  const stagedDetailRef = useRef<NcmPlaylist | null>(null);
  const stagedErrorRef = useRef('');

  // 阶段 3.8:暂存数据 → 展示的唯一写入点(退场期间旧内容保留给退场动画,进场时一次性替换,
  // 避免新旧列表重叠)。animated=true 走 enter 动画;false 为初始加载/恢复,静默提交。
  const commitStaged = useCallback((animated: boolean) => {
    setSongs(stagedSongsRef.current);
    setDetail(stagedDetailRef.current);
    setError(stagedErrorRef.current);
    displayedSongsRef.current = stagedSongsRef.current;
    displayedDetailRef.current = stagedDetailRef.current;
    displayedErrorRef.current = stagedErrorRef.current;
    const committedKey = pendingKeyRef.current ?? keyRef.current;
    displayedKeyRef.current = committedKey;
    pendingKeyRef.current = null; // 过渡完成,目标已展示
    stagedKeyRef.current = null;
    const savedScroll = viewRef.current.scrollTop;
    cancelAnimationFrame(restoreScrollRef.current);
    restoreScrollRef.current = requestAnimationFrame(() => {
      restoreScrollRef.current = requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop = savedScroll;
      });
    });
    if (animated) {
      setTransition('enter');
      window.clearTimeout(enterTimerRef.current);
      enterTimerRef.current = window.setTimeout(
        () => setTransition('idle'),
        motionDuration(ENTER_HOLD_MS)
      );
    } else {
      setTransition('idle');
    }
  }, []);

  // 阶段 3.8 进场唯一入口(统一 enter 触发):同时满足「commit 已到(active key === pending key)」
  // 与「数据已到(staged key === pending key)」才 setSongs + setTransition('enter')。
  // commit 到达(key-change effect)与歌曲数据到达(stageSongs)都会调用它——任何数据到达都重新
  // 尝试进场,loading 不会成为死状态。pendingKeyRef 即过渡请求 id:暂存数据仅当其 key 与最新
  // pending key 一致才被接纳(过期目标的结果被拒,不再有旧歌曲被提交)。
  const tryCommitEnter = useCallback((): boolean => {
    const pending = pendingKeyRef.current;
    if (pending === null) {
      // 缓存数据 effect 可能先于 key-change effect 暂存数据。此时必须等待切换目标登记，
      // 否则会提前触发 enter，紧接着又被 key-change effect 重置，导致缓存切换看不到动画。
      if (prevKeyRef.current !== keyRef.current) return false;

      // 无过渡请求:暂存数据属于已提交 key 且尚未展示 → 提交(commit 快速连续到达时的兜底,
      // 保证 committed key 的数据一定能进场)。从未展示过内容(初始加载)则静默提交。
      if (stagedKeyRef.current === keyRef.current && displayedKeyRef.current !== keyRef.current) {
        commitStaged(displayedKeyRef.current !== null);
        return true;
      }
      return false;
    }
    if (keyRef.current !== pending) return false; // commit 未到该目标
    if (stagedKeyRef.current !== pending) return false; // 数据未到该目标
    // 退场动画未结束:由 exit timer 结束时再次调用,避免进场打断退场
    if (transitionRef.current === 'exit' && exitTimerRef.current !== 0) return false;
    commitStaged(true);
    return true;
  }, [commitStaged]);

  // 歌曲数据到达的统一入口:暂存 + 立即尝试进场
  const stageSongs = useCallback(
    (sKey: string, list: NcmSong[], detail: NcmPlaylist | null, err: string) => {
      stagedKeyRef.current = sKey;
      stagedSongsRef.current = list;
      stagedDetailRef.current = detail;
      stagedErrorRef.current = err;
      tryCommitEnter();
    },
    [tryCommitEnter]
  );

  // 退场 + 结束后尝试进场;未就绪则清空进 loading 占位,数据/commit 到达后由 tryCommitEnter 接手
  const startExit = useCallback(() => {
    window.clearTimeout(enterTimerRef.current); // 打断在途 enter 动画,防其定时器把本退场掐断
    window.clearTimeout(exitTimerRef.current);
    setTransition('exit');
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = 0;
      if (pendingKeyRef.current === null) return;
      if (!tryCommitEnter()) {
        setSongs([]);
        setDetail(null);
        setError('');
        setTransition('loading');
      }
    }, motionDuration(SONG_EXIT_MS));
  }, [tryCommitEnter]);

  // 数据获取:结果先暂存 staged refs,由 tryCommitEnter 决定何时进场;commit 仍是最终数据源。
  useEffect(() => {
    let cancelled = false;
    // 阶段 4.8:缓存命中 → 直接暂存就绪数据,不发起网络请求(消除重复加载/滚动抢请求卡顿);
    // 数据照走下方 exit/enter 提交流程,只是瞬时完成。按 userId 隔离,切换账号不会串数据。
    const cacheKey = `${isLoggedIn ? (profile?.userId ?? 0) : 0}:${key}`;
    // local 不缓存:本地库内容随时可变(添加/删除文件夹、收藏),缓存必过期;且 DB 直查无网络,
    // 无缓存价值。其余 kind(favorites/daily/ncm)走缓存减少网络请求。
    const cached = kind === 'local' || retryAttempt > 0 ? undefined : songListCache.get(cacheKey);
    if (cached) {
      stageSongs(key, cached.songs, cached.detail, cached.error);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError('');

    // 阶段 6:防抖发起网络请求——快速滚动经过多个歌单时,只有落定的歌单才真正请求,
    // 中间歌单的定时器被 cleanup 清除,避免产生大量无效请求。标题/封面由 setLibraryPanel
    // 快照实时跟随,不经此请求,不受防抖影响。缓存命中路径已在上面 return,仍即时展示。
    const timer = window.setTimeout(
      async () => {
        try {
          const { detail: d, songs: list } = await fetchLibrarySongs(kind, id, profile, isLoggedIn);
          if (cancelled) return;
          // 阶段 4.8:成功后写入缓存(FIFO 淘汰最早条目,防内存无界增长);失败不写缓存,下次仍可重试
          // local 不写缓存(读取已跳过,本地内容随时可变)
          if (kind !== 'local') cacheSongs(cacheKey, d, list, '');
          stageSongs(key, list, d, '');
          setLoading(false);
        } catch (e) {
          if (cancelled) return;
          stageSongs(key, [], null, e instanceof Error ? e.message : '加载失败');
          setLoading(false);
        }
      },
      kind === 'local' ? 0 : 80
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, id, key, isLoggedIn, profile?.userId, stageSongs, retryAttempt]);

  // 底部胶囊等处的收藏切换(走 toggleIsFavorite → store)也要同步到当前列表:仅当同一首当前曲的
  // 收藏态翻转时才处理(换曲不处理)。「我喜欢的音乐」里即时移除该曲,其他列表重算 isAFavorite。
  const lastCurFavRef = useRef<{ songId: number | undefined; fav: boolean } | null>(null);
  useEffect(() => {
    const curSongId = currentSongData?.songId;
    if (curSongId === undefined || curSongId === null) return;
    const curFav = !!currentSongData?.isAFavorite;
    const prev = lastCurFavRef.current;
    lastCurFavRef.current = { songId: curSongId, fav: curFav };
    if (!prev || prev.songId !== curSongId) return; // 换曲,非收藏切换
    if (prev.fav === curFav) return; // 收藏态未变
    setSongs((prevSongs) => {
      if (kind === 'favorites' && !curFav) {
        const next = prevSongs.filter((s) => s.songId !== curSongId);
        const cacheKey = `${isLoggedIn ? (profile?.userId ?? 0) : 0}:${kind}-${id}`;
        const entry = songListCache.get(cacheKey);
        if (entry) {
          entry.songs = next;
          if (entry.detail) entry.detail.tracks = next;
        }
        return next;
      }
      return [...prevSongs]; // 重算 isAFavorite(渲染时读 FavoriteService)
    });
  }, [
    currentSongData?.songId,
    currentSongData?.isAFavorite,
    kind,
    id,
    isLoggedIn,
    profile?.userId
  ]);

  // 阶段 3.8:commit(key props 变化)→ 唯一数据源。已展示内容先退场,数据就绪后由
  // tryCommitEnter 统一进场;连续切换取消上一轮动画,直接对最新 key 退场当前内容。
  // 阶段 5:滚动实时跟随由 PlaylistRail 直接 commit(中心卡变化即 setLibraryPanel),
  // 这里照常处理 key 变化的退场/进场——快速滚动连续 commit,由 pendingKeyRef 丢弃过期
  // 结果、startExit 打断在途动画,最终稳定在 settle 后的卡。
  useEffect(() => {
    if (prevKeyRef.current === key) return;
    prevKeyRef.current = key;
    // ① commit 已在过渡目标上 → 不重开动画,尝试进场
    if (pendingKeyRef.current === key) {
      tryCommitEnter();
      return;
    }
    // ② commit 回到已展示内容(快速滚动滚回上一卡)→ 恢复,不重播动画
    if (displayedKeyRef.current === key) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = 0;
      window.clearTimeout(enterTimerRef.current);
      if (transitionRef.current === 'loading') {
        setSongs(displayedSongsRef.current);
        setDetail(displayedDetailRef.current);
        setError(displayedErrorRef.current);
      }
      pendingKeyRef.current = null;
      setTransition('idle');
      return;
    }
    // ③ 全新 commit 目标:成为新的过渡请求(commit 不允许提交旧歌曲——pending key 一更新,
    //    旧目标的数据因 staged key 不匹配而失去进场资格)
    pendingKeyRef.current = key;
    // ④ 从未展示过内容(首挂载未加载完就切换)→ 直接 loading 等数据
    if (displayedKeyRef.current === null) {
      setTransition('loading');
      return;
    }
    // ⑤ 已在退场/加载中(快速滚动,前一个目标未落定)→ 只改目标,不重开动画
    if (transitionRef.current === 'exit' || transitionRef.current === 'loading') {
      tryCommitEnter();
      return;
    }
    // ⑥ 常态(内容完整展示中)→ 退场新内容
    startExit();
  }, [key, tryCommitEnter, startExit]);

  // 卸载时清理切换动画定时器(面板关闭/整页卸载)
  useEffect(
    () => () => {
      window.clearTimeout(exitTimerRef.current);
      window.clearTimeout(enterTimerRef.current);
      cancelAnimationFrame(restoreScrollRef.current);
    },
    []
  );

  // 阶段 4.3:切换歌单时退出选择模式并清空选择(避免残留选中项跨歌单串用)
  useEffect(() => {
    setSelectionMode(false);
    setSelectedSongIds(new Set());
  }, [key]);

  // Keep the real native scroller for account-scoped scroll persistence/restoration.
  const handleListRef = useCallback(
    (node: HTMLElement | Window | null) => {
      scroller.current = node instanceof HTMLElement ? node : null;
    },
    [scroller]
  );

  // Search and filters preserve playlist order; hidden selections remain selected by ID.
  const displaySongs = useMemo(
    () =>
      songs.filter((song) => {
        if (!matchesLibrarySearch(song, searchQuery)) return false;
        if (kind !== 'favorites') return true;
        if (
          favoriteFilter.artist &&
          !song.artists.some((artist) => artist.name === favoriteFilter.artist)
        )
          return false;
        if (favoriteFilter.album && song.album?.name !== favoriteFilter.album) return false;
        return (
          !favoriteFilter.days ||
          Boolean(song.addedAt && song.addedAt >= Date.now() - favoriteFilter.days * 86400000)
        );
      }),
    [songs, searchQuery, favoriteFilter, kind]
  );

  const songDataList: SongData[] = useMemo(() => displaySongs.map(ncmToSongData), [displaySongs]);

  // R2: 全量歌曲 songId → NcmSong 映射（不受搜索/排序影响，隐藏的已选曲也能反查）
  const songMap = useMemo(() => {
    const map = new Map<number, NcmSong>();
    for (const s of songs) map.set(s.songId, s);
    return map;
  }, [songs]);
  // R2: 批量集合 = 选择顺序（selectedSongIds Set 插入序）× 全量 songs 反查。
  //     搜索/排序隐藏的已选曲仍保留；顺序 = 点选顺序（A→C→B 保持 A→C→B）。
  //     不再 displaySongs.filter —— 那会丢搜索/排序下被隐藏的选中曲、并按显示序而非点选序。
  const selectedSongs = useMemo(
    () =>
      [...selectedSongIds]
        .map((k) => songMap.get(Number(k)))
        .filter((s): s is NcmSong => s !== undefined),
    [selectedSongIds, songMap]
  );

  const sourceType = kind === 'daily' ? 'ncmDaily' : 'ncmPlaylist';
  const sourceId =
    kind === 'daily'
      ? 'daily'
      : kind === 'favorites'
        ? 'favorites'
        : kind === 'local'
          ? 'local'
          : String(id ?? detail?.playlistId ?? '');

  const handlePlayClick = useCallback(
    (_songId: number) => {
      const idx = songs.findIndex((s) => s.songId === _songId);
      if (idx < 0) return;
      if (kind === 'local') {
        // 本地曲目走现有本地 Queue(不触碰 NCM PlaybackBridge)
        updateQueueData(
          idx,
          songs.map((s) => s.songId),
          false,
          true
        );
        return;
      }
      // ★ O(1):只建逻辑队列 + 经 PrefetchManager 解析当前曲 URL
      PlaybackBridge.playSongs(songs, idx, sourceType, sourceId);
    },
    [songs, sourceType, sourceId, kind, updateQueueData]
  );

  const playAll = useCallback(() => {
    if (songs.length === 0) return;
    if (kind === 'local') {
      createQueue(
        songs.map((s) => s.songId),
        'songs',
        false,
        'local',
        true
      );
      return;
    }
    PlaybackBridge.playSongs(songs, 0, sourceType, sourceId);
  }, [songs, sourceType, sourceId, kind, createQueue]);

  // 阶段 4.1:收藏切换(自 buildContextMenuItems 的内联实现抽离,右键菜单与行 hover 按钮共用)。
  // NCM 曲目乐观更新 + NCM 同步(失败回滚);本地曲目走 FavoriteService + toggleLikeSongs。
  // 收藏态即时反映到列表:从「我喜欢的音乐」取消收藏时直接把该曲移出列表,其他列表只换数组
  // 引用让 songDataList 重算 isAFavorite(渲染时读 FavoriteService);同时清掉会话歌曲列表缓存。
  const handleToggleFavorite = useCallback(
    (song: SongData) => {
      const { songId, isAFavorite } = song;
      if (songId < 0) {
        const newFavorite = !isAFavorite;
        toggleSongIsFavorite(songId, isAFavorite, newFavorite)
          .then((res) => {
            if (res === undefined) return; // NCM 同步失败已回滚,列表不变
            setSongs((prev) => {
              if (kind === 'favorites' && !newFavorite) {
                const next = prev.filter((s) => s.songId !== songId);
                // 会话歌曲列表缓存原地剔除该歌(不删除)→ 切回收藏列表即时且不重新加载;
                // 其余列表内容不受收藏态影响,缓存不动。
                const cacheKey = `${isLoggedIn ? (profile?.userId ?? 0) : 0}:${kind}-${id}`;
                const entry = songListCache.get(cacheKey);
                if (entry) {
                  entry.songs = next;
                  if (entry.detail) entry.detail.tracks = next;
                }
                return next;
              }
              return [...prev]; // 仅触发 isAFavorite 重算(渲染时读 FavoriteService)
            });
            // 同步底部胶囊红心:当前曲收藏态写入 store(onlyChangeCurrentSongData 跳过重复 NCM 调用)
            if (currentSongData.songId === songId)
              toggleIsFavorite(!currentSongData.isAFavorite, true);
          })
          .catch(() => {});
      } else {
        const identity = { source: 'local' as const, sourceId: String(songId) };
        if (isAFavorite) FavoriteService.removeFavorite(identity);
        else FavoriteService.addFavorite(identity);
        window.api.playerControls
          .toggleLikeSongs([songId])
          .then((res) => {
            if (res && res.likes.length + res.dislikes.length > 0) {
              if (currentSongData.songId === songId) toggleIsFavorite(!currentSongData.isAFavorite);
            }
          })
          .catch((err) => console.error(err));
      }
    },
    [
      kind,
      id,
      isLoggedIn,
      profile?.userId,
      currentSongData.songId,
      currentSongData.isAFavorite,
      toggleIsFavorite
    ]
  );

  /**
   * 每首歌的右键菜单(结构与 QueuePopup 一致,去掉「移出队列」;播放走 PlaybackBridge)。 阶段 4.3.1:签名改为 { songs
   * }——选择模式下,右键的曲目在选中集合且可见选中数>1 时, songs 为全部可见选中曲(NcmSong[],display 顺序);否则为单曲。isBatch =
   * songs.length > 1: - 批量:头部显示「已选择 N 首歌曲」,隐藏「歌曲信息/选择」;播放/队列/歌单整体生效 (PlaybackBridge.playSongs 数组 /
   * addToNext、addToEnd 数组 / Prompt songIds 数组), 收藏循环复用现有 handleToggleFavorite(仅未收藏曲,防误取消)。不修改
   * Player/Queue 底层。 - 单曲:保持原有行为不变。
   */
  const buildContextMenuItems = useCallback(
    ({ songs }: { songs: NcmSong[] }) => {
      const isBatch = songs.length > 1;
      const song = songs[0];
      const songTitle = song.title;
      const songIds = songs.map((s) => s.songId);
      // 「添加到网易云歌单」仅对网易云曲目(负 id):单曲按原曲判定,批量需全部为 NCM 曲
      const isNcmSong = song.songId < 0;
      const allNcm = songs.every((s) => s.songId < 0);
      const isAFavorite = ncmToSongData(song).isAFavorite;

      const items: ContextMenuItem[] = [
        {
          label: t('common.play'),
          iconName: 'play_arrow',
          handlerFunction: () => {
            if (isBatch) {
              if (kind === 'local') {
                // 批量:本地曲目整组播放走现有本地 Queue
                createQueue(songIds, 'songs', false, 'local', true);
              } else {
                // 批量:整组播放(PlaybackBridge 数组,按当前显示顺序自第一首;不改 Queue),
                // 与批量操作栏的「播放选中」一致——播放后退出选择模式
                PlaybackBridge.playSongs(songs, 0, sourceType, sourceId);
              }
              setSelectionMode(false);
              setSelectedSongIds(new Set());
            } else {
              handlePlayClick(song.songId);
            }
            toggleMultipleSelections(false);
          }
        },
        {
          label: t('common.playNext'),
          iconName: 'shortcut',
          handlerFunction: async () => {
            // R1: 批量先注册再入队 —— 未注册 NCM 曲目会被 getSongInfo/自动切歌静默丢弃;
            //    本地曲目无需注册(正 songId 直接入队)
            if (kind !== 'local') {
              await PlaybackBridge.registerSongsToQueue(songs);
            }
            addToNext(songIds, { removeDuplicates: true });
            addNewNotifications([
              isBatch
                ? {
                    id: 'LibraryBatchPlayNext',
                    content: t('notifications.playingNextSongsWithCount', {
                      count: songIds.length
                    }),
                    iconName: 'shortcut'
                  }
                : {
                    id: `${songTitle}PlayNext`,
                    content: t('notifications.playingNext', { title: songTitle }),
                    iconName: 'shortcut'
                  }
            ]);
            toggleMultipleSelections(false);
          }
        },
        {
          label: 'Hr',
          isContextMenuItemSeperator: true,
          handlerFunction: () => true
        },
        {
          label: isBatch
            ? t('song.likeSong')
            : t(`song.${isAFavorite ? 'unlikeSong' : 'likeSong'}`),
          iconName: 'favorite',
          iconClassName:
            !isBatch && isAFavorite
              ? 'material-icons-round mr-4 text-xl'
              : 'material-icons-round-outlined mr-4 text-xl',
          handlerFunction: () => {
            // 批量:仅对未收藏曲目逐首收藏(循环复用现有 toggle 逻辑,不修改底层);
            // 当前曲经其内部同步 store 红心。单曲:原行为不变。
            if (isBatch) {
              songs
                .map(ncmToSongData)
                .filter((s) => !s.isAFavorite)
                .forEach((s) => handleToggleFavorite(s));
            } else {
              handleToggleFavorite(ncmToSongData(song));
            }
            toggleMultipleSelections(false);
          }
        },
        ...(kind === 'local'
          ? [
              {
                label: t('song.addToPlaylists'),
                iconName: 'playlist_add',
                handlerFunction: () => {
                  changePromptMenuData(
                    true,
                    <AddSongsToPlaylistsPrompt
                      songIds={songIds}
                      title={isBatch ? undefined : songTitle}
                    />
                  );
                  toggleMultipleSelections(false);
                }
              }
            ]
          : []),
        ...((isBatch ? allNcm : isNcmSong)
          ? [
              {
                label: '添加到歌单',
                iconName: 'playlist_add',
                handlerFunction: () => {
                  changePromptMenuData(
                    true,
                    <NcmSelectPlaylistsPrompt
                      songIds={songIds.map((id) => -id)}
                      title={songTitle}
                      currentPlaylistId={
                        kind === 'ncm' || kind === 'favorites' ? detail?.playlistId : undefined
                      }
                    />
                  );
                  toggleMultipleSelections(false);
                }
              }
            ]
          : [])
        // 选择模式仍由列表工具栏管理，右键菜单只保留歌曲操作。
      ];
      return items;
    },
    [
      t,
      handlePlayClick,
      addToNext,
      createQueue,
      addNewNotifications,
      toggleMultipleSelections,
      changePromptMenuData,
      handleToggleFavorite,
      sourceType,
      sourceId,
      kind,
      detail?.playlistId
    ]
  );

  // P0-1 性能:行点击/右键处理器经 ref 读取最新实现,自身保持稳定身份([] useCallback)。
  // LibraryRow 已 memo 化(浅比较),切歌/播放暂停/动画状态变化时只有 isCurrent/isPlaying
  // 变化的行重渲染,其余行直接复用(此前每行 onClick/onContextMenu 都是新闭包,memo 无法命中)。
  const kindRef = useRef(kind);
  kindRef.current = kind;
  const handlePlayClickRef = useRef(handlePlayClick);
  handlePlayClickRef.current = handlePlayClick;
  const buildContextMenuItemsRef = useRef(buildContextMenuItems);
  buildContextMenuItemsRef.current = buildContextMenuItems;
  const updateContextMenuDataRef = useRef(updateContextMenuData);
  updateContextMenuDataRef.current = updateContextMenuData;
  // 阶段 4.1:封面/操作区处理器经 ref 读取最新实现,自身保持稳定身份(与 handleRowPlay 同款
  // 模式)→ LibraryRow 的 memo 浅比较可命中,切歌/播放暂停/收藏只重渲染受影响行。
  const toggleSongPlaybackRef = useRef(toggleSongPlayback);
  toggleSongPlaybackRef.current = toggleSongPlayback;
  const currentSongDataRef = useRef(currentSongData);
  currentSongDataRef.current = currentSongData;
  const handleToggleFavoriteRef = useRef(handleToggleFavorite);
  handleToggleFavoriteRef.current = handleToggleFavorite;
  const addToNextRef = useRef(addToNext);
  addToNextRef.current = addToNext;
  const addToEndRef = useRef(addToEnd);
  addToEndRef.current = addToEnd;
  const addNewNotificationsRef = useRef(addNewNotifications);
  addNewNotificationsRef.current = addNewNotifications;
  const tRef = useRef(t);
  tRef.current = t;
  // R2: 单行 hover 注册需反查 NcmSong（[] 回调里读最新 songMap）
  const songMapRef = useRef(songMap);
  songMapRef.current = songMap;

  const handleRowPlay = useCallback((songId: number) => {
    handlePlayClickRef.current(songId);
  }, []);

  // 阶段 4.3.1 + R2:选择模式下,右键的曲目在选中集合且选中数>1 → 菜单对全量选中曲生效
  // (selectedSongs = 选择顺序 × 全量 songs 反查——搜索/排序隐藏的已选曲仍保留,
  //  顺序 = 点选顺序,不再 displaySongs ∩ selected);否则保持单曲菜单。
  // selectedSongs/selectionMode/selectedSongIds 变化(搜索/排序/勾选)时随 renderRow 重渲染,
  // 右键时始终取最新选中集。
  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, song: SongData) => {
      e.preventDefault();
      e.stopPropagation();
      const targetNcm = songMap.get(song.songId);
      if (!targetNcm) return;
      const isBatch =
        selectionMode && selectedSongIds.has(String(song.songId)) && selectedSongs.length > 1;
      const items = buildContextMenuItemsRef.current({
        songs: isBatch ? selectedSongs : [targetNcm]
      });
      updateContextMenuDataRef.current(true, items, e.pageX, e.pageY);
    },
    [songMap, selectedSongs, selectedSongIds, selectionMode]
  );

  // 阶段 4.1:点击封面——当前曲 toggle 播放/暂停(不换曲);其他曲播放该曲(PlaybackBridge,不改 Queue)。
  const handleCoverClick = useCallback((song: SongData) => {
    if (currentSongDataRef.current?.songId === song.songId) toggleSongPlaybackRef.current();
    else handlePlayClickRef.current(song.songId);
  }, []);

  // 阶段 4.1:行 hover 操作——下一首播放/加入队列复用 useQueueOperations(现有能力,不新增
  // 队列系统);收藏走 handleToggleFavorite。全部经 ref 读取最新实现,自身保持稳定([])。
  // R1: 单曲同样先注册再入队(未注册 NCM 曲目会偶发丢歌)。
  const handleRowAction = useCallback(
    async (action: 'next' | 'queue' | 'favorite', song: SongData) => {
      const { songId, title: songTitle } = song;
      const isLocal = kindRef.current === 'local';
      if (action === 'next') {
        const ncm = songMapRef.current.get(songId);
        if (ncm && !isLocal) await PlaybackBridge.registerSongsToQueue([ncm]);
        addToNextRef.current([songId], { removeDuplicates: true });
        addNewNotificationsRef.current([
          {
            id: `${songTitle}PlayNext`,
            content: tRef.current('notifications.playingNext', { title: songTitle }),
            iconName: 'shortcut'
          }
        ]);
      } else if (action === 'queue') {
        const ncm = songMapRef.current.get(songId);
        if (ncm && !isLocal) await PlaybackBridge.registerSongsToQueue([ncm]);
        addToEndRef.current([songId], { removeDuplicates: false });
        addNewNotificationsRef.current([
          {
            id: `${songTitle}AddedToQueue`,
            content: tRef.current('notifications.addedToQueue', { count: 1 }),
            iconName: 'add'
          }
        ]);
      } else {
        handleToggleFavoriteRef.current(song);
      }
    },
    []
  );

  // 阶段 4.3:单选/取消选择(基于 songId,Set 更新;displaySongs 变化后选中态保留)
  const toggleSelectSong = useCallback((songId: number) => {
    const k = String(songId);
    setSelectedSongIds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  // 阶段 4.3:全选 / 取消全选当前 displaySongs(兼容搜索/排序——作用于当前可见集合)
  const toggleSelectAll = useCallback(() => {
    setSelectedSongIds((prev) => {
      const next = new Set(prev);
      const allSelected = displaySongs.every((s) => next.has(String(s.songId)));
      displaySongs.forEach((s) => {
        const k = String(s.songId);
        if (allSelected) next.delete(k);
        else next.add(k);
      });
      return next;
    });
  }, [displaySongs]);

  // 阶段 4.3:清除选择并退出选择模式
  const clearSelection = useCallback(() => {
    setSelectedSongIds(new Set());
    setSelectionMode(false);
  }, []);

  const canDelete =
    isLoggedIn &&
    Boolean(profile?.userId) &&
    (kind === 'favorites' || (kind === 'ncm' && detail?.creatorId === profile?.userId));
  const canDownload =
    selectedSongs.length > 0 && selectedSongs.every((song) => song.songId < 0 && song.ncmId > 0);

  const runBatch = async (action: 'next' | 'playlist' | 'download' | 'delete') => {
    if (!selectedSongs.length || batchBusyRef.current || loading || transition !== 'idle') return;
    if (action === 'delete' && !canDelete) return;
    if (action === 'download' && !canDownload) return;
    const snapshot = [...selectedSongs];
    const originView = view;
    if (action === 'download') {
      setDownloadQuality(
        normalizeNcmSongQuality(storage.preferences.getPreferences('ncmDownloadQuality'))
      );
      setPendingDownload({ songs: snapshot, originView });
      return;
    }
    const originUid = profile?.userId;
    const originKind = kind;
    const playlistId = Math.abs(detail?.playlistId ?? id ?? 0);
    const stillHere = () => viewRef.current === originView;
    const report = (message: string) => {
      if (stillHere()) setBatchMessage(message);
    };
    if (action === 'playlist') {
      const localIds = snapshot.filter((song) => song.songId > 0).map((song) => song.songId);
      if (localIds.length === snapshot.length)
        changePromptMenuData(true, <AddSongsToPlaylistsPrompt songIds={localIds} />);
      else if (!localIds.length)
        changePromptMenuData(
          true,
          <NcmSelectPlaylistsPrompt
            songIds={snapshot.map((song) => song.ncmId)}
            currentPlaylistId={
              originKind === 'ncm' || originKind === 'favorites' ? playlistId : undefined
            }
          />
        );
      else report('请分别选择本地歌曲和网易云歌曲收藏到歌单');
      return;
    }
    batchBusyRef.current = true;
    setBatchBusy(true);
    setBatchMessage('');
    try {
      if (action === 'next') {
        const online = snapshot.filter((song) => song.songId < 0);
        if (online.length) await PlaybackBridge.registerSongsToQueue(online);
        addToNext(
          snapshot.map((song) => song.songId),
          { removeDuplicates: true }
        );
        report('已添加到下一首播放');
      } else {
        const removed = new Set<number>();
        let failure = '';
        if (originKind === 'favorites') {
          for (const song of snapshot) {
            // Stop if the account or collection changes; completed items remain committed.
            if (!stillHere()) break;
            const result = await toggleSongIsFavorite(song.songId, true, false);
            if (result === false) {
              removed.add(song.songId);
              if (stillHere() && currentSongDataRef.current?.songId === song.songId)
                toggleIsFavorite(false, true);
            } else failure = '部分歌曲移除失败，请重试';
          }
        } else {
          await NeteaseSyncService.removeSongsFromPlaylist(
            playlistId,
            snapshot.map((song) => song.ncmId)
          );
          snapshot.forEach((song) => removed.add(song.songId));
        }
        for (const cacheKey of songListCache.keys()) {
          if (cacheKey.startsWith(String(originUid) + ':')) songListCache.delete(cacheKey);
        }
        if (stillHere()) {
          setSongs((previous) => {
            const next = previous.filter((song) => !removed.has(song.songId));
            displayedSongsRef.current = next;
            return next;
          });
          setSelectedSongIds(
            (previous) => new Set([...previous].filter((songId) => !removed.has(Number(songId))))
          );
          report(
            failure ||
              '已从' +
                (originKind === 'favorites' ? '我喜欢的音乐' : '歌单') +
                '移除 ' +
                removed.size +
                ' 首歌曲'
          );
          if (!failure) clearSelection();
        }
      }
    } catch (error) {
      report(error instanceof Error ? error.message : '操作失败，请重试');
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
      setConfirmDelete(false);
    }
  };

  const confirmDownload = async () => {
    const pending = pendingDownload;
    if (!pending || batchBusyRef.current) return;
    const quality = normalizeNcmSongQuality(downloadQuality);
    storage.preferences.setPreferences('ncmDownloadQuality', quality);
    setPendingDownload(null);
    batchBusyRef.current = true;
    setBatchBusy(true);
    setBatchMessage('');
    try {
      const result = await window.api.ncm.downloadSongs(
        pending.songs.map((song) => ({ id: song.ncmId, title: song.title })),
        cookieManager.get(),
        quality
      );
      if (!result.canceled && viewRef.current === pending.originView) {
        setBatchMessage(
          '已下载 ' +
            result.saved +
            ' 首' +
            (result.failures.length
              ? '，未下载 ' +
                result.failures.length +
                ' 首。' +
                result.failures.slice(0, 3).join('；')
              : '')
        );
      }
    } catch (error) {
      if (viewRef.current === pending.originView) {
        setBatchMessage(error instanceof Error ? error.message : '下载失败，请重试');
      }
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  };

  /** 阶段 4.3:当前 displaySongs 是否全部被选中(用于「全选」↔「取消全选」文案切换) */
  const areAllDisplayedSelected =
    displaySongs.length > 0 && displaySongs.every((s) => selectedSongIds.has(String(s.songId)));

  /** 是否展示虚拟歌曲列表:退场阶段展示旧列表(不依赖 loading,退场动画期间 loading 可为真); 其余仅在数据就绪且非空时展示(loading/error/空态由下方分支接管)。 */
  const showSongList =
    transition === 'exit' || (!loading && !error && songs.length > 0 && displaySongs.length > 0);

  // 单行渲染:进场阶段前 10 行带 20ms 递增交错入场(opacity+translateY);退场阶段由容器统一退场。
  // 作为 Virtuoso itemContent:key 由 Virtuoso 管理(不在此设);行间隔线固定 3px 占位
  // (首行透明占位保持 fixedItemHeight=63 一致)。
  const renderRow = useCallback(
    (song: SongData, index: number) => {
      const isCurrent = currentSongData?.songId === song.songId;
      const isPlaying = isCurrent && isCurrentSongPlaying;
      return (
        <div>
          {index > 0 ? <div className="mx-[5px] h-[3px]" /> : <div className="h-[3px]" />}
          <LibraryRow
            song={song}
            isCurrent={isCurrent}
            isPlaying={isPlaying}
            selectionMode={selectionMode}
            isSelected={selectedSongIds.has(String(song.songId))}
            onClick={handleRowPlay}
            onCoverClick={handleCoverClick}
            onAction={handleRowAction}
            onToggleSelect={toggleSelectSong}
            onContextMenu={handleRowContextMenu}
          />
        </div>
      );
    },
    [
      currentSongData,
      isCurrentSongPlaying,
      selectionMode,
      selectedSongIds,
      toggleSelectSong,
      handleRowPlay,
      handleRowContextMenu,
      handleCoverClick,
      handleRowAction
    ]
  );

  return (
    <div
      className="library-content-layout relative flex h-full w-full flex-col"
      data-surface={surface}
    >
      <FloatingPanel
        panel="library"
        title="歌曲操作"
        icon="tune"
        className="library-floating-tools"
      >
        <section
          className="library-list-header shrink-0 border-b border-black/8 px-5 py-3 dark:border-white/8"
          aria-label="歌曲列表操作"
        >
          <div className="flex flex-wrap items-center gap-2">
            {selectionMode ? (
              <>
                <button
                  type="button"
                  className="library-pill lumina-hero-secondary"
                  onClick={toggleSelectAll}
                  disabled={!displaySongs.length || batchBusy}
                >
                  <span className="material-icons-round" aria-hidden="true">
                    checklist
                  </span>
                  {areAllDisplayedSelected ? '取消全选' : '全选'}
                </button>
                <button
                  type="button"
                  className="library-pill lumina-hero-primary"
                  onClick={clearSelection}
                  disabled={batchBusy}
                >
                  完成
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="library-pill lumina-hero-primary"
                  onClick={playAll}
                  disabled={!songs.length || loading}
                >
                  <span className="material-icons-round" aria-hidden="true">
                    play_arrow
                  </span>
                  播放全部
                </button>
                <button
                  type="button"
                  className="library-pill lumina-hero-secondary"
                  onClick={() => setSelectionMode(true)}
                  disabled={!songs.length || loading}
                >
                  <span className="material-icons-round" aria-hidden="true">
                    checklist
                  </span>
                  选择
                </button>
              </>
            )}
            <div className="library-surface-toggle" role="group" aria-label="歌曲视图">
              {(['cd', 'list'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={value === 'cd' ? 'CD 画布视图' : '歌曲列表视图'}
                  title={value === 'cd' ? 'CD 画布' : '歌曲列表'}
                  aria-pressed={surface === value}
                  onClick={() => {
                    setSurface(value);
                    try {
                      window.localStorage.setItem('volo-library-surface', value);
                    } catch {
                      /* Session state remains usable. */
                    }
                  }}
                >
                  <span className="material-icons-round-outlined" aria-hidden="true">
                    {value === 'cd' ? 'album' : 'view_list'}
                  </span>
                </button>
              ))}
            </div>
            <div className="ml-auto flex min-w-0 items-center gap-2">
              <LibrarySearch
                key={String(profile?.userId) + ':' + key}
                value={searchQuery}
                onChange={(value) => {
                  setSearchQuery(value);
                  if (scroller.current) scroller.current.scrollTop = 0;
                }}
              />
              {kind === 'favorites' && (
                <FavoriteFilters
                  songs={songs}
                  value={favoriteFilter}
                  onChange={(value) => {
                    setFavoriteFilter(value);
                    if (scroller.current) scroller.current.scrollTop = 0;
                  }}
                />
              )}
            </div>
          </div>
          {selectionMode && (
            <div
              className="library-batch-toolbar mt-3 flex flex-wrap items-center gap-2"
              role="group"
              aria-label="批量歌曲操作"
            >
              <span className="mr-1 text-xs opacity-65">已选 {selectedSongIds.size} 首</span>
              <button
                type="button"
                className="library-pill lumina-hero-secondary"
                disabled={!selectedSongs.length || batchBusy || loading || transition !== 'idle'}
                onClick={() => void runBatch('next')}
              >
                <span className="material-icons-round" aria-hidden="true">
                  shortcut
                </span>
                下一首播放
              </button>
              <button
                type="button"
                className="library-pill lumina-hero-secondary"
                disabled={!selectedSongs.length || batchBusy || loading || transition !== 'idle'}
                onClick={() => void runBatch('playlist')}
              >
                <span className="material-icons-round" aria-hidden="true">
                  playlist_add
                </span>
                收藏到歌单
              </button>
              <button
                type="button"
                className="library-pill lumina-hero-secondary"
                disabled={!canDownload || batchBusy || loading || transition !== 'idle'}
                onClick={() => void runBatch('download')}
                title={kind === 'local' ? '本地歌曲无需下载' : '下载所选歌曲'}
              >
                <span className="material-icons-round" aria-hidden="true">
                  download
                </span>
                下载
              </button>
              {canDelete && (
                <button
                  type="button"
                  className="library-pill lumina-hero-secondary"
                  disabled={!selectedSongs.length || batchBusy || loading || transition !== 'idle'}
                  onClick={() => setConfirmDelete(true)}
                >
                  <span className="material-icons-round" aria-hidden="true">
                    delete_outline
                  </span>
                  删除
                </button>
              )}
              {batchBusy && (
                <span className="text-xs opacity-65" role="status">
                  正在处理…
                </span>
              )}
            </div>
          )}
          {batchMessage && (
            <p className="mt-2 text-xs opacity-75" role="status">
              {batchMessage}
            </p>
          )}
        </section>
      </FloatingPanel>
      <ManagementDialog
        open={pendingDownload !== null}
        onClose={() => {
          if (!batchBusy) setPendingDownload(null);
        }}
        label="选择下载音质"
        className="w-[420px] p-6"
      >
        <h2 className="text-lg font-semibold">选择下载音质</h2>
        <p className="mt-2 text-sm opacity-65">
          将下载 {pendingDownload?.songs.length ?? 0} 首歌曲。实际音质取决于歌曲资源和当前账号权益。
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="下载音质">
          {NCM_SONG_QUALITIES.map((option) => {
            const selected = option === downloadQuality;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`flex h-10 items-center justify-between rounded-xl border px-3 text-left text-sm transition-colors focus-visible:outline ${
                  selected
                    ? 'border-font-color-highlight/45 bg-font-color-highlight/12 text-font-color-highlight dark:border-dark-font-color-highlight/45 dark:bg-dark-font-color-highlight/14 dark:text-dark-font-color-highlight'
                    : 'border-black/8 bg-black/3 hover:bg-black/6 dark:border-white/10 dark:bg-white/4 dark:hover:bg-white/8'
                }`}
                onClick={() => setDownloadQuality(option)}
              >
                <span>{t(NCM_QUALITY_LABEL_KEYS[option])}</span>
                {selected && (
                  <span className="material-icons-round text-lg leading-none" aria-hidden="true">
                    check
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="library-pill lumina-hero-secondary"
            disabled={batchBusy}
            onClick={() => setPendingDownload(null)}
          >
            取消
          </button>
          <button
            type="button"
            className="library-pill lumina-hero-primary"
            disabled={batchBusy || !pendingDownload?.songs.length}
            onClick={() => void confirmDownload()}
          >
            选择文件夹并下载
          </button>
        </div>
      </ManagementDialog>

      <ManagementDialog
        open={confirmDelete}
        onClose={() => {
          if (!batchBusy) setConfirmDelete(false);
        }}
        label="从歌单移除歌曲"
        className="w-96 p-6"
      >
        <h2 className="text-lg font-semibold">移除所选的 {selectedSongs.length} 首歌曲？</h2>
        <p className="mt-3 text-sm opacity-70">
          {kind === 'favorites'
            ? '将取消喜欢这些歌曲，并同步到网易云。'
            : '将从这个歌单中移除这些歌曲。'}
          本地文件不会删除。
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="library-pill lumina-hero-secondary"
            disabled={batchBusy}
            onClick={() => setConfirmDelete(false)}
          >
            取消
          </button>
          <button
            type="button"
            className="library-pill lumina-hero-primary"
            disabled={batchBusy || !selectedSongs.length}
            onClick={() => void runBatch('delete')}
          >
            {batchBusy ? '正在移除…' : '移除'}
          </button>
        </div>
      </ManagementDialog>

      {/* Keep the viewport mounted through loading and playlist transitions. Fixed
          row sizing lets async data and viewport resizes update independently,
          without relaying out every offscreen song on each window resize. */}
      <div className="library-song-list-region relative min-h-0 flex-1 overflow-hidden">
        <div
          className={`library-song-list-viewport h-full min-h-0 ${transition === 'exit' ? 'song-list-exit' : ''}`}
        >
          {surface === 'cd' ? (
            <CDCanvas
              key={`${profile?.userId ?? 0}:${key}:${searchQuery}:${JSON.stringify(favoriteFilter)}`}
              scope={`${profile?.userId ?? 0}:${key}:${searchQuery}:${JSON.stringify(favoriteFilter)}`}
              songs={songDataList}
              currentSongId={currentSongData?.songId}
              playing={isCurrentSongPlaying}
              selectionMode={selectionMode}
              selectedIds={selectedSongIds}
              onPlay={handleCoverClick}
              onSelect={toggleSelectSong}
              onAction={handleRowAction}
              onContextMenu={handleRowContextMenu}
            />
          ) : (
            <Virtuoso
              className="library-song-list-scroll min-h-0 overflow-x-hidden px-1"
              style={{ height: '100%', width: '100%' }}
              data={songDataList}
              initialScrollTop={view.scrollTop}
              fixedItemHeight={LIBRARY_ROW_HEIGHT}
              increaseViewportBy={LIBRARY_ROW_HEIGHT * 4}
              components={libraryListComponents}
              computeItemKey={(_index, song) => song.songId}
              itemContent={(index, song) => renderRow(song, index)}
              scrollerRef={handleListRef}
              onScroll={(event) => {
                view.scrollTop = event.currentTarget.scrollTop;
              }}
            />
          )}
        </div>
        {!showSongList && songDataList.length === 0 && (
          <div
            className="absolute inset-0 flex items-center justify-center"
            role="status"
            aria-live="polite"
          >
            {loading || transition === 'loading' ? (
              <span className="text-font-color-black/40 dark:text-font-color-white/40 text-sm">
                加载中…
              </span>
            ) : error ? (
              <div className="text-font-color-black/70 dark:text-font-color-white/75 flex flex-col items-center gap-3 px-4 text-center text-sm">
                <span>{error}</span>
                <button
                  className="rounded-lg border border-current/20 px-4 py-2 hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => {
                    pendingKeyRef.current = key;
                    setTransition('loading');
                    setRetryAttempt((attempt) => attempt + 1);
                  }}
                >
                  重新加载
                </button>
              </div>
            ) : songs.length === 0 ? (
              <span className="text-font-color-black/40 dark:text-font-color-white/40 text-sm">
                暂无歌曲
              </span>
            ) : (
              <span className="text-font-color-black/40 dark:text-font-color-white/40 text-sm">
                未找到匹配的歌曲
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
