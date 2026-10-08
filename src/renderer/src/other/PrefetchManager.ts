import type PlayerQueue from './playerQueue';

/**
 * PrefetchManager — 播放资源（URL）解析与预取管理器。
 *
 * 取代 AudioPrefetchManager + PrefetchLimiter（两者已删除）。
 *
 * 职责边界（严格，见「Lumina 播放器播放 / 预加载系统重构指令」）：
 *   - 只负责：URL 解析、URL 缓存、in-flight 单飞去重、优先级、预取窗口、
 *              cancel/invalidate、过期（TTL）、generation。
 *   - 不负责：播放队列、AudioPlayer、UI、store、队列状态。绝不创建 Audio 元素
 *             （预取只解析 URL，由 AudioPlayer 在真正播放时 `audio.src` 加载，
 *              避免 14 路 Audio 下载风暴抢当前歌曲的带宽）。
 *
 * 三档优先级（PrefetchPriority）：
 *   - PLAY_NOW —— 用户点击 / 切歌的当前曲。立即启动并抢占：bump generation、
 *                 丢弃后台排队任务。同一歌曲单飞（共享 promise，不重复请求）。
 *   - NEXT     —— position+1
 *   - NEXT_2   —— position+2
 *   P1/P2 永不在 P0 解析进行中启动（后台预取不抢当前歌曲的网络与 CPU）。
 *
 * TTL（与 NcmPlaybackResolver.resolveCache 分层 TTL 保持一致，但本层 TTL 到期
 * 只是让 URL 从本缓存失效——再次 resolve 会命中 resolver 层缓存，几乎免费）：
 *   - unlocked（需解锁的歌曲）  : 60s
 *   - 预取（NEXT/NEXT_2）        : 120s
 *   - 播放（PLAY_NOW）           : 300s
 */

export type PrefetchPriority = 'PLAY_NOW' | 'NEXT' | 'NEXT_2';

export type SongResourceState = 'idle' | 'loading' | 'ready' | 'failed' | 'expired';

/** resolve 时透传给 NcmPlaybackResolver 的元数据（跳过 songDetail 额外请求）。 */
export interface PrefetchMeta {
  title: string;
  artists: string; // "歌手A / 歌手B"
  album?: string;
  /** 原曲时长（毫秒）— 传给 NcmPlaybackResolver 用于 unlock 原版校验 */
  durationMs?: number;
}

export interface PrefetchResult {
  url: string;
  source: string;
  unlocked: boolean;
  /** VIP 歌曲解锁失败回退的官方 30s 试听（isTrial=true） */
  isTrial?: boolean;
  cached: boolean;
}

interface SongResource {
  songId: number;
  state: SongResourceState;
  url?: string;
  source?: string;
  unlocked?: boolean;
  isTrial?: boolean;
  expiresAt?: number;
  /** 单飞去重：同一歌曲只有一个在途 promise。 */
  promise?: Promise<string | null>;
  error?: unknown;
  /** 内部：settle 上面那个 promise（由 startResolve 回调）。 */
  _settle?: (url: string | null) => void;
}

interface QueueTask {
  songId: number;
  priority: 'NEXT' | 'NEXT_2';
  gen: number;
  meta?: PrefetchMeta;
  resource: SongResource;
}

const MAX_IN_FLIGHT = 2; // P0 之外的后台并发上限
const TTL_PLAY = 5 * 60 * 1000;
const TTL_PREFETCH = 2 * 60 * 1000;
const TTL_UNLOCKED = 60 * 1000;
// ★ 单次 resolve 的硬超时：网络/解析链路任何一环卡住，都不能让 loadSong 永久挂起
//   （历史 bug：song/url/v1 无超时 → 点击后既不播放也无报错）。超时按失败处理，
//   返回 null，由调用方自动跳下一首/报错；底层请求继续在后台完成并缓存，重试即命中。
const RESOLVE_TIMEOUT_MS = 20 * 1000;

const RESOLVE_TIMEOUT = Symbol('resolve-timeout');

