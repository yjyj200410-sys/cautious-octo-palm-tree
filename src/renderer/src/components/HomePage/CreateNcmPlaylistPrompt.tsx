import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import { NeteaseSyncService } from '@renderer/ncm/NeteaseSyncService';
import { useContext, useState } from 'react';

export default function CreateNcmPlaylistPrompt({
  uid,
  onCreated
}: {
  uid: number;
  onCreated: () => void;
}) {
  const { changePromptMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      await NeteaseSyncService.createPlaylist(trimmed, uid);
      onCreated();
      changePromptMenuData(false);
      addNewNotifications([
        { id: 'ncmPlaylistCreated', iconName: 'playlist_add', content: `已创建「${trimmed}」` }
      ]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建歌单失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={create} className="flex flex-col gap-4 pb-6">
      <h2 className="text-xl font-semibold">创建歌单</h2>
      <label className="flex flex-col gap-2 text-sm">
        歌单名称
        <input
          value={name}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
          className="rounded-lg border border-black/12 bg-black/4 px-3 py-2 outline-none focus:border-black/35 dark:border-white/15 dark:bg-white/6 dark:focus:border-white/40"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!name.trim() || busy}
        className="self-end rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
      >
        {busy ? '正在创建…' : '创建'}
      </button>
    </form>
  );
}
