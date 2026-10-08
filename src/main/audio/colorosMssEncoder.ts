import { MSS_BATCH, MSS_HISTORY, MSS_SAMPLE_RATE } from '../../common/colorosMss';
import type { MssResult } from '../../common/colorosMss';

export function createMssWaveHeader(frames: number) {
  const size = frames * 16;
  if (!Number.isSafeInteger(frames) || frames < 0 || size > 0xffffffff - 36)
    throw new Error('Invalid MSS cache size');
  const header = Buffer.alloc(44);
  header.write('RIFF');
  header.writeUInt32LE(size + 36, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20);
  header.writeUInt16LE(4, 22);
  header.writeUInt32LE(MSS_SAMPLE_RATE, 24);
  header.writeUInt32LE(MSS_SAMPLE_RATE * 16, 28);
  header.writeUInt16LE(16, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(size, 40);
  return header;
}

// Model vocals trail input by 1536 samples. Write matching dry/vocal samples,
// trimming startup history and the zero-padded final model flush.
export function interleaveMssCache(
  history: Buffer,
  block: Buffer,
  result: MssResult,
  decodedFrames: number
) {
  const first = Math.max(result.validOffset, -result.start);
  const end = Math.min(MSS_BATCH, decodedFrames - result.start);
  if (end <= first) return Buffer.alloc(0);
  const dry = Buffer.concat([history, block]);
  const bytes = Buffer.allocUnsafe((end - first) * 16);
  for (let n = first; n < end; n++) {
    const at = (n - first) * 16;
    bytes.writeFloatLE(dry.readFloatLE(n * 8), at);
    bytes.writeFloatLE(dry.readFloatLE(n * 8 + 4), at + 4);
    bytes.writeFloatLE(result.vocals[n], at + 8);
    bytes.writeFloatLE(result.vocals[MSS_BATCH + n], at + 12);
  }
  return { bytes, history: block.subarray((MSS_BATCH - MSS_HISTORY) * 8) };
}
