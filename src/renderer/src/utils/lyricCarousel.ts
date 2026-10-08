/**
 * 歌词轮播动画与布局规则 —— 移植自 Mineradio
 * (public/js/modules/02-visual/ 下 08-lyrics-display-modes.js / 12-lyrics-row-layers.js /
 *  14-stage-lyrics-rendering.js 的虚拟索引 / 滚动缓动 / 行定位 / 上下文透明度 / 翻译行逻辑)
 *
 * 纯 TypeScript,不依赖 R3F / THREE,可独立单测。
 *
 * 核心概念:
 *  - 虚拟索引:每行在"虚拟索引空间"中有一个非均匀位置(翻译感知的槽距累加)。
 *  - scrollOffset:可见窗口中心在虚拟索引空间中的位置,每帧指数缓动逼近目标行。
 *  - liveDelta = 行虚拟索引 - scrollOffset → 驱动行 Y/Z/scale/透明度。
 */

import {
  normalizeLyricDisplayMode,
  lyricDisplayOffsetsForMode
} from './lyricDisplay';

// ── 基础 ───────────────────────────────────────────────────────────────────

export function clampRange(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export type LyricTranslationMode = 'off' | 'current' | 'dual' | 'multi';

const LYRIC_TRANSLATION_MODES: ReadonlySet<string> = new Set(['off', 'current', 'dual', 'multi']);

export function normalizeLyricTranslationMode(mode: unknown): LyricTranslationMode {
  const m = String(mode ?? 'off');
  return LYRIC_TRANSLATION_MODES.has(m) ? (m as LyricTranslationMode) : 'off';
}

export function lyricTranslationLayoutActive(mode: unknown): boolean {
  return normalizeLyricTranslationMode(mode) !== 'off';
}

// ── 布局参数(opts 子集)──────────────────────────────────────────────────────

export interface CarouselLayoutOpts {
  translationMode: unknown;
  translationScale: number;
  translationGap: number;
  contextSpread: number;
}

export function lyricContextOpacityValue(raw: number): number {
  return clampRange(raw, 0.25, 1);
}

export function lyricContextSpreadValue(raw: number): number {
  return clampRange(raw, 0.60, 2.40);
}

export function lyricTranslationScaleValue(raw: number): number {
  return clampRange(raw, 0.46, 1.12);
}

export function lyricTranslationGapValue(raw: number): number {
  return clampRange(raw, 0.28, 2.20);
}

export function lyricTranslationOpacityValue(raw: number): number {
  return clampRange(raw, 0.20, 1);
}

// ── 虚拟索引 / 槽距 ─────────────────────────────────────────────────────────

/** 翻译行与父行的可视间距(虚拟索引单位)。 */
export function lyricTranslationVisualGapValue(gap: number, scale: number): number {
  const g = lyricTranslationGapValue(gap);
  const s = lyricTranslationScaleValue(scale);
  return clampRange(0.98 + (g - 0.28) * 0.36 + Math.max(0, s - 0.66) * 0.12, 0.92, 2.20);
}

/** 带翻译的相邻两行之间的主槽距。 */
export function lyricPrimarySlotStepValue(opts: CarouselLayoutOpts): number {
  if (!lyricTranslationLayoutActive(opts.translationMode)) return 1;
  const gap = lyricTranslationGapValue(opts.translationGap);
  const scale = lyricTranslationScaleValue(opts.translationScale);
  return clampRange(
    lyricTranslationVisualGapValue(gap, scale) + 0.82 + scale * 0.14,
    1.78,
    2.88
  );
}

/** 行 i 是否带翻译文本(Lumina 存于 secondaryText,可能为译文或拼音)。 */
export function lyricLineHasTranslationAt(
  lines: { secondaryText?: string }[],
  index: number
): boolean {
  if (index < 0 || index >= lines.length) return false;
  return !!lines[index]?.secondaryText;
}

/** 行 i 与下一行的槽距(翻译感知)。 */
export function lyricLineSlotStepValue(
  lines: { secondaryText?: string }[],
  index: number,
  opts: CarouselLayoutOpts
): number {
  if (!lyricTranslationLayoutActive(opts.translationMode)) return 1;
  const needsTranslationSlot =
    lyricLineHasTranslationAt(lines, index) || lyricLineHasTranslationAt(lines, index + 1);
  if (needsTranslationSlot) return lyricPrimarySlotStepValue(opts);
  const spread = lyricContextSpreadValue(opts.contextSpread);
  return clampRange(1.04 + (spread - 1) * 0.10, 0.96, 1.24);
}

/**
 * 一次性计算全部行的 primary 虚拟索引前缀数组。
 * prefix[i] = 行 i 的虚拟索引(行 0 → 0,行 i → sum of slotStep(0..i-1))。O(n)。
 */
export function lyricVirtualIndices(
  lines: { secondaryText?: string }[],
  opts: CarouselLayoutOpts
): number[] {
  const prefix = new Array<number>(lines.length);
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    prefix[i] = acc;
    acc += lyricLineSlotStepValue(lines, i, opts);
  }
  return prefix;
}

