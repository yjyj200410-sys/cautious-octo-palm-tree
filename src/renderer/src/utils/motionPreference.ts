/** Shared by JS lifecycles and CSS; reduced motion must also remove timer delays. */
export const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.querySelector('.reduced-motion') !== null;

export const motionDuration = (duration: number) => prefersReducedMotion() ? 0 : duration;
