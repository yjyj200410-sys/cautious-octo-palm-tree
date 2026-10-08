/**
 * WallpaperCenter 数据层:统一三类壁纸来源(WE / 内置 / 本地背景)为单一 WallpaperItem,
 * 提供加载、应用(保留 WallpaperEnginePicker / BackgroundManager 原有持久化逻辑)、
 * 收藏(localStorage preferences.customBackgroundFavorites)能力。
 *
 * 不改动被 FullScreenSettings 复用的原组件,仅在本页做归一化。
 */
import { store } from '@renderer/store/store';

import storage from '@renderer/utils/localStorage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 页面分类 tabs */
export type WallpaperCategory = 'all' | 'we-web' | 'we-video' | 'we-scene' | 'builtin' | 'local' | 'favorites';

export type WallpaperItem = {
  /** 网格唯一 key / 收藏 id */
  id: string;
  title: string;
  /** 来源:WE 壁纸 / 内置 / 本地背景 */
  source: 'we' | 'builtin' | 'local';
  /** 持久化到 preferences.customBackgroundType 的值 */
  type: 'video' | 'we-web' | 'we-scene' | 'image' | 'music-string' | '__none__';
  /** 持久化到 preferences.customBackgroundPath 的值(file 路径或 http URL) */
  path: string;
  /** 网格缩略图(file:// 或 http URL) */
  previewUrl?: string;
  /** 内置壁纸:渐变卡片样式 */
  builtinColor?: string;
  /** 内置壁纸:Material 图标 */
  builtinIcon?: string;
  /** WE web/scene:应用时需先 registerWallpaper 的源目录(与 WallpaperEnginePicker 同逻辑) */
  sourceDir?: string;
  /** 本地视频封面 */
  cover?: string;
  /** 本地背景可删除 */
  deletable?: boolean;
};

// ---------------------------------------------------------------------------
// 内置壁纸(仅保留幻彩，与 BackgroundManager 一致)
// ---------------------------------------------------------------------------

const BUILTIN_WALLPAPERS: WallpaperItem[] = [
  {
    id: 'static-glow',
    title: '幻彩',
    source: 'builtin',
    type: 'we-web',
    path: 'http://127.0.0.1:25885/builtin/static-glow.html',
    builtinColor: 'linear-gradient(135deg, #24152e, #223348, #443038, #121629)',
    builtinIcon: 'auto_awesome'
  }
];

// ---------------------------------------------------------------------------
// 加载
// ---------------------------------------------------------------------------

const toFileUrl = (absPath: string) => `file:///${absPath.replace(/\\/g, '/')}`;

export type LoadResult = {
  items: WallpaperItem[];
  /** WE 扫描未就绪时的提示(fatalError / 空),null 表示正常 */
  weNotice: string | null;
};

export async function loadWallpapers(): Promise<LoadResult> {
  const items: WallpaperItem[] = [...BUILTIN_WALLPAPERS];
  let weNotice: string | null = null;

  // WE 壁纸(逻辑与 WallpaperEnginePicker 一致:致命错误 → 提示,空 → 提示)
  try {
    const result = await window.api.settingsHelpers.getWallpaperEngineWallpapers();
    if (result.fatalError) {
      weNotice = result.fatalError;
    } else if (result.wallpapers.length === 0) {
      weNotice = 'no-we-wallpapers';
    } else {
      for (const wp of result.wallpapers) {
        const type =
          wp.wallpaperType === 'video' ? 'video' : wp.wallpaperType === 'web' ? 'we-web' : 'we-scene';
        items.push({
          id: `we:${wp.file}`,
          title: wp.title,
          source: 'we',
          type,
          path: wp.file,
          previewUrl: wp.preview ? toFileUrl(wp.preview) : undefined,
          sourceDir:
            wp.wallpaperType === 'web' || wp.wallpaperType === 'scene'
              ? wp.file.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
              : undefined
        });
      }
    }
  } catch (err) {
    weNotice = err instanceof Error ? err.message : 'Unknown error';
  }

  // 本地背景(与 BackgroundManager 一致)
  try {
    const backgrounds = await window.api.settingsHelpers.listBackgrounds();
    for (const b of backgrounds) {
      items.push({
        id: `local:${b.path}`,
        title: b.name,
        source: 'local',
        type: b.type === 'video' ? 'video' : 'image',
        path: b.path,
        previewUrl: b.cover ? toFileUrl(b.cover) : toFileUrl(b.path),
        cover: b.cover,
        deletable: true
      });
    }
  } catch {
    // 本地背景读取失败静默(不影响其余壁纸)
  }

  return { items, weNotice };
}

// ---------------------------------------------------------------------------
// 应用(保留原组件持久化逻辑)
// ---------------------------------------------------------------------------

export async function applyWallpaper(item: WallpaperItem): Promise<void> {
  const { setPreferences } = storage.preferences;

  if (item.sourceDir) {
    // WE web/scene:注册服务器 → 解析 URL(WallpaperEnginePicker.selectWallpaper 同逻辑)
    const id = await window.api.settingsHelpers.registerWallpaper(item.sourceDir);
    if (id) {
      const url = await window.api.settingsHelpers.getWallpaperUrl(id);
      setPreferences('customBackgroundPath', url);
      setPreferences('customBackgroundWallpaperId', id);
    } else {
      setPreferences('customBackgroundPath', item.path);
    }
  } else {
    setPreferences('customBackgroundPath', item.path);
  }

  setPreferences('customBackgroundType', item.type);
  setPreferences('backgroundSource', 'custom');
  setPreferences('showCoverBackground', false);
}

// ---------------------------------------------------------------------------
// 收藏(localStorage preferences.customBackgroundFavorites)
// ---------------------------------------------------------------------------

export function getFavoriteIds(): string[] {
  return store.state.localStorage.preferences?.customBackgroundFavorites ?? [];
}

/** 切换收藏,返回切换后的收藏态 */
export function toggleFavorite(id: string): boolean {
  const favs = getFavoriteIds();
  const next = favs.includes(id) ? favs.filter((f) => f !== id) : [...favs, id];
  storage.preferences.setPreferences('customBackgroundFavorites', next);
  return next.includes(id);
}

// ---------------------------------------------------------------------------
// 分类 + 搜索过滤
// ---------------------------------------------------------------------------

export function filterWallpapers(
  items: WallpaperItem[],
  category: WallpaperCategory,
  query: string,
  favoriteIds: Set<string>
): WallpaperItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((it) => {
    if (category === 'favorites' && !favoriteIds.has(it.id)) return false;
    if (category === 'we-web' && (it.source !== 'we' || it.type !== 'we-web')) return false;
    if (category === 'we-video' && (it.source !== 'we' || it.type !== 'video')) return false;
    if (category === 'we-scene' && (it.source !== 'we' || it.type !== 'we-scene')) return false;
    if (category === 'builtin' && it.source !== 'builtin') return false;
    if (category === 'local' && it.source !== 'local') return false;
    if (q && !it.title.toLowerCase().includes(q)) return false;
    return true;
  });
}
