/**
 * LoopDetector — public API for finding a natural seamless loop in a recorded wallpaper video and
 * cropping it into an infinite-loop clip.
 *
 * Insertion point (see `backgroundManager.saveRecordedBackground`):
 *
 * 录制完成 → detectLoop(videoPath) → [找到 best Start/End] → createLoopVideo() → H.264 CFR yuv420p MP4 →
 * 继续现有 Apply 流程
 *
 * On ANY failure (unreadable video, static content, no reliable loop, encode error)
 * `maybeMakeLoopVideo` returns `kind: 'original'` and the caller keeps the untouched recording —
 * the existing recording/apply flow never breaks.
 */
import { existsSync, statSync } from 'fs';

import logger from '../../logger';
import { probeVideo, extractFrameHashes, cropLoopVideo } from './ffmpeg';
import { searchLoop, type LoopCandidate } from './loopSearch';

export interface LoopResult {
  /** Loop start in seconds (source timeline). */
  startTime: number;
  /** Loop end in seconds (exclusive — the seam restart point). */
  endTime: number;
  /** Loop duration in seconds. */
  duration: number;
  /** 0..1 seam quality (1 = perfectly seamless). */
  score: number;
  /** 0..1 visual continuity at the seam. */
  visualScore?: number;
  /** 0..1 motion continuity at the seam. */
  motionScore?: number;
  /** 0..1 overall confidence. */
  confidence?: number;
  /** Measured frame rate of the source timeline (0 when unknown) — used to crop at the source rate. */
  fps?: number;
}

export interface LoopDetectorOptions {
  /** Minimum loop duration in seconds (default 3). */
  minimumLoopDuration?: number;
  /** Maximum loop duration in seconds (default: the whole video). */
  maximumLoopDuration?: number;
  /** Low-res analysis width (default 128). */
  analysisWidth?: number;
  /** Low-res analysis height (default 72). */
  analysisHeight?: number;
  /** Search step in frames (default 2). */
  searchStep?: number;
  /** Seam-verification window in frames (default 10). */
  boundaryWindow?: number;
  /** Max mean boundary distance to accept a loop (default 0.28). */
  maxBoundaryDistance?: number;
  /** Score slack for preferring longer loops (default 0.05). */
  preferLongerTolerance?: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Analyze a recorded video and return the best natural loop, or null when no reliable loop exists
 * (falls back to the original video).
 *
 * Runs entirely in the main process (never the renderer) using low-res hashes, so a 4K recording
 * never gets fully decoded into the renderer's memory.
 */
export async function detectLoop(
  videoPath: string,
  options: LoopDetectorOptions = {}
): Promise<LoopResult | null> {
  const probe = await probeVideo(videoPath);
  if (!probe.durationSeconds || probe.durationSeconds < 1) {
    logger.warn('detectLoop: video too short / unprobeable, skipping', {
      videoPath,
      probe
    });
    return null;
  }
  const duration = probe.durationSeconds;

  // Analysis fps — cap the total frame count so the O(n²/step) search stays
  // bounded no matter how long the recording is.
  const analysisFps = Math.max(10, Math.min(30, Math.round(2400 / duration)));

  const hashes: Uint32Array[] = [];
  const count = await extractFrameHashes(videoPath, {
    width: options.analysisWidth ?? 128,
    height: options.analysisHeight ?? 72,
    fps: analysisFps,
    onFrame: (hash) => hashes.push(hash)
  });
  if (count < 45) {
    logger.warn('detectLoop: too few frames for analysis', { videoPath, count });
    return null;
  }

  // The fps filter produces (slightly fewer than) `analysisFps` frames/second;
  // use the measured rate so frame↔time mapping stays exact on this timeline.
  const effectiveFps = count / duration;
  const minFrames = Math.max(1, Math.round((options.minimumLoopDuration ?? 3) * effectiveFps));
  const maxFrames = Math.round(
    Math.min(options.maximumLoopDuration ?? duration, duration) * effectiveFps
  );

  const candidate: LoopCandidate | null = searchLoop(hashes, {
    fps: effectiveFps,
    minFrames,
    maxFrames,
    searchStep: options.searchStep,
    boundaryWindow: options.boundaryWindow,
    maxBoundaryDistance: options.maxBoundaryDistance,
    preferLongerTolerance: options.preferLongerTolerance
  });
  if (!candidate) return null;

  const result: LoopResult = {
    startTime: r3(candidate.startTime),
    endTime: r3(candidate.endTime),
    duration: r3(candidate.duration),
    score: r3(candidate.score),
    visualScore: r3(candidate.visualScore),
    motionScore: r3(candidate.motionScore),
    confidence: r3(candidate.confidence),
    // Measured rate — the source header often omits fps (MediaRecorder WebM), so the crop can
    // still be emitted at the timeline's real rate rather than assuming a default.
    fps: r3(effectiveFps)
  };
  logger.info('detectLoop: loop found', {
    videoPath,
    result,
    frames: count,
    effectiveFps
  });
  return result;
}

/**
 * Crop the loop interval out of `inputPath` into an H.264 CFR yuv420p MP4 at `outputPath`.
 * Re-encodes (not stream-copy) so the cut lands on the exact frames the detector chose. Throws on
 * failure.
 */
export async function createLoopVideo(
  inputPath: string,
  loop: LoopResult,
  outputPath: string
): Promise<void> {
  const probe = await probeVideo(inputPath);
  // Prefer the source header's fps; fall back to the measured analysis fps, then 30.
  const fps =
    probe.fps > 0 && probe.fps <= 120
      ? probe.fps
      : loop.fps && loop.fps > 0 && loop.fps <= 120
        ? loop.fps
        : 30;
  await cropLoopVideo(inputPath, outputPath, {
    startTime: loop.startTime,
    duration: loop.duration,
    fps
  });
}

export type LoopOutcome =
  | { kind: 'loop'; loop: LoopResult; videoPath: string }
  | { kind: 'original'; loop: null; videoPath: string };

/**
 * Convenience: detect + crop in one call with full failure fallback.
 *
 * - Success: returns the cropped `.mp4` path (kind 'loop')
 * - Any failure / no reliable loop: returns the original path (kind 'original')
 *
 * The output file always has `outputBase` as its stem and `.mp4` extension so the caller can pair
 * it with its cover thumbnail (`<stem>_cover.jpg`).
 */
export async function maybeMakeLoopVideo(
  inputPath: string,
  outputBase: string,
  options: LoopDetectorOptions = {}
): Promise<LoopOutcome> {
  try {
    const loop = await detectLoop(inputPath, options);
    if (!loop) {
      logger.info('maybeMakeLoopVideo: no reliable loop, keeping original', {
        inputPath
      });
      return { kind: 'original', loop: null, videoPath: inputPath };
    }

    const outputPath = `${outputBase}.mp4`;
    await createLoopVideo(inputPath, loop, outputPath);
    if (!existsSync(outputPath) || getFileSize(outputPath) <= 0) {
      throw new Error('crop produced an empty file');
    }
    logger.info('maybeMakeLoopVideo: loop cropped', {
      inputPath,
      outputPath,
      loop
    });
    return { kind: 'loop', loop, videoPath: outputPath };
  } catch (err) {
    logger.warn('maybeMakeLoopVideo: failed, keeping original', {
      inputPath,
      err: err instanceof Error ? err.message : String(err)
    });
    return { kind: 'original', loop: null, videoPath: inputPath };
  }
}

function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}
