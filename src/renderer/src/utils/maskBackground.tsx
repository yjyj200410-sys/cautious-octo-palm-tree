import { useEffect, useState } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '../store/store';

import { resolveBackgroundSource } from './backgroundSource';
import { extractDominantColor } from './accentColor';

const KEY = 'lumina_maskBackground';
interface MaskConfig {
  enabled: boolean;
  solid: string;
  gradAngle: number;
  maskX: number;
  maskSolidPct: number;
  opacity: number;
  autoColor: boolean;
}
const defaults: MaskConfig = {
  enabled: false, solid: '#000000', gradAngle: 90, maskX: 0,
  maskSolidPct: 30, opacity: 100, autoColor: false,
};

function normalizeMask(saved: Partial<MaskConfig>): MaskConfig {
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : defaults.enabled,
    solid: typeof saved.solid === 'string' ? saved.solid : defaults.solid,
    gradAngle: typeof saved.gradAngle === 'number' ? saved.gradAngle : defaults.gradAngle,
    maskX: typeof saved.maskX === 'number' ? saved.maskX : defaults.maskX,
    maskSolidPct: typeof saved.maskSolidPct === 'number' ? saved.maskSolidPct : defaults.maskSolidPct,
    opacity: typeof saved.opacity === 'number' ? saved.opacity : defaults.opacity,
    autoColor: typeof saved.autoColor === 'boolean' ? saved.autoColor : defaults.autoColor,
  };
}

function readMask(): MaskConfig {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const normalized = normalizeMask(JSON.parse(saved));
      localStorage.setItem(KEY, JSON.stringify(normalized));
      return normalized;
    }
    // Old "mask" color mode becomes a static linear overlay.
    const legacy = JSON.parse(localStorage.getItem('lumina_bgColor') || '{}');
    if (legacy.mode === 'mask') {
      const migrated = normalizeMask({ ...legacy, enabled: true });
      localStorage.setItem(KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch { /* ignore malformed saved data */ }
  return defaults;
}

const listeners = new Set<() => void>();
let mask = readMask();
function setMaskConfig<K extends keyof MaskConfig>(key: K, value: MaskConfig[K]) {
  mask = { ...mask, [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(mask)); } catch { /* storage unavailable */ }
  listeners.forEach((listener) => listener());
}
function useMaskConfig() {
  const [, refresh] = useState(0);
  useEffect(() => {
    const listener = () => refresh((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return mask;
}
export function useMaskBackground() {
  const config = useMaskConfig();
  return {
    ...config,
    setEnabled: (value: boolean) => setMaskConfig('enabled', value),
    setSolid: (value: string) => setMaskConfig('solid', value),
    setGradAngle: (value: number) => setMaskConfig('gradAngle', value),
    setMaskX: (value: number) => setMaskConfig('maskX', value),
    setMaskSolidPct: (value: number) => setMaskConfig('maskSolidPct', value),
    setOpacity: (value: number) => setMaskConfig('opacity', value),
    setAutoColor: (value: boolean) => setMaskConfig('autoColor', value),
  };
}

function maskImage(config: MaskConfig, color: string) {
  const pct = Math.max(0, Math.min(config.maskSolidPct, 100));
  const end = pct + ((100 - pct) / 6) * 1.56;
  return `linear-gradient(${config.gradAngle}deg, ${color} ${pct}%, transparent ${end}%)`;
}

export function MaskBackgroundOverlay() {
  const config = useMaskConfig();
  const source = useStore(store, (state) => resolveBackgroundSource(state.localStorage.preferences));
  const palette = useStore(store, (state) => state.currentSongData?.paletteData);
  const artwork = useStore(store, (state) => state.currentSongData?.artworkPath);

  const [sampledColor, setSampledColor] = useState<string | null>(null);
  useEffect(() => {
    if (!config.autoColor || !artwork || palette) { setSampledColor(null); return; }
    let active = true;
    const src = /^(https?:|file:)/i.test(artwork) ? artwork : `file:///${artwork.replace(/\\/g, '/')}`;
    extractDominantColor(src)
      .then((hex) => { if (active) setSampledColor(hex); })
      .catch(() => { if (active) setSampledColor(null); });
    return () => { active = false; };
  }, [config.autoColor, artwork, palette]);
  const color = config.autoColor
    ? (palette?.Vibrant?.hex || palette?.LightVibrant?.hex || palette?.Muted?.hex || sampledColor || config.solid)
    : config.solid;

  useEffect(() => {
    const node = document.getElementById('lumina-mask-background');
    if (!node || source !== 'custom' || !config.enabled) return;
    const paint = () => {
      node.style.backgroundImage = maskImage(config, color);
      node.style.opacity = String(config.opacity / 100);
      const limitX = (window.innerWidth || 1) * 0.3;
      node.style.backgroundPosition = `calc(50% + ${Math.max(-limitX, Math.min(limitX, config.maskX))}px) 50%`;
    };
    paint();
    window.addEventListener('resize', paint);
    return () => window.removeEventListener('resize', paint);
  }, [source, config, color]);

  if (source !== 'custom' || !config.enabled) return null;
  return <div id="lumina-mask-background" aria-hidden="true" className="pointer-events-none absolute inset-0 z-[1]" style={{ backgroundSize: '160% 160%', backgroundRepeat: 'no-repeat' }} />;
}
