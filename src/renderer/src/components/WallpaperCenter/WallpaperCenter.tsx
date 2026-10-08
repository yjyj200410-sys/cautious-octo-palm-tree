/**
 * WallpaperCenter 壁纸中心大浮窗(Settings 2.0 Phase 2)。
 *
 * 在 SettingsDrawer 内以浮层形式打开(不占独立路由),使用与独立页相同的组件逻辑。
 * 将 WallpaperEnginePicker / WebWallpaperSettings / BackgroundManager 整合为统一壁纸网格:
 * - 5 分类:WE网页 / WE视频 / WE场景 / 内置 / 本地
 * - 响应式多列网格 + react-virtuoso 虚拟滚动(大量壁纸不卡顿)
 * - 搜索入口
 * - 右侧预览区:选中壁纸预览 + 应用/收藏/删除;下方常驻网页壁纸设置
 * - 应用逻辑与收藏持久化见 wallpaperData.ts(保留原组件行为)
 */
import { useStore } from '@tanstack/react-store';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { VirtuosoGrid } from 'react-virtuoso';
import { closeWallpaperCenter, settingsStore } from '@renderer/store/settingsStore';
import HiddenWeWallpapersManager from '../HiddenWeWallpapersManager';
import { hideWeWallpaper, selectHiddenWeWallpapers } from '../../store/wallpaperVisibilityStore';
import { isWeWallpaperHidden } from '../../utils/weWallpaperVisibility';
import WebWallpaperSettings from '../WebWallpaperSettings';
import WallpaperEngineRecorder from '../WallpaperEngineRecorder';
import ManagementDialog from '../ManagementDialog';
import { store } from '@renderer/store/store';
import {
  type WallpaperCategory,
  type WallpaperItem,
  applyWallpaper,
  filterWallpapers,
  loadWallpapers,
  toggleFavorite
} from './wallpaperData';

const EMPTY_FAVORITES: string[] = [];

const CATEGORIES = [
  { key: 'all', icon: 'apps', labelKey: 'wallpaperCenterPage.categories.all' },
  { key: 'we-web', icon: 'language', labelKey: 'wallpaperCenterPage.categories.weWeb' },
  { key: 'we-video', icon: 'movie', labelKey: 'wallpaperCenterPage.categories.weVideo' },
  { key: 'we-scene', icon: 'auto_awesome', labelKey: 'wallpaperCenterPage.categories.weScene' },
  { key: 'builtin', icon: 'wallpaper', labelKey: 'wallpaperCenterPage.categories.builtin' },
  { key: 'local', icon: 'photo_library', labelKey: 'wallpaperCenterPage.categories.local' },
  { key: 'favorites', icon: 'star', labelKey: 'wallpaperCenterPage.categories.favorites' }
] as const;

const TYPE_LABEL = {
  video: 'wallpaperCenterPage.typeLabel.video',
  'we-web': 'wallpaperCenterPage.typeLabel.weWeb',
  'we-scene': 'wallpaperCenterPage.typeLabel.weScene',
  image: 'wallpaperCenterPage.typeLabel.image',
  'music-string': 'wallpaperCenterPage.typeLabel.musicString',
  __none__: 'wallpaperCenterPage.typeLabel.frostedGlass'
} as const;

