import NoFoldersImage from '@assets/images/svg/Empty Inbox _Monochromatic.svg';
import { AppUpdateContext } from '@renderer/contexts/AppUpdateContext';
import { closeMusicFolders, closeSettingsDrawer, settingsStore } from '@renderer/store/settingsStore';
import { rememberFolderReturn } from '@renderer/utils/folderReturn';
import { store } from '@renderer/store/store';
import storage from '@renderer/utils/localStorage';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { lazy, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Button from '../Button';
import Dropdown from '../Dropdown';
import Img from '../Img';
import Folder from './Folder';
import { folderDropdownOptions } from './folderOptions';
import ManagementDialog from '../ManagementDialog';

const AddMusicFoldersPrompt = lazy(() => import('./AddMusicFoldersPrompt'));

const MusicFoldersOverlay = () => {
  const isOpen = useStore(settingsStore, (state) => state.isMusicFoldersOpen);
  const savedSorting = useStore(
    store,
    (state) => state.localStorage.sortingStates.musicFoldersPage,
  );
  const [sortingOrder, setSortingOrder] = useState<FolderSortTypes>(
    savedSorting || 'aToZ',
  );
  const [musicFolders, setMusicFolders] = useState<MusicFolder[]>([]);
  const { changePromptMenuData } = useContext(AppUpdateContext);
  const navigate = useNavigate();
  const router = useRouter();
  const { t } = useTranslation();

  const fetchFolders = useCallback(() => {
    return window.api.folderData
      .getFolderData([], sortingOrder)
      .then((folders) => setMusicFolders(Array.isArray(folders) ? folders : []))
      .catch((error) => console.error(error));
  }, [sortingOrder]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchFolders();
    const onDataUpdate = () => void fetchFolders();
    document.addEventListener('app/dataUpdates', onDataUpdate);
    return () => document.removeEventListener('app/dataUpdates', onDataUpdate);
  }, [fetchFolders, isOpen]);

  const openFolder = useCallback(
    (folderPath: string) => {
      rememberFolderReturn({ href: router.state.location.href, settingsOpen: settingsStore.state.isOpen });
      closeMusicFolders();
      closeSettingsDrawer();
      navigate({
        to: '/main-player/folders/$folderPath',
        params: { folderPath },
      });
    },
    [navigate, router],
  );

  const folderRows = useMemo(
    () =>
      musicFolders.map((folder, index) => (
        <Folder
          key={folder.path}
          folderPath={folder.path}
          subFolders={folder.subFolders}
          index={index}
          isBlacklisted={folder.isBlacklisted}
          songIds={folder.songIds}
          selectAllHandler={() => {}}
          onOpen={openFolder}
        />
      )),
    [musicFolders, openFolder],
  );

  const addFolder = useCallback(() => {
    changePromptMenuData(
      true,
      <AddMusicFoldersPrompt onFailure={(error) => console.error(error)} />,
    );
  }, [changePromptMenuData]);

  return (
    <ManagementDialog open={isOpen} onClose={closeMusicFolders} label={t('foldersPage.musicFolders')} className="h-[72vh] w-[min(900px,86vw)]">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-black/10 px-6 py-4 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="material-icons-round text-font-color-highlight dark:text-dark-font-color-highlight text-2xl">
              folder
            </span>
            <h2 className="text-font-color-black dark:text-font-color-white truncate text-lg font-medium">
              {t('foldersPage.musicFolders')}
            </h2>
            <span className="text-font-color-black/40 dark:text-font-color-white/40 text-xs">
              {t('common.folderWithCount', { count: musicFolders.length })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              label={t('foldersPage.addFolder')}
              iconName="create_new_folder"
              iconClassName="material-icons-round-outlined"
              clickHandler={addFolder}
            />
            <Dropdown
              name="musicFoldersOverlaySort"
              value={sortingOrder}
              options={folderDropdownOptions}
              onChange={(event) => {
                const nextOrder = event.currentTarget.value as FolderSortTypes;
                setSortingOrder(nextOrder);
                storage.sortingStates.setSortingStates('musicFoldersPage', nextOrder);
              }}
            />
            <button
              className="text-font-color-black/60 dark:text-font-color-white/60 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-black/5 dark:hover:bg-white/10"
              onClick={closeMusicFolders}
              title={t('titleBar.close')}
              aria-label={t('titleBar.close')}
            >
              <span className="material-icons-round text-xl">close</span>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {musicFolders.length > 0 ? (
            folderRows
          ) : (
            <div className="text-font-color-black/55 dark:text-font-color-white/55 flex h-full flex-col items-center justify-center gap-3 text-sm">
              <Img src={NoFoldersImage} className="w-44 opacity-80" />
              <p>{t('foldersPage.empty')}</p>
              <Button
                label={t('foldersPage.addFolder')}
                iconName="create_new_folder"
                iconClassName="material-icons-round-outlined"
                clickHandler={addFolder}
              />
            </div>
          )}
        </div>
    </ManagementDialog>
  );
};

export default MusicFoldersOverlay;
