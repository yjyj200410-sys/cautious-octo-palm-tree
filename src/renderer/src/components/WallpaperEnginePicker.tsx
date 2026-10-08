import { useCallback, useEffect, useState, useMemo } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '../store/store';
import { hideWeWallpaper, selectHiddenWeWallpapers } from '../store/wallpaperVisibilityStore';
import { isWeWallpaperHidden } from '../utils/weWallpaperVisibility';
import HiddenWeWallpapersManager from './HiddenWeWallpapersManager';
import { createPortal } from 'react-dom';
import storage from '@renderer/utils/localStorage';
import WallpaperEngineRecorder from './WallpaperEngineRecorder';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PickerStatus =
  | 'idle'
  | 'loading'
  | 'notFound'
  | 'empty'
  | 'error'
  | 'grid';

interface WallpaperEnginePickerProps {
  customBackgroundPath?: string;
  customBackgroundType?: 'image' | 'video' | 'we-web' | 'we-scene';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toFileUrl(absPath: string): string {
  return `file:///${absPath.replace(/\\/g, '/')}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WallpaperEnginePicker({
  customBackgroundPath,
  customBackgroundType,
}: WallpaperEnginePickerProps) {
  const [status, setStatus] = useState<PickerStatus>('loading');
  const [wallpapers, setWallpapers] = useState<WallpaperEngineWallpaper[]>([]);
  const hidden = useStore(store, selectHiddenWeWallpapers);
  const visibleWallpapers = useMemo(() => wallpapers.filter((wp) => !isWeWallpaperHidden(wp.file, hidden)), [wallpapers, hidden]);
  const [errorMessage, setErrorMessage] = useState('');
  const [recordingWpFile, setRecordingWpFile] = useState<string | null>(null);
  const [ctxWp, setCtxWp] = useState<{ x: number; y: number; wp: WallpaperEngineWallpaper } | null>(null);

  const loadWallpapers = useCallback(async () => {
    setStatus('loading');
    setErrorMessage('');
    try {
      const result =
        await window.api.settingsHelpers.getWallpaperEngineWallpapers();

      if (result.fatalError) {
        setErrorMessage(result.fatalError);
        if (
          result.fatalError.includes('Steam') ||
          result.fatalError.includes('Wallpaper Engine')
        ) {
          setStatus('notFound');
        } else {
          setStatus('error');
        }
        return;
      }

      const videos = result.wallpapers;
      setWallpapers(videos);
      if (videos.length === 0) {
        setStatus('empty');
        return;
      }

      setStatus('grid');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    loadWallpapers();
  }, [loadWallpapers]);

  const selectWallpaper = useCallback(async (wp: WallpaperEngineWallpaper) => {
    const typeMap: Record<string, 'video' | 'we-web' | 'we-scene'> = {
      video: 'video', web: 'we-web', scene: 'we-scene',
    };
    const type = typeMap[wp.wallpaperType] || 'video';
    if (wp.wallpaperType === 'web' || wp.wallpaperType === 'scene') {
      const dir = wp.file.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
      const id = await window.api.settingsHelpers.registerWallpaper(dir);
      if (id) {
        const url = await window.api.settingsHelpers.getWallpaperUrl(id);
        storage.preferences.setPreferences('customBackgroundPath', url);
        storage.preferences.setPreferences('customBackgroundWallpaperId', id);
      } else {
        storage.preferences.setPreferences('customBackgroundPath', wp.file);
      }
    } else {
      storage.preferences.setPreferences('customBackgroundPath', wp.file);
    }
    storage.preferences.setPreferences('customBackgroundType', type);
    storage.preferences.setPreferences('backgroundSource', 'custom');
    storage.preferences.setPreferences('showCoverBackground', false);
  }, []);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

  const renderIdle = () => (
    <button
      className="bg-background-color-2 hover:bg-background-color-3 dark:bg-dark-background-color-2 dark:hover:bg-dark-background-color-3 cursor-pointer rounded-md px-4 py-2 text-sm transition-colors"
      onClick={loadWallpapers}
    >
      <span className="material-icons-round mr-1.5 align-middle text-base leading-none">
        wallpaper
      </span>
      加载 WE 壁纸
    </button>
  );

  const renderLoading = () => (
    <div className="flex items-center gap-2 text-sm text-font-color-black/50 dark:text-font-color-white/50">
      <span className="material-icons-round animate-spin text-base">sync</span>
      正在扫描...
    </div>
  );

  const renderNotFound = () => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-font-color-black/50 dark:text-font-color-white/50">
        <span className="material-icons-round text-base">info</span>
        {errorMessage || 'Wallpaper Engine 内容未找到'}
      </div>
      <button
        className="bg-background-color-2 hover:bg-background-color-3 dark:bg-dark-background-color-2 dark:hover:bg-dark-background-color-3 cursor-pointer rounded-md px-3 py-1.5 text-xs transition-colors"
        onClick={loadWallpapers}
      >
        重试
      </button>
    </div>
  );

  const renderEmpty = () => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-font-color-black/50 dark:text-font-color-white/50">
        <span className="material-icons-round text-base">movie</span>
        未找到视频壁纸
      </div>
      <button
        className="bg-background-color-2 hover:bg-background-color-3 dark:bg-dark-background-color-2 dark:hover:bg-dark-background-color-3 cursor-pointer rounded-md px-3 py-1.5 text-xs transition-colors"
        onClick={loadWallpapers}
      >
        重试
      </button>
    </div>
  );

  const renderError = () => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-red-500">
        <span className="material-icons-round text-base">error</span>
        {errorMessage || '扫描失败'}
      </div>
      <button
        className="bg-background-color-2 hover:bg-background-color-3 dark:bg-dark-background-color-2 dark:hover:bg-dark-background-color-3 cursor-pointer rounded-md px-3 py-1.5 text-xs transition-colors"
        onClick={loadWallpapers}
      >
        重试
      </button>
    </div>
  );

  const renderWallpaperCard = (wp: WallpaperEngineWallpaper) => {
    const typeMap: Record<string, string> = { video: 'video', web: 'we-web', scene: 'we-scene' };
    const selected = customBackgroundPath === wp.file && customBackgroundType === typeMap[wp.wallpaperType];
    return (
      <button
        key={wp.file}
        className={`group relative cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${
          selected
            ? 'border-font-color-highlight dark:border-font-color-highlight shadow-lg'
            : 'border-transparent hover:border-white/30'
        }`}
        onClick={() => {
          if (wp.wallpaperType === 'scene') setRecordingWpFile(wp.file);
          else {
            setRecordingWpFile(null);
            selectWallpaper(wp);
          }
          setCtxWp(null);
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setCtxWp({ x: e.clientX, y: e.clientY, wp }); }}
        title={wp.title}
      >
        <div className="aspect-video w-full overflow-hidden bg-black/30">
          {wp.preview ? (
            <img src={toFileUrl(wp.preview)} alt={wp.title} loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          ) : null}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="material-icons-round text-3xl text-white/30">
              {wp.wallpaperType === 'web' ? 'language' : wp.wallpaperType === 'scene' ? 'auto_awesome' : 'movie'}
            </span>
          </div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <span className="material-icons-round text-2xl text-white opacity-0 transition-opacity group-hover:opacity-100">
            {selected ? 'check_circle' : 'add'}
          </span>
        </div>
        <div className="pointer-events-none absolute left-1 top-1 rounded bg-black/50 px-1 py-0.5 text-[9px] text-white/70">
          {wp.wallpaperType === 'web' ? '网页' : wp.wallpaperType === 'scene' ? '场景' : '视频'}
        </div>
        {selected && (
          <div className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-font-color-highlight text-white">
            <span className="material-icons-round text-xs leading-none">check</span>
          </div>
        )}
        <div className="bg-black/60 px-1.5 py-1">
          <span className="block truncate text-xs text-white/90">{wp.title}</span>
        </div>
      </button>
    );
  };

  const categories: { type: 'scene' | 'video' | 'web'; label: string; icon: string }[] = [
    { type: 'video', label: '视频壁纸', icon: 'movie' },
    { type: 'web', label: '网页壁纸', icon: 'language' },
    { type: 'scene', label: '场景壁纸', icon: 'auto_awesome' },
  ];

  const renderGrid = () => (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-font-color-black/50 dark:text-font-color-white/50 text-xs">
          发现 {visibleWallpapers.length} 个壁纸
        </span>
        <button
          className="text-font-color-black/40 hover:text-font-color-black/60 dark:text-font-color-white/40 dark:hover:text-font-color-white/60 cursor-pointer text-xs transition-colors"
          onClick={loadWallpapers}
        >
          <span className="material-icons-round mr-1 align-middle text-xs leading-none">refresh</span>
          刷新
        </button>
      </div>

      {visibleWallpapers.length === 0 && <p className="py-3 text-xs opacity-60">所有 WE 壁纸均已隐藏，可在隐藏列表中恢复。</p>}
      {categories.map(({ type, label, icon }) => {
        const items = visibleWallpapers.filter((w) => w.wallpaperType === type);
        if (items.length === 0) return null;
        return (
          <div key={type} className="mb-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] text-font-color-black/40 dark:text-font-color-white/40">
              <span className="material-icons-round text-xs">{icon}</span>
              <span>{label}</span>
              <span className="text-[10px]">({items.length})</span>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
              {items.map(renderWallpaperCard)}
            </div>
            {type === 'scene' && (() => {
              const rwp = visibleWallpapers.find(w => w.file === recordingWpFile);
              if (!rwp) return null;
              return (
                <div className="mt-2">
                  <WallpaperEngineRecorder
                    key={rwp.file}
                    wallpaperPath={rwp.file}
                    wallpaperTitle={rwp.title}
                    onDone={() => { setRecordingWpFile(null); loadWallpapers(); }}
                    onClose={() => setRecordingWpFile(null)}
                  />
                </div>
              );
            })()}
          </div>
        );
      })}

      {ctxWp && createPortal(
        <div className="fixed z-[9999] inset-0" role="dialog" aria-label="壁纸操作" tabIndex={-1} ref={(element) => { element?.focus(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setCtxWp(null); } }}
          onMouseDown={(e) => e.nativeEvent.stopImmediatePropagation()}
          onClick={(e) => { if (e.target === e.currentTarget) setCtxWp(null); }}
          onContextMenu={(e) => { e.preventDefault(); e.nativeEvent.stopImmediatePropagation(); setCtxWp(null); }}
        >
          <div className="absolute rounded-lg backdrop-blur-xl bg-background-color-1/90 dark:bg-dark-background-color-1/90 ring-1 ring-white/10 shadow-xl py-1 min-w-[100px]"
            style={{ left: ctxWp.x, top: ctxWp.y }}>
            <button
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-white/10 cursor-pointer flex items-center gap-1.5"
              onClick={() => {
                hideWeWallpaper(ctxWp.wp.file, ctxWp.wp.title);
                if (recordingWpFile === ctxWp.wp.file) setRecordingWpFile(null);
                setCtxWp(null);
              }}
            >
              <span className="material-icons-round text-sm">visibility_off</span>
              隐藏此壁纸
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );

  // -----------------------------------------------------------------------
  // Main render
  // -----------------------------------------------------------------------

  return (
    <div className="wallpaper-engine-picker">
      <div className="mb-3"><HiddenWeWallpapersManager /></div>
      {status === 'idle' && renderIdle()}
      {status === 'loading' && renderLoading()}
      {status === 'notFound' && renderNotFound()}
      {status === 'empty' && renderEmpty()}
      {status === 'error' && renderError()}
      {status === 'grid' && renderGrid()}
    </div>
  );
}
