import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store/store';
import { selectHiddenWeWallpapers } from '../../store/wallpaperVisibilityStore';
import { isWeWallpaperHidden } from '../../utils/weWallpaperVisibility';
import { applyWallpaper, loadWallpapers, toggleFavorite, type WallpaperItem } from './wallpaperData';

const EMPTY_FAVORITES: string[] = [];

export default function FavoriteWallpapers() {
  const favoriteIds = useStore(store, (s) => s.localStorage.preferences?.customBackgroundFavorites ?? EMPTY_FAVORITES);
  const currentPath = useStore(store, (s) => s.localStorage.preferences?.customBackgroundPath);
  const currentType = useStore(store, (s) => s.localStorage.preferences?.customBackgroundType);
  const hidden = useStore(store, selectHiddenWeWallpapers);
  const [items, setItems] = useState<WallpaperItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!favoriteIds.length) { setItems([]); setLoading(false); return; }
    setLoading(true);
    void loadWallpapers().then((result) => {
      if (!cancelled) { setItems(result.items); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [favoriteIds]);

  const favorites = useMemo(() => favoriteIds.map((id) => items.find((item) => item.id === id))
    .filter((item): item is WallpaperItem => !!item && (item.source !== 'we' || !isWeWallpaperHidden(item.path, hidden))), [favoriteIds, items, hidden]);

  const selectWallpaper = useCallback(async (item: WallpaperItem) => {
    setError('');
    try { await applyWallpaper(item); }
    catch { setError('壁纸应用失败，请在壁纸中心检查文件是否可用。'); }
  }, []);

  return (
    <section className="secondary-container mb-4 p-3" aria-label="收藏的壁纸">
      <div className="mb-3 flex items-center justify-between">
        <div className="description mb-0!">收藏的壁纸</div>
        <span className="text-font-color/45 text-xs tabular-nums">{favorites.length}</span>
      </div>
      {loading && <p role="status" className="text-font-color/50 py-2 text-xs">正在加载收藏…</p>}
      {!loading && !favorites.length && <p className="text-font-color/50 text-xs leading-relaxed">在壁纸中心收藏壁纸，即可在这里快速切换。</p>}
      <div className="grid grid-cols-2 gap-2">
        {favorites.map((item) => {
          const applied = item.path === currentPath && item.type === currentType;
          return (
            <div key={item.id} className={`min-w-0 overflow-hidden rounded-lg border ${applied ? 'border-font-color-highlight dark:border-dark-font-color-highlight' : 'border-black/8 dark:border-white/10'}`}>
              <button type="button" onClick={() => void selectWallpaper(item)} title={item.title}
                aria-label={`应用壁纸：${item.title}`}
                className="relative block aspect-video w-full cursor-pointer overflow-hidden bg-black/20 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-font-color-highlight">
                {item.previewUrl ? <img src={item.previewUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  : <div className="flex h-full items-center justify-center" style={{ background: item.builtinColor }}><span className="material-icons-round text-2xl text-white/55" aria-hidden="true">{item.builtinIcon ?? 'wallpaper'}</span></div>}
                {applied && <span className="material-icons-round absolute right-1.5 bottom-1.5 rounded-full bg-black/45 p-1 text-xs text-white" aria-hidden="true">check</span>}
              </button>
              <div className="flex items-center gap-1 bg-black/3 px-2 py-1 dark:bg-white/3">
                <span className="text-font-color/75 min-w-0 flex-1 truncate text-[11px]" title={item.title}>{item.title}</span>
                <button type="button" onClick={() => toggleFavorite(item.id)} aria-label={`取消收藏：${item.title}`} title="取消收藏"
                  className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-amber-500 hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-font-color-highlight dark:hover:bg-white/5">
                  <span className="material-icons-round text-sm" aria-hidden="true">star</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}

    </section>
  );
}
