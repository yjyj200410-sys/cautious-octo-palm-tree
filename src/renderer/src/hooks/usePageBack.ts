import { useRouter } from '@tanstack/react-router';
import { openMusicFolders, openSettingsDrawer } from '@renderer/store/settingsStore';
import { takeFolderReturn } from '@renderer/utils/folderReturn';

/** Folder manager navigation restores its origin, independent of sort/filter history. */
export default function usePageBack() {
  const router = useRouter();
  return async () => {
    if (router.state.location.pathname.startsWith('/main-player/folders/')) {
      const destination = takeFolderReturn();
      if (destination) {
        await router.navigate({ to: destination.href, replace: true });
        if (destination.settingsOpen) openSettingsDrawer();
        openMusicFolders();
      } else {
        await router.navigate({ to: '/main-player/home', replace: true });
      }
      return;
    }
    if (router.history.canGoBack()) router.history.back();
    else await router.navigate({ to: '/main-player/home', replace: true });
  };
}