/** 行 index 的 primary 虚拟索引(越界时线性外推)。 */
export function lyricPrimaryVirtualIndex(
  prefix: number[],
  index: number,
  opts: CarouselLayoutOpts
): number {
  if (index >= 0 && index < prefix.length) return prefix[index];
  return index * lyricPrimarySlotStepValue(opts);
}

/** 父行 parentIndex 的翻译行虚拟索引。 */
export function lyricTranslationVirtualIndex(
  prefix: number[],
  parentIndex: number,
  opts: CarouselLayoutOpts
): number {
  return (
    lyricPrimaryVirtualIndex(prefix, parentIndex, opts) +
    lyricTranslationVisualGapValue(
      lyricTranslationGapValue(opts.translationGap),
      lyricTranslationScaleValue(opts.translationScale)
    )
  );
}

// ── 滚动缓动 ───────────────────────────────────────────────────────────────

/** 每帧缓动系数(帧率无关):1 - pow(1 - base, dt*60)。 */
export function lyricTrackEase(baseEase: number, delta: number): number {
  const base = clampRange(baseEase * 1.16, 0.08, 0.34);
  const frameScale = clampRange(delta * 60, 0.25, 3);
  return 1 - Math.pow(1 - base, frameScale);
}

/** 是否应直接 snap 到目标(而非连续滚动)。 */
export function lyricShouldSnapScroll(
  current: number,
  target: number,
  visibleRadius: number,
  snapUntilMs: number,
  nowMs: number
): boolean {
  if (!Number.isFinite(current)) return true;
  if (nowMs <= snapUntilMs) return true;
  return Math.abs(target - current) > Math.max(3.2, visibleRadius * 1.85);
}

/** 连续滚动每帧步长 clamp ≤ 槽距*0.68。 */
export function lyricClampContinuousStep(step: number, continuousSlotStep: number): number {
  const m = Math.max(0.0001, continuousSlotStep) * 0.68;
  return clampRange(step, -m, m);
}

// ── 行定位 ─────────────────────────────────────────────────────────────────

/**
 * 主行世界步长 = 行高 × spreadFactor × 翻译因子。
 * Lumina 适配:Mineradio 对总步长的最终 clamp(0.22–0.94) 改为只 clamp 乘数因子,
 * 因为 Lumina 的 lineSpacing 滑块范围 50–1000%,不能压到世界单位上限。
 */
export function lyricLineStepWorld(
  baseLineStep: number,
  contextSpread: number,
  translationActive: boolean
): number {
  const spreadFactor = clampRange(1 + (lyricContextSpreadValue(contextSpread) - 1) * 0.32, 0.86, 1.45);
  const tf = translationActive ? 1.06 : 1;
  return baseLineStep * spreadFactor * tf;
}

export function lyricTranslationLineStepWorld(
  baseLineStep: number,
  translationActive: boolean
): number {
  return baseLineStep * (translationActive ? 1.04 : 1);
}

/** 行 Z 深度退让:越远越退后。 */
export function lyricRowDepthZ(liveDelta: number): number {
  return 0.055 - Math.pow(Math.min(5.5, Math.abs(liveDelta)), 1.06) * 0.145;
}

/** 行缩放衰减:越远越小。 */
export function lyricRowDepthScale(liveDelta: number): number {
  return clampRange(1 - Math.min(5.5, Math.abs(liveDelta)) * 0.026, 0.84, 1.02);
}

/** 上下文行随 KTV 进度产生的纵向漂移。 */
export function lyricRowDrift(shownProgress: number, contextDrift: number): number {
  return (0.5 - shownProgress) * contextDrift;
}

/** 漂移幅度随距离的放大因子。 */
export function lyricRowDriftDistFactor(absDelta: number): number {
  return clampRange(0.70 + absDelta * 0.10, 0.65, 1.20);
}

// ── 上下文行透明度 / 缩放 ───────────────────────────────────────────────────

