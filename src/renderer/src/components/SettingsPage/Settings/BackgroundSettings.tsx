import { store } from '@renderer/store/store';
import { openWallpaperCenter } from '@renderer/store/settingsStore';
import { resolveBackgroundSource, type BackgroundSource } from '@renderer/utils/backgroundSource';
import { BgColorControls, MaskBgEditor } from '@renderer/utils/colorBackground';
import { useMaskBackground } from '@renderer/utils/maskBackground';
import storage from '@renderer/utils/localStorage';
import { useStore } from '@tanstack/react-store';
import { useTranslation } from 'react-i18next';
import FavoriteWallpapers from '../../WallpaperCenter/FavoriteWallpapers';

const SOURCES: { key: BackgroundSource; label: string }[] = [
  { key: 'custom', label: '自定义' },
  { key: 'color', label: '纯色/渐变' },
  { key: 'cover', label: '歌曲封面' },
];

export default function BackgroundSettings() {
  const { t } = useTranslation();
  const source = useStore(store, (state) => resolveBackgroundSource(state.localStorage.preferences));
  const backgroundBlur = useStore(store, (state) => state.localStorage.preferences?.backgroundBlur ?? 32);
  const backgroundBrightness = useStore(store, (state) => state.localStorage.preferences?.backgroundBrightness ?? 25);
  const backgroundDim = Math.min(95, Math.max(0, backgroundBrightness));
  const mask = useMaskBackground();

  const selectSource = (next: BackgroundSource) => {
    storage.preferences.setPreferences('backgroundSource', next);
    storage.preferences.setPreferences('showCoverBackground', next === 'cover');
  };

  return (
    <>
      <div className="secondary-container mb-4 p-1" role="group" aria-label="背景来源">
        <div className="grid grid-cols-3 gap-1">
          {SOURCES.map(({ key, label }) => (
            <button key={key} type="button" aria-pressed={source === key} onClick={() => selectSource(key)}
              className={`min-h-9 rounded-[9px] px-1 text-[12px] font-medium transition-[background-color,color,box-shadow] duration-200 ${source === key ? 'bg-white/18 text-font-color shadow-[inset_0_0_0_1px_rgba(255,255,255,.3),0_1px_5px_rgba(0,0,0,.1)]' : 'text-font-color/55 hover:bg-white/8 hover:text-font-color/85'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {source === 'custom' && (
        <>
          <button type="button" className="settings-entry-card secondary-container mb-4 block w-full text-left" onClick={openWallpaperCenter}>
            <div className="flex items-center gap-3">
              <span className="material-icons-round text-font-color-highlight dark:text-dark-font-color-highlight text-2xl">wallpaper</span>
              <div className="min-w-0 flex-1">
                <div className="description mb-0!">{t('settingsPage.wallpaperCenter')}</div>
                <div className="text-font-color/60 mt-0.5 text-sm">{t('settingsPage.wallpaperCenterDescription')}</div>
              </div>
              <span className="material-icons-round text-font-color/48">chevron_right</span>
            </div>
          </button>
          <FavoriteWallpapers />
          <section className="secondary-container mb-4 space-y-3 p-3" aria-label="遮罩">
            <div className="flex items-center justify-between gap-3">
              <div><div className="description mb-0!">遮罩</div><div className="text-font-color/55 mt-0.5 text-xs">叠加在自定义壁纸上</div></div>
              <button type="button" role="switch" aria-label="遮罩" aria-checked={mask.enabled}
                className={`settings-switch relative h-[22px] w-[38px] cursor-pointer rounded-full transition-colors ${mask.enabled ? 'is-on bg-font-color-highlight dark:bg-dark-font-color-highlight' : 'bg-font-color-highlight/18'}`}
                onClick={() => mask.setEnabled(!mask.enabled)}>
                <span className={`absolute top-[2px] left-0 h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.28)] transition-transform ${mask.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
              </button>
            </div>
            {mask.enabled && <div className="space-y-3 border-t border-white/12 pt-3"><MaskBgEditor bg={mask} variant="settings" /></div>}
          </section>
        </>
      )}

      {source === 'color' && <section className="secondary-container color-bg-settings mb-4 p-3" aria-label="纯色与渐变背景"><BgColorControls baseOnly /></section>}

        <section className="secondary-container background-filter-settings mb-4 p-3" aria-label="背景效果">
          <div className="description mb-0!">背景效果</div>
          <div className="mt-4 space-y-4">
            <div>
              <span className="text-font-color/72 mb-1 flex justify-between text-sm"><span>模糊程度</span><span className="opacity-60">{backgroundBlur}px</span></span>
              <input type="range" aria-label="背景模糊程度" min="0" max="48" value={backgroundBlur}
                onChange={(event) => storage.preferences.setPreferences('backgroundBlur', Number(event.target.value))}
                className="bg-font-color-highlight/20 [&::-webkit-slider-thumb]:bg-font-color-highlight h-1 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full" />
            </div>
            <div>
              <span className="text-font-color/72 mb-1 flex justify-between text-sm"><span>压暗程度</span><span className="opacity-60">{backgroundDim}%</span></span>
              <input type="range" aria-label="背景压暗程度" min="0" max="95" value={backgroundDim}
                onChange={(event) => storage.preferences.setPreferences('backgroundBrightness', Number(event.target.value))}
                className="bg-font-color-highlight/20 [&::-webkit-slider-thumb]:bg-font-color-highlight h-1 w-full cursor-pointer appearance-none rounded-full [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full" />
            </div>
          </div>
        </section>
    </>
  );
}
