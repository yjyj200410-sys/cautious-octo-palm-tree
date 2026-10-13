import { randomBytes } from 'crypto';

import logger from '../logger';
import { isSongMatch, hasVersionMarker } from './match';
import type { SongMatchInfo, SongUrlResult, ThirdPartySongCandidate } from './types';

// 搜索页每行结果: <a href="/music/{id}" class="hover-zoom…"> … <span class="text-primary…">歌名</span>
//   <small class="text-jade…">歌手</small>
const GQB_ROW_REGEX = /<a href="\/music\/(\d+)" class="hover-zoom[^>]*>([\s\S]*?)<\/a>/g;
const GQB_SONG_REGEX = /class="text-primary[^>]*>\s*([\s\S]*?)\s*<\/span>/;
const GQB_ARTIST_REGEX = /class="text-jade[^>]*>\s*([\s\S]*?)\s*<\/small>/;

/** 解析 gequbao 搜索页 → (id, title, artist) 列表（原始顺序，未过滤） */
export function parseGequbaoSongRows(
  html: string
): Array<{ id: string; title: string; artist: string }> {
  const rows: Array<{ id: string; title: string; artist: string }> = [];
  for (const m of html.matchAll(GQB_ROW_REGEX)) {
    const inner = m[2];
    const title = GQB_SONG_REGEX.exec(inner)?.[1]?.trim() || '';
    const artist = (GQB_ARTIST_REGEX.exec(inner)?.[1]?.trim() || '').replace(/&amp;/g, '&');
    if (title) rows.push({ id: m[1], title, artist });
  }
  return rows;
}

async function searchId(match: SongMatchInfo): Promise<string | null> {
  try {
    const url = `https://www.gequbao.com/s/${encodeURIComponent(match.keyword)}`;
    const res = await fetchWithRetry(url);
    const data = await res.text();
    // 歌手必须参与校验：同站有大量同歌名不同歌手的翻唱/伴奏，只查歌名会放回非原版。
    for (const { id, title, artist } of parseGequbaoSongRows(data)) {
      if (isSongMatch(title, artist, match)) return id;
    }
    logger.warn(`Gequbao: no match for "${match.songName}"`);
    return null;
  } catch (err) {
    logger.error('Gequbao search error:', {}, err);
    return null;
  }
}

/** 第三方搜索兜底：返回 gequbao 候选（过滤版本标记行），最多 GQB_SEARCH_LIMIT 条 */
export async function searchGequbaoSongs(
  keyword: string,
  limit = 8
): Promise<ThirdPartySongCandidate[]> {
  try {
    const url = `https://www.gequbao.com/s/${encodeURIComponent(keyword)}`;
    const res = await fetchWithRetry(url);
    const data = await res.text();
    const out: ThirdPartySongCandidate[] = [];
    for (const { id, title, artist } of parseGequbaoSongRows(data)) {
      if (hasVersionMarker(title)) continue;
      out.push({ provider: 'gequbao', id, title, artist });
      if (out.length >= limit) break;
    }
    return out;
  } catch (err) {
    logger.error('Gequbao search list error:', {}, err);
    return [];
  }
}

/** 还原 JS 字符串字面量里的转义（页面把 play_id 藏在 JSON.parse('{"...}') 里） */
function unescapeJsString(s: string): string {
  return s
    .replace(/\\u0022/g, '"')
    .replace(/\\u0027/g, "'")
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\');
}

/**
 * 从歌曲页 HTML 提取 play_id。 新版（改版后）: window.appData = JSON.parse('{"play_id":"...",...}') 旧版:
 * "play_id":"..."
 */
export function extractPlayId(html: string): string | null {
  const appData = html.match(/window\.appData\s*=\s*JSON\.parse\('([\s\S]*?)'\)/);
  if (appData) {
    try {
      const parsed = JSON.parse(unescapeJsString(appData[1]));
      const pid = parsed?.play_id;
      if (typeof pid === 'string' && pid) return pid;
    } catch {
      /* 解析失败则回退旧格式 */
    }
  }
  return html.match(/"play_id":"(.*?)"/)?.[1] ?? null;
}

/**
 * Gequbao.com 间歇性 SSL 握手超时（本机实测 WinError 10060 偶发）。 周杰伦等网易云无版权歌只有 gequbao 一条路，单次 fetch 失败即 `null`
 * 会导致整首放不出。 这里对最脆弱的网络步骤做 2 次重试；每跳 8s 单次上限，让停滞的手握快速失败并触发重试 （undici 默认不设连接超时，会按 OS 级 ~20s+ 干等，把 route
 * 的 15s 预算全烧光）。
 */
const HOP_TIMEOUT_MS = 8_000;
async function fetchWithRetry(url: string, init?: RequestInit, retries = 2): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(HOP_TIMEOUT_MS) });
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastErr;
}

async function getPlayId(id: string): Promise<string | null> {
  try {
    const res = await fetchWithRetry(`https://www.gequbao.com/music/${id}`);
    const data = await res.text();
    return extractPlayId(data);
  } catch (err) {
    logger.error('Gequbao playId error:', {}, err);
    return null;
  }
}

export async function getGequbaoSongUrl(match: SongMatchInfo): Promise<SongUrlResult> {
  try {
    if (!match.keyword) return { code: 404, url: null };
    const id = await searchId(match);
    if (!id) return { code: 404, url: null };
    const playId = await getPlayId(id);
    if (!playId) return { code: 404, url: null };
    // 2026-08-15: 站点把取音频接口从 /api/play-url 换成 /member/common-play-url，
    //   play_id 也改成 Laravel 加密串（appData 里那串 eyJpdiI6…），直接原样回传。
    const res = await fetchWithRetry('https://www.gequbao.com/member/common-play-url', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: `https://www.gequbao.com/music/${id}`,
        Cookie: `server_name_session=${randomBytes(16).toString('hex')}`
      },
      body: `id=${encodeURIComponent(playId)}`
    });
    const data = (await res.json()) as any as any;
    const url = (data?.data as any)?.url as string | undefined;
    if (data?.code === 1 && url) {
      logger.info(`Gequbao URL: ${url.slice(0, 80)}...`);
      return { code: 200, url };
    }
    return { code: 404, url: null };
  } catch (err) {
    logger.error('Gequbao URL error:', {}, err);
    return { code: 404, url: null };
  }
}
