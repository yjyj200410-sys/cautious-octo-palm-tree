import type { ChangeEvent } from 'react';

import { DEFAULT_LYRIC_TRANSFORM_SETTINGS } from '../../store/lyricTransformStore';
import { lyricLayouts, lyricMotions } from '../../utils/lyricPresentation';
import DesktopLyricsToggle from './DesktopLyricsToggle';

export type FullScreenSettingsTab = 'visual' | 'desk';
type Props = {
  lyricTx: Record<string, any>;
  setLyricTx: (update: (previous: Record<string, any>) => Record<string, any>) => void;
  embedded?: boolean;
  embeddedTab?: FullScreenSettingsTab;
};
export default function FullScreenSettings({ lyricTx, setLyricTx, embeddedTab = 'visual' }: Props) {
  const patch = (key: string, value: unknown) =>
    setLyricTx((previous) => ({ ...previous, [key]: value }));
  if (embeddedTab === 'desk')
    return (
      <div className="flex items-center gap-3">
        <DesktopLyricsToggle isVisible />
        <span>桌面歌词使用相同的轮播样式。</span>
      </div>
    );
  const slider = (key: string, label: string, min: number, max: number, step = 1) => (
    <label key={key} className="flex flex-col gap-2">
      <span>
        {label} <span className="opacity-50">{lyricTx[key]}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={lyricTx[key]}
        onChange={(event: ChangeEvent<HTMLInputElement>) => patch(key, Number(event.target.value))}
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-6 text-sm">
      <label className="flex items-center justify-between gap-4">
        歌词布局
        <select
          className="bg-background-color-2 text-font-color-black dark:bg-dark-background-color-2 dark:text-font-color-white rounded-lg px-3 py-2"
          value={lyricTx.lyricLayout ?? 'centered'}
          onChange={(event) => patch('lyricLayout', event.target.value)}
        >
          {Object.entries(lyricLayouts).map(([id, preset]) => (
            <option key={id} value={id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-4">
        换行动画
        <select
          className="bg-background-color-2 text-font-color-black dark:bg-dark-background-color-2 dark:text-font-color-white rounded-lg px-3 py-2"
          value={lyricTx.lyricMotion ?? 'elegant'}
          onChange={(event) => patch('lyricMotion', event.target.value)}
        >
          {Object.entries(lyricMotions).map(([id, preset]) => (
            <option key={id} value={id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      {slider('scale', '字号', 60, 160)}
      {slider('lineSpacing', '行距', 80, 160)}
      {slider('lyricCustomLineCount', '显示行数', 1, 7, 2)}
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={lyricTx.ktvHighlight !== false}
          onChange={(event) => patch('ktvHighlight', event.target.checked)}
        />
        逐字高亮
      </label>
      <label className="flex items-center justify-between">
        文字颜色
        <input
          type="color"
          value={lyricTx.lyricColor}
          onChange={(event) => patch('lyricColor', event.target.value)}
        />
      </label>
      <label className="flex items-center justify-between">
        高亮颜色
        <input
          type="color"
          value={lyricTx.highlightColor}
          onChange={(event) => patch('highlightColor', event.target.value)}
        />
      </label>
      <button
        type="button"
        className="self-start rounded-lg border border-current/20 px-4 py-2"
        onClick={() => setLyricTx(() => ({ ...DEFAULT_LYRIC_TRANSFORM_SETTINGS }))}
      >
        恢复默认
      </button>
    </div>
  );
}
