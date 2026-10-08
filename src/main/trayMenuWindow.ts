import { BrowserWindow, app, ipcMain, screen } from 'electron';
import { join } from 'path';
import logger from './logger';

const IS_DEV = !app.isPackaged || process.env.NODE_ENV === 'development';

const MENU_WIDTH = 210;
const MENU_HEIGHT = 320;

let menuWindow: BrowserWindow | null = null;
let _devServerUrl: string | null = null;

export function setDevUrl(url: string) {
  _devServerUrl = url;
}

function getPreloadPath(): string {
  return join(app.getAppPath(), 'out', 'preload', 'index.mjs');
}

function ensureWindow(): BrowserWindow {
  if (menuWindow && !menuWindow.isDestroyed()) return menuWindow;

  menuWindow = new BrowserWindow({
    width: MENU_WIDTH,
    height: MENU_HEIGHT,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (_devServerUrl) {
    menuWindow.loadURL(_devServerUrl + '/tray-menu.html');
  } else if (IS_DEV) {
    menuWindow.loadURL('http://localhost:5173/tray-menu.html').catch(() => {
      const srcPath = join(app.getAppPath(), 'out', 'renderer', 'tray-menu.html');
      if (menuWindow && !menuWindow.isDestroyed()) menuWindow.loadFile(srcPath);
    });
  } else {
    menuWindow.loadFile(join(app.getAppPath(), 'out', 'renderer', 'tray-menu.html'));
  }

  // 失焦即关闭(点击菜单外任意窗口)
  menuWindow.on('blur', () => {
    if (menuWindow && !menuWindow.isDestroyed()) menuWindow.hide();
  });

  menuWindow.on('closed', () => {
    menuWindow = null;
  });

  return menuWindow;
}

/** 应用启动时预创建菜单窗口(保持隐藏),右键托盘即时显示。 */
export function preloadTrayMenuWindow(): void {
  ensureWindow();
}

/** 在托盘图标位置显示菜单(置顶)— 菜单底部对齐图标,空间不足时反向往上/向内收 */
export function showTrayMenu(x: number, y: number): void {
  const win = ensureWindow();
  const workArea = screen.getDisplayNearestPoint({ x, y }).workArea;
  let winX = Math.round(x);
  let winY = Math.round(y - MENU_HEIGHT); // 底边对齐图标(菜单在图标上方)
  // 上方空间不足 → 向下弹出
  if (winY < workArea.y) winY = Math.round(y);
  // 右侧溢出 → 左移
  if (winX + MENU_WIDTH > workArea.x + workArea.width) winX = workArea.x + workArea.width - MENU_WIDTH;
  win.setPosition(winX, winY);
  win.show();
  win.focus();
  logger.debug('Tray menu shown', { winX, winY });
}

export function hideTrayMenu(): void {
  if (menuWindow && !menuWindow.isDestroyed()) menuWindow.hide();
}

export function sendTrayMenuState(state: Record<string, unknown>): void {
  if (menuWindow && !menuWindow.isDestroyed() && menuWindow.isVisible()) {
    menuWindow.webContents.send('tray-menu:state', state);
  }
}

export function setupTrayMenuIpc(): void {
  ipcMain.on('tray-menu:close', () => hideTrayMenu());
}
