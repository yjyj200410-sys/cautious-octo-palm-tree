import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import * as ort from 'onnxruntime-node';

import {
  MSS_BATCH,
  MSS_FFT,
  MSS_HISTORY,
  MSS_HOP,
  MSS_MODEL_SHA256,
  MSS_STEPS
} from '../../common/colorosMss';
import type { MssPacket, MssResult } from '../../common/colorosMss';

// Ported spectral layout: time, stereo real/imaginary planes, frequency.
export class MssSpectralDSP {
  private window = new Float64Array(MSS_FFT);
  private history = new Float32Array(MSS_HISTORY * 2);
  private spectra = new Float32Array(3 * 4 * (MSS_FFT / 2));
  private reverse = new Uint16Array(MSS_FFT);
  private cosine = new Float64Array(MSS_FFT / 2);
  private sine = new Float64Array(MSS_FFT / 2);
  private real = new Float64Array(MSS_FFT);
  private imaginary = new Float64Array(MSS_FFT);
  private overlap = new Float64Array((MSS_STEPS + 2) * MSS_HOP + MSS_FFT);
  private denominator = new Float64Array(this.overlap.length);
  readonly input = new Float32Array(MSS_STEPS * 4 * (MSS_FFT / 2));
  constructor() {
    for (let n = 0; n < MSS_FFT; n++) {
      this.window[n] = Math.fround(0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (MSS_FFT - 1)));
      let reversed = 0;
      for (let value = n, bit = 0; bit < 11; bit++, value >>= 1)
        reversed = (reversed << 1) | (value & 1);
      this.reverse[n] = reversed;
    }
    for (let n = 0; n < MSS_FFT / 2; n++) {
      this.cosine[n] = Math.cos((2 * Math.PI * n) / MSS_FFT);
      this.sine[n] = Math.sin((2 * Math.PI * n) / MSS_FFT);
    }
    for (let frame = 0; frame < MSS_STEPS + 3; frame++)
      for (let n = 0; n < MSS_FFT; n++)
        this.denominator[frame * MSS_HOP + n] += this.window[n] ** 2;
  }
  reset() {
    this.history.fill(0);
    this.spectra.fill(0);
  }
  private fft(inverse: boolean) {
    const real = this.real,
      imag = this.imaginary;
    for (let n = 0; n < MSS_FFT; n++) {
      const other = this.reverse[n];
      if (other > n) {
        const r = real[n],
          i = imag[n];
        real[n] = real[other];
        imag[n] = imag[other];
        real[other] = r;
        imag[other] = i;
      }
    }
    for (let size = 2; size <= MSS_FFT; size *= 2) {
      const half = size / 2,
        stride = MSS_FFT / size;
      for (let base = 0; base < MSS_FFT; base += size)
        for (let n = 0; n < half; n++) {
          const cos = this.cosine[n * stride],
            sin = this.sine[n * stride] * (inverse ? 1 : -1);
          const a = base + n,
            b = a + half;
          const r = real[b] * cos - imag[b] * sin,
            i = real[b] * sin + imag[b] * cos;
          real[b] = real[a] - r;
          imag[b] = imag[a] - i;
          real[a] += r;
          imag[a] += i;
        }
    }
    if (inverse) for (let n = 0; n < MSS_FFT; n++) real[n] /= MSS_FFT;
  }
  analyze(pcm: Float32Array) {
    for (let frame = 0; frame < MSS_STEPS; frame++)
      for (let channel = 0; channel < 2; channel++) {
        for (let n = 0; n < MSS_FFT; n++) {
          const position = frame * MSS_HOP + n - MSS_HISTORY;
          const value =
            position < 0
              ? this.history[channel * MSS_HISTORY + position + MSS_HISTORY]
              : pcm[channel * MSS_BATCH + position];
          this.real[n] = value * this.window[n];
          this.imaginary[n] = 0;
        }
        this.fft(false);
        const offset = (frame * 4 + channel * 2) * (MSS_FFT / 2);
        for (let n = 0; n < MSS_FFT / 2; n++) {
          this.input[offset + n] = this.real[n];
          this.input[offset + MSS_FFT / 2 + n] = this.imaginary[n];
        }
      }
    for (let channel = 0; channel < 2; channel++)
      this.history.set(
        pcm.subarray(channel * MSS_BATCH + MSS_BATCH - MSS_HISTORY, (channel + 1) * MSS_BATCH),
        channel * MSS_HISTORY
      );
    return this.input;
  }
  synthesize(planes: Float32Array) {
    const vocals = new Float32Array(MSS_BATCH * 2);
    for (let channel = 0; channel < 2; channel++) {
      this.overlap.fill(0);
      for (let frame = 0; frame < MSS_STEPS + 3; frame++) {
        const cache = frame < 3;
        const data = cache ? this.spectra : planes;
        // Output stem 0 is vocals, corroborated by phone gain-vector order and isolated speech.
        const offset = ((cache ? frame * 4 : (frame - 3) * 16) + channel * 2) * (MSS_FFT / 2);
        this.real.fill(0);
        this.imaginary.fill(0);
        for (let n = 0; n < MSS_FFT / 2; n++) {
          this.real[n] = data[offset + n];
          this.imaginary[n] = data[offset + MSS_FFT / 2 + n];
          if (n > 0) {
            this.real[MSS_FFT - n] = this.real[n];
            this.imaginary[MSS_FFT - n] = -this.imaginary[n];
          }
        }
        this.fft(true);
        for (let n = 0; n < MSS_FFT; n++)
          this.overlap[frame * MSS_HOP + n] += this.real[n] * this.window[n];
      }
      for (let n = 0; n < MSS_BATCH; n++)
        vocals[channel * MSS_BATCH + n] =
          this.overlap[MSS_HISTORY + n] / this.denominator[MSS_HISTORY + n];
    }
    for (let frame = 0; frame < 3; frame++)
      this.spectra.set(
        planes.subarray(
          ((frame + MSS_STEPS - 3) * 16 * MSS_FFT) / 2,
          (((frame + MSS_STEPS - 3) * 16 + 4) * MSS_FFT) / 2
        ),
        (frame * 4 * MSS_FFT) / 2
      );
    return vocals;
  }
}

