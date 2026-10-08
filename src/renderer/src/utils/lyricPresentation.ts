/** Layout and motion are independent presets; settings persist their stable IDs. */
export const lyricLayouts = {
  centered: { label: '居中轮播', anchor: 0.5, align: 'center' },
  reading: { label: '靠左阅读', anchor: 0.38, align: 'left' }
} as const;

export const lyricMotions = {
  elegant: {
    label: '优雅',
    duration: 0.65,
    ease: 'power3.out',
    contextScale: 0.94,
    contextOpacity: 0.42
  },
  soft: {
    label: '轻柔',
    duration: 0.9,
    ease: 'power2.out',
    contextScale: 0.98,
    contextOpacity: 0.5
  },
  direct: { label: '无动画', duration: 0, ease: 'none', contextScale: 1, contextOpacity: 0.42 }
} as const;

export function resolveLyricLayout(id: unknown) {
  return lyricLayouts[id as keyof typeof lyricLayouts] ?? lyricLayouts.centered;
}

export function resolveLyricMotion(id: unknown) {
  return lyricMotions[id as keyof typeof lyricMotions] ?? lyricMotions.elegant;
}

export function lyricWordProgress(position: number, start: number, end: number) {
  if (![position, start, end].every(Number.isFinite)) return 0;
  if (end <= start) return position >= start ? 1 : 0;
  return Math.max(0, Math.min(1, (position - start) / (end - start)));
}
