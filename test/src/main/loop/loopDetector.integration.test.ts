/**
 * Integration tests for the loop detector against real ffmpeg-generated scene videos: camera pan,
 * particles, light pulse, relative-static, periodic motion, plus a non-loopable drift control (must
 * fall back to the original), over 10/20/30/60s recordings. Only ffmpeg filters that evaluate `t`
 * per frame are used (`overlay` x/y and `crop` x); `drawbox`/`eq` cache geometry at init in this
 * build.
 *
 * Run with: LOOP_IT=1 npx vitest run test/src/main/loop/loopDetector.integration.test.ts
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, test, expect, beforeAll, afterAll } from 'vitest';

import {
  getFfmpegPath,
  probeVideo,
  extractFrameHashes
} from '../../../../src/main/core/loop/ffmpeg';
import {
  detectLoop,
  createLoopVideo,
  type LoopResult
} from '../../../../src/main/core/loop/loopDetector';
import { normalizedDistance } from '../../../../src/main/core/loop/pHash';

const RUN = !!process.env.LOOP_IT;
const W = 128;
const H = 72;
const FPS = 60;

// ---------------------------------------------------------------------------
// Video generation helpers (spawn the bundled ffmpeg)
// ---------------------------------------------------------------------------

function colorInput(color: string, w: number, h: number, seconds: number): string[] {
  return ['-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}:r=${FPS}:d=${seconds}`];
}

/** Encode a filter_complex graph into VP9 webm (finite inputs, CFR 60). */
function genFc(outPath: string, inputs: string[], fc: string, seconds: number): void {
  const args = [
    '-y',
    ...inputs,
    '-filter_complex',
    fc,
    '-map',
    '[out]',
    '-t',
    String(seconds),
    '-shortest',
    '-c:v',
    'libvpx-vp9',
    '-b:v',
    '2M',
    '-cpu-used',
    '4',
    outPath
  ];
  const res = spawnSync(getFfmpegPath(), args, { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`genFc failed: ${(res.stderr || '').slice(0, 800)}`);
  }
}

/** Static random-noise PNG — a textured, NON-periodic background to pan over. */
function genNoisePng(outPath: string, size: string): void {
  const res = spawnSync(
    getFfmpegPath(),
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `nullsrc=s=${size}`,
      '-vf',
      'geq=random(1)*255:128:128',
      '-frames:v',
      '1',
      outPath
    ],
    { encoding: 'utf8' }
  );
  if (res.status !== 0) {
    throw new Error(`genNoisePng failed: ${(res.stderr || '').slice(0, 800)}`);
  }
}

interface Scene {
  name: string;
  seconds: number;
  expectLoop: boolean;
  gen: (dir: string) => string;
}

