import { motionDuration } from './motionPreference';

type FullscreenApi = {
  isFullscreen: () => Promise<boolean>;
  enterFullscreen: () => void;
  exitFullscreen: () => void;
  onEnterFullscreen: (callback: () => void) => () => void;
  onLeaveFullscreen: (callback: () => void) => () => void;
};

/** Subscribe before sending the request so fast native events cannot be missed. */
export const changeNativeFullscreen = async (target: boolean, api: FullscreenApi) => {
  if (await api.isFullscreen() === target) return;
  await new Promise<void>((resolve, reject) => {
    const remove = (target ? api.onEnterFullscreen : api.onLeaveFullscreen)(() => {
      clearTimeout(timeout);
      remove();
      resolve();
    });
    const timeout = setTimeout(() => {
      remove();
      void api.isFullscreen().then((state) => {
        if (state === target) resolve();
        else reject(new Error('Native fullscreen did not reach the requested state.'));
      }, reject);
    }, 1500);
    if (target) api.enterFullscreen();
    else api.exitFullscreen();
  });
};

/** Resize bursts reset the quiet period; two paint frames let the new layout settle. */
export const waitForViewportStable = () => new Promise<void>((resolve) => {
  let quiet: ReturnType<typeof setTimeout>;
  const finish = () => {
    clearTimeout(quiet);
    clearTimeout(limit);
    window.removeEventListener('resize', onResize);
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  };
  const onResize = () => {
    clearTimeout(quiet);
    quiet = setTimeout(finish, 60);
  };
  const limit = setTimeout(finish, 600);
  window.addEventListener('resize', onResize);
  onResize();
});

export const switchImmersiveLayout = async (options: {
  target: boolean;
  previousFullscreen: boolean;
  changeFullscreen: (target: boolean) => Promise<void>;
  settle: () => Promise<void>;
  stillWanted: () => boolean;
  commit: () => void;
}) => {
  const fullscreen = options.target || options.previousFullscreen;
  await options.changeFullscreen(fullscreen);
  await options.settle();
  if (!options.stillWanted()) {
    if (options.target) {
      await options.changeFullscreen(options.previousFullscreen);
      await options.settle();
    }
    return false;
  }
  options.commit();
  await options.settle();
  return true;
};

/** A small compositor animation avoids capturing the entire WebGL/blurred page. */
export const revealImmersiveLayout = (active: boolean) => {
  const duration = motionDuration(180);
  if (!duration) return;
  const surface = document.querySelector(active ? '.immersive-content-transition' : '.player-workspace-transition');
  surface?.animate([
    { opacity: .86, transform: 'translateY(8px)' },
    { opacity: 1, transform: 'translateY(0)' }
  ], { duration, easing: 'cubic-bezier(.22,1,.36,1)' });
};
