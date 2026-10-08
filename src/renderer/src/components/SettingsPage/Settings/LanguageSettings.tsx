import { settingsQuery } from '@renderer/queries/settings';
import { useQuery } from '@tanstack/react-query';
import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import { AppUpdateContext } from '../../../contexts/AppUpdateContext';
import i18n, { supportedLanguagesDropdownOptions } from '../../../i18n';
import Dropdown from '../../Dropdown';

const LanguageSettings = () => {
  const { t } = useTranslation();
  const { data: userSettings } = useQuery(settingsQuery.all);

  const { addNewNotifications } = useContext(AppUpdateContext);
  const appLang = userSettings?.language || 'en';

  return (
    <li
      className="main-container performance-settings-container mb-16"
      id="language-settings-container"
    >
      <ul className="marker:bg-background-color-3 dark:marker:bg-background-color-3 list-disc pl-6">
        <li className="seekbar-scroll-interval mb-4">
          <div className="description">{t('settingsPage.languageDescription')}</div>
          <Dropdown
            className="mt-4"
            name="supportedLanguagesDropdown"
            value={appLang}
            options={supportedLanguagesDropdownOptions}
            onChange={async (e) => {
              const val = e.currentTarget.value as LanguageCodes;

              i18n.reloadResources();
              try {
                await i18n.changeLanguage(val);
              } catch (err) {
                console.warn(err);
                return;
              }
              // 先保存到数据库再重启，确保重载后能读到新语言
              await window.api.settings.saveUserSettings({ language: val });
              window.api.appControls.restartRenderer(`App language changed to ${val}`);
              addNewNotifications([
                {
                  id: 'languageChanged',
                  content: t('notifications.languageChanged'),
                  iconName: 'translate'
                }
              ]);
            }}
          />
        </li>
      </ul>
    </li>
  );
};

export default LanguageSettings;
