/**
 * Loop search & scoring — a TypeScript port of Loopifi's candidate-search design
 * (`loopifi/loops/__init__.py::search_for_loops` / `compare_candidates`).
 *
 * Where Loopifi compares a SINGLE start-frame hash against candidate hashes, this implementation
 * goes one step further (as required by the Lumina spec): every candidate's seam is verified over a
 * whole boundary WINDOW of frames (`hash[s+L+t]` vs `hash[s+t]`), so a "same pose but opposite
 * motion" false positive — first frame ≈ last frame yet not a real loop — is rejected.
 *
 * Anti-trivial guard: a truly static video (global inter-frame variation below
 * `staticDistanceFloor`) yields no candidate at all — there is nothing to loop, and the caller
 * keeps the original recording.
 *
 * Ranking: lowest boundary distance first; among candidates within a small score tolerance we
 * prefer the LONGEST seamless loop (a wallpaper loop should be as rich as possible without
 * sacrificing seam quality).
 */

import { HASH_WORDS, normalizedDistance } from './pHash';

export interface SearchConfig {
  /** Effective frame rate of the hash sequence. */
  fps: number;
  /** Minimum loop length in frames (default ~3s worth). */
  minFrames: number;
  /** Maximum loop length in frames (default = fits the video). */
  maxFrames: number;
  /** Loop-length granularity in frames (default 2). */
  searchStep?: number;
  /** Number of frames used to verify seam continuity (default 10). */
  boundaryWindow?: number;
  /** Reject candidates whose mean boundary distance exceeds this (default 0.28). */
  maxBoundaryDistance?: number;
  /** Score slack (normalized distance) for preferring longer loops (default 0.05). */
  preferLongerTolerance?: number;
  /** Global inter-frame variation below this means the video is static (default 0.004). */
  staticDistanceFloor?: number;
}

export interface LoopCandidate {
  /** First frame of the loop (inclusive). */
  startFrame: number;
  /** First frame AFTER the loop (exclusive) — the seam restart point. */
  endFrame: number;
  /** Loop length in frames. */
  length: number;
  /** Seconds, on the analysis timeline. */
  startTime: number;
  endTime: number;
  duration: number;
  /** 0..1 seam quality — higher is better (1 = perfectly seamless). */
  score: number;
  /** 0..1, same as score (visual continuity at the seam). */
  visualScore: number;
  /** 0..1 motion continuity at the seam (jump-consistency). */
  motionScore: number;
  /** Mean normalized inter-frame distance INSIDE the loop. */
  innerVariation: number;
  /** Mean normalized distance across the boundary window. */
  boundaryDistance: number;
  /** Overall 0..1 confidence. */
  confidence: number;
}

const DEFAULT_SEARCH_STEP = 2;
const DEFAULT_BOUNDARY_WINDOW = 10;
const DEFAULT_MAX_BOUNDARY_DISTANCE = 0.28;
const DEFAULT_PREFER_LONGER_TOLERANCE = 0.05;
const DEFAULT_STATIC_DISTANCE_FLOOR = 0.004;

/** Mean normalized distance between consecutive frames over [start, end). */
function meanConsecutiveDistance(hashes: Uint32Array[], start: number, end: number): number {
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) {
    sum += normalizedDistance(hashes[i], hashes[i + 1]);
  }
  return sum / (end - start);
}

/** Mean normalized distance across the seam window for candidate (s, L). */
function boundaryDistance(hashes: Uint32Array[], s: number, L: number, window: number): number {
  let sum = 0;
  for (let t = 0; t < window; t++) {
    sum += normalizedDistance(hashes[s + L + t], hashes[s + t]);
  }
  return sum / window;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Search `hashes` for the best seamless loop. Returns null when no reliable loop exists (static
 * video, too short, nothing below the distance threshold).
 */
export function searchLoop(hashes: Uint32Array[], config: SearchConfig): LoopCandidate | null {
  const n = hashes.length;
  if (n < 2) return null;

  const searchStep = config.searchStep ?? DEFAULT_SEARCH_STEP;
  const window = config.boundaryWindow ?? DEFAULT_BOUNDARY_WINDOW;
  const maxBD = config.maxBoundaryDistance ?? DEFAULT_MAX_BOUNDARY_DISTANCE;
  const tolerance = config.preferLongerTolerance ?? DEFAULT_PREFER_LONGER_TOLERANCE;
  const staticFloor = config.staticDistanceFloor ?? DEFAULT_STATIC_DISTANCE_FLOOR;

  // Anti-static guard: a frozen video has no meaningful loop to crop.
  if (meanConsecutiveDistance(hashes, 0, n - 1) < staticFloor) {
    return null;
  }

  const minFrames = Math.max(1, Math.round(config.minFrames));
  const maxFrames = Math.max(minFrames, Math.round(config.maxFrames));
  const lastStart = n - minFrames - window;

  // Pass 1 — find the minimum boundary distance over all (s, L) candidates.
  let minBD = Infinity;
  for (let s = 0; s <= lastStart; s++) {
    const maxLen = Math.min(maxFrames, n - s - window);
    for (let L = minFrames; L <= maxLen; L += searchStep) {
      const bd = boundaryDistance(hashes, s, L, window);
      if (bd < minBD) minBD = bd;
    }
  }
  if (minBD > maxBD) return null;

  // Pass 2 — among candidates within tolerance of the best, keep the longest.
  const bound = minBD + tolerance;
  let best: LoopCandidate | null = null;
  for (let s = 0; s <= lastStart; s++) {
    const maxLen = Math.min(maxFrames, n - s - window);
    for (let L = minFrames; L <= maxLen; L += searchStep) {
      const bd = boundaryDistance(hashes, s, L, window);
      if (bd > bound) continue;

      const innerVar = meanConsecutiveDistance(hashes, s, s + L - 1);
      const seamDelta = normalizedDistance(hashes[s + L - 1], hashes[s]);
      const motionScore =
        1 - clamp(Math.abs(seamDelta - innerVar) / Math.max(innerVar, 0.02), 0, 1);
      const visualScore = 1 - bd;
      const confidence = clamp(0.6 * visualScore + 0.4 * motionScore, 0, 1);

      const candidate: LoopCandidate = {
        startFrame: s,
        endFrame: s + L,
        length: L,
        startTime: s / config.fps,
        endTime: (s + L) / config.fps,
        duration: L / config.fps,
        score: visualScore,
        visualScore,
        motionScore,
        innerVariation: innerVar,
        boundaryDistance: bd,
        confidence
      };

      if (
        !best ||
        candidate.length > best.length ||
        (candidate.length === best.length && candidate.motionScore > best.motionScore)
      ) {
        best = candidate;
      }
    }
  }

  return best;
}

export { HASH_WORDS };
