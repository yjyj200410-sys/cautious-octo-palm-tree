/**
 * Minimal FFmpeg wrapper for loop detection & cropping.
 *
 * Lumina ships no video tooling today, so `ffmpeg-static` (bundled binary via electron-builder
 * `asarUnpack`, mirrored from the existing `sharp` handling) is the single FFmpeg used both for
 * low-res frame extraction and for the final H.264 crop. No second FFmpeg is introduced.
 *
 * Frame extraction streams raw rgb24 straight out of `pipe:1` and hashes one frame at a time, so
 * the 4K source never gets fully buffered in memory.
 */
import { spawn } from 'child_process';

import ffmpegStaticPath from 'ffmpeg-static';

import logger from '../../logger';
import { phashFromGray, rgbToGrayThumb } from './pHash';

let cachedFfmpegPath: string | null = null;

/** Resolve the bundled ffmpeg binary path (asar-unpack aware). */
export function getFfmpegPath(): string {
  if (cachedFfmpegPath) return cachedFfmpegPath;
  const raw = ffmpegStaticPath;
  if (!raw) {
    throw new Error('ffmpeg-static resolved to no binary path');
  }
  // In the packaged app the binary lives under app.asar.unpacked (electron-builder
  // `asarUnpack`); the module returns an app.asar path which cannot be spawned.
  cachedFfmpegPath = raw.replace('app.asar', 'app.asar.unpacked');
  return cachedFfmpegPath;
}

export interface VideoProbe {
  /** Duration in seconds, 0 when unknown. */
  durationSeconds: number;
  /** Nominal frame rate reported by ffmpeg (0 when unknown). */
  fps: number;
  width: number;
  height: number;
}

const TIME_RE = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/;
const FPS_RE = /,\s*(\d+(?:\.\d+)?)\s*fps\b/;
// The stream line is e.g. "Video: vp9 (Profile 0), yuv420p(tv, progressive), 640x360, ..." —
// match the first WxH anywhere after "Video:" (codec string may carry extra fields).
const SIZE_RE = /Video:[^\r\n]*?(\d{2,5})x(\d{2,5})/;
// ffmpeg `-progress pipe:2` emits `out_time_us=<µs>` — the LAST one equals the stream duration
// even for containers whose header reports `Duration: N/A`.
const OUT_TIME_US_RE = /out_time_us=(\d+)/;

/**
 * Probe a video by parsing `ffmpeg -i` stderr (ffprobe is not bundled). Returns an all-zero probe
 * on failure so callers can decide to skip.
 *
 * Chrome's MediaRecorder writes WebM with NO Duration element and no nominal fps (`ffmpeg -i`
 * reports `Duration: N/A`, stream shows `1k tbr` and no `fps`). When the header can't provide a
 * duration we fall back to a container scan (demux-copy to `-f null`, no decode) so real recordings
 * are not silently skipped; the frame rate is then measured from the actual decode in
 * `detectLoop`.
 */
export async function probeVideo(videoPath: string): Promise<VideoProbe> {
  const probe: VideoProbe = { durationSeconds: 0, fps: 0, width: 0, height: 0 };
  try {
    // NOTE: no `-v error` here — the Duration/Stream info lines are emitted at
    // the default (info) level and are what this parser reads.
    const stderr = await runFfmpeg(['-i', videoPath], {
      allowNonZero: true
    });
    const time = stderr.match(TIME_RE);
    if (time) {
      probe.durationSeconds = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
    }
    const fps = stderr.match(FPS_RE);
    if (fps) probe.fps = Number(fps[1]);
    const size = stderr.match(SIZE_RE);
    if (size) {
      probe.width = Number(size[1]);
      probe.height = Number(size[2]);
    }

    if (!probe.durationSeconds || probe.durationSeconds < 1) {
      const scanned = await probeByScan(videoPath);
      if (scanned.durationSeconds > 0) probe.durationSeconds = scanned.durationSeconds;
      if (!probe.fps && scanned.fps > 0) probe.fps = scanned.fps;
    }
  } catch (err) {
    logger.warn('probeVideo failed', { videoPath, err: String(err) });
  }
  return probe;
}

/**
 * Measure the real duration (and frame rate) of a header-less video by scanning the container. `-c
 * copy -f null -progress pipe:2` demuxes without decoding (near-free even for 4K) and the last
 * `out_time_us=` in the progress output is the stream duration. If that fails, fall back to a full
 * decode scan which also yields a frame count for the measured fps.
 */
