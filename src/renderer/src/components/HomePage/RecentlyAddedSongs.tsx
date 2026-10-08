import { useNavigate } from '@tanstack/react-router';
import { type ForwardedRef, forwardRef, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import useSelectAllHandler from '../../hooks/useSelectAllHandler';
import Button from '../Button';
import SecondaryContainer from '../SecondaryContainer';
import SongCard from '../SongsPage/SongCard';

type Props = { latestSongs: AudioInfo[]; noOfVisibleSongs: number };

const RecentlyAddedSongs = forwardRef((props: Props, ref: ForwardedRef<HTMLDivElement>) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { createQueue, playSong } = useContext(AppUpdateContext);

  const { latestSongs, noOfVisibleSongs = 6 } = props;
  const MAX_SONG_LIMIT = 30;

  const selectAllHandler = useSelectAllHandler(latestSongs, 'songs', 'songId');

  const allSongIds = useMemo(
    () => latestSongs.filter((s) => s && !s.isBlacklisted).map((s) => (s as AudioInfo).songId),
    [latestSongs]
  );

  const latestSongComponents = useMemo(
    () =>
      latestSongs.length > 0 && latestSongs[0] !== null
        ? latestSongs
            .filter((_, i) => i < (noOfVisibleSongs || MAX_SONG_LIMIT))
            .map((song, index) => {
              const songData = song as AudioInfo;
              return (
                <div
                  key={songData.songId}
                  style={{ display: 'contents' }}
                  onMouseDownCapture={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    createQueue(allSongIds, 'songs', false, undefined, false);
                    playSong(songData.songId, true);
                  }}
                >
                <SongCard
                  index={index}
                  title={songData.title}
                  artworkPath={songData.artworkPaths?.artworkPath || DefaultSongCover}
                  path={songData.path}
                  songId={songData.songId}
                  artists={songData.artists}
                  album={songData.album}
                  palette={songData.paletteData}
                  isAFavorite={songData.isAFavorite}
                  isBlacklisted={songData.isBlacklisted}
                  selectAllHandler={selectAllHandler}
                />
                </div>
              );
            })
        : [],
    [latestSongs, noOfVisibleSongs, selectAllHandler, allSongIds, createQueue, playSong]
  );

  return (
    <SecondaryContainer
      className="recently-added-songs-container appear-from-bottom h-fit max-h-full w-full flex-col pb-8 pl-8 pr-8"
      focusable
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'a') {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
      ref={ref}
    >
      {latestSongs.length > 0 && latestSongs[0] !== null && (
        <>
          <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight my-4 flex items-center justify-between text-2xl font-medium">
            {t('homePage.recentlyAddedSongs')}
            <div className="flex items-center gap-2">
              <Button
                label={t('common.playAll')}
                iconName="play_arrow"
                className="show-all-btn text-sm font-normal"
                clickHandler={() =>
                  createQueue(
                    latestSongs.filter((s) => !s.isBlacklisted).map((s) => s.songId),
                    'songs', false, undefined, true
                  )
                }
              />
              <Button
                label={t('common.showAll')}
                tooltipLabel={t('homePage.openSongsWithNewestSortOption')}
                iconName="apps"
                className="show-all-btn text-sm font-normal"
                clickHandler={() =>
                  navigate({
                    to: '/main-player/songs'
                  })
                }
              />
            </div>
          </div>
          <div
            style={{
              gridTemplateColumns: `repeat(${Math.floor(noOfVisibleSongs / 2)},1fr)`
            }}
            className="songs-container grid max-w-full grid-rows-2 gap-2 pr-2"
          >
            {latestSongComponents}
          </div>
        </>
      )}
    </SecondaryContainer>
  );
});

RecentlyAddedSongs.displayName = 'RecentlyAddedSongs';
export default RecentlyAddedSongs;
