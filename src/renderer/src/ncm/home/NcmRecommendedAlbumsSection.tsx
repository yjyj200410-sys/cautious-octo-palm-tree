/** 首页 — 推荐专辑板块 */
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { NcmRepository, proxyCoverUrl } from '../index';
import { ncmApi } from '../../api/ncm-client';
import { PlaybackBridge } from '../playback/PlaybackBridge';
import type { NcmAlbum } from '../types';
import { Album } from '../../components/AlbumsPage/Album';
import SecondaryContainer from '../../components/SecondaryContainer';
import ResponsiveGrid from '../../components/ResponsiveGrid';
import { useNcmUser } from '../../contexts/NcmUserContext';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';

export default function NcmRecommendedAlbumsSection({ columns }: { columns: number }) {
  const { isLoggedIn } = useNcmUser();
  const { addNewNotifications } = useContext(AppUpdateContext);
  const [albums, setAlbums] = useState<NcmAlbum[]>([]);
  const [collectedIds, setCollectedIds] = useState<Set<number>>(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoggedIn) return;
    NcmRepository.newestAlbums().then(setAlbums).catch(() => {});
    NcmRepository.userAlbumSublist().then((albs) => {
      setCollectedIds(new Set(albs.map((a) => -a.albumId)));
    }).catch(() => {});
  }, [isLoggedIn]);

  const handleToggleCollect = useCallback((e: React.MouseEvent, al: NcmAlbum) => {
    e.stopPropagation();
    const rawId = -al.albumId;
    const isCollected = collectedIds.has(rawId);
    ncmApi.collectAlbum(rawId, !isCollected)
      .then(() => {
        setCollectedIds((prev) => { const n = new Set(prev); isCollected ? n.delete(rawId) : n.add(rawId); return n; });
        addNewNotifications([{ id: 'ncmAlbumSub', iconName: 'favorite', content: isCollected ? `已取消收藏「${al.title}」` : `已收藏「${al.title}」` }]);
      })
      .catch((err) => addNewNotifications([{ id: 'ncmAlbumErr', iconName: 'error', content: String(err) }]));
  }, [addNewNotifications, collectedIds]);

  const albumItems = useMemo(() => albums.map((al) => ({
    albumId: al.albumId,
    title: al.title,
    artists: al.artists,
    year: al.year,
    songs: Array.from({ length: al.trackCount || 0 }, (_, i) => i),
    artworkPaths: {
      isDefaultArtwork: !al.coverUrl,
      artworkPath: proxyCoverUrl(al.coverUrl),
      optimizedArtworkPath: proxyCoverUrl(al.coverUrl),
    },
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
            setCollectedIds((prev) => { const n = new Set(prev); isCollected ? n.delete(rawId) : n.add(rawId); return n; });
            addNewNotifications([{ id: 'ncmAlbumSub', iconName: 'favorite', content: isCollected ? `已取消收藏「${al.title}」` : `已收藏「${al.title}」` }]);
          })
          .catch((err) => addNewNotifications([{ id: 'ncmAlbumErr', iconName: 'error', content: String(err) }]));
      },
    }] : [],
  } as Album)), [albums, isLoggedIn, collectedIds]);

  if (!isLoggedIn || albums.length === 0) return null;

  return (
    <SecondaryContainer className="appear-from-bottom mt-8 h-fit max-h-full w-full flex-col pb-8 pl-8 pr-8">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span
          className="cursor-pointer hover:underline flex items-center gap-1"
          onClick={() => navigate({ to: '/main-player/ncm/discover/albums' })}
          title="浏览专辑广场"
        >
          推荐专辑
          <span className="material-icons-round text-xl opacity-60">chevron_right</span>
        </span>
      </div>
      <ResponsiveGrid columns={columns} className="grid-rows-2">
        {albumItems.slice(0, columns * 2).map((item, i) => (
          <Album
            key={item.albumId}
            index={i}
            source="netease"
            linkTo={`/main-player/albums/${-albums[i].albumId}`}
            isSubscribed={collectedIds.has(-albums[i].albumId)}
            onToggleSubscribe={(e) => handleToggleCollect(e, albums[i])}
            onPlay={() => {
              const rawId = -albums[i].albumId;
              NcmRepository.albumDetail(rawId).then((detail) => {
                if (detail?.tracks?.length) PlaybackBridge.playSongs(detail.tracks, 0, 'ncmAlbum');
              }).catch(() => {});
            }}
            {...item}
          />
        ))}
      </ResponsiveGrid>
    </SecondaryContainer>
  );
}
