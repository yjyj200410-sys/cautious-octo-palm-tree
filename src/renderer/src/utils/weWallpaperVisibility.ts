export type HiddenWeWallpaper = { path: string; title: string };

/** Windows paths can differ in slash style or casing across scans. */
export const wallpaperPathKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

export const isWeWallpaperHidden = (path: string, hidden: HiddenWeWallpaper[]) =>
  hidden.some((item) => wallpaperPathKey(item.path) === wallpaperPathKey(path));

export const addHiddenWeWallpaper = (hidden: HiddenWeWallpaper[], item: HiddenWeWallpaper) => {
  if (isWeWallpaperHidden(item.path, hidden)) return hidden;
  return [...hidden, { path: item.path, title: item.title }];
};

export const removeHiddenWeWallpaper = (hidden: HiddenWeWallpaper[], path: string) =>
  hidden.filter((item) => wallpaperPathKey(item.path) !== wallpaperPathKey(path));
