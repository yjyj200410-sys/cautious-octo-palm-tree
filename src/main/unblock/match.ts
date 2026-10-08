import type { SongMatchInfo } from './types';
import logger from '../logger';

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/[（(][^）)]*[）)]/g, '').trim();

/** 歌手拆分为独立姓名 —— 多歌手以 / & 、 ， 等分隔；单歌手名（含空格，如 "Taylor Swift"）整体保留 */
const splitArtists = (artist: string): string[] =>
  artist
    .toLowerCase()
    .split(/[/&、，,;；]/)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter(Boolean);

/**
 * 歌手校验 —— 原曲歌手已知时，候选歌手必须全部与原曲歌手重合。
 * 多歌手逐一比对：**每个** 候选歌手名都必须包含原曲任一歌手名（如「五月天乐团」⊃「五月天」）；
 * 只要出现一个原曲没有的歌手（翻唱者 / 合唱者 / 串场者）→ 拒绝。
 * 这是针对「大土班的魔仙堡&洛天依&逃跑计划」这类条目的收口：歌手串里同时含原曲歌手和翻唱者，
 * 旧实现用 `some` 任一重合即放行，导致带翻唱者的版本混入。
 * 候选缺歌手信息 → 无法确认为原版 → 拒绝；原曲歌手未知（match.artist 空）→ 无法校验，放行。
 */
function artistsMatch(resultArtist: string | undefined, originalArtist: string): boolean {
  const original = splitArtists(originalArtist);
  if (!original.length) return true;
  const result = splitArtists(resultArtist ?? '');
  if (!result.length) return false;
  return result.every((r) => original.some((o) => r.includes(o)));
}

/**
 * 版本标记 —— 候选标题含这些标记而原曲标题不含 → 判定为非原版（DJ版 / 加速版 /
 * Live / 伴奏 / 翻唱 / 混音等）并拒绝。原曲标题本身含标记（例如用户就是想播 DJ 版）
 * 时不拦截。只做过滤，不做兜底：全被拒后由上层回退官方 30s 试听。
 */
const VERSION_MARKERS = [
  'dj', 'remix', '混音', '加速', '慢放', '慢速', 'live', '现场版', '演唱会',
  '伴奏', 'instrumental', '纯音乐', '钢琴版', '吉他版', '翻唱', 'cover',
  '合唱', '童声', '清唱', '串烧', '片段', '副歌', '高潮', '试听',
  'demo', 'acoustic', '不插电', 'unplugged', '剪辑', 'remaster', '重制', '改编',
];

/** 标题含版本标记（DJ/加速/Live/伴奏/翻唱…）→ 非原版。第三方搜索候选过滤复用。 */
export function hasVersionMarker(name: string): boolean {
  const lower = name.toLowerCase();
  return VERSION_MARKERS.some((m) => lower.includes(m));
}

/** 时长容差 ±5%（2026-08-14 从 ±15% 收紧）。同一条录音跨平台时长只差 1-2 秒，
 *  5% 完全容得下；而不同录音/加速/DJ/现场版通常差 >10%，±15% 会放行。原曲时长未知时跳过该检查。 */
const DURATION_TOLERANCE = 0.05;

function durationsMatch(originalMs: number, candidateSec: number): boolean {
  if (!originalMs || !candidateSec || candidateSec <= 0) return true; // 缺时长信息则跳过
  let cand = candidateSec;
  if (cand > 1000) cand = cand / 1000; // 上游若返回毫秒则换算为秒
  const originalSec = originalMs / 1000;
  const ratio = cand / originalSec;
  return Math.abs(ratio - 1) <= DURATION_TOLERANCE;
}

/**
 * 校验搜索结果是否为「原版」。
 *
 * 在原有「标题/歌手」匹配之上新增三层防错版：
 *   1. 版本标记拒绝：候选含 DJ/加速/Live/伴奏/翻唱等标记而原曲不含 → 非原版
 *   2. 歌手校验：候选歌手与原曲歌手必须重合（翻唱/同名不同人 → 非原版）
 *   3. 时长校验：候选时长显著偏离原曲（加速版更短 / DJ 加长版更长）→ 非原版
 * 任一层不满足都返回 false，让上层跳过该候选、继续找原版；全找不到时
 * 上层自然回退官方 30s 试听（NcmPlaybackResolver step 5）。
 *
 * @param resultDurationSec - 候选搜索结果时长（秒），无则 undefined（跳过时长校验）
 */
export function isSongMatch(
  resultName: string,
  resultArtist: string | undefined,
  match: SongMatchInfo,
  resultDurationSec?: number,
): boolean {
  const normResult = normalizeName(resultName);
  const normOriginal = normalizeName(match.songName);
  if (!normResult) return false;

  // ★ 非原版拒绝 1：版本标记（原曲不带而候选带 → DJ版/加速版/Live版/伴奏/翻唱…）
  if (!hasVersionMarker(match.songName) && hasVersionMarker(resultName)) {
    logger.info(`[MATCH_REJECT] "${resultName}" — version marker (non-original)`);
    return false;
  }

  if (normOriginal) {
    if (!normResult.includes(normOriginal) && !normOriginal.includes(normResult)) return false;
  }
  // ★ 非原版拒绝 2：歌手校验 —— 候选与原曲歌手必须重合（翻唱 / 同名不同人 / 缺歌手 → 拒绝）
  if (!artistsMatch(resultArtist, match.artist)) {
    logger.info(
      `[MATCH_REJECT] "${resultName}" — artist mismatch (${resultArtist ?? 'missing'} vs ${match.artist})`
    );
    return false;
  }

  // ★ 非原版拒绝 3：时长显著不符（加速版更短 / DJ 加长版更长）
  if (match.durationMs && resultDurationSec && !durationsMatch(match.durationMs, resultDurationSec)) {
    logger.info(
      `[MATCH_REJECT] "${resultName}" — duration ${resultDurationSec}s vs original ${Math.round(match.durationMs / 1000)}s`
    );
    return false;
  }
  return true;
}
