export { NcmRepository, NcmRepositoryError } from './repository';
export {
  adaptSong,
  adaptSongs,
  adaptPlaylist,
  adaptPlaylistList,
  adaptAlbum,
  adaptArtist,
  adaptArtistSongs,
  adaptSearchResult,
  adaptLyric,
} from './adapters';
export type {
  NcmSong,
  NcmPlaylist,
  NcmAlbum,
  NcmArtist,
  NcmSearchResult,
  NcmLyric,
} from './types';

/** 将网易云 CDN 图片 URL 转为本地代理 URL（解决 Electron file:// 无法加载 https 图片的问题） */
export function proxyCoverUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  return `http://127.0.0.1:25884/cover?url=${encodeURIComponent(rawUrl)}`;
}

export { PlaybackBridge } from './playback/PlaybackBridge';
export { NeteaseSyncService, NeteaseSyncError } from './NeteaseSyncService';
