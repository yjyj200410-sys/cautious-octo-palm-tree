import { execFile } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { accessSync } from 'fs';
import { constants } from 'fs';
import path from 'path';

import logger from '../logger';

// ---------------------------------------------------------------------------
// Registry helper (Windows only)
// ---------------------------------------------------------------------------

function getRegistryValue(key: string, valueName: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null);
      return;
    }
    execFile(
      'reg',
      ['query', key, '/v', valueName],
      { timeout: 5000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        // Output looks like:
        //   HKEY_CURRENT_USER\Software\Valve\Steam
        //       SteamPath    REG_SZ    C:\Program Files (x86)\Steam
        const match = stdout.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/);
        resolve(match ? match[1].trim() : null);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Steam path detection
// ---------------------------------------------------------------------------

async function findSteamPath(): Promise<string | null> {
  // 1. Environment variable override
  const envPath = process.env.STEAM_PATH;
  if (envPath) {
    try {
      accessSync(envPath, constants.F_OK);
      return envPath;
    } catch {
      logger.warn('STEAM_PATH env var set but directory does not exist', { envPath });
    }
  }

  // 2. Windows registry
  const regPath = await getRegistryValue(
    'HKEY_CURRENT_USER\\Software\\Valve\\Steam',
    'SteamPath'
  );
  if (regPath) {
    try {
      accessSync(regPath, constants.F_OK);
      return regPath;
    } catch {
      logger.warn('Registry SteamPath exists but directory not accessible', { regPath });
    }
  }

  // 3. Common paths
  const commonPaths = [
    'C:\\Program Files (x86)\\Steam',
    'D:\\Steam',
    'D:\\Program Files (x86)\\Steam',
    'E:\\Steam',
  ];

  // On non-Windows (WSL), also check /mnt/ mounts
  if (process.platform !== 'win32') {
    commonPaths.push(
      '/mnt/c/Program Files (x86)/Steam',
      '/mnt/d/Steam',
      '/mnt/d/Program Files (x86)/Steam',
      '/mnt/e/Steam'
    );
  }

  for (const p of commonPaths) {
    try {
      accessSync(p, constants.F_OK);
      return p;
    } catch {
      // not found, continue
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// WE content folder discovery
// ---------------------------------------------------------------------------

function findWeContentFolders(steamPath: string): string[] {
  const folders: string[] = [];

  // Workshop downloads (431960 = Wallpaper Engine Steam App ID)
  const workshopPath = path.join(steamPath, 'steamapps', 'workshop', 'content', '431960');
  try {
    accessSync(workshopPath, constants.F_OK);
    folders.push(workshopPath);
  } catch {
    // not found
  }

  // Default / local projects
  const projectsPath = path.join(
    steamPath,
    'steamapps',
    'common',
    'wallpaper_engine',
    'projects'
  );
  try {
    accessSync(projectsPath, constants.F_OK);
    folders.push(projectsPath);
  } catch {
    // not found
  }

  return folders;
}

// ---------------------------------------------------------------------------
// Per-folder scanner
// ---------------------------------------------------------------------------

interface ProjectJson {
  title?: string;
  type?: string;
  file?: string;
  url?: string;
  preview?: string;
  category?: string;
}

async function scanWallpaperFolder(
  folderPath: string
): Promise<WallpaperEngineWallpaper | null> {
  let entries: string[];
  try {
    entries = await readdir(folderPath);
  } catch {
    return null;
  }

  // Look for project.json
  const projectFile = entries.find(
    (e) => e.toLowerCase() === 'project.json'
  );
  if (!projectFile) return null;

  let json: ProjectJson;
  try {
    const raw = await readFile(path.join(folderPath, projectFile), 'utf-8');
    json = JSON.parse(raw);
  } catch {
    logger.debug('Failed to parse project.json', { folderPath });
    return null;
  }

  // Skip editor assets/plugins (have "category" field)
  if (json.category) return null;

  // Detect wallpaper type.  Many wallpapers omit the "type" field;
  // we infer it from the file extension instead.
  function detectType(): 'video' | 'web' | 'scene' | null {
    const rawType = json.type?.toLowerCase();
    if (rawType === 'video' || rawType === 'web' || rawType === 'scene') return rawType;
    const fileName = (json.file || '').toLowerCase();
    if (fileName === 'scene.json' || ['.pkg', '.json'].includes(path.extname(fileName))) return 'scene';
    const ext = path.extname(fileName);
    if (ext === '.html' || ext === '.htm') return 'web';
    if (['.mp4', '.webm', '.mov', '.mkv', '.avi', '.wmv'].includes(ext)) return 'video';
    return null;
  }
  const wallpaperType = detectType();
  if (!wallpaperType) return null;
  const title = json.title || path.basename(folderPath);

  // Resolve main file
  let file = '';
  if (wallpaperType === 'web' && json.url) {
    file = json.url;
  } else if (wallpaperType === 'scene') {
    // Scene wallpapers: project.json may reference scene.json but the
    // actual file is often scene.pkg.  Find any .pkg or .json in the folder,
    // preferring .pkg (it's the compiled WE asset bundle).
    const pkgFile = entries.find((e) => path.extname(e).toLowerCase() === '.pkg');
    if (pkgFile) {
      file = path.join(folderPath, pkgFile);
    } else if (json.file) {
      file = path.resolve(folderPath, json.file);
      try { accessSync(file, constants.F_OK); } catch { file = ''; }
    }
    if (!file) {
      // Last resort: use project.json itself
      file = path.join(folderPath, projectFile);
    }
  } else if (json.file) {
    file = path.resolve(folderPath, json.file);
  } else if (wallpaperType === 'video') {
    // Web type: find an HTML entry
    const htmlFile = entries.find(
      (e) => path.extname(e).toLowerCase() === '.html' || path.extname(e).toLowerCase() === '.htm'
    );
    if (htmlFile) {
      file = path.join(folderPath, htmlFile);
    }
  }

  if (!file) return null;

  // Validate file extensions
  const ext = path.extname(file).toLowerCase();
  const validVideoExts = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.wmv'];
  const validWebExts = ['.html', '.htm'];
  const validSceneExts = ['.pkg', '.json'];
  const validExts =
    wallpaperType === 'video' ? validVideoExts :
    wallpaperType === 'scene' ? validSceneExts :
    validWebExts;
  if (!/^https?:\/\//i.test(file) && !validExts.includes(ext)) {
    return null;
  }

  // Verify the file exists (skip for external URLs)
  if (!/^https?:\/\//i.test(file)) {
    try {
      accessSync(file, constants.F_OK);
    } catch {
      logger.debug('Wallpaper file not found on disk', { file });
      return null;
    }
  }

  // Resolve preview
  let preview = '';
  if (json.preview) {
    preview = path.resolve(folderPath, json.preview);
  } else {
    // Fallback: find an image file
    const imgExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const imgFile = entries.find((e) =>
      imgExts.includes(path.extname(e).toLowerCase())
    );
    if (imgFile) {
      preview = path.join(folderPath, imgFile);
    }
  }

  // Require a preview image — skips editor plugins & non-wallpaper assets
  if (!preview) return null;

  return {
    title,
    file,
    preview,
    folderPath,
    wallpaperType,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function getWallpaperEngineWallpapers(): Promise<WallpaperEngineResult> {
  const errors: { message: string; folderPath?: string }[] = [];

  const steamPath = await findSteamPath();
  if (!steamPath) {
    return {
      wallpapers: [],
      fatalError: 'Steam installation not found',
    };
  }

  logger.info('Found Steam at', { steamPath });

  const contentFolders = findWeContentFolders(steamPath);
  if (contentFolders.length === 0) {
    return {
      wallpapers: [],
      fatalError: 'Wallpaper Engine content not found',
      scanLocations: [steamPath],
    };
  }

  logger.info('WE content folders', { contentFolders });

  const wallpapers: WallpaperEngineWallpaper[] = [];

  for (const contentFolder of contentFolders) {
    let itemDirs: string[];
    try {
      itemDirs = await readdir(contentFolder);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ message: `Cannot read ${contentFolder}: ${msg}` });
      continue;
    }

    for (const itemName of itemDirs) {
      const itemPath = path.join(contentFolder, itemName);

      // Skip non-directory entries (like desktop.ini)
      try {
        accessSync(itemPath, constants.F_OK);
      } catch {
        continue;
      }

      try {
        const wallpaper = await scanWallpaperFolder(itemPath);
        if (wallpaper) {
          wallpapers.push(wallpaper);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push({ message: msg, folderPath: itemPath });
      }
    }
  }

  const typeCounts = {
    video: wallpapers.filter((w) => w.wallpaperType === 'video').length,
    web: wallpapers.filter((w) => w.wallpaperType === 'web').length,
    scene: wallpapers.filter((w) => w.wallpaperType === 'scene').length,
  };
  logger.info('WE scan complete', { total: wallpapers.length, ...typeCounts });

  return {
    wallpapers,
    errors: errors.length > 0 ? errors : undefined,
    scanLocations: contentFolders,
  };
}
