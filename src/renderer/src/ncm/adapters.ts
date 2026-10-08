/**
 * NCM Adapter — 将网易云原始 JSON 转为 Ncm* 统一模型。
 *
 * 所有函数签名：接收 NetEase API 原始返回，输出 Ncm* 类型。
 */

import type {
  NcmSong,
  NcmPlaylist,
  NcmAlbum,
  NcmArtist,
  NcmSearchResult,
  NcmLyric,
} from './types';

// ---- 工具函数 ----

const nid = (id: number) => -id;
export const coverToArtwork = (url: string) => ({
  isDefaultArtwork: !url,
  artworkPath: url || '',
  optimizedArtworkPath: url || '',
});

// ---- Song ----

function extractCoverUrl(raw: Record<string, unknown>, al: Record<string, unknown>): string {
  // 按优先级尝试各种封面 URL 字段
  const picUrl = (al.picUrl as string) || (al.picUrl_str as string) || '';
  if (picUrl && picUrl.startsWith('http')) return picUrl;

  // picId → 拼接 URL
  const picId = (al.pic as number) || (al.picId as number) || (al.pic_id as number);
  if (picId) return `https://p2.music.126.net/${picId}.jpg`;

  // 歌曲顶层字段
  const topPic = (raw.picUrl as string) || (raw.coverUrl as string) || (raw.cover as string) || '';
  if (topPic && topPic.startsWith('http')) return topPic;

  return picUrl; // 返回可能非 http 的值或空串
}

export function adaptSong(raw: Record<string, unknown>, songUrl?: string | null): NcmSong {
  const id = (raw.id as number) || 0;
  const ar = (raw.ar || raw.artists || raw.artist || []) as { id: number; name: string }[];
  const al = (raw.al || raw.album || {}) as Record<string, unknown>;
  const picUrl = extractCoverUrl(raw, al);

  return {
    songId: nid(id),
    isVip: [1, 8].includes(Number(raw.fee ?? (raw.privilege as { fee?: number } | undefined)?.fee)),
    title: (raw.name as string) || (raw.title as string) || '',
    duration: (raw.dt as number) || (raw.duration as number) || 0,
    artists: ar.map((a) => ({ name: a.name, artistId: nid(a.id) })),
    album: { name: (al.name as string) || '', albumId: nid((al.id as number) || 0) },
    path: '',
    artworkPaths: coverToArtwork(picUrl),
    isBlacklisted: false,
    coverUrl: picUrl,
    url: songUrl ?? null,
    ncmId: id,
    // 阶段 4.2:歌单「添加时间」排序——保留歌单详情接口每曲的 at 字段(毫秒时间戳)。
    // 非歌单详情来源(搜索/歌曲详情/专辑)无 at,保持 undefined,排序时按缺失处理。
    addedAt: (raw.at as number) || undefined,
  };
}

export function adaptSongs(rawSongs: Record<string, unknown>[], songUrls?: (string | null)[]): NcmSong[] {
  return rawSongs.map((s, i) => adaptSong(s, songUrls?.[i] ?? null));
}

// ---- Playlist ----

export function adaptPlaylist(raw: Record<string, unknown>): NcmPlaylist {
  const playlist = raw.playlist as Record<string, unknown> | undefined;
  if (!playlist) throw new Error('Missing playlist in response');
  const tracks: NcmSong[] = adaptSongs((playlist.tracks || []) as Record<string, unknown>[]);
  return {
    playlistId: nid(playlist.id as number),
    name: (playlist.name as string) || '',
    songs: tracks.map((t) => ({ title: t.title, songId: t.songId })),
    createdDate: new Date((playlist.createTime || playlist.create_time || 0) as number),
    isArtworkAvailable: true,
    artworkPaths: coverToArtwork((playlist.coverImgUrl as string) || ''),
    coverUrl: (playlist.coverImgUrl as string) || '',
    tracks,
    playCount: (playlist.playCount as number) || 0,
    creatorName: ((playlist.creator as Record<string, unknown>)?.nickname as string) || '',
    creatorId: Number((playlist.creator as Record<string, unknown>)?.userId) || 0,
    trackCount: (playlist.trackCount as number) || tracks.length,
    description: (playlist.description as string) || '',
    copywriter: (playlist.copywriter as string) || '',
  };
}

// ---- Playlist List (user/playlist 返回的 playlist[] 数组) ----

