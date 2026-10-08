import type { IncomingMessage, ServerResponse } from 'http';
import { getKuwoSongUrl } from './kuwo';
import { getBodianSongUrl } from './bodian';
import { getGequbaoSongUrl } from './gequbao';
import { getGdStudioSongUrl } from './gdstudio';
import { searchThirdParty } from './search';
import type { SongMatchInfo } from './types';
import logger from '../logger';

function buildMatchInfo(query: URLSearchParams): SongMatchInfo {
  let songName = query.get('songName') || '';
  let artist = query.get('artist') || '';
  const keyword = query.get('keyword') || '';
  if (!songName && keyword) {
    const lastIdx = keyword.lastIndexOf('-');
    if (lastIdx > 0) {
      songName = keyword.slice(0, lastIdx).trim();
      artist = artist || keyword.slice(lastIdx + 1).trim();
    } else {
      songName = keyword.trim();
    }
  }
  // ★ 原曲时长（ms）：renderer 传入用于拒绝加速版/DJ加长版等非原版候选
  const rawDur = query.get('durationMs');
  const durationMs = rawDur ? Number(rawDur) : NaN;
  return {
    keyword,
    songName,
    artist,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined,
  };
}

function sendJson(res: ServerResponse, data: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ★ 解锁提供方请求硬超时：各 provider 用裸 fetch 且无 AbortController，
//   上游（kuwo/gequbao 等）连接停滞时 route 会永久挂起 → renderer 的 4 路 race
//   会一直等，拖住播放。统一加限，超时按失败返回。
const UNBLOCK_TIMEOUT_MS = 6_000;
// ★ gequbao 是唯一 3 跳流程（搜索页 → 歌曲页 → POST 取地址）的 provider，且上游连接
//   间歇性 SSL 握手停滞（本机实测偶发 WinError 10060/握手超时）。6s 预算任一跳卡一下即
//   整体超时，而周杰伦等网易云无版权歌只有 gequbao 一条路 → 单独给更长预算。
//   renderer 侧 race 无总超时（任一成功即 abort 其余），15s 不影响其他 provider 竞速。
const GEQUBAO_TIMEOUT_MS = 15_000;

function withRouteTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      () => { clearTimeout(t); resolve(null); },
    );
  });
}

export async function handleUnblockRoute(
  pathname: string,
  searchParams: URLSearchParams,
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!pathname.startsWith('/api/unblock/')) return false;

  const provider = pathname.slice('/api/unblock/'.length);
  logger.info(`Unblock request: ${provider}`);

  try {
    // ★ 第三方搜索兜底：网易云空结果 / 全不可播时返回歌曲宝+酷我候选列表
    if (provider === 'search') {
      const keyword = searchParams.get('keyword') || '';
      const items =
        (await withRouteTimeout(searchThirdParty(keyword), GEQUBAO_TIMEOUT_MS)) ?? [];
      sendJson(res, { code: 200, items });
      return true;
    }

    if (provider === 'gd' || provider === 'netease') {
      const id = searchParams.get('id') || '';
      const result =
        (await withRouteTimeout(getGdStudioSongUrl(id), UNBLOCK_TIMEOUT_MS)) ??
        { code: 408, url: null };
      sendJson(res, result);
      return true;
    }

    const match = buildMatchInfo(searchParams);
    let result: { code: number; url: string | null } | null;

    switch (provider) {
      case 'kuwo': result = await withRouteTimeout(getKuwoSongUrl(match), UNBLOCK_TIMEOUT_MS); break;
      case 'bodian': result = await withRouteTimeout(getBodianSongUrl(match), UNBLOCK_TIMEOUT_MS); break;
      case 'gequbao': result = await withRouteTimeout(getGequbaoSongUrl(match), GEQUBAO_TIMEOUT_MS); break;
      default: sendJson(res, { code: 404, url: null }); return true;
    }

    sendJson(res, result ?? { code: 408, url: null });
  } catch (err) {
    logger.error('Unblock route error:', {}, err);
    sendJson(res, { code: 500, url: null });
  }
  return true;
}
