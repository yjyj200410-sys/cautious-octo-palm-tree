/**
 * 歌词显示行数规则 —— 对齐 Mineradio
 * (public/js/modules/02-visual/08-lyrics-display-modes.js 的
 *  lyricDisplayLineCountForMode + lyricDisplayOffsetsForMode)
 *
 * display mode → 显示行数:
 *   single → 1, dual → 2, triple → 3, cinema → 5,
 *   custom → clamp(round(lyricCustomLineCount), 1, 10)
 *
 * offsets(相对激活行, 居中; dual 为 [0,1] = 激活行 + 下一行):
 *   single → [0]
 *   dual   → [0, 1]
 *   其他   → [i - floor(count/2) ...]，count 行连续、激活行居中
 */
export type LyricDisplayMode = 'single' | 'dual' | 'triple' | 'cinema' | 'custom';

const LYRIC_DISPLAY_MODES: ReadonlySet<string> = new Set([
  'single',
  'dual',
  'triple',
  'cinema',
  'custom'
]);

export function normalizeLyricDisplayMode(mode: unknown): LyricDisplayMode {
  const m = String(mode ?? 'single');
  return LYRIC_DISPLAY_MODES.has(m) ? (m as LyricDisplayMode) : 'single';
}

export function lyricDisplayLineCountForMode(
  mode: unknown,
  customLineCount?: unknown
): number {
  const m = normalizeLyricDisplayMode(mode);
  if (m === 'single') return 1;
  if (m === 'dual') return 2;
  if (m === 'triple') return 3;
  if (m === 'cinema') return 5;
  const raw = Number(customLineCount ?? 2);
  return isFinite(raw) ? Math.min(10, Math.max(1, Math.round(raw))) : 2;
}

export function lyricDisplayOffsetsForMode(
  mode: unknown,
  customLineCount?: unknown
): number[] {
  const m = normalizeLyricDisplayMode(mode);
  if (m === 'single') return [0];
  if (m === 'dual') return [0, 1];
  const count = lyricDisplayLineCountForMode(m, customLineCount);
  const activeSlot = Math.floor(count / 2);
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) offsets.push(i - activeSlot);
  return offsets;
}

/**
 * 由「激活行 + 偏移量」计算可见行的连续窗口 [start, end)。
 * Mineradio 的 offsets 恒为连续递增，故窗口即 [active+first, active+last+1)。
 */
export function lyricWindowFromOffsets(
  activeIndex: number,
  offsets: number[],
  totalLines: number
): { start: number; end: number } {
  if (!offsets.length) return { start: 0, end: 0 };
  const start = Math.max(0, activeIndex + offsets[0]);
  const end = Math.min(totalLines, activeIndex + offsets[offsets.length - 1] + 1);
  return { start, end };
}

/**
 * 由「激活行 + 锚点」计算可见行窗口 [start, end)。
 *   anchor=top  → 从聚焦行向下计数 count 行(含聚焦行),不显示聚焦之上的行;
 *   anchor=center(缺省) → 按 display mode 的居中偏移窗口(Mineradio 规则)。
 */
export function lyricDisplayWindow(
  activeIndex: number,
  mode: unknown,
  customLineCount: unknown,
  anchor: unknown,
  totalLines: number
): { start: number; end: number } {
  if (String(anchor ?? 'center') === 'top') {
    const count = lyricDisplayLineCountForMode(mode, customLineCount);
    return {
      start: Math.max(0, activeIndex),
      end: Math.min(totalLines, activeIndex + count)
    };
  }
  return lyricWindowFromOffsets(
    activeIndex,
    lyricDisplayOffsetsForMode(mode, customLineCount),
    totalLines
  );
}
