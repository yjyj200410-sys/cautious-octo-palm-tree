import type { NcmSong } from '../types';
import { NcmRepository } from '../repository';
import { proxyCoverUrl } from '../index';
import { FavoriteService } from '../../utils/unifiedStorage';
import type { QueueSongMeta } from '../../other/playerQueue';

/**
 * PlaybackBridge — NCM 歌曲 → 播放器的桥接层。
 *
 * ★ 重构后（见「Lumina 播放器播放 / 预加载系统重构指令」）：
 *   - 逻辑队列（songIds + 内存 metadata）与播放资源（URL/注册/audio）严格分离。
 *   - playSongs 是 O(1) 初始化：742 首 = 742 个 ID + metadata 引用，绝不预先
 *     解析/注册/预取 742 个 URL、不做 742 次 IPC / localStorage / Audio 下载。
 *   - 当前曲 URL 由 AudioPlayer.loadSong 经 PrefetchManager（PLAY_NOW，单飞）解析。
 *   - 下一首/下下首（NEXT/NEXT_2）由 player 在 positionChange / playSongById 时
 *     经 prefetchAround 窗口预取，且不抢当前曲。
 */

function toAudioPlayerData(song: NcmSong, audioUrl: string) {
  const identity = { source: 'netease' as const, sourceId: String(song.ncmId) };
  return {
    songId: song.songId,
    title: song.title,
    isVip: song.isVip,
    duration: Math.round(song.duration / 1000),
    artists: song.artists.map((a) => ({ artistId: a.artistId, name: a.name })),
    album: song.album,
    path: audioUrl,
    artworkPath: proxyCoverUrl(song.coverUrl),
    isAFavorite: FavoriteService.isFavorite(identity),
    isKnownSource: true,
    isBlacklisted: false,
  };
}

/** 逻辑队列内存元数据（播放/自动切歌时拼 AudioPlayerData，跳过 app/getSong IPC）。 */
function toQueueSongMeta(song: NcmSong): QueueSongMeta {
  return {
    songId: song.songId,
    title: song.title,
    isVip: song.isVip,
    duration: Math.round(song.duration / 1000),
    artists: song.artists.map((a) => ({ artistId: a.artistId, name: a.name })),
    album: song.album ? { albumId: song.album.albumId, name: song.album.name } : undefined,
    artworkPath: proxyCoverUrl(song.coverUrl),
    isKnownSource: true,
    isBlacklisted: false,
  };
}

async function registerSong(song: NcmSong, audioUrl: string) {
  const entry = toAudioPlayerData(song, audioUrl);
  if (!window.api?.ncm?.registerSong) throw new Error('NCM IPC 未就绪');
  await window.api.ncm.registerSong(entry);
  // ★ 保存 sourceId → metadata 映射，用于重启恢复
  saveRegistryEntry(entry.songId, song);
  return entry;
}

// ---- 持久化注册表 ----

function saveRegistryEntry(songId: number, song: NcmSong) {
  try {
    const raw = localStorage.getItem('ncm_registry_map');
    const map = raw ? JSON.parse(raw) : {};
    map[String(songId)] = {
      sourceId: song.ncmId,
      title: song.title,
    isVip: song.isVip,
      artists: song.artists.map((a) => a.name).join(' / '),
      album: song.album?.name || '',
      cover: song.coverUrl,
      duration: song.duration,
    };
    localStorage.setItem('ncm_registry_map', JSON.stringify(map));
  } catch { /* ignore */ }
}

/** 批量写入 registry — 一次 localStorage 读写，避免 O(n²)。仅用于重启恢复。 */
function batchSaveRegistry(songs: NcmSong[]) {
  try {
    const raw = localStorage.getItem('ncm_registry_map');
    const map: Record<string, unknown> = raw ? JSON.parse(raw) : {};
    for (const song of songs) {
      map[String(song.songId)] = {
        sourceId: song.ncmId,
        title: song.title,
    isVip: song.isVip,
        artists: song.artists.map((a) => a.name).join(' / '),
        album: song.album?.name || '',
        cover: song.coverUrl,
        duration: song.duration,
      };
    }
    localStorage.setItem('ncm_registry_map', JSON.stringify(map));
  } catch { /* ignore */ }
}

// ---- Player reference helper ----

