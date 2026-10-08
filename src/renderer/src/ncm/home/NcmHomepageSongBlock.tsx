/** 首页发现区块 — 动态标题（如"一曲一唱思华年"） */

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

export default function NcmHomepageSongBlock({ columns }: Props) {
  const { isLoggedIn } = useNcmUser();
  const isMultipleSelectionEnabled = useStore(store, (state) => state.multipleSelectionsData.isEnabled);
  const [title, setTitle] = useState('');
  const [songs, setSongs] = useState<NcmSong[]>([]);

  useEffect(() => {
    if (!isLoggedIn) return;
    NcmHomeRepository.getHomepageSongBlock()
      .then((block) => {
        if (block) {
          setTitle(block.title);
          setSongs(block.songs.slice(0, columns * 2));
        }
      })
      .catch(() => {});
  }, [isLoggedIn, columns]);

  if (!isLoggedIn || songs.length === 0) return null;

  return (
    <SecondaryContainer className="recently-added-songs-container appear-from-bottom h-fit max-h-full w-full flex-col pb-8 pl-8 pr-8">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight my-4 flex items-center justify-between text-2xl font-medium">
        {title}
        <Button
          label="播放全部"
          iconName="play_arrow"
          className="show-all-btn text-sm font-normal"
          clickHandler={() => songs.length > 0 && PlaybackBridge.playSongs(songs, 0)}
        />
      </div>
      <ResponsiveGrid columns={columns} className="grid-rows-2">
        {songs.map((song, i) => (
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
