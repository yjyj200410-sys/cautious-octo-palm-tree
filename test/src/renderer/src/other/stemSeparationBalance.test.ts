import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StemSeparation } from '../../../../../src/renderer/src/other/stemSeparation';

describe('single vocal/backing balance', () => {
  let processor: StemSeparation;
  let enable: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    enable = vi.fn().mockResolvedValue(null);
    vi.stubGlobal('window', {
      api: {
        stemSeparation: {
          onCacheStatus: () => () => {},
          setEnabled: enable,
          setPlaying: vi.fn().mockResolvedValue(null)
        }
      }
    });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        port = { postMessage: vi.fn(), close: vi.fn() };
        connect = vi.fn();
        disconnect = vi.fn();
      }
    );
    processor = new StemSeparation({
      sampleRate: 48000,
      audioWorklet: { addModule: vi.fn().mockResolvedValue(null) }
    } as unknown as AudioContext);
    processor.attach(
      { connect: vi.fn(), disconnect: vi.fn() } as unknown as AudioNode,
      {} as AudioNode
    );
  });
  afterEach(() => {
    processor.destroy();
    vi.unstubAllGlobals();
  });
  it('maps left to only vocals, right to only backing, and center to dry bypass', async () => {
    processor.setBalance(-100);
    expect(processor.getSnapshot()).toMatchObject({ enabled: true, vocals: 100, accompaniment: 0 });
    await vi.waitFor(() => expect(processor.getSnapshot().loading).toBe(false));
    processor.setBalance(100);
    expect(processor.getSnapshot()).toMatchObject({ enabled: true, vocals: 0, accompaniment: 100 });
    processor.setBalance(0);
    expect(processor.getSnapshot()).toMatchObject({
      enabled: false,
      vocals: 100,
      accompaniment: 100
    });
    await vi.waitFor(() => expect(processor.getSnapshot().loading).toBe(false));
  });
  it('keeps one model initialization while dragging and preserves the latest blend', async () => {
    processor.setBalance(-1);
    processor.setBalance(-30);
    processor.setBalance(-70);
    expect(enable).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(processor.getSnapshot().loading).toBe(false));
    expect(processor.getSnapshot()).toMatchObject({
      enabled: true,
      vocals: 100,
      accompaniment: 30
    });
  });
  it('a quick return to center cancels a pending enable', async () => {
    processor.setBalance(-100);
    processor.setBalance(0);
    await vi.waitFor(() => expect(processor.getSnapshot().loading).toBe(false));
    expect(processor.getSnapshot()).toMatchObject({
      enabled: false,
      vocals: 100,
      accompaniment: 100
    });
  });
});
