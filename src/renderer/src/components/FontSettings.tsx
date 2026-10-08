import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildDesktopLyricsConfig, updateDesktopLyricsConfig } from '../hooks/useDesktopLyricsSync';
import {
  BUILTIN_FONTS, LOCAL_FONTS, applyFont, clearSavedFont, getCustomFonts,
  getSavedFontForScope, loadGoogleFont, removeCustomFont, resetFont,
  saveFont, type FontDef, waitForFont,
} from '../utils/fontLoader';
import FontImport from './TypographyCenter/FontImport';

type FontScope = 'global' | 'lyrics';

export default function FontSettings({ scope }: { scope: FontScope }) {
  const [selected, setSelected] = useState(() => getSavedFontForScope(scope));
  const [customFonts, setCustomFonts] = useState(() => getCustomFonts());
  const [menuOpen, setMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const fonts = useMemo(() => [...LOCAL_FONTS, ...BUILTIN_FONTS, ...customFonts], [customFonts]);
  const current = fonts.find((font) => font.name === selected);

  useEffect(() => {
    const sync = () => {
      setCustomFonts(getCustomFonts());
      setSelected(getSavedFontForScope(scope));
    };
    window.addEventListener('lumina:fontPreferencesChanged', sync);
    return () => window.removeEventListener('lumina:fontPreferencesChanged', sync);
  }, [scope]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !pickerRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const pushDesktopConfig = useCallback(() => {
    let savedTx: Record<string, unknown> = {};
    try { savedTx = JSON.parse(localStorage.getItem('nora-lyric-tx') || '{}'); } catch { /* ignore */ }
    updateDesktopLyricsConfig(buildDesktopLyricsConfig(savedTx));
  }, []);

  const selectFont = useCallback((font: FontDef) => {
    if (!font.isLocal && font.category !== '自定义') loadGoogleFont(font.googleFamily);
    applyFont(font.name, scope);
    saveFont(font.name, scope);
    setSelected(font.name);
    setMenuOpen(false);
    window.dispatchEvent(new Event('lumina:fontPreferencesChanged'));
    window.dispatchEvent(new CustomEvent('lumina:fontLoaded', { detail: font.name }));
    void waitForFont(font.name);
    pushDesktopConfig();
  }, [pushDesktopConfig, scope]);

  const restoreDefault = useCallback(() => {
    resetFont(scope);
    clearSavedFont(scope);
    setSelected('');
    setMenuOpen(false);
    window.dispatchEvent(new Event('lumina:fontPreferencesChanged'));
    window.dispatchEvent(new CustomEvent('lumina:fontLoaded', { detail: '' }));
    pushDesktopConfig();
  }, [pushDesktopConfig, scope]);

  const handleImported = useCallback((font: FontDef) => {
    setCustomFonts((previous) => [...previous.filter((item) => item.name !== font.name), font]);
    selectFont(font);
  }, [selectFont]);

  const deleteSelectedCustom = useCallback(() => {
    if (!current || current.category !== '自定义') return;
    document.querySelector(`style[data-custom-font="${current.name}"]`)?.remove();
    removeCustomFont(current.name);
    setCustomFonts((previous) => previous.filter((item) => item.name !== current.name));
    const otherScope = scope === 'global' ? 'lyrics' : 'global';
    if (getSavedFontForScope(otherScope) === current.name) {
      resetFont(otherScope);
      clearSavedFont(otherScope);
    }
    restoreDefault();
  }, [current, restoreDefault, scope]);

  return (
    <section className="secondary-container mb-4 p-3" aria-label={scope === 'global' ? '系统字体' : '歌词字体'}>
      <div className="description mb-2">{scope === 'global' ? '系统字体' : '歌词字体'}</div>
      <div ref={pickerRef} className="font-picker">
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls={`font-picker-options-${scope}`}
          onClick={() => setMenuOpen((open) => !open)}
          className="font-picker-trigger flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
        >
          <span className="font-preview-name font-picker-sample flex h-9 w-11 shrink-0 items-center justify-center rounded-lg text-lg" style={{ fontFamily: current ? `"${current.name}"` : undefined }} aria-hidden="true">字</span>
          <span className="min-w-0 flex-1">
            <span className="text-font-color block truncate text-sm font-medium">{current?.nameZh || '默认字体'}</span>
            <span className="text-font-color/48 block truncate text-[11px]">{current?.name || (scope === 'global' ? '跟随系统默认字体' : '跟随系统字体')}</span>
          </span>
          <span className={`material-icons-round text-font-color/45 text-lg transition-transform duration-150 ${menuOpen ? 'rotate-180' : ''}`} aria-hidden="true">expand_more</span>
        </button>
        <div id={`font-picker-options-${scope}`} className="font-picker-panel" data-open={menuOpen} inert={!menuOpen}>
          <div className="font-picker-scroll" role="group" aria-label={scope === 'global' ? '可选系统字体' : '可选歌词字体'}>
            <button type="button" aria-pressed={!selected} onClick={restoreDefault} className="font-picker-option flex w-full items-center gap-3 px-3 py-2 text-left" data-selected={!selected}>
              <span className="font-preview-name font-picker-option-sample flex h-8 w-10 shrink-0 items-center justify-center rounded-md text-base" aria-hidden="true">字</span>
              <span className="min-w-0 flex-1 text-xs">默认字体</span>
              {!selected && <span className="material-icons-round text-base" aria-hidden="true">check</span>}
            </button>
            <div className="font-picker-group-label px-3 pt-3 pb-1 text-[10px] font-medium">内置字体</div>
            {[...LOCAL_FONTS, ...BUILTIN_FONTS].map((font) => (
              <button key={font.id} type="button" aria-pressed={selected === font.name} onPointerEnter={() => { if (!font.isLocal) loadGoogleFont(font.googleFamily); }} onFocus={() => { if (!font.isLocal) loadGoogleFont(font.googleFamily); }} onClick={() => selectFont(font)} className="font-picker-option flex w-full items-center gap-3 px-3 py-2 text-left" data-selected={selected === font.name}>
                <span className="font-preview-name font-picker-option-sample flex h-8 w-10 shrink-0 items-center justify-center rounded-md text-base" style={{ fontFamily: `"${font.name}"` }} aria-hidden="true">字</span>
                <span className="min-w-0 flex-1 truncate text-xs">{font.nameZh}</span>
                {selected === font.name && <span className="material-icons-round text-base" aria-hidden="true">check</span>}
              </button>
            ))}
            {customFonts.length > 0 && <div className="font-picker-group-label px-3 pt-3 pb-1 text-[10px] font-medium">导入字体</div>}
            {customFonts.map((font) => (
              <button key={font.id} type="button" aria-pressed={selected === font.name} onClick={() => selectFont(font)} className="font-picker-option flex w-full items-center gap-3 px-3 py-2 text-left" data-selected={selected === font.name}>
                <span className="font-preview-name font-picker-option-sample flex h-8 w-10 shrink-0 items-center justify-center rounded-md text-base" style={{ fontFamily: `"${font.name}"` }} aria-hidden="true">字</span>
                <span className="min-w-0 flex-1 truncate text-xs">{font.nameZh}</span>
                {selected === font.name && <span className="material-icons-round text-base" aria-hidden="true">check</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <FontImport onImported={handleImported} />
        {current?.category === '自定义' ? (
          <button type="button" onClick={deleteSelectedCustom} className="text-font-color/55 hover:text-font-color text-xs">删除所选字体</button>
        ) : selected ? (
          <button type="button" onClick={restoreDefault} className="text-font-color/55 hover:text-font-color text-xs">恢复默认</button>
        ) : null}
      </div>
    </section>
  );
}