export function lyricContextRowAlpha(delta: number, contextOpacity: number, mode: string): number {
  const o = clampRange(contextOpacity, 0.25, 1);
  if (delta === 0) return 1;
  if (Math.abs(delta) === 1) return mode === 'cinema' ? o : clampRange(o * 0.92, 0.18, 0.92);
  return mode === 'cinema' ? clampRange(o * 0.64, 0.18, 0.92) : clampRange(o * 0.52, 0.18, 0.92);
}

export function lyricContextRowScale(delta: number, mode: string): number {
  if (Math.abs(delta) === 1) return mode === 'cinema' ? 0.90 : 0.88;
  return mode === 'cinema' ? 0.82 : 0.78;
}

/** 上下文行最终透明度衰减(按距激活行的虚拟距离)。 */
export function lyricContextTargetFalloff(targetAlpha: number, targetAbs: number): number {
  return clampRange(targetAlpha * (1 - Math.max(0, targetAbs - 0.25) * 0.070), 0.16, 0.92);
}

/** 翻译行透明度衰减。 */
export function lyricContextTargetFalloffTranslation(targetAlpha: number, targetAbs: number): number {
  return clampRange(targetAlpha * (1 - Math.max(0, targetAbs - 0.65) * 0.12), 0.08, 0.62);
}

// ── 条目构建(供 React 渲染消费)──────────────────────────────────────────────

export interface CarouselEntry {
  key: string;
  lineIndex: number;
  /** 翻译行的父行索引 */
  parentIndex?: number;
  virtualIndex: number;
  text: string;
  secondaryText: string;
  isTranslation: boolean;
  isCurrent: boolean;
  /** buffer 行:显示窗口之外,保持挂载(alpha 0)避免切行时挂载/卸载弹跳 */
  isBuffer?: boolean;
  role: 'current' | 'prev' | 'next' | 'translation' | 'buffer';
  /** 上下文/翻译基础透明度 */
  alpha: number;
  /** 上下文/翻译基础缩放 */
  scale: number;
  weight: number;
}

export interface CarouselBuildOptions {
  displayMode: string;
  customLineCount?: number;
  translationMode: unknown;
  translationScale: number;
  translationGap: number;
  translationOpacity: number;
  contextOpacity: number;
  contextSpread: number;
  /** 渲染窗口(含 buffer 行)。不传则只生成显示窗口行 */
  window?: { start: number; end: number };
}

