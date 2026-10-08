import { prefersReducedMotion } from './motionPreference';

let cleanupTimer: ReturnType<typeof setTimeout> | undefined;

/** Install color transitions before the theme variables and dark classes change. */
export const prepareThemeTransition = () => {
  if (prefersReducedMotion()) return;
  if (cleanupTimer) clearTimeout(cleanupTimer);
  const root = document.documentElement;
  root.classList.add('theme-color-transition');
  cleanupTimer = setTimeout(() => {
    root.classList.remove('theme-color-transition');
    cleanupTimer = undefined;
  }, 420);
};
