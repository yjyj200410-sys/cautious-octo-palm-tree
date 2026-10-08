import type { BrowserWindow } from 'electron';
import koffi from 'koffi';
import logger from '../logger';

type NativeRect = { left: number; top: number; right: number; bottom: number };
type MonitorInfo = { size: number; bounds: NativeRect; work: NativeRect; flags: number };

const WM_NCCALCSIZE = 0x83;
const ABM_GETAUTOHIDEBAREX = 11;
// Chromium reserves two physical pixels at each auto-hide taskbar edge.
const AUTO_HIDE_INSET = 2;
const TASKBAR_EDGES = ['left', 'top', 'right', 'bottom'] as const;

/** Preserve native maximization while compensating for Chromium's auto-hide inset. */
export function installWindowsMaximizeEdges(window: BrowserWindow) {
  if (process.platform !== 'win32' || process.arch !== 'x64') return;
  if (window.isWindowMessageHooked(WM_NCCALCSIZE)) return;

  try {
    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');
    const rectType = koffi.struct({ left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    const monitorType = koffi.struct({ size: 'uint32_t', bounds: rectType, work: rectType, flags: 'uint32_t' });
    const appbarType = koffi.struct({
      size: 'uint32_t', hwnd: 'void *', callback: 'uint32_t', edge: 'uint32_t',
      rect: rectType, param: 'intptr_t'
    });
    const isZoomed = user32.func('bool __stdcall IsZoomed(void *hwnd)');
    const nearestMonitor = user32.func('void * __stdcall MonitorFromWindow(void *hwnd, uint32_t flags)');
    const getMonitorInfo = user32.func('__stdcall', 'GetMonitorInfoW', 'bool', ['void *', koffi.inout(koffi.pointer(monitorType))]);
    const getAppbar = shell32.func('__stdcall', 'SHAppBarMessage', 'uintptr_t', ['uint32_t', koffi.inout(koffi.pointer(appbarType))]);
    const hwnd = koffi.decode(window.getNativeWindowHandle(), 'void *');
    let reportedError = false;

    // Electron enters JS with its own V8 scope. Replacing GWL_WNDPROC with a
    // Koffi JS callback wraps the native size/move loop and crashes on resizing.
    // This hook runs before Chromium: expand only the edges it will inset.
    window.hookWindowMessage(WM_NCCALCSIZE, (_wParam, lParam) => {
      try {
        if (!isZoomed(hwnd) || window.isFullScreen()) return;
        const rectPointer = koffi.decode(lParam, 'void *');
        if (!rectPointer) return;
        const monitor = { size: koffi.sizeof(monitorType) } as MonitorInfo;
        if (!getMonitorInfo(nearestMonitor(hwnd, 2), monitor)) return;
        // A visible taskbar keeps its reserved work area.
        if (!TASKBAR_EDGES.every(edge => monitor.bounds[edge] === monitor.work[edge])) return;

        const rect = koffi.decode(rectPointer, rectType) as NativeRect;
        let changed = false;
        TASKBAR_EDGES.forEach((edge, index) => {
          const appbar = {
            size: koffi.sizeof(appbarType), hwnd: null, callback: 0,
            edge: index, rect: monitor.bounds, param: 0
          };
          if (!getAppbar(ABM_GETAUTOHIDEBAREX, appbar)) return;
          rect[edge] += index < 2 ? -AUTO_HIDE_INSET : AUTO_HIDE_INSET;
          changed = true;
        });
        if (changed) koffi.encode(rectPointer, rectType, rect);
      } catch (error) {
        // Leave Chromium's normal calculation intact if an OS query fails.
        if (!reportedError) {
          reportedError = true;
          logger.warn('Could not correct maximized window edges.', { error });
        }
      }
    });
  } catch (error) {
    logger.warn('Could not install maximized window edge correction.', { error });
  }
}
