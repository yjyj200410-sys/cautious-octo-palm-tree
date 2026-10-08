import { Store } from '@tanstack/react-store';

/**
 * 设置抽屉的五个主分类；壁纸中心和音乐文件夹由独立浮窗管理。
 */
export type SettingsSectionKey =
  | 'appearance'
  | 'lyrics'
  | 'background'
  | 'player'
  | 'general';

export const SETTINGS_SECTIONS: {
  key: SettingsSectionKey;
  icon: string;
  label:
    | 'settingsPage.appearance'
    | 'settingsPage.lyrics'
    | 'settingsPage.background'
    | 'settingsPage.player'
    | 'settingsPage.general';
}[] = [
  { key: 'appearance', icon: 'palette', label: 'settingsPage.appearance' },
  { key: 'lyrics', icon: 'notes', label: 'settingsPage.lyrics' },
  { key: 'background', icon: 'wallpaper', label: 'settingsPage.background' },
  { key: 'player', icon: 'play_circle', label: 'settingsPage.player' },
  { key: 'general', icon: 'tune', label: 'settingsPage.general' }
];

interface SettingsStoreState {
  /** 抽屉开合状态(不持久化,重启默认关闭) */
  isOpen: boolean;
  /** 当前激活的设置分类(持久化,重开 Drawer 回到上次所在分类) */
  activeSection: SettingsSectionKey;
  isWallpaperCenterOpen: boolean;
  isMusicFoldersOpen: boolean;
}

const SETTINGS_STORE_KEY = 'nora-settings-store';

const loadActiveSection = (): SettingsSectionKey => {
  try {
    const saved = localStorage.getItem(SETTINGS_STORE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as { activeSection?: string };
      // 旧版本迁移:playback 更名为 player;audio 分类并入 player(Settings 2.0)
      const migrated =
        parsed?.activeSection === 'playback' || parsed?.activeSection === 'audio'
          ? 'player'
          : parsed?.activeSection;
      if (SETTINGS_SECTIONS.some((s) => s.key === migrated)) {
        return migrated as SettingsSectionKey;
      }
    }
  } catch {
    // 损坏/不可解析时回退默认
  }
  return 'appearance';
};

export const settingsStore = new Store<SettingsStoreState>({
  isOpen: false,
  activeSection: loadActiveSection(),
  isWallpaperCenterOpen: false,
  isMusicFoldersOpen: false
});

export const openSettingsDrawer = (section?: SettingsSectionKey) =>
  settingsStore.setState((state) => ({
    ...state,
    isOpen: true,
    activeSection: section ?? state.activeSection
  }));

export const closeSettingsDrawer = () =>
  settingsStore.setState((state) => ({ ...state, isOpen: false }));

export const openMusicFolders = () =>
  settingsStore.setState((state) => ({ ...state, isMusicFoldersOpen: true }));

export const closeMusicFolders = () =>
  settingsStore.setState((state) => ({ ...state, isMusicFoldersOpen: false }));

export const setActiveSettingsSection = (section: SettingsSectionKey) =>
  settingsStore.setState((state) => ({ ...state, activeSection: section }));

// 持久化:仅分类选择跨会话保留(开合状态是瞬态的,不落盘)。
settingsStore.subscribe(() => {
  try {
    localStorage.setItem(
      SETTINGS_STORE_KEY,
      JSON.stringify({ activeSection: settingsStore.state.activeSection })
    );
  } catch {
    // localStorage 不可用时静默(不阻塞设置交互)
  }
});

export const openWallpaperCenter = () => settingsStore.setState(state => ({ ...state, isWallpaperCenterOpen: true }));
export const closeWallpaperCenter = () => settingsStore.setState(state => ({ ...state, isWallpaperCenterOpen: false }));
