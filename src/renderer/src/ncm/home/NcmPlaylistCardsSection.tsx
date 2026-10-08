/** 推荐/雷达歌单 */

import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { NcmPlaylist } from '../types';
import { NcmHomeRepository } from './NcmHomeRepository';
import { useNcmUser, currentNcmUid } from '../../contexts/NcmUserContext';
import { NcmRepository } from '../repository';
import { NeteaseSyncService } from '../NeteaseSyncService';
import { PlaybackBridge } from '../playback/PlaybackBridge';
import { Playlist } from '../../components/PlaylistsPage/Playlist';
import SecondaryContainer from '../../components/SecondaryContainer';
import ResponsiveGrid from '../../components/ResponsiveGrid';
import { proxyCoverUrl } from '../index';
import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { setLibraryPanel } from '../../store/routeStateStore';

type Props = {
  title: string;
  type: 'recommend' | 'radar';
  columns: number;
};

export default function NcmPlaylistCardsSection({ title, type, columns }: Props) {
  const { isLoggedIn, profile } = useNcmUser();
  const uid = profile?.userId || currentNcmUid || 0;
  const { addNewNotifications } = useContext(AppUpdateContext);
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<NcmPlaylist[]>([]);
  const [subscribedIds, setSubscribedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!isLoggedIn) return;
    const fetcher = type === 'radar'
      ? NcmHomeRepository.getRadarPlaylists
      : NcmHomeRepository.getRecommendPlaylists;
    fetcher().then(setPlaylists).catch(() => {});
    // 加载已收藏的歌单 ID
    NcmRepository.getUserPlaylists(uid).then((pls) => {
      setSubscribedIds(new Set(pls.map((p) => -p.playlistId)));
    }).catch(() => {});
  }, [isLoggedIn, type, uid]);

  const handleToggleSubscribe = useCallback((e: React.MouseEvent, pl: NcmPlaylist) => {
    e.stopPropagation();
    const rawId = -pl.playlistId;
    const isSubbed = subscribedIds.has(rawId);
    const action = isSubbed
      ? NeteaseSyncService.unsubscribePlaylist(rawId, uid)
      : NeteaseSyncService.subscribePlaylist(rawId, uid);
    action.then(() => {
      setSubscribedIds((prev) => {
        const next = new Set(prev);
        isSubbed ? next.delete(rawId) : next.add(rawId);
        return next;
      });
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
          .then(() => {
            setSubscribedIds((prev) => { const next = new Set(prev); isSubbed ? next.delete(rawId) : next.add(rawId); return next; });
          })
          .catch(() => {});
      },
    }] : [],
  } as Playlist)), [playlists, isLoggedIn, uid, subscribedIds]);

  if (!isLoggedIn || playlists.length === 0) return null;

  return (
    <SecondaryContainer className="appear-from-bottom mt-8 h-fit max-h-full w-full flex-col pb-8 pl-8 pr-8">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span
          className="cursor-pointer hover:underline flex items-center gap-1"
          onClick={() => navigate({ to: '/main-player/ncm/discover/playlists' })}
          title="浏览歌单广场"
        >
          {title}
          <span className="material-icons-round text-xl opacity-60">chevron_right</span>
        </span>
      </div>
      <ResponsiveGrid columns={columns} className="grid-rows-2">
        {playlistItems.slice(0, columns * 2).map((item, i) => (
          <Playlist
            key={item.playlistId}
            index={i}
            source="netease"
            linkTo={`/main-player/ncm/playlist/${-playlists[i].playlistId}`}
            onNavigate={() =>
              // 阶段 4 性能(Task 4):随切换携带歌单名/封面 → LibraryPanel Header 秒显(不等详情接口)
              setLibraryPanel({
                kind: 'ncm',
                id: -playlists[i].playlistId,
                title: playlists[i].name,
                cover: proxyCoverUrl(playlists[i].coverUrl)
              })
            }
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
    </SecondaryContainer>
  );
}
