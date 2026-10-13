import { createMutationKeys, createQueryKeys } from '@lukemorales/query-key-factory';
export const userPreferencesQuery = createQueryKeys('userPreferences', {
  keyboardShortcuts: {
    queryKey: null,
    queryFn: () => window.api.settingsHelpers.getUserKeyboardShortcuts()
  },
  equalizerPreset: {
    queryKey: null,
    queryFn: () => window.api.settingsHelpers.getUserEqualizerPreset()
  }
});
export const userPreferencesMutation = createMutationKeys('userPreferences', {
  saveKeyboardShortcuts: null,
  saveEqualizerPreset: null
});
