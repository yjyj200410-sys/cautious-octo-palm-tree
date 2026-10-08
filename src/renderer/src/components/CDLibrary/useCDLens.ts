import {
  CD_LENS,
  cdLensFrame,
  type CanvasCamera,
  type CanvasPoint,
  type CanvasSize,
  type CDLayout
} from '@renderer/utils/cdCanvas';
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

type Spring = { value: number; velocity: number };
type Card = {
  node: HTMLDivElement;
  x: Spring;
  y: Spring;
  scale: Spring;
  transform: string;
  opacity: string;
  layer: number;
  active: boolean;
};
const spring = (value: number): Spring => ({ value, velocity: 0 });

// Closed-form critically damped spring. Retarget the live presentation values,
// preserving velocity, so pointer reversals never restart a CSS transition.
function advance(state: Spring, target: number, dt: number, immediate: boolean) {
  if (immediate) {
    state.value = target;
    state.velocity = 0;
    return false;
  }
  const offset = state.value - target;
  const coefficient = state.velocity + 26 * offset;
  const decay = Math.exp(-26 * dt);
  state.value = target + (offset + coefficient * dt) * decay;
  state.velocity = (state.velocity - 26 * coefficient * dt) * decay;
  if (Math.abs(state.value - target) < 0.001 && Math.abs(state.velocity) < 0.01) {
    state.value = target;
    state.velocity = 0;
    return false;
  }
  return true;
}

/** One demand-driven frame loop for mounted CDs; mouse moves do not render React. */
export default function useCDLens(
  layout: CDLayout,
  camera: CanvasCamera,
  size: CanvasSize,
  dragging: boolean,
  cameraSource: RefObject<CanvasCamera>
) {
  const data = useRef({ layout, camera, size, dragging });
  const cards = useRef(new Map<number, Card>());
  const pointer = useRef<CanvasPoint | null>(null);
  const reducedMotion = useRef(false);
  const frame = useRef<number | null>(null);
  const wasDragging = useRef(false);
  const previousTime = useRef(0);
  const tickRef = useRef<(time: number) => void>(() => {});
  const schedule = useCallback(() => {
    if (data.current.dragging) return;
    if (frame.current === null) {
      previousTime.current = performance.now();
      frame.current = requestAnimationFrame((time) => tickRef.current(time));
    }
  }, []);

  useLayoutEffect(() => {
    data.current = { layout, camera: cameraSource.current, size, dragging };
    tickRef.current = (time) => {
      frame.current = null;
      const dt = Math.min(0.04, Math.max(0.001, (time - previousTime.current) / 1000));
      previousTime.current = time;
      const latest = data.current;
      const focus = pointer.current ?? { x: latest.size.width / 2, y: latest.size.height / 2 };
      let moving = false;
      for (const [index, card] of cards.current) {
        const center = latest.layout.centers[index];
        if (!center) continue;
        const target = cdLensFrame(center, cameraSource.current, focus);
        const active = target.scale > CD_LENS.minScale;
        if (active !== card.active) {
          card.node.dataset.lensActive = String(active);
          card.active = active;
        }
        if (
          target.scale === CD_LENS.minScale &&
          card.scale.value === CD_LENS.minScale &&
          card.x.value === 0 &&
          card.y.value === 0
        )
          continue;
        const immediate = reducedMotion.current || latest.dragging;
        const xMoving = advance(card.x, target.x, dt, immediate);
        const yMoving = advance(card.y, target.y, dt, immediate);
        const scaleMoving = advance(card.scale, target.scale, dt, immediate);
        moving ||= xMoving || yMoving || scaleMoving;
        const transform = `translate3d(${card.x.value.toFixed(3)}px, ${card.y.value.toFixed(3)}px, 0) scale(${card.scale.value.toFixed(4)})`;
        const opacity = target.opacity.toFixed(3);
        if (card.transform !== transform) {
          card.node.style.transform = transform;
          card.transform = transform;
        }
        if (card.opacity !== opacity) {
          card.node.style.opacity = opacity;
          card.opacity = opacity;
        }
        if (card.layer !== target.layer) {
          card.node.style.zIndex = String(target.layer);
          card.layer = target.layer;
        }
      }
      if (moving) frame.current = requestAnimationFrame((next) => tickRef.current(next));
    };
    const enteringDrag = dragging && !wasDragging.current;
    wasDragging.current = dragging;
    if (dragging) {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      // A grabbed world point stays under the pointer during 1:1 pan. Keep its
      // lens fixed and composite the shared plane until pointer release.
      if (enteringDrag) tickRef.current(performance.now());
    } else schedule();
  }, [layout, camera, size, dragging, schedule, cameraSource]);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotion.current = media.matches;
      schedule();
    };
    update();
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [schedule]);

  const register = useCallback(
    (index: number, node: HTMLDivElement | null) => {
      if (!node) {
        cards.current.delete(index);
        return;
      }
      const latest = data.current;
      const center = latest.layout.centers[index] ?? { x: 0, y: 0 };
      const target = cdLensFrame(
        center,
        cameraSource.current,
        pointer.current ?? { x: latest.size.width / 2, y: latest.size.height / 2 }
      );
      const transform = `translate3d(${target.x.toFixed(3)}px, ${target.y.toFixed(3)}px, 0) scale(${target.scale.toFixed(4)})`;
      node.style.transform = transform;
      node.style.opacity = target.opacity.toFixed(3);
      node.style.zIndex = String(target.layer);
      node.dataset.lensActive = String(target.scale > CD_LENS.minScale);
      cards.current.set(index, {
        node,
        x: spring(target.x),
        y: spring(target.y),
        scale: spring(target.scale),
        transform,
        opacity: target.opacity.toFixed(3),
        layer: target.layer,
        active: target.scale > CD_LENS.minScale
      });
      schedule();
    },
    [schedule, cameraSource]
  );
  const followPointer = useCallback(
    (point: CanvasPoint | null) => {
      pointer.current = point;
      schedule();
    },
    [schedule]
  );
  return { register, followPointer };
}
