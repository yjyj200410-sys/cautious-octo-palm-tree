import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { dialog, net } from 'electron';

import {
  DEFAULT_NCM_SONG_QUALITY,
  isNcmSongQuality,
  type NcmSongQuality
} from '../../common/ncmQuality';
import { callNcmApi } from '../ncm-server/ncm-server';

let downloading = false;

/** Download only the URLs returned by the account's download endpoint. Never overwrite files. */
export async function downloadNcmSongs(
  songs: { id: number; title: string }[],
  cookie: string,
  quality: NcmSongQuality = DEFAULT_NCM_SONG_QUALITY
) {
  if (downloading) throw new Error('已有下载任务正在进行');
  if (
    !Array.isArray(songs) ||
    !songs.length ||
    songs.length > 2000 ||
    songs.some(
      (song) => !Number.isSafeInteger(song.id) || song.id <= 0 || typeof song.title !== 'string'
    )
  ) {
    throw new Error('下载歌曲参数无效');
  }
  if (!isNcmSongQuality(quality)) throw new Error('下载音质参数无效');
  downloading = true;
  try {
    const folder = await dialog.showOpenDialog({
      title: '选择歌曲下载文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    const failures: string[] = [];
    if (folder.canceled || !folder.filePaths[0]) return { canceled: true, saved: 0, failures };
    let saved = 0;
    for (const song of songs) {
      let filePath: string | undefined;
      let created = false;
      try {
        const result = (await callNcmApi(
          'song/download/url/v1',
          { id: String(song.id), level: quality },
          cookie
        )) as {
          code?: number;
          data?: { url?: string; type?: string; freeTrialInfo?: unknown };
        };
        if (result.code !== 200 || !result.data?.url || result.data.freeTrialInfo)
          throw new Error('当前账号无法下载此歌曲');
        const url = new URL(result.data.url);
        if (!['https:', 'http:'].includes(url.protocol)) throw new Error('下载地址无效');
        const response = await net.fetch(url.href, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok || !response.body) throw new Error('下载失败');
        const name =
          song.title
            .replace(/[<>:"/\\|?*\p{Cc}]/gu, '_')
            .replace(/[. ]+$/g, '')
            .slice(0, 100) || '歌曲';
        const extension = /^(mp3|flac|m4a|aac|wav|ogg)$/i.test(result.data.type ?? '')
          ? result.data.type!.toLowerCase()
          : 'mp3';
        filePath = join(folder.filePaths[0], `${name}-${song.id}.${extension}`);
        const target = createWriteStream(filePath, { flags: 'wx' });
        target.once('open', () => {
          created = true;
        });
        await pipeline(Readable.fromWeb(response.body as never), target);
        saved++;
      } catch (error) {
        if (created && filePath) await rm(filePath, { force: true }).catch(() => {});
        failures.push(
          `${song.title}：${(error as NodeJS.ErrnoException).code === 'EEXIST' ? '文件已存在，已跳过' : error instanceof Error ? error.message : '下载失败'}`
        );
      }
    }
    return { canceled: false, saved, failures };
  } finally {
    downloading = false;
  }
}
