import PlaylistPage from '@renderer/components/PlaylistPage';
import { NcmHomeRepository } from '@renderer/ncm/home/NcmHomeRepository';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import { proxyCoverUrl } from '@renderer/ncm';
import type { NcmSong } from '@renderer/ncm/types';
import { FavoriteService } from '@renderer/utils/unifiedStorage';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

export const Route = createFileRoute('/main-player/ncm/daily')({
  component: DailySongsPage,
});

function ncmToSongData(song: NcmSong): SongData {
  return {
    songId: song.songId,
    title: song.title,
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
    isArtworkAvailable: !!song.coverUrl,
    addedDate: 0,
  };
}

const dailyPlaylist: Playlist = {
  playlistId: -1,
  name: '每日推荐',
  artworkPaths: { isDefaultArtwork: true, artworkPath: '', optimizedArtworkPath: '' },
  songs: [],
  createdDate: new Date(),
  isArtworkAvailable: false,
};

function DailySongsPage() {
  const [songs, setSongs] = useState<NcmSong[]>(NcmHomeRepository.getCachedDailySongs());

  useEffect(() => {
    NcmHomeRepository.getDailySongs().then(setSongs);
  }, []);

  const songDataList: SongData[] = useMemo(() => songs.map(ncmToSongData), [songs]);

  const handlePlayClick = useCallback((_songId: number) => {
    const idx = songs.findIndex((s) => s.songId === _songId);
    if (idx < 0) return;
    // ★ O(1)：只建逻辑队列 + 经 PrefetchManager 解析当前曲 URL
    PlaybackBridge.playSongs(songs, idx, 'ncmDaily', 'daily');
  }, [songs]);

  const playlistWithCover: Playlist = useMemo(() => {
    const cover = songs[0]?.coverUrl ? proxyCoverUrl(songs[0].coverUrl) : '';
    return {
      ...dailyPlaylist,
      songs: songDataList.map(s => s.songId),
      artworkPaths: { isDefaultArtwork: !cover, artworkPath: cover, optimizedArtworkPath: cover },
      isArtworkAvailable: !!cover,
    };
  }, [songDataList, songs]);

  return (
    <PlaylistPage
      playlist={playlistWithCover}
      songs={songDataList}
      onPlayClick={handlePlayClick}
      buttons={[
        {
          label: '播放全部',
          iconName: 'play_arrow',
          clickHandler: () => songs.length > 0 && PlaybackBridge.playSongs(songs, 0, 'ncmDaily', 'daily'),
        },
      ]}
    />
  );
}
