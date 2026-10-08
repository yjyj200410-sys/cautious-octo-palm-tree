import { describe, test, expect } from 'vitest';

import {
  lyricPrimaryVirtualIndex,
  lyricVirtualIndices,
  lyricTranslationVirtualIndex,
  lyricPrimarySlotStepValue,
  lyricTranslationVisualGapValue,
  lyricLineSlotStepValue,
  lyricTrackEase,
  lyricShouldSnapScroll,
  lyricClampContinuousStep,
  lyricRowDepthZ,
  lyricRowDepthScale,
  lyricContextRowAlpha,
  lyricContextRowScale,
  lyricContextTargetFalloff,
  buildCarouselEntries,
  buildCarouselRenderWindow,
  normalizeLyricTranslationMode,
  lyricTranslationLayoutActive
} from '@renderer/utils/lyricCarousel';

// 构造带可选翻译的歌词行
function lines(hasTranslation: boolean[]): { text: string; secondaryText: string }[] {
  return hasTranslation.map((t, i) => ({
    text: `line-${i}`,
    secondaryText: t ? `trans-${i}` : ''
  }));
}

const OFF = { translationMode: 'off', translationScale: 0.66, translationGap: 0.8, contextSpread: 1.0 };
const ON = { translationMode: 'current', translationScale: 0.66, translationGap: 0.8, contextSpread: 1.0 };

describe('虚拟索引 / 槽距', () => {
  test('翻译关闭时 primary 虚拟索引 = 行号(恒等)', () => {
    const ls = lines([false, false, false, false]);
    const prefix = lyricVirtualIndices(ls, OFF);
    expect(prefix).toEqual([0, 1, 2, 3]);
    expect(lyricPrimaryVirtualIndex(prefix, 2, OFF)).toBe(2);
  });

  test('翻译开启时,带翻译的相邻行槽距用 primarySlotStep(∈[1.78,2.88])', () => {
    const ls = lines([false, true, false, false]);
    const prefix = lyricVirtualIndices(ls, ON);
    // 行 1 有翻译 → slotStep(0) 与 slotStep(1) 用 primarySlotStep
    const slotStep0 = prefix[1] - prefix[0];
    const slotStep1 = prefix[2] - prefix[1];
    expect(slotStep0).toBeGreaterThanOrEqual(1.78);
    expect(slotStep0).toBeLessThanOrEqual(2.88);
    expect(slotStep1).toBeGreaterThanOrEqual(1.78);
    // 行 2 无翻译且行 3 无翻译 → 普通槽距 ≈ 1
    const slotStep2 = prefix[3] - prefix[2];
    expect(slotStep2).toBeGreaterThan(0.95);
    expect(slotStep2).toBeLessThan(1.25);
  });

  test('翻译行虚拟索引 = 父行 + 可视间距', () => {
    const ls = lines([true, false, false]);
    const prefix = lyricVirtualIndices(ls, ON);
    const gap = lyricTranslationVisualGapValue(0.8, 0.66);
    expect(lyricTranslationVirtualIndex(prefix, 0, ON)).toBeCloseTo(
      lyricPrimaryVirtualIndex(prefix, 0, ON) + gap,
      6
    );
  });

  test('primarySlotStep 与 visualGap 的数值落点', () => {
    const gap = lyricTranslationVisualGapValue(0.8, 0.66);
    expect(gap).toBeCloseTo(1.1672, 4);
    const step = lyricPrimarySlotStepValue(ON);
    expect(step).toBeCloseTo(2.0796, 4);
  });

  test('normalize / 布局激活判断', () => {
    expect(normalizeLyricTranslationMode('multi')).toBe('multi');
    expect(normalizeLyricTranslationMode('bogus')).toBe('off');
    expect(lyricTranslationLayoutActive('off')).toBe(false);
    expect(lyricTranslationLayoutActive('dual')).toBe(true);
  });
});

