import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeNativeFullscreen, switchImmersiveLayout, waitForViewportStable } from '../../../../../src/renderer/src/utils/immersiveTransition';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('staged immersive switching', () => {
  it.each([true, false])('settles native bounds before committing layout for target %s', async (target) => {
    const calls: string[] = [];
    await switchImmersiveLayout({ target, previousFullscreen: false,
      changeFullscreen: async (state) => { calls.push('native:' + state); },
      settle: async () => { calls.push('settled'); },
      stillWanted: () => true,
      commit: () => { calls.push('layout'); }
    });
    expect(calls).toEqual(['native:' + target, 'settled', 'layout', 'settled']);
  });
  it('restores the original native state when Escape cancels entry during resize', async () => {
    const commit = vi.fn(); const changeFullscreen = vi.fn(async () => {});
    expect(await switchImmersiveLayout({target:true, previousFullscreen:false, changeFullscreen,
      settle: async () => {}, stillWanted: () => false, commit})).toBe(false);
    expect(changeFullscreen.mock.calls).toEqual([[true], [false]]);
    expect(commit).not.toHaveBeenCalled();
  });
  it('keeps an existing fullscreen session on immersive exit', async () => {
    const changeFullscreen = vi.fn(async () => {});
    await switchImmersiveLayout({ target:false, previousFullscreen:true, changeFullscreen,
      settle: async () => {}, stillWanted: () => true, commit: () => {} });
    expect(changeFullscreen).toHaveBeenCalledWith(true);
  });
  it('does not commit an obsolete exit after the user asks to reenter', async () => {
    const commit = vi.fn();
    await switchImmersiveLayout({ target:false, previousFullscreen:false,
      changeFullscreen: async () => {}, settle: async () => {}, stillWanted: () => false, commit });
    expect(commit).not.toHaveBeenCalled();
  });
  it('subscribes before requesting fullscreen and waits for confirmation', async () => {
    let entered: (() => void) | undefined;
    const remove = vi.fn(); const events: string[] = [];
    const pending = changeNativeFullscreen(true, {
      isFullscreen: async () => false,
      onEnterFullscreen: (cb) => { events.push('subscribe'); entered=cb; return remove; },
      onLeaveFullscreen: () => () => {}, exitFullscreen: () => {},
      enterFullscreen: () => { events.push('request'); }
    });
    await Promise.resolve();
    expect(events).toEqual(['subscribe', 'request']);
    expect(remove).not.toHaveBeenCalled();
    entered!(); await pending; expect(remove).toHaveBeenCalledOnce();
  });
  it('resets the settling interval on resize and removes its listener', async () => {
    vi.useFakeTimers(); let resize: (() => void) | undefined;
    const remove = vi.fn(); const done = vi.fn();
    vi.stubGlobal('window', { addEventListener: (_: string, cb: () => void) => { resize=cb; }, removeEventListener: remove });
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 1; });
    const pending=waitForViewportStable().then(done);
    await vi.advanceTimersByTimeAsync(50); resize!();
    await vi.advanceTimersByTimeAsync(50); expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10); await pending;
    expect(remove).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
