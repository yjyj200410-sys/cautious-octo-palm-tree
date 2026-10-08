import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useTranslation } from 'react-i18next';

import storage from '../../../utils/localStorage';
import Checkbox from '../../Checkbox';

const AudioPlaybackSettings = () => {
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const { t } = useTranslation();

  return (
    <li
      className="main-container audio-playback-settings-container mb-16"
      id="audio-playback-settings-container"
    >
      <ul className="marker:bg-font-color-highlight dark:marker:bg-dark-font-color-highlight list-disc pl-6">
        <li className="secondary-container show-remaining-song-duration mb-4">
          <div className="description">
            {t('settingsPage.showRemainingSongDurationDescription')}
          </div>
          <Checkbox
            id="toggleShowRemainingSongDuration"
            isChecked={preferences?.showSongRemainingTime}
            checkedStateUpdateFunction={(state) =>
              storage.preferences.setPreferences('showSongRemainingTime', state)
            }
            labelContent={t('settingsPage.showRemainingSongDuration')}
          />
        </li>

      </ul>
    </li>
  );
};

export default AudioPlaybackSettings;
