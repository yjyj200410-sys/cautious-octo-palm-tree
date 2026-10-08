export type BackgroundSource = 'custom' | 'color' | 'cover';

/** Preserve the user's pre-switcher background choice until they explicitly select a source. */
export function resolveBackgroundSource(preferences?: {
  backgroundSource?: BackgroundSource;
  showCoverBackground?: boolean;
}): BackgroundSource {
  if (preferences?.backgroundSource === 'custom' || preferences?.backgroundSource === 'color' || preferences?.backgroundSource === 'cover') {
    return preferences.backgroundSource;
  }
  try {
    const legacy = JSON.parse(localStorage.getItem('lumina_bgColor') || '{}');
    if (legacy.mode === 'solid' || legacy.mode === 'gradient') return 'color';
    if (legacy.mode === 'mask') return 'custom';
  } catch { /* ignore malformed old settings */ }
  return preferences?.showCoverBackground === false ? 'custom' : 'cover';
}
