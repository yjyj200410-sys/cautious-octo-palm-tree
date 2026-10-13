import { existsSync, writeFileSync } from 'fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { URL } from 'url';

import { net } from 'electron';

import logger from '../logger';
import { handleUnblockRoute } from '../unblock/routes';

// 预创建 anonymous_token 占位文件，防止 @neteasecloudmusicapienhanced/api
// 在首次启动（generateConfig 尚未运行时）因 readFileSync 缺失而崩溃
const tmpPath = tmpdir();
const anonymousTokenPath = resolve(tmpPath, 'anonymous_token');
if (!existsSync(anonymousTokenPath)) {
  writeFileSync(anonymousTokenPath, '');
}

type ApiFunction = (query: Record<string, unknown>) => Promise<unknown>;
let NeteaseCloudMusicApi: Record<string, unknown> = {};
let generateConfig: (() => Promise<void>) | undefined;
let modulePromise: Promise<void> | null = null;
const NON_API_EXPORTS = new Set<string>();
async function loadApi() {
  if (!modulePromise)
    modulePromise = Promise.all([
      import('@neteasecloudmusicapienhanced/api'),
      // @ts-expect-error - the API package has no server module declaration
      import('@neteasecloudmusicapienhanced/api/server.js')
    ])
      .then(([api, server]) => {
        NeteaseCloudMusicApi = api.default as unknown as Record<string, unknown>;
        generateConfig = server.generateConfig;
        Object.keys(server).forEach((key) => NON_API_EXPORTS.add(key));
      })
      .catch((error) => {
        modulePromise = null;
        throw error;
      });
  await modulePromise;
}
const port = Number(process.env.NCM_SERVER_PORT || 25884);

// ★ NCM API 硬超时：@neteasecloudmusicapienhanced/api 的 option.js 默认
//   `timeout: query.timeout || 0`（0 = 无超时）。对端连接停滞时 axios 会永久挂起，
//   导致 song/url/v1 等请求永不返回 → getSongUrlRaw → resolve → PrefetchManager →
//   loadSong 整条链挂死，点击后既不播放也无报错。
//   两层保险：
//   1. 透传 timeout 给 createOption → axios timeout（对走 request() 的请求生效）。
//   2. withApiTimeout 硬超时兜住整个 apiFn —— 某些模块（如 song_url_v1 的 unblock=true
//      → matchID）在官方 request() 之前就有自己的网络调用（裸 fetch 无超时），
//      axios timeout 根本不会触发，必须在外层直接拒绝。
const NCM_API_TIMEOUT_MS = 10_000;

/** 给 API 调用加硬超时：超时抛错（底层请求继续在后台运行，其结果被丢弃，无害）。 */
function withApiTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`NCM API timeout after ${ms}ms`)), ms);
    promise
      .then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      )
      .catch(reject);
  });
}

// ---- 初始化配置 (匿名token + xeapi公钥) ----
let configPromise: Promise<void> | null = null;

async function ensureNcmConfig() {
  await loadApi();
  if (!generateConfig) return;
  if (!configPromise) {
    configPromise = generateConfig()
      .then(() => {
        logger.info('NCM config initialized');
      })
      .catch((err: unknown) => {
        configPromise = null;
        logger.error('NCM config init failed:', { err });
      });
  }
  await configPromise;
}

// ---- 路由匹配 ----
function pathCase(str: string): string {
  return str.replace(/_/g, '/');
}

async function findRouter(requestPath: string): Promise<[string, ApiFunction] | null> {
  await loadApi();
  for (const key of Object.keys(NeteaseCloudMusicApi)) {
    if (NON_API_EXPORTS.has(key)) continue;
    const fn = (NeteaseCloudMusicApi as Record<string, unknown>)[key];
    if (typeof fn !== 'function') continue;
    if (pathCase(key) === requestPath || key === requestPath) {
      return [key, fn as ApiFunction];
    }
  }
  return null;
}

// ---- 解析 Cookie ----
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > 0) {
      const name = pair.substring(0, idx).trim();
      const value = pair.substring(idx + 1).trim();
      cookies[name] = value;
    }
  });
  return cookies;
}

// ---- 发送 JSON 响应 ----
function sendJSON(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Cookie',
    'Cross-Origin-Resource-Policy': 'cross-origin'
  });
  res.end(JSON.stringify(data));
}