export function buildCarouselEntries(
  lines: { text: string; secondaryText?: string }[],
  activeIndex: number,
  opts: CarouselBuildOptions
): { entries: CarouselEntry[]; activeEntryIndex: number } {
  const mode = normalizeLyricDisplayMode(opts.displayMode);
  const offsets = lyricDisplayOffsetsForMode(mode, opts.customLineCount);
  const layoutOpts: CarouselLayoutOpts = {
    translationMode: opts.translationMode,
    translationScale: opts.translationScale,
    translationGap: opts.translationGap,
    contextSpread: opts.contextSpread
  };
  const prefix = lyricVirtualIndices(lines, layoutOpts);
  const contextOpacity = lyricContextOpacityValue(opts.contextOpacity);

  // 1) 显示窗口主行条目(按显示偏移)
  const primary: CarouselEntry[] = [];
  const displayLineIdx = new Set<number>();
  let activeEntryIndex = -1;
  for (const offset of offsets) {
    const lineIndex = activeIndex + offset;
    if (lineIndex < 0 || lineIndex >= lines.length) continue;
    const isCurrent = offset === 0;
    if (isCurrent) activeEntryIndex = primary.length;
    displayLineIdx.add(lineIndex);
    primary.push({
      key: String(lineIndex),
      lineIndex,
      virtualIndex: lyricPrimaryVirtualIndex(prefix, lineIndex, layoutOpts),
      text: lines[lineIndex].text,
      secondaryText: lines[lineIndex].secondaryText || '',
      isTranslation: false,
      isCurrent,
      role: offset === 0 ? 'current' : offset < 0 ? 'prev' : 'next',
      alpha: lyricContextRowAlpha(offset, contextOpacity, mode),
      scale: lyricContextRowScale(offset, mode),
      weight: 1
    });
  }

  // dual 末行特例:激活行+1 越界时补激活行-1(Mineradio 2972-2978)
  if (mode === 'dual' && activeIndex + 1 >= lines.length && activeIndex - 1 >= 0) {
    const lineIndex = activeIndex - 1;
    if (!displayLineIdx.has(lineIndex)) {
      displayLineIdx.add(lineIndex);
      primary.push({
        key: String(lineIndex),
        lineIndex,
        virtualIndex: lyricPrimaryVirtualIndex(prefix, lineIndex, layoutOpts),
        text: lines[lineIndex].text,
        secondaryText: lines[lineIndex].secondaryText || '',
        isTranslation: false,
        isCurrent: false,
        role: 'prev',
        alpha: lyricContextRowAlpha(-1, contextOpacity, mode),
        scale: lyricContextRowScale(-1, mode),
        weight: 1
      });
    }
  }

  // 2) buffer 行(渲染窗口内、显示窗口外的行):保持挂载 + alpha 0,
  //    消除切行时顶部行卸载/底部行挂载的"弹跳",轮播滑动更连贯。
  if (opts.window) {
    for (let i = opts.window.start; i <= opts.window.end; i++) {
      if (displayLineIdx.has(i) || i < 0 || i >= lines.length) continue;
      primary.push({
        key: String(i),
        lineIndex: i,
        virtualIndex: lyricPrimaryVirtualIndex(prefix, i, layoutOpts),
        text: lines[i].text,
        secondaryText: lines[i].secondaryText || '',
        isTranslation: false,
        isBuffer: true,
        isCurrent: false,
        role: 'buffer',
        alpha: 0,
        scale: 0.9,
        weight: 1
      });
    }
  }

  // 3) 按虚拟索引排序(决定绘制/深度顺序)
  primary.sort((a, b) => a.virtualIndex - b.virtualIndex);
  activeEntryIndex = primary.findIndex((e) => e.isCurrent);

  // 4) 翻译行插入(off/current/dual/multi,仅对显示窗口主行)
  const tMode = normalizeLyricTranslationMode(opts.translationMode);
  if (tMode === 'off') {
    return { entries: primary, activeEntryIndex };
  }

  const scale = lyricTranslationScaleValue(opts.translationScale);
  const tOpacity = lyricTranslationOpacityValue(opts.translationOpacity);
  const expanded: CarouselEntry[] = [];
  let expandedActiveIndex = -1;
  for (const entry of primary) {
    expanded.push(entry);
    if (entry.lineIndex === activeIndex) expandedActiveIndex = expanded.length - 1;

    let shouldInsert = false;
    if (tMode === 'multi') shouldInsert = !entry.isBuffer;
    else if (tMode === 'current') shouldInsert = !entry.isBuffer && entry.lineIndex === activeIndex;
    else if (tMode === 'dual')
      shouldInsert = !entry.isBuffer && (entry.lineIndex === activeIndex || entry.lineIndex === activeIndex + 1);

    if (shouldInsert && entry.secondaryText) {
      const isCurrentParent = entry.lineIndex === activeIndex;
      expanded.push({
        key: `${entry.lineIndex}-t`,
        lineIndex: entry.lineIndex,
        parentIndex: entry.lineIndex,
        virtualIndex: lyricTranslationVirtualIndex(prefix, entry.lineIndex, layoutOpts),
        text: entry.secondaryText,
        secondaryText: '',
        isTranslation: true,
        isCurrent: isCurrentParent,
        role: 'translation',
        alpha: isCurrentParent
          ? clampRange(tOpacity + 0.08, 0.48, 1)
          : clampRange(entry.alpha * 0.62, 0.24, 0.60),
        scale: isCurrentParent
          ? clampRange(scale * 1.08, 0.70, 1.12)
          : clampRange(scale * 0.92, 0.50, 0.96),
        weight: 650
      });
    }
  }
  return { entries: expanded, activeEntryIndex: expandedActiveIndex };
}

/**
 * 渲染窗口(line 索引范围,含两端)。
 * 替换旧的硬 visibleRange 过滤为"淡出截止窗口":比 visibleRadius 多一圈 fadeRadius,
 * 实际淡出由 visibleFade 透明度完成,窗口只是渲染裁剪上限。
 */
export function buildCarouselRenderWindow(
  activeIndex: number,
  linesLength: number,
  visibleRadius: number,
  translationActive: boolean
): { start: number; end: number } {
  if (linesLength <= 0) return { start: 0, end: 0 };
  const fadeRadius = Math.ceil((visibleRadius + 1.10) * (translationActive ? 2.88 : 1)) + 1;
  const start = Math.max(0, activeIndex - fadeRadius);
  const end = Math.min(linesLength - 1, activeIndex + fadeRadius);
  return { start, end };
}
