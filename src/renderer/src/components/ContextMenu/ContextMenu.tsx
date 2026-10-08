import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
/* eslint-disable jsx-a11y/click-events-have-key-events */
import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import ContextMenuDataItem from './ContextMenuDataItem';
import ContextMenuItem from './ContextMenuItem';

const ContextMenu = memo(() => {
  const contextMenuData = useStore(store, (state) => state.contextMenuData);

  const { isVisible, menuItems, data } = contextMenuData;

  const contextMenuRef = useRef(null as null | HTMLDivElement);
  const [dimensions, setDimensions] = useState({
    width: 0,
    height: 0,
    positionX: 0,
    positionY: 0,
    transformOrigin: 'top left'
  });

  const contextMenuStyles: CSSProperties = {};
  contextMenuStyles['--position-x'] = `${dimensions.positionX}px`;
  contextMenuStyles['--position-y'] = `${dimensions.positionY}px`;
  contextMenuStyles['--transform-origin'] = `${dimensions.transformOrigin}`;

  useLayoutEffect(() => {
    const { pageX, pageY } = contextMenuData;

    if (contextMenuRef.current) {
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const menuHeight = contextMenuRef.current.clientHeight;
      const menuWidth = contextMenuRef.current.clientWidth;
      // console.log('viewportHeight', viewportHeight, 'viewportWidth', viewportWidth, 'menuHeight', menuHeight, 'menuWidth', menuWidth, 'pageX', pageX, 'pageY', pageY);

      setDimensions({
        width: menuWidth,
        height: menuHeight,
        positionX: pageX + menuWidth > viewportWidth ? pageX - menuWidth : pageX,
        positionY:
          pageY + menuHeight > viewportHeight
            ? pageY -
              menuHeight +
              // ? 40px get added to stop the context menu from reaching the title-bar.
              // ? Height of the title bar is  40px (2.5rem).
              (pageY - menuHeight > 40 ? 0 : Math.abs(pageY - menuHeight) + 40)
            : pageY,
        transformOrigin: `${
          pageY + menuHeight > viewportHeight ? 'bottom' : 'top'
        } ${pageX + menuWidth > viewportWidth ? 'right' : 'left'}`
      });
    }
  }, [contextMenuData]);

  const contextMenuItems = useMemo(
    () =>
      menuItems
        .filter((menuItem) => !menuItem.isDisabled)
        .map((menuItem, index) => {
          if (menuItem.isContextMenuItemSeperator)
            return (
              <div
                key={index}
                role="separator"
                className="context-menu-item-seperator mx-3 my-1.5 h-px bg-black/10 dark:bg-white/10"
              />
            );
          return (
            <ContextMenuItem
              key={menuItem.label}
              label={menuItem.label}
              iconName={menuItem.iconName}
              iconClassName={menuItem.iconClassName}
              handlerFunction={menuItem.handlerFunction}
            />
          );
        }),
    [menuItems]
  );
  const visibleHost = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector))
    .find((element) => element.getClientRects().length > 0);
  const portalHost = visibleHost('.dialog-menu') ?? visibleHost('.management-dialog-panel') ?? document.body;
  return createPortal(
    <div
      className={`context-menu invisible scale-75 opacity-0 ${
        isVisible ? 'visible! scale-100! opacity-100!' : ''
      } ${
        !data && 'pt-2'
      } bg-context-menu-background/92 text-font-color-black dark:bg-dark-context-menu-background/92 dark:text-font-color-white fixed z-[110] h-fit max-h-[calc(100vh-64px)] w-fit min-w-[15rem] origin-top-left overflow-hidden overflow-y-auto rounded-xl border border-black/8 pt-1 pb-1 shadow-[0_16px_42px_rgba(0,0,0,0.2)] backdrop-blur-xl transition-[opacity,scale,visibility]! dark:border-white/10`}
      onClick={(e) => e.stopPropagation()}
      style={{
        top: dimensions.positionY,
        left: dimensions.positionX,
        // transform: `translate(${dimensions.positionX}px,${dimensions.positionY}px)`,
        transformOrigin: dimensions.transformOrigin
      }}
      ref={contextMenuRef}
      tabIndex={isVisible ? 0 : -1}
      role="menu"
    >
      {data && <ContextMenuDataItem data={data} />}
      {contextMenuItems}
    </div>, portalHost
  );
});

ContextMenu.displayName = 'ContextMenu';
export default ContextMenu;
