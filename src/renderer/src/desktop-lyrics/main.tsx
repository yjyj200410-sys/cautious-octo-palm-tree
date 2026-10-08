import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import LyricCarousel from '../components/LyricCarousel';
import type { LyricLine } from '../hooks/LyricsStore';

type DesktopState = { lines?: LyricLine[]; index?: number; position?: number; config?: Record<string, any>; };
function App() {
  const [state, setState] = useState<DesktopState>({});
  useEffect(() => {
    let mounted = true;
    const api = window.api.settingsHelpers;
    const off = api.onDesktopLyricsState(value => { if (mounted) setState(previous => ({ ...previous, ...value as DesktopState })); });
    api.getCurrentLyricsState().then(value => { if (mounted && value) setState(previous => ({ ...previous, ...value as DesktopState })); }).catch(() => {});
    api.desktopLyricsReady();
    return () => { mounted = false; off?.(); };
  }, []);
  const config = state.config || {};
  const localFonts = JSON.stringify(config.localFonts || {});
  const customFonts = JSON.stringify(config.customFonts || []);
  useEffect(() => {
    const style = document.createElement('style');
    const rules = Object.entries(JSON.parse(localFonts)).map(([name, url]) => `@font-face { font-family: ${JSON.stringify(name)}; src: url(${JSON.stringify(url)}); }`);
    for (const font of JSON.parse(customFonts)) if (font.name && font.filePath) rules.push(`@font-face { font-family: ${JSON.stringify(font.name)}; src: url(${JSON.stringify(`file:///${font.filePath.replace(/\\/g, '/')}`)}); }`);
    style.textContent = rules.join('\n'); document.head.appendChild(style);
    return () => style.remove();
  }, [localFonts, customFonts]);
  return <div style={{ position: 'fixed', inset: 0, background: 'transparent', overflow: 'hidden' }}>
    <LyricCarousel lines={state.lines || []} index={state.index ?? -1} position={state.position ?? 0} config={config} />
  </div>;
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);
