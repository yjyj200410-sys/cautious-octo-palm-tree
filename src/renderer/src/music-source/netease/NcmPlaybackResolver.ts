/**
 * NcmPlaybackResolver — 网易云播放 URL 解析，VIP 歌曲通过多层 fallback 解锁。
 *
 * resolve(songId):
 *   1. song/url/v1 (unblock=true 启用 API 内置解灰)
 *   2. 可播放 → 直接返回
 *   3. VIP/灰 → localhost:25884/api/unblock/ 按序: GD音乐台 → Kuwo → Bodian → Gequbao
 *   4. 仍失败 → song/download/url/v1 备选
 *   5. 全部失败 → 若官方给了试听 URL，回退 30s 试听（isTrial=true，UI 提示「会员歌曲」）；否则 url=null
 */

import { NcmRepository } from '../../ncm/repository';
import { getPlayTrace } from '../../other/PlayTrace';
import { isThirdPartySong } from '../third-party';

export interface ResolveResult {
  url: string | null;
  source: 'netease' | 'gdstudio' | 'kuwo' | 'bodian' | 'gequbao' | 'download' | null;
  unlocked: boolean;
  /** VIP 歌曲解锁全失败后回退到官方 30s 试听（isTrial=true，UI 提示「会员歌曲」） */
  isTrial?: boolean;
  /** 是否来自预加载（prewarm/prefetch）— 影响缓存 TTL */
  fromPrefetch?: boolean;
  /** 缓存创建时间戳 — 用于年龄检查和过期判断 */
  createdAt: number;
}

const UNBLOCK_BASE = 'http://127.0.0.1:25884/api/unblock';

/** songId → 结果的短时缓存 */
const resolveCache = new Map<number, { result: ResolveResult; ts: number }>();

/** 分层 TTL：
 *  - 正式播放（非 prefetch）: 5 分钟
 *  - 预加载（prefetch）: 2 分钟（更短，防止过期 URL）
 *  - VIP 解锁歌曲（unlocked=true）: 1 分钟（必须定期重新验证）
 */
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_TTL_PREFETCH = 2 * 60 * 1000;
const CACHE_TTL_UNLOCKED = 60 * 1000;

function getEffectiveTtl(result: ResolveResult): number {
  if (result.isTrial) return CACHE_TTL_UNLOCKED; // 试听 URL 带时效签名，1min 内重取
  if (result.unlocked) return CACHE_TTL_UNLOCKED;
  if (result.fromPrefetch) return CACHE_TTL_PREFETCH;
  return CACHE_TTL;
}

// 批量计数器
let unlockCount = 0;
let officialCount = 0;
let downloadCount = 0;
let summaryTimer: ReturnType<typeof setTimeout> | null = null;
function logSummary() {
  if (unlockCount > 0 || officialCount > 0 || downloadCount > 0) {
    console.log(`[NCM_PLAYBACK] summary: ${officialCount} official + ${unlockCount} unlocked + ${downloadCount} download`);
    unlockCount = 0;
    officialCount = 0;
    downloadCount = 0;
  }
}

/** 解析单次 song/url/v1 返回 */
function parseUrlItem(item: Record<string, unknown> | undefined): {
  url: string | null;
  fee: number;
  payed: number;
  st: number;
  freeTrialInfo: unknown;
  br: number;
  level: string;
} {
  if (!item) return { url: null, fee: 0, payed: 0, st: 0, freeTrialInfo: null, br: 0, level: '' };

  const url = (item.url as string) || null;
  // ★ freeTrialInfo 可能是字符串 "null"（API 内置 unblock 成功时）或 null
  const rawTrial = item.freeTrialInfo;
  const freeTrialInfo = rawTrial === 'null' ? null : (rawTrial ?? null);

  return {
    url,
    fee: (item.fee as number) ?? 0,
    // ★ 优先从 URL 响应取 payed，其次从 privilege
    payed: (item.payed as number) ?? 0,
    st: (item.st as number) ?? 0,
    freeTrialInfo,
    br: (item.br as number) ?? 0,
    level: (item.level as string) || '',
  };
}

/** 同一 songId 的 in-flight 请求去重：多个并发调用共享同一个 Promise */
const officialInflight = new Map<number, Promise<ReturnType<typeof parseUrlItem>>>();

