import PlaylistPage from '@renderer/components/PlaylistPage';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import { proxyCoverUrl } from '@renderer/ncm';
import type { NcmPlaylist, NcmSong } from '@renderer/ncm/types';
import { NcmRepository } from '@renderer/ncm/repository';
import { useNcmUser } from '@renderer/contexts/NcmUserContext';
import { FavoriteService } from '@renderer/utils/unifiedStorage';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const Route = createFileRoute('/main-player/playlists/favorites')({
  component: FavoritesPlaylistInfoPage,
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
    isAFavorite: FavoriteService.isFavorite({ source: 'netease', sourceId: String(song.ncmId) }),
    isBlacklisted: false,
    isArtworkAvailable: !!song.coverUrl, addedDate: 0,
  };
}

function FavoritesPlaylistInfoPage() {
  const { profile, isLoggedIn } = useNcmUser();
  const [detail, setDetail] = useState<NcmPlaylist | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isLoggedIn || !profile?.userId) return;
    // 先找到「我喜欢的音乐」歌单ID，再走标准 playlistDetail 流程
    NcmRepository.getUserPlaylists(profile.userId).then((playlists) => {
      const liked = playlists.find((pl) => pl.name === '我喜欢的音乐' || pl.name.includes('喜欢的音乐'));
      if (!liked) { setError('未找到收藏歌单'); return; }
      const absId = liked.playlistId > 0 ? liked.playlistId : -liked.playlistId;
      return NcmRepository.playlistDetail(absId);
    }).then((d) => {
      if (d) setDetail(d);
    }).catch((e) => {
      console.error('favorites load err', e);
      setError('加载失败');
    });
  }, [isLoggedIn, profile?.userId]);

  const songs: NcmSong[] = useMemo(() => detail?.tracks ?? [], [detail]);
  const songDataList: SongData[] = useMemo(() => songs.map(ncmToSongData), [songs]);

  const playlist: Playlist = useMemo(() => {
    const cover = proxyCoverUrl(detail?.coverUrl || '');
    return {
      playlistId: -1, name: '我喜欢的音乐',
      artworkPaths: { isDefaultArtwork: !cover, artworkPath: cover, optimizedArtworkPath: cover },
      songs: songDataList.map((s) => s.songId),
      createdDate: new Date(),
      isArtworkAvailable: !!cover,
    };
  }, [detail, songDataList]);

  const handlePlayClick = useCallback((_songId: number) => {
    const idx = songs.findIndex((s) => s.songId === _songId);
    if (idx < 0) return;
    // ★ O(1)：只建逻辑队列 + 经 PrefetchManager 解析当前曲 URL
    PlaybackBridge.playSongs(songs, idx, 'ncmPlaylist', 'favorites');
  }, [songs]);

  if (!isLoggedIn)
    return <div className="flex h-full items-center justify-center text-xl opacity-50">请先登录网易云</div>;
  if (error)
    return <div className="flex h-full items-center justify-center text-xl opacity-50">{error}</div>;
  if (!detail)
    return <div className="flex h-full items-center justify-center text-xl opacity-50">加载中...</div>;

  return (
    <PlaylistPage
      playlist={playlist}
      songs={songDataList}
      onPlayClick={handlePlayClick}
      buttons={[
        { label: '播放全部', iconName: 'play_arrow', clickHandler: () => PlaybackBridge.playSongs(songs, 0, 'ncmPlaylist', 'favorites') },
      ]}
    />
  );
}
