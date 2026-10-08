import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { app } from 'electron';

// Preserve the existing library, accounts, and preferences after the public rename.
const legacyUserDataPath = join(app.getPath('appData'), 'lumina');
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
