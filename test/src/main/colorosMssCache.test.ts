import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { app } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MssCacheStatus, MssTrack } from '../../../src/common/colorosMss';
import { createMssWaveHeader } from '../../../src/main/audio/colorosMssEncoder';

const fixtures = vi.hoisted(() => ({
  workers: [] as {
    messages: { type: string; delayMs?: number }[];
    data: { outputPath: string; source: string; maxCacheBytes: number };
    emit: (type: string, value?: unknown) => void;
  }[]
}));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      messages: { type: string; delayMs?: number }[] = [];
      data: { outputPath: string; source: string; maxCacheBytes: number };
      constructor(
        _path: string,
        options: { workerData: { outputPath: string; source: string; maxCacheBytes: number } }
      ) {
        super();
        this.data = options.workerData;
        fixtures.workers.push(this);
      }
      postMessage(message: { type: string; delayMs?: number }) {
        this.messages.push(message);
        if (message.type === 'cancel') queueMicrotask(() => this.emit('exit', 0));
      }
    }
  };
});
import { MssTrackCache, mssSource } from '../../../src/main/audio/colorosMssCache';
let root: string;
const track = (id: number): MssTrack => ({
  songId: id,
  path: join(root, `${id}.wav`),
  title: String(id),
  duration: 1,
  trial: false,
  quality: 'standard'
});
function complete(index: number) {
  const worker = fixtures.workers[index];
  writeFileSync(
    worker.data.outputPath,
    Buffer.concat([createMssWaveHeader(10), Buffer.alloc(160)])
  );
  worker.emit('message', { type: 'ready', frames: 10 });
  worker.emit('exit', 0);
}
describe('on-demand full-track cache scheduling', () => {
  it('normalizes both legacy Windows metadata paths and encoded audio URLs', () => {
    expect(mssSource('nora:\\localfiles\\C:\\Music\\Song A.wav?ts=1')).toBe('C:/Music/Song A.wav');
    expect(mssSource('nora://localfiles/C:/Music/Song%20A.wav?ts=2')).toBe('C:/Music/Song A.wav');
    expect(mssSource('https://example.com/song.wav?token=1')).toBe(
      'https://example.com/song.wav?token=1'
    );
  });
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'volo-mss-'));
    mkdirSync(join(root, 'data'));
    vi.mocked(app.getPath).mockReturnValue(join(root, 'data'));
    Object.assign(app, { getAppPath: () => process.cwd() });
    fixtures.workers.length = 0;
    for (const id of [1, 2, 3]) writeFileSync(track(id).path, Buffer.alloc(16));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  it('prepares only the current track and does not prefetch next', async () => {
    const events: MssCacheStatus[] = [];
    const cache = new MssTrackCache((event) => events.push(event));
    await cache.setCurrent(track(1));
    await cache.setNext(track(2));
    await cache.setEnabled(true);
    expect(fixtures.workers).toHaveLength(1);
    expect(fixtures.workers[0].data.source).toBe(track(1).path);
    cache.setPlaying(true);
    cache.setPlaying(false);
    expect(fixtures.workers[0].messages.at(-1)).toEqual({ type: 'throttle', delayMs: 0 });
    expect(fixtures.workers[0].messages.some((message) => message.type === 'cancel')).toBe(false);
    complete(0);
    await cache.setNext(track(2));
    expect(events.some((event) => event.songId === 1 && event.phase === 'ready')).toBe(true);
    expect(fixtures.workers).toHaveLength(1);
    await cache.setEnabled(false);
  });
  it('starts the next track only after it becomes current', async () => {
    const cache = new MssTrackCache(() => undefined);
    await cache.setCurrent(track(1));
    await cache.setNext(track(2));
    await cache.setEnabled(true);
    complete(0);
    await cache.setNext(track(2));
    await cache.setCurrent(track(2));
    await cache.setNext(track(3));
    expect(fixtures.workers).toHaveLength(2);
    expect(fixtures.workers[1].messages.some((message) => message.type === 'cancel')).toBe(false);
    await cache.setEnabled(false);
  });
  it('preempts obsolete work for a manually selected current track', async () => {
    const cache = new MssTrackCache(() => undefined);
    await cache.setCurrent(track(1));
    await cache.setEnabled(true);
    await cache.setCurrent(track(3));
    expect(fixtures.workers[0].messages.some((message) => message.type === 'cancel')).toBe(true);
    expect(fixtures.workers[1].data.source).toBe(track(3).path);
    await cache.setEnabled(false);
  });
  it('invalidates edited files and separates playback quality', async () => {
    const cache = new MssTrackCache(() => undefined);
    await cache.setCurrent(track(1));
    await cache.setEnabled(true);
    complete(0);
    await cache.setNext(null);
    expect(cache.getPrepared(1, 'standard', track(1).path)).not.toBeNull();
    expect(cache.getPrepared(1, 'lossless')).toBeNull();
    writeFileSync(track(1).path, Buffer.alloc(32));
    expect(cache.getPrepared(1, 'standard', track(1).path)).toBeNull();
    await cache.setEnabled(false);
  });
  it('reserves disk space before preparing a track with unknown duration', async () => {
    const cache = new MssTrackCache(() => undefined);
    await cache.setCurrent(track(1));
    await cache.setEnabled(true);
    complete(0);
    await cache.setNext(null);
    await cache.setCurrent({ ...track(2), duration: undefined });
    expect(cache.getPrepared(1, 'standard')).toBeNull();
    expect(fixtures.workers[1].data.maxCacheBytes).toBe(512 * 1024 * 1024);
    await cache.setEnabled(false);
  });
});
