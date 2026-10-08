import { Store } from '@tanstack/react-store';
export type LyricTransformSettings = Record<string, any>;
export const DEFAULT_LYRIC_TRANSFORM_SETTINGS: LyricTransformSettings = {
  scale: 100,
  lineSpacing: 100,
  letterSpacing: 0,
  lyricAlign: 'center',
  bilingualMode: 'original',
  lyricColor: '#ffffff',
  highlightColor: '#fff0b8',
  lyricCustomLineCount: 5,
  ktvHighlight: true,
  lyricLayout: 'centered',
  lyricMotion: 'elegant'
};
function sanitize(value: LyricTransformSettings) {
  if ('cameraFov' in value || 'perspective' in value) value = { ...value, lyricCustomLineCount: 5 };
  return Object.fromEntries(
    Object.keys(DEFAULT_LYRIC_TRANSFORM_SETTINGS).map((key) => [
      key,
      value[key] ?? DEFAULT_LYRIC_TRANSFORM_SETTINGS[key]
    ])
  );
}
function loadSettings() {
  try {
    return sanitize(JSON.parse(localStorage.getItem('nora-lyric-tx') || '{}'));
  } catch {
    return { ...DEFAULT_LYRIC_TRANSFORM_SETTINGS };
  }
}
export const lyricTransformStore = new Store<{ settings: LyricTransformSettings }>({
  settings: loadSettings()
});
export function updateLyricTransformSettings(
  update: LyricTransformSettings | ((previous: LyricTransformSettings) => LyricTransformSettings)
) {
  lyricTransformStore.setState((state) => {
    const settings = sanitize(
      typeof update === 'function' ? update(state.settings) : { ...state.settings, ...update }
    );
    localStorage.setItem('nora-lyric-tx', JSON.stringify(settings));
    return { settings };
  });
}
