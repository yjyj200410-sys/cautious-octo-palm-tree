import NoSongsImage from '@assets/images/svg/Empty Inbox _Monochromatic.svg';
import Button from '@renderer/components/Button';
import Dropdown from '@renderer/components/Dropdown';
import Img from '@renderer/components/Img';
import MainContainer from '@renderer/components/MainContainer';
import Song from '@renderer/components/SongsPage/Song';
import { songFilterOptions, songSortOptions } from '@renderer/components/SongsPage/SongOptions';
import VirtualizedList from '@renderer/components/VirtualizedList';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import useSelectAllHandler from '@renderer/hooks/useSelectAllHandler';
import { queryClient } from '@renderer/index';
import { songQuery } from '@renderer/queries/songs';
import { store } from '@renderer/store/store';
import storage from '@renderer/utils/localStorage';
import { songSearchSchema } from '@renderer/utils/zod/songSchema';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { lazy, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/main-player/songs/')({
  validateSearch: songSearchSchema,
  loaderDeps: ({ search }) => ({
    sortingOrder: search.sortingOrder,
    filteringOrder: search.filteringOrder
  }),
  loader: async ({ deps }) => {
    await queryClient.ensureQueryData(
      songQuery.ids({
        sortType: deps.sortingOrder ?? 'aToZ',
        filterType: deps.filteringOrder ?? 'notSelected'
      })
    );
  },
  component: SongsPage
});

const AddMusicFoldersPrompt = lazy(
  () => import('@renderer/components/MusicFoldersPage/AddMusicFoldersPrompt')
);

