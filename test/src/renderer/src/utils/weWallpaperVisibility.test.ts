import { describe, expect, it } from 'vitest';
import { addHiddenWeWallpaper, isWeWallpaperHidden, removeHiddenWeWallpaper, wallpaperPathKey } from '../../../../../src/renderer/src/utils/weWallpaperVisibility';

describe('WE wallpaper hidden records', () => {
  const first = { path: 'C:/Steam/431960/123/index.html', title: '旧账号壁纸' };
  const second = { path: 'C:/Steam/431960/456/video.mp4', title: '另一张壁纸' };
  it('matches a refreshed scan with different casing and Windows separators', () => {
    const path = first.path.toUpperCase().replaceAll('/', String.fromCharCode(92));
    expect(isWeWallpaperHidden(path, [first])).toBe(true);
    expect(wallpaperPathKey(path)).toBe(first.path.toLowerCase());
  });
  it('persists titles and paths across JSON storage and a new scan', () => {
    const saved = JSON.parse(JSON.stringify(addHiddenWeWallpaper([], first)));
    expect(isWeWallpaperHidden(first.path, saved)).toBe(true);
    expect(saved[0].title).toBe(first.title);
  });
  it('does not hide another wallpaper with a similar path', () => {
    expect(isWeWallpaperHidden('C:/Steam/431960/1234/index.html', [first])).toBe(false);
  });
  it('deduplicates repeat hides without modifying the original records', () => {
    const initial = [first];
    expect(addHiddenWeWallpaper(initial, {...first, path:first.path.toUpperCase()})).toBe(initial);
    expect(addHiddenWeWallpaper(initial, second)).toEqual([first,second]);
    expect(initial).toEqual([first]);
  });
  it('restores only the requested wallpaper, even if its source is currently absent', () => {
    expect(removeHiddenWeWallpaper([first,second], first.path.toUpperCase())).toEqual([second]);
    expect(removeHiddenWeWallpaper([first], 'missing')).toEqual([first]);
  });
});
