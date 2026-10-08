import { Album } from '@renderer/components/AlbumsPage/Album';
import DuplicateArtistsSuggestion from '@renderer/components/ArtistInfoPage/DuplicateArtistsSuggestion';
import SeparateArtistsSuggestion from '@renderer/components/ArtistInfoPage/SeparateArtistsSuggestion';
import SimilarArtistsContainer from '@renderer/components/ArtistInfoPage/SimilarArtistsContainer';
import Biography from '@renderer/components/Biography/Biography';
import Button from '@renderer/components/Button';
import Img from '@renderer/components/Img';
import MainContainer from '@renderer/components/MainContainer';
import Song from '@renderer/components/SongsPage/Song';
import { songSortOptions } from '@renderer/components/SongsPage/SongOptions';
import TitleContainer from '@renderer/components/TitleContainer';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import useResizeObserver from '@renderer/hooks/useResizeObserver';
import useSelectAllHandler from '@renderer/hooks/useSelectAllHandler';
import { queryClient } from '@renderer/index';
import { albumQuery } from '@renderer/queries/albums';
import { artistQuery } from '@renderer/queries/aritsts';
import { songQuery } from '@renderer/queries/songs';
import { store } from '@renderer/store/store';
import { useSuspenseQuery, useMutation, useQuery } from '@tanstack/react-query';
import { NcmRepository } from '@renderer/ncm/repository';
import { proxyCoverUrl } from '@renderer/ncm';
import { createFileRoute } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/main-player/artists/$artistId')({
  component: ArtistInfoPage,
  loader: async (route) => {
    const artistId = Number(route.params.artistId);

    if (artistId > 0) {
      await queryClient.ensureQueryData(artistQuery.single({ artistId })).catch(() => {});
    }
  }
});