function SongsPage() {
  const songsPageSortingState = useStore(
    store,
    (state) => state.localStorage.sortingStates.songsPage
  );
  const isSongIndexingEnabled = useStore(
    store,
    (state) => state.localStorage.preferences.isSongIndexingEnabled
  );
  const isMultipleSelectionEnabled = useStore(
    store,
    (state) => state.multipleSelectionsData.isEnabled
  );
  const multipleSelectionsData = useStore(store, (state) => state.multipleSelectionsData);

  const {
    createQueue,
    updateQueueData,
    toggleMultipleSelections,
    updateContextMenuData,
    changePromptMenuData
  } = useContext(AppUpdateContext);
  const { t } = useTranslation();
  const {
    scrollTopOffset,
    sortingOrder = songsPageSortingState || 'aToZ',
    filteringOrder = 'notSelected'
  } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // 轻量查询：只取 {id, isBlacklisted}，不带任何关系，快
  const {
    data: { data: songIds }
  } = useSuspenseQuery(
    songQuery.ids({ sortType: sortingOrder, filterType: filteringOrder })
  );

  // 按索引缓存已加载的完整 SongData
  const [songCache, setSongCache] = useState<Map<number, SongData>>(new Map());
  const songCacheRef = useRef(songCache);
  songCacheRef.current = songCache;

  // 批量加载可见范围的完整数据
  const loadSongsRange = useCallback((start: number, end: number) => {
    const ids = songIds.slice(start, end + 1).map((s) => s.id);
    if (ids.length === 0) return;
    const t0 = performance.now();
    window.api.audioLibraryControls
      .getSongInfo(ids, sortingOrder, filteringOrder)
      .then((songs) => {
        window.api.log.sendLogs(
          `[LOAD_SONGS_RANGE_TIME] start=${start} end=${end} count=${ids.length} ipc=${(performance.now() - t0).toFixed(1)}ms`
        );
        if (!songs) return;
        setSongCache((prev) => {
          const next = new Map(prev);
          songs.forEach((song) => {
            const idx = songIds.findIndex((s) => s.id === song.songId);
            if (idx >= 0) next.set(idx, song);
          });
          return next;
        });
      })
      .catch((err) => console.error(err));
  }, [songIds, sortingOrder, filteringOrder]);

  // 首次加载可见范围
  const loadedOnce = useRef(false);
  useEffect(() => {
    window.api.log.sendLogs(`[SONGS_PAGE_MOUNTED] songIds=${songIds.length}`);
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    loadSongsRange(0, 29);
  }, [loadSongsRange]);

  // 排序/过滤变化时清空缓存
  useEffect(() => {
    setSongCache(new Map());
    loadedOnce.current = false;
  }, [sortingOrder, filteringOrder]);

  useEffect(() => {
    storage.sortingStates.setSortingStates('songsPage', sortingOrder);
  }, [sortingOrder]);

  const addNewSongs = useCallback(() => {
    changePromptMenuData(
      true,
      <AddMusicFoldersPrompt
        onSuccess={() => {
          queryClient.invalidateQueries(
            songQuery.ids({
              sortType: sortingOrder,
              filterType: filteringOrder
            })
          );
          queryClient.invalidateQueries(
            songQuery.all({
              sortType: sortingOrder,
              filterType: filteringOrder,
              start: 0,
              end: 0
            })
          );
        }}
      />
    );
  }, [changePromptMenuData, filteringOrder, sortingOrder]);

  const importAppData = useCallback(
    (
      _: unknown,
      setIsDisabled: (state: boolean) => void,
      setIsPending: (state: boolean) => void
    ) => {
      setIsDisabled(true);
      setIsPending(true);

      return window.api.settingsHelpers
        .importAppData()
        .then((res) => {
          if (res) storage.setAllItems(res);
          return undefined;
        })
        .finally(() => {
          setIsDisabled(false);
          setIsPending(false);
        })
        .catch((err) => console.error(err));
    },
    []
  );

  const selectAllHandler = useSelectAllHandler(songIds, 'songs', 'id');

  const currentQueue = useStore(store, (state) => state.localStorage.queue);

  const handleSongPlayBtnClick = useCallback(
    (currSongId: number) => {
      const queueSongIds = songIds
        .filter((song) => !song.isBlacklisted)
        .map((song) => song.id);
      const targetIndex = queueSongIds.indexOf(currSongId);
      const sameQueue =
        currentQueue.songIds.length === queueSongIds.length &&
        currentQueue.songIds.every((id, i) => id === queueSongIds[i]);
      if (sameQueue) {
        if (targetIndex >= 0) updateQueueData(targetIndex);
      } else {
        updateQueueData(targetIndex >= 0 ? targetIndex : 0, queueSongIds, false, true);
      }
    },
    [songIds, createQueue, updateQueueData, currentQueue.songIds]
  );

  // const parentRef = useRef<HTMLDivElement>(null);

  // const rowVirtualizer = useVirtualizer({
  //   count: songsData?.length || 0,
  //   getScrollElement: () => parentRef.current,
  //   estimateSize: () => 60,
  //   overscan: 10,
  //   debug: true
  // });

  return (
    <MainContainer
      className="main-container appear-from-bottom songs-list-container h-full! overflow-hidden pb-0!"
      focusable
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'a') {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
    >
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-8 flex items-center pr-4 text-3xl font-medium">
        <div className="container flex">
          {t('common.song_other')}{' '}
          <div className="other-stats-container text-font-color-black dark:text-font-color-white ml-12 flex items-center text-xs">
            {isMultipleSelectionEnabled ? (
              <div className="text-font-color-highlight dark:text-dark-font-color-highlight text-sm">
                {t('common.selectionWithCount', {
                  count: multipleSelectionsData.multipleSelections.length
                })}
              </div>
            ) : (
              songIds &&
              songIds.length > 0 && (
                <span className="no-of-songs">
                  {t('common.songWithCount', {
                    count: songIds.length
                  })}
                </span>
              )
            )}
          </div>
        </div>
        <div className="other-controls-container flex">
          <Button
            key={0}
            className="more-options-btn text-sm md:text-lg md:[&>.button-label-text]:hidden md:[&>.icon]:mr-0"
            iconName="more_horiz"
            clickHandler={(e) => {
              e.stopPropagation();
              const button = e.currentTarget;
              const { x, y } = button.getBoundingClientRect();
              updateContextMenuData(
                true,
                [
                  {
                    label: t('settingsPage.resyncLibrary'),
                    iconName: 'sync',
                    handlerFunction: () => window.api.audioLibraryControls.resyncSongsLibrary()
                  }
                ],
                x + 10,
                y + 50
              );
            }}
            tooltipLabel={t('common.moreOptions')}
            onContextMenu={(e) => {
              e.preventDefault();
              updateContextMenuData(
                true,
                [
                  {
                    label: t('settingsPage.resyncLibrary'),
                    iconName: 'sync',
                    handlerFunction: () => window.api.audioLibraryControls.resyncSongsLibrary()
                  }
                ],
                e.pageX,
                e.pageY
              );
            }}
          />
          <Button
            key={1}
            className="select-btn text-sm md:text-lg md:[&>.button-label-text]:hidden md:[&>.icon]:mr-0"
            iconName={isMultipleSelectionEnabled ? 'remove_done' : 'checklist'}
            clickHandler={() => toggleMultipleSelections(!isMultipleSelectionEnabled, 'songs')}
            tooltipLabel={t(
              `common.${
                isMultipleSelectionEnabled && multipleSelectionsData.selectionType === 'songs'
                  ? 'unselectAll'
                  : 'select'
              }`
            )}
          />
          <Button
            key={2}
            tooltipLabel={t('common.playAll')}
            className="play-all-btn text-sm md:text-lg md:[&>.button-label-text]:hidden md:[&>.icon]:mr-0"
            iconName="play_arrow"
            clickHandler={() =>
              createQueue(
                songIds.filter((song) => !song.isBlacklisted).map((song) => song.id),
                'songs',
                false,
                undefined,
                true
              )
            }
          />
          <Button
            key={3}
            label={t('common.shuffleAndPlay')}
            className="shuffle-and-play-all-btn text-sm md:text-lg md:[&>.button-label-text]:hidden md:[&>.icon]:mr-0"
            iconName="shuffle"
            clickHandler={() =>
              createQueue(
                songIds.filter((song) => !song.isBlacklisted).map((song) => song.id),
                'songs',
                true,
                undefined,
                true
              )
            }
          />
          <Dropdown
            name="songsPageFilterDropdown"
            type={`${t('common.filterBy')} :`}
            value={filteringOrder}
            options={songFilterOptions}
            onChange={(e) => {
              navigate({
                search: (prev) => ({
                  ...prev,
                  filteringOrder: e.currentTarget.value as SongFilterTypes
                })
              });
            }}
          />
          <Dropdown
            name="songsPageSortDropdown"
            type={`${t('common.sortBy')} :`}
            value={sortingOrder}
            options={songSortOptions}
            onChange={(e) => {
              navigate({
                search: (prev) => ({
                  ...prev,
                  sortingOrder: e.currentTarget.value as SongSortTypes
                })
              });
            }}
          />
        </div>
      </div>
      <div
        className="songs-container appear-from-bottom h-full flex-1 delay-100"
        // ref={songsContainerRef}
      >
        {/* <InfiniteLoader
            // isItemLoaded={isItemLoaded}
            itemCount={60}
            // loadMoreItems={loadMoreItems}
          >
            {({ onItemsRendered, ref }) => (
              <List
                ref={ref}
                onItemsRendered={onItemsRendered}
                itemCount={songsData.length}
                itemSize={60}
                width={width || '100%'}
                height={height || 450}
                overscanCount={10}
                className="appear-from-bottom delay-100"
                initialScrollOffset={
                  currentlyActivePage.data?.scrollTopOffset ?? 0
                }
                onScroll={(data) => {
                }
              >
                {songs}
              </List>
            )}
          </InfiniteLoader> */}
        {songIds && songIds.length > 0 && (
          <VirtualizedList
            totalCount={songIds.length}
            fixedItemHeight={60}
            scrollTopOffset={scrollTopOffset}
            onChange={(range) => {
              // 懒加载当前可见范围 + overscan 的完整数据
              const start = Math.max(0, range.startIndex - 10);
              const end = Math.min(songIds.length - 1, range.endIndex + 10);
              loadSongsRange(start, end);
            }}
            onDebouncedScroll={(range) => {
              window.api.log.sendLogs(
                `[SCROLL_STOP] topRow=${range.startIndex} endRow=${range.endIndex} t=${(performance.now() / 1000).toFixed(2)}s`
              );
              navigate({
                replace: true,
                search: (prev) => ({
                  ...prev,
                  scrollTopOffset: range.startIndex
                })
              });
            }}
            itemContent={(index) => {
              const song = songCache.get(index);
              if (song)
                return (
                  <Song
                    key={index}
                    index={index}
                    isIndexingSongs={isSongIndexingEnabled}
                    onPlayClick={handleSongPlayBtnClick}
                    selectAllHandler={selectAllHandler}
                    {...song}
                  />
                );
              // 未加载的行：渲染占位行，避免空位跳动
              return (
                <div className="h-13 mb-2 w-[98%] rounded-lg bg-background-color-2/20" />
              );
            }}
          />
        )}
      </div>
      {songIds.length === 0 && (
        <div className="no-songs-container text-font-color-black dark:text-font-color-white my-[8%] flex h-full w-full flex-col items-center justify-center text-center text-xl">
          <Img src={NoSongsImage} alt="" className="mb-8 w-60" />
          <span>{t('songsPage.empty')}</span>
          <div className="flex items-center justify-between">
            <Button
              label={t('foldersPage.addFolder')}
              iconName="create_new_folder"
              iconClassName="material-icons-round-outlined"
              className="bg-background-color-3! text-font-color-black! hover:border-background-color-3 dark:bg-dark-background-color-3! dark:text-font-color-black! dark:hover:border-background-color-3 mt-4 px-8 text-lg"
              clickHandler={addNewSongs}
            />
            <Button
              label={t('settingsPage.importAppData')}
              iconName="upload"
              className="bg-background-color-3! text-font-color-black! hover:border-background-color-3 dark:bg-dark-background-color-3! dark:text-font-color-black! dark:hover:border-background-color-3 mt-4 px-8 text-lg"
              clickHandler={importAppData}
            />
          </div>
        </div>
      )}
    </MainContainer>
  );
}
