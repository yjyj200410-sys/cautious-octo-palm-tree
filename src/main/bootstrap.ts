import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

// The static Windows interface needs no GPU effects. Software rendering reduces
// retained surfaces; an explicit opt-in remains available for driver compatibility.
if (process.platform === 'win32' && process.env.VOLO_HARDWARE_ACCELERATION !== '1') {
  app.disableHardwareAcceleration();
}

// Preserve the existing library, accounts, and preferences after the public rename.
const legacyUserDataPath = process.env.VOLO_USER_DATA || join(app.getPath('appData'), 'lumina');
mkdirSync(legacyUserDataPath, { recursive: true });
app.setPath('userData', legacyUserDataPath);

// Acquire the lock before importing modules that open databases, servers or windows.
// app.quit() alone does not stop the rest of a module from executing.
if (app.requestSingleInstanceLock()) {
  await import('./main');
} else {
  console.warn('Another app instance is currently active. Quitting this instance.');
  app.exit(0);
}
