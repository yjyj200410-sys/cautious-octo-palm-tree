import { SpecialPlaylists } from '@common/playlists.enum';
import PlaylistPage from '@renderer/components/PlaylistPage';
import { songFilterOptions, songSortOptions } from '@renderer/components/SongsPage/SongOptions';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import { queryClient } from '@renderer/index';
import { playlistQuery } from '@renderer/queries/playlists';
import { songQuery } from '@renderer/queries/songs';
import { store } from '@renderer/store/store';
import { songSearchSchema } from '@renderer/utils/zod/songSchema';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { lazy, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NcmRepository } from '@renderer/ncm/repository';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import { proxyCoverUrl } from '@renderer/ncm';
import { FavoriteService } from '@renderer/utils/unifiedStorage';
import { NeteaseSyncService } from '@renderer/ncm/NeteaseSyncService';
import { useNcmPlaylistActions } from '@renderer/ncm/useNcmPlaylistActions';
import type { NcmSong } from '@renderer/ncm/types';

const SensitiveActionConfirmPrompt = lazy(
  () => import('@renderer/components/SensitiveActionConfirmPrompt')
);

function ncmToSongData(song: NcmSong): SongData {
  return {
    songId: song.songId, title: song.title,
    duration: Math.round(song.duration / 1000),
    artists: song.artists,
    album: song.album ?? { name: '', albumId: 0 },
    path: '',
    artworkPaths: {
      isDefaultArtwork: !song.coverUrl,
      artworkPath: proxyCoverUrl(song.coverUrl),
      optimizedArtworkPath: proxyCoverUrl(song.coverUrl),
    },
    isAFavorite: FavoriteService.isFavorite({ source: 'netease', sourceId: String(song.ncmId) }),
    isBlacklisted: false,
    isArtworkAvailable: !!song.coverUrl, addedDate: 0,
  };
}

export const Route = createFileRoute('/main-player/playlists/$playlistId')({
  validateSearch: songSearchSchema,
  component: PlaylistInfoPage,
  loader: async ({ params }) => {
    const id = Number(params.playlistId);
    // 负数或超大 ID（超出 int32 范围）都是 NCM 歌单，不查本地 DB
    if (id >= 0 && id <= 2147483647) {
      await queryClient.ensureQueryData(playlistQuery.single({ playlistId: id }));
    }
  }
});

