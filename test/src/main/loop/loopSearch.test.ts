import { describe, test, expect } from 'vitest';

import { searchLoop } from '../../../../src/main/core/loop/loopSearch';
import { normalizedDistance } from '../../../../src/main/core/loop/pHash';

// ---------------------------------------------------------------------------
// Synthetic pHash helpers — control frame-to-frame distance exactly so the
// search logic is tested in isolation (no ffmpeg needed).
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomHash(seed: number): Uint32Array {
  const r = rng(seed);
  const h = new Uint32Array(8);
  for (let i = 0; i < 8; i++) h[i] = (r() * 0xffffffff) >>> 0;
  return h;
}

/** Copy of `base` with exactly `frac*256` bits flipped (controlled distance). */
function atDistance(base: Uint32Array, frac: number, seed: number): Uint32Array {
  const out = base.slice();
  const bits = Math.max(0, Math.min(256, Math.round(frac * 256)));
  const r = rng(seed);
  const flipped = new Set<number>();
  while (flipped.size < bits) {
    flipped.add(Math.floor(r() * 256));
  }
  for (const bit of flipped) out[bit >> 5] ^= 1 << (bit & 31);
  return out;
}

/** A periodic "video": frame i = phase[i % period]. */
function periodicVideo(period: number, length: number): Uint32Array[] {
  const phase: Uint32Array[] = [];
  for (let j = 0; j < period; j++) phase.push(randomHash(1000 + j));
  const hashes: Uint32Array[] = [];
  for (let i = 0; i < length; i++) hashes.push(phase[i % period]);
  return hashes;
}

const BASE_CONFIG = {
  fps: 30,
  minFrames: 90, // 3s @ 30fps
  maxFrames: 500
};

describe('searchLoop — periodic video finds its natural period', () => {
  test('period 120 → picks the longest whole-period loop', () => {
    const hashes = periodicVideo(120, 500);
    const loop = searchLoop(hashes, BASE_CONFIG);

    expect(loop).not.toBeNull();
    expect(loop!.length).toBeGreaterThanOrEqual(90);
    // Every multiple of 120 is seamless; the longest one wins (start may be
    // anywhere inside a periodic clip — any alignment is equally seamless).
    expect(loop!.length % 120).toBe(0);
    expect(loop!.length).toBe(480);
    expect(loop!.startFrame + loop!.length + 10).toBeLessThanOrEqual(500);
    expect(loop!.boundaryDistance).toBeLessThan(1e-6);
  });

  test('period 60 → respects minimum length (no 2s loop accepted)', () => {
    const hashes = periodicVideo(60, 500);
    const loop = searchLoop(hashes, BASE_CONFIG);
    expect(loop).not.toBeNull();
    // 60 frames = 2s < min 3s, so the shortest accepted period is 120.
    expect(loop!.length % 60).toBe(0);
    expect(loop!.length).toBeGreaterThanOrEqual(90);
  });

  test('too short to fit min length + window → null', () => {
    const hashes = periodicVideo(30, 95); // 95 frames ≈ 3.2s
    const loop = searchLoop(hashes, { ...BASE_CONFIG, minFrames: 90 });
    expect(loop).toBeNull();
  });
});

describe('searchLoop — anti-static guard', () => {
  test('frozen video → null', () => {
    const base = randomHash(7);
    const hashes = Array.from({ length: 300 }, () => base);
    expect(searchLoop(hashes, BASE_CONFIG)).toBeNull();
  });
});

describe('searchLoop — rejects "same pose, wrong motion" single-frame matches', () => {
  test('first≈last but neighborhood does not match → null', () => {
    const n = 240;
    const hashes: Uint32Array[] = [];
    // Frames 0..119 drift randomly away from base.
    for (let i = 0; i < 120; i++) hashes.push(randomHash(200 + i));
    // Frame 120 exactly matches frame 0 — a single-frame seam match.
    hashes.push(hashes[0].slice());
    // Frames 121..239 are unrelated (motion does NOT continue).
    for (let i = 121; i < n; i++) hashes.push(randomHash(2000 + i));

    const loop = searchLoop(hashes, BASE_CONFIG);
    // A naive first-frame vs Nth-frame comparison would claim a loop here;
    // the boundary-window check must reject it.
    expect(loop).toBeNull();
  });

  test('a genuinely periodic signal still passes (control)', () => {
    const hashes = periodicVideo(120, 500);
    expect(searchLoop(hashes, BASE_CONFIG)).not.toBeNull();
  });
});

describe('searchLoop — confidence / scores are in range', () => {
  test('periodic candidate has near-perfect scores', () => {
    const hashes = periodicVideo(120, 500);
    const loop = searchLoop(hashes, BASE_CONFIG);
    expect(loop).not.toBeNull();
    expect(loop!.score).toBeGreaterThan(0.99);
    expect(loop!.confidence).toBeGreaterThan(0.9);
    expect(loop!.innerVariation).toBeGreaterThan(0.3); // not static
  });

  test('normalizedDistance is symmetric and bounded', () => {
    const a = randomHash(5);
    const b = atDistance(a, 0.25, 6);
    expect(normalizedDistance(a, b)).toBeCloseTo(0.25, 1);
    expect(normalizedDistance(a, a)).toBe(0);
  });
});