export function adaptPlaylistList(raw: Record<string, unknown>): NcmPlaylist[] {
  const list = (raw.playlist || raw.list || raw.result || []) as Record<string, unknown>[];
  return list.map((pl) => ({
    playlistId: nid(pl.id as number),
    name: (pl.name as string) || '',
    songs: [],
    createdDate: new Date((pl.createTime || pl.create_time || 0) as number),
    isArtworkAvailable: true,
    artworkPaths: coverToArtwork((pl.coverImgUrl as string) || (pl.picUrl as string) || ''),
    coverUrl: (pl.coverImgUrl as string) || (pl.picUrl as string) || '',
    tracks: [],
    playCount: (pl.playCount as number) || 0,
    trackCount: (pl.trackCount as number) || 0,
    creatorName: ((pl.creator as Record<string, unknown>)?.nickname as string) || '',
    creatorId: Number((pl.creator as Record<string, unknown>)?.userId) || 0,
    description: (pl.description as string) || '',
    copywriter: (pl.copywriter as string) || '',
  }));
}

// ---- Album ----

export function adaptAlbum(raw: Record<string, unknown>): NcmAlbum {
  const album = raw.album as Record<string, unknown> | undefined;
  if (!album) throw new Error('Missing album in response');
  const tracks: NcmSong[] = adaptSongs(
    ((raw.songs || album.songs || []) as Record<string, unknown>[])
  );
  return {
    albumId: nid(album.id as number),
    title: (album.name as string) || '',
    artists: ((album.artists || album.ar || []) as { id: number; name: string }[]).map((a) => ({
      name: a.name,
      artistId: nid(a.id),
    })),
    songs: tracks.map((t) => ({ title: t.title, songId: t.songId })),
    year: (album.publishTime as number) ? new Date(album.publishTime as number).getFullYear() : 0,
    artworkName: (album.picUrl as string) || '',
    artworkPaths: coverToArtwork((album.picUrl as string) || ''),
    coverUrl: (album.picUrl as string) || '',
    tracks,
    description: (album.description as string) || '',
    trackCount: (album.size as number) || (album.trackCount as number) || tracks.length,
  };
}

// ---- Artist ----

export function adaptArtist(raw: Record<string, unknown>): NcmArtist {
  const artist = raw.artist as Record<string, unknown> | undefined;
  if (!artist) throw new Error('Missing artist in response');
  return {
    artistId: nid(artist.id as number),
    name: (artist.name as string) || '',
    songs: [],
    albums: [],
    isAFavorite: false,
    artworkPaths: coverToArtwork((artist.picUrl as string) || ''),
    coverUrl: (artist.picUrl as string) || '',
    briefDesc: (artist.briefDesc as string) || '',
  };
}

export function adaptArtistSongs(raw: Record<string, unknown>): { artist: NcmArtist; songs: NcmSong[] } {
  const data = raw.data as Record<string, unknown> | undefined;
  const artistData = (raw.artist || data?.artist || {}) as Record<string, unknown>;
  const songs = adaptSongs((raw.songs || raw.hotSongs || []) as Record<string, unknown>[]);
  return {
    artist: adaptArtist({ artist: artistData }),
    songs,
  };
}

// ---- Search ----

export function adaptSearchResult(raw: Record<string, unknown>): NcmSearchResult {
  const result = (raw.result || raw) as Record<string, unknown>;
  const songs = ((result.songs || []) as Record<string, unknown>[]);
  const albums = ((result.albums || []) as Record<string, unknown>[]);
  const artists = ((result.artists || []) as Record<string, unknown>[]);
  const playlists = ((result.playlists || []) as Record<string, unknown>[]);
  return {
    songs: adaptSongs(songs),
    songCount: (result.songCount as number) || songs.length,
    playlists: playlists.map((pl: Record<string, unknown>) => ({
      playlistId: nid(pl.id as number),
      name: (pl.name as string) || '',
      coverImgUrl: (pl.coverImgUrl as string) || (pl.picUrl as string) || '',
      trackCount: (pl.trackCount as number) || 0,
    })),
    playlistCount: (result.playlistCount as number) || playlists.length,
    albums: albums.map((a: Record<string, unknown>) => ({
      albumId: nid(a.id as number),
      name: (a.name as string) || '',
      picUrl: (a.picUrl as string) || (a.coverImgUrl as string) || '',
      artist: a.artist || (a.artists as any[])?.[0],
      artists: a.artists,
      size: (a.size as number) || 0,
    })),
    albumCount: (result.albumCount as number) || albums.length,
    artists: artists.map((a: Record<string, unknown>) => ({
      id: a.id as number,
      name: (a.name as string) || '',
      picUrl: (a.picUrl as string) || (a.img1v1Url as string) || '',
    })),
    artistCount: (result.artistCount as number) || artists.length,
  };
}

// ---- Lyric ----

export function adaptLyric(raw: Record<string, unknown>): NcmLyric {
  const lrc = raw.lrc as Record<string, unknown> | undefined;
  const tlyricObj = raw.tlyric as Record<string, unknown> | undefined;
  return {
    lyric: (lrc?.lyric as string) || (raw.lyric as string) || '',
    tlyric: (tlyricObj?.lyric as string) || (raw.tlyric as string) || '',
  };
}
