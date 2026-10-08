import { proxyCoverUrl } from '@renderer/ncm';

/** 歌曲封面:本地用 artworkPath,NCM 用 coverUrl(走代理) */
export const getSongCover = (song: SongData): string | undefined => {
  if (song.songId < 0) {
    const coverUrl = (song as SongData & { coverUrl?: string }).coverUrl;
    return coverUrl ? proxyCoverUrl(coverUrl) : undefined;
  }
  return song.artworkPaths?.optimizedArtworkPath || song.artworkPaths?.artworkPath;
};

/** 歌曲时长:NCM duration 是毫秒,本地是秒 → 统一 mm:ss */
export const formatSongDuration = (song: SongData): string => {
  const ms = song.songId < 0;
  const secs = Math.round(song.duration / (ms ? 1000 : 1));
  if (!Number.isFinite(secs) || secs < 0) return '';
  return `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`;
};