export async function createMssModel(modelPath: string, threads = 2) {
  const bytes = readFileSync(modelPath);
  if (createHash('sha256').update(bytes).digest('hex') !== MSS_MODEL_SHA256)
    throw new Error('ColorOS MSS model checksum mismatch');
  const session = await ort.InferenceSession.create(bytes, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    executionMode: 'sequential',
    intraOpNumThreads: threads,
    interOpNumThreads: 1,
    extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } }
  });
  const shapes = [
    [1, 8, 4, 1024],
    ...Array.from({ length: 4 }, () => [1, 2, 128, 48]),
    ...Array.from({ length: 4 }, () => [1, 2, 64, 56]),
    ...Array.from({ length: 4 }, () => [1, 2, 32, 64]),
    ...Array.from({ length: 4 }, () => [1, 2, 16, 72]),
    [1, 2, 32, 128],
    ...Array.from({ length: 3 }, () => [1, 2, 32, 64]),
    [1, 2, 64, 112],
    ...Array.from({ length: 3 }, () => [1, 2, 64, 56]),
    [1, 2, 128, 96],
    ...Array.from({ length: 3 }, () => [1, 2, 128, 48])
  ];
  if (session.inputNames.length !== 29 || session.outputNames.length !== 29)
    throw new Error('Unexpected MSS model interface');
  for (let index = 0; index < shapes.length; index++) {
    const info = session.inputMetadata.find((item) => item.name === `input_${index + 1}`);
    if (!info?.isTensor || info.type !== 'float32' || String(info.shape) !== String(shapes[index]))
      throw new Error(`Unexpected MSS tensor ${index}`);
  }
  const dsp = new MssSpectralDSP();
  const inputTensor = new ort.Tensor('float32', dsp.input, shapes[0]);
  const state = Array.from({ length: 2 }, () =>
    shapes
      .slice(1)
      .map(
        (shape) =>
          new ort.Tensor('float32', new Float32Array(shape.reduce((a, b) => a * b, 1)), shape)
      )
  );
  const outputTensor = new ort.Tensor(
    'float32',
    new Float32Array((MSS_STEPS * 16 * MSS_FFT) / 2),
    [1, 8, 16, 1024]
  );
  const feeds = state.map((items) =>
    Object.fromEntries([
      ['input_1', inputTensor],
      ...items.map((tensor, index) => [`input_${index + 2}`, tensor])
    ])
  );
  const fetches = state.map((items) =>
    Object.fromEntries([
      ['Identity', outputTensor],
      ...items.map((tensor, index) => [`Identity_${index + 1}`, tensor])
    ])
  );
  let stateIndex = 0,
    epoch = -1,
    expectedStart = -1;
  const reset = () => {
    dsp.reset();
    for (const items of state) for (const tensor of items) (tensor.data as Float32Array).fill(0);
    stateIndex = 0;
  };
  // Warm kernel initialization before audio starts, then clear the recurrent state.
  await session.run(feeds[0], fetches[1]);
  reset();
  return {
    modelBytes: bytes.length,
    async process(packet: MssPacket): Promise<MssResult> {
      const restarted = packet.epoch !== epoch || packet.start !== expectedStart;
      if (restarted) {
        reset();
        epoch = packet.epoch;
      }
      expectedStart = packet.start + MSS_BATCH;
      const started = performance.now();
      dsp.analyze(packet.pcm);
      const next = 1 - stateIndex;
      await session.run(feeds[stateIndex], fetches[next]);
      stateIndex = next;
      const vocals = dsp.synthesize(outputTensor.data as Float32Array);
      for (const value of vocals)
        if (!Number.isFinite(value)) throw new Error('Non-finite MSS output');
      return {
        epoch: packet.epoch,
        start: packet.start - MSS_HISTORY,
        validOffset: restarted ? MSS_HISTORY : 0,
        vocals,
        inferenceMs: performance.now() - started
      };
    },
    async dispose() {
      for (const items of state) for (const tensor of items) tensor.dispose();
      inputTensor.dispose();
      outputTensor.dispose();
      await session.release();
    }
  };
}
