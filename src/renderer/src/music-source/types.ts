/**
 * MusicSource — 统一数据源接口。
 */

// ---- 统一搜索结果 ----

export interface SearchResultItem {
  id: number;            // negative=netease, positive=local
  title: string;
  artists: string;       // comma-separated
  album: string;
  duration: number;      // seconds
  cover: string;         // URL or path
  source: 'local' | 'netease';
  sourceId: number;      // original ID (positive=ncm id, positive=local songId)
}

export interface UnifiedSearchResult {
  items: SearchResultItem[];
  total: number;
}

// ---- 统一模型 ----

export type Song = Record<string, unknown>;
export type Playlist = Record<string, unknown>;
export type Album = Record<string, unknown>;
export type Artist = Record<string, unknown>;
export type SearchResult = Record<string, unknown>;
export type Lyric = Record<string, unknown>;

// ---- MusicSource 接口 ----

export interface MusicSource {
  readonly name: string;

  search(query: string, limit?: number): Promise<UnifiedSearchResult>;
  getSongUrl?(id: number): Promise<string | null>;

  // 网易云专属（可选）
  getUserPlaylists?(uid: number): Promise<unknown[]>;
  getPlaylistDetail?(id: number): Promise<unknown>;
  loginStatus?(): Promise<{ code: number; profile?: Record<string, unknown> }>;
  logout?(): Promise<void>;

  // -- 写入操作（可选） --

  toggleFavoriteSong?(ncmId: number, uid: number, like: boolean): Promise<boolean>;
  subscribePlaylist?(playlistId: number, uid: number): Promise<void>;
  unsubscribePlaylist?(playlistId: number, uid: number): Promise<void>;
  createPlaylist?(name: string, uid: number): Promise<unknown>;
  renamePlaylist?(playlistId: number, newName: string, uid: number): Promise<void>;
  deletePlaylist?(playlistId: number, uid: number): Promise<void>;
  addSongsToPlaylist?(playlistId: number, songIds: number[]): Promise<void>;
  removeSongsFromPlaylist?(playlistId: number, songIds: number[]): Promise<void>;

  clearCache(): void;
}