function WallpaperCenterOverlay() {
  const { t } = useTranslation();
  const isOpen = useStore(settingsStore, (s) => s.isWallpaperCenterOpen);
  const customBackgroundPath = useStore(store, (s) => s.localStorage.preferences?.customBackgroundPath);
  const customBackgroundType = useStore(store, (s) => s.localStorage.preferences?.customBackgroundType);
  const favoriteIds = useStore(
    store,
    (s) => s.localStorage.preferences?.customBackgroundFavorites ?? EMPTY_FAVORITES
  );
  const hidden = useStore(store, selectHiddenWeWallpapers);
  const favoriteSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

  const [items, setItems] = useState<WallpaperItem[]>([]);
  const [weNotice, setWeNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<WallpaperCategory>('we-web');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [recordingItem, setRecordingItem] = useState<WallpaperItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await loadWallpapers();
    setItems(result.items);
    setWeNotice(result.weNotice);
    setLoading(false);
    return result;
  }, []);

  // 打开时加载数据,关闭时重置状态
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setCategory('we-web');
      setSelectedId(null);
      setRecordingItem(null);
      refresh();
    }
  }, [isOpen, refresh]);



  const visibleItems = useMemo(() => items.filter((item) => item.source !== 'we' || !isWeWallpaperHidden(item.path, hidden)), [items, hidden]);

  // 默认选中当前应用中的壁纸
  useEffect(() => {
    if ((selectedId && visibleItems.some((item) => item.id === selectedId)) || visibleItems.length === 0) return;
    const applied = visibleItems.find((i) => i.path === customBackgroundPath);
    setSelectedId(applied?.id ?? visibleItems[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleItems, customBackgroundPath, isOpen, selectedId]);

  const filtered = useMemo(
    () => filterWallpapers(visibleItems, category, query, favoriteSet),
    [visibleItems, category, query, favoriteSet]
  );

  const selectedItem = useMemo(
    () => visibleItems.find((i) => i.id === selectedId) ?? null,
    [visibleItems, selectedId]
  );

  // An open recording panel follows the selection; closing it keeps it closed.
  useEffect(() => {
    setRecordingItem((current) => current
      ? selectedItem?.type === 'we-scene' ? selectedItem : null
      : null);
  }, [selectedItem]);

  const isApplied = (item: WallpaperItem) =>
    item.path === customBackgroundPath && item.type === customBackgroundType;

  const handleApply = useCallback(async (item: WallpaperItem) => {
    if (item.type === 'we-scene') {
      setRecordingItem(item);
      return;
    }
    await applyWallpaper(item);
  }, []);

  const handleRecordingDone = useCallback(async () => {
    setRecordingItem(null);
    const result = await refresh();
    const path = store.state.localStorage.preferences?.customBackgroundPath;
    const recorded = result.items.find((item) => item.source === 'local' && item.path === path);
    if (recorded) {
      setCategory('local');
      setQuery('');
      setSelectedId(recorded.id);
    }
  }, [refresh]);

  const handleToggleFavorite = useCallback((item: WallpaperItem) => {
    toggleFavorite(item.id);
  }, []);

  const handleDelete = useCallback(
    async (item: WallpaperItem) => {
      if (!item.deletable) return;
      const ok = await window.api.settingsHelpers.deleteBackground(item.path);
      if (ok) refresh();
    },
    [refresh]
  );

  const handleAddLocal = useCallback(async () => {
    const filePath = await window.api.settingsHelpers.selectCustomBackground();
    if (filePath) refresh();
  }, [refresh]);

  const renderThumb = (item: WallpaperItem, className = '') => (
    <div className={`relative aspect-video w-full overflow-hidden bg-black/30 ${className}`}>
      {item.previewUrl ? (
        <img
          src={item.previewUrl}
          alt={item.title}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', background: item.builtinColor }} />
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="material-icons-round text-3xl text-white/30">
          {item.builtinIcon ??
            (item.type === 'video'
              ? 'movie'
              : item.type === 'we-web'
                ? 'language'
                : item.type === 'we-scene'
                  ? 'auto_awesome'
                  : 'image')}
        </span>
      </div>
    </div>
  );

  const renderTypeBadge = (item: WallpaperItem) => (
    <span className="pointer-events-none absolute left-1 top-1 z-10 rounded bg-black/50 px-1 py-0.5 text-[9px] text-white/70">
      {item.source === 'builtin' ? t('wallpaperCenterPage.typeLabel.builtin') : t(TYPE_LABEL[item.type])}
    </span>
  );

  const renderCard = (index: number) => {
    const item = filtered[index];
    if (!item) return null;
    const selected = selectedItem?.id === item.id;
    const applied = isApplied(item);
    const favorite = favoriteSet.has(item.id);
    return (
      <button
        className={`group relative w-full cursor-pointer overflow-hidden rounded-lg border-2 transition-all ${
          selected
            ? 'border-font-color-highlight shadow-lg dark:border-dark-font-color-highlight'
            : 'border-transparent hover:border-white/30'
        }`}
        onClick={() => setSelectedId(item.id)}
        title={item.title}
      >
        {renderThumb(item)}
        {renderTypeBadge(item)}
        <button
          className={`absolute right-1 top-1 z-10 flex h-8 w-8 items-center justify-center transition-colors ${
            favorite ? 'text-amber-500' : 'text-white/70 hover:text-white'
          }`}

          onClick={(e) => { e.stopPropagation(); handleToggleFavorite(item); }}
          title={favorite ? t('wallpaperCenterPage.removeFromFavorites') : t('wallpaperCenterPage.addToFavorites')}
        >
          <span className={`material-icons-round text-2xl leading-none drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] ${favorite ? 'text-amber-500' : 'material-icons-round-outlined'}`}>
            star
          </span>
        </button>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/40">
          <span className="material-icons-round text-2xl text-white opacity-0 transition-opacity group-hover:opacity-100">
            {applied ? 'check_circle' : 'add'}
          </span>
        </div>
        {applied && (
          <div className="absolute right-1 bottom-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-font-color-highlight text-white">
            <span className="material-icons-round text-xs leading-none">check</span>
          </div>
        )}
        <div className="bg-black/60 px-1.5 py-1">
          <span className="block truncate text-xs text-white/90">{item.title}</span>
        </div>
      </button>
    );
  };



  return (
    <ManagementDialog open={isOpen} onClose={closeWallpaperCenter} label={t('settingsPage.wallpaperCenter')} className="h-[85vh] w-[min(1400px,86vw)]">
        {/* ── 顶栏:标题 + 搜索 ── */}
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-black/10 px-6 py-4 dark:border-white/10">
          <div className="flex items-center gap-2">
            <span className="material-icons-round text-2xl text-font-color-highlight dark:text-dark-font-color-highlight">
              wallpaper
            </span>
            <span className="text-lg font-medium text-font-color-black dark:text-font-color-white">
              {t('settingsPage.wallpaperCenter')}
            </span>
            <span className="text-xs text-font-color-black/40 dark:text-font-color-white/40">
              {visibleItems.length} {t('wallpaperCenterPage.count')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-full bg-background-color-1/70 px-3 py-1.5 ring-1 ring-white/10 backdrop-blur-md dark:bg-dark-background-color-1/70">
              <span className="material-icons-round text-sm text-font-color-black/40 dark:text-font-color-white/40">search</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('wallpaperCenterPage.searchPlaceholder')}
                className="w-40 bg-transparent text-sm text-font-color-black outline-none focus-visible:outline-none! placeholder:text-font-color-black/30 dark:text-font-color-white dark:placeholder:text-font-color-white/30"
              />
              {query && (
                <button onClick={() => setQuery('')} className="cursor-pointer text-font-color-black/40 hover:text-font-color-black/70 dark:text-font-color-white/40 dark:hover:text-font-color-white/70">
                  <span className="material-icons-round text-sm">close</span>
                </button>
              )}
            </div>
            <button
              onClick={handleAddLocal}
              className="flex cursor-pointer items-center gap-1 rounded-full bg-background-color-1/70 px-3 py-1.5 text-xs text-font-color-black/70 ring-1 ring-white/10 backdrop-blur-md transition-colors hover:bg-background-color-1 dark:bg-dark-background-color-1/70 dark:text-font-color-white/70"
              title={t('wallpaperCenterPage.add')}
            >
              <span className="material-icons-round text-sm">add</span>
              {t('wallpaperCenterPage.add')}
            </button>
            <button onClick={refresh} className="flex cursor-pointer items-center gap-1 rounded-full bg-background-color-1/70 px-3 py-1.5 text-xs text-font-color-black/70 ring-1 ring-white/10 backdrop-blur-md transition-colors hover:bg-background-color-1 dark:bg-dark-background-color-1/70 dark:text-font-color-white/70">
              <span className="material-icons-round text-sm">refresh</span>
            </button>
            <button
              onClick={closeWallpaperCenter}
              className="flex h-8 w-8 items-center justify-center rounded-full text-font-color-black/60 transition-colors hover:bg-black/5 dark:text-font-color-white/60 dark:hover:bg-white/10"
              title={t('titleBar.close')}
            >
              <span className="material-icons-round text-xl">close</span>
            </button>
          </div>
        </div>

        {/* ── 分类 tabs ── */}
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-black/5 px-6 py-2 dark:border-white/5">
          {CATEGORIES.map(({ key, icon, labelKey }) => (
            <button
              key={key}
              onClick={() => setCategory(key)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
                category === key
                  ? 'bg-font-color-highlight text-white dark:bg-dark-font-color-highlight'
                  : 'text-font-color-black/60 hover:bg-black/5 dark:text-font-color-white/60 dark:hover:bg-white/10'
              }`}
            >
              <span className="material-icons-round text-sm leading-none">{icon}</span>
              {t(labelKey)}
            </button>
          ))}
          {weNotice && !loading && (
            <span className="ml-auto text-[10px] text-amber-500">
              {weNotice === 'no-we-wallpapers' ? t('wallpaperCenterPage.weEmpty') : weNotice.includes('Steam') || weNotice.includes('Wallpaper Engine') ? t('wallpaperCenterPage.weNotFound') : weNotice}
            </span>
          )}
        </div>

        {/* ── 主区域:网格 + 预览 ── */}
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-font-color-black/50 dark:text-font-color-white/50">
                <span className="material-icons-round animate-spin text-base">sync</span>
                {t('wallpaperCenterPage.loading')}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-font-color-black/40 dark:text-font-color-white/40">
                <span className="material-icons-round text-4xl">
                  {category === 'favorites' ? 'star_border' : 'search_off'}
                </span>
                {category === 'favorites' ? t('wallpaperCenterPage.noFavorites') : t('wallpaperCenterPage.noResults')}
              </div>
            ) : (
              <VirtuosoGrid
                className="h-full"
                totalCount={filtered.length}
                computeItemKey={(index) => filtered[index]?.id ?? index}
                itemContent={renderCard}
                listClassName="grid grid-cols-2 gap-3 px-6 py-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
              />
            )}
          </div>

          {/* 右侧预览区 */}
          <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-black/10 p-4 dark:border-white/10">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium tracking-wider text-font-color-black/50 uppercase dark:text-font-color-white/50">
              <span className="material-icons-round text-sm">image</span>
              {t('wallpaperCenterPage.preview')}
            </div>
            {selectedItem ? (
              <div className="mb-4">
                <div className="overflow-hidden rounded-lg">{renderThumb(selectedItem)}</div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-font-color-black dark:text-font-color-white">
                    {selectedItem.title}
                  </span>
                  <span className="shrink-0 rounded bg-black/40 px-1.5 py-0.5 text-[10px] text-white/80">
                    {selectedItem.source === 'builtin' ? t('wallpaperCenterPage.typeLabel.builtin') : t(TYPE_LABEL[selectedItem.type])}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => handleApply(selectedItem)}
                    disabled={selectedItem.type === 'we-scene' ? recordingItem !== null : isApplied(selectedItem)}
                    className={`flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg py-1.5 text-xs transition-colors disabled:cursor-default ${
                      selectedItem.type !== 'we-scene' && isApplied(selectedItem)
                        ? 'bg-font-color-highlight/20 text-font-color-highlight dark:text-dark-font-color-highlight'
                        : 'bg-font-color-highlight text-white hover:bg-font-color-highlight/90 dark:bg-dark-font-color-highlight'
                    }`}
                  >
                    <span className="material-icons-round text-sm">{selectedItem.type === 'we-scene' ? 'fiber_manual_record' : isApplied(selectedItem) ? 'check_circle' : 'check'}</span>
                    {selectedItem.type === 'we-scene' ? t('wallpaperCenterPage.record') : isApplied(selectedItem) ? t('wallpaperCenterPage.applied') : t('wallpaperCenterPage.apply')}
                  </button>
                  <button
                    onClick={() => handleToggleFavorite(selectedItem)}
                    className={`flex cursor-pointer items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                      favoriteSet.has(selectedItem.id) ? 'bg-amber-500/15 text-amber-500' : 'bg-background-color-2 text-font-color-black/70 hover:bg-background-color-3 dark:bg-dark-background-color-2 dark:text-font-color-white/70'
                    }`}
                    title={favoriteSet.has(selectedItem.id) ? t('wallpaperCenterPage.removeFromFavorites') : t('wallpaperCenterPage.addToFavorites')}
                  >
                    <span className="material-icons-round text-sm">{favoriteSet.has(selectedItem.id) ? 'star' : 'star_border'}</span>
                  </button>
                  {selectedItem.source === 'we' && (
                    <button type="button" onClick={() => { hideWeWallpaper(selectedItem.path, selectedItem.title); setSelectedId(null); }}
                      className="flex cursor-pointer items-center justify-center gap-1 rounded-lg bg-background-color-2 px-2.5 py-1.5 text-xs hover:bg-background-color-3 dark:bg-dark-background-color-2"
                      title="隐藏此壁纸" aria-label={'隐藏此壁纸：' + selectedItem.title}>
                      <span className="material-icons-round text-sm">visibility_off</span>隐藏此壁纸
                    </button>
                  )}
                  {selectedItem.deletable && (
                    <button
                      onClick={() => handleDelete(selectedItem)}
                      className="flex cursor-pointer items-center justify-center gap-1 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/20"
                      title={t('wallpaperCenterPage.delete')}
                    >
                      <span className="material-icons-round text-sm">delete</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="mb-4 rounded-lg bg-black/5 px-3 py-6 text-center text-xs text-font-color-black/40 dark:bg-white/5 dark:text-font-color-white/40">
                {t('wallpaperCenterPage.noSelection')}
              </div>
            )}
            <HiddenWeWallpapersManager />
            {recordingItem && (
              <div className="mt-4">
                <WallpaperEngineRecorder
                  key={recordingItem.id}
                  wallpaperPath={recordingItem.path}
                  wallpaperTitle={recordingItem.title}
                  onDone={handleRecordingDone}
                  onClose={() => setRecordingItem(null)}
                />
              </div>
            )}
            {selectedItem?.source === 'builtin' && (
              <>
            <div className="mt-4 mb-2 flex items-center gap-2 text-xs font-medium tracking-wider text-font-color-black/50 uppercase dark:text-font-color-white/50">
              <span className="material-icons-round text-sm">palette</span>
              {t('wallpaperCenterPage.builtinWallpaperSettings')}
            </div>
            <div className="rounded-lg bg-black/5 p-3 dark:bg-white/5">
              <WebWallpaperSettings />
            </div>
              </>
            )}
          </aside>
        </div>
    </ManagementDialog>
  );
}

export default WallpaperCenterOverlay;