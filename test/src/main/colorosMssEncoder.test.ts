import { describe, expect, it } from 'vitest';

import { createMssWaveHeader, interleaveMssCache } from '../../../src/main/audio/colorosMssEncoder';

const block = (start: number) => {
  const bytes = Buffer.alloc(4096 * 8);
  for (let n = 0; n < 4096; n++) {
    bytes.writeFloatLE((start + n) / 10000, n * 8);
    bytes.writeFloatLE(-(start + n) / 10000, n * 8 + 4);
  }
  return bytes;
};
const result = (start: number, validOffset: number) => {
  const vocals = new Float32Array(8192);
  for (let n = 0; n < 4096; n++) {
    vocals[n] = (start + n) / 20000;
    vocals[4096 + n] = -(start + n) / 30000;
  }
  return { epoch: 0, start, validOffset, vocals, inferenceMs: 0 };
};
describe('full-track dry and vocal cache alignment', () => {
  it('writes a four-channel 48 kHz float WAV with exact duration', () => {
    const header = createMssWaveHeader(48000);
    expect(header.readUInt16LE(20)).toBe(3);
    expect(header.readUInt16LE(22)).toBe(4);
    expect(header.readUInt32LE(24)).toBe(48000);
    expect(header.readUInt32LE(40)).toBe(48000 * 16);
  });
  it('removes startup history while preserving matching stereo samples', () => {
    const encoded = interleaveMssCache(Buffer.alloc(1536 * 8), block(0), result(-1536, 1536), 4096);
    if (!('bytes' in encoded)) throw new Error('Expected cached frames');
    expect(encoded.bytes.length).toBe(2560 * 16);
    expect(encoded.bytes.readFloatLE(0)).toBe(0);
    expect(encoded.bytes.readFloatLE(100 * 16)).toBeCloseTo(0.01);
    expect(encoded.bytes.readFloatLE(100 * 16 + 8)).toBeCloseTo(0.005);
    expect(encoded.bytes.readFloatLE(100 * 16 + 12)).toBeCloseTo(-100 / 30000);
  });
  it('joins a block boundary and crops the padded EOF to decoded length', () => {
    const history = block(0).subarray((4096 - 1536) * 8);
    const encoded = interleaveMssCache(history, block(4096), result(2560, 0), 5000);
    if (!('bytes' in encoded)) throw new Error('Expected cached frames');
    expect(encoded.bytes.length).toBe((5000 - 2560) * 16);
    expect(encoded.bytes.readFloatLE(0)).toBeCloseTo(0.256);
    expect(encoded.bytes.readFloatLE(1536 * 16)).toBeCloseTo(0.4096);
    expect(encoded.bytes.readFloatLE(1536 * 16 + 8)).toBeCloseTo(0.2048);
    expect(encoded.bytes.readFloatLE((2440 - 1) * 16)).toBeCloseTo(0.4999);
  });
});
