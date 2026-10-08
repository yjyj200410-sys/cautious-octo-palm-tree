import { BrowserWindow, app, screen, ipcMain } from 'electron';
import { join } from 'path';
import logger from './logger';

const IS_DEV = !app.isPackaged || process.env.NODE_ENV === 'development';

let lyricsWindow: BrowserWindow | null = null;
let _devServerUrl: string | null = null;
let _enabled = false;

export function setDevUrl(url: string) {
  _devServerUrl = url;
  logger.info('Desktop lyrics dev URL set', { url });
}

function getPreloadPath(): string {
  return join(app.getAppPath(), 'out', 'preload', 'index.mjs');
}

// ── Window lifecycle (keep-alive — hide, don't destroy) ──────────────────

/**
 * Windows 上窗口创建/页面加载期间层级会被重置 — 反复强制置顶。
 * 用 'floating':盖住普通应用窗口但不覆盖任务栏/独占全屏
 * ('screen-saver' 最高层级会盖住任务栏)。
 */
function ensureAlwaysOnTop() {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.setAlwaysOnTop(true, 'floating');
    // Windows 上主窗口(透明无边框)被激活/重绘时,DWM 可能把置顶的桌面歌词压到其下。
    // setAlwaysOnTop 只重设 WS_EX_TOPMOST,不够把窗口重新提到最上层 — moveTop 直接
    // SetWindowPos(HWND_TOP, NOACTIVATE) 强制回到顶层带,配合守卫能可靠恢复。
    lyricsWindow.moveTop();
  }
}

// ── 置顶守卫 ──
// Windows 上透明 + focusable:false 的置顶窗口可能在其它窗口(尤其主窗口自定义全屏)获得焦点时
// 被压到下面(即使 WS_EX_TOPMOST 仍在)。仅靠创建/show/load 时 set 一次不够 — 需要持续守卫:
// 1) 应用内任一窗口获得焦点时重新置顶; 2) 窗口启用期间定时 re-assert 兜底。
let topmostTimer: ReturnType<typeof setInterval> | null = null;
let focusGuardAttached = false;

function reassertTopmost() {
  if (_enabled) ensureAlwaysOnTop();
}

function startTopmostGuard() {
  if (!app) return;
  if (!focusGuardAttached) {
    focusGuardAttached = true;
    app.on('browser-window-focus', reassertTopmost);
    // 新窗口出现(mini 播放器/托盘菜单都是置顶窗口)时立即重设置顶,避免被压到其下
    app.on('browser-window-created', reassertTopmost);
  }
  if (!topmostTimer) {
    topmostTimer = setInterval(() => {
      if (_enabled && lyricsWindow && !lyricsWindow.isDestroyed()) {
        ensureAlwaysOnTop();
      } else if (!_enabled) {
        stopTopmostGuard();
      }
    }, 1000);
  }
}

function stopTopmostGuard() {
  if (topmostTimer) {
    clearInterval(topmostTimer);
    topmostTimer = null;
  }
}

function getOrCreateWindow(): BrowserWindow {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) return lyricsWindow;

  const display = screen.getPrimaryDisplay();
  logger.info('Creating desktop lyrics window');

  lyricsWindow = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    show: false, // 预创建时保持隐藏,由 showDesktopLyrics 显示
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  ensureAlwaysOnTop();
  lyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  lyricsWindow.setIgnoreMouseEvents(true, { forward: true });

  if (_devServerUrl) {
    lyricsWindow.loadURL(_devServerUrl + '/desktop-lyrics.html');
  } else if (IS_DEV) {
    lyricsWindow.loadURL('http://localhost:5173/desktop-lyrics.html').catch(() => {
      const srcPath = join(app.getAppPath(), 'out', 'renderer', 'desktop-lyrics.html');
      if (lyricsWindow && !lyricsWindow.isDestroyed()) lyricsWindow.loadFile(srcPath);
    });
  } else {
    lyricsWindow.loadFile(join(app.getAppPath(), 'out', 'renderer', 'desktop-lyrics.html'));
  }

  lyricsWindow.webContents.on('did-finish-load', () => {
    logger.info('Desktop lyrics loaded');
    ensureAlwaysOnTop(); // 页面加载完成后重新置顶(加载期间层级可能被重置)
  });
  lyricsWindow.webContents.on('did-fail-load', (_e, code, desc) => logger.error('Desktop lyrics fail', { code, desc }));

  // Keep the window object even when user closes via OS — we detect and recreate
  lyricsWindow.on('closed', () => {
    lyricsWindow = null;
    if (_enabled) {
      // 外部关闭(如系统关窗) — 置为关闭态,下次点击开关重新创建
      logger.info('Desktop lyrics window closed externally, will recreate on next toggle');
      _enabled = false;
      broadcastDesktopLyricsState();
    }
  });

  return lyricsWindow;
}

