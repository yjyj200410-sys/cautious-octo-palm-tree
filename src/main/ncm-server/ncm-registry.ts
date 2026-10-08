/**
 * NCM Song Registry — 主进程中的网易云歌曲数据缓存。
 * 当 renderer 请求播放网易云歌曲时，先注册到这里，
 * 然后 player 通过 getSong(songId) 获取时直接返回缓存数据。
 */

interface NcmSongEntry {
  songId: number;   // negative
  title: string;
  duration: number; // seconds
  artists?: { artistId: number; name: string; artworkPath?: string }[];
  album?: { albumId: number; name: string };
  path: string;     // audio URL
  artworkPath?: string;
  isAFavorite: boolean;
  isKnownSource: boolean;
  isBlacklisted: boolean;
}

import logger from '../logger';

const registry = new Map<number, NcmSongEntry>();

export function registerNcmSong(entry: NcmSongEntry): void {
  const sizeBefore = registry.size;
  registry.set(entry.songId, entry);
  const sizeAfter = registry.size;
  const isNew = sizeAfter > sizeBefore;
  const hasUrl = !!entry.path;
  logger.debug(
    `[QUEUE_META_TRACE] afterRegister ` +
    `songId=${entry.songId} ` +
    `registrySize=${sizeAfter} ` +
    `isNew=${isNew} ` +
    `hasUrl=${hasUrl} ` +
    `title="${entry.title}"`
  );
  if (hasUrl) logger.info(`[NCM REG] + ${entry.songId} "${entry.title}"`);
  else logger.debug(`[NCM REG] meta ${entry.songId} "${entry.title}"`);
}

export function getNcmSong(songId: number): NcmSongEntry | undefined {
  const entry = registry.get(songId);
  if (!entry) logger.warn(`[NCM REG] ? ${songId} → miss (registry size=${registry.size})`);
  return entry;
}

export function clearNcmRegistry(): void {
  registry.clear();
}
