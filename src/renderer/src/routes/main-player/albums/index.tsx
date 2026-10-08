import NoAlbumsImage from '@assets/images/svg/Easter bunny_Monochromatic.svg';
import { Album } from '@renderer/components/AlbumsPage/Album';
import { albumSortOptions } from '@renderer/components/AlbumsPage/AlbumOptions';
import Button from '@renderer/components/Button';
import Dropdown from '@renderer/components/Dropdown';
import Img from '@renderer/components/Img';
import MainContainer from '@renderer/components/MainContainer';
import ResponsiveGrid from '@renderer/components/ResponsiveGrid';
import useResponsiveGrid, { PLAYLIST_CARD_MIN_WIDTH } from '@renderer/hooks/useResponsiveGrid';
import { useRef } from 'react';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import useSelectAllHandler from '@renderer/hooks/useSelectAllHandler';
import { queryClient } from '@renderer/index';
import { albumQuery } from '@renderer/queries/albums';
import { store } from '@renderer/store/store';
import storage from '@renderer/utils/localStorage';
import { albumSearchSchema } from '@renderer/utils/zod/albumSchema';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNcmUser, currentNcmUid } from '@renderer/contexts/NcmUserContext';
import { NcmRepository, proxyCoverUrl } from '@renderer/ncm';
import { ncmApi } from '@renderer/api/ncm-client';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import type { NcmAlbum } from '@renderer/ncm/types';

export const Route = createFileRoute('/main-player/albums/')({
  validateSearch: albumSearchSchema,
  component: AlbumsPage,
  loaderDeps: ({ search }) => ({
    sortingOrder: search.sortingOrder
  }),
  loader: async ({ deps }) => {
    await queryClient.ensureQueryData(
      albumQuery.all({
        sortType: deps.sortingOrder || 'aToZ',
        start: 0,
        end: 0
      })
    );
  }
});

