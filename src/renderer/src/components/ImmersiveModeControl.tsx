import { useCallback, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { changeNativeFullscreen, waitForViewportStable, switchImmersiveLayout, revealImmersiveLayout } from '../utils/immersiveTransition';
import { useStore } from '@tanstack/react-store';
import { AppUpdateContext } from '../contexts/AppUpdateContext';
import { store } from '../store/store';
import { closeSettingsDrawer } from '../store/settingsStore';
import { getImmersiveRegion, immersiveStore, setImmersiveRegion } from '../store/immersiveStore';

const ImmersiveModeControl = () => {
  const { updatePlayerType } = useContext(AppUpdateContext);
  const { active, region } = useStore(immersiveStore);
  const reducedMotion = useStore(store, (state) => Boolean(state.localStorage.preferences?.isReducedMotion ||
    (state.isOnBatteryPower && state.localStorage.preferences?.removeAnimationsOnBatteryPower)));
  const previousState = useRef({ playerType: store.state.playerType, fullscreen: false });
  const desired = useRef(false);
  const switching = useRef(false);
  const nativeExitRequested = useRef(false);
  const mounted = useRef(true);

  const requestMode = useCallback(async (target: boolean) => {
    desired.current = target;
    if (switching.current) return;
    switching.current = true;
    const root = document.documentElement;
    root.setAttribute('data-immersive-switching', '');
    try {
      while (mounted.current && desired.current !== immersiveStore.state.active) {
        const next = desired.current;
        if (next) {
          previousState.current = {
            playerType: store.state.playerType,
            fullscreen: await window.api.fullscreen.isFullscreen()
          };
          closeSettingsDrawer();
        }
        const committed = await switchImmersiveLayout({
          target: next,
          previousFullscreen: previousState.current.fullscreen,
          changeFullscreen: async (fullscreen) => {
            nativeExitRequested.current = !fullscreen;
            try {
              await changeNativeFullscreen(fullscreen, window.api.fullscreen);
            } finally {
              nativeExitRequested.current = false;
            }
          },
          settle: waitForViewportStable,
          stillWanted: () => mounted.current && desired.current === next,
          commit: () => flushSync(() => {
            immersiveStore.setState(() => ({ active: next, region: null }));
            updatePlayerType(next ? 'full' : previousState.current.playerType);
          })
        });
        if (committed && mounted.current) revealImmersiveLayout(next);
      }
    } catch (error) {
      console.error('Immersive window switch failed', error);
      desired.current = immersiveStore.state.active;
    } finally {
      root.removeAttribute('data-immersive-switching');
      switching.current = false;
    }
  }, [updatePlayerType]);

  const exit = useCallback(() => { void requestMode(false); }, [requestMode]);
  const toggle = useCallback(() => requestMode(!desired.current), [requestMode]);

  useEffect(() => {
    mounted.current = true;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (!desired.current && !immersiveStore.state.active)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      exit();
    };
    window.addEventListener('keydown', onKeyDown, true);
    const removeLeave = window.api.fullscreen.onLeaveFullscreen(() => {
      if (nativeExitRequested.current) return;
      previousState.current.fullscreen = false;
      exit();
    });
    return () => {
      mounted.current = false;
      desired.current = false;
      window.removeEventListener('keydown', onKeyDown, true);
      removeLeave();
    };
  }, [exit]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-immersive', active);
    root.dataset.immersiveRegion = region ?? '';
    return () => {
      root.removeAttribute('data-immersive');
      delete root.dataset.immersiveRegion;
    };
  }, [active, region]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      // Keep an open menu or a keyboard-focused control reachable.
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[role="dialog"], [role="menu"], .queue-popup-surface')) return;
      setImmersiveRegion(getImmersiveRegion(event.clientX, event.clientY, window.innerWidth, window.innerHeight));
    };
    const onLeave = () => setImmersiveRegion(null);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerleave', onLeave);
    return () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return (
    <div className={`immersive-entry-zone ${reducedMotion ? 'reduced-motion' : ''}`} data-active={active} data-visible={region === 'bottom-right'}>
      <button
        type="button"
        className="immersive-entry-button"
        title={active ? '退出全屏沉浸模式（Esc）' : '进入全屏沉浸模式'}
        aria-label={active ? '退出全屏沉浸模式' : '进入全屏沉浸模式'}
        aria-pressed={active}
        onClick={(event) => {
          if (event.detail > 0) event.currentTarget.blur();
          void toggle();
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <rect key={index} className="immersive-entry-ring" x="3" y="5" width="18" height="14" rx="2" style={{ animationDelay: `${index * -600}ms` }} />
          ))}
        </svg>
      </button>
    </div>
  );
};

export default ImmersiveModeControl;