const SCENES: Scene[] = [
  {
    // Camera pan: a wide band sweeps right and wraps every 6.4s.
    name: 'camera-pan',
    seconds: 13,
    expectLoop: true,
    gen: (dir) => {
      const p = join(dir, 'camera-pan.webm');
      genFc(
        p,
        [...colorInput('0x88ccff', 200, 90, 13), ...colorInput('0x202030', 640, 360, 13)],
        `[1:v][0:v]overlay=x='mod(100*t,640)':y=150,fps=${FPS}[out]`,
        13
      );
      return p;
    }
  },
  {
    // Particles: three bright dots orbit, whole frame repeats every 5s.
    name: 'particles',
    seconds: 13,
    expectLoop: true,
    gen: (dir) => {
      const p = join(dir, 'particles.webm');
      genFc(
        p,
        [
          ...colorInput('0xffffff', 18, 18, 13),
          ...colorInput('0xffffff', 14, 14, 13),
          ...colorInput('0xffffff', 24, 24, 13),
          ...colorInput('0x202030', 640, 360, 13)
        ],
        `[3:v][0:v]overlay=x='60+260*sin(2*PI*t/5)':y='180+100*cos(2*PI*t/5)'[o1];` +
          `[o1][1:v]overlay=x='400+160*sin(2*PI*t/5+1.2)':y='120+140*cos(2*PI*t/5+1.2)'[o2];` +
          `[o2][2:v]overlay=x='200+180*sin(2*PI*t/5+2.4)':y='260+80*cos(2*PI*t/5+2.4)',fps=${FPS}[out]`,
        13
      );
      return p;
    }
  },
  {
    // Light pulse: a soft translucent light band sweeps slowly → periodic
    // lighting change (period 8s). Kept slow & low-contrast so each frame
    // changes gently — a fast bright band would make every frame near-random.
    name: 'light-pulse',
    seconds: 13,
    expectLoop: true,
    gen: (dir) => {
      const p = join(dir, 'light-pulse.webm');
      genFc(
        p,
        [...colorInput('0xffffff', 300, 360, 13), ...colorInput('0x202030', 640, 360, 13)],
        `[1:v][0:v]overlay=x='mod(80*t,640)':y=0:alpha=0.25,fps=${FPS}[out]`,
        13
      );
      return p;
    }
  },
  {
    // Relative static: mostly frozen dark scene with one slow drifting element.
    name: 'relative-static',
    seconds: 13,
    expectLoop: true,
    gen: (dir) => {
      const p = join(dir, 'relative-static.webm');
      genFc(
        p,
        [...colorInput('0x99ddff', 40, 40, 13), ...colorInput('0x202030', 640, 360, 13)],
        `[1:v][0:v]overlay=x='220+120*sin(2*PI*t/4)':y='140+80*cos(2*PI*t/4)',fps=${FPS}[out]`,
        13
      );
      return p;
    }
  },
  {
    // Clear periodic motion: a single object orbiting, period 4s.
    name: 'periodic-motion',
    seconds: 13,
    expectLoop: true,
    gen: (dir) => {
      const p = join(dir, 'periodic-motion.webm');
      genFc(
        p,
        [...colorInput('0x66ff99', 60, 60, 13), ...colorInput('0x202030', 640, 360, 13)],
        `[1:v][0:v]overlay=x='220+150*sin(2*PI*t/4)':y='140+90*cos(2*PI*t/4)',fps=${FPS}[out]`,
        13
      );
      return p;
    }
  },
  {
    // Negative control: a crop window drifts continuously over static noise —
    // content shifts monotonically and never repeats within the clip → no loop.
    name: 'continuous-drift',
    seconds: 13,
    expectLoop: false,
    gen: (dir) => {
      const png = join(dir, 'noise_wide.png');
      genNoisePng(png, '1920x360');
      const p = join(dir, 'continuous-drift.webm');
      const res = spawnSync(
        getFfmpegPath(),
        [
          '-y',
          '-loop',
          '1',
          '-i',
          png,
          '-vf',
          `crop=640:360:x='20*t':y=0,fps=${FPS}`,
          '-t',
          '13',
          '-r',
          String(FPS),
          '-c:v',
          'libvpx-vp9',
          '-b:v',
          '2M',
          '-cpu-used',
          '4',
          p
        ],
        { encoding: 'utf8' }
      );
      if (res.status !== 0) {
        throw new Error(`genDrift failed: ${(res.stderr || '').slice(0, 800)}`);
      }
      return p;
    }
  }
];

const DURATIONS = [10, 20, 30, 60];

// ---------------------------------------------------------------------------
// Seam verification: measure how visually seamless the PRODUCED crop is.
// ---------------------------------------------------------------------------

async function measureSeam(
  videoPath: string
): Promise<{ jump: number; inner: number; frames: number }> {
  const probe = await probeVideo(videoPath);
  const analysisFps = Math.min(
    30,
    Math.max(10, Math.round(2400 / Math.max(probe.durationSeconds, 1)))
  );
  const hashes: Uint32Array[] = [];
  await extractFrameHashes(videoPath, {
    width: W,
    height: H,
    fps: analysisFps,
    onFrame: (h) => hashes.push(h)
  });
  if (hashes.length < 4) return { jump: 1, inner: 1, frames: hashes.length };
  const n = hashes.length;
  // jump = distance from the last frame to the first (the loop restart point).
  const jump = normalizedDistance(hashes[n - 1], hashes[0]);
  // inner = average inter-frame distance inside the clip.
  let sum = 0;
  for (let i = 0; i < n - 1; i++) sum += normalizedDistance(hashes[i], hashes[i + 1]);
  return { jump, inner: sum / (n - 1), frames: n };
}

