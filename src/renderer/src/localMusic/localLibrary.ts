import type { NcmSong } from '@renderer/ncm/types';

/**
 * 本地音乐 —— 复用 MusicFolders 扫描能力(本地库 DB),把本地歌曲适配为 NcmSong 兼容形态,
 * 供 LibraryContent / PlaylistRail 统一渲染与播放。songId 为正(与 NCM 负 id 区分)。
 */

/** 本地 AudioInfo → NcmSong(正 songId;artworkPaths 保留本地路径,不代理)。 */
function audioInfoToNcmSong(audio: AudioInfo): NcmSong {
  return {
    songId: audio.songId,
    title: audio.title,
    duration: audio.duration * 1000, // AudioInfo.duration 为秒 → NcmSong 毫秒
    artists: audio.artists ?? [],
    album: audio.album ?? { name: '', albumId: 0 },
    path: audio.path,
    artworkPaths: audio.artworkPaths,
    isBlacklisted: audio.isBlacklisted,
    coverUrl: audio.artworkPaths?.optimizedArtworkPath ?? '',
    url: null,
    ncmId: audio.songId,
    addedAt: audio.addedDate,
  };
}

/** 全部本地歌曲(NcmSong 形态) */
export async function getAllLocalSongs(): Promise<NcmSong[]> {
  const res = await window.api.audioLibraryControls.getAllSongs();
  return res.data.map(audioInfoToNcmSong);
}

/** 本地歌曲总数(getAllSongIds 轻量取 total,不给大量歌曲数据) */
export async function getLocalSongCount(): Promise<number> {
  const res = await window.api.audioLibraryControls.getAllSongIds();
  return res.total ?? res.data.length;
}
