import NoPlaylistsImage from '@assets/images/svg/Empty Inbox _Monochromatic.svg';
import Button from '@renderer/components/Button';
import Dropdown from '@renderer/components/Dropdown';
import Img from '@renderer/components/Img';
import MainContainer from '@renderer/components/MainContainer';
import { Playlist } from '@renderer/components/PlaylistsPage/Playlist';
import { playlistSortOptions } from '@renderer/components/PlaylistsPage/PlaylistOptions';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import useSelectAllHandler from '@renderer/hooks/useSelectAllHandler';
import { queryClient } from '@renderer/index';
import { playlistQuery } from '@renderer/queries/playlists';
import { store } from '@renderer/store/store';
import storage from '@renderer/utils/localStorage';
import { playlistSearchSchema } from '@renderer/utils/zod/playlistSchema';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import useResponsiveGrid, { PLAYLIST_CARD_MIN_WIDTH } from '@renderer/hooks/useResponsiveGrid';
import ResponsiveGrid from '@renderer/components/ResponsiveGrid';
import { useTranslation } from 'react-i18next';

import { useNcmUser } from '@renderer/contexts/NcmUserContext';
import { proxyCoverUrl } from '@renderer/ncm';
import { NcmRepository } from '@renderer/ncm/repository';
import { NeteaseSyncService } from '@renderer/ncm/NeteaseSyncService';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import type { NcmPlaylist } from '@renderer/ncm/types';


export const Route = createFileRoute('/main-player/playlists/')({
  validateSearch: playlistSearchSchema,
  component: PlaylistsPage,
  loaderDeps: ({ search }) => ({
    sortingOrder: search.sortingOrder
  }),
  loader: async ({ deps }) => {
    await queryClient.ensureQueryData(
      playlistQuery.all({
        sortType: deps.sortingOrder || 'aToZ',
        start: 0,
        end: 30
      })
    );
  }
});

const NewPlaylistPrompt = lazy(
  () => import('@renderer/components/PlaylistsPage/NewPlaylistPrompt')
);
const NcmRenamePrompt = lazy(
  () => import('@renderer/ncm/NcmRenamePrompt')
);


