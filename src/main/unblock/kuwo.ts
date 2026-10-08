import { encryptQuery } from './kwDES';
import { isSongMatch, hasVersionMarker } from './match';
import type { SongMatchInfo, SongUrlResult, ThirdPartySongCandidate } from './types';
import logger from '../logger';

const KUWO_SEARCH_URL = 'http://search.kuwo.cn/r.s?&correct=1&stype=comprehensive&encoding=utf8&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=';

/** 解析酷我搜索 JSON → abslist 候选（SONGNAME/ARTIST/DURATION/MUSICRID），空则 [] */
export function parseKuwoAbslist(
  raw: unknown,
): Array<{ rid: string; title: string; artist: string; durationSec?: number; cover?: string }> {
  const data = raw as {
    content?: Array<{ musicpage?: { abslist?: Array<Record<string, unknown>> } }>;
  };
  const abslist = data?.content?.[1]?.musicpage?.abslist;
  if (!abslist?.length) return [];
  const out: Array<{ rid: string; title: string; artist: string; durationSec?: number; cover?: string }> = [];
  for (const item of abslist) {
    const rid = item?.MUSICRID as string | undefined;
    const title = (item?.SONGNAME as string | undefined) || '';
    if (!rid || !title) continue;
    const duration = Number(item?.DURATION);
    const cover =
      (item?.web_albumpic_short as string | undefined) ||
      (item?.al_pic as string | undefined) ||
      (item?.PIC as string | undefined);
    out.push({
      rid: rid.startsWith('MUSIC_') ? rid.slice('MUSIC_'.length) : rid,
      title,
      artist: (item?.ARTIST as string | undefined) || '',
      ...(Number.isFinite(duration) && duration > 0 ? { durationSec: duration } : {}),
      ...(cover ? { cover } : {}),
    });
  }
  return out;
}

async function searchKuwoRaw(keyword: string): Promise<Array<{ rid: string; title: string; artist: string; durationSec?: number; cover?: string }> | null> {
  try {
    const url = KUWO_SEARCH_URL + encodeURIComponent(keyword);
    const res = await fetch(url);
    const data = await res.json() as any as any;
    return parseKuwoAbslist(data);
  } catch (err) {
    logger.error('Kuwo search error:', {}, err);
    return null;
  }
}

async function getKuwoSongId(match: SongMatchInfo): Promise<string | null> {
  const rows = await searchKuwoRaw(match.keyword);
  if (!rows?.length) {
    logger.warn(`Kuwo: no match for "${match.songName}"`);
    return null;
  }
  for (const row of rows) {
    // ★ 传入候选时长（秒）供 match 校验：时长显著偏离原曲的加速版/DJ加长版会被拒绝
    if (isSongMatch(row.title, row.artist, match, row.durationSec)) return row.rid;
  }
  logger.warn(`Kuwo: no match for "${match.songName}"`);
  return null;
}

/** 第三方搜索兜底：返回酷我候选（过滤版本标记行），最多 limit 条 */
export async function searchKuwoSongs(keyword: string, limit = 8): Promise<ThirdPartySongCandidate[]> {
  const rows = await searchKuwoRaw(keyword);
  if (!rows) return [];
  const out: ThirdPartySongCandidate[] = [];
  for (const row of rows) {
    if (hasVersionMarker(row.title)) continue;
    out.push({
      provider: 'kuwo',
      id: row.rid,
      title: row.title,
      artist: row.artist,
      ...(row.durationSec ? { durationSec: row.durationSec } : {}),
      ...(row.cover ? { cover: row.cover } : {}),
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function getKuwoSongUrl(match: SongMatchInfo): Promise<SongUrlResult> {
  try {
    if (!match.keyword) return { code: 404, url: null };
    const songId = await getKuwoSongId(match);
    if (!songId) return { code: 404, url: null };
    const PackageName = 'kwplayer_ar_5.1.0.0_B_jiakong_vh.apk';
    const q = encryptQuery(`corp=kuwo&source=${PackageName}&p2p=1&type=convert_url2&sig=0&format=mp3&rid=${songId}`);
    const res = await fetch(`http://mobi.kuwo.cn/mobi.s?f=kuwo&q=${encodeURIComponent(q)}`, {
      headers: { 'User-Agent': 'okhttp/3.10.0' },
    });
    const text = await res.text();
    const matchUrl = text.match(/http[^\s$"]+/)?.[0];
    if (matchUrl) {
      logger.info(`Kuwo URL: ${matchUrl.slice(0, 80)}...`);
      return { code: 200, url: matchUrl };
    }
    return { code: 404, url: null };
  } catch (err) {
    logger.error('Kuwo URL error:', {}, err);
    return { code: 404, url: null };
  }
}
