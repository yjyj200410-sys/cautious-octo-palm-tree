import { useCallback } from 'react';

import { store } from '../store/store';
export interface AppUpdatesDependencies {
  changePromptMenuData: (
    visible?: boolean,
    prompt?: React.ReactNode | null,
    className?: string
  ) => void;
  isOnline: boolean;
}
// Volo has no configured release feed yet. Do not poll or offer Nora binaries.
export function useAppUpdates(_dependencies: AppUpdatesDependencies) {
  const updateAppUpdatesState = useCallback((state: AppUpdatesState) => {
    store.setState((previous) => ({ ...previous, appUpdatesState: state }));
  }, []);
  return { updateAppUpdatesState };
}
