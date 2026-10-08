import { useContext } from 'react';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';

const ContextMenuItem = (props: ContextMenuItem) => {
  const { updateContextMenuData } = useContext(AppUpdateContext);
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item ${
        props.class || ''
      } text-font-color-black hover:bg-context-menu-list-hover/75 dark:text-font-color-white dark:hover:bg-dark-context-menu-list-hover/40 mx-1.5 flex min-h-9 w-[calc(100%-12px)] cursor-pointer flex-row items-center rounded-lg px-3 py-1.5 text-left text-[13px] font-medium transition-colors outline-none focus-visible:bg-context-menu-list-hover/75 dark:focus-visible:bg-dark-context-menu-list-hover/40`}
      onClick={() => {
        if (!props.isContextMenuItemSeperator && props.handlerFunction) {
          props.handlerFunction();
          updateContextMenuData(false, []);
        }
      }}
    >
      {props.iconName && (
        <span className={`material-icons-round icon mr-3 text-[18px] opacity-75 ${props.iconClassName}`}>
          {props.iconName}
        </span>
      )}{' '}
      {props.label}
    </button>
  );
};

ContextMenuItem.displayName = 'ContextMenuItem';
export default ContextMenuItem;