let workDir = '';

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'lumina-loop-it-'));
});

afterAll(() => {
  if (workDir && process.env.LOOP_IT_KEEP !== '1')
    rmSync(workDir, { recursive: true, force: true });
});

describe.skipIf(!RUN)('LoopDetector — real ffmpeg integration', () => {
  for (const scene of SCENES) {
    test(`${scene.name} — ${scene.expectLoop ? 'finds a loop & crops seamless clip' : 'falls back (no loop)'}`, async () => {
      const inPath = scene.gen(workDir);

      const loop = await detectLoop(inPath);

      if (!scene.expectLoop) {
        expect(loop).toBeNull();
        return;
      }

      expect(loop).not.toBeNull();
      const l = loop as LoopResult;
      expect(l.duration).toBeGreaterThanOrEqual(3);
      expect(l.duration).toBeLessThanOrEqual(scene.seconds + 0.5);
      expect(l.startTime).toBeGreaterThanOrEqual(0);
      expect(l.endTime).toBeLessThanOrEqual(scene.seconds + 0.5);
      expect(l.score).toBeGreaterThan(0.6);

      // Crop and verify the seam.
      const outPath = join(workDir, `${scene.name}_loop.mp4`);
      await createLoopVideo(inPath, l, outPath);
      expect(existsSync(outPath)).toBe(true);

      const probe = await probeVideo(outPath);
      expect(probe.durationSeconds).toBeGreaterThan(l.duration - 0.3);
      expect(probe.durationSeconds).toBeLessThan(l.duration + 0.3);
      expect(probe.width).toBeGreaterThan(0);
      expect(probe.fps).toBeGreaterThan(0);

      const seam = await measureSeam(outPath);
      // The seam jump should be small and comparable to the inner motion —
      // no sudden jump, no black frame, no flash at the loop point.
      expect(seam.jump).toBeLessThan(0.3);
      expect(seam.jump).toBeLessThan(seam.inner + 0.15);

      // eslint-disable-next-line no-console
      console.log(
        `[loop-it] ${scene.name}: loop=`,
        {
          startTime: l.startTime,
          endTime: l.endTime,
          duration: l.duration,
          score: l.score,
          confidence: l.confidence
        },
        'cropSeam=',
        { jump: seam.jump.toFixed(3), inner: seam.inner.toFixed(3) }
      );
    }, 120000);
  }

  for (const dur of DURATIONS) {
    test(`duration ${dur}s — periodic motion still loops`, async () => {
      const inPath = join(workDir, `periodic-${dur}s.webm`);
      const period = 4;
      genFc(
        inPath,
        [...colorInput('0x66ff99', 60, 60, dur), ...colorInput('0x202030', 640, 360, dur)],
        `[1:v][0:v]overlay=x='220+150*sin(2*PI*t/${period})':y='140+90*cos(2*PI*t/${period})',fps=${FPS}[out]`,
        dur
      );

      const loop = await detectLoop(inPath);
      expect(loop).not.toBeNull();
      const l = loop as LoopResult;
      expect(l.duration).toBeGreaterThanOrEqual(3);
      expect(l.duration).toBeLessThanOrEqual(dur + 0.5);
      // For a pure 4s-period signal the loop should be ~ an integer number of periods.
      expect(Math.abs(l.duration / period - Math.round(l.duration / period))).toBeLessThan(0.2);

      const outPath = join(workDir, `periodic-${dur}s_loop.mp4`);
      await createLoopVideo(inPath, l, outPath);
      const seam = await measureSeam(outPath);
      expect(seam.jump).toBeLessThan(0.3);

      // eslint-disable-next-line no-console
      console.log(
        `[loop-it] duration ${dur}s: loop duration=${l.duration.toFixed(2)}s score=${l.score.toFixed(3)} seamJump=${seam.jump.toFixed(3)}`
      );
    }, 180000);
  }
});
