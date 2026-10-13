import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const result = spawnSync(ffmpeg, ['-version'], {
  encoding: 'utf8',
  windowsHide: true,
  timeout: 10000
});
if (result.error || result.status !== 0) {
  throw new Error(
    `FFmpeg is missing or incomplete. Reinstall its binary before building: ${result.error?.message || result.stderr}`
  );
}
const expected = /MSS_MODEL_SHA256\s*=\s*'([a-f0-9]{64})'/.exec(
  readFileSync('src/common/colorosMss.ts', 'utf8')
)?.[1];
const model = readFileSync('resources/coloros-mss/model.onnx');
const actual = createHash('sha256').update(model).digest('hex');
if (!expected || actual !== expected)
  throw new Error('Source separation model checksum does not match.');
console.log(
  `Runtime verified: ${result.stdout.split('\n')[0].trim()}; MSS model ${model.length} bytes, SHA-256 verified.`
);
