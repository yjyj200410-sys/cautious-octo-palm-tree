import { store } from './store';
import storage from '../utils/localStorage';
import { addHiddenWeWallpaper, removeHiddenWeWallpaper, type HiddenWeWallpaper } from '../utils/weWallpaperVisibility';

const EMPTY_HIDDEN: HiddenWeWallpaper[] = [];
export const selectHiddenWeWallpapers = (state: typeof store.state) => state.localStorage.preferences?.hiddenWeWallpapers ?? EMPTY_HIDDEN;
export const hideWeWallpaper = (path: string, title: string) => {
  storage.preferences.setPreferences('hiddenWeWallpapers', addHiddenWeWallpaper(selectHiddenWeWallpapers(store.state), { path, title }));
};
export const restoreWeWallpaper = (path: string) => {
  storage.preferences.setPreferences('hiddenWeWallpapers', removeHiddenWeWallpaper(selectHiddenWeWallpapers(store.state), path));
};
export const restoreAllWeWallpapers = () => storage.preferences.setPreferences('hiddenWeWallpapers', []);
