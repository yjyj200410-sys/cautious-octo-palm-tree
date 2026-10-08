import type { SongUrlResult } from './types';
import logger from '../logger';

/** GD音乐台 - 第三方网易云音源 (music.gdstudio.xyz) */
export async function getGdStudioSongUrl(id: number | string): Promise<SongUrlResult> {
  try {
    if (!id) return { code: 404, url: null };
    const url = `https://music-api.gdstudio.xyz/api.php?types=url&id=${id}`;
    const res = await fetch(url);
    const data = await res.json() as any as any;
    const songUrl = data.url as string | undefined;
    if (songUrl) {
      logger.info(`GDStudio URL: ${songUrl.slice(0, 80)}...`);
      return { code: 200, url: songUrl };
    }
    return { code: 404, url: null };
  } catch (err) {
    logger.error('GDStudio error:', {}, err);
    return { code: 404, url: null };
  }
}