function ArtistInfoPage() {
  const { artistId } = Route.useParams({
    select: (params) => ({ artistId: Number(params.artistId) })
  });

  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const { createQueue, updateQueueData, updateContextMenuData, toggleMultipleSelections } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  const { data: artistData } = useSuspenseQuery(
    artistId > 0
      ? { ...artistQuery.single({ artistId }), select: (data) => data.data[0] ?? undefined }
      : { queryKey: ['ncm-artist-local', artistId], queryFn: () => ({ data: [] }) }
  );
  const [isAllAlbumsVisible, setIsAllAlbumsVisible] = useState(false);
  const [isAllSongsVisible, setIsAllSongsVisible] = useState(false);
  const [sortingOrder, setSortingOrder] = useState<SongSortTypes>('aToZ');

  const songsContainerRef = useRef(null);
  const { width } = useResizeObserver(songsContainerRef);

  const CONTAINER_PADDING = 30;
  const relevantWidth = useMemo(() => width - CONTAINER_PADDING, [width]);

  const noOfVisibleAlbums = useMemo(() => Math.floor(relevantWidth / 250) || 4, [relevantWidth]);

  const { data: onlineArtistInfo } = useQuery({
    ...artistQuery.fetchOnlineInfo({ artistId }),
    enabled: artistId > 0,
  });

  // NCM 歌手数据
  const { data: ncmArtistData } = useQuery({
    queryKey: ['ncm-artist', artistId],
    queryFn: async () => {
      const data = await NcmRepository.artistDetail(-artistId);
      return data;
    },
    enabled: artistId < 0,
  });

  const ncmSongIds = ncmArtistData?.songs?.map((s) => s.songId) || [];
  const allSongIds = [
    ...(artistData?.songs?.map((song) => song.songId) || []),
    ...ncmSongIds,
  ];
  const { data: songs = [] } = useQuery({
    ...songQuery.allSongInfo({
      songIds: allSongIds,
      sortType: sortingOrder,
      filterType: 'notSelected'
    }),
    enabled: allSongIds.length > 0,
  });

  const { data: albums = [] } = useQuery({
    ...albumQuery.all({ albumIds: artistData?.albums?.map((album) => album.albumId) || [] }),
    enabled: !!artistData?.albums && artistData.albums.length > 0,
    select: (data) => data.data
  });

  // 合并 NCM 歌手数据
  const displayName = artistData?.name || ncmArtistData?.artist?.name || t('common.unknownArtist');
  const displayAvatar = ncmArtistData?.artist?.coverUrl
    ? proxyCoverUrl(ncmArtistData.artist.coverUrl)
    : (artistData?.onlineArtworkPaths?.picture_medium || artistData?.artworkPaths?.artworkPath);
  const displaySongsCount = artistData?.songs?.length || ncmArtistData?.songs?.length || 0;
  const displayBriefDesc = ncmArtistData?.artist?.briefDesc;

  // const fetchSongsData = useCallback(() => {
  //   if (artistData?.songs && artistData.songs.length > 0) {
  //     window.api.audioLibraryControls
  //       .getSongInfo(
  //         artistData.songs.map((song) => song.songId),
  //         sortingOrder
  //       )
  //       .then((songsData) => {
  //         if (songsData && songsData.length > 0) setSongs(songsData);
  //         return undefined;
  //       })
  //       .catch((err) => console.error(err));
  //   }
  //   return setSongs([]);
  // }, [artistData?.songs, sortingOrder]);

  // const fetchAlbumsData = useCallback(() => {
  //   if (artistData?.albums && artistData.albums.length > 0) {
  //     window.api.albumsData
  //       .getAlbumData(artistData.albums.map((album) => album.albumId))
  //       .then((res) => {
  //         if (res && res.length > 0) setAlbums(res);
  //         return undefined;
  //       })
  //       .catch((err) => console.error(err));
  //   }
  //   return setAlbums([]);
  // }, [artistData?.albums]);

  // useEffect(() => {
  //   fetchArtistsData();
  //   const manageArtistDataUpdatesInArtistInfoPage = (e: Event) => {
  //     const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
  //     if ('detail' in e) {
  //       for (let i = 0; i < dataEvents.length; i += 1) {
  //         const event = dataEvents[i];
  //         if (event.dataType === 'artists') fetchArtistsData();
  //       }
  //     }
  //   };
  //   document.addEventListener('app/dataUpdates', manageArtistDataUpdatesInArtistInfoPage);
  //   return () => {
  //     document.removeEventListener('app/dataUpdates', manageArtistDataUpdatesInArtistInfoPage);
  //   };
  // }, [fetchArtistsData]);

  // useEffect(() => {
  //   fetchArtistArtworks();
  //   const manageArtistArtworkUpdatesInArtistInfoPage = (e: Event) => {
  //     const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
  //     if ('detail' in e) {
  //       for (let i = 0; i < dataEvents.length; i += 1) {
  //         const event = dataEvents[i];
  //         if (event.dataType === 'artists/artworks') fetchArtistArtworks();
  //       }
  //     }
  //   };
  //   document.addEventListener('app/dataUpdates', manageArtistArtworkUpdatesInArtistInfoPage);
  //   return () => {
  //     document.removeEventListener('app/dataUpdates', manageArtistArtworkUpdatesInArtistInfoPage);
  //   };
  // }, [fetchArtistArtworks]);

  // useEffect(() => {
  //   fetchSongsData();
  //   const manageSongDataUpdatesInArtistInfoPage = (e: Event) => {
  //     const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
  //     if ('detail' in e) {
  //       for (let i = 0; i < dataEvents.length; i += 1) {
  //         const event = dataEvents[i];
  //         if (
  //           event.dataType === 'songs/deletedSong' ||
  //           event.dataType === 'songs/newSong' ||
  //           event.dataType === 'blacklist/songBlacklist' ||
  //           (event.dataType === 'songs/likes' && event.eventData.length > 1)
  //         )
  //           fetchSongsData();
  //       }
  //     }
  //   };
  //   document.addEventListener('app/dataUpdates', manageSongDataUpdatesInArtistInfoPage);
  //   return () => {
  //     document.removeEventListener('app/dataUpdates', manageSongDataUpdatesInArtistInfoPage);
  //   };
  // }, [fetchSongsData]);

  // useEffect(() => {
  //   fetchAlbumsData();
  //   const manageAlbumDataUpdatesInArtistInfoPage = (e: Event) => {
  //     const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
  //     if ('detail' in e) {
  //       for (let i = 0; i < dataEvents.length; i += 1) {
  //         const event = dataEvents[i];
  //         if (event.dataType === 'albums/newAlbum') fetchAlbumsData();
  //         if (event.dataType === 'albums/deletedAlbum') fetchAlbumsData();
  //       }
  //     }
  //   };
  //   document.addEventListener('app/dataUpdates', manageAlbumDataUpdatesInArtistInfoPage);
  //   return () => {
  //     document.removeEventListener('app/dataUpdates', manageAlbumDataUpdatesInArtistInfoPage);
  //   };
  // }, [fetchAlbumsData]);

  const { mutate: toggleLike } = useMutation({
    mutationFn: () =>
      window.api.artistsData.toggleLikeArtists([artistData.artistId], !artistData.isAFavorite),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: artistQuery._def });
    }
  });

  const selectAllHandlerForAlbums = useSelectAllHandler(albums, 'album', 'albumId');

  const albumComponents = useMemo(
    () =>
      albums
        .filter((_, i) => (isAllAlbumsVisible ? true : i < noOfVisibleAlbums))
        .map((album, index) => {
          return (
            <Album
              index={index}
              key={album.albumId}
              albumId={album.albumId}
              artists={album.artists}
              artworkPaths={album.artworkPaths}
              songs={album.songs}
              title={album.title}
              year={album.year}
              className={bodyBackgroundImage ? '[&_:not(.icon)]:text-font-color-white!' : ''}
              selectAllHandler={selectAllHandlerForAlbums}
            />
          );
        }),
    [albums, bodyBackgroundImage, isAllAlbumsVisible, noOfVisibleAlbums, selectAllHandlerForAlbums]
  );

  const selectAllHandlerForSongs = useSelectAllHandler(songs, 'songs', 'songId');

  const handleSongPlayBtnClick = useCallback(
    (currSongId: number) => {
      const queueSongIds = songs.filter((song) => !song.isBlacklisted).map((song) => song.songId);
      const targetIndex = queueSongIds.indexOf(currSongId);
      updateQueueData(
        targetIndex >= 0 ? targetIndex : 0,
        queueSongIds,
        false,
        true,
      );
    },
    [artistData?.artistId, createQueue, updateQueueData, songs]
  );

  const songComponenets = useMemo(
    () =>
      songs
        .filter((_, i) => (isAllSongsVisible ? true : i < 5))
        .map((song, index) => {
          return (
            <Song
              key={song.songId}
              index={index}
              isIndexingSongs={preferences?.isSongIndexingEnabled}
              title={song.title}
              artists={song.artists}
              album={song.album}
              duration={song.duration}
              songId={song.songId}
              artworkPaths={song.artworkPaths}
              path={song.path}
              isAFavorite={song.isAFavorite}
              year={song.year}
              isBlacklisted={song.isBlacklisted}
              selectAllHandler={selectAllHandlerForSongs}
              onPlayClick={handleSongPlayBtnClick}
            />
          );
        }),
    [
      handleSongPlayBtnClick,
      isAllSongsVisible,
      preferences?.isSongIndexingEnabled,
      selectAllHandlerForSongs,
      songs
    ]
  );

  return (
    <MainContainer
      className="artist-info-page-container appear-from-bottom relative overflow-y-auto rounded-tl-lg pt-8 pr-2 pb-2 pl-2 [scrollbar-gutter:stable]"
      ref={songsContainerRef}
    >
      <div className="artist-img-and-info-container relative mb-12 flex flex-row items-center pl-8 *:z-10">
        <div className="artist-img-container relative mr-10 flex max-h-60 items-center justify-center lg:hidden">
          <Img
            src={displayAvatar}
            fallbackSrc={artistData?.artworkPaths?.artworkPath}
            className="aspect-square! h-60 w-60 rounded-full object-cover"
            loading="eager"
            alt="Album Cover"
            onContextMenu={(e) =>
              (artistData?.onlineArtworkPaths?.picture_xl ||
                artistData?.onlineArtworkPaths?.picture_medium) &&
              updateContextMenuData(
                true,
                [
                  {
                    label: t('common.saveArtwork'),
                    class: 'save',
                    iconName: 'image',
                    iconClassName: 'material-icons-round-outlined',
                    handlerFunction: () => {
                      const artworkPath =
                        artistData?.onlineArtworkPaths?.picture_xl ||
                        artistData?.onlineArtworkPaths?.picture_medium;

                      if (artworkPath)
                        window.api.songUpdates.saveArtworkToSystem(artworkPath, artistData.name);
                    }
                  }
                ],
                e.pageX,
                e.pageY
              )
            }
          />
          <Button
            className="bg-background-color-1 text-font-color-highlight hover:bg-background-color-1 dark:bg-dark-background-color-2 dark:hover:bg-dark-background-color-2 absolute -bottom-5 m-0! flex rounded-full border-0! p-3! shadow-xl -outline-offset-[6px] focus-visible:outline!"
            tooltipLabel={t(
              `artistInfoPage.${artistData?.isAFavorite ? `dislikeArtist` : `likeArtist`}`,
              {
                name: artistData?.name
              }
            )}
            iconName="favorite"
            iconClassName={`text-4xl! leading-none! ${
              artistData?.isAFavorite
                ? 'material-icons-round'
                : 'material-icons-round material-icons-round-outlined'
            }`}
            clickHandler={() => {
              if (artistData) toggleLike();
            }}
          />
        </div>
        <div
          className={`artist-info-container relative ${
            bodyBackgroundImage
              ? 'text-font-color-white'
              : 'text-font-color-black dark:text-font-color-white'
          } *:z-10`}
        >
          <div
            className="artist-name text-font-color-highlight dark:text-dark-font-color-highlight mb-2 text-5xl"
            // style={
            //   fontColor
            //     ? {
            //         color: fontColor
            //       }
            //     : undefined
            // }
          >
            {displayName}
          </div>
          {artistData?.songs && (
            <div className="artist-no-of-songs">
              {t('common.albumWithCount', {
                count: artistData?.albums?.length || 0
              })}{' '}
              &bull; {t('common.songWithCount', { count: displaySongsCount })}
            </div>
          )}
        </div>
      </div>

      {artistData && (
        <>
          <SeparateArtistsSuggestion name={displayName} artistId={artistData.artistId} />

          <DuplicateArtistsSuggestion name={displayName} artistId={artistData.artistId} />
        </>
      )}

      {displayBriefDesc && (
        <div className="mx-8 mb-8 max-w-3xl rounded-xl bg-background-color-2/60 dark:bg-dark-background-color-2/60 p-4">
          <h3 className="mb-2 text-lg font-medium text-font-color-highlight dark:text-dark-font-color-highlight">简介</h3>
          <p className="text-sm text-font-color-black/70 dark:text-font-color-white/70 leading-relaxed whitespace-pre-line">{displayBriefDesc}</p>
        </div>
      )}

      {albums && albums.length > 0 && (
        <MainContainer
          className="main-container albums-list-container relative *:z-10"
          focusable
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'a') {
              e.stopPropagation();
              selectAllHandlerForAlbums();
            }
          }}
        >
          <>
            <TitleContainer
              key="appearsInAlbums"
              title={t('artistInfoPage.appearsInAlbums')}
              titleClassName="text-2xl! text-font-color-black dark:text-font-color-white"
              className={`title-container ${
                bodyBackgroundImage
                  ? 'text-font-color-white'
                  : 'text-font-color-black dark:text-font-color-white'
              } mt-1 mb-4 text-2xl`}
              otherItems={[
                isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'album' ? (
                  <p className="text-font-color-highlight dark:text-dark-font-color-highlight text-sm">
                    {t('common.selectionWithCount', {
                      count: multipleSelectionsData.multipleSelections.length
                    })}
                  </p>
                ) : (
                  <p className="text-font-color-highlight dark:text-dark-font-color-highlight text-sm">
                    {t('common.albumWithCount', { count: albums.length })}{' '}
                    {albums.length > noOfVisibleAlbums &&
                      !isAllAlbumsVisible &&
                      `(${t('common.shownWithCount', {
                        count: noOfVisibleAlbums || 0
                      })})`}
                  </p>
                )
              ]}
              buttons={[
                {
                  label: t('common.showAll'),
                  iconName: 'apps',
                  className: 'show-all-btn text-sm font-normal',
                  clickHandler: () => setIsAllAlbumsVisible(true),
                  isVisible: albums.length > noOfVisibleAlbums && !isAllAlbumsVisible
                }
              ]}
            />
            <div className="albums-container flex flex-wrap overflow-x-hidden">
              {albumComponents}
            </div>
          </>
        </MainContainer>
      )}
      {songs && songs.length > 0 && (
        <MainContainer
          className="main-container songs-list-container relative h-full pb-4 *:z-10"
          focusable
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'a') {
              e.stopPropagation();
              selectAllHandlerForSongs();
            }
          }}
        >
          <>
            <TitleContainer
              key="appearsInSongs"
              title={t('artistInfoPage.appearsInSongs')}
              titleClassName="text-2xl! text-font-color-black dark:text-font-color-white"
              className={`title-container ${
                bodyBackgroundImage
                  ? 'text-font-color-white'
                  : 'text-font-color-black dark:text-font-color-white'
              } mt-1 mb-4 pr-4 text-2xl`}
              otherItems={[
                <p className="text-font-color-highlight dark:text-dark-font-color-highlight text-sm">
                  {isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs'
                    ? t('common.selectionWithCount', {
                        count: multipleSelectionsData.multipleSelections.length
                      })
                    : `${t('common.songWithCount', { count: songs.length })} ${
                        songs.length > 5 && !isAllSongsVisible
                          ? `(${t('common.shownWithCount', { count: 5 })})`
                          : ''
                      }`}
                </p>
              ]}
              buttons={[
                {
                  tooltipLabel: t('common.moreOptions'),
                  className:
                    'more-options-btn text-sm md:text-lg md:[&>.button-label-text]:hidden md:[&>.icon]:mr-0 bg-background-color-1/40! dark:bg-dark-background-color-1/40!',
                  iconName: 'more_horiz',
                  clickHandler: (e) => {
                    e.stopPropagation();
                    const button = e.currentTarget;
                    const { x, y } = button.getBoundingClientRect();
                    updateContextMenuData(
                      true,
                      [
                        {
                          label: t('common.shuffleAndPlay'),
                          iconName: 'shuffle',
                          handlerFunction: () =>
                            createQueue(
                              songs
                                .filter((song) => !song.isBlacklisted)
                                .map((song) => song.songId),
                              'songs',
                              true,
                              undefined,
                              true
                            )
                        },
                        {
                          label: t('common.playAll'),
                          iconName: 'play_arrow',
                          handlerFunction: () =>
                            createQueue(
                              songs
                                .filter((song) => !song.isBlacklisted)
                                .map((song) => song.songId),
                              'songs',
                              false,
                              undefined,
                              true
                            )
                        },
                        {
                          iconName: isMultipleSelectionEnabled ? 'remove_done' : 'checklist',
                          handlerFunction: () =>
                            toggleMultipleSelections(!isMultipleSelectionEnabled, 'songs'),
                          label: t(
                            `common.${isMultipleSelectionEnabled ? 'unselectAll' : 'select'}`
                          )
                        }
                      ],
                      x + 10,
                      y + 50
                    );
                  }
                },
                {
                  label: t('common.showAll'),
                  iconName: 'apps',
                  className:
                    'show-all-btn text-sm font-normal bg-background-color-1/40! dark:bg-dark-background-color-1/40!',
                  clickHandler: () => setIsAllSongsVisible(true),
                  isVisible: songs.length > 5 && !isAllSongsVisible
                }
              ]}
              dropdowns={[
                {
                  name: 'ArtistInfoPageSongsSortDropdown',
                  value: sortingOrder,
                  options: songSortOptions,
                  onChange: (e) => setSortingOrder(e.currentTarget.value as SongSortTypes)
                }
              ]}
            />
            <div className="songs-container">{songComponenets}</div>
          </>
        </MainContainer>
      )}

      {onlineArtistInfo?.similarArtists && (
        <SimilarArtistsContainer similarArtists={onlineArtistInfo.similarArtists} />
      )}

      {onlineArtistInfo?.artistBio && (
        <Biography
          bioUserName={artistData.name}
          bio={onlineArtistInfo?.artistBio}
          tags={onlineArtistInfo.tags}
          hyperlinkData={{
            labelTitle: t('common.readMoreAboutTitle', {
              title: artistData.name
            })
          }}
        />
      )}
    </MainContainer>
  );
}
