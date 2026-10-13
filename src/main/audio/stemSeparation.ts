import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { app, ipcMain } from 'electron';
import type { WebContents } from 'electron';

import { MSS_BATCH, MSS_LATENCY, MSS_SAMPLE_RATE } from '../../common/colorosMss';
import type { MssPacket, MssResult, MssRuntimeInfo, MssTrack } from '../../common/colorosMss';
import { MssTrackCache } from './colorosMssCache';

export class ColorOSMssSession {
  private worker: Worker | null = null;
  private ready: Promise<MssRuntimeInfo> | null = null;
  private sequence = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: MssResult) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private transition = Promise.resolve();
  setEnabled(enabled: boolean): Promise<MssRuntimeInfo | null> {
    const result = this.transition.then(async () => {
      if (enabled) return this.start();
      await this.stop();
      return null;
    });
    this.transition = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
  private start(): Promise<MssRuntimeInfo> {
    if (this.ready) return this.ready;
    const root = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'main')
      : join(app.getAppPath(), 'out', 'main');
    const modelPath = app.isPackaged
      ? join(process.resourcesPath, 'coloros-mss', 'model.onnx')
      : join(app.getAppPath(), 'resources', 'coloros-mss', 'model.onnx');
    const worker = new Worker(join(root, 'colorosMssWorker.js'), { workerData: { modelPath } });
    this.worker = worker;
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('分轨模型启动超时'));
        void this.stop();
      }, 15000);
      worker.on('message', (message) => {
        if (message.type === 'ready') {
          clearTimeout(timer);
          resolve({
            sampleRate: MSS_SAMPLE_RATE,
            latencyFrames: MSS_LATENCY,
            modelBytes: message.modelBytes
          });
        } else if (message.type === 'init-error') {
          clearTimeout(timer);
          reject(new Error(message.error));
        } else {
          const item = this.pending.get(message.id);
          if (!item) return;
          clearTimeout(item.timer);
          this.pending.delete(message.id);
          message.type === 'result'
            ? item.resolve(message.result)
            : item.reject(new Error(message.error));
        }
      });
      worker.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
        this.failPending(error instanceof Error ? error : new Error(String(error)));
      });
      worker.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('分轨线程已退出'));
        this.failPending(new Error('MSS_STOPPED'));
        if (this.worker === worker) {
          this.worker = null;
          this.ready = null;
        }
      });
    });
    return this.ready;
  }
  infer(packet: MssPacket): Promise<MssResult> {
    if (!this.worker || !this.ready) return Promise.reject(new Error('MSS_STOPPED'));
    if (
      !packet ||
      !Number.isSafeInteger(packet.epoch) ||
      packet.epoch < 0 ||
      !Number.isSafeInteger(packet.start) ||
      packet.start < 0 ||
      packet.start % MSS_BATCH !== 0 ||
      !(packet.pcm instanceof Float32Array) ||
      packet.pcm.length !== MSS_BATCH * 2 ||
      packet.pcm.some((value) => !Number.isFinite(value))
    )
      return Promise.reject(new Error('Invalid MSS packet'));
    if (this.pending.size >= 2) return Promise.reject(new Error('MSS_BUSY'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('分轨处理超时'));
        void this.setEnabled(false);
      }, 2000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.worker!.postMessage({ type: 'infer', id, packet }, [packet.pcm.buffer]);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private failPending(error: Error) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }
  async stop() {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    this.failPending(new Error('MSS_STOPPED'));
    if (!worker) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        void worker.terminate();
        resolve();
      }, 10000);
      worker.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      // Let an in-flight native inference finish before disposal.
      worker.postMessage({ type: 'shutdown' });
    });
  }
}

export function initializeStemSeparationIPC(sender: WebContents) {
  const session = new ColorOSMssSession();
  const cache = new MssTrackCache((status) => {
    if (!sender.isDestroyed()) sender.send('mss/cacheStatus', status);
  });
  const guard = (candidate: WebContents) => {
    if (candidate !== sender) throw new Error('Invalid MSS sender');
  };
  ipcMain.handle('mss/setEnabled', async (event, enabled) => {
    guard(event.sender);
    if (typeof enabled !== 'boolean') throw new Error('Invalid MSS state');
    const info = await session.setEnabled(enabled);
    await cache.setEnabled(enabled);
    return info;
  });
  ipcMain.handle('mss/clearCache', async (event) => {
    guard(event.sender);
    await session.setEnabled(false);
    await cache.clear();
  });
  ipcMain.handle('mss/infer', async (event, packet: MssPacket) => {
    guard(event.sender);
    const result = await session.infer(packet);
    cache.protectRealtime(result.inferenceMs);
    return result;
  });
  const validateTrack = (track: MssTrack) => {
    if (
      !track ||
      !Number.isSafeInteger(track.songId) ||
      typeof track.path !== 'string' ||
      !track.path ||
      typeof track.title !== 'string' ||
      typeof track.quality !== 'string' ||
      track.quality.length > 64 ||
      typeof track.trial !== 'boolean' ||
      (track.duration !== undefined && (!Number.isFinite(track.duration) || track.duration <= 0))
    )
      throw new Error('Invalid MSS track');
  };
  ipcMain.handle('mss/current', (event, track: MssTrack) => {
    guard(event.sender);
    validateTrack(track);
    return cache.setCurrent(track);
  });
  ipcMain.handle('mss/next', (event, track: MssTrack | null) => {
    guard(event.sender);
    if (track) validateTrack(track);
    return cache.setNext(track);
  });
  ipcMain.handle('mss/prepared', (event, songId, quality, path) => {
    guard(event.sender);
    if (
      !Number.isSafeInteger(songId) ||
      typeof quality !== 'string' ||
      (path !== undefined && typeof path !== 'string')
    )
      throw new Error('Invalid MSS lookup');
    return cache.getPrepared(songId, quality, path);
  });
  ipcMain.handle('mss/playing', (event, playing) => {
    guard(event.sender);
    if (typeof playing !== 'boolean') throw new Error('Invalid playback state');
    cache.setPlaying(playing);
  });
  const stop = () => {
    void session.setEnabled(false);
    void cache.setEnabled(false);
  };
  sender.on('render-process-gone', stop);
  sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) stop();
  });
  sender.once('destroyed', stop);
  app.once('before-quit', stop);
}
