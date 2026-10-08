import type { MigrationData } from '../utils/localStorage';
import { LOCAL_STORAGE_DEFAULT_TEMPLATE } from './appReducer';

const localStorageMigrationData: MigrationData = {
  '4.0.0-alpha.3': (_) => {
    return LOCAL_STORAGE_DEFAULT_TEMPLATE;
  },
  // 双页面简化后,旧默认启动页(歌曲/歌单/艺术家/专辑/文件夹/搜索)已被移除,
  // 统一将 defaultPageOnStartUp 回退为首页,避免启动路由错误或设置页空白。
  '2.0.0': (storage) => ({
    ...storage,
    preferences: {
      ...(storage.preferences ?? {}),
      defaultPageOnStartUp: 'Home'
    }
  })
};

export default localStorageMigrationData;