interface PlayerRef {
  queue: {
    replaceQueue: (ids: number[], pos: number, clearShuffle: boolean, meta: Record<string, unknown>) => void;
    moveToPosition: (pos: number) => boolean;
    getQueueSource: () => QueueSource | undefined;
    setQueueSource: (source: QueueSource) => void;
    setSongMetadata: (entries: QueueSongMeta[]) => void;
    matchesQueueSource: (type: QueueSource['type'], sourceId?: string, songIdsHash?: number) => boolean;
    removeSongId: (songId: number) => boolean;
    addSongIdsToNext: (songIds: number[]) => void;
    addSongIdsToEnd: (songIds: number[]) => void;
    songIds: number[];
    position: number;
  };
  playSongById: (id: number, opts?: Record<string, unknown>) => Promise<void>;
  playSongAtPosition: (pos: number) => void;
}

function getPlayer(): PlayerRef | undefined {
  return (window as unknown as Record<string, unknown>).__noraPlayer as PlayerRef | undefined;
}

// ---- Song ID hashing ----

/** DJB2 hash of sorted song IDs — fast way to check if playlist content changed */
function hashSongIds(ids: number[]): number {
  const sorted = [...ids].sort((a, b) => a - b);
  let hash = 5381;
  for (const id of sorted) {
    hash = ((hash << 5) + hash) + id; // hash * 33 + id
  }
  return hash >>> 0; // unsigned 32-bit
}

let latestPlayRequest = 0;

