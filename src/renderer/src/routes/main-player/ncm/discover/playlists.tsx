/**
 * NCM 歌单广场 — 按分类浏览网易云歌单
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ncmApi } from '@renderer/api/ncm-client';
import { proxyCoverUrl } from '@renderer/ncm';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import { NcmRepository } from '@renderer/ncm/repository';
import { NeteaseSyncService } from '@renderer/ncm/NeteaseSyncService';
import { useNcmUser, currentNcmUid } from '@renderer/contexts/NcmUserContext';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import SecondaryContainer from '@renderer/components/SecondaryContainer';
import ResponsiveGrid from '@renderer/components/ResponsiveGrid';
import { Playlist } from '@renderer/components/PlaylistsPage/Playlist';
import useResponsiveGrid, { PLAYLIST_CARD_MIN_WIDTH } from '@renderer/hooks/useResponsiveGrid';
import type { NcmPlaylist } from '@renderer/ncm/types';


const CATS = ['全部', '华语', '欧美', '日语', '韩语', '粤语', '流行', '摇滚', '民谣', '电子', '说唱', '轻音乐', '爵士', '古典', '古风', '后摇', 'ACG', '影视原声', '怀旧', '清新', '浪漫', '伤感', '治愈', '放松', '安静', '运动', '旅行', '夜晚', '学习', '工作', '榜单'];

export const Route = createFileRoute('/main-player/ncm/discover/playlists')({
  component: NcmDiscoverPlaylists,
});

function NcmDiscoverPlaylists() {
  const [cat, setCat] = useState('全部');
  const [playlists, setPlaylists] = useState<NcmPlaylist[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const { isLoggedIn, profile } = useNcmUser();
  const uid = profile?.userId || currentNcmUid || 0;
  const { addNewNotifications } = useContext(AppUpdateContext);

  // 加载已收藏歌单 ID
  useEffect(() => {
    if (!isLoggedIn || !uid) return;
    NcmRepository.getUserPlaylists(uid).then((pls) => {
      setSubscribedIds(new Set(pls.map((p) => -p.playlistId)));
    }).catch(() => {});
  }, [isLoggedIn, uid]);

  const gridRef = useRef<HTMLDivElement>(null);
  const { width } = useResponsiveGrid(gridRef, 3, PLAYLIST_CARD_MIN_WIDTH);
  const columns = useMemo(() => Math.max(3, Math.floor(width / PLAYLIST_CARD_MIN_WIDTH)), [width]);

  const fetchPlaylists = useCallback(async (category: string) => {
    setLoading(true);
    try {
      const raw = await ncmApi.topPlaylist(category, 'hot', 60) as Record<string, unknown>;
      // top/playlist 返回 { playlists: [...] } — 不是 adaptPlaylistList 能识别的格式
      const list = (raw.playlists || raw.list || raw.result || []) as Record<string, unknown>[];
      const adapted = list.map((pl: Record<string, unknown>) => {
        const coverUrl = (pl.coverImgUrl as string) || (pl.picUrl as string) || '';
        return {
          playlistId: -(pl.id as number),
          name: (pl.name as string) || '',
          songs: [],
          createdDate: new Date(),
          isArtworkAvailable: !!coverUrl,
          artworkPaths: { isDefaultArtwork: !coverUrl, artworkPath: proxyCoverUrl(coverUrl), optimizedArtworkPath: proxyCoverUrl(coverUrl) },
          coverUrl,
          tracks: [],
          playCount: (pl.playCount as number) || 0,
          creatorName: ((pl.creator as Record<string, unknown>)?.nickname as string) || '',
          creatorId: ((pl.creator as Record<string, unknown>)?.userId as number) || 0,
          trackCount: (pl.trackCount as number) || 0,
          description: (pl.description as string) || '',
          copywriter: (pl.copywriter as string) || '',
        } as NcmPlaylist;
      });
      setPlaylists(adapted);
    } catch {
      setPlaylists([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaylists(cat);
  }, [cat, fetchPlaylists]);

  const handleToggleSubscribe = useCallback((e: React.MouseEvent, pl: NcmPlaylist) => {
    e.stopPropagation();
    const rawId = -pl.playlistId;
    const isSubbed = subscribedIds.has(rawId);
    const action = isSubbed
      ? NeteaseSyncService.unsubscribePlaylist(rawId, uid)
      : NeteaseSyncService.subscribePlaylist(rawId, uid);
    action.then(() => {
      setSubscribedIds((prev) => { const n = new Set(prev); isSubbed ? n.delete(rawId) : n.add(rawId); return n; });
      addNewNotifications([{ id: 'ncmToggle', iconName: 'favorite', content: isSubbed ? `已取消收藏「${pl.name}」` : `已收藏「${pl.name}」` }]);
    }).catch((err) => addNewNotifications([{ id: 'ncmErr', iconName: 'error', content: String(err) }]));
  }, [uid, addNewNotifications, subscribedIds]);

  const playlistItems = useMemo(() => playlists.map((pl) => ({
    playlistId: pl.playlistId,
    name: pl.name,
    artworkPaths: {
      isDefaultArtwork: !pl.coverUrl,
      artworkPath: proxyCoverUrl(pl.coverUrl),
      optimizedArtworkPath: proxyCoverUrl(pl.coverUrl),
    },
    songs: Array.from({ length: pl.trackCount || 0 }, (_, i) => i),
    createdDate: new Date(),
    isArtworkAvailable: !!pl.coverUrl,
    additionalContextMenuItems: isLoggedIn ? [{
      label: subscribedIds.has(-pl.playlistId) ? '取消收藏' : '收藏歌单',
      iconName: 'favorite',
      handlerFunction: () => {
        const rawId = -pl.playlistId;
        const isSubbed = subscribedIds.has(rawId);
        (isSubbed ? NeteaseSyncService.unsubscribePlaylist(rawId, uid) : NeteaseSyncService.subscribePlaylist(rawId, uid))
          .then(() => setSubscribedIds((prev) => { const n = new Set(prev); isSubbed ? n.delete(rawId) : n.add(rawId); return n; }))
          .catch(() => {});
      },
    }] : [],
  } as Playlist)), [playlists, isLoggedIn, uid, subscribedIds]);

  return (
    <SecondaryContainer ref={gridRef} className="appear-from-bottom h-full w-full flex-col p-8">
      <div className="mb-6 flex items-center gap-2">
        <span className="text-font-color-highlight dark:text-dark-font-color-highlight text-2xl font-medium">歌单广场</span>
      </div>

      {/* 分类选择器 */}
      <div className="mb-6 flex flex-wrap gap-2">
        {CATS.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`cursor-pointer rounded-full px-4 py-1.5 text-sm transition-colors ${
              cat === c
                ? 'bg-font-color-highlight text-white dark:bg-dark-font-color-highlight dark:text-font-color-black'
                : 'bg-background-color-2/50 text-font-color-black dark:bg-dark-background-color-2/50 dark:text-font-color-white hover:bg-background-color-3'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {/* 歌单网格 */}
      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-gray-400">加载中...</div>
      ) : (
        <ResponsiveGrid columns={columns}>
          {playlistItems.map((item, i) => (
            <Playlist
              key={item.playlistId}
              index={i}
              source="netease"
              linkTo={`/main-player/ncm/playlist/${-playlists[i].playlistId}`}
              isSubscribed={subscribedIds.has(-playlists[i].playlistId)}
              onToggleSubscribe={(e) => handleToggleSubscribe(e, playlists[i])}
              onPlay={(shuffle = false) => {
                const ncmId = -playlists[i].playlistId;
                NcmRepository.playlistDetail(ncmId).then((detail) => {
                  const tracks = shuffle ? [...detail.tracks].sort(() => Math.random() - 0.5) : detail.tracks;
                  PlaybackBridge.playSongs(tracks, 0);
                }).catch(() => {});
              }}
              onAddToQueue={() => {
                const ncmId = -playlists[i].playlistId;
                NcmRepository.playlistDetail(ncmId).then(async (detail) => {
                  for (const song of detail.tracks) {
                    try { await PlaybackBridge.addToEnd(song); } catch { /* skip */ }
                  }
                }).catch(() => {});
              }}
              {...item}
            />
          ))}
        </ResponsiveGrid>
      )}
    </SecondaryContainer>
  );
}
