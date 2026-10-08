import { isSongMatch } from './match';
import type { SongMatchInfo, SongUrlResult } from './types';
import logger from '../logger';
import { createHash } from 'crypto';

const deviceId = String(Math.floor(Math.random() * 100000000000));

async function search(match: SongMatchInfo): Promise<string | null> {
  try {
    const keyword = encodeURIComponent(match.keyword.replace(' - ', ' '));
    const url = `http://search.kuwo.cn/r.s?&correct=1&vipver=1&stype=comprehensive&encoding=utf8&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=${keyword}`;
    const res = await fetch(url);
    const data = await res.json() as any as any;
    const content = data.content as Array<Record<string, unknown>> | undefined;
    if (!content || content.length < 2) return null;
    const musicpage = content[1]?.musicpage as any | undefined;
    const abslist = musicpage?.abslist as Array<Record<string, unknown>> | undefined;
    if (!abslist?.length) return null;
    for (const item of abslist) {
      const id = (item?.MUSICRID as string)?.split('_').pop();
      if (!id) continue;
      const artistStr = (item?.ARTIST as string || '').split('&').map((a: string) => a.trim()).join('&');
      // ★ 传入候选时长（秒）供 match 校验：时长显著偏离原曲的加速版/DJ加长版会被拒绝
      if (isSongMatch((item?.SONGNAME as string) || '', artistStr, match, Number(item?.DURATION))) return id;
    }
    logger.warn(`Bodian: no match for "${match.songName}"`);
    return null;
  } catch (err) {
    logger.error('Bodian search error:', {}, err);
    return null;
  }
}

function generateSign(str: string): string {
  const url = new URL(str);
  str += `&timestamp=${Date.now()}`;
  const filtered = str.substring(str.indexOf('?') + 1).replace(/[^a-zA-Z0-9]/g, '').split('').sort().join('');
  const sign = createHash('md5').update(`kuwotest${filtered}${url.pathname}`).digest('hex');
  return `${str}&sign=${sign}`;
}

export async function getBodianSongUrl(match: SongMatchInfo): Promise<SongUrlResult> {
  try {
    if (!match.keyword) return { code: 404, url: null };
    const songId = await search(match);
    if (!songId) return { code: 404, url: null };
    const headers: Record<string, string> = {
      'User-Agent': 'Dart/2.19 (dart:io)',
      plat: 'ar', channel: 'aliopen', devid: deviceId, ver: '3.9.0',
      host: 'bd-api.kuwo.cn', 'X-Forwarded-For': '1.0.1.114',
    };
    // ad-free request
    try {
      await fetch('http://bd-api.kuwo.cn/api/service/advert/watch?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ type: 5, subType: 5, musicId: 0, adToken: '' }),
      });
    } catch { /* non-critical */ }
    let audioUrl = `http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?br=320kmp3&musicId=${songId}`;
    audioUrl = generateSign(audioUrl);
    const res = await fetch(audioUrl, { headers });
    const data = await res.json() as any as any;
    const url = (data?.data as any)?.audioUrl as string | undefined;
    if (url) {
      logger.info(`Bodian URL: ${url.slice(0, 80)}...`);
      return { code: 200, url };
    }
    return { code: 404, url: null };
  } catch (err) {
    logger.error('Bodian URL error:', {}, err);
    return { code: 404, url: null };
  }
}
