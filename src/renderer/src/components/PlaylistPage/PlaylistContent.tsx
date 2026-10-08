import PlaylistInfoAndImgContainer from '@renderer/components/PlaylistsInfoPage/PlaylistInfoAndImgContainer';
import Song from '@renderer/components/SongsPage/Song';
import TitleContainer from '@renderer/components/TitleContainer';
import VirtualizedList from '@renderer/components/VirtualizedList';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import useSelectAllHandler from '@renderer/hooks/useSelectAllHandler';
import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';

type TitleButton = {
  label?: string;
  tooltipLabel?: string;
  iconName: string;
  clickHandler: () => void;
  isDisabled?: boolean;
  isVisible?: boolean;
};

type TitleDropdown = {
  name: string;
  type: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  isDisabled?: boolean;
};

type Props = {
  playlist: Playlist;
  songs: SongData[];
  buttons?: TitleButton[];
  dropdowns?: TitleDropdown[];
  onPlayClick: (songId: number) => void;
  additionalContextMenuItems?: (item: SongData) => ContextMenuItem[];
  scrollTopOffset?: number;
  /** 覆盖根容器 class(抽屉内用 h-full 适配) */
  className?: string;
};

/**
 * 歌单内容面板(封面 + 标题栏 + 虚拟歌曲列表)。
 * 被 PlaylistPage(旧 URL 整页容器)与 LibraryPanel(常驻主内容区域)共同复用。
 */
export default function PlaylistContent({
  playlist,
  songs,
  buttons,
  dropdowns,
  onPlayClick,
  additionalContextMenuItems,
  scrollTopOffset = 0,
  className = '',
}: Props) {
  const queue = useStore(store, (state) => state.localStorage.queue);
  const preferences = useStore(store, (state) => state.localStorage.preferences);
  const { updateQueueData, addNewNotifications, createQueue } =
    useContext(AppUpdateContext);
  const { t } = useTranslation();

  const selectAllHandler = useSelectAllHandler(songs, 'songs', 'songId');

  const defaultPlayAll = useCallback(
    () =>
      createQueue(
        songs.filter((s) => !s.isBlacklisted).map((s) => s.songId),
        'songs',
        false,
        playlist.playlistId,
        true
      ),
    [createQueue, playlist.playlistId, songs]
  );

  const defaultShuffle = useCallback(
    () =>
      createQueue(
        songs.filter((s) => !s.isBlacklisted).map((s) => s.songId),
        'playlist',
        true,
        playlist.playlistId,
        true
      ),
    [createQueue, playlist.playlistId, songs]
  );

  const defaultAddToQueue = useCallback(() => {
    const ids = songs.filter((s) => !s.isBlacklisted).map((s) => s.songId);
    updateQueueData(undefined, [...queue.songIds, ...ids]);
    addNewNotifications([
      { id: 'addedToQueue', duration: 5000, content: t('notifications.addedToQueue', { count: ids.length }) }
    ]);
  }, [addNewNotifications, songs, queue.songIds, t, updateQueueData]);

  const titleButtons: TitleButton[] = buttons ?? [
    {
      label: t('common.playAll'),
      iconName: 'play_arrow',
      clickHandler: defaultPlayAll,
      isDisabled: songs.length === 0,
    },
    {
      tooltipLabel: t('common.shuffleAndPlay'),
      iconName: 'shuffle',
      clickHandler: defaultShuffle,
      isDisabled: songs.length === 0,
    },
    {
      tooltipLabel: t('common.addToQueue'),
      iconName: 'add',
      clickHandler: defaultAddToQueue,
      isDisabled: songs.length === 0,
    },
  ];

  return (
    <div
      className={`flex h-full w-full flex-col overflow-hidden focus:outline-none ${className}`}
      onKeyDown={(e) => {
        if (e.ctrlKey && e.key === 'a') {
          e.stopPropagation();
          selectAllHandler();
        }
      }}
    >
      <TitleContainer
        title={playlist.name}
        className="pr-4"
        buttons={titleButtons}
        dropdowns={dropdowns}
      />
      <div className="min-h-0 flex-1">
        <VirtualizedList
          data={songs}
          fixedItemHeight={60}
          scrollTopOffset={scrollTopOffset}
          components={{
            Header: () => <PlaylistInfoAndImgContainer playlist={playlist} songs={songs} />,
          }}
          itemContent={(index, item) => item ? (
            <Song
              key={index}
              index={index}
              isIndexingSongs={preferences.isSongIndexingEnabled}
              onPlayClick={onPlayClick}
              selectAllHandler={selectAllHandler}
              {...item}
              trackNo={undefined}
              additionalContextMenuItems={additionalContextMenuItems?.(item)}
              currentPlaylistId={playlist.playlistId < 0 ? playlist.playlistId : undefined}
            />
          ) : null}
        />
      </div>
      {songs.length === 0 && (
        <div className="no-songs-container appear-from-bottom text-font-color-black dark:text-font-color-white relative flex h-full grow flex-col items-center justify-center text-center text-lg font-light opacity-80!">
          <span className="material-icons-round-outlined mb-4 text-5xl">brightness_empty</span>
          {t('playlist.empty')}
        </div>
      )}
    </div>
  );
}
