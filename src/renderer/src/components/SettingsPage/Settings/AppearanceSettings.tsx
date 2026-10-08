/* eslint-disable jsx-a11y/no-noninteractive-element-interactions */
/* eslint-disable jsx-a11y/no-noninteractive-tabindex */

import { queryClient } from '@renderer/index';
import { settingsMutation, settingsQuery } from '@renderer/queries/settings';
import { store } from '@renderer/store/store';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useStore } from '@tanstack/react-store';
import { useTranslation } from 'react-i18next';


import storage from '../../../utils/localStorage';
import { prepareThemeTransition } from '../../../utils/themeTransition';



const ThemeSettings = () => {
  const { data: userSettings } = useQuery(settingsQuery.all);

  const { mutate: changeAppTheme } = useMutation({
    mutationKey: settingsMutation.changeAppTheme.mutationKey,
    mutationFn: async (theme: AppTheme) => window.api.theme.changeAppTheme(theme),
    // When mutate is called:
    onMutate: async (theme) => {
      await queryClient.cancelQueries({ queryKey: settingsQuery.all.queryKey });

      const prevSettings = queryClient.getQueryData<typeof userSettings>(
        settingsQuery.all.queryKey
      );

      const newSettings = {
        ...prevSettings!,
        isDarkMode:
          theme === 'dark' ? true : theme === 'light' ? false : (prevSettings?.isDarkMode ?? false),
        useSystemTheme: theme === 'system'
      };
      prepareThemeTransition();
      queryClient.setQueryData<typeof userSettings>(settingsQuery.all.queryKey, newSettings);

      return { prevSettings, newSettings };
    },
    onError: (_, __, onMutateResult) =>
      queryClient.setQueryData<typeof userSettings>(
        settingsQuery.all.queryKey,
        onMutateResult?.prevSettings
      ),
    onSettled: () => queryClient.invalidateQueries(settingsQuery.all)
  });

  const immersiveVinylCoverEnabled = useStore(
    store,
    (state) => state.localStorage.preferences?.immersiveVinylCoverEnabled ?? false
  );

  const { t } = useTranslation();


  return userSettings ? (
    <li
      className="main-container appearance-settings-container mb-10"
      id="appearance-settings-container"
    >
      <ul className="m-0 list-none space-y-5 p-0 marker:hidden">
        <li className="flex items-center justify-between gap-3">
          <div className="description">{t('settingsPage.changeTheme')}</div>
          <div
            className="settings-theme-switch"
            role="radiogroup"
            aria-label={t('settingsPage.changeTheme')}
          >
            <span
              aria-hidden="true"
              className="settings-theme-switch__highlight"
              style={{ translate: userSettings.isDarkMode ? '100% 0' : '0 0' }}
            />
            {([
              ['light', 'light_mode', 'settingsPage.lightTheme'],
              ['dark', 'dark_mode', 'settingsPage.darkTheme'],
            ] as const).map(([theme, icon, label]) => (
              <label key={theme} className="settings-theme-switch__option" title={t(label)}>
                <input
                  type="radio"
                  name="appearance-theme"
                  className="sr-only"
                  value={theme}
                  checked={theme === 'dark' ? userSettings.isDarkMode : !userSettings.isDarkMode}
                  onChange={() => changeAppTheme(theme)}
                  onClick={() => {
                    if (userSettings.useSystemTheme && (theme === 'dark') === userSettings.isDarkMode) {
                      changeAppTheme(theme);
                    }
                  }}
                  aria-label={t(label)}
                />
                <span className="material-symbols-rounded" aria-hidden="true">{icon}</span>
              </label>
            ))}
          </div>
        </li>
        <li className="secondary-container mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="description mb-0!">沉浸页黑胶唱片</div>
            <div className="text-font-color/55 mt-0.5 text-xs">沉浸页封面播放时旋转，暂停时静止</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="沉浸页黑胶唱片"
            aria-checked={immersiveVinylCoverEnabled}
            onClick={() => storage.preferences.setPreferences('immersiveVinylCoverEnabled', !immersiveVinylCoverEnabled)}
            className={`settings-switch relative h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full transition-colors ${immersiveVinylCoverEnabled ? 'is-on bg-font-color-highlight dark:bg-dark-font-color-highlight' : 'bg-font-color-highlight/18'}`}
          >
            <span className={`absolute top-[2px] left-0 h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.28)] transition-transform ${immersiveVinylCoverEnabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
          </button>
        </li>
      </ul>
    </li>
  ) : null;
};

export default ThemeSettings;
