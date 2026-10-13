import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import { app } from 'electron';
import ffmpeg from 'ffmpeg-static';

import { MSS_MODEL_SHA256, MSS_SAMPLE_RATE } from '../../common/colorosMss';
import type { MssCacheStatus, MssPreparedTrack, MssTrack } from '../../common/colorosMss';

interface Entry {
  key: string;
  track: MssTrack;
  fingerprint: string;
  frames: number;
  used: number;
}
export function mssSource(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith('file:')) return fileURLToPath(path);
  if (path.startsWith('nora:')) {
    const url = new URL(path.replaceAll('\\', '/'));
    const pathname = url.hostname ? url.pathname : url.pathname.replace(/^\/localfiles(?=\/)/, '');
    return decodeURIComponent(pathname).replace(/^\/(?=[A-Za-z]:)/, '');
  }
  if (isAbsolute(path)) return path;
  throw new Error('Unsupported audio source');
}
export function mssFingerprint(track: MssTrack) {
  const source = mssSource(track.path);
  const file = /^https?:/i.test(source) ? null : statSync(source);
  return createHash('sha256')
    .update(
      JSON.stringify([
        MSS_MODEL_SHA256,
        track.songId,
        track.quality,
        track.trial,
        source,
        file?.size,
        file?.mtimeMs
      ])
    )
    .digest('hex');
}