export const PlaybackBridge = {
  async playSong(song: NcmSong) {
    return this.playSongs([song], 0);
  },

  /** 注册歌曲并移动到下一首（移除旧位置，插入当前位置+1） */
  async addToNext(song: NcmSong) {
    const url = await NcmRepository.songUrl(song.ncmId);
    if (!url) throw new Error('无法获取播放地址');
    const entry = await registerSong(song, url);
    const player = getPlayer();
    player?.queue.removeSongId(entry.songId);
    player?.queue.addSongIdsToNext([entry.songId]);
    return entry;
  },

  /** 注册歌曲并添加到队尾（移除旧位置，追加到末尾） */
  async addToEnd(song: NcmSong) {
    const url = await NcmRepository.songUrl(song.ncmId);
    if (!url) throw new Error('无法获取播放地址');
    const entry = await registerSong(song, url);
    const player = getPlayer();
    player?.queue.removeSongId(entry.songId);
    player?.queue.addSongIdsToEnd([entry.songId]);
    return entry;
  },

  /**
   * 播放歌曲列表 — O(1) 初始化。
   *
   * ★ 不解析 / 不预取任何歌曲 URL；只做几件快事：
   *   1. setSongMetadata：逻辑队列写入 742 个 ID + 内存 metadata（纯引用）
   *   2. registerSongs：批量注册 metadata 到主进程 registry（一次 IPC，URL 留空懒加载）
   *   3. replaceQueue + setQueueSource：重建逻辑队列
   * 当前曲 URL 在 AudioPlayer.loadSong 内经 PrefetchManager(PLAY_NOW) 单飞解析。
   * registry 持久化（restore 用）setTimeout 延后执行，不阻塞首播。
   *
   * ★ 智能复用：当前队列已来自同一歌单（相同 playlistId + 相同歌曲哈希）时，
   *   跳过 replaceQueue，直接 playSongAtPosition。
   *
   * @param songs - NCM 歌曲列表
   * @param startIndex - 起始播放索引
   * @param sourceType - 来源类型（用于 queueSource 标识）
   * @param sourceId - 来源 ID（如歌单 ID），用于判断是否同一歌单
   */
  async playSongs(
    songs: NcmSong[],
    startIndex = 0,
    sourceType: QueueSource['type'] = 'ncmPlaylist',
    sourceId?: string
  ) {
    const requestId = ++latestPlayRequest;
    if (!songs.length) throw new Error('歌曲列表为空');
    const current = songs[startIndex];
    if (!current) throw new Error('无效的歌曲索引');

    const player = getPlayer();
    if (!player) throw new Error('播放器实例未找到');

    const allIds = songs.map((s) => s.songId);
    const songIdsHash = hashSongIds(allIds);

    // ★ 元数据一次性写入逻辑队列（O(N) 内存引用；742 首 ≠ 742 次初始化）
    player.queue.setSongMetadata(songs.map(toQueueSongMeta));

    // ★ 批量注册元数据到主进程 NCM registry（一次 IPC，非 N 次）：
    //   队列 UI（QueuePopup → getSongInfo）依赖 registry 展示 NCM 歌曲，
    //   不注册则「播放全部」后队列显示 0 首。URL 留空（懒加载），由
    //   PrefetchManager 在真正播放时解析并经 registerSong 补全 ——
    //   保持 O(1) 初始化，不解析 / 不预取任何歌曲 URL。
    if (window.api?.ncm?.registerSongs) {
      try {
        await window.api.ncm.registerSongs(songs.map((s) => toAudioPlayerData(s, '')));
      } catch (error) {
        console.warn('[PlaybackBridge] Queue metadata registration failed', error);
      }
    }

    if (requestId !== latestPlayRequest) return;

    // ★ 检查是否可以复用现有队列
    const canReuse = player.queue.matchesQueueSource(sourceType, sourceId, songIdsHash);
    console.log('[PLAY_REQUEST] source=%s action=%s sourceId=%s canReuse=%s queueLen=%d hash=%d',
      sourceType,
      canReuse ? 'playExisting' : 'replaceQueue',
      sourceId || '',
      canReuse,
      player.queue.songIds.length,
      songIdsHash
    );

    // ★ registry 持久化（restore 用）延后到宏任务，移出首播关键路径
    setTimeout(() => batchSaveRegistry(songs), 0);

    if (canReuse) {
      // ★ 同一歌单 — 队列与 metadata 已就绪，直接定位播放
      const queueIndex = player.queue.songIds.indexOf(current.songId);
      if (queueIndex >= 0) {
        player.playSongAtPosition(queueIndex);
      } else {
        await player.playSongById(current.songId, { autoPlay: true });
      }
      return;
    }

    // ═══════════════════════════════════════════════════════════
    // ★ 首次加载 — O(1)：只建逻辑队列，URL 由 PrefetchManager 按需解析
    // ═══════════════════════════════════════════════════════════
    console.log(
      `[PLAY_ORDER_FIX] beforeReplaceQueue ` +
      `allIdsCount=${allIds.length} ` +
      `first10=${JSON.stringify(allIds.slice(0, 10))}`
    );
    player.queue.replaceQueue(allIds, startIndex, true, { queueType: 'songs', queueId: sourceId || '' });
    player.queue.setQueueSource({ type: sourceType, sourceId, songIdsHash });

    const t0 = performance.now();
    await player.playSongById(current.songId, { autoPlay: true });
    console.log(
      `[FIRST_PLAY] songId=${current.songId} ` +
      `queueSetupTime=${Math.round(performance.now() - t0)}ms ` +
      `source=${sourceType} sourceId=${sourceId || ''}`
    );
  },

  /**
   * 批量把整张歌单加入队尾 — 与 playSongs 同款 O(1) 初始化(不解析/预取任何 URL)。
   * 一次性注册全部元数据(URL 留空懒加载,PrefetchManager 播放时才解析),逻辑队列先移除
   * 旧位置再追加到队尾(与单曲 addToEnd 语义一致:重复曲移到新位置,不重复累积)。
   */
  async addPlaylistToEnd(songs: NcmSong[]) {
    if (!songs.length) throw new Error('歌曲列表为空');
    const player = getPlayer();
    if (!player) throw new Error('播放器实例未找到');
    const allIds = songs.map((s) => s.songId);
    player.queue.setSongMetadata(songs.map(toQueueSongMeta));
    if (window.api?.ncm?.registerSongs) {
      try {
        await window.api.ncm.registerSongs(songs.map((s) => toAudioPlayerData(s, '')));
      } catch (error) {
        console.warn('[PlaybackBridge] Queue metadata registration failed', error);
      }
    }
    for (const id of allIds) player.queue.removeSongId(id);
    player.queue.addSongIdsToEnd(allIds);
  },

  /**
   * 批量只注册逻辑队列元数据 + 主进程 NCM registry（与 playSongs/addPlaylistToEnd 同款，
   * URL 留空懒加载，不解析/不预取任何 URL）。随后经 useQueueOperations.addToNext/addToEnd
   * 按 ID 加入队列的 NCM 曲目才能被 QueuePopup（getSongInfo）与自动切歌（getSong→getNcmSong）
   * 解析——否则未注册曲目会被静默丢弃（队列少歌）/ 播放时被跳过（遗漏歌曲）。
   * 只注册，不修改 Player / Queue 结构 / IPC。best-effort：注册失败不抛错。
   */
  async registerSongsToQueue(songs: NcmSong[]) {
    if (!songs.length) return;
    const player = getPlayer();
    if (!player) return;
    player.queue.setSongMetadata(songs.map(toQueueSongMeta));
    if (window.api?.ncm?.registerSongs) {
      try {
        await window.api.ncm.registerSongs(songs.map((s) => toAudioPlayerData(s, '')));
      } catch (err) {
        console.error('[registerSongsToQueue] registerSongs failed:', err);
      }
    }
  },
};