async function resolveOfficial(songId: number): Promise<ReturnType<typeof parseUrlItem>> {
  const inflight = officialInflight.get(songId);
  if (inflight) {
    console.log(`[OFFICIAL_TRACE][${songId}] reuse inflight`);
    return inflight;
  }

  const t0 = performance.now();
  const promise = (async () => {
    try {
      // ★ Step 1: song/url/v1（官方请求，带超时）
      //   unblock 必须是 false：song_url_v1 的 unblock=true 会在官方 request() 之前先跑
      //   matchID（unblockmusic-utils 顺序请求多个第三方音源、裸 fetch 无超时），
      //   任一音源挂起则整请求永久挂起且绕过 axios 超时 → 点击永不播放。
      //   VIP/灰色歌曲由下方本地 4-provider 解锁（已加 6s 路由超时）处理。
      console.log(`[OFFICIAL_TRACE][${songId}] song/url/v1 start`);
      const t1 = performance.now();
      const urlRaw = await NcmRepository.getSongUrlRaw(songId, false);
      console.log(`[OFFICIAL_TRACE][${songId}] song/url/v1 response cost=${Math.round(performance.now() - t1)}ms`);

      const t2 = performance.now();
      const data = (urlRaw as Record<string, unknown>)?.data as Array<Record<string, unknown>> | undefined;
      const item = data?.[0];
      const result = parseUrlItem(item);
      console.log(`[OFFICIAL_TRACE][${songId}] step=parse cost=${Math.round(performance.now() - t2)}ms`);

      // ★ 日志
      let domain = 'none';
      if (result.url) {
        const t3 = performance.now();
        try { domain = new URL(result.url).hostname; } catch { /* keep 'none' */ }
        console.log(`[OFFICIAL_TRACE][${songId}] step=parseUrl cost=${Math.round(performance.now() - t3)}ms`);
      }
      const trialStr = result.freeTrialInfo
        ? (typeof result.freeTrialInfo === 'object' ? JSON.stringify(result.freeTrialInfo) : String(result.freeTrialInfo))
        : 'none';
      console.log(
        `[NCM_URL] songId=${songId} api=song/url/v1 ` +
        `br=${result.br} fee=${result.fee} payed=${result.payed} st=${result.st} level=${result.level} ` +
        `freeTrial=${trialStr} domain=${domain} hasUrl=${!!result.url}`
      );

      console.log(`[OFFICIAL_TRACE][${songId}] official total=${Math.round(performance.now() - t0)}ms`);
      return result;
    } catch (err) {
      console.warn(`[NCM_URL] songId=${songId} api=song/url/v1 ERROR:`, err instanceof Error ? err.message : err);
      console.log(`[OFFICIAL_TRACE][${songId}] official total=${Math.round(performance.now() - t0)}ms (error)`);
      return { url: null, fee: 0, payed: 0, st: 0, freeTrialInfo: null, br: 0, level: '' };
    }
  })();

  officialInflight.set(songId, promise);
  try {
    return await promise;
  } finally {
    officialInflight.delete(songId);
  }
}

/** 判断 URL 是否可以完整播放（非试听、非VIP限制） */
function isFullyPlayable(official: ReturnType<typeof parseUrlItem>): boolean {
  if (!official.url) {
    console.log(`[NCM_PLAYABLE] false — no URL`);
    return false;
  }
  // 免费歌曲
  if (official.fee === 0) {
    console.log(`[NCM_PLAYABLE] true — fee=0 (free song)`);
    return true;
  }
  // 已付费/已购买
  if (official.payed === 1) {
    console.log(`[NCM_PLAYABLE] true — payed=1 (VIP/paid user)`);
    return true;
  }
  // 试听限制
  if (official.freeTrialInfo) {
    const trialStr = typeof official.freeTrialInfo === 'object'
      ? JSON.stringify(official.freeTrialInfo)
      : String(official.freeTrialInfo);
    console.log(`[NCM_PLAYABLE] false — freeTrialInfo=${trialStr}`);
    return false;
  }
  // 特殊状态（灰色）
  if (official.st !== 0) {
    console.log(`[NCM_PLAYABLE] false — st=${official.st} (grey/special status)`);
    return false;
  }
  // VIP 未付费 (fee=1/4/8 且 payed≠1)
  if (official.fee > 0 && official.payed !== 1) {
    console.log(`[NCM_PLAYABLE] false — fee=${official.fee}>0 && payed=${official.payed}≠1 (VIP not paid)`);
    return false;
  }
  console.log(`[NCM_PLAYABLE] true — fallthrough (url exists, all checks passed)`);
  return true;
}

