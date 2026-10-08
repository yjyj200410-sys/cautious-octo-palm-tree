import { describe, expect, it } from 'vitest';

import {
  cameraAtCd,
  buildCdLayout,
  cdLensFrame,
  cdCoverUrl,
  cdPosition,
  nextCdInDirection,
  visibleCds,
  zoomCdCamera,
  CD_CELL,
  CD_LENS,
  CD_ZOOM
} from '../src/renderer/src/utils/cdCanvas';

describe('CD canvas navigation', () => {
  it('uses small CDN covers without changing local or unrelated artwork', () => {
    const raw = 'https://p1.music.126.net/album.jpg?param=1200y1200';
    const proxy = `http://127.0.0.1:25884/cover?url=${encodeURIComponent(raw)}`;
    const compact = new URL(cdCoverUrl(proxy, 128)!);
    expect(new URL(compact.searchParams.get('url')!).searchParams.get('param')).toBe('128y128');
    for (const other of [
      'file:///C:/music/cover.jpg',
      '/assets/cover.webp',
      'https://example.org/cover.jpg'
    ])
      expect(cdCoverUrl(other, 128)).toBe(other);
  });
  it('keeps the cursor over the same song-space point when zooming, even at limits', () => {
    const camera = { x: -731, y: 417, zoom: 0.8 };
    const anchor = { x: 263, y: 121 };
    for (const scale of [0.01, 0.65, 1.8, 100]) {
      const next = zoomCdCamera(camera, scale, anchor);
      expect((anchor.x - next.x) / next.zoom).toBeCloseTo((anchor.x - camera.x) / camera.zoom);
      expect((anchor.y - next.y) / next.zoom).toBeCloseTo((anchor.y - camera.y) / camera.zoom);
      expect(next.zoom).toBeGreaterThanOrEqual(CD_ZOOM.min);
      expect(next.zoom).toBeLessThanOrEqual(CD_ZOOM.max);
    }
  });
  it('builds a stable center-out cloud with six equidistant neighbours', () => {
    const small = buildCdLayout(19);
    const large = buildCdLayout(755);
    expect(large.centers.slice(0, 19)).toEqual(small.centers);
    expect(small.centers[0]).toEqual({ x: 0, y: 0 });
    expect(small.cells.size).toBe(19);
    for (const center of small.centers.slice(1, 7)) {
      expect(Math.hypot(center.x, center.y)).toBeCloseTo(CD_CELL.width);
    }
    expect(small.bounds.left).toBeLessThan(0);
    expect(small.bounds.top).toBeLessThan(0);
  });
  it('makes the last song reachable in partial rings at every zoom', () => {
    for (const count of [1, 5, 755, 20000]) {
      for (const zoom of [0.25, 1, 2]) {
        const layout = buildCdLayout(count);
        const size = { width: 636, height: 412 };
        const camera = cameraAtCd(count - 1, layout, { x: 0, y: 0, zoom }, size);
        const visible = visibleCds(layout, camera, size);
        expect(visible).toContain(count - 1);
        expect(new Set(visible).size).toBe(visible.length);
        expect(visible.every((index) => index >= 0 && index < count)).toBe(true);
      }
    }
  });
  it('keeps mounted work bounded for a large library and arbitrary pan coordinates', () => {
    const count = 20000;
    const layout = buildCdLayout(count);
    const size = { width: 1200, height: 650 };
    const far = cameraAtCd(14567, layout, { x: 0, y: 0, zoom: 1 }, size);
    const visible = visibleCds(layout, far, size);
    expect(visible).toContain(14567);
    expect(visible.length).toBeLessThan(130);
    expect(visibleCds(layout, { x: 100000, y: 100000, zoom: 1 }, size)).toEqual([]);
    expect(visibleCds(buildCdLayout(0), far, size)).toEqual([]);
    expect(visibleCds(layout, far, { width: 0, height: 0 })).toEqual([]);
  });
  it('includes magnified and displaced discs intersecting viewport edges', () => {
    const count = 755;
    const layout = buildCdLayout(count);
    const size = { width: 909, height: 557 };
    for (const camera of [
      { x: -243, y: -813, zoom: 0.25 },
      { x: 423, y: -1617, zoom: 2 }
    ]) {
      const actual = visibleCds(layout, camera, size);
      for (const focus of [
        { x: 0, y: 0 },
        { x: 870, y: 540 },
        { x: 455, y: 280 }
      ]) {
        for (let index = 0; index < count; index++) {
          const p = cdPosition(index, layout);
          const frame = cdLensFrame(layout.centers[index], camera, focus);
          const radius = (CD_CELL.disc * frame.scale * camera.zoom) / 2;
          const x = (p.x + CD_CELL.disc / 2 + frame.x) * camera.zoom + camera.x;
          const y = (p.y + CD_CELL.disc / 2 + frame.y) * camera.zoom + camera.y;
          if (
            x - radius < size.width &&
            x + radius > 0 &&
            y - radius < size.height &&
            y + radius > 0
          )
            expect(actual).toContain(index);
        }
      }
    }
  });
  it('magnifies the nearby cluster while leaving room between circular targets', () => {
    const layout = buildCdLayout(61);
    const camera = { x: 450, y: 280, zoom: 1 };
    const focus = { x: 450, y: 280 };
    expect(cdLensFrame(layout.centers[0], camera, focus).scale).toBe(CD_LENS.maxScale);
    expect(cdLensFrame(layout.centers[1], camera, focus).scale).toBeGreaterThan(1);
    expect(cdLensFrame({ x: 3000, y: 0 }, camera, focus).scale).toBeCloseTo(CD_LENS.minScale);
    for (const zoom of [0.25, 1, 2]) {
      for (const pointer of [focus, { x: 537, y: 360 }, { x: 40, y: 60 }]) {
        const frames = layout.centers.map((center) => {
          const value = cdLensFrame(center, { ...camera, zoom }, pointer);
          return {
            x: (center.x + value.x) * zoom,
            y: (center.y + value.y) * zoom,
            radius: (CD_CELL.disc * value.scale * zoom) / 2
          };
        });
        for (let i = 0; i < frames.length; i++) {
          for (let j = i + 1; j < frames.length; j++) {
            expect(
              Math.hypot(frames[i].x - frames[j].x, frames[i].y - frames[j].y)
            ).toBeGreaterThan(frames[i].radius + frames[j].radius);
          }
        }
      }
    }
  });
  it('moves keyboard focus in the visible direction rather than sequential song order', () => {
    const layout = buildCdLayout(19);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const next = nextCdInDirection(layout, 0, key);
      expect(next).not.toBe(0);
      const center = layout.centers[next];
      if (key === 'ArrowLeft') expect(center.x).toBeLessThan(0);
      if (key === 'ArrowRight') expect(center.x).toBeGreaterThan(0);
      if (key === 'ArrowUp') expect(center.y).toBeLessThan(0);
      if (key === 'ArrowDown') expect(center.y).toBeGreaterThan(0);
    }
    expect(nextCdInDirection(buildCdLayout(1), 0, 'ArrowLeft')).toBe(0);
  });
  it('limits magnification to three cover spacings at every zoom and preserves it during pan', () => {
    const center = { x: 0, y: 0 };
    for (const zoom of [0.25, 1, 2]) {
      const camera = { x: 310, y: 230, zoom };
      const focus = { x: camera.x, y: camera.y };
      const outside = cdLensFrame({ x: CD_CELL.width * 3, y: 0 }, camera, focus);
      expect(outside).toEqual({ x: 0, y: 0, scale: CD_LENS.minScale, opacity: 0.7, layer: 0 });
      expect(cdLensFrame({ x: CD_CELL.width * 2.9, y: 0 }, camera, focus).scale).toBeGreaterThan(
        CD_LENS.minScale
      );
      const before = cdLensFrame(center, camera, { x: focus.x + 60, y: focus.y - 30 });
      const after = cdLensFrame(
        center,
        { ...camera, x: camera.x + 217, y: camera.y - 83 },
        { x: focus.x + 277, y: focus.y - 113 }
      );
      expect(after).toEqual(before);
    }
  });
});