// ---- 请求处理 ----
async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
  const pathname = url.pathname.replace(/\/$/, '') || '/';

  // ---- /cover (图片代理，绕过 file:// 限制) ----
  if (pathname === '/cover') {
    const target = url.searchParams.get('url');
    if (!target) {
      res.writeHead(400);
      res.end('missing url');
      return;
    }
    try {
      // cover fetch
      const imageRes = await net.fetch(target);
      if (!imageRes.ok) {
        logger.warn(`Cover fetch failed: ${imageRes.status} for ${target}`);
        res.writeHead(imageRes.status);
        res.end();
        return;
      }
      const buffer = Buffer.from(await imageRes.arrayBuffer());
      const ct = imageRes.headers.get('content-type') || 'image/jpeg';
      // cover ok
      res.writeHead(200, {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin'
      });
      res.end(buffer);
    } catch (err) {
      logger.warn(`Cover error: ${err instanceof Error ? err.message : String(err)}`);
      res.writeHead(502);
      res.end();
    }
    return;
  }

  // ---- /health ----
  if (pathname === '/health') {
    return sendJSON(res, 200, {
      status: 'ok',
      service: 'volo-ncm-server',
      version: '1.0.0',
      neteaseApiLoaded: Object.keys(NeteaseCloudMusicApi).length > 0,
      timestamp: Date.now()
    });
  }

  // ---- /api/unblock/* ----
  if (pathname.startsWith('/api/unblock/')) {
    const handled = await handleUnblockRoute(pathname, url.searchParams, req, res);
    if (handled) return;
  }

  // ---- /netease (索引页) ----
  if (pathname === '/netease') {
    return sendJSON(res, 200, {
      name: 'Volo NCM Proxy',
      description: '网易云音乐 API 代理',
      url: '/netease/*',
      health: '/health'
    });
  }

  // ---- /netease/* (动态路由) ----
  const neteaseMatch = pathname.match(/^\/netease\/(.+)/);
  if (neteaseMatch) {
    const requestPath = neteaseMatch[1];
    const match = await findRouter(requestPath);

    if (!match) {
      return sendJSON(res, 404, { error: `API not found: ${requestPath}` });
    }

    const [, apiFn] = match;
    const cookies = parseCookies(req.headers.cookie);
    const query: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    try {
      await ensureNcmConfig();
      const result = (await withApiTimeout(
        apiFn({
          ...query,
          cookie: cookies,
          timeout: NCM_API_TIMEOUT_MS
        }),
        NCM_API_TIMEOUT_MS
      )) as Record<string, unknown>;
      return sendJSON(res, (result.status as number) ?? 200, result.body ?? result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`NCM ✗ ${requestPath}: ${msg}`);
      const errorObj = err as { status?: number; body?: unknown; message?: string };
      return sendJSON(res, errorObj.status || 500, {
        error: errorObj.body || errorObj.message || 'Internal Server Error'
      });
    }
  }

  // ---- 404 ----
  sendJSON(res, 404, { error: 'Not Found' });
}

// ---- IPC: 直接调用 API（绕过 HTTP，避免 CORS/CORP） ----

export async function callNcmApi(
  requestPath: string,
  query: Record<string, string> = {},
  cookieString = ''
): Promise<unknown> {
  const match = await findRouter(requestPath);
  if (!match) {
    throw new Error(`API not found: ${requestPath}`);
  }
  const [, apiFn] = match;
  const cookies = parseCookies(cookieString || undefined);

  // ncm ipc request

  await ensureNcmConfig();
  try {
    // ★ withApiTimeout：兜住模块内非 axios 的挂起（如 matchID），保证 IPC 请求有界
    const result = await withApiTimeout(
      apiFn({ ...query, cookie: cookies, timeout: NCM_API_TIMEOUT_MS }),
      NCM_API_TIMEOUT_MS
    );
    // ipc ok
    return (result as Record<string, unknown>).body ?? result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 50002 = 未登录/会话失效,是预期状态 — 降为 debug,避免每次请求都刷 error 栈
    const isExpectable = typeof msg === 'string' && msg.includes('50002');
    if (isExpectable) logger.debug(`NCM IPC ✗ ${requestPath}: ${msg}`);
    else logger.error(`NCM IPC ✗ ${requestPath}: ${msg}`);
    throw err;
  }
}

// ---- 启动服务器 ----
export async function startNcmServer() {
  // 启动时初始化配置（不阻塞服务器启动）
  // API modules and anonymous configuration load only on the first online request.

  const server = createServer(handleRequest);

  return new Promise<void>((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      logger.info(`NCM server listening on http://127.0.0.1:${port}`);
      resolve();
    });
    server.on('error', (err) => {
      logger.error('NCM server listen error:', { err });
      reject(err);
    });
  });
}
