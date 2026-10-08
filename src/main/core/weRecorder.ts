/**
 * Wallpaper Engine window recorder.
 *
 * Launches a specific wallpaper in a separate WE window, locates it via
 * desktopCapturer, then the renderer captures it with getUserMedia +
 * MediaRecorder.  The recorded WebM is saved as a video background.
 */
import { execFile } from 'child_process';
import { desktopCapturer, screen, session } from 'electron';
import { join, dirname, extname, basename } from 'path';
import { existsSync } from 'fs';
import logger from '../logger';
import { focusWindowByTitle, closeWindowByTitle, getWindowRectByTitle } from './win32Window';

// ---------------------------------------------------------------------------
// WE installation discovery
// ---------------------------------------------------------------------------

function findWEExe(): string {
  const candidates = [
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe',
    'D:\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe',
    'E:\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe',
  ];

  // Also check from registry path read at startup
  if (process.env.WE_INSTALL_PATH) {
    candidates.unshift(join(process.env.WE_INSTALL_PATH, 'wallpaper64.exe'));
  }

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]; // fallback — will fail with ENOENT if not found
}

let cachedWEExe = '';

function getWEExe(): string {
  if (!cachedWEExe) cachedWEExe = findWEExe();
  return cachedWEExe;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface WECaptureTarget {
  sourceId: string;
  windowTitle: string;
  /** Measured window rect in screen (logical) coords, or null if it could not be measured. */
  rect: { x: number; y: number; width: number; height: number } | null;
}

// ---------------------------------------------------------------------------
// Display-media (Windows Graphics Capture) auto-grant
// ---------------------------------------------------------------------------
// WE scene windows are GPU-rendered; the DXGI backend behind
// desktopCapturer/getUserMedia('desktop') often returns black for them.  The
// WGC backend behind getDisplayMedia captures the composited/GPU surface more
// reliably.  We auto-grant (no system picker) the current WE capture window —
// falling back to the primary screen — so the renderer can capture via WGC.
// ---------------------------------------------------------------------------

let currentWETitle = '';

export function setCurrentWETitle(title: string): void {
  currentWETitle = title;
}

export function installDisplayMediaHandler(): void {
  try {
    session.defaultSession.setDisplayMediaRequestHandler(
      async (_request, callback) => {
        try {
          const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
          // The WE scene window renders as a hardware overlay (MPO plane) that
          // GDI/DXGI composite capture miss, and WGC WINDOW capture of it fails
          // with NotReadableError.  WGC SCREEN capture is the path that includes
          // MPO overlays, so grant the display that contains the WE window.
          let target = sources.find((s) => s.id.startsWith('screen:'));
          if (currentWETitle) {
            const rect = await getWindowRectByTitle(currentWETitle);
            if (rect) {
              const disp = screen.getDisplayMatching({
                x: rect.x + Math.floor(rect.width / 2),
                y: rect.y + Math.floor(rect.height / 2),
                width: 1,
                height: 1,
              });
              const matching = sources.find(
                (s) => s.id.startsWith('screen:') && s.display_id === String(disp.id),
              );
              if (matching) target = matching;
            }
          }
          logger.debug('WGC: granting screen', {
            id: target?.id, name: target?.name, title: currentWETitle,
          });
          callback({ video: target || sources[0] });
        } catch {
          callback({});
        }
      },
      { useSystemPicker: false },
    );
  } catch (e) {
    logger.warn('Failed to install display media handler', { err: String(e) });
  }
}

/**
 * Launch WE with a specific wallpaper in a borderless window.
 * Waits for the window to appear, then returns the desktopCapturer source id.
 */
export async function launchWEWindow(
  wallpaperPath: string,
  width: number,
  height: number,
): Promise<WECaptureTarget> {
  const weExe = getWEExe();
  const windowTitle = `LuminaWE_${Date.now()}`;
  setCurrentWETitle(windowTitle);

  // Scene wallpapers come as a bare scene.pkg (or scene.json).  WE will NOT
  // render a bare package / scene file (nor the bare folder) in a window — it
  // needs the wallpaper's project.json itself.  Resolve scene files → sibling
  // project.json.  Video (.mp4/.webm) and web (.html) wallpapers are left alone.
  const rawPath = wallpaperPath;
  const ext = extname(wallpaperPath).toLowerCase();
  const base = basename(wallpaperPath).toLowerCase();
  if (ext === '.pkg' || (ext === '.json' && base !== 'project.json')) {
    const projectJson = join(dirname(wallpaperPath), 'project.json');
    if (existsSync(projectJson)) wallpaperPath = projectJson;
  }

  // Center the window on the primary display so the screen-crop position is
  // deterministic even if the rect measurement below fails.
  const primary = screen.getPrimaryDisplay().workAreaSize;
  const winX = Math.max(0, Math.floor((primary.width - width) / 2));
  const winY = Math.max(0, Math.floor((primary.height - height) / 2));

  logger.info('Launching WE capture window', {
    weExe, wallpaperPath, rawPath, width, height, winX, winY, windowTitle,
  });

  await new Promise<void>((resolve, reject) => {
    execFile(
      weExe,
      [
        '-control', 'openWallpaper',
        '-file', wallpaperPath,
        '-playInWindow', windowTitle,
        '-width', String(width),
        '-height', String(height),
        '-x', String(winX),
        '-y', String(winY),
        '-borderless',
        '-activate',
      ],
      { timeout: 30000 },
      (err, _stdout, stderr) => {
        if (err) {
          logger.error('WE launch failed', { err: err.message, stderr });
          reject(new Error(`WE 启动失败: ${err.message}`));
        } else {
          resolve();
        }
      },
    );
  });

  // Poll for the window to appear (can take 1-5s for scene wallpapers)
  const sourceId = await waitForWindow(windowTitle, 15000);
  if (!sourceId) {
    throw new Error(`未能找到 WE 捕获窗口 "${windowTitle}"。请确认 Wallpaper Engine 正在运行。`);
  }

  // Force the WE window to topmost
  await focusWindowByTitle(windowTitle);

  // Measure the actual window rect so the renderer can crop to the real window.
  // The window may still be settling right after it appears — GetWindowRect
  // reports 0x0 while it is still initialising, so retry until a non-zero rect.
  let rect: { x: number; y: number; width: number; height: number } | null = null;
  for (let i = 0; i < 8 && !rect; i++) {
    const r = await getWindowRectByTitle(windowTitle);
    if (r && r.width > 0 && r.height > 0) rect = r;
    else await sleep(250);
  }

  logger.info('WE capture window ready', { windowTitle, sourceId, rect });
  return { sourceId, windowTitle, rect };
}

/**
 * Close the WE capture window.
 * Tries targeted close first, falls back to closing all (which restores desktop).
 */
/**
 * Close the WE capture window.  Tries WE CLI first, falls back to Win32.
 */
export async function closeWEWindow(windowTitle: string): Promise<void> {
  // 1) Try WE native close command
  const weExe = getWEExe();
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(weExe, ['-control', 'closeWallpaper'], { timeout: 5000 }, (err) => {
        err ? reject(err) : resolve();
      });
    });
    logger.debug('WE window closed via CLI');
    return;
  } catch {
    logger.debug('WE CLI closeWallpaper failed, trying Win32 WM_CLOSE');
  }

  // 2) Fallback: Win32 WM_CLOSE
  await closeWindowByTitle(windowTitle);
}

/**
 * Close the WE capture window by title.
 * (Legacy wrapper — kept for IPC compatibility.)
 */
export async function closeWEWindowLegacy(): Promise<void> {
  const weExe = getWEExe();
  await new Promise<void>((resolve) => {
    execFile(weExe, ['-control', 'closeAllWallpapers'], { timeout: 5000 }, (err) => {
      if (err) logger.warn('Failed to close WE windows', { err: err.message });
      resolve();
    });
  });
}

/**
 * Get all window-level desktopCapturer sources.
 * Used by the renderer for getUserMedia.
 */
export async function getWindowSources(): Promise<{ id: string; name: string }[]> {
  const sources = await desktopCapturer.getSources({ types: ['window'] });
  return sources.map((s) => ({ id: s.id, name: s.name }));
}

// ---------------------------------------------------------------------------
// Internal: window discovery
// ---------------------------------------------------------------------------

async function waitForWindow(title: string, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const sources = await desktopCapturer.getSources({ types: ['window'] });
    const match = sources.find((s) => s.name === title);
    if (match) return match.id;
    await sleep(500);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
