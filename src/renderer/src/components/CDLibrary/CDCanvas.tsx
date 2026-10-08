/* eslint-disable jsx-a11y/no-noninteractive-tabindex -- The focusable canvas region provides keyboard pan and zoom. */
import {
  cameraAtCd,
  buildCdLayout,
  CD_CELL,
  CD_ZOOM,
  cdPosition,
  nextCdInDirection,
  visibleCds,
  zoomCdCamera,
  type CanvasCamera
} from '@renderer/utils/cdCanvas';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import FloatingPanel from '../FloatingChrome/FloatingPanel';
import CDSongCard from './CDSongCard';
import useCDLens from './useCDLens';

const cameras = new Map<string, CanvasCamera>();
const origin: CanvasCamera = { x: 0, y: 0, zoom: 1 };
type Point = { x: number; y: number };
type Drag = { point: Point; camera: CanvasCamera };
type Pinch = { center: Point; distance: number; camera: CanvasCamera };

export default function CDCanvas({
  songs,
  scope,
  currentSongId,
  playing,
  selectionMode,
  selectedIds,
  onPlay,
  onSelect,
  onAction,
  onContextMenu
}: {
  songs: SongData[];
  scope: string;
  currentSongId?: number;
  playing: boolean;
  selectionMode: boolean;
  selectedIds: Set<string>;
  onPlay: (song: SongData) => void;
  onSelect: (songId: number) => void;
  onAction: (action: 'next' | 'queue' | 'favorite', song: SongData) => void;
  onContextMenu: (event: React.MouseEvent, song: SongData) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [camera, setCamera] = useState<CanvasCamera>(() => cameras.get(scope) ?? { ...origin });
  const cameraRef = useRef(camera);
  const initialized = useRef(cameras.has(scope));
  const frame = useRef<number | null>(null);
  const pending = useRef<CanvasCamera | null>(null);
  const points = useRef(new Map<number, Point>());
  const drag = useRef<Drag | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const moved = useRef(false);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const lastCommit = useRef(0);
  const [focused, setFocused] = useState(0);
  const pendingFocus = useRef<number | null>(null);
  const layout = useMemo(() => buildCdLayout(songs.length), [songs.length]);
  const { register, followPointer } = useCDLens(layout, camera, size, dragging, cameraRef);
  const currentIndex = useMemo(
    () => songs.findIndex((song) => song.songId === currentSongId),
    [songs, currentSongId]
  );
  const indices = useMemo(() => visibleCds(layout, camera, size), [layout, camera, size]);
  const compact = camera.zoom < 0.5;
  const focusedPosition = cdPosition(focused, layout);
  const focusedOnScreen =
    focusedPosition.x * camera.zoom + camera.x < size.width &&
    (focusedPosition.x + CD_CELL.disc) * camera.zoom + camera.x > 0 &&
    focusedPosition.y * camera.zoom + camera.y < size.height &&
    (focusedPosition.y + CD_CELL.disc) * camera.zoom + camera.y > 0;
  const rovingIndex =
    indices.includes(focused) && focusedOnScreen
      ? focused
      : (indices.find((index) => {
          const p = cdPosition(index, layout);
          return p.x * camera.zoom + camera.x >= 0 && p.y * camera.zoom + camera.y >= 0;
        }) ?? indices[0]);

  const moveCamera = useCallback((next: CanvasCamera) => {
    cameraRef.current = next;
    pending.current = next;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame((time) => {
      frame.current = null;
      const latest = pending.current;
      if (latest) {
        // Composite the plane each frame; React refreshes culling and controls
        // periodically during a drag rather than every pointer event.
        if (plane.current)
          plane.current.style.transform = `translate3d(${latest.x}px, ${latest.y}px, 0) scale(${latest.zoom})`;
        if (root.current) {
          root.current.dataset.cameraX = latest.x.toFixed(1);
          root.current.dataset.cameraY = latest.y.toFixed(1);
          root.current.dataset.zoom = latest.zoom.toFixed(3);
        }
        if (!draggingRef.current || time - lastCommit.current >= 80) {
          lastCommit.current = time;
          setCamera(latest);
        }
      }
      pending.current = null;
    });
  }, []);

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setSize(next);
      if (!initialized.current && next.width > 0 && next.height > 0) {
        initialized.current = true;
        moveCamera({ x: next.width / 2, y: next.height / 2, zoom: 1 });
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [moveCamera]);

  // Commit focus after culling mounts the target; a fixed number of animation
  // frames can run before React commits during a busy playback update.
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return;
    const node = root.current?.querySelector<HTMLButtonElement>(
      `[data-cd-index="${pendingFocus.current}"] .cd-song-main`
    );
    if (node) {
      node.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [indices]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (cameras.size >= 40) cameras.delete(cameras.keys().next().value!);
      cameras.set(scope, { ...cameraRef.current });
    },
    [scope]
  );

  useEffect(() => {
    const cancelGesture = () => {
      points.current.clear();
      drag.current = null;
      pinch.current = null;
      draggingRef.current = false;
      setCamera(cameraRef.current);
      setDragging(false);
      followPointer(null);
    };
    window.addEventListener('blur', cancelGesture);
    return () => window.removeEventListener('blur', cancelGesture);
  }, [followPointer]);

  const zoom = useCallback(
    (factor: number) => {
      moveCamera(
        zoomCdCamera(cameraRef.current, cameraRef.current.zoom * factor, {
          x: size.width / 2,
          y: size.height / 2
        })
      );
    },
    [moveCamera, size]
  );

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('[data-canvas-ui]')) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      const bounds = node.getBoundingClientRect();
      followPointer({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
      moveCamera(
        zoomCdCamera(
          cameraRef.current,
          cameraRef.current.zoom * Math.exp(-(event.deltaY || event.deltaX) * unit * 0.002),
          { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
        )
      );
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, [moveCamera, followPointer]);

  const point = (event: React.PointerEvent): Point => {
    const bounds = root.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const beginPinch = () => {
    const [a, b] = Array.from(points.current.values());
    if (!a || !b) return;
    pinch.current = {
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      camera: { ...cameraRef.current }
    };
    moved.current = true;
  };
  const endPointer = (event: React.PointerEvent) => {
    if (!points.current.has(event.pointerId)) return;
    points.current.delete(event.pointerId);
    pinch.current = null;
    const remaining = points.current.values().next().value as Point | undefined;
    drag.current = remaining ? { point: remaining, camera: { ...cameraRef.current } } : null;
    if (!remaining) {
      draggingRef.current = false;
      setDragging(false);
      setCamera(cameraRef.current);
      const p = point(event);
      followPointer(p.x >= 0 && p.y >= 0 && p.x <= size.width && p.y <= size.height ? p : null);
    }
  };
  const reset = () => {
    followPointer(null);
    moveCamera({ x: size.width / 2, y: size.height / 2, zoom: 1 });
  };
  const locate = (index: number) => {
    followPointer(null);
    moveCamera(cameraAtCd(index, layout, cameraRef.current, size));
  };
  const navigateDisc = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      let next: number;
      if (event.key.startsWith('Arrow')) next = nextCdInDirection(layout, index, event.key);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = songs.length - 1;
      else return;
      event.preventDefault();
      event.stopPropagation();
      setFocused(next);
      pendingFocus.current = next;
      followPointer(null);
      moveCamera(cameraAtCd(next, layout, cameraRef.current, sizeRef.current));
    },
    [layout, songs.length, moveCamera, followPointer]
  );

  const mapWidth = 100;
  const totalWidth = layout.bounds.width;
  const totalHeight = layout.bounds.height;
  const mapScale = Math.min(mapWidth / totalWidth, 76 / Math.max(1, totalHeight));
  const mapDots = useMemo(() => {
    const stride = Math.max(1, Math.ceil(layout.centers.length / 1500));
    return layout.centers
      .filter((_, index) => index % stride === 0)
      .map(
        (center) =>
          `M${((center.x - layout.bounds.left) * mapScale).toFixed(2)},${((center.y - layout.bounds.top) * mapScale).toFixed(2)}h0.01`
      )
      .join(' ');
  }, [layout, mapScale]);

  return (
    <div
      ref={root}
      className={`cd-canvas ${dragging ? 'is-dragging' : ''} ${compact ? 'is-overview' : ''}`}
      role="region"
      aria-label="CD 歌曲画布"
      tabIndex={0}
      data-zoom={camera.zoom.toFixed(3)}
      data-camera-x={camera.x.toFixed(1)}
      data-camera-y={camera.y.toFixed(1)}
      data-song-count={songs.length}
      onPointerDown={(event) => {
        if (
          (event.target as HTMLElement).closest('[data-canvas-ui]') ||
          (event.button !== 0 && event.button !== 1)
        )
          return;
        if (event.button === 1) event.preventDefault();
        const p = point(event);
        if (!points.current.size) {
          moved.current = false;
          drag.current = { point: p, camera: { ...cameraRef.current } };
        }
        points.current.set(event.pointerId, p);
        if (event.button === 1) event.currentTarget.setPointerCapture(event.pointerId);
        if (points.current.size === 2) beginPinch();
      }}
      onPointerMove={(event) => {
        const p = point(event);
        if (event.pointerType !== 'touch') {
          const target = event.target as HTMLElement;
          followPointer(
            target.closest('[data-canvas-ui]') && !target.closest('.cd-song') ? null : p
          );
        }
        if (!points.current.has(event.pointerId)) return;
        points.current.set(event.pointerId, p);
        if (pinch.current && points.current.size >= 2) {
          const [a, b] = Array.from(points.current.values());
          const initial = pinch.current;
          const next = zoomCdCamera(
            initial.camera,
            (initial.camera.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / initial.distance,
            initial.center
          );
          moveCamera({
            ...next,
            x: next.x + (a.x + b.x) / 2 - initial.center.x,
            y: next.y + (a.y + b.y) / 2 - initial.center.y
          });
          draggingRef.current = true;
          setDragging(true);
        } else if (drag.current) {
          const dx = p.x - drag.current.point.x;
          const dy = p.y - drag.current.point.y;
          if (!moved.current && Math.hypot(dx, dy) < 5) return;
          moved.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          draggingRef.current = true;
          setDragging(true);
          moveCamera({
            ...drag.current.camera,
            x: drag.current.camera.x + dx,
            y: drag.current.camera.y + dy
          });
        }
      }}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onLostPointerCapture={endPointer}
      onPointerLeave={() => {
        if (!points.current.size) followPointer(null);
      }}
      onClickCapture={(event) => {
        if (
          moved.current &&
          event.detail > 0 &&
          !(event.target as HTMLElement).closest('[data-canvas-ui]')
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) {
          // Native button activation takes priority over global playback shortcuts.
          if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
          return;
        }
        const offsets: Record<string, Point> = {
          ArrowLeft: { x: 100, y: 0 },
          ArrowRight: { x: -100, y: 0 },
          ArrowUp: { x: 0, y: 100 },
          ArrowDown: { x: 0, y: -100 }
        };
        if (offsets[event.key]) {
          event.preventDefault();
          event.stopPropagation();
          const c = cameraRef.current;
          moveCamera({ ...c, x: c.x + offsets[event.key].x, y: c.y + offsets[event.key].y });
        } else if (event.key === 'Home' || event.key === '0') {
          event.preventDefault();
          event.stopPropagation();
          reset();
        } else if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          event.stopPropagation();
          zoom(1.2);
        } else if (event.key === '-') {
          event.preventDefault();
          event.stopPropagation();
          zoom(1 / 1.2);
        }
      }}
    >
      <div
        ref={plane}
        className="cd-canvas-plane"
        style={{ transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})` }}
      >
        {indices.map((index) => (
          <CDSongCard
            key={songs[index].songId}
            song={songs[index]}
            index={index}
            center={layout.centers[index]}
            register={register}
            current={songs[index].songId === currentSongId}
            playing={songs[index].songId === currentSongId && playing}
            selected={selectedIds.has(String(songs[index].songId))}
            selectionMode={selectionMode}
            compact={compact}
            focusable={rovingIndex === index}
            onFocus={setFocused}
            onNavigate={navigateDisc}
            onPlay={onPlay}
            onSelect={onSelect}
            onAction={onAction}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
      {songs.length > 0 && (
        <>
          <div className="cd-canvas-note" data-canvas-ui>
            {songs.length} 首<span>靠近放大 · 拖动平移 · 滚轮缩放</span>
          </div>
          <button
            type="button"
            className="cd-minimap"
            data-canvas-ui
            aria-label="歌曲分布，点击移动画布"
            title="点击定位到歌曲分布中的位置"
            style={{ width: totalWidth * mapScale + 16, height: totalHeight * mapScale + 16 }}
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              const c = cameraRef.current;
              moveCamera({
                ...c,
                x:
                  size.width / 2 -
                  ((event.clientX - bounds.left - 8) / mapScale + layout.bounds.left) * c.zoom,
                y:
                  size.height / 2 -
                  ((event.clientY - bounds.top - 8) / mapScale + layout.bounds.top) * c.zoom
              });
            }}
          >
            <svg
              className="cd-minimap-field"
              width={totalWidth * mapScale}
              height={totalHeight * mapScale}
              aria-hidden="true"
            >
              <path
                d={mapDots}
                stroke="currentColor"
                strokeWidth={Math.max(1, CD_CELL.disc * mapScale * 0.65)}
                strokeLinecap="round"
              />
            </svg>
            <span
              className="cd-minimap-window"
              style={{
                left: 8 + (-camera.x / camera.zoom - layout.bounds.left) * mapScale,
                top: 8 + (-camera.y / camera.zoom - layout.bounds.top) * mapScale,
                width: (size.width / camera.zoom) * mapScale,
                height: (size.height / camera.zoom) * mapScale
              }}
            />
          </button>
          <FloatingPanel
            panel="canvas"
            title="画布工具"
            icon="zoom_out_map"
            className="canvas-floating-tools"
          >
            <div
              className="cd-canvas-controls"
              role="group"
              aria-label="画布缩放与定位"
              data-canvas-ui
            >
              <button
                type="button"
                aria-label="缩小画布"
                title="缩小"
                disabled={camera.zoom <= CD_ZOOM.min}
                onClick={() => zoom(1 / 1.2)}
              >
                <span className="material-icons-round" aria-hidden="true">
                  remove
                </span>
              </button>
              <button
                type="button"
                className="cd-zoom-value"
                aria-label="恢复 100% 缩放"
                title="恢复 100%"
                onClick={() =>
                  moveCamera(
                    zoomCdCamera(cameraRef.current, 1, { x: size.width / 2, y: size.height / 2 })
                  )
                }
              >
                {Math.round(camera.zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="放大画布"
                title="放大"
                disabled={camera.zoom >= CD_ZOOM.max}
                onClick={() => zoom(1.2)}
              >
                <span className="material-icons-round" aria-hidden="true">
                  add
                </span>
              </button>
              <span className="cd-controls-divider" />
              <button type="button" aria-label="回到画布开头" title="回到开头" onClick={reset}>
                <span className="material-icons-round-outlined" aria-hidden="true">
                  home
                </span>
              </button>
              <button
                type="button"
                aria-label="定位当前歌曲"
                title={currentIndex < 0 ? '当前歌曲不在此歌单' : '定位当前歌曲'}
                disabled={currentIndex < 0}
                onClick={() => locate(currentIndex)}
              >
                <span className="material-icons-round-outlined" aria-hidden="true">
                  my_location
                </span>
              </button>
            </div>
          </FloatingPanel>
        </>
      )}
    </div>
  );
}