/** 给 promise 加超时：ms 内未 settle 则 resolve(RESOLVE_TIMEOUT)；原 promise 出错则 reject。 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof RESOLVE_TIMEOUT> {
  return new Promise<T | typeof RESOLVE_TIMEOUT>((resolve, reject) => {
    const timer = setTimeout(() => resolve(RESOLVE_TIMEOUT), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export class PrefetchManager {
  private static _instance: PrefetchManager | null = null;

  static getInstance(): PrefetchManager {
    if (!PrefetchManager._instance) PrefetchManager._instance = new PrefetchManager();
    return PrefetchManager._instance;
  }

  private resources = new Map<number, SongResource>();
  private queued: QueueTask[] = [];
  private inFlight = new Set<number>();
  private playGeneration = 0;
  private activePlayNow = 0;

  private constructor() {}

  /**
   * 同步读取 URL 缓存（不触发任何解析）。
   * state 为 ready 且未过期才返回；过期则标记为 expired。
   */
  getCached(songId: number): PrefetchResult | undefined {
    const res = this.resources.get(songId);
    if (!res || res.state !== 'ready' || !res.url) return undefined;
    if (res.expiresAt && Date.now() > res.expiresAt) {
      res.state = 'expired';
      return undefined;
    }
    return {
      url: res.url,
      source: res.source || 'unknown',
      unlocked: !!res.unlocked,
      isTrial: !!res.isTrial,
      cached: true,
    };
  }

  /**
   * 确保某歌曲的 URL 可用。缓存命中立即返回；in-flight 返回同一 promise（单飞）。
   *
   * PLAY_NOW：立即启动并抢占（bump generation + 丢弃后台排队任务）。
   * NEXT / NEXT_2：排队，仅在「无 PLAY_NOW 在途」且并发未满时启动。
   *
   * @returns 可播放 URL，失败返回 null。
   */
  prefetch(
    songId: number,
    priority: PrefetchPriority,
    opts?: { meta?: PrefetchMeta }
  ): Promise<string | null> {
    const cached = this.getCached(songId);
    if (cached) return Promise.resolve(cached.url);

    let res = this.resources.get(songId);
    if (!res) {
      res = { songId, state: 'idle' };
      this.resources.set(songId, res);
    }
    if (res.promise) {
      // 单飞：已在途（正在解析或已排队）。
      // ★ 若被用户点播（PLAY_NOW）且歌曲仍只是「排队未启动」，提升为 P0 立即解析
      //   （否则旧 promise 要等当前 P0 结束才由 pump 启动，点击响应变慢）。
      if (priority === 'PLAY_NOW' && !this.inFlight.has(songId)) {
        const idx = this.queued.findIndex((t) => t.songId === songId);
        if (idx >= 0) {
          this.queued.splice(idx, 1);
          this.playGeneration++;
          this.activePlayNow++;
          this.cancelQueued();
          this.startResolve(songId, res, 'PLAY_NOW', opts?.meta);
        }
      }
      return res.promise;
    }

    res.state = 'loading';
    res.promise = new Promise<string | null>((resolve) => {
      res!._settle = resolve;
    });

    if (priority === 'PLAY_NOW') {
      this.playGeneration++;
      this.activePlayNow++;
      this.cancelQueued();
      this.startResolve(songId, res, 'PLAY_NOW', opts?.meta);
    } else {
      this.queued.push({ songId, priority, gen: this.playGeneration, meta: opts?.meta, resource: res });
      this.pump();
    }
    return res.promise;
  }

  /**
   * 预取播放窗口：position+1（NEXT）与 position+2（NEXT_2）。
   * 只读取队列的歌曲 ID 与 metadata，不修改队列。
   */
  prefetchAround(position: number, queue: PlayerQueue): void {
    const next = queue.getSongIdAtPosition(position + 1);
    const next2 = queue.getSongIdAtPosition(position + 2);
    const metaFor = (id: number | null): PrefetchMeta | undefined => {
      if (id == null) return undefined;
      const m = queue.getSongMetadata(id);
      if (!m) return undefined;
      return {
        title: m.title,
        artists: m.artists.map((a) => a.name).join(' / '),
        album: m.album?.name,
        durationMs: m.duration ? m.duration * 1000 : undefined,
      };
    };
    if (next != null) this.prefetch(next, 'NEXT', { meta: metaFor(next) }).catch(() => {});
    if (next2 != null) this.prefetch(next2, 'NEXT_2', { meta: metaFor(next2) }).catch(() => {});
  }

  /** 取消某歌曲的排队（在途解析无法真正中止，结果仅作缓存，无害）。 */
  cancel(songId: number): void {
    const idx = this.queued.findIndex((t) => t.songId === songId);
    if (idx >= 0) {
      const [task] = this.queued.splice(idx, 1);
      task.resource._settle?.(null);
      task.resource.promise = undefined; // 清掉已 settle 的 promise，允许下次重试
    }
  }

  /** 丢弃全部后台排队任务（PLAY_NOW 抢占时调用）。 */
  cancelQueued(): void {
    for (const t of this.queued) {
      t.resource._settle?.(null);
      t.resource.promise = undefined;
    }
    this.queued = [];
  }

  /** 使某歌曲的缓存失效（下次 prefetch 重新解析）。 */
  invalidate(songId: number): void {
    const res = this.resources.get(songId);
    if (res) {
      res.state = 'idle';
      res.url = undefined;
      res.source = undefined;
      res.unlocked = undefined;
      res.isTrial = undefined;
      res.expiresAt = undefined;
      res.error = undefined;
    }
  }

  /** 全部清空（destroy 时调用）。 */
  clear(): void {
    this.cancelQueued();
    this.resources.clear();
    this.inFlight.clear();
    this.activePlayNow = 0;
  }

  // ── 内部 ───────────────────────────────────────────────────────────────────

  /** 调度排队任务。P0 在途时不启动后台；并发未满时按优先级 NEXT > NEXT_2。 */
  private pump(): void {
    if (this.activePlayNow > 0) return;
    if (this.inFlight.size >= MAX_IN_FLIGHT) return;
    this.queued.sort((a, b) => (a.priority === b.priority ? 0 : a.priority === 'NEXT' ? -1 : 1));
    while (this.queued.length > 0 && this.inFlight.size < MAX_IN_FLIGHT) {
      const task = this.queued.shift()!;
      if (task.gen !== this.playGeneration) {
        task.resource._settle?.(null); // 过期任务（已被更新的 PLAY_NOW 取代）
        task.resource.promise = undefined;
        continue;
      }
      if (this.inFlight.has(task.songId)) continue; // 已被占用（含 P0）
      this.startResolve(task.songId, task.resource, task.priority, task.meta);
    }
  }

  private startResolve(
    songId: number,
    res: SongResource,
    priority: PrefetchPriority,
    meta?: PrefetchMeta
  ): void {
    this.inFlight.add(songId);
    withTimeout(this.doResolve(songId, meta, priority !== 'PLAY_NOW'), RESOLVE_TIMEOUT_MS)
      .then((result) => {
        if (result === RESOLVE_TIMEOUT) {
          // ★ 超时：按失败处理（loadSong 不再无限等待）。底层请求继续在后台完成，
          //   其结果由 NcmPlaybackResolver 内部缓存，用户重试即命中。
          res.state = 'failed';
          res.error = new Error(`resolve timeout ${RESOLVE_TIMEOUT_MS}ms songId=${songId}`);
          console.log(
            `[Prefetch] songId=${songId} priority=${priority} state=failed ` +
              `reason=timeout(${RESOLVE_TIMEOUT_MS}ms)`
          );
          res._settle?.(null);
          return;
        }
        if (result?.url) {
          res.state = 'ready';
          res.url = result.url;
          res.source = result.source;
          res.unlocked = result.unlocked;
          res.isTrial = result.isTrial;
          res.expiresAt = Date.now() + this.ttlFor(priority, result.unlocked, result.isTrial);
          res.error = undefined;
        } else {
          res.state = 'failed';
          res.error = new Error(`resolve failed songId=${songId}`);
        }
        console.log(
          `[Prefetch] songId=${songId} priority=${priority} state=${res.state} ` +
            `url=${result?.url ? result.url.slice(0, 60) : 'null'}`
        );
        res._settle?.(result?.url ?? null);
      })
      .catch((err) => {
        res.state = 'failed';
        res.error = err;
        console.log(
          `[Prefetch] songId=${songId} priority=${priority} state=failed ` +
            `err=${err instanceof Error ? err.message : String(err)}`
        );
        res._settle?.(null);
      })
      .finally(() => {
        this.inFlight.delete(songId);
        // ★ 清除已 settle 的 promise：否则失败/过期后单飞会一直返回旧结果——
        //   失败的歌本会话永远无法重试，URL 过期后也会返回旧 URL（TTL 形同虚设）。
        //   清空后下次 prefetch 走 getCached（ready+未过期则命中）或重新 resolve。
        res.promise = undefined;
        if (priority === 'PLAY_NOW') this.activePlayNow--;
        this.pump();
      });
  }

  /** 真实解析。NCM：NcmPlaybackResolver；本地：audioLibraryControls.getSong。 */
  private async doResolve(
    songId: number,
    meta?: PrefetchMeta,
    fromPrefetch = true
  ): Promise<PrefetchResult | null> {
    if (songId < 0) {
      const { NcmPlaybackResolver } = await import(
        '../music-source/netease/NcmPlaybackResolver'
      );
      const resolved = await NcmPlaybackResolver.resolve(-songId, {
        fromPrefetch,
        ...(meta && meta.title && meta.artists
          ? {
              meta: {
                title: meta.title,
                artists: meta.artists,
                album: meta.album,
                durationMs: meta.durationMs,
              },
            }
          : {}),
      });
      if (!resolved?.url) return null;
      return {
        url: resolved.url,
        source: resolved.source || 'unknown',
        unlocked: !!resolved.unlocked,
        isTrial: !!resolved.isTrial,
        cached: false,
      };
    }

    const sd = await window.api.audioLibraryControls.getSong(songId);
    if (!sd?.path) return null;
    return { url: sd.path, source: 'local', unlocked: false, cached: false };
  }

  private ttlFor(priority: PrefetchPriority, unlocked: boolean, isTrial?: boolean): number {
    if (isTrial) return TTL_UNLOCKED; // 试听 URL 带时效签名，短 TTL（与 resolver 层一致）
    if (unlocked) return TTL_UNLOCKED;
    if (priority !== 'PLAY_NOW') return TTL_PREFETCH;
    return TTL_PLAY;
  }
}
