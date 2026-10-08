import type { SpecialEffectMode } from '../other/player';

export type SavedEqualizerPreset = {
  id: string;
  name: string;
  bands: number[];
};

const PRESETS_KEY = 'volo:soundEffects:savedEqualizers';
const SPECIAL_KEY = 'volo:soundEffects:specialMode';
const specialModes: SpecialEffectMode[] = [
  'none', 'studio', 'spatial', 'rotate3d', 'wide', 'chorus', 'phaser',
  'gramophone', 'vinyl', 'cassette', 'radio', 'cd'
];

export function readSavedEqualizers(): SavedEqualizerPreset[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedEqualizerPreset =>
      typeof item?.id === 'string' &&
      typeof item?.name === 'string' && item.name.trim().length > 0 &&
      Array.isArray(item?.bands) && item.bands.length === 10 &&
      item.bands.every((gain: unknown) => typeof gain === 'number' && Number.isFinite(gain) && gain >= -12 && gain <= 12)
    ).slice(0, 40);
  } catch {
    return [];
  }
}

export function writeSavedEqualizers(presets: SavedEqualizerPreset[]): boolean {
  if (presets.length > 40) return false;
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

export function readSpecialEffect(): SpecialEffectMode | null {
  try {
    const value = localStorage.getItem(SPECIAL_KEY);
    return specialModes.find((mode) => mode === value) ?? null;
  } catch {
    return null;
  }
}

export function writeSpecialEffect(mode: SpecialEffectMode): void {
  try {
    localStorage.setItem(SPECIAL_KEY, mode);
  } catch (error) {
    console.error('Failed to save special effect', error);
  }
}