function PlaylistInfoPage() {
  const { playlistId } = Route.useParams({
    select: (params) => ({ playlistId: Number(params.playlistId) })
  });
  const ABS_MAX_INT32 = 2147483647;
  const isNcm = playlistId < 0 || playlistId > ABS_MAX_INT32;
  const ncmSourceId = isNcm ? Math.abs(playlistId) : 0;
  const { scrollTopOffset } = Route.useSearch();

  const playlistSortingState = useStore(
    store,
    (state) => state.localStorage.sortingStates.songsPage
  );
  const { sortingOrder = playlistSortingState ?? 'addedOrder', filteringOrder = 'notSelected' } = Route.useSearch();
  const navigate = useNavigate({ from: '/main-player/playlists/$playlistId' });
  const { updateQueueData, changePromptMenuData, addNewNotifications, createQueue } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  // ── Local playlist data ──
  const { data: localPlaylist } = useQuery({
    ...playlistQuery.single({ playlistId }),
    select: (data) => data.data[0],
    enabled: !isNcm
  });
  const { data: localSongs = [] } = useQuery({
    ...songQuery.allSongInfo({
      songIds: localPlaylist?.songs ?? [],
      sortType: sortingOrder,
      filterType: filteringOrder
    }),
    enabled: !isNcm && Array.isArray(localPlaylist?.songs)
  });
  useEffect(() => {
    if (localPlaylist && localSongs.length > 0) {
      window.api.log.sendLogs(
        `[PLAYLIST_LOAD] playlistId=${playlistId} totalSongs=${localPlaylist.songs?.length ?? 0} loadedSongs=${localSongs.length}`
      );
    }
  }, [localPlaylist, localSongs, playlistId]);

  // ── NCM playlist data ──
  const [ncmDetail, setNcmDetail] = useState<{ name: string; coverUrl: string; tracks: NcmSong[]; trackCount: number; playlistId: number } | null>(null);
  useEffect(() => {
    if (!isNcm) return;
    NcmRepository.playlistDetail(ncmSourceId).then((detail) => {
      setNcmDetail({ name: detail.name, coverUrl: detail.coverUrl, tracks: detail.tracks, trackCount: detail.trackCount, playlistId: detail.playlistId });
    }).catch(() => {});
  }, [isNcm, ncmSourceId]);

  const ncmSongs = useMemo(() => ncmDetail?.tracks ?? [], [ncmDetail]);

  // 共享 NCM 歌单操作按钮
  const ncmActionsDetail = ncmDetail ? {
    playlistId: ncmDetail.playlistId,
    name: ncmDetail.name,
    songs: [] as { title: string; songId: number }[],
    createdDate: new Date(),
    isArtworkAvailable: !!ncmDetail.coverUrl,
    artworkPaths: { isDefaultArtwork: !ncmDetail.coverUrl, artworkPath: '', optimizedArtworkPath: '' },
    coverUrl: ncmDetail.coverUrl,
    tracks: ncmDetail.tracks,
    playCount: 0,
    creatorName: '',
    creatorId: 0, // $playlistId 路由的 detail 不包含 creatorId，设 0 表示「非自己歌单」→ 显示收藏按钮
    trackCount: ncmDetail.trackCount,
    description: '',
    copywriter: '',
  } as import('@renderer/ncm/types').NcmPlaylist : null;
  const { titleButtons: ncmActionButtons } = useNcmPlaylistActions({
    ncmPlaylistId: ncmSourceId,
    detail: ncmActionsDetail,
    addNotification: (content, icon = 'info') => {
      addNewNotifications([{ id: `ncm_${Date.now()}`, iconName: icon, content }]);
    },
    onRenameRequest: () => {
      import('@renderer/ncm/NcmRenamePrompt').then((mod) => {
        changePromptMenuData(true, <mod.default name={ncmDetail?.name || ''} playlistId={ncmSourceId} uid={0} onSuccess={() => { NcmRepository.playlistDetail(ncmSourceId).then((d) => { setNcmDetail({ name: d.name, coverUrl: d.coverUrl, tracks: d.tracks, trackCount: d.trackCount, playlistId: d.playlistId }); }).catch(() => {}); }} />);
      });
    },
    onDeleteRequest: () => {
      import('@renderer/components/SensitiveActionConfirmPrompt').then((mod) => {
        changePromptMenuData(true, <mod.default
          title="删除歌单"
          content={<p>确定要删除歌单「{ncmDetail?.name}」吗？</p>}
          confirmButton={{
            label: '删除',
            iconName: 'delete',
            clickHandler: () => {
              NeteaseSyncService.deletePlaylist(ncmSourceId, 0).then(() => {
                addNewNotifications([{ id: 'ncmDel', iconName: 'check_circle', content: '已删除' }]);
                window.history.back();
              }).catch((err) => addNewNotifications([{ id: 'ncmDelErr', iconName: 'error', content: String(err) }]));
            },
          }}
        />);
      });
    },
  });
  const ncmSongData: SongData[] = useMemo(() => ncmSongs.map(ncmToSongData), [ncmSongs]);
  const ncmIdMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const s of ncmSongs) map.set(s.songId, s.ncmId);
    return map;
  }, [ncmSongs]);

  // ── Unified playlist + songs ──
  const playlistData: Playlist | undefined = isNcm
    ? (ncmDetail ? {
        playlistId,
        name: ncmDetail.name,
        artworkPaths: { isDefaultArtwork: !ncmDetail.coverUrl, artworkPath: proxyCoverUrl(ncmDetail.coverUrl), optimizedArtworkPath: proxyCoverUrl(ncmDetail.coverUrl) },
        songs: ncmSongData.map((s) => s.songId),
        createdDate: new Date(),
        isArtworkAvailable: !!ncmDetail.coverUrl,
      } : undefined)
    : localPlaylist;
  const playlistSongs: SongData[] = isNcm ? ncmSongData : localSongs;

  const handleSongPlayBtnClick = useCallback(
    (currSongId: number) => {
      if (isNcm) {
        const idx = ncmSongs.findIndex((s) => s.songId === currSongId);
        if (idx < 0) return;
        // ★ O(1)：只建逻辑队列 + 经 PrefetchManager 解析当前曲 URL
        PlaybackBridge.playSongs(ncmSongs, idx, 'ncmPlaylist', playlistData?.playlistId ? String(playlistData.playlistId) : undefined);
        return;
      }
      const queueSongIds = playlistSongs
        .filter((song) => !song.isBlacklisted)
        .map((song) => song.songId);
      const targetIndex = queueSongIds.indexOf(currSongId);
      // Use updateQueueData to set both queue AND correct position in one step,
      // so "上一曲" / "下一曲" navigate correctly within the queue
      updateQueueData(
        targetIndex >= 0 ? targetIndex : 0,
        queueSongIds,
        false,  // isShuffleQueue
        true,   // playCurrentSongIndex
      );
    },
    [isNcm, ncmSongs, createQueue, updateQueueData, playlistData, playlistSongs]
  );

  const clearSongHistory = useCallback(() => {
    changePromptMenuData(
      true,
      <SensitiveActionConfirmPrompt
        title={t('settingsPage.confirmSongHistoryDeletion')}
        content={t('settingsPage.songHistoryDeletionDisclaimer')}
        confirmButton={{
          label: t('settingsPage.clearHistory'),
          clickHandler: () =>
            window.api.audioLibraryControls
              .clearSongHistory()
              .then(
                (res) =>
                  res.success &&
                  addNewNotifications([
                    { id: 'queueCleared', duration: 5000, content: t('settingsPage.songHistoryDeletionSuccess') }
                  ])
              )
              .catch((err) => console.error(err))
        }}
      />
    );
  }, [addNewNotifications, changePromptMenuData, t]);

  // ── NCM additional context menu (must be before any early return) ──
  const ncmAdditionalContextMenuItems = useCallback(
    (item: SongData): ContextMenuItem[] => {
      if (!isNcm || !ncmDetail) return [];
      const ncmId = ncmIdMap.get(item.songId);
      if (!ncmId) return [];
      return [{
        label: t('ncm.removeFromNcmPlaylist'),
        iconName: 'playlist_remove',
        handlerFunction: () => {
          NeteaseSyncService.removeSongsFromPlaylist(ncmDetail.playlistId, [ncmId])
            .then(() => {
              setNcmDetail((prev) => {
                if (!prev) return prev;
                const newTracks = prev.tracks.filter((s) => s.songId !== item.songId);
                return { ...prev, tracks: newTracks, trackCount: prev.trackCount - 1 };
              });
              addNewNotifications([{ id: 'ncmRemoveSongSuccess', duration: 5000, iconName: 'check_circle', content: t('ncm.removeFromNcmPlaylistSuccess') }]);
            })
            .catch((err) => { console.error(err); });
        },
      }];
    },
    [isNcm, ncmIdMap, ncmDetail, addNewNotifications, t]
  );

  if (!playlistData) return <div className="flex h-full items-center justify-center text-xl opacity-50">加载中...</div>;

  return (
    <PlaylistPage
      playlist={playlistData}
      songs={playlistSongs}
      scrollTopOffset={scrollTopOffset}
      onPlayClick={handleSongPlayBtnClick}
      buttons={isNcm ? [
        { label: '播放全部', iconName: 'play_arrow', clickHandler: () => { if (ncmSongs.length > 0) PlaybackBridge.playSongs(ncmSongs, 0, 'ncmPlaylist', playlistData?.playlistId ? String(playlistData.playlistId) : undefined); } },
        // 系统歌单（收藏/历史）不显示收藏/编辑按钮
        ...(SpecialPlaylists.isSpecialPlaylistId(playlistId) ? [] : ncmActionButtons),
      ] : [
        {
          label: t('settingsPage.clearHistory'),
          iconName: 'clear',
          clickHandler: clearSongHistory,
          isVisible: playlistData.playlistId === SpecialPlaylists.History,
          isDisabled: !(playlistData.songs && playlistData.songs.length > 0)
        },
        {
          label: t('common.playAll'),
          iconName: 'play_arrow',
          clickHandler: () =>
            createQueue(
              playlistSongs.filter((s) => !s.isBlacklisted).map((s) => s.songId),
              'songs', false, playlistData.playlistId, true
            ),
          isDisabled: !(playlistData.songs && playlistData.songs.length > 0)
        },
        {
          tooltipLabel: t('common.shuffleAndPlay'),
          iconName: 'shuffle',
          clickHandler: () =>
            createQueue(
              playlistSongs.filter((s) => !s.isBlacklisted).map((s) => s.songId),
              'playlist', true, playlistData.playlistId, true
            ),
          isDisabled: !(playlistData.songs && playlistData.songs.length > 0)
        },
        {
          tooltipLabel: t('common.addToQueue'),
          iconName: 'add',
          clickHandler: () => {
            const ids = playlistSongs.filter((s) => !s.isBlacklisted).map((s) => s.songId);
            const currentQueue = store.state.localStorage.queue;
            updateQueueData(undefined, [...(currentQueue?.songIds ?? []), ...ids]);
            addNewNotifications([
              { id: 'addedToQueue', duration: 5000, content: t('notifications.addedToQueue', { count: ids.length }) }
            ]);
          },
          isDisabled: !(playlistSongs && playlistSongs.length > 0)
        }
      ]}
      dropdowns={isNcm ? [] : [
        {
          name: 'songsPageFilterDropdown',
          type: `${t('common.filterBy')} :`,
          value: filteringOrder,
          options: songFilterOptions,
          onChange: (e) => {
            const order = e.currentTarget.value as SongFilterTypes;
            navigate({ search: (prev) => ({ ...prev, filteringOrder: order }) });
          }
        },
        {
          name: 'PlaylistPageSortDropdown',
          type: `${t('common.sortBy')} :`,
          value: sortingOrder,
          options: songSortOptions,
          onChange: (e) => {
            const order = e.currentTarget.value as SongSortTypes;
            navigate({ search: (prev) => ({ ...prev, sortingOrder: order }) });
          },
          isDisabled: !(playlistData.songs && playlistData.songs.length > 0)
        }
      ]}
      additionalContextMenuItems={isNcm ? ncmAdditionalContextMenuItems : (item) => [
        {
          label: t('playlistsPage.removeFromThisPlaylist'),
          iconName: 'playlist_remove',
          handlerFunction: () =>
            window.api.playlistsData
              .removeSongFromPlaylist(playlistData.playlistId, item.songId)
              .then(
                (res) =>
                  res.success &&
                  addNewNotifications([
                    {
                      id: `${item.songId}Removed`,
                      duration: 5000,
                      content: t('playlistsPage.removeSongFromPlaylistSuccess', {
                        title: item.title,
                        playlistName: playlistData.name
                      })
                    }
                  ])
              )
              .catch((err) => console.error(err))
        }
      ]}
    />
  );
}