// ── Public API ────────────────────────────────────────────────────────────

export function isDesktopLyricsEnabled(): boolean {
  return _enabled;
}

export function showDesktopLyrics(): void {
  const win = getOrCreateWindow();
  win.show();
  ensureAlwaysOnTop();
  _enabled = true;
  startTopmostGuard();
  logger.info('Desktop lyrics shown');
}

export function hideDesktopLyrics(): void {
  // 每次关闭都销毁窗口 — 不常驻 3D WebGL 渲染,点击开关按钮时才重新创建
  destroyDesktopLyricsWindow();
  logger.info('Desktop lyrics hidden & window destroyed');
}

/** 向所有窗口广播当前桌面歌词开关状态(main renderer 用它门控同步,避免关闭时仍构建/发送 IPC)。 */
function broadcastDesktopLyricsState(): void {
  const payload = { enabled: _enabled };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win && !win.isDestroyed()) win.webContents.send('desktop-lyrics:state-changed', payload);
  }
}

export function toggleDesktopLyrics(): boolean {
  if (_enabled) {
    hideDesktopLyrics();
  } else {
    showDesktopLyrics();
  }
  broadcastDesktopLyricsState();
  return _enabled;
}

export function destroyDesktopLyricsWindow(): void {
  if (lyricsWindow && !lyricsWindow.isDestroyed()) {
    lyricsWindow.close();
    lyricsWindow = null;
  }
  _enabled = false;
  stopTopmostGuard();
}

export function updateDesktopLyrics(opts: { x?: number; y?: number; opacity?: number; scale?: number }): void {
  if (!lyricsWindow || lyricsWindow.isDestroyed()) return;
  if (opts.x !== undefined || opts.y !== undefined) {
    const [wx, wy] = lyricsWindow.getPosition();
    lyricsWindow.setPosition(opts.x ?? wx, opts.y ?? wy);
  }
  if (opts.opacity !== undefined) lyricsWindow.setOpacity(opts.opacity);
  if (opts.scale !== undefined) lyricsWindow.webContents.setZoomFactor(opts.scale);
}

// ── IPC ───────────────────────────────────────────────────────────────────

export function setupDesktopLyricsIpc(): void {
  ipcMain.handle('desktop-lyrics:toggle', () => {
    return toggleDesktopLyrics();
  });

  ipcMain.handle('desktop-lyrics:get-state', () => {
    return _enabled;
  });

  ipcMain.handle('desktop-lyrics:update', (_e, opts) => {
    updateDesktopLyrics(opts);
  });

  let lastState: Record<string, unknown> | null = null;

  ipcMain.on('desktop-lyrics:send-state', (_e, payload) => {
    lastState = { ...lastState, ...payload };
    if (lyricsWindow && !lyricsWindow.isDestroyed() && _enabled) {
      lyricsWindow.webContents.send('desktop-lyrics:state', payload);
    }
  });

  ipcMain.handle('desktop-lyrics:get-current-state', () => {
    return lastState;
  });

  ipcMain.on('desktop-lyrics:ready', () => {
    logger.info('Desktop lyrics window ready');
    if (lastState && lyricsWindow && !lyricsWindow.isDestroyed()) {
      lyricsWindow.webContents.send('desktop-lyrics:state', lastState);
    }
  });

}
