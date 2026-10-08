import DefaultPlaylistCover from '@renderer/assets/images/webp/playlist_cover_default.webp';
import DefaultSongCover from '@renderer/assets/images/webp/song_cover_default.webp';
import { CDSleeve } from '@renderer/components/CDLibrary/CDArtwork';
import Img from '@renderer/components/Img';
import NcmSelectPlaylistsPrompt from '@renderer/components/NcmSelectPlaylistsPrompt';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import { useNcmUser } from '@renderer/contexts/NcmUserContext';
import { proxyCoverUrl } from '@renderer/ncm';
import { NeteaseSyncService } from '@renderer/ncm/NeteaseSyncService';
import { PlaybackBridge } from '@renderer/ncm/playback/PlaybackBridge';
import { NcmRepository } from '@renderer/ncm/repository';
import type { NcmPlaylist, NcmSong } from '@renderer/ncm/types';
import toggleSongIsFavorite from '@renderer/other/toggleSongIsFavorite';
import { store } from '@renderer/store/store';
import { FavoriteService } from '@renderer/utils/unifiedStorage';
import { useStore } from '@tanstack/react-store';
import { useContext } from 'react';

import VipBadge from '../VipBadge';

export function HomeSectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="home-section-heading">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function HomePlaylistCard({
  playlist,
  onOpen,
  featured = false,
  contextMenu = false
}: {
  playlist: NcmPlaylist;
  onOpen: (playlist: NcmPlaylist) => void;
  featured?: boolean;
  contextMenu?: boolean;
}) {
  const { updateContextMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const { profile } = useNcmUser();
  const onContextMenu = async (event: React.MouseEvent) => {
    if (!contextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    const pageX = event.pageX;
    const pageY = event.pageY;
    const userId = profile?.userId;
    const userPlaylists = userId
      ? await NcmRepository.getUserPlaylists(userId).catch(() => [])
      : [];
    const subscribed = userPlaylists.some((item) => item.playlistId === playlist.playlistId);
    const showError = () =>
      addNewNotifications([
        {
          id: `recommend-playlist-error-${playlist.playlistId}`,
          iconName: 'error',
          content: '歌单操作失败'
        }
      ]);
    const loadSongs = async () => (await NcmRepository.playlistDetail(playlist.playlistId)).tracks;
    const play = async (shuffle: boolean) => {
      try {
        const songs = await loadSongs();
        if (!songs.length) return;
        const list = shuffle ? [...songs].sort(() => Math.random() - 0.5) : songs;
        await PlaybackBridge.playSongs(list, 0, 'ncmPlaylist', String(playlist.playlistId));
      } catch {
        showError();
      }
    };
    const addToQueue = async () => {
      try {
        const songs = await loadSongs();
        if (songs.length) await PlaybackBridge.addPlaylistToEnd(songs);
      } catch {
        showError();
      }
    };
    const items: ContextMenuItem[] = [
      { label: '播放全部', iconName: 'play_arrow', handlerFunction: () => play(false) },
      { label: '随机播放', iconName: 'shuffle', handlerFunction: () => play(true) },
      { label: '加入队列', iconName: 'queue', handlerFunction: addToQueue },
      { label: 'Hr', isContextMenuItemSeperator: true, handlerFunction: () => true },
      ...(userId && playlist.creatorId !== userId
        ? [
            {
              label: subscribed ? '取消收藏' : '收藏歌单',
              iconName: 'favorite',
              handlerFunction: async () => {
                try {
                  if (subscribed)
                    await NeteaseSyncService.unsubscribePlaylist(playlist.playlistId, userId);
                  else await NeteaseSyncService.subscribePlaylist(playlist.playlistId, userId);
                  addNewNotifications([
                    {
                      id: `recommend-playlist-save-${playlist.playlistId}`,
                      iconName: 'favorite',
                      content: subscribed
                        ? `已取消收藏「${playlist.name}」`
                        : `已收藏「${playlist.name}」`
                    }
                  ]);
                } catch {
                  showError();
                }
              }
            }
          ]
        : []),
      { label: '查看歌单', iconName: 'info', handlerFunction: () => onOpen(playlist) }
    ];
    updateContextMenuData(true, items, pageX, pageY, {
      title: playlist.name,
      artworkPath: proxyCoverUrl(playlist.coverUrl) || DefaultPlaylistCover,
      subTitle: `${playlist.trackCount || 0} 首歌曲`
    });
  };
  return (
    <button
      type="button"
      className={`home-playlist-card ${featured ? 'is-featured' : ''}`}
      onClick={() => onOpen(playlist)}
      onContextMenu={onContextMenu}
    >
      <CDSleeve
        cover={proxyCoverUrl(playlist.coverUrl)}
        fallback={DefaultPlaylistCover}
        className="home-playlist-sleeve"
      />
      <span className="home-playlist-copy">
        <strong>{playlist.name}</strong>
        {playlist.copywriter && <small>{playlist.copywriter}</small>}
      </span>
    </button>
  );
}

export function HomeSongGrid({ songs }: { songs: NcmSong[] }) {
  const { updateContextMenuData, changePromptMenuData, addNewNotifications, toggleIsFavorite } =
    useContext(AppUpdateContext);
  const currentSongId = useStore(store, (state) => state.currentSongData.songId);
  const onSongContextMenu = (event: React.MouseEvent, song: NcmSong, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const favorite = FavoriteService.isFavorite({
      source: 'netease',
      sourceId: String(song.ncmId)
    });
    const onFailure = () =>
      addNewNotifications([
        {
          id: `recommend-song-error-${song.ncmId}`,
          iconName: 'error',
          content: `无法操作「${song.title}」`
        }
      ]);
    const items: ContextMenuItem[] = [
      {
        label: '播放',
        iconName: 'play_arrow',
        handlerFunction: () => PlaybackBridge.playSongs(songs, index).catch(onFailure)
      },
      {
        label: '下一首播放',
        iconName: 'shortcut',
        handlerFunction: () => PlaybackBridge.addToNext(song).catch(onFailure)
      },
      { label: 'Hr', isContextMenuItemSeperator: true, handlerFunction: () => true },
      {
        label: favorite ? '取消喜欢' : '喜欢歌曲',
        iconName: 'favorite',
        iconClassName: favorite
          ? 'material-icons-round mr-4 text-xl'
          : 'material-icons-round-outlined mr-4 text-xl',
        handlerFunction: () => {
          toggleSongIsFavorite(song.songId, favorite, !favorite)
            .then((result) => {
              if (result === undefined) onFailure();
              else if (currentSongId === song.songId) toggleIsFavorite(!favorite, true);
            })
            .catch(onFailure);
        }
      },
      {
        label: '添加到歌单',
        iconName: 'playlist_add',
        handlerFunction: () =>
          changePromptMenuData(
            true,
            <NcmSelectPlaylistsPrompt songIds={[song.ncmId]} title={song.title} />
          )
      }
    ];
    updateContextMenuData(true, items, event.pageX, event.pageY);
  };
  return (
    <div className="home-song-grid">
      {songs.map((song, index) => (
        <button
          key={`${song.ncmId}-${index}`}
          type="button"
          className="home-song-card"
          onClick={() => PlaybackBridge.playSongs(songs, index)}
          onContextMenu={(event) => onSongContextMenu(event, song, index)}
          title={`播放 ${song.title}`}
        >
          <Img
            src={proxyCoverUrl(song.coverUrl)}
            fallbackSrc={DefaultSongCover}
            alt=""
            loading="lazy"
          />
          <span className="home-song-copy">
            <strong>
              {song.title} <VipBadge isVip={song.isVip} />
            </strong>
            <small>{song.artists.map((artist) => artist.name).join('、') || '未知歌手'}</small>
          </span>
          <span className="material-icons-round home-song-play" aria-hidden="true">
            play_arrow
          </span>
        </button>
      ))}
    </div>
  );
}
