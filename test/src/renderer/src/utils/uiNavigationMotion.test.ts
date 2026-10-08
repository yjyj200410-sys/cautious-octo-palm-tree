import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberFolderReturn, takeFolderReturn } from '../../../../../src/renderer/src/utils/folderReturn';
import { immersiveOffset } from '../../../../../src/renderer/src/utils/playerViewTransition';
import { motionDuration } from '../../../../../src/renderer/src/utils/motionPreference';

afterEach(() => { vi.unstubAllGlobals(); takeFolderReturn(); });

describe('UI navigation and motion', () => {
  it('consumes the manager origin once, including search state', () => {
    expect(takeFolderReturn()).toBeUndefined();
    rememberFolderReturn({ href: '/main-player/home?sort=title', settingsOpen: true });
    expect(takeFolderReturn()).toEqual({ href: '/main-player/home?sort=title', settingsOpen: true });
    expect(takeFolderReturn()).toBeUndefined();
  });
  it('replaces an obsolete folder return destination', () => {
    rememberFolderReturn({ href: '/old', settingsOpen: false });
    rememberFolderReturn({ href: '/new', settingsOpen: true });
    expect(takeFolderReturn()?.href).toBe('/new');
  });
  it('reverses from the presentation position, including repeated interruptions', () => {
    expect(immersiveOffset('immersive-content-in', .25)).toBe(.75);
    expect(immersiveOffset('immersive-content-out', 0, .75)).toBe(.75);
    expect(immersiveOffset('immersive-content-out', .5, .75)).toBe(.875);
    expect(immersiveOffset('immersive-content-in', .5, .875)).toBe(.4375);
    expect(immersiveOffset('immersive-content-in', 1, .875)).toBe(0);
  });
  it.each([[false, false, 200], [true, false, 0], [false, true, 0]])('honors system=%s and app=%s reduced motion', (system, app, duration) => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: system }) });
    vi.stubGlobal('document', { querySelector: () => app ? {} : null });
    expect(motionDuration(200)).toBe(duration);
  });
});
