/**
 * LyricsFontSettings — 歌词字重(细/粗)轻量选择。
 * 与歌词字体选择同处“歌词 → 字体”：持久化字重并更新主窗口和桌面歌词。
 */
import { useCallback, useState } from 'react';

import { buildDesktopLyricsConfig, updateDesktopLyricsConfig } from '../../../hooks/useDesktopLyricsSync';
import { getSavedFontWeight, saveFontWeight } from '../../../utils/fontLoader';

const LyricsFontSettings = () => {
  const [weight, setWeight] = useState<string>(() => getSavedFontWeight());

  const pushDesktopConfig = useCallback(() => {
    let savedTx: Record<string, unknown> = {};
    try {
      savedTx = JSON.parse(localStorage.getItem('nora-lyric-tx') || '{}');
    } catch {
      savedTx = {};
    }
    updateDesktopLyricsConfig(buildDesktopLyricsConfig(savedTx));
  }, []);

  const selectWeight = useCallback(
    (w: string) => {
      setWeight(w);
      saveFontWeight(w);
      window.dispatchEvent(new CustomEvent('lumina:fontLoaded', { detail: '' }));
      pushDesktopConfig();
    },
    [pushDesktopConfig]
  );

  return (
    <section className="secondary-container mb-4 p-3" id="lyrics-font-weight-container">
      <div className="description">歌词字重</div>
      <div className="mt-3 flex gap-1.5">
        {[
          ['300', '细'],
          ['700', '粗']
        ].map(([w, label]) => (
          <button
            key={w}
            className={`flex-1 rounded-lg py-2 text-xs cursor-pointer transition-colors ${
              weight === w
                ? 'bg-font-color-highlight/20 text-font-color-highlight ring-1 ring-font-color-highlight/30'
                : 'bg-black/5 text-font-color/65 hover:bg-black/8 dark:bg-white/7 dark:hover:bg-white/11'
            }`}
            style={{ fontWeight: Number(w) }}
            onClick={() => selectWeight(w)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
};

export default LyricsFontSettings;