function AlbumsPage() {
  const gridRef = useRef<HTMLDivElement>(null);
  const { width } = useResponsiveGrid(gridRef, 3, PLAYLIST_CARD_MIN_WIDTH);
  const columns = useMemo(() => Math.max(3, Math.floor(width / PLAYLIST_CARD_MIN_WIDTH)), [width]);
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);
  const albumsPageSortingState = useStore(
    store,
    (state) => state.localStorage.sortingStates.albumsPage
  );

  const { toggleMultipleSelections, addNewNotifications } = useContext(AppUpdateContext);
  const { sortingOrder = albumsPageSortingState || 'aToZ' } = Route.useSearch();
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });

  const {
    data: { data: albumsData }
  } = useSuspenseQuery(albumQuery.all({ sortType: sortingOrder }));

  // NCM 收藏专辑
  const { profile } = useNcmUser();
  const uid = profile?.userId || currentNcmUid || 0;
  const [ncmAlbums, setNcmAlbums] = useState<NcmAlbum[]>([]);
  useEffect(() => {
    if (profile?.userId) {
      NcmRepository.userAlbumSublist().then(setNcmAlbums).catch(() => {});
    } else {
      setNcmAlbums([]);
    }
  }, [profile?.userId]);

  const ncmAlbumItems = useMemo(() => ncmAlbums.map((al) => ({
    albumId: al.albumId,
    title: al.title,
    artists: al.artists,
    year: al.year,
    songs: Array.from({ length: al.trackCount || 0 }, (_, i) => i),
    artworkPaths: {
      isDefaultArtwork: !al.coverUrl,
      artworkPath: proxyCoverUrl(al.coverUrl),
      optimizedArtworkPath: proxyCoverUrl(al.coverUrl),
    },
    isArtworkAvailable: !!al.coverUrl,
    createdDate: new Date(),
    source: 'netease' as const,
    onPlay: () => {
      const rawId = -al.albumId;
      NcmRepository.albumDetail(rawId).then((detail) => {
        if (detail?.tracks?.length) PlaybackBridge.playSongs(detail.tracks, 0, 'ncmAlbum');
      }).catch(() => {});
    },
    additionalContextMenuItems: [{
      label: '取消收藏',
      iconName: 'heart_broken',
      handlerFunction: () => {
        const rawId = -al.albumId;
        ncmApi.collectAlbum(rawId, false).then(() => {
          addNewNotifications([{ id: 'ncmAlbumUnsub', iconName: 'check_circle', content: `已取消收藏「${al.title}」` }]);
          setNcmAlbums((prev) => prev.filter((a) => a.albumId !== al.albumId));
        }).catch((err) => addNewNotifications([{ id: 'ncmAlbumErr', iconName: 'error', content: String(err) }]));
      },
    }],
  } as Album)), [ncmAlbums, uid, addNewNotifications]);

  const mergedAlbums = useMemo(() => [...albumsData, ...ncmAlbumItems], [albumsData, ncmAlbumItems]);

  // useEffect(() => {
  //   const manageDataUpdatesInAlbumsPage = (e: Event) => {
  //     if ('detail' in e) {
  //       const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
  //       for (let i = 0; i < dataEvents.length; i += 1) {
  //         const event = dataEvents[i];
  //         if (event.dataType === 'albums/newAlbum') fetchAlbumData();
  //         if (event.dataType === 'albums/deletedAlbum') fetchAlbumData();
  //       }
  //     }
  //   };
  //   document.addEventListener('app/dataUpdates', manageDataUpdatesInAlbumsPage);
  //   return () => {
  //     document.removeEventListener('app/dataUpdates', manageDataUpdatesInAlbumsPage);
  //   };
  // }, [fetchAlbumData]);

  useEffect(() => {
    storage.sortingStates.setSortingStates('albumsPage', sortingOrder);
  }, [sortingOrder]);

  const selectAllHandler = useSelectAllHandler(mergedAlbums, 'album', 'albumId');

  return (
    <MainContainer
      ref={gridRef}
      className="main-container appear-from-bottom albums-list-container mb-0 h-full! pb-0! pl-8 pr-8"
      focusable
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'a') {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
    >
      <>
        {mergedAlbums.length > 0 && (
          <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-8 flex items-center pr-4 text-3xl font-medium">
            <div className="container flex">
              {t('common.album_other')}{' '}
              <div className="other-stats-container text-font-color-black dark:text-font-color-white ml-12 flex items-center text-xs">
                {isMultipleSelectionEnabled ? (
                  <div className="text-font-color-highlight dark:text-dark-font-color-highlight text-sm">
                    {t('common.selectionWithCount', {
                      count: multipleSelectionsData.multipleSelections.length
                    })}
                  </div>
                ) : (
                  mergedAlbums.length > 0 && (
                    <span className="no-of-albums">
                      {t('common.albumWithCount', { count: mergedAlbums.length })}
                    </span>
                  )
                )}
              </div>
            </div>
            <div className="other-controls-container flex">
              <Button
                label={t(`common.${isMultipleSelectionEnabled ? 'unselectAll' : 'select'}`)}
                className="select-btn text-sm md:text-lg md:[&>.button-label-text]:hidden md:[&>.icon]:mr-0"
                iconName={isMultipleSelectionEnabled ? 'remove_done' : 'checklist'}
                clickHandler={() => toggleMultipleSelections(!isMultipleSelectionEnabled, 'album')}
              />
              <Dropdown
                name="albumSortDropdown"
                value={sortingOrder}
                options={albumSortOptions}
                onChange={(e) => {
                  storage.sortingStates.setSortingStates(
                    'albumsPage',
                    e.currentTarget.value as AlbumSortTypes
                  );
                  navigate({
                    search: (prev) => ({
                      ...prev,
                      sortingOrder: e.currentTarget.value as AlbumSortTypes
                    })
                  });
                }}
              />
            </div>
          </div>
        )}
        {mergedAlbums.length > 0 && (
            <div className="w-full pb-8">
            <ResponsiveGrid columns={columns}>
              {mergedAlbums.map((item, index) => (
                <Album key={item.albumId} index={index} selectAllHandler={selectAllHandler} {...item} />
              ))}
            </ResponsiveGrid>
            </div>
        )}
        {/* {mergedAlbums && mergedAlbums.length === 0 && (
          <div className="no-songs-container my-[10%] flex h-full w-full flex-col items-center justify-center text-center text-2xl text-[#ccc]">
            <Img
              src={FetchingDataImage}
              alt="No songs available."
              className="mb-8 w-60"
            />
            <div>We&apos;re already there...</div>
          </div>
        )} */}
        {mergedAlbums && mergedAlbums.length === 0 && (
          <div className="no-songs-container text-font-color-black dark:text-font-color-white my-[10%] flex h-full w-full flex-col items-center justify-center text-center text-xl">
            <Img src={NoAlbumsImage} alt="No songs available." className="mb-8 w-60" />
            <div>{t('albumsPage.empty')}</div>
          </div>
        )}
      </>
    </MainContainer>
  );
}
