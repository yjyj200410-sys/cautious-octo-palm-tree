import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBackgroundSource } from '../../../../../src/renderer/src/utils/backgroundSource';

afterEach(() => vi.unstubAllGlobals());

describe('background source selection', () => {
  it('honors the explicit three-way choice over old settings', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ mode: 'gradient' }) });
    expect(resolveBackgroundSource({ backgroundSource: 'cover', showCoverBackground: false })).toBe('cover');
    expect(resolveBackgroundSource({ backgroundSource: 'custom' })).toBe('custom');
    expect(resolveBackgroundSource({ backgroundSource: 'color' })).toBe('color');
  });

  it('maps old color and mask modes without layering them', () => {
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ mode: 'solid' }) });
    expect(resolveBackgroundSource({ showCoverBackground: true })).toBe('color');
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ mode: 'mask' }) });
    expect(resolveBackgroundSource({ showCoverBackground: true })).toBe('custom');
  });

  it('falls back to the former wallpaper-versus-cover selection', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    expect(resolveBackgroundSource({ showCoverBackground: false })).toBe('custom');
    expect(resolveBackgroundSource({ showCoverBackground: true })).toBe('cover');
  });
});
