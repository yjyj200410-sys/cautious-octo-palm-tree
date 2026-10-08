import { useStore } from '@tanstack/react-store';
import { store } from '../store/store';
import { selectHiddenWeWallpapers, restoreWeWallpaper, restoreAllWeWallpapers } from '../store/wallpaperVisibilityStore';

export default function HiddenWeWallpapersManager() {
  const hidden = useStore(store, selectHiddenWeWallpapers);
  return (
    <details className="shrink-0 rounded-lg bg-black/5 p-3 text-xs text-font-color-black dark:bg-white/5 dark:text-font-color-white">
      <summary className="cursor-pointer select-none">已隐藏的 WE 壁纸（{hidden.length}）</summary>
      <p className="mt-2 text-font-color-black/60 dark:text-font-color-white/60">隐藏记录会保留，恢复后壁纸会重新出现在列表中。</p>
      {hidden.length === 0 ? <p className="mt-2 opacity-60">没有隐藏的壁纸</p> : (
        <>
          <div className="mt-2 max-h-40 overflow-y-auto">
            {hidden.map((item) => (
              <div key={item.path} className="flex items-center justify-between gap-3 border-b border-black/5 py-2 dark:border-white/5">
                <span className="min-w-0 truncate" title={item.title}>{item.title}</span>
                <button type="button" className="shrink-0 cursor-pointer rounded-md px-2 py-1 hover:bg-black/10 focus-visible:outline dark:hover:bg-white/10" onClick={() => restoreWeWallpaper(item.path)} aria-label={'恢复显示 ' + item.title}>恢复显示</button>
              </div>
            ))}
          </div>
          <button type="button" className="mt-2 cursor-pointer rounded-md px-2 py-1 hover:bg-black/10 focus-visible:outline dark:hover:bg-white/10" onClick={restoreAllWeWallpapers}>全部恢复</button>
        </>
      )}
    </details>
  );
}
