import { type MutableRefObject, useMemo } from 'react';
import useResizeObserver from './useResizeObserver';

export const SONG_CARD_MIN_WIDTH = 280;
export const PLAYLIST_CARD_MIN_WIDTH = 220;

/**
 * Nora 首页响应式列数计算。
 * 规则：floor(width / minItemWidth)，与 HomePage 原始逻辑一致。
 */
export default function useResponsiveGrid(
  elRef: MutableRefObject<HTMLElement | null | undefined>,
  fallback = 3,
  minItemWidth = SONG_CARD_MIN_WIDTH
) {
  const { width } = useResizeObserver(elRef);
  const columns = useMemo(
    () => Math.floor(width / minItemWidth) || fallback,
    [width, minItemWidth, fallback]
  );
  return { width, columns };
}