async function tryUnlockProvider(
  songId: number,
  provider: string,
  meta?: { title: string; artists: string },
  signal?: AbortSignal,
  metaDuration = 0,
): Promise<{ url: string | null; source: string }> {
  try {
    const params: Record<string, string> = { noCookie: 'true' };
    if (provider === 'gd') {
      params.id = String(songId);
    } else if (meta) {
      params.keyword = `${meta.title} - ${meta.artists.split('/')[0]}`;
      params.songName = meta.title;
      params.artist = meta.artists;
      // ★ 原曲时长（ms）传给 unblock server：provider 据此拒绝加速版/DJ加长版等非原版候选
      if (metaDuration > 0) params.durationMs = String(metaDuration);
    }
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${UNBLOCK_BASE}/${provider}?${qs}`, { signal });
    const data = await res.json() as { code: number; url: string | null };
    const success = data.code === 200 && !!data.url;
    if (success) {
      unlockCount++;
      if (!summaryTimer) summaryTimer = setTimeout(logSummary, 2000);
    }
    return { url: success ? data.url : null, source: provider };
  } catch (err) {
    // ★ AbortError 向上抛出让 Promise.allSettled 记录为 rejected
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { url: null, source: provider };
  }
}

/** song/download/url/v1 备选方案 */
async function tryDownloadUrl(songId: number): Promise<string | null> {
  try {
    const raw = await NcmRepository.getSongDownloadUrlRaw(songId);
    const data = (raw as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    const url = data?.url as string | undefined;
    if (url) {
      downloadCount++;
      if (!summaryTimer) summaryTimer = setTimeout(logSummary, 2000);
      console.log(`[NCM_DOWNLOAD] ok songId=${songId} hasUrl=true`);
    } else {
      console.warn(`[NCM_DOWNLOAD] failed songId=${songId}`);
    }
    return url ?? null;
  } catch (err) {
    console.warn(`[NCM_DOWNLOAD] err songId=${songId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export const NcmPlaybackResolver = {
  /**
   * 解析播放 URL。自动使用分层 TTL 缓存：
   *   - prefetch 结果 2min 过期
   *   - unlocked VIP 结果 1min 过期
   *   - 正式播放结果 5min 过期
   *
   * @param songId - 正数 NCM ID
   * @param opts.fromPrefetch - 是否来自预加载（影响 TTL 和标记）
   */
  async resolve(
    songId: number,
    opts?: {
      fromPrefetch?: boolean;
      /** 已知的歌曲元数据（来自 registry 或缓存），传入后跳过 songDetail 请求 */
      meta?: { title: string; artists: string; album?: string; durationMs?: number };
    },
  ): Promise<ResolveResult> {
    const fromPrefetch = opts?.fromPrefetch ?? false;
    const passedMeta = opts?.meta;
    const cached = resolveCache.get(songId);
    // ★ 第三方合成条目（songId 为合成 ncmId ≥ THIRD_PARTY_ID_BASE）：
    //   没有网易云 id，官方解析/gdstudio/下载/试听全部不可用，走纯 keyword 竞速。
    const isThirdParty = isThirdPartySong(songId);

    // ★ 分层 TTL 检查
    if (cached) {
      const effectiveTtl = getEffectiveTtl(cached.result);
      if (Date.now() - cached.ts < effectiveTtl) {
        // 如果正式播放命中 prefetch 缓存，升级标记
        if (!fromPrefetch && cached.result.fromPrefetch) {
          cached.result.fromPrefetch = false;
          // 升级后使用正常 TTL（延长生命周期）
          console.log(
            `[NCM_FINAL_URL] songId=${songId} source=${cached.result.source} ` +
            `cached=true upgradedFromPrefetch age=${Math.round((Date.now() - cached.ts) / 1000)}s`
          );
        } else {
          const urlPreview = cached.result.url ? cached.result.url.slice(0, 100) : 'null';
          console.log(
            `[NCM_FINAL_URL] songId=${songId} source=${cached.result.source} ` +
            `cached=true fromPrefetch=${cached.result.fromPrefetch} ` +
            `age=${Math.round((Date.now() - cached.ts) / 1000)}s url=${urlPreview}`
          );
        }
        return cached.result;
      }
      // 缓存过期 — 删除并重新解析
      console.log(
        `[NCM_FINAL_URL] songId=${songId} cacheExpired ` +
        `age=${Math.round((Date.now() - cached.ts) / 1000)}s ttl=${getEffectiveTtl(cached.result) / 1000}s`
      );
      resolveCache.delete(songId);
    }

    // 1. song/url/v1 (unblock=true 启用 API 内置解灰)
    // ★ 后台预热不污染用户点击的 trace
    // ★ 第三方合成条目没有网易云 id，官方解析毫无意义 → 跳过（official 保持空值，
    //   playable=false，第 5 步试听兜底随之失效）
    const trace = fromPrefetch ? null : getPlayTrace();
    let official: ReturnType<typeof parseUrlItem> = {
      url: null, fee: 0, payed: 0, st: 0, freeTrialInfo: null, br: 0, level: '',
    };
    if (!isThirdParty) {
      trace?.start('official');
      official = await resolveOfficial(songId);
      trace?.end('official');
    }
    const playable = isFullyPlayable(official);

    console.log(`[NCM_RESOLVE] songId=${songId} playable=${playable} fee=${official.fee} payed=${official.payed}`);

    if (playable) {
      officialCount++;
      if (!summaryTimer) summaryTimer = setTimeout(logSummary, 2000);
      const result: ResolveResult = {
        url: official.url,
        source: 'netease',
        unlocked: false,
        fromPrefetch,
        createdAt: Date.now(),
      };
      resolveCache.set(songId, { result, ts: Date.now() });
      const urlPreview = result.url ? result.url.slice(0, 100) : 'null';
      console.log(
        `[NCM_FINAL_URL] songId=${songId} source=netease unlocked=false ` +
        `fromPrefetch=${fromPrefetch} url=${urlPreview}`
      );
      return result;
    }

    // 2. 获取元数据用于 unlock 搜索
    //    优先使用传入的 registry metadata，减少 songDetail 请求
    //    ★ 第三方合成条目没有网易云 id，songDetail 查不到 → 只能依赖传入 meta
    let meta: { title: string; artists: string } | undefined;
    let metaDuration = passedMeta?.durationMs ?? 0;

    if (passedMeta?.title && passedMeta?.artists) {
      meta = { title: passedMeta.title, artists: passedMeta.artists };
      console.log(`[RESOLVE] metadata source=registry songId=${songId} durationMs=${metaDuration}`);
    } else if (!isThirdParty) {
      console.log(`[RESOLVE] metadata source=songDetail songId=${songId}`);
      try {
        const detail = await NcmRepository.songDetail([songId]);
        if (detail[0]) {
          meta = { title: detail[0].title, artists: detail[0].artists.map((a) => a.name).join(' / ') };
          metaDuration = detail[0].duration;
        }
      } catch { /* ignore */ }
    }

    // ★ 第三方条目缺 meta → keyword 解锁无从谈起，直接判失败
    if (isThirdParty && !meta) {
      console.warn(`[NCM_RESOLVE] songId=${songId} thirdParty missing meta → url=null`);
      return { url: null, source: null, unlocked: false, fromPrefetch, createdAt: Date.now() };
    }

    // 3. 本地 unblock server: 并行竞速 GD音乐台 / Kuwo / Bodian / Gequbao
    //    ★ 第三方合成条目无网易云 id → 排除 gdstudio（必须 id），走纯 keyword 竞速
    const providers = isThirdParty ? ['kuwo', 'bodian', 'gequbao'] : ['gd', 'kuwo', 'bodian', 'gequbao'];
    const controller = new AbortController();
    const { signal } = controller;

    trace?.start('unlock');
    const settled = await Promise.allSettled(
      providers.map(async (provider) => {
        console.log(`[UNLOCK] ${provider} start songId=${songId}`);
        try {
          const r = await tryUnlockProvider(songId, provider, meta, signal, metaDuration);
          if (r.url) {
            controller.abort(); // 成功后立即取消其余 provider
            console.log(`[UNLOCK] ${provider} success songId=${songId}`);
          } else {
            console.log(`[UNLOCK] ${provider} failed songId=${songId}`);
          }
          return r;
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            console.log(`[UNLOCK] ${provider} skip songId=${songId} reason=cancelled`);
          } else {
            console.log(`[UNLOCK] ${provider} failed songId=${songId} reason=${err instanceof Error ? err.message : String(err)}`);
          }
          return { url: null, source: provider };
        }
      })
    );

    const winner = settled.find(
      (r) => r.status === 'fulfilled' && r.value.url
    ) as PromiseFulfilledResult<{ url: string | null; source: string }> | undefined;
    trace?.end('unlock', winner ? `winner=${winner.value.source}` : 'winner=none');

    if (winner) {
      const r = winner.value;
      const result: ResolveResult = {
        url: r.url!,
        source: r.source as ResolveResult['source'],
        unlocked: true,
        fromPrefetch,
        createdAt: Date.now(),
      };
      resolveCache.set(songId, { result, ts: Date.now() });
      const urlPreview = r.url!.slice(0, 100);
      console.log(
        `[NCM_FINAL_URL] songId=${songId} source=${r.source} unlocked=true ` +
        `fromPrefetch=${fromPrefetch} metaDuration=${metaDuration}ms url=${urlPreview}`
      );
      return result;
    }

    // 4. song/download/url/v1 备选
    //    ★ 第三方合成 id 无法走网易云下载 → 跳过
    const downloadUrl = isThirdParty ? null : await tryDownloadUrl(songId);
    if (downloadUrl) {
      const result: ResolveResult = {
        url: downloadUrl,
        source: 'download',
        unlocked: true,
        fromPrefetch,
        createdAt: Date.now(),
      };
      resolveCache.set(songId, { result, ts: Date.now() });
      const urlPreview = downloadUrl.slice(0, 100);
      console.log(
        `[NCM_FINAL_URL] songId=${songId} source=download unlocked=true ` +
        `fromPrefetch=${fromPrefetch} metaDuration=${metaDuration}ms url=${urlPreview}`
      );
      return result;
    }

    // 5. 全部失败 — 官方试听兜底：解锁失败但官方给了 30s 试听 URL 时，
    //    回退到试听（isTrial=true，UI 会提示「会员歌曲」），而不是静默失败。
    //    仅当 freeTrialInfo 明确标记为试听才回退；灰色/无 URL 仍返回 null。
    //    ★ 第三方合成条目没有官方 URL → 该兜底天然失效，这里再显式排除。
    if (!isThirdParty && official.url && official.freeTrialInfo) {
      const trialResult: ResolveResult = {
        url: official.url,
        source: 'netease',
        unlocked: false,
        isTrial: true,
        fromPrefetch,
        createdAt: Date.now(),
      };
      resolveCache.set(songId, { result: trialResult, ts: Date.now() });
      console.warn(
        `[NCM_FINAL_URL] songId=${songId} source=netease isTrial=true ` +
        `(VIP 30s 试听兜底, 解锁全失败) url=${official.url.slice(0, 100)}`
      );
      return trialResult;
    }

    console.warn(`[NCM_FINAL_URL] songId=${songId} source=null ALL_FAILED metaDuration=${metaDuration}ms`);
    const result: ResolveResult = {
      url: null,
      source: null,
      unlocked: false,
      fromPrefetch,
      createdAt: Date.now(),
    };
    // ▼ 不缓存失败结果（下次重试）
    return result;
  },

  /**
   * 只读查询缓存 — 不触发 resolve，不会产生网络请求。
   * 使用分层 TTL：prefetch 结果 2min 过期，unlocked 结果 1min 过期。
   */
  getCached(songId: number): ResolveResult | undefined {
    const cached = resolveCache.get(songId);
    if (cached) {
      const effectiveTtl = getEffectiveTtl(cached.result);
      if (Date.now() - cached.ts < effectiveTtl) {
        return cached.result;
      }
    }
    return undefined;
  },

  /**
   * ★ 强制刷新 URL（忽略缓存，重新走完整 resolve 流程）。
   * 用于 URL 过期、播放失败重试等场景。
   * 刷新后结果以正式播放身份缓存（fromPrefetch=false, 5min TTL）。
   */
  async refreshUrl(songId: number): Promise<ResolveResult> {
    resolveCache.delete(songId);
    console.log(`[NCM_REFRESH] songId=${songId} — forcing re-resolution`);
    return this.resolve(songId, { fromPrefetch: false });
  },

  clearCache() { resolveCache.clear(); },

  /** 失效单曲 URL 缓存(预取失败等场景):删除缓存但不立即重新解析,正式播放时自然重取 */
  invalidate(songId: number): void {
    if (resolveCache.delete(songId)) {
      console.log(`[NCM_INVALIDATE] songId=${songId} — URL cache dropped`);
    }
  },
};
