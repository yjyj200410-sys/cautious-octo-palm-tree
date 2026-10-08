import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';

// npm run build first. Optional arg: the upstream independent PyTorch fixture.
const baseRss = process.memoryUsage().rss;
const worker = new Worker(resolve('out/main/stemSeparationWorker.js'), {
  workerData: { modelPath: resolve('resources/stemgen/model.onnx') }
});
let id = 0;
const pending = new Map();
const ready = new Promise((resolve, reject) => {
  worker.on('error', reject);
  worker.on('message', (message) => {
    if (message.type === 'ready') resolve();
    else if (message.type === 'error') reject(new Error(message.error));
    else {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      message.error ? request.reject(new Error(message.error)) : request.resolve(message.result);
    }
  });
});
const request = (epoch, start, pcm) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    worker.postMessage({ id, packet: { session: 1, epoch, start, pcm } }, [pcm.buffer]);
  });
const report = { model: 'StemgenRT v0.6.2', threads: 2, batchSamples: 1024, sampleRate: 44100 };
try {
  await ready;
  report.loadedRssMiB = process.memoryUsage().rss / 1048576;
  report.extraRssMiB = (process.memoryUsage().rss - baseRss) / 1048576;
  if (process.argv[2]) {
    const bytes = readFileSync(process.argv[2]);
    assert.equal(bytes.toString('ascii', 0, 8), 'SGRTG001');
    const count = bytes.readUInt32LE(8);
    let cursor = 12;
    report.parity = [];
    for (let caseIndex = 0; caseIndex < count; caseIndex++) {
      const frames = bytes.readUInt32LE(cursor);
      cursor += 4;
      const input = new Float32Array(bytes.buffer, bytes.byteOffset + cursor, frames * 2);
      cursor += frames * 8;
      const expected = new Float32Array(bytes.buffer, bytes.byteOffset + cursor, frames * 8);
      cursor += frames * 32;
      let maxError = 0;
      let compared = 0;
      for (let start = 0; start < frames + 128; start += 1024) {
        const pcm = new Float32Array(2048);
        for (let channel = 0; channel < 2; channel++) {
          pcm.set(
            input.subarray(
              channel * frames + start,
              channel * frames + Math.min(start + 1024, frames)
            ),
            channel * 1024
          );
        }
        const result = await request(caseIndex, start, pcm);
        for (let i = result.validOffset; i < 1024; i++) {
          const index = result.start + i;
          if (index < 0 || index >= frames) continue;
          for (let channel = 0; channel < 2; channel++) {
            maxError = Math.max(
              maxError,
              Math.abs(result.vocals[channel * 1024 + i] - expected[(4 + channel) * frames + index])
            );
            compared++;
          }
        }
      }
      assert.equal(compared, frames * 2);
      assert.ok(maxError <= 1e-5, `fixture case ${caseIndex}: ${maxError}`);
      report.parity.push({ frames, maxError });
    }
    assert.equal(cursor, bytes.length);
    console.log(`Independent vocal parity: ${count} cases passed`);
  }
  // Non-silent paced audio, state carried continuously for 20 seconds.
  const clockStart = performance.now();
  const times = [];
  let peakRss = process.memoryUsage().rss;
  let maxLag = 0;
  for (let batch = 0; batch < 862; batch++) {
    const start = batch * 1024;
    const pcm = new Float32Array(2048);
    for (let i = 0; i < 1024; i++) {
      pcm[i] = 0.1 * Math.sin(((start + i) * 2 * Math.PI * 440) / 44100);
      pcm[1024 + i] = 0.08 * Math.sin(((start + i) * 2 * Math.PI * 660) / 44100);
    }
    const result = await request(100, start, pcm);
    assert.ok(result.vocals.every(Number.isFinite));
    times.push(result.inferenceMs);
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
    const remaining = clockStart + (((batch + 1) * 1024) / 44100) * 1000 - performance.now();
    maxLag = Math.max(maxLag, -remaining);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }
  const wallMs = performance.now() - clockStart;
  times.sort((a, b) => a - b);
  report.benchmark = {
    wallMs,
    audioMs: ((862 * 1024) / 44100) * 1000,
    meanBatchMs: times.reduce((a, b) => a + b) / times.length,
    p99BatchMs: times[Math.floor(times.length * 0.99)],
    maxBatchMs: times.at(-1),
    maxLagMs: maxLag,
    peakRssMiB: peakRss / 1048576
  };
  console.log(JSON.stringify(report, null, 2));
  writeFileSync('.codex-artifacts/stemgen-validation.json', JSON.stringify(report, null, 2));
} finally {
  await worker.terminate();
}