describe('滚动缓动 / snap', () => {
  test('trackEase 单调递增', () => {
    const e1 = lyricTrackEase(0.16, 1 / 60);
    const e2 = lyricTrackEase(0.16, 2 / 60);
    expect(e2).toBeGreaterThan(e1);
    expect(e1).toBeGreaterThan(0);
    expect(e1).toBeLessThan(1);
  });

  test('snap 阈值:远跳 > max(3.2, radius*1.85) 时 snap', () => {
    expect(lyricShouldSnapScroll(5, 20, 2, 0, 100)).toBe(true);
    expect(lyricShouldSnapScroll(5, 6, 2, 0, 100)).toBe(false);
    expect(lyricShouldSnapScroll(5, 6, 2, 200, 100)).toBe(true); // snap 计时内
    expect(lyricShouldSnapScroll(Number.NaN, 6, 2, 0, 100)).toBe(true); // 非有限
  });

  test('连续步长 clamp ≤ 槽距*0.68', () => {
    expect(lyricClampContinuousStep(5, 2)).toBeCloseTo(1.36, 6);
    expect(lyricClampContinuousStep(-5, 2)).toBeCloseTo(-1.36, 6);
    expect(lyricClampContinuousStep(0.5, 2)).toBe(0.5);
  });
});

describe('行深度 / 缩放', () => {
  test('Z 随距离单调退后', () => {
    expect(lyricRowDepthZ(0)).toBe(0.055);
    expect(lyricRowDepthZ(1)).toBeLessThan(lyricRowDepthZ(0));
    expect(lyricRowDepthZ(3)).toBeLessThan(lyricRowDepthZ(1));
    // 在 5.5 处钳位(Mineradio 公式),不再继续退
    expect(lyricRowDepthZ(10)).toBeCloseTo(lyricRowDepthZ(5.5), 6);
  });

  test('scale 随距离单调缩小且落在 [0.84, 1.02]', () => {
    expect(lyricRowDepthScale(0)).toBe(1);
    expect(lyricRowDepthScale(2)).toBeLessThan(lyricRowDepthScale(1));
    expect(lyricRowDepthScale(6)).toBeGreaterThanOrEqual(0.84);
    expect(lyricRowDepthScale(6)).toBeLessThanOrEqual(1.02);
  });
});

describe('上下文行 alpha / scale', () => {
  test('激活行 alpha=1,相邻行/远行按档位衰减', () => {
    expect(lyricContextRowAlpha(0, 0.6, 'triple')).toBe(1);
    expect(lyricContextRowAlpha(1, 0.6, 'triple')).toBeCloseTo(0.552, 6);
    expect(lyricContextRowAlpha(-1, 0.6, 'triple')).toBeCloseTo(0.552, 6);
    expect(lyricContextRowAlpha(2, 0.6, 'triple')).toBeCloseTo(0.312, 6);
    // cinema 远处档位更亮
    expect(lyricContextRowAlpha(2, 0.6, 'cinema')).toBeCloseTo(0.384, 6);
  });

  test('上下文行缩放档位', () => {
    expect(lyricContextRowScale(1, 'triple')).toBeCloseTo(0.88, 6);
    expect(lyricContextRowScale(2, 'triple')).toBeCloseTo(0.78, 6);
    expect(lyricContextRowScale(2, 'cinema')).toBeCloseTo(0.82, 6);
  });

  test('透明度随虚拟距离衰减(上限钳位 0.92)', () => {
    expect(lyricContextTargetFalloff(1, 0)).toBeCloseTo(0.92, 6);
    expect(lyricContextTargetFalloff(1, 2)).toBeLessThan(lyricContextTargetFalloff(1, 0));
  });
});

