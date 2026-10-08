import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

type BgEntry = { name: string; path: string; type: 'image' | 'video'; cover?: string };

type Props = {
  currentPath?: string;
  onSelect: (path: string, type: 'image' | 'video') => void;
};

export default function BackgroundManager({ currentPath, onSelect }: Props) {
  const [entries, setEntries] = useState<BgEntry[]>([]);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: BgEntry } | null>(null);

  const refresh = useCallback(async () => {
    const list = await window.api.settingsHelpers.listBackgrounds();
    setEntries(list);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Refresh when a new background is saved (e.g. WE recording completes)
  useEffect(() => {
    window.api.fullscreen.onBackgroundsChanged(() => refresh());
  }, [refresh]);

  const handleUpload = async () => {
    const filePath = await window.api.settingsHelpers.selectCustomBackground();
    if (filePath) {
      refresh();
    }
  };

  const handleDelete = async (entry: BgEntry) => {
    const ok = await window.api.settingsHelpers.deleteBackground(entry.path);
    setCtxMenu(null);
    if (ok) {
      refresh();
      if (currentPath === entry.path) {
        // Current background was deleted — could clear or leave
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, entry: BgEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, entry });
  };

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-white/70">本地背景</span>
        <button
          className="text-xs text-font-color-highlight dark:text-dark-font-color-highlight cursor-pointer hover:underline"
          onClick={handleUpload}
        >
          + 添加
        </button>
      </div>
      {/* Built-in wallpapers — non-deletable, same card style as WE */}
      <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
        {[
          { id: 'http://127.0.0.1:25885/builtin/static-glow.html', type: 'we-web', label: '幻彩', color: 'linear-gradient(135deg, #24152e, #223348, #443038, #121629)', icon: 'auto_awesome' },
        ].map(({ id, type, label, color, icon }) => {
          const selected = currentPath === id;
          return (
            <div
              key={id}
              className={`group relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${
                selected
                  ? 'border-font-color-highlight dark:border-dark-font-color-highlight shadow-lg'
                  : 'border-transparent hover:border-white/30'
              }`}
              onClick={() => onSelect(id, type as any)}
              title={label}
            >
              <div className="aspect-video w-full overflow-hidden bg-black/30">
                <div style={{ width: '100%', height: '100%', background: color }} />
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="material-icons-round text-3xl text-white/30">{icon}</span>
                </div>
              </div>
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
                <span className="material-icons-round text-2xl text-white opacity-0 transition-opacity group-hover:opacity-100">
                  {selected ? 'check_circle' : 'add'}
                </span>
              </div>
              <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/50 px-1 py-0.5 text-[9px] text-white/70">内置</div>
              {selected && (
                <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-font-color-highlight text-white">
                  <span className="material-icons-round text-xs leading-none">check</span>
                </div>
              )}
              <div className="bg-black/60 px-1.5 py-1">
                <span className="block truncate text-xs text-white/90">{label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {entries.length === 0 ? (
        <div className="text-[10px] text-white/30 mt-1">暂无本地背景</div>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
          {entries.map((e) => {
            const selected = currentPath === e.path;
            return (
              <div
                key={e.path}
                className={`group relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${
                  selected
                    ? 'border-font-color-highlight dark:border-font-color-highlight shadow-lg'
                    : 'border-transparent hover:border-white/30'
                }`}
                onClick={() => onSelect(e.path, e.type)}
                onContextMenu={(ev) => handleContextMenu(ev, e)}
                title={e.name}
              >
                <div className="aspect-video w-full overflow-hidden bg-black/30">
                  {e.type === 'video' && e.cover ? (
                    <img
                      src={`file:///${e.cover.replace(/\\/g, '/')}`}
                      alt={e.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : e.type === 'video' ? (
                    <div className="w-full h-full flex items-center justify-center bg-white/5">
                      <span className="material-icons-round text-3xl text-white/30">movie</span>
                    </div>
                  ) : (
                    <img
                      src={`file:///${e.path.replace(/\\/g, '/')}`}
                      alt={e.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      onError={(ev) => { (ev.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <span className="material-icons-round text-3xl text-white/30">
                      {e.type === 'video' ? 'movie' : 'image'}
                    </span>
                  </div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
                  <span className="material-icons-round text-2xl text-white opacity-0 transition-opacity group-hover:opacity-100">
                    {selected ? 'check_circle' : 'add'}
                  </span>
                </div>
                <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/50 px-1 py-0.5 text-[9px] text-white/70">
                  {e.type === 'video' ? '视频' : '图片'}
                </div>
                {selected && (
                  <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-font-color-highlight text-white">
                    <span className="material-icons-round text-xs leading-none">check</span>
                  </div>
                )}
                <div className="bg-black/60 px-1.5 py-1">
                  <span className="block truncate text-xs text-white/90">{e.name}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Right-click context menu — portal to body to escape overflow clipping */}
      {ctxMenu && createPortal(
        <div
          className="fixed z-[9999] inset-0"
          onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()}
          onClick={(e) => { if (e.target === e.currentTarget) setCtxMenu(null); }}
          onContextMenu={(e) => { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); setCtxMenu(null); }}
        >
          <div
            className="absolute rounded-lg backdrop-blur-xl bg-background-color-1/90 dark:bg-dark-background-color-1/90 ring-1 ring-white/10 shadow-xl py-1 min-w-[100px]"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-white/10 cursor-pointer flex items-center gap-1.5"
              onClick={() => handleDelete(ctxMenu.entry)}
            >
              <span className="material-icons-round text-sm">delete</span>
              删除
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
