/** 根据你的喜好推荐 */

import { useEffect, useState } from 'react';
import { useStore } from '@tanstack/react-store';
import type { NcmSong } from '../types';
import { NcmHomeRepository } from './NcmHomeRepository';
import { proxyCoverUrl } from '../index';
import { FavoriteService } from '../../utils/unifiedStorage';
import { useNcmUser } from '../../contexts/NcmUserContext';
import { store } from '../../store/store';
import SecondaryContainer from '../../components/SecondaryContainer';
import Button from '../../components/Button';
import SongCard from '../../components/SongsPage/SongCard';
import ResponsiveGrid from '../../components/ResponsiveGrid';
import { PlaybackBridge } from '../playback/PlaybackBridge';

type Props = { columns: number };

export default function NcmRecommendSongsSection({ columns }: Props) {
  const { isLoggedIn } = useNcmUser();
  const isMultipleSelectionEnabled = useStore(store, (state) => state.multipleSelectionsData.isEnabled);
  const [songs, setSongs] = useState<NcmSong[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSongs = () => {
    if (!isLoggedIn) return;
    setLoading(true);
    NcmHomeRepository.getRecommendSongs()
      .then(setSongs)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!isLoggedIn) return;
    const cached = NcmHomeRepository.getCachedRecommendSongs();
    if (cached.length > 0) {
      setSongs(cached);
    } else {
      fetchSongs();
    }
  }, [isLoggedIn]);

  const handleRefresh = () => {
    setLoading(true);
    NcmHomeRepository.refreshRecommendSongs()
      .then(setSongs)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  if (!isLoggedIn) return null;
  if (songs.length === 0 && !loading) return null;

  const visibleCount = columns * 2;

  return (
    <SecondaryContainer className="recently-added-songs-container appear-from-bottom h-fit max-h-full w-full flex-col pb-8 pl-8 pr-8">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight my-4 flex items-center justify-between text-2xl font-medium">
        根据你的喜好推荐
        <div className="flex items-center gap-2">
          <Button
            label="播放全部"
            iconName="play_arrow"
            className="show-all-btn text-sm font-normal"
            clickHandler={() => songs.length > 0 && PlaybackBridge.playSongs(songs, 0)}
          />
          <Button
            label="换一批"
            iconName="refresh"
            className="show-all-btn text-sm font-normal"
            clickHandler={handleRefresh}
            isDisabled={loading}
          />
        </div>
      </div>
      <ResponsiveGrid columns={columns} className="grid-rows-2">
        {songs.slice(0, visibleCount).map((song, i) => (
          <div
            key={song.songId}
            style={{ display: 'contents' }}
            onMouseDownCapture={(e) => {
              if (e.button !== 0) return;
              if ((e.target as HTMLElement).closest('button')) return;
              if (isMultipleSelectionEnabled) return;
              e.stopPropagation();
              PlaybackBridge.playSongs(songs, i);
            }}
          >
            <SongCard
              index={i}
              songId={song.songId}
              title={song.title}
              artworkPath={proxyCoverUrl(song.coverUrl)}
              path=""
              artists={song.artists}
              album={song.album}
              isAFavorite={FavoriteService.isFavorite({ source: 'netease', sourceId: String(song.ncmId) })}
              isBlacklisted={false}
            />
          </div>
        ))}
      </ResponsiveGrid>
    </SecondaryContainer>
  );
}
