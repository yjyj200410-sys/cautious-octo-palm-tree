export function activeLyricIndex(lines: readonly { start: number }[], position: number): number {
  let low = 0, high = lines.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].start <= position) low = middle + 1;
    else high = middle;
  }
  return lines.length ? Math.max(0, low - 1) : -1;
}
