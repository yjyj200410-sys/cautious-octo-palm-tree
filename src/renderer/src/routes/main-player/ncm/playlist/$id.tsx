import PlaylistPage from '@renderer/components/PlaylistPage';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import { proxyCoverUrl } from '@renderer/ncm';
import type { NcmPlaylist, NcmSong } from '@renderer/ncm/types';
import { FavoriteService } from '@renderer/utils/unifiedStorage';
import { NcmRepository } from '@renderer/ncm/repository';
import { NeteaseSyncService } from '@renderer/ncm/NeteaseSyncService';
import { useNcmPlaylistActions } from '@renderer/ncm/useNcmPlaylistActions';
import { useNcmUser, currentNcmUid } from '@renderer/contexts/NcmUserContext';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';

export const Route = createFileRoute('/main-player/ncm/playlist/$id')({
  component: NcmPlaylistPage,
});

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
    isAFavorite: FavoriteService.isFavorite({ source: 'netease', sourceId: String(song.ncmId) }), isBlacklisted: false,
    isArtworkAvailable: !!song.coverUrl, addedDate: 0,
  };
}

function NcmPlaylistPage() {
  const { id: idStr } = Route.useParams();
  const id = Number(idStr);
  const [detail, setDetail] = useState<NcmPlaylist | null>(null);
  const [error, setError] = useState('');
  const { addNewNotifications, changePromptMenuData } = useContext(AppUpdateContext);
  const { t } = useTranslation();
  const { profile } = useNcmUser();
  const uid = profile?.userId || currentNcmUid || 0;

  useEffect(() => {
    NcmRepository.playlistDetail(id).then(setDetail).catch((e) => { console.error('ncm playlist load err', e); setError('加载失败'); });
  }, [id]);

  const notify = useCallback((content: string, icon = 'info') => {
    addNewNotifications([{ id: `ncm_${Date.now()}`, iconName: icon, content }]);
  }, [addNewNotifications]);

  const handleRenameRequest = useCallback(() => {
    import('@renderer/ncm/NcmRenamePrompt').then((mod) => {
      const NcmRenamePrompt = mod.default;
      changePromptMenuData(true, <NcmRenamePrompt name={detail?.name || ''} playlistId={id} uid={uid} onSuccess={() => { NcmRepository.playlistDetail(id).then(setDetail).catch(() => {}); }} />);
    });
  }, [id, detail, changePromptMenuData]);

  const handleDeleteRequest = useCallback(() => {
    import('@renderer/components/SensitiveActionConfirmPrompt').then((mod) => {
      changePromptMenuData(true, <mod.default
        title="删除歌单"
        content={<p>确定要删除歌单「{detail?.name}」吗？</p>}
        confirmButton={{
          label: '删除',
          iconName: 'delete',
          clickHandler: (_e, _setDisabled, _setPending) => {
            NeteaseSyncService.deletePlaylist(id, uid).then(() => {
              addNewNotifications([{ id: 'ncmDel', iconName: 'check_circle', content: '已删除' }]);
              window.history.back();
            }).catch((err) => addNewNotifications([{ id: 'ncmDelErr', iconName: 'error', content: String(err) }]));
          },
        }}
      />);
    });
  }, [id, uid, detail, changePromptMenuData, addNewNotifications]);

  const { titleButtons: actionButtons } = useNcmPlaylistActions({
    ncmPlaylistId: id,
    detail,
    addNotification: notify,
    onRenameRequest: handleRenameRequest,
    onDeleteRequest: handleDeleteRequest,
  });

  const songs: NcmSong[] = useMemo(() => detail?.tracks ?? [], [detail]);
  const songDataList: SongData[] = useMemo(() => songs.map(ncmToSongData), [songs]);

  // Map: negative Nora songId → positive NCM songId
  const ncmIdMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const song of songs) {
      map.set(song.songId, song.ncmId);
    }
    return map;
  }, [songs]);

  const additionalContextMenuItems = useCallback(
    (item: SongData): ContextMenuItem[] => [
      {
        label: t('ncm.removeFromNcmPlaylist'),
        iconName: 'playlist_remove',
        handlerFunction: () => {
          const ncmId = ncmIdMap.get(item.songId);
          if (ncmId && detail) {
            NeteaseSyncService.removeSongsFromPlaylist(id, [ncmId])
              .then(() => {
                // Remove from local state immediately
                setDetail((prev) => {
                  if (!prev) return prev;
                  const newTracks = prev.tracks.filter((s) => s.songId !== item.songId);
                  const newSongs = prev.songs.filter((s) => s.songId !== item.songId);
                  return { ...prev, tracks: newTracks, songs: newSongs, trackCount: prev.trackCount - 1 };
                });
                addNewNotifications([
                  {
                    id: 'ncmRemoveSongSuccess',
                    duration: 5000,
                    iconName: 'check_circle',
                    content: t('ncm.removeFromNcmPlaylistSuccess'),
                  },
                ]);
              })
              .catch((err) => {
                console.error(err);
                addNewNotifications([
                  {
                    id: 'ncmRemoveSongError',
                    duration: 5000,
                    iconName: 'error',
                    content: t('ncm.removeFromNcmPlaylistError') || '移除失败',
                  },
                ]);
              });
          }
        },
      },
    ],
    [ncmIdMap, detail, addNewNotifications, t],
  );

  const playlist: Playlist = useMemo(() => {
    const cover = proxyCoverUrl(detail?.coverUrl || '');
    return {
      playlistId: -id, name: detail?.name ?? '',
      artworkPaths: { isDefaultArtwork: !cover, artworkPath: cover, optimizedArtworkPath: cover },
      songs: songDataList.map((s) => s.songId),
      createdDate: new Date(),
      isArtworkAvailable: !!cover,
    };
  }, [detail, songDataList, id]);

  const handlePlayClick = useCallback((_songId: number) => {
    const idx = songs.findIndex((s) => s.songId === _songId);
    if (idx < 0) return;
    // ★ O(1)：只建逻辑队列 + 经 PrefetchManager 解析当前曲 URL
    PlaybackBridge.playSongs(songs, idx, 'ncmPlaylist', String(id));
  }, [songs, id]);

  if (error) return <div className="flex h-full items-center justify-center text-xl opacity-50">{error}</div>;
  if (!detail) return <div className="flex h-full items-center justify-center text-xl opacity-50">加载中...</div>;

  return (
    <PlaylistPage
      playlist={playlist}
      songs={songDataList}
      onPlayClick={handlePlayClick}
      additionalContextMenuItems={additionalContextMenuItems}
      buttons={[
        { label: '播放全部', iconName: 'play_arrow', clickHandler: () => PlaybackBridge.playSongs(songs, 0, 'ncmPlaylist', String(id)) },
        ...actionButtons,
      ]}
    />
  );
}
