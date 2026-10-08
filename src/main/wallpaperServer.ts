/**
 * Wallpaper Engine compatible HTTP server for local web wallpapers.
 * Serves wallpaper files from {userData}/wallpapers/{id}/ via http://127.0.0.1:25885
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { join, resolve, extname } from 'path';
import { app } from 'electron';
import logger from './logger';

const PORT = 25885;
const HOST = '127.0.0.1';

let server: ReturnType<typeof createServer> | null = null;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.xml': 'application/xml; charset=utf-8',
  '.glsl': 'text/plain; charset=utf-8', '.vert': 'text/plain; charset=utf-8', '.frag': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function makePolyfill(wallpaperId: string): string {
  const baseHref = `/wallpaper/${wallpaperId}/`;
  return `<base href="${baseHref}"><script>
(function(){
var w=window,title=document.title||location.pathname.split('/').pop()||'?';
var log=function(m,d){console.log('[Nora:'+title+']',m,d||'');};
log('polyfill loaded');

w.__noraListeners=[];
w.__noraLastSpectrum=[];

w.wallpaperRegisterAudioListener=function(cb){
  log('registerAudioListener called');
  w.__noraListeners.push(cb);
  if(w.__noraLastSpectrum.length>0)try{cb(w.__noraLastSpectrum)}catch(_){}
};

w.wallpaperAudio={spectrum:[]};

w.addEventListener('message',function(e){
  var d=e.data;
  if(!d||d.type!=='nora:audioLevels')return;
  if(Array.isArray(d.spectrum)){
    w.wallpaperAudio.spectrum=d.spectrum;
    w.__noraLastSpectrum=d.spectrum;
  }
  var cbData=w.__noraLastSpectrum;
  if(cbData.length===0&&Array.isArray(d.levels))cbData=d.levels;
  var L=w.__noraListeners;
  for(var i=0;i<L.length;i++)try{L[i](cbData)}catch(_){}
  if(!w.__noraDebugged){w.__noraDebugged=true;log('first audio cb listeners='+L.length+' bins='+cbData.length);}
});

w.wallpaperPropertyListener=w.wallpaperPropertyListener||{applyUserProperties:function(){},applyGeneralProperties:function(){}};
w.wallpaperRequestRandom=w.wallpaperRequestRandom||function(){return Math.random()};
w.cefQuery=w.cefQuery||function(r){if(r&&r.onSuccess)r.onSuccess('')};
w.wpAudioControl=w.wpAudioControl||{setMute:function(){},setUnmute:function(){}};
})();
<\/script>`;
}

function injectPolyfill(html: string, wallpaperId: string): string {
  const polyfill = makePolyfill(wallpaperId);
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, '$&' + polyfill);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, '$&' + polyfill);
  return polyfill + html;
}

// ── Server ────────────────────────────────────────────────
const wallpaperBaseDir = (): string => join(app.getPath('userData'), 'wallpapers');

export function getWallpaperUrl(wallpaperId: string, file = 'index.html'): string {
  return `http://${HOST}:${PORT}/wallpaper/${wallpaperId}/${file}`;
}

export function getWallpaperDir(wallpaperId: string): string {
  return join(wallpaperBaseDir(), wallpaperId);
}

export async function startWallpaperServer(): Promise<void> {
  if (server) return;
  const baseDir = wallpaperBaseDir();

  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    const pathname = decodeURI(url.pathname);

    // Built-in wallpapers
    const builtinMatch = pathname.match(/^\/builtin\/(.+)$/);
    if (builtinMatch) {
      const safeName = builtinMatch[1].replace(/\.\./g, '');
      const searchPaths = [
        join(process.resourcesPath, 'builtin-wallpapers', safeName),
        join(app.getAppPath(), 'out', 'builtin-wallpapers', safeName),
      ];
      let builtinPath = '';
      for (const p of searchPaths) { if (existsSync(p)) { builtinPath = p; break; } }
      if (builtinPath) {
        const ext = extname(builtinPath).toLowerCase();
        res.setHeader('Content-Type', MIME[ext] || 'text/html');
        res.setHeader('Cache-Control', 'no-cache');
        const html = readFileSync(builtinPath, 'utf-8');
        const injected = injectPolyfill(html, 'builtin');
        res.setHeader('Content-Length', Buffer.byteLength(injected, 'utf-8'));
        res.end(injected);
      } else {
        res.writeHead(404); res.end('Built-in not found');
      }
      return;
    }

    const match = pathname.match(/^\/wallpaper\/([^/]+)\/(.+)$/);
    if (!match) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Nora Wallpaper Server'); return; }

    const [, wallpaperId, filePath] = match;
    const safePath = filePath.replace(/\.\./g, '').replace(/\\/g, '/');
    const fullPath = resolve(join(baseDir, wallpaperId, safePath));

    if (!fullPath.startsWith(resolve(join(baseDir, wallpaperId)))) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!existsSync(fullPath)) { logger.warn('Wallpaper 404: %s', safePath); res.writeHead(404); res.end('File not found'); return; }

    const ext = extname(fullPath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const stat = statSync(fullPath);
    const isHtml = ext === '.html' || ext === '.htm';

    const range = req.headers.range;
    if (range && !isHtml) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      if (start >= stat.size) { res.writeHead(416); res.end(); return; }
      res.writeHead(206, { 'Content-Type': mime, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Accept-Ranges': 'bytes' });
      createReadStream(fullPath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');

    if (isHtml) {
      const html = readFileSync(fullPath, 'utf-8');
      const injected = injectPolyfill(html, wallpaperId);
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', Buffer.byteLength(injected, 'utf-8'));
      res.end(injected);
    } else {
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Length', stat.size);
      createReadStream(fullPath).pipe(res);
    }
  });

  return new Promise((resolve, reject) => {
    server!.listen(PORT, HOST, () => { logger.info(`Wallpaper server started at http://${HOST}:${PORT}`); resolve(); });
    server!.on('error', (err) => { logger.error('Wallpaper server error', { err }); reject(err); });
  });
}

export function stopWallpaperServer(): void {
  if (server) { server.close(); server = null; logger.info('Wallpaper server stopped'); }
}

export async function registerWallpaper(sourceDir: string): Promise<string | null> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const crypto = await import('crypto');
    const id = crypto.createHash('md5').update(sourceDir).digest('hex').slice(0, 12);
    const destDir = join(wallpaperBaseDir(), id);
    if (existsSync(destDir)) { const files = await fs.readdir(destDir); if (files.length > 0) return id; }
    await fs.mkdir(destDir, { recursive: true });
    await copyDir(sourceDir, destDir);
    logger.info(`Wallpaper registered: ${id} < ${sourceDir}`);
    return id;
  } catch (err) { logger.error('Failed to register wallpaper', { sourceDir, err }); return null; }
}

async function copyDir(src: string, dest: string): Promise<void> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const sp = path.join(src, entry.name), dp = path.join(dest, entry.name);
    if (entry.isDirectory()) { await fs.mkdir(dp, { recursive: true }); await copyDir(sp, dp); }
    else await fs.copyFile(sp, dp);
  }
}