export class MssTrackCache {
  private root = join(app.getPath('userData'), 'coloros-mss-cache');
  private entries: Entry[] = [];
  private current: MssTrack | null = null;
  private enabled = false;
  private playing = false;
  private job: { worker: Worker; track: MssTrack; key: string; done: Promise<void> } | null = null;
  private failed = new Set<string>();
  private transition = Promise.resolve();
  private writeQueue = Promise.resolve();
  private emit: (status: MssCacheStatus) => void;
  constructor(emit: (status: MssCacheStatus) => void) {
    this.emit = emit;
    mkdirSync(this.root, { recursive: true });
    try {
      const entries = JSON.parse(readFileSync(join(this.root, 'index.json'), 'utf8'));
      if (Array.isArray(entries))
        this.entries = entries.filter(
          (entry) =>
            /^[a-f0-9]{64}$/.test(entry.key) &&
            entry.model === MSS_MODEL_SHA256 &&
            entry.track &&
            Number.isSafeInteger(entry.frames) &&
            entry.frames > 0
        );
    } catch {
      /* Empty cache or interrupted index write. */
    }
  }
  private file(key: string) {
    return join(this.root, `${key}.wav`);
  }
  private prepared(entry: Entry): MssPreparedTrack {
    return {
      songId: entry.track.songId,
      url: `nora://localfiles${pathToFileURL(this.file(entry.key)).pathname}`,
      originalPath: entry.track.path,
      trial: entry.track.trial,
      quality: entry.track.quality,
      frames: entry.frames
    };
  }
  getPrepared(songId: number, quality: string, path?: string): MssPreparedTrack | null {
    const candidates = this.entries
      .filter((entry) => entry.track.songId === songId && entry.track.quality === quality)
      .sort((a, b) => Number(a.track.trial) - Number(b.track.trial) || b.used - a.used);
    for (const entry of candidates) {
      try {
        if (
          !existsSync(this.file(entry.key)) ||
          statSync(this.file(entry.key)).size !== 44 + entry.frames * 16
        )
          continue;
        if (songId >= 0) {
          if (path && mssSource(path) !== mssSource(entry.track.path)) continue;
          if (mssFingerprint(entry.track) !== entry.fingerprint) continue;
        }
        entry.used = Date.now();
        return this.prepared(entry);
      } catch {
        /* Source moved, edited, or cache evicted. */
      }
    }
    return null;
  }
  async clear() {
    await this.setEnabled(false);
    await this.writeQueue;
    for (const name of await readdir(this.root)) {
      if (/^[a-f0-9]{64}\.(wav|part)$/.test(name)) await rm(join(this.root, name), { force: true });
    }
    this.entries = [];
    this.failed.clear();
    await writeFile(join(this.root, 'index.json'), '[]');
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) this.failed.clear();
    return this.schedule();
  }
  setCurrent(track: MssTrack) {
    this.current = track;
    return this.schedule();
  }
  setNext(_track: MssTrack | null) {
    // Retained IPC contract; the lightweight player never prepares the next track.
    return this.transition;
  }
  setPlaying(playing: boolean) {
    this.playing = playing;
    this.job?.worker.postMessage({ type: 'throttle', delayMs: playing ? 25 : 0 });
  }
  protectRealtime(inferenceMs: number) {
    if (this.playing)
      this.job?.worker.postMessage({ type: 'throttle', delayMs: inferenceMs > 25 ? 150 : 25 });
  }
  private schedule() {
    this.transition = this.transition
      .then(async () => {
        const desired = this.enabled
          ? [this.current].filter((track): track is MssTrack => !!track)
          : [];
        if (this.job) {
          const current = desired[0];
          const priorityChanged =
            current &&
            current.songId !== this.job.track.songId &&
            !this.getPrepared(current.songId, current.quality, current.path);
          if (
            priorityChanged ||
            !desired.some(
              (track) =>
                track.songId === this.job!.track.songId &&
                track.quality === this.job!.track.quality &&
                track.trial === this.job!.track.trial
            )
          ) {
            const job = this.job;
            job.worker.postMessage({ type: 'cancel' });
            await job.done;
          }
        }
        for (const track of desired) {
          const prepared = this.getPrepared(track.songId, track.quality, track.path);
          if (prepared)
            this.emit({
              songId: track.songId,
              quality: track.quality,
              phase: 'ready',
              progress: 100,
              prepared
            });
        }
        if (this.job || !this.enabled) return undefined;
        for (const track of desired) {
          if (this.getPrepared(track.songId, track.quality, track.path)) continue;
          let key: string;
          try {
            key = mssFingerprint(track);
          } catch (error) {
            this.emit({
              songId: track.songId,
              quality: track.quality,
              phase: 'error',
              progress: 0,
              error: error instanceof Error ? error.message : String(error)
            });
            continue;
          }
          if (this.failed.has(key)) continue;
          const maxCacheBytes = await this.reserve(track);
          this.start(track, key, maxCacheBytes);
          break;
        }
        return undefined;
      })
      .catch(() => undefined);
    return this.transition;
  }
  private async reserve(track: MssTrack) {
    await this.writeQueue;
    const limit = 512 * 1024 * 1024;
    const wanted = Math.min(
      limit,
      44 + Math.ceil(track.duration || limit / 16 / MSS_SAMPLE_RATE) * MSS_SAMPLE_RATE * 16
    );
    const files = (await readdir(this.root))
      .filter((name) => /^[a-f0-9]{64}\.wav$/.test(name))
      .map((name) => ({ key: name.slice(0, -4), size: statSync(join(this.root, name)).size }));
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort(
      (a, b) =>
        (this.entries.find((e) => e.key === a.key)?.used || 0) -
        (this.entries.find((e) => e.key === b.key)?.used || 0)
    )) {
      if (total + wanted <= limit) break;
      await rm(this.file(file.key), { force: true });
      total -= file.size;
      this.entries = this.entries.filter((entry) => entry.key !== file.key);
    }
    return limit - total;
  }
  private start(track: MssTrack, key: string, maxCacheBytes: number) {
    const mainRoot = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main')
      : join(app.getAppPath(), 'out', 'main');
    const modelPath = app.isPackaged
      ? join(process.resourcesPath, 'coloros-mss', 'model.onnx')
      : join(app.getAppPath(), 'resources', 'coloros-mss', 'model.onnx');
    const worker = new Worker(join(mainRoot, 'colorosMssPrepareWorker.js'), {
      workerData: {
        modelPath,
        ffmpegPath: ffmpeg!.replace('app.asar', 'app.asar.unpacked'),
        source: mssSource(track.path),
        temporaryPath: join(this.root, `${key}.part`),
        outputPath: this.file(key),
        playing: this.playing,
        maxCacheBytes
      }
    });
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    this.job = { worker, track, key, done };
    this.emit({ songId: track.songId, quality: track.quality, phase: 'processing', progress: 0 });
    worker.on('message', (message) => {
      if (message.type === 'progress')
        this.emit({
          songId: track.songId,
          quality: track.quality,
          phase: 'processing',
          progress: Math.min(
            99,
            Math.round(
              (message.frames / (Math.max(1, track.duration ?? 0) * MSS_SAMPLE_RATE)) * 100
            )
          )
        });
      else if (message.type === 'ready') {
        const entry: Entry = {
          key,
          track,
          fingerprint: key,
          frames: message.frames,
          used: Date.now()
        };
        this.entries = this.entries.filter((item) => item.key !== key);
        this.entries.push(entry);
        this.emit({
          songId: track.songId,
          quality: track.quality,
          phase: 'ready',
          progress: 100,
          prepared: this.prepared(entry)
        });
        void this.saveAndPrune();
      } else if (message.type === 'error' && !message.error.includes('MSS_CANCELLED')) {
        this.failed.add(key);
        this.emit({
          songId: track.songId,
          quality: track.quality,
          phase: 'error',
          progress: 0,
          error: message.error
        });
      }
    });
    worker.on('error', (error) => {
      this.failed.add(key);
      this.emit({
        songId: track.songId,
        quality: track.quality,
        phase: 'error',
        progress: 0,
        error: String(error)
      });
    });
    worker.once('exit', () => {
      if (this.job?.worker === worker) this.job = null;
      finish();
      void this.schedule();
    });
  }
  private saveAndPrune() {
    this.writeQueue = this.writeQueue
      .then(async () => {
        const protectedIds = new Set([this.current?.songId]);
        const files = await readdir(this.root);
        let total = 0;
        const wavs = [];
        for (const name of files) {
          if (!/^[a-f0-9]{64}\.wav$/.test(name)) continue;
          const key = name.slice(0, -4),
            size = statSync(this.file(key)).size;
          const entry = this.entries.find((item) => item.key === key);
          total += size;
          wavs.push({ key, size, used: entry?.used ?? 0, songId: entry?.track.songId });
        }
        for (const file of wavs.sort((a, b) => a.used - b.used)) {
          if (total <= 512 * 1024 * 1024) break;
          if (protectedIds.has(file.songId)) continue;
          await rm(this.file(file.key), { force: true });
          total -= file.size;
          this.entries = this.entries.filter((entry) => entry.key !== file.key);
        }
        await writeFile(
          join(this.root, 'index.tmp'),
          JSON.stringify(this.entries.map((entry) => ({ ...entry, model: MSS_MODEL_SHA256 })))
        );
        await rename(join(this.root, 'index.tmp'), join(this.root, 'index.json'));
        return undefined;
      })
      .catch(() => undefined);
    return this.writeQueue;
  }
}