function PlaylistsPage() {
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);
  const playlistsPageSortingState = useStore(
    store,
    (state) => state.localStorage.sortingStates.playlistsPage
  );
  const { sortingOrder = playlistsPageSortingState || 'aToZ' } = Route.useSearch();
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );

  const { changePromptMenuData, updateContextMenuData, addNewNotifications } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });

  const {
    data: { data: playlists }
  } = useSuspenseQuery(playlistQuery.all({ sortType: sortingOrder }));

  // NCM playlists
  const { profile } = useNcmUser();
  const [ncmPlaylists, setNcmPlaylists] = useState<NcmPlaylist[]>([]);

  useEffect(() => {
    if (profile?.userId) {
      NcmRepository.getUserPlaylists(profile.userId).then(setNcmPlaylists).catch(() => {});
    } else {
      setNcmPlaylists([]);
    }
  }, [profile?.userId]);

  const uid = profile?.userId || 0;
  const allPlaylists = useMemo(() => playlists ?? [], [playlists]);
  const ncmPlaylistItems = useMemo(() => ncmPlaylists.map((pl) => {
    const rawId = -pl.playlistId;
    const isOwn = pl.creatorId > 0 && pl.creatorId === uid;
    const ncmMenuItems: ContextMenuItem[] = [];
    if (isOwn) {
      ncmMenuItems.push(
        {
          label: '编辑歌单封面',
          iconName: 'photo_camera',
          handlerFunction: () => {
            import('@renderer/ncm/updatePlaylistCover').then(({ updatePlaylistCover }) => {
              updatePlaylistCover(
                rawId,
                () => {
                  NcmRepository.invalidatePlaylist(rawId);
                  NcmRepository.invalidateUserPlaylists(uid);
                  NcmRepository.getUserPlaylists(uid).then(setNcmPlaylists).catch(() => {});
                  addNewNotifications([{ id: 'ncmCover', iconName: 'check_circle', content: '歌单封面已更新' }]);
                },
                (err) => addNewNotifications([{ id: 'ncmCoverErr', iconName: 'error', content: err }]),
              );
            });
          },
        },
        {
          label: t('playlist.renamePlaylist'),
          iconName: 'edit',
          handlerFunction: () => {
            changePromptMenuData(true, <NcmRenamePrompt name={pl.name} playlistId={rawId} uid={uid} onSuccess={() => { NcmRepository.getUserPlaylists(uid).then(setNcmPlaylists).catch(() => {}); }} />);
          },
        },
        {
          label: t('playlist.deletePlaylist_one'),
          iconName: 'delete_outline',
          handlerFunction: () => {
            import('@renderer/components/SensitiveActionConfirmPrompt').then((mod) => {
              changePromptMenuData(true, <mod.default
                title="删除歌单"
                content={<p>确定要删除歌单「{pl.name}」吗？</p>}
                confirmButton={{
                  label: '删除',
                  iconName: 'delete',
                  clickHandler: () => {
                    NeteaseSyncService.deletePlaylist(rawId, uid).then(() => {
                      NcmRepository.invalidateUserPlaylists(uid);
                      NcmRepository.invalidatePlaylist(rawId);
                      addNewNotifications([{ id: 'ncmDelete', iconName: 'check_circle', content: '已删除歌单' }]);
                      NcmRepository.getUserPlaylists(uid).then(setNcmPlaylists).catch(() => {});
                    }).catch((err) => addNewNotifications([{ id: 'ncmDeleteErr', iconName: 'error', content: String(err) }]));
                  },
                }}
              />);
            });
          },
        },
      );
    } else {
      ncmMenuItems.push({
        label: '取消收藏',
        iconName: 'heart_broken',
        handlerFunction: () => {
          NeteaseSyncService.unsubscribePlaylist(rawId, uid).then(() => {
            NcmRepository.invalidateUserPlaylists(uid);
            addNewNotifications([{ id: 'ncmUnsub', iconName: 'check_circle', content: '已取消收藏' }]);
            NcmRepository.getUserPlaylists(uid).then(setNcmPlaylists).catch(() => {});
          }).catch((err) => addNewNotifications([{ id: 'ncmUnsubErr', iconName: 'error', content: String(err) }]));
        },
      });
    }
    return {
      playlistId: pl.playlistId,
      name: pl.name,
      artworkPaths: {
        isDefaultArtwork: !pl.coverUrl,
        artworkPath: proxyCoverUrl(pl.coverUrl),
        optimizedArtworkPath: proxyCoverUrl(pl.coverUrl),
      },
      songs: Array.from({ length: pl.trackCount || 0 }, (_, i) => i),
      createdDate: new Date(),
      isArtworkAvailable: !!pl.coverUrl,
      additionalContextMenuItems: ncmMenuItems,
      _ncmData: pl,
    } as Playlist & { _ncmData: NcmPlaylist };
  }), [ncmPlaylists, uid, t, addNewNotifications]);

  const mergedPlaylists = useMemo(() => [...allPlaylists, ...ncmPlaylistItems], [allPlaylists, ncmPlaylistItems]);

  const gridRef = useRef<HTMLDivElement>(null);
  const { width } = useResponsiveGrid(gridRef, 3, PLAYLIST_CARD_MIN_WIDTH);
  const columns = useMemo(() => Math.max(3, Math.floor(width / PLAYLIST_CARD_MIN_WIDTH)), [width]);

  // useEffect(() => {
  //   fetchPlaylistData();
  //   const managePlaylistDataUpdatesInPlaylistsPage = (e: Event) => {
  //     if ('detail' in e) {
  //       const dataEvents = (e as DetailAvailableEvent<DataUpdateEvent[]>).detail;
  //       for (let i = 0; i < dataEvents.length; i += 1) {
  //         const event = dataEvents[i];
  //         if (event.dataType === 'playlists') fetchPlaylistData();
  //       }
  //     }
  //   };
  //   document.addEventListener('app/dataUpdates', managePlaylistDataUpdatesInPlaylistsPage);
  //   return () => {
  //     document.removeEventListener('app/dataUpdates', managePlaylistDataUpdatesInPlaylistsPage);
  //   };
  // }, [fetchPlaylistData]);

  useEffect(() => {
    storage.sortingStates.setSortingStates('playlistsPage', sortingOrder);
  }, [sortingOrder]);

  const selectAllHandler = useSelectAllHandler(allPlaylists, 'playlist', 'playlistId');

  const createNewPlaylist = useCallback(
    () =>
      changePromptMenuData(
        true,
        <NewPlaylistPrompt
          currentPlaylists={playlists}
          updatePlaylists={() =>
            queryClient.invalidateQueries(
              playlistQuery.all({
                sortType: sortingOrder,
                start: 0,
                end: 0
              })
            )
          }
        />
      ),
    [changePromptMenuData, playlists, sortingOrder]
  );

  return (
    <MainContainer
      ref={gridRef}
      className="main-container appear-from-bottom playlists-list-container mb-0 h-full! pb-0! pl-8 pr-8"
      onContextMenu={(e) =>
        updateContextMenuData(
          true,
          [
            {
              label: t('playlistsPage.createNewPlaylist'),
              handlerFunction: createNewPlaylist,
              iconName: 'add'
            },
            {
              label: t('playlistsPage.importPlaylist'),
              iconName: 'publish',
              handlerFunction: () =>
                window.api.playlistsData.importPlaylist().catch((err) => console.error(err))
            }
          ],
          e.pageX,
          e.pageY
        )
      }
      focusable
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'a') {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
    >
      <>
        <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-8 flex items-center pr-4 text-3xl font-medium">
          <div className="container flex">
            {t('common.playlist_other')}{' '}
            <div className="other-stats-container text-font-color-black dark:text-font-color-white ml-12 flex items-center text-xs">
              {isMultipleSelectionEnabled ? (
                <div className="text-font-color-highlight dark:text-dark-font-color-highlight text-sm">
                  {t('common.selectionWithCount', {
                    count: multipleSelectionsData.multipleSelections.length
                  })}
                </div>
              ) : (
                <span className="no-of-artists">
                  {t('common.playlistWithCount', { count: mergedPlaylists.length })}
                </span>
              )}
            </div>
          </div>
          <div className="other-control-container flex">
            <Button
              label={t(`playlistsPage.importPlaylist`)}
              className="import-playlist-btn text-sm md:text-lg md:[&>.button-label-text]:hidden md:[&>.icon]:mr-0"
              iconName="publish"
              clickHandler={(_, setIsDisabled, setIsPending) => {
                setIsDisabled(true);
                setIsPending(true);

                return window.api.playlistsData
                  .importPlaylist()
                  .finally(() => {
                    setIsDisabled(false);
                    setIsPending(false);
                  })
                  .catch((err) => console.error(err));
              }}
            />
            <Button
              label={t(`playlistsPage.addPlaylist`)}
              className="add-new-playlist-btn text-sm md:text-lg md:[&>.button-label-text]:hidden md:[&>.icon]:mr-0"
              iconName="add"
              clickHandler={createNewPlaylist}
            />
            <Dropdown
              name="playlistsSortDropdown"
              value={sortingOrder}
              options={playlistSortOptions}
              onChange={(e) => {
                navigate({
                  search: (prev) => ({
                    ...prev,
                    sortingOrder: e.currentTarget.value as PlaylistSortTypes
                  })
                });
              }}
            />
          </div>
        </div>

        {mergedPlaylists.length > 0 && (
            <div className="w-full pb-8">
            <ResponsiveGrid columns={columns}>
              {mergedPlaylists.map((item, index) => {
                const isNcm = item.playlistId < 0;
                if (isNcm) {
                  const ncm = (item as any)._ncmData as NcmPlaylist;
                  const rawId = -ncm.playlistId;
                  return <Playlist key={item.playlistId} index={index} source="netease"
                    onPlay={(shuffle = false) => {
                      NcmRepository.playlistDetail(rawId).then((detail) => {
                        const tracks = shuffle ? [...detail.tracks].sort(() => Math.random() - 0.5) : detail.tracks;
                        PlaybackBridge.playSongs(tracks, 0, 'ncmPlaylist', String(rawId));
                      }).catch(() => {});
                    }}
                    onAddToQueue={() => {
                      NcmRepository.playlistDetail(rawId).then(async (detail) => {
                        for (const song of detail.tracks) {
                          try { await PlaybackBridge.addToEnd(song); } catch { /* skip */ }
                        }
                      }).catch(() => {});
                    }}
                    {...item} />;
                }
                return <Playlist key={item.playlistId} index={index} selectAllHandler={selectAllHandler} {...item} />;
              })}
            </ResponsiveGrid>
            </div>
          )}
        {mergedPlaylists.length === 0 && (
          <div className="no-playlists-container text-font-color-black dark:text-font-color-white my-[10%] flex h-full w-full flex-col items-center justify-center text-center text-xl">
            <Img src={NoPlaylistsImage} alt="" className="mb-8 w-60" />
            <span>{t('playlistsPage.empty')}</span>
          </div>
        )}
      </>
    </MainContainer>
  );
}
