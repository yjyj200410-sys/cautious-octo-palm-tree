import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

type Message =
  | { type: 'infer'; request: string; packet: { epoch: number; start: number; pcm: Float32Array } }
  | { type: 'status' };
interface Processor {
  tags: Float64Array;
  pending: Set<string>;
  underruns: number;
  port: { onmessage: (event: { data: unknown }) => void };
  process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
}
function createProcessor(respond = true) {
  let Constructor!: new () => Processor;
  const messages: Message[] = [];
  runInNewContext(readFileSync('src/renderer/src/other/colorosMss.worklet.js', 'utf8'), {
    AudioWorkletProcessor: class {
      port = {
        onmessage: null,
        postMessage: (message: Message) => {
          messages.push(message);
          if (respond && message.type === 'infer')
            processor.port.onmessage({
              data: {
                type: 'result',
                request: message.request,
                result: {
                  epoch: message.packet.epoch,
                  start: message.packet.start - 1536,
                  validOffset: message.packet.start === 0 ? 1536 : 0,
                  vocals: new Float32Array(8192).fill(0.2)
                }
              }
            });
        }
      };
    },
    registerProcessor: (_name: string, value: new () => Processor) => {
      Constructor = value;
    }
  });
  const processor = new Constructor();
  const send = (data: unknown) => processor.port.onmessage({ data });
  const mix = (vocals = 1, accompaniment = 1, enabled = true) => {
    send({ type: 'mix', vocals, accompaniment, enabled });
    send({ type: 'playing', playing: true });
  };
  const block = (left = 0.5, right = -0.4) => {
    const output = [new Float32Array(128), new Float32Array(128)];
    processor.process(
      [[new Float32Array(128).fill(left), new Float32Array(128).fill(right)]],
      [output]
    );
    return output;
  };
  const run = (count = 400, left = 0.5, right = -0.4) => {
    let output: Float32Array[] = [];
    for (let n = 0; n < count; n++) output = block(left, right);
    return output;
  };
  return { processor, send, mix, block, run, messages };
}

describe('real-time vocal remix audio clock', () => {
  it('bypasses immediately without inference while disabled', () => {
    const { block, messages } = createProcessor();
    expect(block()[0][0]).toBeCloseTo(0.5);
    expect(messages).toHaveLength(0);
  });
  it('buffers exactly 8192 samples and preserves original stereo at unity', () => {
    const { mix, run, block } = createProcessor();
    mix();
    expect(run(64)[0][127]).toBe(0);
    const output = block(0.7, 0.6);
    expect(output[0][0]).toBeCloseTo(0.5);
    expect(output[1][0]).toBeCloseTo(-0.4);
  });
  it('mixes the matching vocal and residual backing samples', () => {
    const { mix, run } = createProcessor();
    mix(1, 0);
    expect(run()[0][127]).toBeCloseTo(0.2, 5);
    mix(0, 1);
    const output = run();
    expect(output[0][127]).toBeCloseTo(0.3, 5);
    expect(output[1][127]).toBeCloseTo(-0.6, 5);
  });
  it('bounds outstanding inference and falls back to delayed original audio', () => {
    const { processor, mix, run, messages } = createProcessor(false);
    mix(1, 0);
    expect(run()[0][127]).toBeCloseTo(0.5);
    expect(messages.filter((message) => message.type === 'infer')).toHaveLength(2);
    expect(processor.pending.size).toBe(2);
    expect(processor.underruns).toBeGreaterThan(0);
  });
  it('keeps both zero controls silent even when inference is missing', () => {
    const { mix, run } = createProcessor(false);
    mix(0, 0);
    expect(Math.abs(run()[0][127])).toBeLessThan(1e-6);
  });
  it('rejects stale results after a seek and clears buffered audio', () => {
    const { processor, send, mix, run, messages, block } = createProcessor(false);
    mix(1, 0);
    run(32);
    const old = messages[0];
    if (old.type !== 'infer') throw new Error('Expected an inference packet');
    send({ type: 'reset' });
    send({
      type: 'result',
      request: old.request,
      result: {
        epoch: old.packet.epoch,
        start: 0,
        validOffset: 0,
        vocals: new Float32Array(8192).fill(0.9)
      }
    });
    expect(processor.tags.every((value: number) => value === -1)).toBe(true);
    expect(block()[0][0]).toBe(0);
    expect(run()[0][127]).toBeCloseTo(0.5);
  });
  it('stops packets on pause and bypasses immediately when disabled', () => {
    const { mix, send, run, block, messages } = createProcessor();
    mix(1, 0);
    run();
    send({ type: 'playing', playing: false });
    const count = messages.length;
    expect(run(100)[0][127]).toBe(0);
    expect(messages.length).toBe(count);
    mix(1, 0, false);
    expect(block()[0][0]).toBeCloseTo(0.5);
  });
  it('limits boosted stereo using one linked gain', () => {
    const { mix, run } = createProcessor(false);
    mix(1.5, 1);
    const output = run(400, 2, 1);
    expect(output[0][127]).toBeCloseTo(1);
    expect(output[1][127]).toBeCloseTo(0.5);
  });
  it('plays prepared vocals instantly without inference or a latency buffer', () => {
    const { processor, send, messages } = createProcessor();
    send({ type: 'mix', enabled: true, cached: true, vocals: 1, accompaniment: 0 });
    send({ type: 'playing', playing: true });
    const output = [new Float32Array(128), new Float32Array(128)];
    for (let n = 0; n < 120; n++)
      processor.process(
        [
          [
            new Float32Array(128).fill(0.5),
            new Float32Array(128).fill(-0.4),
            new Float32Array(128).fill(0.2),
            new Float32Array(128).fill(-0.1)
          ]
        ],
        [output]
      );
    expect(output[0][127]).toBeCloseTo(0.2, 5);
    expect(output[1][127]).toBeCloseTo(-0.1, 5);
    expect(messages).toHaveLength(0);
    send({ type: 'mix', enabled: false, cached: true, vocals: 0, accompaniment: 0 });
    processor.process(
      [
        [
          new Float32Array(128).fill(0.5),
          new Float32Array(128).fill(-0.4),
          new Float32Array(128).fill(0.2),
          new Float32Array(128).fill(-0.1)
        ]
      ],
      [output]
    );
    expect(output[0][0]).toBeCloseTo(0.5);
    expect(output[1][0]).toBeCloseTo(-0.4);
  });
});