describe('buildCarouselEntries', () => {
  const ls = lines([false, false, false, false, false]);

  test('single 只含激活行', () => {
    const { entries, activeEntryIndex } = buildCarouselEntries(ls, 2, {
      displayMode: 'single', translationMode: 'off', translationScale: 0.66, translationGap: 0.8, translationOpacity: 0.86, contextOpacity: 0.6, contextSpread: 1
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].lineIndex).toBe(2);
    expect(activeEntryIndex).toBe(0);
  });

  test('triple 含 ±1,激活行居中', () => {
    const { entries, activeEntryIndex } = buildCarouselEntries(ls, 2, {
      displayMode: 'triple', translationMode: 'off', translationScale: 0.66, translationGap: 0.8, translationOpacity: 0.86, contextOpacity: 0.6, contextSpread: 1
    });
    expect(entries.map((e) => e.lineIndex)).toEqual([1, 2, 3]);
    expect(entries[activeEntryIndex].isCurrent).toBe(true);
  });

  test('cinema 含 ±2', () => {
    const { entries } = buildCarouselEntries(ls, 2, {
      displayMode: 'cinema', translationMode: 'off', translationScale: 0.66, translationGap: 0.8, translationOpacity: 0.86, contextOpacity: 0.6, contextSpread: 1
    });
    expect(entries.map((e) => e.lineIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  test('dual 末行时补激活行-1', () => {
    const { entries, activeEntryIndex } = buildCarouselEntries(ls, 4, {
      displayMode: 'dual', translationMode: 'off', translationScale: 0.66, translationGap: 0.8, translationOpacity: 0.86, contextOpacity: 0.6, contextSpread: 1
    });
    expect(entries.map((e) => e.lineIndex)).toEqual([3, 4]);
    expect(entries[activeEntryIndex].lineIndex).toBe(4);
  });

  test('翻译 current:激活行后插入一行翻译', () => {
    const withT = lines([false, false, true, false, false]);
    const { entries, activeEntryIndex } = buildCarouselEntries(withT, 2, {
      displayMode: 'triple', translationMode: 'current', translationScale: 0.66, translationGap: 0.8, translationOpacity: 0.86, contextOpacity: 0.6, contextSpread: 1
    });
    const transEntries = entries.filter((e) => e.isTranslation);
    expect(transEntries).toHaveLength(1);
    expect(transEntries[0].parentIndex).toBe(2);
    expect(entries[activeEntryIndex].isCurrent).toBe(true);
    // 激活行翻译紧随激活主行之后
    const activeIdx = entries.findIndex((e) => e.isCurrent);
    expect(entries[activeIdx + 1].isTranslation).toBe(true);
  });

  test('翻译 dual:激活行与下一行都插入翻译', () => {
    const withT = lines([false, true, true, true, false]);
    const { entries } = buildCarouselEntries(withT, 2, {
      displayMode: 'triple', translationMode: 'dual', translationScale: 0.66, translationGap: 0.8, translationOpacity: 0.86, contextOpacity: 0.6, contextSpread: 1
    });
    const transParents = entries.filter((e) => e.isTranslation).map((e) => e.parentIndex);
    expect(transParents).toEqual([2, 3]);
  });

  test('翻译 multi:每个带翻译的行都插入', () => {
    const withT = lines([true, false, true, false, true]);
    const { entries } = buildCarouselEntries(withT, 2, {
      displayMode: 'cinema', translationMode: 'multi', translationScale: 0.66, translationGap: 0.8, translationOpacity: 0.86, contextOpacity: 0.6, contextSpread: 1
    });
    const transParents = entries.filter((e) => e.isTranslation).map((e) => e.parentIndex);
    expect(transParents).toEqual([0, 2, 4]);
  });

  test('window 参数生成 buffer 行(显示窗口外,isBuffer=true, alpha=0, 保持挂载)', () => {
    const ls = lines([false, false, false, false, false, false, false]);
    const { entries } = buildCarouselEntries(ls, 3, {
      displayMode: 'triple', translationMode: 'off', translationScale: 0.66, translationGap: 0.8, translationOpacity: 0.86, contextOpacity: 0.6, contextSpread: 1,
      window: { start: 0, end: 6 }
    });
    const buffers = entries.filter((e) => e.isBuffer);
    expect(buffers.length).toBeGreaterThan(0);
    expect(buffers.every((e) => e.alpha === 0)).toBe(true);
    // 按虚拟索引排序
    const vi = entries.map((e) => e.virtualIndex);
    expect([...vi].sort((a, b) => a - b)).toEqual(vi);
    // 激活行仍在其中
    expect(entries.find((e) => e.isCurrent)?.lineIndex).toBe(3);
  });
});

describe('buildCarouselRenderWindow', () => {
  test('窗口覆盖可见半径 + 淡出缓冲', () => {
    const w = buildCarouselRenderWindow(10, 100, 3, false);
    expect(w.start).toBeLessThanOrEqual(10 - 4);
    expect(w.end).toBeGreaterThanOrEqual(10 + 4);
  });

  test('翻译开启时窗口更宽(容纳翻译槽距)', () => {
    const off = buildCarouselRenderWindow(10, 100, 3, false);
    const on = buildCarouselRenderWindow(10, 100, 3, true);
    expect(on.start).toBeLessThan(off.start);
    expect(on.end).toBeGreaterThan(off.end);
  });

  test('空歌词安全返回', () => {
    expect(buildCarouselRenderWindow(0, 0, 3, false)).toEqual({ start: 0, end: 0 });
  });
});
