import { type DragEvent, type RefObject, useCallback, useEffect } from 'react';
import { lazy } from 'react';

import { appPreferences } from '../../../../package.json';
import { store } from '../store/store';

// Lazy load prompts
const UnsupportedFileMessagePrompt = lazy(
  () => import('../components/UnsupportedFileMessagePrompt')
);

export interface UseWindowManagementOptions {
  changePromptMenuData?: (isVisible: boolean, prompt?: React.ReactNode, className?: string) => void;
  fetchSongFromUnknownSource?: (filePath: string) => void;
}

/**
 * Hook for managing window-related interactions and behaviors.
 *
 * This hook provides functions for: - Window blur/focus state management - Fullscreen state
 * management - Drag-and-drop file handling - Title bar updates with current song information
 *
 * @example
 *   ```tsx
 *   function App() {
 *   const appRef = useRef<HTMLDivElement>(null);
 *
 *   // Define handlers first
 *   const changePromptMenuData = useCallback(...);
 *   const fetchSongFromUnknownSource = useCallback(...);
 *
 *   // Then use the hook
 *   const windowMgmt = useWindowManagement(appRef, {
 *   changePromptMenuData,
 *   fetchSongFromUnknownSource
 *   });
 *
 *   return (
 *   <div
 *   ref={appRef}
 *   onDragEnter={windowMgmt.addSongDropPlaceholder}
 *   onDragLeave={windowMgmt.removeSongDropPlaceholder}
 *   onDrop={windowMgmt.onSongDrop}
 *   >
 *   {children}
 *   </div>
 *   );
 *   }
 *   ```;
 *
 * @param appRef - Reference to the main app container element
 * @param options - Configuration options for window management
 * @returns Window management functions and event handlers
 */
export function useWindowManagement(
  appRef: RefObject<HTMLDivElement | null>,
  options: UseWindowManagementOptions = {}
) {
  const { changePromptMenuData, fetchSongFromUnknownSource } = options;

  /**
   * Manages window blur and focus states by adding/removing CSS classes.
   *
   * @param state - The window state to apply ('blur-sm' for blurred, 'focus' for focused)
   */
  const manageWindowBlurOrFocus = useCallback(
    (state: 'blur-sm' | 'focus') => {
      if (appRef.current) {
        if (state === 'blur-sm') appRef.current.classList.add('blurred');
        if (state === 'focus') appRef.current.classList.remove('blurred');
      }
    },
    [appRef]
  );

  /**
   * Manages fullscreen state by adding/removing CSS classes.
   *
   * @param state - The fullscreen state to apply ('fullscreen' or 'windowed')
   */
  const manageWindowFullscreen = useCallback(
    (state: 'fullscreen' | 'windowed') => {
      if (appRef.current) {
        if (state === 'fullscreen') {
          appRef.current.classList.add('fullscreen');
          document.body.classList.add('fullscreen');
        } else {
          appRef.current.classList.remove('fullscreen');
          document.body.classList.remove('fullscreen');
        }
      }
      return undefined;
    },
    [appRef]
  );

  const manageWindowMaximized = useCallback(
    (maximized: boolean) => {
      appRef.current?.classList.toggle('maximized', maximized);
      document.body.classList.toggle('maximized', maximized);
    },
    [appRef]
  );

  /**
   * Adds visual placeholder when a file is being dragged over the app.
   *
   * @param e - React drag event
   */
  const addSongDropPlaceholder = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.relatedTarget === null) appRef.current?.classList.add('song-drop');
    },
    [appRef]
  );

  /**
   * Removes visual placeholder when a dragged file leaves the app area.
   *
   * @param e - React drag event
   */
  const removeSongDropPlaceholder = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.relatedTarget === null) appRef.current?.classList.remove('song-drop');
    },
    [appRef]
  );

  /**
   * Handles file drop events, validating and processing dropped audio files.
   *
   * @param e - React drag event containing dropped files
   */
  const onSongDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      console.log(e.dataTransfer.files);
      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files.item(0);
        if (file) {
          const filePath = window.api.utils.showFilePath(file);
          console.log('Dropped file path:', filePath);
          const isASupportedAudioFormat = appPreferences.supportedMusicExtensions.some((type) =>
            file?.webkitRelativePath.endsWith(type)
          );

          if (isASupportedAudioFormat && fetchSongFromUnknownSource) {
            fetchSongFromUnknownSource(filePath);
          } else if (changePromptMenuData) {
            changePromptMenuData(
              true,
              <UnsupportedFileMessagePrompt filePath={filePath || file.name} />
            );
          }
        }
      }
      if (appRef.current) appRef.current.classList.remove('song-drop');
    },
    [appRef, changePromptMenuData, fetchSongFromUnknownSource]
  );

  /**
   * Updates the browser/window title bar with current song information. Displays song title and
   * artist names if available.
   */
  const addSongTitleToTitleBar = useCallback(() => {
    if (store.state.currentSongData.title && store.state.currentSongData.artists)
      document.title = `${store.state.currentSongData.title} - ${
        Array.isArray(store.state.currentSongData.artists) &&
        store.state.currentSongData.artists.map((artist) => artist.name).join(', ')
      }`;
  }, []);

  /** Resets the browser/window title bar to the default "Nora" title. */
  const resetTitleBarInfo = useCallback(() => {
    document.title = 'Volo';
  }, []);

  /**
   * Sets up event listeners for window state changes (blur, focus, fullscreen).
   * Uses native DOM listener because React's synthetic onDoubleClick can be
   * consumed by Chromium's drag-region handling. Automatically cleans up on unmount.
   * Note: double-click-to-toggle-fullscreen 已移除(用户要求取消该设定)。
   */
  useEffect(() => {
    const handleBlur = () => manageWindowBlurOrFocus('blur-sm');
    const handleFocus = () => manageWindowBlurOrFocus('focus');
    const removeBlur = window.api.windowControls.onWindowBlur(handleBlur);
    const removeFocus = window.api.windowControls.onWindowFocus(handleFocus);

    const removeEnterFullscreen = window.api.fullscreen.onEnterFullscreen(() =>
      manageWindowFullscreen('fullscreen')
    );
    const removeLeaveFullscreen = window.api.fullscreen.onLeaveFullscreen(() => {
      manageWindowFullscreen('windowed');
      void window.api.windowControls
        .isMaximizedApp()
        .then(manageWindowMaximized)
        .catch(() => {});
    });
    const removeMaximize = window.api.windowControls.onWindowMaximize(() =>
      manageWindowMaximized(true)
    );
    const removeUnmaximize = window.api.windowControls.onWindowUnmaximize(() =>
      manageWindowMaximized(false)
    );

    void Promise.all([
      window.api.fullscreen.isFullscreen(),
      window.api.windowControls.isMaximizedApp()
    ]).then(([fullscreen, maximized]) => {
      manageWindowFullscreen(fullscreen ? 'fullscreen' : 'windowed');
      manageWindowMaximized(maximized);
    }).catch(() => {});

    return () => {
      removeBlur();
      removeFocus();
      removeEnterFullscreen();
      removeLeaveFullscreen();
      removeMaximize();
      removeUnmaximize();
    };
  }, [manageWindowBlurOrFocus, manageWindowFullscreen, manageWindowMaximized]);

  return {
    manageWindowBlurOrFocus,
    manageWindowFullscreen,
    manageWindowMaximized,
    addSongDropPlaceholder,
    removeSongDropPlaceholder,
    onSongDrop,
    addSongTitleToTitleBar,
    resetTitleBarInfo
  };
}

export type UseWindowManagementReturn = ReturnType<typeof useWindowManagement>;