async function probeByScan(videoPath: string): Promise<{ durationSeconds: number; fps: number }> {
  const scan = async (copy: boolean) => {
    const args = [
      '-y',
      '-i',
      videoPath,
      '-map',
      '0:v:0',
      ...(copy ? ['-c', 'copy'] : []),
      '-f',
      'null',
      '-progress',
      'pipe:2',
      '-'
    ];
    const stderr = await runFfmpeg(args);
    const us = lastMatch(stderr, OUT_TIME_US_RE);
    const durationSeconds = us ? us / 1e6 : 0;
    let fps = 0;
    if (durationSeconds > 0 && !copy) {
      const frames = lastMatch(stderr, /^frame=\s*(\d+)/);
      if (frames) fps = frames / durationSeconds;
    }
    return { durationSeconds, fps };
  };

  // Demux-copy first (no decode); fall back to a full decode for the frame count.
  try {
    const fast = await scan(true);
    if (fast.durationSeconds > 0) return fast;
  } catch {
    // fall through to decode
  }
  try {
    return await scan(false);
  } catch {
    return { durationSeconds: 0, fps: 0 };
  }
}

/** Return the last numeric match of `re` in `text` (progress reports repeat the key). */
function lastMatch(text: string, re: RegExp): number | null {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let last: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) last = Number(m[1]);
  return last;
}

/** Per-frame hasher consumed by `extractFrameHashes`. */
export type FrameHashFn = (hash: Uint32Array) => void;

export interface ExtractOptions {
  width: number;
  height: number;
  fps: number;
  onFrame: FrameHashFn;
}

/**
 * Extract a pHash of every frame at a low resolution via a piped raw rgb24 stream. Resolves with
 * the number of frames produced (0 on failure — callers treat "no frames" as "cannot analyze → keep
 * original").
 */
export async function extractFrameHashes(videoPath: string, opts: ExtractOptions): Promise<number> {
  const frameSize = opts.width * opts.height * 3;
  let frameCount = 0;
  try {
    await runFfmpegStream(
      [
        '-v',
        'error',
        '-i',
        videoPath,
        '-vf',
        `scale=${opts.width}:${opts.height},fps=${opts.fps}`,
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        'pipe:1'
      ],
      (chunk) => {
        const gray = rgbToGrayThumb(chunk, opts.width, opts.height);
        opts.onFrame(phashFromGray(gray));
        frameCount++;
      },
      { binaryFrameSize: frameSize }
    );
  } catch (err) {
    logger.warn('extractFrameHashes failed', { videoPath, err: String(err) });
    return 0;
  }
  return frameCount;
}

export interface CropOptions {
  startTime: number;
  duration: number;
  fps: number;
}

/**
 * Crop a loop interval out of the source into an H.264 CFR yuv420p MP4 that Lumina's <video loop>
 * player plays natively. `-ss` is placed AFTER `-i` (decode-from-start) so the cut is
 * frame-accurate rather than keyframe-based. Throws on failure so the caller can fall back to the
 * original video.
 */
export async function cropLoopVideo(
  inputPath: string,
  outputPath: string,
  opts: CropOptions
): Promise<void> {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-ss',
    String(opts.startTime),
    '-t',
    String(opts.duration),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(opts.fps),
    '-movflags',
    '+faststart',
    outputPath
  ]);
}

// ---------------------------------------------------------------------------
// Low-level spawn helpers
// ---------------------------------------------------------------------------

interface RunOptions {
  /** Resolve instead of reject on non-zero exit (used for `ffmpeg -i`). */
  allowNonZero?: boolean;
}

/**
 * Run ffmpeg to completion, resolving with the captured (bounded) stderr text. ffmpeg writes
 * diagnostics to stderr, which is all callers need.
 */
function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-64 * 1024);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 || opts.allowNonZero) resolve(stderr);
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 2000)}`));
    });
  });
}

interface StreamOptions {
  /** Exact byte size of one binary frame; chunks are split on this boundary. */
  binaryFrameSize: number;
}

/**
 * Stream ffmpeg stdout, slicing it into fixed-size binary frames and invoking `onFrame` per
 * complete frame (a trailing partial frame is dropped). Rejects on non-zero exit.
 */
function runFfmpegStream(
  args: string[],
  onFrame: (chunk: Buffer, frameIndex: number) => void,
  opts: StreamOptions
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(getFfmpegPath(), args, { windowsHide: true });
    let pending: Buffer = Buffer.alloc(0);
    let stderr = '';
    let frameIndex = 0;

    child.stdout.on('data', (d: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, d]) : d;
      while (pending.length >= opts.binaryFrameSize) {
        onFrame(pending.subarray(0, opts.binaryFrameSize), frameIndex);
        frameIndex++;
        pending = pending.subarray(opts.binaryFrameSize);
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-32 * 1024);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 2000)}`));
    });
  });
}
