import { useNavigate } from '@tanstack/react-router';
import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import DefaultSongCover from '../../assets/images/webp/song_cover_default.webp';
import useSelectAllHandler from '../../hooks/useSelectAllHandler';
import Button from '../Button';
import SecondaryContainer from '../SecondaryContainer';
import SongCard from '../SongsPage/SongCard';

type Props = { recentlyPlayedSongs: SongData[]; noOfVisibleSongs: number };

const RecentlyPlayedSongs = (props: Props) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { createQueue, playSong } = useContext(AppUpdateContext);

  const { recentlyPlayedSongs, noOfVisibleSongs = 3 } = props;
  const MAX_SONG_LIMIT = 15;

  const selectAllHandler = useSelectAllHandler(recentlyPlayedSongs, 'songs', 'songId');

  const allSongIds = useMemo(
    () => recentlyPlayedSongs.filter((s) => !s.isBlacklisted).map((s) => s.songId),
    [recentlyPlayedSongs]
  );

  const recentlyPlayedSongComponents = useMemo(
    () =>
      recentlyPlayedSongs
        .filter((_, i) => i < (noOfVisibleSongs || MAX_SONG_LIMIT))
        .map((song, index) => {
          return (
            <div
              key={song.songId}
              style={{ display: 'contents' }}
              onMouseDownCapture={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                createQueue(allSongIds, 'songs', false, undefined, false);
                playSong(song.songId, true);
              }}
            >
            <SongCard
              index={index}
              title={song.title}
              artworkPath={song.artworkPaths?.artworkPath || DefaultSongCover}
              path={song.path}
              songId={song.songId}
              artists={song.artists}
              album={song.album}
              palette={song.paletteData}
              isAFavorite={song.isAFavorite}
              isBlacklisted={song.isBlacklisted}
              selectAllHandler={selectAllHandler}
            />
            </div>
          );
        }),
    [noOfVisibleSongs, recentlyPlayedSongs, selectAllHandler, allSongIds, createQueue, playSong]
  );

  return (
    <>
      {recentlyPlayedSongComponents.length > 0 && (
        <SecondaryContainer
          className="recently-played-songs-container appear-from-bottom flex h-fit max-h-full flex-col pb-8 pl-8 pr-8"
          focusable
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'a') {
              e.stopPropagation();
              selectAllHandler();
            }
          }}
        >
          <>
            <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center justify-between text-2xl font-medium">
              {t('homePage.recentlyPlayedSongs')}

              <div className="flex items-center gap-2">
                <Button
                  label={t('common.playAll')}
                  iconName="play_arrow"
                  className="show-all-btn text-sm font-normal"
                  clickHandler={() =>
                    createQueue(
                      recentlyPlayedSongs.filter((s) => !s.isBlacklisted).map((s) => s.songId),
                      'songs', false, undefined, true
                    )
                  }
                />
                <Button
                  label={t('common.showAll')}
                  tooltipLabel={t('homePage.openPlaybackHistory')}
                  iconName="apps"
                  className="show-all-btn text-sm font-normal"
                  clickHandler={() =>
                    navigate({
                      to: '/main-player/playlists/history'
                    })
                  }
                />
              </div>
            </div>
            <div
              style={{
                gridTemplateColumns: `repeat(${noOfVisibleSongs},1fr)`
              }}
              className="songs-container grid gap-2 pr-2"
            >
              {recentlyPlayedSongComponents}
            </div>
          </>
        </SecondaryContainer>
      )}
    </>
  );
};

export default RecentlyPlayedSongs;
