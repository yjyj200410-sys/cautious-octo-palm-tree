/* eslint-disable promise/catch-or-return */

import { useCallback, useContext, useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../contexts/AppUpdateContext';
import { useNcmUser } from '../contexts/NcmUserContext';
import { NcmRepository } from '../ncm/repository';
import { NeteaseSyncService } from '../ncm/NeteaseSyncService';
import type { NcmPlaylist } from '../ncm/types';
import Button from './Button';
import Checkbox from './Checkbox';

interface NcmSelectPlaylistsPromptProps {
  /** NCM 原始 ID（正数） */
  songIds: number[];
  title?: string;
  /** 当前歌曲列表所在的网易云歌单；不可再添加到它自身。 */
  currentPlaylistId?: number;
}

const isLikedPlaylist = (playlist: NcmPlaylist) =>
  playlist.name === '我喜欢的音乐' || playlist.name.includes('喜欢的音乐');

const selectableNcmPlaylists = (
  playlists: NcmPlaylist[], userId: number, currentPlaylistId?: number
) => playlists.filter((playlist) =>
  Math.abs(playlist.playlistId) !== Math.abs(currentPlaylistId || 0) &&
  (playlist.creatorId === userId || (playlist.creatorId === 0 && isLikedPlaylist(playlist)))
);

interface SelectablePlaylistProps {
  playlist: NcmPlaylist;
  isChecked: boolean;
  onToggle: (state: boolean) => void;
}

const SelectablePlaylist = ({
  playlist,
  isChecked,
  onToggle,
}: SelectablePlaylistProps) => {
  const { t } = useTranslation();

  return (
    <div
      className={`playlist appear-from-bottom group mr-4 mb-6 flex h-52 w-38 flex-col justify-between rounded-xl p-4 ${
        isChecked
          ? 'bg-background-color-3 text-font-color-black! dark:bg-dark-background-color-3 dark:text-font-color-black!'
          : 'hover:bg-background-color-2 dark:hover:bg-dark-background-color-2'
      }`}
      onClick={() => onToggle(!isChecked)}
      onKeyDown={() => onToggle(!isChecked)}
      role="button"
      tabIndex={0}
    >
      <div className="playlist-cover-and-checkbox-container relative h-[70%] overflow-hidden">
        <Checkbox
          id={`ncm-pl-${playlist.playlistId}`}
          isChecked={isChecked}
          checkedStateUpdateFunction={onToggle}
          className="absolute right-3 bottom-3"
        />
        <div className="playlist-cover-container h-full cursor-pointer overflow-hidden rounded-lg">
          {playlist.coverUrl ? (
            <img
              src={playlist.coverUrl}
              alt={playlist.name}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/5 text-xs text-white/20">
              {'暂无封面'}
            </div>
          )}
        </div>
      </div>
      <div className="playlist-info-container">
        <div
          className="title playlist-title w-full overflow-hidden text-xl text-ellipsis whitespace-nowrap"
          title={playlist.name}
        >
          {playlist.name}
        </div>
        <div className="playlist-no-of-songs text-sm font-light">
          {t('common.songWithCount', { count: playlist.trackCount ?? playlist.songs?.length ?? 0 })}
        </div>
      </div>
    </div>
  );
};

const NcmSelectPlaylistsPrompt = ({ songIds, title, currentPlaylistId }: NcmSelectPlaylistsPromptProps) => {
  const { changePromptMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const { profile } = useNcmUser();
  const { t } = useTranslation();

  const [playlists, setPlaylists] = useState<NcmPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (profile?.userId) {
      NcmRepository.getUserPlaylists(profile.userId)
        .then((items) => setPlaylists(selectableNcmPlaylists(items, profile.userId, currentPlaylistId)))
        .catch(() => setPlaylists([]))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [profile?.userId, currentPlaylistId]);

  const addSongsToPlaylists = useCallback(() => {
    const allowedIds = new Set(playlists.map((playlist) => playlist.playlistId));
    const targets = selectedPlaylistIds.filter((playlistId) => allowedIds.has(playlistId));
    if (!targets.length || busy) return;
    setBusy(true);
    const promises = targets.map(async (playlistId) => {
      try {
        await NeteaseSyncService.addSongsToPlaylist(-playlistId, songIds);
      } catch (err) {
        console.error(`Failed to add songs to playlist ${playlistId}:`, err);
        throw err;
      }
    });

    Promise.all(promises)
      .then(() => {
        addNewNotifications([
          {
            id: 'ncmSongsAddedToPlaylists',
            duration: 5000,
            iconName: 'playlist_add',
            content: t('ncm.addSongsToNcmPlaylistsSuccess', {
              count: songIds.length,
              playlistCount: targets.length,
            }),
          },
        ]);
      })
      .catch((err) => {
        console.error(err);
        addNewNotifications([
          {
            id: 'ncmSongsAddFailed',
            duration: 5000,
            iconName: 'error',
            content: t('ncm.addSongsToNcmPlaylistError') || '添加失败，请重试',
          },
        ]);
      })
      .finally(() => {
        setBusy(false);
        changePromptMenuData(false);
      });
  }, [songIds, selectedPlaylistIds, playlists, busy, addNewNotifications, t, changePromptMenuData]);

  const createAndAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newPlaylistName.trim();
    if (!profile?.userId || !name || busy) return;
    setBusy(true);
    setError('');
    try {
      const playlist = await NeteaseSyncService.createPlaylist(name, profile.userId);
      try {
        await NeteaseSyncService.addSongsToPlaylist(-playlist.playlistId, songIds);
      } catch (cause) {
        setPlaylists((current) => [...current, playlist]);
        setError('歌单已创建，但歌曲添加失败。请从上方选择新歌单后重试。');
        console.error(cause);
        return;
      }
      addNewNotifications([{ id: `ncmCreatedPlaylist-${playlist.playlistId}`, iconName: 'playlist_add', content: `已创建「${name}」并添加歌曲` }]);
      changePromptMenuData(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建歌单失败');
    } finally {
      setBusy(false);
    }
  };

  const playlistComponents = useMemo(
    () =>
      playlists.length > 0
        ? playlists.map((playlist) => (
            <SelectablePlaylist
              key={playlist.playlistId}
              playlist={playlist}
              isChecked={selectedPlaylistIds.includes(playlist.playlistId)}
              onToggle={(state) => {
                setSelectedPlaylistIds((prev) => {
                  if (state) return [...prev, playlist.playlistId];
                  return prev.filter((id) => id !== playlist.playlistId);
                });
              }}
            />
          ))
        : null,
    [playlists, selectedPlaylistIds],
  );

  const noOfSelectedPlaylists = selectedPlaylistIds.length;

  return (
    <>
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center pr-4 text-3xl font-medium">
        {t('ncm.selectNcmPlaylists')}
        {title && <span className="ml-2 text-lg opacity-50">— {title}</span>}
      </div>
      {creating ? (
        <form onSubmit={createAndAdd} className="mb-4 flex flex-wrap items-end gap-2">
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm">
            新歌单名称
            <input value={newPlaylistName} maxLength={100} onChange={(event) => setNewPlaylistName(event.target.value)}
              className="rounded-lg border border-black/15 bg-black/5 px-3 py-2 outline-none dark:border-white/15 dark:bg-white/5" />
          </label>
          <button type="submit" disabled={!newPlaylistName.trim() || busy}
            className="rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black">
            {busy ? '正在创建…' : '创建并添加'}
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setCreating(true)} className="mb-4 flex items-center gap-1 text-sm text-font-color-highlight dark:text-dark-font-color-highlight">
          <span className="material-icons-round text-lg">add</span>新建歌单
        </button>
      )}
      {error && <p role="alert" className="mb-3 text-sm text-red-500">{error}</p>}
      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-white/40">
          {t('common.loading')}
        </div>
      ) : playlistComponents ? (
        <div className="playlists-container mt-4 flex h-full flex-wrap">{playlistComponents}</div>
      ) : (
        <div className="flex h-32 items-center justify-center text-sm text-white/40">
          暂无歌单
        </div>
      )}
      <div className="buttons-and-other-info-container sticky bottom-0 z-10 -mx-8 flex items-center justify-end border-t border-white/10 bg-background-color-1/70 px-8 py-3 backdrop-blur-xl dark:bg-dark-background-color-1/70">
        <span className="text-font-color-highlight dark:text-dark-font-color-highlight mr-12">
          {t('common.selectionWithCount', { count: noOfSelectedPlaylists })}
        </span>
        <div className="buttons-container flex">
          <Button
            label={t('common.cancel')}
            iconName="close"
            clickHandler={() => changePromptMenuData(false)}
          />
          <Button
            label="添加到网易云歌单"
            iconName="playlist_add"
            clickHandler={addSongsToPlaylists}
            isDisabled={noOfSelectedPlaylists === 0 || busy}
            className="bg-background-color-3! text-font-color-black dark:bg-dark-background-color-3! dark:text-font-color-black! px-6"
          />
        </div>
      </div>
    </>
  );
};

export default NcmSelectPlaylistsPrompt;
