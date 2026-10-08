/**
 * Singleton reference to the main BrowserWindow.
 * Extracted from main.ts to avoid circular imports:
 *   main.ts → ipc.ts → backgroundManager/fontManager → main.ts
 */
import type { BrowserWindow } from 'electron';

let _mainWindow: BrowserWindow | null = null;

export function setMainWindowRef(w: BrowserWindow) { _mainWindow = w; }
export function getMainWindow(): BrowserWindow {
  if (!_mainWindow) throw new Error('mainWindow not initialized');
  return _mainWindow;
}
