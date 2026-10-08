/**
 * WebWallpaperSettings — color palette, animation intensity, and audio sensitivity
 * for built-in web wallpapers (幻彩, 粒子).
 */
import { useCallback } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store/store';
import storage from '@renderer/utils/localStorage';

const DEFAULT_COLORS = ['#ff6b9d', '#c44dff', '#4dc9f6', '#f9ca24', '#6c5ce7'];
const MAX_COLORS = 5;

export default function WebWallpaperSettings() {
  const colors: string[] = useStore(store, (s) =>
    (s.localStorage.preferences as any)?.webWallpaperColors ?? DEFAULT_COLORS
  );
  const intensity: number = useStore(store, (s) =>
    (s.localStorage.preferences as any)?.webWallpaperIntensity ?? 28
  );
  const sensitivity: number = useStore(store, (s) =>
    (s.localStorage.preferences as any)?.webWallpaperSensitivity ?? 28
  );

  const setColors = useCallback((c: string[]) => {
    storage.preferences.setPreferences('webWallpaperColors' as any, c);
  }, []);
  const setIntensity = useCallback((v: number) => {
    storage.preferences.setPreferences('webWallpaperIntensity' as any, v);
  }, []);
  const setSensitivity = useCallback((v: number) => {
    storage.preferences.setPreferences('webWallpaperSensitivity' as any, v);
  }, []);

  const handleColorChange = (index: number, value: string) => {
    const next = [...colors];
    next[index] = value;
    setColors(next);
  };

  const addColor = () => {
    if (colors.length >= MAX_COLORS) return;
    // Generate a complementary hue
    const lastHue = colors.length > 0
      ? parseInt(colors[colors.length - 1].slice(1, 3), 16) * 2.5
      : Math.random() * 360;
    const newHue = (lastHue + 137) % 360; // golden angle
    const hex = '#' + [0, 1, 2].map((i) => {
      const v = Math.round(
        ((c: number) => c < 60 ? 255 : c < 180 ? Math.round(255 - (c - 60) * 2.125) : 0)(
          (newHue + i * 120) % 360
        )
      );
      return Math.min(255, v).toString(16).padStart(2, '0');
    }).join('');
    setColors([...colors.slice(0, 4), hex]);
  };

  const removeColor = (index: number) => {
    if (colors.length <= 1) return;
    setColors(colors.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      {/* Color palette */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-white/50 uppercase tracking-wider">配色方案</span>
          <span className="text-[10px] text-white/30">{colors.length}/{MAX_COLORS}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {colors.map((c, i) => (
            <div key={i} className="relative group">
              <input
                type="color"
                value={c}
                onChange={(e) => handleColorChange(i, e.target.value)}
                className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              {colors.length > 1 && (
                <button
                  className="absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={() => removeColor(i)}
                >
                  <span className="text-[8px] leading-none">×</span>
                </button>
              )}
            </div>
          ))}
          {colors.length < MAX_COLORS && (
            <button
              className="flex h-7 w-9 items-center justify-center rounded border border-dashed border-white/20 text-white/30 hover:border-white/40 hover:text-white/50 transition-colors cursor-pointer"
              onClick={addColor}
              title="添加颜色"
            >
              <span className="text-sm leading-none">+</span>
            </button>
          )}
        </div>
      </div>

      {/* Intensity */}
      <div>
        <div className="flex justify-between text-xs text-white/70 mb-1">
          <span>动画强度</span>
          <span className="opacity-60">{intensity}%</span>
        </div>
        <input
          type="range" min="10" max="100" value={intensity}
          onChange={(e) => setIntensity(Number(e.target.value))}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />
      </div>

      {/* Sensitivity */}
      <div>
        <div className="flex justify-between text-xs text-white/70 mb-1">
          <span>音频灵敏度</span>
          <span className="opacity-60">{sensitivity}%</span>
        </div>
        <input
          type="range" min="10" max="100" value={sensitivity}
          onChange={(e) => setSensitivity(Number(e.target.value))}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/20 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        />
      </div>
    </div>
  );
}
