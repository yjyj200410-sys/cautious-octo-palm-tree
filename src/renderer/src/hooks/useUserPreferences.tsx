import { queryClient } from '@renderer/index';
import { userPreferencesQuery, userPreferencesMutation } from '@renderer/queries/userPreferences';
import { useQuery, useMutation } from '@tanstack/react-query';

/**
 * Hook for managing user preferences from the database Includes keyboard shortcuts, equalizer
 * presets, and ignored items
 */
export function useUserPreferences() {
  // Load keyboard shortcuts
  const { data: keyboardShortcuts } = useQuery(userPreferencesQuery.keyboardShortcuts);

  // Load equalizer preset
  const { data: equalizerPreset } = useQuery(userPreferencesQuery.equalizerPreset);

  // Mutation: Save keyboard shortcuts
  const saveKeyboardShortcutsMutation = useMutation({
    mutationKey: userPreferencesMutation.saveKeyboardShortcuts.mutationKey,
    mutationFn: async (shortcuts: Record<string, string>) =>
      window.api.settingsHelpers.saveUserKeyboardShortcuts(shortcuts),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userPreferencesQuery.keyboardShortcuts.queryKey });
    }
  });

  // Mutation: Save equalizer preset
  const saveEqualizerPresetMutation = useMutation({
    mutationKey: userPreferencesMutation.saveEqualizerPreset.mutationKey,
    mutationFn: async (
      presetData:
        | Equalizer
        | {
            presetName?: string;
            frequencyBands?: number[];
            isEnabled?: boolean;
          }
    ) => {
      // Convert Equalizer to frequencyBands array if needed
      if ('thirtyTwoHertzFilter' in presetData) {
        const frequencyBands = [
          presetData.thirtyTwoHertzFilter,
          presetData.sixtyFourHertzFilter,
          presetData.hundredTwentyFiveHertzFilter,
          presetData.twoHundredFiftyHertzFilter,
          presetData.fiveHundredHertzFilter,
          presetData.thousandHertzFilter,
          presetData.twoThousandHertzFilter,
          presetData.fourThousandHertzFilter,
          presetData.eightThousandHertzFilter,
          presetData.sixteenThousandHertzFilter
        ];
        return window.api.settingsHelpers.saveUserEqualizerPreset({ frequencyBands });
      }
      return window.api.settingsHelpers.saveUserEqualizerPreset(presetData as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userPreferencesQuery.equalizerPreset.queryKey });
    }
  });

  return {
    keyboardShortcuts,
    equalizerPreset,
    saveKeyboardShortcutsMutation,
    saveEqualizerPresetMutation,
    saveKeyboardShortcuts: saveKeyboardShortcutsMutation.mutate,
    saveEqualizerPreset: saveEqualizerPresetMutation.mutate
  };
}
