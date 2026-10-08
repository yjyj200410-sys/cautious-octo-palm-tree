import { openSettingsDrawer } from '@renderer/store/settingsStore';
import { memo } from 'react';

/**
 * 设置按钮(主壳左上角)。点击打开左侧 SettingsDrawer。 开合状态统一由 settingsStore.isOpen 持有(重构后:设置 UI 状态全部收敛进
 * settingsStore)。
 */
const MenuButton = memo(() => (
  <button
    type="button"
    onClick={() => openSettingsDrawer()}
    className="global-settings-button flex shrink-0 items-center justify-center rounded-full transition-[background-color,transform] active:scale-95"
    title="设置"
    aria-label="打开设置"
  >
    <span className="material-icons-round-outlined icon text-[1.15rem] font-normal!">settings</span>
  </button>
));

MenuButton.displayName = 'MenuButton';
export default MenuButton;
