/**
 * NCM 专辑广场 — 按地区浏览新碟
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { ncmApi } from '@renderer/api/ncm-client';
import { proxyCoverUrl } from '@renderer/ncm';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import { NcmRepository } from '@renderer/ncm/repository';
import { useNcmUser } from '@renderer/contexts/NcmUserContext';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import SecondaryContainer from '@renderer/components/SecondaryContainer';
import ResponsiveGrid from '@renderer/components/ResponsiveGrid';
import { Album } from '@renderer/components/AlbumsPage/Album';
import useResponsiveGrid, { PLAYLIST_CARD_MIN_WIDTH } from '@renderer/hooks/useResponsiveGrid';
import type { NcmAlbum } from '@renderer/ncm/types';

const AREAS = [
  { key: 'ALL', label: '全部' },
  { key: 'ZH', label: '华语' },
  { key: 'EA', label: '欧美' },
  { key: 'KR', label: '韩国' },
  { key: 'JP', label: '日本' },
];

export const Route = createFileRoute('/main-player/ncm/discover/albums')({
  component: NcmDiscoverAlbums,
});

function NcmDiscoverAlbums() {
  const [area, setArea] = useState('ALL');
  const [albums, setAlbums] = useState<NcmAlbum[]>([]);
  const [collectedIds, setCollectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const { isLoggedIn } = useNcmUser();
  const { addNewNotifications } = useContext(AppUpdateContext);

  useEffect(() => {
    if (!isLoggedIn) return;
    NcmRepository.userAlbumSublist().then((albs) => {
      setCollectedIds(new Set(albs.map((a) => -a.albumId)));
    }).catch(() => {});
  }, [isLoggedIn]);

  const gridRef = useRef<HTMLDivElement>(null);
  const { width } = useResponsiveGrid(gridRef, 3, PLAYLIST_CARD_MIN_WIDTH);
  const columns = useMemo(() => Math.max(3, Math.floor(width / PLAYLIST_CARD_MIN_WIDTH)), [width]);

  const fetchAlbums = useCallback(async (a: string) => {
    setLoading(true);
    try {
      const raw = await ncmApi.request('album/new', { area: a, limit: '60', offset: '0' }) as Record<string, unknown>;
      const data = (raw.albums || raw.data || raw.monthData || []) as Record<string, unknown>[];
      const adapted = data.map((al: Record<string, unknown>) => {
        const cover = (al.picUrl as string) || (al.coverImgUrl as string) || (al.blurPicUrl as string) || '';
        return {
          albumId: -(al.id as number),
          title: (al.name as string) || '',
          artists: ((al.artists || al.ar || []) as { id: number; name: string }[]).map((a) => ({
            name: a.name,
            artistId: -a.id,
          })),
          songs: [],
          year: 0,
          artworkName: '',
          artworkPaths: { isDefaultArtwork: !cover, artworkPath: proxyCoverUrl(cover), optimizedArtworkPath: proxyCoverUrl(cover) },
          coverUrl: cover,
          tracks: [],
          description: '',
          trackCount: (al.size as number) || 0,
        } as NcmAlbum;
      });
      setAlbums(adapted);
    } catch {
      setAlbums([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAlbums(area); }, [area, fetchAlbums]);

  const handleToggleCollect = useCallback((e: React.MouseEvent, al: NcmAlbum) => {
    e.stopPropagation();
    const rawId = -al.albumId;
    const isCollected = collectedIds.has(rawId);
    ncmApi.collectAlbum(rawId, !isCollected)
      .then(() => {
        NcmRepository.invalidateAlbumSublist();
        NcmRepository.userAlbumSublist().then((albs) => {
          setCollectedIds(new Set(albs.map((a) => -a.albumId)));
        }).catch(() => {});
        addNewNotifications([{ id: 'ncmAlbumOk', iconName: 'check_circle', content: isCollected ? `已取消收藏「${al.title}」` : `已收藏「${al.title}」` }]);
      })
      .catch((err: any) => {
        if (err?.body?.code === 404 || err?.status === 404) {
          setCollectedIds((prev) => { const n = new Set(prev); n.delete(rawId); return n; });
        }
        addNewNotifications([{ id: 'ncmAlbumErr', iconName: 'error', content: '操作失败' }]);
      });
  }, [addNewNotifications, collectedIds]);

  const albumItems = useMemo(() => albums.map((al) => ({
    albumId: al.albumId,
    title: al.title,
    artists: al.artists,
    year: al.year,
    songs: Array.from({ length: al.trackCount || 0 }, (_, i) => i),
    artworkPaths: al.artworkPaths,
    isArtworkAvailable: !!al.coverUrl,
    createdDate: new Date(),
    additionalContextMenuItems: isLoggedIn ? [{
      label: collectedIds.has(-al.albumId) ? '取消收藏' : '收藏专辑',
      iconName: 'favorite',
      handlerFunction: () => {
        const rawId = -al.albumId;
        const isCollected = collectedIds.has(rawId);
        ncmApi.collectAlbum(rawId, !isCollected)
          .then(() => {
            NcmRepository.invalidateAlbumSublist();
            NcmRepository.userAlbumSublist().then((albs) => {
              setCollectedIds(new Set(albs.map((a) => -a.albumId)));
            }).catch(() => {});
          })
          .catch(() => {});
      },
    }] : [],
  } as Album)), [albums, isLoggedIn, collectedIds]);

  return (
    <SecondaryContainer ref={gridRef} className="appear-from-bottom h-full w-full flex-col p-8">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span>专辑广场</span>
      </div>

      <div className="mb-6 flex gap-2">
        {AREAS.map((a) => (
          <button
            key={a.key}
            onClick={() => setArea(a.key)}
            className={`cursor-pointer rounded-full px-4 py-1.5 text-sm transition-colors ${
              area === a.key
                ? 'bg-font-color-highlight text-white dark:bg-dark-font-color-highlight dark:text-font-color-black'
                : 'bg-background-color-2/50 text-font-color-black dark:bg-dark-background-color-2/50 dark:text-font-color-white hover:bg-background-color-3'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center text-sm text-gray-400">加载中...</div>
      ) : (
        <ResponsiveGrid columns={columns}>
          {albumItems.map((item, i) => (
            <Album
              key={item.albumId}
              index={i}
              source="netease"
              linkTo={`/main-player/albums/${-albums[i].albumId}`}
              isSubscribed={collectedIds.has(-albums[i].albumId)}
              onToggleSubscribe={(e) => handleToggleCollect(e, albums[i])}
              onPlay={() => {
                NcmRepository.albumDetail(-albums[i].albumId).then((detail) => {
                  if (detail?.tracks?.length) PlaybackBridge.playSongs(detail.tracks, 0, 'ncmAlbum');
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
