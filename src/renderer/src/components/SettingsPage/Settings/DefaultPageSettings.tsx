import { useTranslation } from 'react-i18next';

import storage from '../../../utils/localStorage';
import Dropdown from '../../Dropdown';

const DefaultPageSettings = () => {
  const { t } = useTranslation();

  // 双页面简化后,旧的默认启动页(歌曲/歌单/艺术家/专辑/文件夹/搜索)已不再提供,
  // 仅保留"首页"作为唯一默认页。旧配置值(如 'Songs')在读取与迁移时统一回退为 Home,
  // 避免设置页下拉框空白或启动路由异常。
  const defaultPageOnStartUp: DefaultPages = 'Home';

  return (
    <li className="main-container mb-16" id="default-page-settings-container">
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span className="material-icons-round-outlined mr-2">home</span>
        {t('settingsPage.defaultPage')}
      </div>
      <ul className="marker:bg-background-color-3 dark:marker:bg-background-color-3 list-disc pl-6">
        <li className="default-page-dropdown-container">
          <div className="description"> {t('settingsPage.changeDefaultPageDescription')}</div>

          <Dropdown
            name="defaultPageDropdown"
            className="mt-4"
            value={defaultPageOnStartUp}
            options={[{ label: t('sideBar.home'), value: 'Home' }]}
            onChange={(e) => {
              storage.preferences.setPreferences(
                'defaultPageOnStartUp',
                e.target.value as DefaultPages
              );
            }}
          />
        </li>
      </ul>
    </li>
  );
};

export default DefaultPageSettings;
