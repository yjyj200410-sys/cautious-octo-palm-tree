import { describe, expect, it } from 'vitest';
import { getImmersiveRegion } from '../../../../../src/renderer/src/store/immersiveStore';

describe('immersive edge reveals', () => {
  it.each([[700, 500], [1280, 720], [1920, 1080]])('reveals only the controls under the pointer at %dx%d', (width, height) => {
    expect(getImmersiveRegion(20, 20, width, height)).toBe('top-left');
    expect(getImmersiveRegion(width / 2, 20, width, height)).toBe('top-center');
    expect(getImmersiveRegion(width - 20, 20, width, height)).toBe('top-right');
    expect(getImmersiveRegion(20, height - 20, width, height)).toBe('bottom-left');
    expect(getImmersiveRegion(width / 2, height - 100, width, height)).toBe('bottom-center');
    expect(getImmersiveRegion(width - 20, height - 100, width, height)).toBe('bottom-right');
    expect(getImmersiveRegion(width / 2, height / 2, width, height)).toBeNull();
    expect(getImmersiveRegion(width - 20, height / 2, width, height)).toBe('right-center');
    expect(getImmersiveRegion(width - 113, height / 2, width, height)).toBeNull();
  });

  it('clears the reveal when moving from the edge back to the lyrics', () => {
    expect(getImmersiveRegion(640, 70, 1280, 720)).toBe('top-center');
    expect(getImmersiveRegion(640, 200, 1280, 720)).toBeNull();
    expect(getImmersiveRegion(640, 610, 1280, 720)).toBe('bottom-center');
    expect(getImmersiveRegion(640, 550, 1280, 720)).toBeNull();
  });
});
