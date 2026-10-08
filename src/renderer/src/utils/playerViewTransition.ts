import { prefersReducedMotion } from './motionPreference';

type ViewTransitionLike = {
  finished: Promise<void>;
  skipTransition: () => void;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (
    update: () => void | Promise<void>,
  ) => ViewTransitionLike;
};

let activeTransition: ViewTransitionLike | undefined;
let activeStartOffset: number | undefined;

/** Eased presentation progress, not the already-committed React target. */
export const immersiveOffset = (name: string, progress: number, start?: number) => {
  const entering = name === 'immersive-content-in';
  const from = start ?? (entering ? 1 : 0);
  return from + ((entering ? 0 : 1) - from) * progress;
};

const capturePresentation = () => {
  for (const animation of document.getAnimations()) {
    if (!(animation instanceof CSSAnimation)) continue;
    if (!['immersive-content-in', 'immersive-content-out'].includes(animation.animationName)) continue;
    const progress = animation.effect?.getComputedTiming().progress;
    if (progress == null) continue;
    return Math.max(0, Math.min(1, immersiveOffset(animation.animationName, progress, activeStartOffset)));
  }
  return undefined;
};

/**
 * Runs an immersive-player state change as one spatially continuous transition.
 * Starting another transition interrupts the previous one from its current frame.
 */
export const runPlayerViewTransition = async (
  update: () => void | Promise<void>,
) => {
  const documentWithTransitions = document as ViewTransitionDocument;

  if (!documentWithTransitions.startViewTransition || prefersReducedMotion()) {
    await update();
    return;
  }

  const offset = activeTransition ? capturePresentation() : undefined;
  activeTransition?.skipTransition();
  activeStartOffset = offset;
  const style = document.documentElement.style;
  style.setProperty('--immersive-enter-from', `${(offset ?? 1) * 100}%`);
  style.setProperty('--immersive-exit-from', `${(offset ?? 0) * 100}%`);
  style.setProperty('--immersive-enter-opacity', String(1 - .28 * (offset ?? 1)));
  style.setProperty('--immersive-exit-opacity', String(1 - .28 * (offset ?? 0)));
  style.setProperty('--workspace-enter-opacity', String(offset ?? 0));
  style.setProperty('--workspace-exit-opacity', String(offset ?? 1));
  style.setProperty('--immersive-motion-duration', offset === undefined ? '400ms' : '300ms');
  document.documentElement.classList.add("player-view-transition-active");
  const transition = documentWithTransitions.startViewTransition(update);
  activeTransition = transition;

  try {
    await transition.finished;
  } finally {
    if (activeTransition === transition) {
      activeTransition = undefined;
      document.documentElement.classList.remove(
        "player-view-transition-active",
      );
    }
  }
};
