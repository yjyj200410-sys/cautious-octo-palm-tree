import { BrowserWindow, app, screen, ipcMain, Menu } from 'electron';
import { join } from 'path';
import logger from './logger';
import { getUserSettings, saveUserSettings } from './db/queries/settings';

const IS_DEV = !app.isPackaged || process.env.NODE_ENV === 'development';

const MINI_WIDTH = 360;
const MINI_HEIGHT = 90;

let miniWindow: BrowserWindow | null = null;
let mainWindowRef: BrowserWindow | null = null;
let _devServerUrl: string | null = null;
let _lastState: Record<string, unknown> | null = null;
// 预创建时(false)保持隐藏;用户 toggle 打开时(true)ready 后显示
let _shouldShowOnReady = false;
// 左区模式(右键菜单 checkbox 状态,由 mini 渲染器上报)
let _leftMode: 'lyrics' | 'cover' = 'lyrics';

function notifyMiniVisibility(visible: boolean): void {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('mini-player:visibility-changed', visible);
  }
}

export function setDevUrl(url: string) {
  _devServerUrl = url;
}

export function setMainWindowRef(win: BrowserWindow | null) {
  mainWindowRef = win;
}

function getPreloadPath(): string {
  return join(app.getAppPath(), 'out', 'preload', 'index.mjs');
}

function loadMiniPlayer() {
  if (!miniWindow) return;
  if (_devServerUrl) {
    miniWindow.loadURL(_devServerUrl + '/mini-player.html');
  } else if (IS_DEV) {
    miniWindow.loadURL('http://localhost:5173/mini-player.html').catch(() => {
      const srcPath = join(app.getAppPath(), 'out', 'renderer', 'mini-player.html');
      if (miniWindow && !miniWindow.isDestroyed()) miniWindow.loadFile(srcPath);
    });
  } else {
    miniWindow.loadFile(join(app.getAppPath(), 'out', 'renderer', 'mini-player.html'));
  }
}

// ── Window lifecycle ────────────────────────────────────────────────────────

