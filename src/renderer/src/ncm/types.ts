/**
 * NCM 适配层类型 — 与 Nora 现有组件 props 兼容，用于网易云在线数据。
 *
 * 原则：
 * - id 使用负值（避免与 Nora 本地数据库 id 冲突）
 * - path 使用空字符串（在线歌曲无本地文件）
 * - 额外携带原始 url/coverUrl 等字段供适配层内部使用
 */

// ---- 兼容 Nora SongProp ----
export interface NcmSong {
  songId: number; // -NetEaseId
  title: string;
  isVip?: boolean;
  duration: number; // ms
  artists: { name: string; artistId: number }[];
  album: { name: string; albumId: number };
  year?: number;
  path: string; // "" for online
  artworkPaths: {
    isDefaultArtwork: boolean;
    artworkPath: string;
    optimizedArtworkPath: string; // same as artworkPath
  };
  isBlacklisted: boolean;
  /** 网易云原始封面 URL */
  coverUrl: string;
  /** 网易云歌曲播放 URL */
  url: string | null;
  /** 网易云原始 ID（正数） */
  ncmId: number;
  /**
   * 来源标注：网易云歌曲缺省（undefined）；
   * 第三方搜索兜底条目设为 'gequbao' | 'kuwo'，播放走纯 keyword 解锁竞速（无网易云 id）。
   */
  provider?: 'netease' | 'gequbao' | 'kuwo';
  /** 加入歌单时间戳(毫秒)。仅歌单详情接口的曲目带 at 字段,经 adaptSong 保留;其余来源无此字段 */
  addedAt?: number;
}

// ---- 兼容 Nora Playlist ----
export interface NcmPlaylist {
  playlistId: number;
  name: string;
  songs: { title: string; songId: number }[];
  createdDate: Date;
  isArtworkAvailable: boolean;
  artworkPaths: {
    isDefaultArtwork: boolean;
    artworkPath: string;
    optimizedArtworkPath: string;
  };
  /** 网易云原始封面 URL */
  coverUrl: string;
  /** 歌曲详情数据（内存中，不持久化） */
  tracks: NcmSong[];
  /** 播放次数 */
  playCount: number;
  /** 创建者昵称 */
  creatorName: string;
  /** 创建者网易云用户 ID */
  creatorId: number;
  /** 歌曲总数 */
  trackCount: number;
  /** 歌单简介 */
  description: string;
  /** 个性化推荐文案（如"根据你的音乐口味推荐"） */
  copywriter: string;
}

// ---- 兼容 Nora Album ----
export interface NcmAlbum {
  albumId: number;
  title: string;
  isVip?: boolean;
  artists: { name: string; artistId: number }[];
  songs: { title: string; songId: number }[];
  year: number;
  artworkName: string;
  artworkPaths: {
    isDefaultArtwork: boolean;
    artworkPath: string;
    optimizedArtworkPath: string;
  };
  /** 网易云原始封面 URL */
  coverUrl: string;
  /** 歌曲详情数据 */
  tracks: NcmSong[];
  /** 专辑描述 */
  description: string;
  /** 歌曲总数 */
  trackCount: number;
}

// ---- 兼容 Nora Artist ----
export interface NcmArtist {
  artistId: number;
  name: string;
  songs: { title: string; songId: number }[];
  albums: { title: string; albumId: number }[];
  isAFavorite: boolean;
  artworkPaths: {
    isDefaultArtwork: boolean;
    artworkPath: string;
    optimizedArtworkPath: string;
  };
  /** 网易云原始封面 URL */
  coverUrl: string;
  /** 歌手简介 */
  briefDesc: string;
}

// ---- 搜索结果 ----
export interface NcmSearchResult {
  songs: NcmSong[];
  songCount: number;
  playlists: NcmPlaylist[];
  playlistCount: number;
  albums: NcmAlbum[];
  albumCount: number;
  artists: NcmArtist[];
  artistCount: number;
}

// ---- 歌词 ----
export interface NcmLyric {
  lyric: string;
  tlyric: string; // 翻译歌词
}
