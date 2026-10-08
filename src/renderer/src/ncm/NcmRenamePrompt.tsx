/** NCM 歌单重命名弹窗 */
import { useCallback, useContext, useState } from 'react';
import { AppUpdateContext } from '../contexts/AppUpdateContext';
import { NeteaseSyncService } from './NeteaseSyncService';
import { NcmRepository } from './repository';
import Button from '../components/Button';

type Props = {
  name: string;
  playlistId: number; // NCM 正数 ID
  uid: number;
  onSuccess?: () => void;
};

export default function NcmRenamePrompt({ name, playlistId, uid, onSuccess }: Props) {
  const { changePromptMenuData, addNewNotifications } = useContext(AppUpdateContext);
  const [input, setInput] = useState(name);

  const rename = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === name) {
      changePromptMenuData(false);
      return;
    }
    NeteaseSyncService.renamePlaylist(playlistId, trimmed, uid)
      .then(() => {
        NcmRepository.invalidatePlaylist(playlistId);
        NcmRepository.invalidateUserPlaylists(uid);
        onSuccess?.();
        changePromptMenuData(false);
        addNewNotifications([{ id: 'ncmRenamed', iconName: 'check_circle', content: `已重命名为「${trimmed}」` }]);
      })
      .catch((err: Error) => addNewNotifications([{ id: 'ncmRenameErr', iconName: 'error', content: err.message }]));
  }, [input, name, playlistId, uid, changePromptMenuData, addNewNotifications]);

  return (
    <div className="flex flex-col items-center justify-center">
      <span className="mb-4 text-center text-2xl font-medium">重命名歌单</span>
      <input
        type="text"
        className="bg-background-color-2 text-font-color-black dark:bg-dark-background-color-2 dark:text-font-color-white w-full min-w-[400px] rounded-2xl border-[transparent] px-6 py-3 text-lg outline-hidden"
        value={input}
        autoFocus
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') rename(); }}
      />
      <div className="mt-6 flex gap-4">
        <Button label="取消" iconName="close" clickHandler={() => changePromptMenuData(false)} />
        <Button label="确认" iconName="check" className="bg-font-color-highlight! text-white! px-6" clickHandler={rename} />
      </div>
    </div>
  );
}