async function createWindow(): Promise<BrowserWindow> {
  if (miniWindow && !miniWindow.isDestroyed()) return miniWindow;

  const display = screen.getPrimaryDisplay();
  // 首次打开:屏幕右上角;之后用记忆位置
  const settings = await getUserSettings();
  let x = display.workArea.x + display.workArea.width - MINI_WIDTH - 24;
  let y = display.workArea.y + 24;
  let hasSavedPos = false;
  if (typeof settings.miniPlayerX === 'number' && typeof settings.miniPlayerY === 'number') {
    x = settings.miniPlayerX;
    y = settings.miniPlayerY;
    hasSavedPos = true;
  }
  // 旧版窗口更窄；升级尺寸后让记忆位置仍完整留在对应显示器内。
  const area = hasSavedPos ? screen.getDisplayNearestPoint({ x, y }).workArea : display.workArea;
  x = Math.max(area.x, Math.min(x, area.x + area.width - MINI_WIDTH));
  y = Math.max(area.y, Math.min(y, area.y + area.height - MINI_HEIGHT));
  logger.info('Creating mini player window', { x, y, hasSavedPos });

  miniWindow = new BrowserWindow({
    width: MINI_WIDTH,
    height: MINI_HEIGHT,
    x,
    y,
    transparent: false,
    // 使用不透明底色，加载阶段与播放器背景一致。
    backgroundColor: '#0f1115',
    roundedCorners: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  loadMiniPlayer();

  miniWindow.once('ready-to-show', () => {
    // 仅用户主动打开时显示(预创建保持隐藏)
    if (miniWindow && !miniWindow.isDestroyed() && _shouldShowOnReady) {
      miniWindow.show();
      notifyMiniVisibility(true);
    }
  });

  // 记忆窗口位置
  miniWindow.on('moved', () => {
    if (miniWindow && !miniWindow.isDestroyed()) {
      const [px, py] = miniWindow.getPosition();
      saveUserSettings({ miniPlayerX: px, miniPlayerY: py });
    }
  });

  miniWindow.on('closed', () => {
    miniWindow = null;
    notifyMiniVisibility(false);
  });

  return miniWindow;
}

/** 应用启动时预创建窗口(保持隐藏),首次打开即时显示,无需等待加载。 */
export async function preloadMiniPlayerWindow(): Promise<void> {
  if (!miniWindow || miniWindow.isDestroyed()) await createWindow();
}

export async function toggleMiniPlayer(): Promise<boolean> {
  if (miniWindow && !miniWindow.isDestroyed()) {
    if (miniWindow.isVisible()) {
      miniWindow.hide();
    } else {
      miniWindow.show();
      miniWindow.focus();
      if (_lastState) miniWindow.webContents.send('mini-player:state', _lastState);
    }
  } else {
    _shouldShowOnReady = true;
    await createWindow();
    // 窗口已加载完成时立即显示,否则等 ready-to-show
    if (miniWindow && !miniWindow.isDestroyed() && !miniWindow.webContents.isLoading()) {
      miniWindow.show();
    }
    // 补发最后状态,窗口渲染器 ready 时再拉取
    if (_lastState && miniWindow) {
      miniWindow.webContents.once('did-finish-load', () => {
        miniWindow?.webContents.send('mini-player:state', _lastState);
      });
    }
  }
  notifyMiniVisibility(!!(miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()));
  return !!(miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible());
}

export function isMiniPlayerVisible(): boolean {
  return !!(miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible());
}

export function sendStateToMini(state: Record<string, unknown>): void {
  _lastState = state;
  if (miniWindow && !miniWindow.isDestroyed() && miniWindow.isVisible()) {
    miniWindow.webContents.send('mini-player:state', state);
  }
}

export function destroyMiniPlayerWindow(): void {
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.destroy();
  }
  miniWindow = null;
}

// ── Context menu (右键:关闭/固定窗口/打开主窗口) ─────────────────────────

function showContextMenu() {
  if (!miniWindow || miniWindow.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    {
      label: '置顶显示',
      type: 'checkbox',
      checked: miniWindow.isAlwaysOnTop(),
      click: (item) => {
        miniWindow?.setAlwaysOnTop(item.checked);
      },
    },
    {
      label: '显示当前歌词',
      type: 'checkbox',
      checked: _leftMode === 'lyrics',
      click: (item) => {
        const next = item.checked ? 'lyrics' : 'cover';
        _leftMode = next;
        miniWindow?.webContents.send('mini-player:left-mode-changed', next);
      },
    },
    { type: 'separator' },
    {
      label: '打开主窗口',
      click: () => {
        if (mainWindowRef && !mainWindowRef.isDestroyed()) {
          if (mainWindowRef.isMinimized()) mainWindowRef.restore();
          mainWindowRef.show();
          mainWindowRef.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: '关闭迷你播放器',
      click: () => {
        miniWindow?.close();
      },
    },
  ]);
  menu.popup({ window: miniWindow });
}

// ── IPC ─────────────────────────────────────────────────────────────────────

export function setupMiniPlayerIpc(): void {
  ipcMain.handle('mini-player:toggle', () => toggleMiniPlayer());

  ipcMain.handle('mini-player:get-state', () => isMiniPlayerVisible());

  // mini 窗口关闭按钮 → 销毁窗口
  ipcMain.on('mini-player:close', () => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.close();
  });

  ipcMain.on('mini-player:send-state', (_e, state: Record<string, unknown>) => {
    sendStateToMini(state);
  });

  // mini 窗口 → 主窗口命令中转(expand/openMain 先显示主窗口)
  ipcMain.on('mini-player:command', (_e, cmd: { type: string; value?: number }) => {
    if (!cmd?.type) return;
    if (cmd.type === 'expand' || cmd.type === 'openMain') {
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        if (mainWindowRef.isMinimized()) mainWindowRef.restore();
        mainWindowRef.show();
        mainWindowRef.focus();
      }
    }
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.webContents.send('mini-player:command', cmd);
    }
  });

  ipcMain.on('mini-player:context-menu', () => showContextMenu());

  // 左区模式:mini 渲染器上报 / main 菜单切换后下发
  ipcMain.on('mini-player:left-mode', (_e, mode: string) => {
    _leftMode = mode === 'cover' ? 'cover' : 'lyrics';
  });
  ipcMain.on('mini-player:set-left-mode', (_e, mode: string) => {
    const next = mode === 'cover' ? 'cover' : 'lyrics';
    _leftMode = next;
    if (miniWindow && !miniWindow.isDestroyed()) {
      miniWindow.webContents.send('mini-player:left-mode-changed', next);
    }
  });
}
