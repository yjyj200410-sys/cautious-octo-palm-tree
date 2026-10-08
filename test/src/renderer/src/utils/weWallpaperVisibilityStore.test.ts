import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ state: {localStorage:{preferences:{hiddenWeWallpapers: undefined as {path:string;title:string}[] | undefined}}} }));
vi.mock('../../../../../src/renderer/src/store/store', () => ({store:fixture}));
vi.mock('../../../../../src/renderer/src/utils/localStorage', () => ({default:{preferences:{setPreferences:(key:string,value:{path:string;title:string}[]) => {
  if(key==='hiddenWeWallpapers') fixture.state.localStorage.preferences.hiddenWeWallpapers=value;
}}}}));
import { hideWeWallpaper, restoreWeWallpaper, restoreAllWeWallpapers, selectHiddenWeWallpapers } from '../../../../../src/renderer/src/store/wallpaperVisibilityStore';
import { isWeWallpaperHidden } from '../../../../../src/renderer/src/utils/weWallpaperVisibility';
beforeEach(() => { fixture.state.localStorage.preferences.hiddenWeWallpapers=undefined; });
describe('shared WE visibility settings', () => {
  it('allows old preference files without a hidden list', () => {
    expect(selectHiddenWeWallpapers(fixture.state as never)).toEqual([]);
  });
  it('shares hide and restore operations across both wallpaper entry points', () => {
    hideWeWallpaper('C:/Steam/123/index.html', '壁纸一');
    hideWeWallpaper('C:/Steam/456/video.mp4', '壁纸二');
    fixture.state.localStorage.preferences.hiddenWeWallpapers=JSON.parse(JSON.stringify(fixture.state.localStorage.preferences.hiddenWeWallpapers));
    expect(isWeWallpaperHidden('c:/steam/123/index.html',selectHiddenWeWallpapers(fixture.state as never))).toBe(true);
    restoreWeWallpaper('c:/steam/123/index.html');
    expect(selectHiddenWeWallpapers(fixture.state as never)).toEqual([{path:'C:/Steam/456/video.mp4',title:'壁纸二'}]);
    restoreAllWeWallpapers();
    expect(selectHiddenWeWallpapers(fixture.state as never)).toEqual([]);
  });
});
