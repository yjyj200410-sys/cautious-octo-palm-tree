import { NcmRepository } from '@renderer/ncm/repository';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import type { NcmSong } from '@renderer/ncm/types';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store/store';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Img from '@renderer/components/Img';
import TitleContainer from '@renderer/components/TitleContainer';

type Props = { ncmId: number };

const NcmSimilarTracks = ({ ncmId }: Props) => {
  const [songs, setSongs] = useState<NcmSong[]>([]);
  const [loading, setLoading] = useState(true);
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);
  const { t } = useTranslation();

  useEffect(() => {
    let cancelled = false;
    NcmRepository.simiSong(ncmId).then((result) => {
      if (!cancelled) { setSongs(result); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [ncmId]);

  if (loading) return null;
  if (!songs.length) return null;

  return (
    <div className="w-full">
      <TitleContainer
        title={t('songInfoPage.similarTracksInLibrary')}
        titleClassName="text-xl! text-font-color-black font-normal! dark:text-font-color-white"
        className={`title-container ${
          bodyBackgroundImage ? 'text-font-color-white' : 'text-font-color-black dark:text-font-color-white'
        } !mt-8 mb-4`}
      />
      <div className="flex flex-wrap gap-2">
        {songs.slice(0, 12).map((song) => (
          <button
            key={song.ncmId}
            className="flex items-center gap-3 rounded-lg bg-background-color-2/60 dark:bg-dark-background-color-2/60 p-2.5 hover:bg-background-color-3/40 transition-colors text-left min-w-[240px]"
            onClick={() => PlaybackBridge.playSong(song)}
          >
            <Img
              src={song.coverUrl}
              className="h-12 w-12 rounded-md object-cover shrink-0"
              loading="lazy"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-font-color-black dark:text-font-color-white truncate">
                {song.title}
              </div>
              <div className="text-xs text-font-color-black/60 dark:text-font-color-white/50 truncate">
                {song.artists.map((a) => a.name).join(', ')}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default NcmSimilarTracks;
