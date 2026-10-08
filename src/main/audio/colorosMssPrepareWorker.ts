import { spawn } from 'node:child_process';
import { open, rename, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parentPort, workerData } from 'node:worker_threads';

import { MSS_BATCH, MSS_HISTORY } from '../../common/colorosMss';
import { createMssWaveHeader, interleaveMssCache } from './colorosMssEncoder';
import { createMssModel } from './colorosMssModel';

let cancelled = false;
let delayMs = workerData.playing ? 25 : 0;
const decoder = spawn(
  workerData.ffmpegPath,
  [
    '-v',
    'error',
    '-nostdin',
    '-threads',
    '1',
    '-i',
    workerData.source,
    '-vn',
    '-f',
    'f32le',
    '-ar',
    '48000',
    '-ac',
    '2',
    'pipe:1'
  ],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
);
let decoderError = '';
decoder.stderr.on('data', (bytes) => {
  decoderError = (decoderError + bytes.toString()).slice(-1024);
});
const decoderExit = new Promise<number | null>((resolve, reject) => {
  decoder.once('error', reject);
  decoder.once('exit', resolve);
});
// Register rejection handling immediately, even during model initialization.
void decoderExit.catch(() => undefined);
parentPort!.on('message', (message) => {
  if (message.type === 'cancel') {
    cancelled = true;
    decoder.kill();
    decoder.stdout.destroy();
  } else if (message.type === 'throttle') delayMs = message.delayMs;
});
const timeout = setTimeout(
  () => {
    cancelled = true;
    decoder.kill();
    decoder.stdout.destroy();
  },
  10 * 60 * 1000
);

async function prepare() {
  const model = await createMssModel(workerData.modelPath, 1);
  const output = await open(workerData.temporaryPath, 'w').catch(async (error) => {
    await model.dispose();
    throw error;
  });
  let pending: Buffer = Buffer.alloc(0),
    history: Buffer = Buffer.alloc(MSS_HISTORY * 8);
  let decodedFrames = 0,
    packetStart = 0,
    writtenFrames = 0,
    lastProgress = 0;
  const processBlock = async (block: Buffer) => {
    if (cancelled) throw new Error('MSS_CANCELLED');
    const pcm = new Float32Array(MSS_BATCH * 2);
    for (let n = 0; n < MSS_BATCH; n++) {
      pcm[n] = block.readFloatLE(n * 8);
      pcm[MSS_BATCH + n] = block.readFloatLE(n * 8 + 4);
    }
    if (pcm.some((value) => !Number.isFinite(value))) throw new Error('Invalid decoded audio');
    const result = await model.process({ epoch: 0, start: packetStart, pcm });
    packetStart += MSS_BATCH;
    const encoded = interleaveMssCache(history, block, result, decodedFrames);
    history = block.subarray((MSS_BATCH - MSS_HISTORY) * 8);
    if ('bytes' in encoded) {
      if ((writtenFrames + encoded.bytes.length / 16) * 16 > 512 * 1024 * 1024)
        throw new Error('歌曲超过分轨缓存大小上限');
      // Positional writes avoid partial-write assumptions on large streams.
      let offset = 0;
      while (offset < encoded.bytes.length) {
        const result = await output.write(
          encoded.bytes,
          offset,
          encoded.bytes.length - offset,
          44 + writtenFrames * 16 + offset
        );
        offset += result.bytesWritten;
      }
      writtenFrames += encoded.bytes.length / 16;
    }
    if (performance.now() - lastProgress > 500) {
      lastProgress = performance.now();
      parentPort!.postMessage({ type: 'progress', frames: writtenFrames });
    }
    if (delayMs) await sleep(delayMs);
    else await sleep(0);
  };
  try {
    await output.write(createMssWaveHeader(0), 0, 44, 0);
    for await (const chunk of decoder.stdout) {
      if (cancelled) throw new Error('MSS_CANCELLED');
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= MSS_BATCH * 8) {
        const block = pending.subarray(0, MSS_BATCH * 8);
        pending = pending.subarray(MSS_BATCH * 8);
        decodedFrames += MSS_BATCH;
        await processBlock(block);
      }
    }
    const code = await decoderExit;
    if (cancelled) throw new Error('MSS_CANCELLED');
    if (code !== 0)
      throw new Error(
        `音频解码失败 (${code}): ${decoderError.replace(/https?:\/\/\S+/g, '[media URL]')}`
      );
    if (pending.length % 8) throw new Error('Incomplete decoded audio frame');
    if (pending.length) {
      decodedFrames += pending.length / 8;
      const block = Buffer.alloc(MSS_BATCH * 8);
      pending.copy(block);
      await processBlock(block);
    }
    if (!decodedFrames) throw new Error('歌曲没有可处理的音频');
    await processBlock(Buffer.alloc(MSS_BATCH * 8));
    if (writtenFrames !== decodedFrames) throw new Error('Cached audio clock mismatch');
    await output.write(createMssWaveHeader(writtenFrames), 0, 44, 0);
  } finally {
    await output.close();
    await model.dispose();
  }
  if (cancelled) throw new Error('MSS_CANCELLED');
  await rename(workerData.temporaryPath, workerData.outputPath);
  parentPort!.postMessage({ type: 'ready', frames: writtenFrames });
}
prepare()
  .catch((error) => {
    parentPort!.postMessage({
      type: 'error',
      error: cancelled ? 'MSS_CANCELLED' : error instanceof Error ? error.message : String(error)
    });
  })
  .finally(async () => {
    clearTimeout(timeout);
    decoder.kill();
    await rm(workerData.temporaryPath, { force: true }).catch(() => undefined);
    parentPort!.close();
  })
  .catch(() => parentPort!.close());
