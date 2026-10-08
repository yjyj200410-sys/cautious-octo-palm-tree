import { useSuspenseQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { settingsQuery } from '../../queries/settings';
import Button from '../Button';

const WindowControlsContainer = () => {
  const isWindows = window.api.properties.platform === 'win32';
  const {
    data: { hideWindowOnClose }
  } = useSuspenseQuery({
    ...settingsQuery.all,
    select: (data) => ({ hideWindowOnClose: data.hideWindowOnClose })
  });

  const { t } = useTranslation();

  const close = useCallback(() => {
    if (hideWindowOnClose) window.api.windowControls.hideApp();
    else window.api.windowControls.closeApp();
  }, [hideWindowOnClose]);

  const minimize = useCallback(() => {
    window.api.windowControls.minimizeApp();
  }, []);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const removeEnterListener = window.api.fullscreen.onEnterFullscreen(() => setIsFullscreen(true));
    const removeLeaveListener = window.api.fullscreen.onLeaveFullscreen(() => setIsFullscreen(false));
    const removeMaximizeListener = window.api.windowControls.onWindowMaximize(() => setIsMaximized(true));
    const removeUnmaximizeListener = window.api.windowControls.onWindowUnmaximize(() => setIsMaximized(false));
    window.api.fullscreen.isFullscreen().then(setIsFullscreen).catch(() => {});
    window.api.windowControls.isMaximizedApp().then(setIsMaximized).catch(() => {});
    return () => {
      removeEnterListener();
      removeLeaveListener();
      removeMaximizeListener();
      removeUnmaximizeListener();
    };
  }, []);

  const toggleWindowSize = useCallback(() => {
    if (isFullscreen) window.api.fullscreen.exitFullscreen();
    else if (isWindows) window.api.windowControls.toggleMaximizeApp();
    else window.api.fullscreen.toggleFullscreen();
  }, [isFullscreen, isWindows]);

  const sizeIcon = isFullscreen ? 'fullscreen_exit' : 'fullscreen';
  const windowSizeIcon = isWindows && !isFullscreen ? (
    <svg
      aria-hidden="true"
      className="h-3 w-3 opacity-55 transition-opacity group-hover:opacity-90"
      fill="none"
      focusable="false"
      viewBox="0 0 12 12"
    >
      {isMaximized ? (
        <>
          <path
            d="M3.5 1.25h6.25c.55 0 1 .45 1 1V8.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.25"
          />
          <rect
            x="1.25"
            y="3.25"
            width="7.5"
            height="7.5"
            rx=".5"
            stroke="currentColor"
            strokeWidth="1.25"
          />
        </>
      ) : (
        <rect
          x="1.25"
          y="1.25"
          width="9.5"
          height="9.5"
          rx=".5"
          stroke="currentColor"
          strokeWidth="1.25"
        />
      )}
    </svg>
  ) : undefined;
  const sizeTooltip = isFullscreen
    ? t('titleBar.exitFullscreen')
    : isWindows
      ? (isMaximized ? t('titleBar.restore') : t('titleBar.maximize'))
      : t('titleBar.enterFullscreen');

  return (
    <div
      className="window-controls-container flex h-full items-center justify-between [-webkit-app-region:no-drag]"
      id="window-controls-container"
    >
      <Button
        className="minimize-btn group !m-0 !h-9 !w-9 !rounded-md !border-0 !border-transparent bg-transparent !p-0 text-xl -outline-offset-2 transition-colors hover:!bg-black/5 focus-visible:!outline dark:bg-transparent dark:hover:!bg-white/7"
        clickHandler={minimize}
        tooltipLabel={t('titleBar.minimize')}
        iconName="minimize"
        iconClassName="h-fit text-xl font-light! opacity-55 transition-opacity group-hover:opacity-90"
      />
      <Button
        className="maximize-btn group !m-0 !h-9 !w-9 !rounded-md !border-0 !border-transparent bg-transparent !p-0 text-xl -outline-offset-2 transition-colors hover:!bg-black/5 focus-visible:!outline dark:bg-transparent dark:hover:!bg-white/7"
        clickHandler={toggleWindowSize}
        tooltipLabel={sizeTooltip}
        iconElement={windowSizeIcon}
        iconClassName="h-fit text-lg font-light! opacity-55 transition-opacity group-hover:opacity-90"
        iconName={windowSizeIcon ? undefined : sizeIcon}
      />
      <Button
        className="close-btn group !m-0 !h-9 !w-9 !rounded-md !border-0 !border-transparent bg-transparent !p-0 text-xl -outline-offset-2 transition-colors hover:!bg-red-500/12 focus-visible:!outline dark:bg-transparent dark:hover:!bg-red-500/16"
        clickHandler={close}
        tooltipLabel={t('titleBar.close')}
        iconName="close"
        iconClassName="h-fit text-xl font-light! opacity-55 transition-colors transition-opacity group-hover:text-red-500 group-hover:opacity-95"
      />
    </div>
  );
};

export default WindowControlsContainer;
