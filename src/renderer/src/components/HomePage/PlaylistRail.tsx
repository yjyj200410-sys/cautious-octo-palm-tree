import { CDSleeve } from '@renderer/components/CDLibrary/CDArtwork';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import { useNcmUser } from '@renderer/contexts/NcmUserContext';
import { useQueueOperations } from '@renderer/hooks/useQueueOperations';
import { getAllLocalSongs, getLocalSongCount } from '@renderer/localMusic/localLibrary';
import { proxyCoverUrl } from '@renderer/ncm';
import { DiscoverProvider } from '@renderer/ncm/discover/DiscoverProvider';
import { NcmHomeRepository } from '@renderer/ncm/home/NcmHomeRepository';
import { NeteaseSyncService } from '@renderer/ncm/NeteaseSyncService';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import { NcmRepository } from '@renderer/ncm/repository';
import type { NcmPlaylist, NcmSong } from '@renderer/ncm/types';
import { routeStateStore, setLibraryPanel } from '@renderer/store/routeStateStore';
import { useNavigate } from '@tanstack/react-router';
import { lazy, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import CreateNcmPlaylistPrompt from './CreateNcmPlaylistPrompt';
import type { RailTab } from './FloatingNav';
import { type RailDir, type RailTransition } from './railConstants';

const AddMusicFoldersPrompt = lazy(
  () => import('@renderer/components/MusicFoldersPage/AddMusicFoldersPrompt')
);

import favoritesPlaylistCoverImage from '@renderer/assets/images/webp/favorites-playlist-icon.webp';
import DefaultPlaylistCover from '@renderer/assets/images/webp/playlist_cover_default.webp';

/** 首页歌单导航行的基础尺寸。 */
const CARD_HEIGHT = 224;
const CARD_GAP = 0;
const CARD_STEP = CARD_HEIGHT + CARD_GAP;
const CARD_WIDTH = '100%';
const retainedActiveKeys: Partial<Record<RailTab, string>> = {};

type RailKind = 'favorites' | 'daily' | 'ncm' | 'local';
type LikedMeta = { coverUrl: string; trackCount: number } | null;

type RailCardData = {
  key: string;
  kind: RailKind;
  id?: number;
  title: string;
  subtitle: string;
  cover: string;
  fallback: string;
  /** 动作卡(非歌单):add-folder = 打开本地音乐文件夹选择。点击触发动作,不驱动 LibraryPanel */
  action?: 'add-folder';
};

/** 通用歌单 → 卡片数据(ncm 类型;favorites/daily 卡单独内联构造) */
const toNcmCard = (pl: NcmPlaylist, prefix: string): RailCardData => ({
  key: `${prefix}-${pl.playlistId}`,
  kind: 'ncm',
  id: -pl.playlistId,
  title: pl.name,
  subtitle: `${pl.trackCount || 0} 首`,
  cover: proxyCoverUrl(pl.coverUrl),
  fallback: DefaultPlaylistCover
});

/** 首页歌单导航行。 */
const PlaylistCard = memo(
  ({
    data,
    isActive,
    onSelect,
    onPlay
  }: {
    data: RailCardData;
    isActive: boolean;
    onSelect: () => void;
    onPlay: () => void;
  }) => (
    <div
      data-rail-card
      data-key={data.key}
      data-kind={data.kind}
      data-id={data.id}
      data-action={data.action}
      data-title={data.title}
      data-cover={data.cover}
      data-subtitle={data.subtitle}
      className={`cd-rail-card ${data.action ? 'cd-rail-action' : ''} ${
        isActive ? 'is-active' : ''
      }`}
      aria-current={isActive ? 'true' : undefined}
      style={{ width: CARD_WIDTH } as React.CSSProperties}
    >
      <button
        type="button"
        data-rail-main
        aria-pressed={isActive}
        onClick={onSelect}
        title={data.title}
        className="cd-rail-main"
      >
        {data.action ? (
          <span className="cd-rail-folder">
            <span className="material-icons-round-outlined text-2xl leading-none opacity-55">
              {data.action === 'add-folder' ? 'create_new_folder' : 'folder'}
            </span>
          </span>
        ) : (
          <CDSleeve cover={data.cover} fallback={data.fallback} />
        )}
        <span className="cd-rail-copy">
          <strong>{data.title}</strong>
          <small>{data.subtitle}</small>
        </span>
      </button>
      {!data.action && (
        <button
          type="button"
          title="播放歌单"
          aria-label={`播放 ${data.title}`}
          onClick={(event) => {
            event.stopPropagation();
            onPlay();
          }}
          className="cd-rail-play"
        >
          <span className="material-icons-round text-xl leading-none">play_arrow</span>
        </button>
      )}
    </div>
  )
);
PlaylistCard.displayName = 'PlaylistCard';

/** 首页左侧歌单导航：自然滚动，点击选择，行内播放与更多操作。 */
export default function PlaylistRail({
  activeTab,
  transition,
  railDir,
  onOpenDetail
}: {
  activeTab: RailTab;
  transition: RailTransition;
  railDir: RailDir;
  onOpenDetail?: (detail: {
    kind: 'ncm' | 'favorites';
    id?: number;
    title: string;
    cover: string;
  }) => void;
}) {
  const { isLoggedIn, profile } = useNcmUser();
  const { updateContextMenuData, addNewNotifications, changePromptMenuData, createQueue } =
    useContext(AppUpdateContext);
  const { addToEnd } = useQueueOperations();
  const navigate = useNavigate();
  const railRef = useRef<HTMLDivElement | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(
    () => retainedActiveKeys[activeTab] ?? null
  );

  const [favorite, setFavorite] = useState<LikedMeta>(null);
  const [userCreated, setUserCreated] = useState<NcmPlaylist[]>([]);
  const [userCollected, setUserCollected] = useState<NcmPlaylist[]>([]);
  const [daily, setDaily] = useState<LikedMeta>(null);
  /** 发现音乐(DiscoverPool):首次 30 个,滚动接近底部追加 20,缓存上限 50 */
  const [discoverItemsData, setDiscoverItemsData] = useState<NcmPlaylist[]>([]);
  const [radar, setRadar] = useState<NcmPlaylist[]>([]);
  /** 本地音乐(独立 PlaylistGroup,不依赖登录):count = 本地库歌曲数;songs 按需 lazy 拉取 */
  const [localCount, setLocalCount] = useState(0);
  /**
   * 右键收藏/取消收藏的本地覆盖(ncm 卡):key = 负 playlistId。菜单打开时结合 userCollected 推导当前收藏态;切换只记覆盖
   * ref(无需重载整份歌单数据),下次打开菜单即生效。
   */
  const subOverridesRef = useRef<Record<number, boolean>>({});

  /**
   * 重拉用户歌单并拆分回填 favorite/userCreated/userCollected。收藏切换/删除后列表即时更新 (数据 effect 依赖 uid 不会重跑);调用方需确保传入的
   * uid 有效。
   */
  const reloadUserPlaylists = useCallback((uid: number) => {
    NcmRepository.getUserPlaylists(uid)
      .then((pls) => {
        const isLiked = (name: string) => name === '我喜欢的音乐' || name.includes('喜欢的音乐');
        const liked = pls.find((p) => isLiked(p.name));
        setFavorite(
          liked ? { coverUrl: liked.coverUrl || '', trackCount: liked.trackCount } : null
        );
        setUserCreated(pls.filter((p) => p.creatorId === uid && !isLiked(p.name)));
        setUserCollected(pls.filter((p) => p.creatorId !== uid));
      })
      .catch(() => {});
  }, []);

  // 本地音乐(独立 PlaylistGroup,不依赖 NCM 登录):复用 MusicFolders 扫描的本地库,取歌曲总数
  useEffect(() => {
    getLocalSongCount()
      .then(setLocalCount)
      .catch(() => setLocalCount(0));
  }, []);

  // 整合歌单数据:六类并行加载,空类别保留空数组,不影响其他
  useEffect(() => {
    if (!isLoggedIn || !profile?.userId) {
      setFavorite(null);
      setUserCreated([]);
      setUserCollected([]);
      setDaily(null);
      setDiscoverItemsData([]);
      setRadar([]);
      return;
    }
    reloadUserPlaylists(profile.userId);
    NcmHomeRepository.getDailySongs()
      .then((songs) => {
        if (songs.length > 0)
          setDaily({ coverUrl: songs[0].coverUrl || '', trackCount: songs.length });
      })
      .catch(() => {});
    // 发现音乐走 DiscoverProvider(DiscoverPool 混合数据源),不再直接依赖 personalized
    DiscoverProvider.loadInitial()
      .then(() => setDiscoverItemsData(DiscoverProvider.items))
      .catch(() => {});
    NcmHomeRepository.getRadarPlaylists(8)
      .then(setRadar)
      .catch(() => {});
  }, [isLoggedIn, profile?.userId, reloadUserPlaylists]);

  // 发现音乐无限流:滚动接近底部(剩 3 卡距离)触发 loadMore,追加后同步 items。
  useEffect(() => {
    if (activeTab !== 'discover' || !isLoggedIn) return;
    const rail = railRef.current;
    if (!rail) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        if (!DiscoverProvider.hasMore || DiscoverProvider.loading) return;
        const maxTop = rail.scrollHeight - rail.clientHeight;
        if (maxTop - rail.scrollTop < CARD_STEP * 3) {
          DiscoverProvider.loadMore()
            .then(() => setDiscoverItemsData(DiscoverProvider.items))
            .catch(() => {});
        }
      });
    };
    rail.addEventListener('scroll', onScroll, { passive: true });
    return () => rail.removeEventListener('scroll', onScroll);
  }, [activeTab, isLoggedIn]);

  // 两个数据集合(FloatingNav 切换):「我的音乐」/「发现音乐」。仅切换展示集合,请求层不变。
  const myMusicItems = useMemo<RailCardData[]>(() => {
    const items: RailCardData[] = [];
    if (favorite) {
      items.push({
        key: 'favorite',
        kind: 'favorites',
        title: '我喜欢的音乐',
        subtitle: `${favorite.trackCount} 首`,
        cover: favorite.coverUrl || favoritesPlaylistCoverImage,
        fallback: favoritesPlaylistCoverImage
      });
    }
    items.push(...userCreated.map((pl) => toNcmCard(pl, 'created')));
    items.push(...userCollected.map((pl) => toNcmCard(pl, 'collected')));
    return items;
  }, [favorite, userCreated, userCollected]);

  const discoverItems = useMemo<RailCardData[]>(() => {
    const items: RailCardData[] = [];
    if (daily) {
      items.push({
        key: 'daily',
        kind: 'daily',
        title: '每日推荐',
        subtitle: `${daily.trackCount} 首`,
        cover: daily.coverUrl ? proxyCoverUrl(daily.coverUrl) : DefaultPlaylistCover,
        fallback: DefaultPlaylistCover
      });
    }
    items.push(...discoverItemsData.map((pl) => toNcmCard(pl, 'recommend')));
    return items;
  }, [daily, discoverItemsData]);

  // 雷达歌单单独归类(独立 tab)
  const radarItems = useMemo<RailCardData[]>(
    () => radar.map((pl) => toNcmCard(pl, 'radar')),
    [radar]
  );

  // 本地音乐单独归类(独立 tab):「本地音乐」卡 + 同形式「添加本地音乐」入口卡(动作卡)
  const localItems = useMemo<RailCardData[]>(
    () => [
      {
        key: 'local',
        kind: 'local',
        title: '本地音乐',
        subtitle: `${localCount} 首`,
        cover: '',
        fallback: DefaultPlaylistCover
      },
      {
        key: 'add-local-folder',
        kind: 'local',
        title: '添加本地音乐',
        subtitle: '选择文件夹导入',
        cover: '',
        fallback: DefaultPlaylistCover,
        action: 'add-folder'
      }
    ],
    [localCount]
  );

  const playlistRailItems = useMemo<RailCardData[]>(() => {
    if (activeTab === 'my-music') return myMusicItems;
    if (activeTab === 'discover') return discoverItems;
    if (activeTab === 'local') return localItems;
    return radarItems;
  }, [activeTab, myMusicItems, discoverItems, radarItems, localItems]);

  // ---- 歌单卡片右键菜单(阶段 4.9)----
  // 解析一张卡对应的歌曲列表(请求路径与 LibraryContent 完全一致:favorites 先找「我喜欢的
  // 音乐」歌单 id、daily 走每日推荐、ncm 走歌单详情、local 走本地库;不触碰播放/队列内部)。
  const fetchCardSongs = useCallback(
    async (data: RailCardData): Promise<NcmSong[]> => {
      try {
        if (data.kind === 'daily') {
          return await NcmHomeRepository.getDailySongs();
        }
        if (data.kind === 'favorites') {
          if (!profile?.userId) return [];
          const playlists = await NcmRepository.getUserPlaylists(profile.userId);
          const liked = playlists.find(
            (pl) => pl.name === '我喜欢的音乐' || pl.name.includes('喜欢的音乐')
          );
          if (!liked) return [];
          const absId = liked.playlistId > 0 ? liked.playlistId : -liked.playlistId;
          const d = await NcmRepository.playlistDetail(absId);
          return d?.tracks ?? [];
        }
        if (data.kind === 'ncm' && data.id !== undefined) {
          const d = await NcmRepository.playlistDetail(data.id);
          return d?.tracks ?? [];
        }
        if (data.kind === 'local') {
          return await getAllLocalSongs();
        }
        return [];
      } catch {
        return [];
      }
    },
    [profile?.userId]
  );

  /**
   * 播放整卡歌单(顺序/随机):O(1) 初始化,队列来源与 LibraryContent 同约定。 local 走现有本地 Queue(createQueue,不触碰 NCM
   * PlaybackBridge);其余走 NCM PlaybackBridge。
   */
  const playCard = useCallback(
    async (data: RailCardData, shuffle: boolean) => {
      const songs = await fetchCardSongs(data);
      if (songs.length === 0) {
        addNewNotifications([
          { id: `railPlayEmpty-${data.key}`, iconName: 'error', content: '歌单暂无歌曲' }
        ]);
        return;
      }
      if (data.kind === 'local') {
        const ids = songs.map((s) => s.songId);
        const list = shuffle ? [...ids].sort(() => Math.random() - 0.5) : ids;
        createQueue(list, 'songs', false, 'local', true);
        return;
      }
      const list = shuffle ? [...songs].sort(() => Math.random() - 0.5) : songs;
      const sourceType = data.kind === 'daily' ? 'ncmDaily' : 'ncmPlaylist';
      const sourceId =
        data.kind === 'daily'
          ? 'daily'
          : data.kind === 'favorites'
            ? 'favorites'
            : String(data.id ?? '');
      await PlaybackBridge.playSongs(list, 0, sourceType, sourceId).catch(() => {});
    },
    [fetchCardSongs, addNewNotifications, createQueue]
  );

  /** 整卡歌单加入队尾(PlaybackBridge 批量注册,不逐个解析 URL;local 走现有 addToEnd) */
  const addCardToQueue = useCallback(
    async (data: RailCardData) => {
      const songs = await fetchCardSongs(data);
      if (songs.length === 0) return;
      if (data.kind === 'local') {
        addToEnd(songs.map((s) => s.songId));
        addNewNotifications([
          {
            id: `railAddQueue-${data.key}`,
            iconName: 'add',
            content: `已加入队列:${data.title}(${songs.length} 首)`
          }
        ]);
        return;
      }
      await PlaybackBridge.addPlaylistToEnd(songs).catch(() => {});
      addNewNotifications([
        {
          id: `railAddQueue-${data.key}`,
          iconName: 'add',
          content: `已加入队列:${data.title}(${songs.length} 首)`
        }
      ]);
    },
    [fetchCardSongs, addNewNotifications, addToEnd]
  );

  /** Ncm 卡收藏/取消收藏(NeteaseSyncService 与 NcmPlaylistCardsSection 同源;成功后记本地覆盖 并重拉用户歌单,列表即时移除/恢复,不必等重启) */
  const toggleCardSubscribe = useCallback(
    async (data: RailCardData, isSubscribed: boolean) => {
      if (!profile?.userId || data.id === undefined) return;
      // 闭包内 TS 丢失参数窄化,先固化判空后的值
      const rawId = data.id; // 负 playlistId(全库同约定)
      const uid = profile.userId;
      const action = isSubscribed
        ? NeteaseSyncService.unsubscribePlaylist(rawId, uid)
        : NeteaseSyncService.subscribePlaylist(rawId, uid);
      try {
        await action;
        subOverridesRef.current[rawId] = !isSubscribed;
        reloadUserPlaylists(uid);
        addNewNotifications([
          {
            id: `railSub-${data.key}`,
            iconName: 'favorite',
            content: isSubscribed ? `已取消收藏「${data.title}」` : `已收藏「${data.title}」`
          }
        ]);
      } catch {
        return;
      }
    },
    [profile?.userId, addNewNotifications, reloadUserPlaylists]
  );

  /**
   * 删除自建歌单(仅 rail 中 self-created 卡):确认后走 NeteaseSyncService(与歌单详情页同源), 其已失效 user_playlists
   * 缓存,这里重新拉取并把 userCreated/userCollected 拆分回填, 列表随之移除该卡(数据 effect 依赖 uid 不会自动重跑)。
   */
  const deleteCardPlaylist = useCallback(
    async (data: RailCardData) => {
      if (!profile?.userId || data.id === undefined) return;
      // 闭包内 TS 丢失外层参数窄化,先把判空后的值固化到 const(playlistId 为负 id,全库同约定)
      const playlistId = data.id;
      const uid = profile.userId;
      const mod = await import('@renderer/components/SensitiveActionConfirmPrompt');
      changePromptMenuData(
        true,
        <mod.default
          title="删除歌单"
          content={<p>确定要删除歌单「{data.title}」吗？此操作不可撤销。</p>}
          confirmButton={{
            label: '删除',
            iconName: 'delete',
            clickHandler: async () => {
              try {
                await NeteaseSyncService.deletePlaylist(playlistId, uid);
                reloadUserPlaylists(uid);
                addNewNotifications([
                  {
                    id: `railDelete-${data.key}`,
                    iconName: 'delete',
                    content: `已删除歌单「${data.title}」`
                  }
                ]);
              } catch {
                return;
              }
            }
          }}
        />
      );
    },
    [profile?.userId, addNewNotifications, changePromptMenuData, reloadUserPlaylists]
  );

  /** 构建卡片右键菜单并打开(菜单项在打开时按当前收藏态生成;事件委托在 Rail 容器) */
  const openCardContextMenu = useCallback(
    (e: React.MouseEvent, data: RailCardData) => {
      e.preventDefault();
      e.stopPropagation();
      const isNcm = data.kind === 'ncm';
      const baseSubscribed = new Set(userCollected.map((pl) => -pl.playlistId));
      const over = subOverridesRef.current;
      const isSubscribed =
        data.id !== undefined && (data.id in over ? over[data.id] : baseSubscribed.has(data.id));
      const items: ContextMenuItem[] = [
        {
          label: '播放全部',
          iconName: 'play_arrow',
          handlerFunction: () => playCard(data, false)
        },
        {
          label: '随机播放',
          iconName: 'shuffle',
          handlerFunction: () => playCard(data, true)
        },
        {
          label: '加入队列',
          iconName: 'queue',
          handlerFunction: () => addCardToQueue(data)
        },
        ...(isNcm
          ? [
              {
                label: 'Hr',
                isContextMenuItemSeperator: true,
                handlerFunction: () => true
              },
              {
                label: isSubscribed ? '取消收藏' : '收藏歌单',
                iconName: 'favorite',
                handlerFunction: () => toggleCardSubscribe(data, isSubscribed)
              },
              {
                label: '查看歌单',
                iconName: 'info',
                handlerFunction: () => {
                  if (data.id !== undefined)
                    navigate({
                      to: '/main-player/ncm/playlist/$id',
                      params: { id: String(data.id) }
                    });
                }
              }
            ]
          : []),
        ...(data.key.startsWith('created-')
          ? [
              {
                label: 'Hr',
                isContextMenuItemSeperator: true,
                handlerFunction: () => true
              },
              {
                label: '删除歌单',
                iconName: 'delete',
                class: 'text-font-color-crimson! dark:text-font-color-crimson!',
                handlerFunction: () => deleteCardPlaylist(data)
              }
            ]
          : [])
      ];
      updateContextMenuData(true, items, e.pageX, e.pageY, {
        title: data.title,
        artworkPath: data.cover,
        subTitle: data.subtitle
      });
    },
    [
      userCollected,
      playCard,
      addCardToQueue,
      toggleCardSubscribe,
      deleteCardPlaylist,
      navigate,
      updateContextMenuData
    ]
  );

  const selectCard = useCallback(
    (data: RailCardData) => {
      if (transition !== 'idle') return;
      if (data.action === 'add-folder') {
        changePromptMenuData(
          true,
          <AddMusicFoldersPrompt
            onFinally={() => {
              getLocalSongCount()
                .then(setLocalCount)
                .catch(() => {});
            }}
          />
        );
        return;
      }

      retainedActiveKeys[activeTab] = data.key;
      setActiveKey(data.key);
      setLibraryPanel({
        kind: data.kind,
        id: data.id,
        title: data.title,
        cover: data.cover
      });
      if ((data.kind === 'ncm' || data.kind === 'favorites') && onOpenDetail) {
        onOpenDetail({ kind: data.kind, id: data.id, title: data.title, cover: data.cover });
      }
    },
    [activeTab, changePromptMenuData, onOpenDetail, transition]
  );

  const moveSelection = useCallback(
    (target: 'previous' | 'next' | 'first' | 'last') => {
      if (transition !== 'idle') return;
      const selectable = playlistRailItems.filter((item) => !item.action);
      if (selectable.length === 0) return;

      const activeIndex = Math.max(
        0,
        selectable.findIndex((item) => item.key === activeKey)
      );
      const nextIndex =
        target === 'first'
          ? 0
          : target === 'last'
            ? selectable.length - 1
            : Math.min(
                selectable.length - 1,
                Math.max(0, activeIndex + (target === 'next' ? 1 : -1))
              );
      const next = selectable[nextIndex];
      if (!next || next.key === activeKey) return;

      selectCard(next);
      requestAnimationFrame(() => {
        const row = Array.from(
          railRef.current?.querySelectorAll<HTMLElement>('[data-rail-card]') ?? []
        ).find((element) => element.dataset.key === next.key);
        row?.scrollIntoView({
          block: 'nearest',
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth'
        });
        row?.querySelector<HTMLButtonElement>('[data-rail-main]')?.focus({ preventScroll: true });
      });
    },
    [activeKey, playlistRailItems, selectCard, transition]
  );

  useEffect(() => {
    if (transition !== 'idle') return;
    if (activeKey && playlistRailItems.some((item) => item.key === activeKey)) return;

    const firstPlaylist = playlistRailItems.find((item) => !item.action);
    if (!firstPlaylist) {
      setActiveKey(null);
      return;
    }

    const retainedKey = retainedActiveKeys[activeTab];
    const retainedPanel = routeStateStore.state['library-panel'];
    const preferredPlaylist =
      playlistRailItems.find((item) => item.key === retainedKey) ??
      playlistRailItems.find(
        (item) => item.kind === retainedPanel.kind && item.id === retainedPanel.id
      ) ??
      firstPlaylist;

    retainedActiveKeys[activeTab] = preferredPlaylist.key;
    setActiveKey(preferredPlaylist.key);
    setLibraryPanel({
      kind: preferredPlaylist.kind,
      id: preferredPlaylist.id,
      title: preferredPlaylist.title,
      cover: preferredPlaylist.cover
    });
    railRef.current?.scrollTo({ top: 0 });
  }, [activeKey, activeTab, playlistRailItems, transition]);

  if (!isLoggedIn && activeTab !== 'local') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="material-icons-round-outlined text-font-color-black/25 dark:text-font-color-white/25 text-5xl">
          library_music
        </span>
        <div className="text-font-color-black/72 dark:text-font-color-white/72 text-base font-semibold">
          登录后浏览你的网易云歌单
        </div>
        <div className="text-font-color-black/45 dark:text-font-color-white/45 max-w-56 text-sm leading-6">
          使用顶栏的「登录网易云」入口继续
        </div>
      </div>
    );
  }

  // 分类切换动画(阶段 3.7):只改 class,动画参数全在 CSS(rail-exit/enter-{up,down} 四类,
  // keyframes 由类内 CSS 变量定向)。同一 Rail 根节点原地动画(单 Rail 架构,不渲染第二个 Rail);
  // fill both 保证退场保持终态、进场 from 立即应用,回 idle 无动画类时自然态(= 进场终态)无跳变。
  const railTransitionClass =
    transition === 'exit'
      ? railDir === 'up'
        ? 'rail-exit-up'
        : 'rail-exit-down'
      : transition === 'enter'
        ? railDir === 'up'
          ? 'rail-enter-up'
          : 'rail-enter-down'
        : '';

  return (
    <div
      ref={railRef}
      role="navigation"
      aria-label="歌单菜单"
      className={`ipod-menu-list relative min-h-0 flex-1 overflow-y-auto px-0 py-0 outline-none ${railTransitionClass}`}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          moveSelection('next');
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          moveSelection('previous');
        } else if (event.key === 'Home') {
          event.preventDefault();
          moveSelection('first');
        } else if (event.key === 'End') {
          event.preventDefault();
          moveSelection('last');
        }
      }}
      onContextMenu={(e) => {
        // 阶段 4.9:卡片右键菜单(事件委托;stopPropagation 挡住外层 MainContainer 的开发菜单)
        if (transition !== 'idle') return;
        const el = (e.target as HTMLElement).closest('[data-rail-card]') as HTMLElement | null;
        if (!el) return;
        const data = playlistRailItems.find((c) => c.key === el.dataset.key);
        if (data) openCardContextMenu(e, data);
      }}
      style={
        {
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          paddingLeft: 0,
          paddingRight: 0,
          overflowX: 'hidden',
          touchAction: 'pan-y',
          cursor: 'default'
        } as React.CSSProperties
      }
    >
      {/* RailContent:对称 padding 保证首尾卡片能滚到视口中心;左对齐;水平安全区防 scale 1.30 贴边。
          单列空间浏览器,无分组标题;当前集合由左侧 FloatingNav 切换。 */}
      <div
        className="flex flex-col"
        style={
          {
            gap: CARD_GAP,
            paddingLeft: 0,
            alignItems: 'stretch'
          } as React.CSSProperties
        }
      >
        {activeTab === 'my-music' ? (
          <>
            <div className="home-rail-heading">我喜欢的音乐</div>
            {myMusicItems
              .filter((item) => item.kind === 'favorites')
              .map((data) => (
                <PlaylistCard
                  key={data.key}
                  data={data}
                  isActive={activeKey === data.key}
                  onSelect={() => selectCard(data)}
                  onPlay={() => playCard(data, false)}
                />
              ))}
            <div className="home-rail-heading">创建的歌单</div>
            {myMusicItems
              .filter((item) => item.key.startsWith('created-'))
              .map((data) => (
                <PlaylistCard
                  key={data.key}
                  data={data}
                  isActive={activeKey === data.key}
                  onSelect={() => selectCard(data)}
                  onPlay={() => playCard(data, false)}
                />
              ))}
            <button
              type="button"
              className="home-create-playlist"
              onClick={() => {
                if (!profile?.userId) return;
                changePromptMenuData(
                  true,
                  <CreateNcmPlaylistPrompt
                    uid={profile.userId}
                    onCreated={() => reloadUserPlaylists(profile.userId)}
                  />
                );
              }}
            >
              <span className="material-icons-round-outlined" aria-hidden="true">
                add
              </span>
              创建歌单
            </button>
            <div className="home-rail-heading">收藏的歌单</div>
            {myMusicItems
              .filter((item) => item.key.startsWith('collected-'))
              .map((data) => (
                <PlaylistCard
                  key={data.key}
                  data={data}
                  isActive={activeKey === data.key}
                  onSelect={() => selectCard(data)}
                  onPlay={() => playCard(data, false)}
                />
              ))}
          </>
        ) : (
          playlistRailItems.map((data) => (
            <PlaylistCard
              key={data.key}
              data={data}
              isActive={activeKey === data.key}
              onSelect={() => selectCard(data)}
              onPlay={() => playCard(data, false)}
            />
          ))
        )}
      </div>
    </div>
  );
}
