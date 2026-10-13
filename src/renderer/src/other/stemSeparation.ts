import { MSS_LATENCY, MSS_SAMPLE_RATE } from '@common/colorosMss';
import type { MssCacheStatus, MssPacket, MssPreparedTrack, MssTrack } from '@common/colorosMss';

import workletUrl from './colorosMss.worklet.js?url&no-inline';

export interface StemSeparationState {
  enabled: boolean;
  loading: boolean;
  vocals: number;
  accompaniment: number;
  error: string;
  ready: boolean;
  inferenceMs: number;
  underrunFrames: number;
  latencyMs: number;
  cached: boolean;
  currentProgress: number;
  currentPreparing: boolean;
  nextTitle: string;
  nextProgress: number;
  nextReady: boolean;
  cacheError: string;
}
export class StemSeparation {
  private source: AudioNode | null = null;
  private destination: AudioNode | null = null;
  private node: AudioWorkletNode | null = null;
  private mixerPromise: Promise<void> | null = null;
  private generation = 0;
  private runtimeReady = false;
  private playing = false;
  private destroyed = false;
  private currentTrack: MssTrack | null = null;
  private nextTrack: MssTrack | null = null;
  private removeCacheListener: () => void;
  onEnabledChange: ((enabled: boolean) => void) | null = null;
  onCurrentPrepared: ((prepared: MssPreparedTrack) => void) | null = null;
  private listeners = new Set<() => void>();
  private state: StemSeparationState = {
    enabled: false,
    loading: false,
    vocals: 100,
    accompaniment: 100,
    error: '',
    ready: false,
    inferenceMs: 0,
    underrunFrames: 0,
    latencyMs: (MSS_LATENCY / MSS_SAMPLE_RATE) * 1000,
    cached: false,
    currentProgress: 0,
    currentPreparing: false,
    nextTitle: '',
    nextProgress: 0,
    nextReady: false,
    cacheError: ''
  };
  private context: AudioContext;
  constructor(context: AudioContext) {
    this.context = context;
    this.removeCacheListener = window.api.stemSeparation.onCacheStatus((status) =>
      this.handleCacheStatus(status)
    );
    try {
      const saved = JSON.parse(localStorage.getItem('volo:coloros-mss-mix') ?? 'null');
      if (Number.isFinite(saved?.vocals) && Number.isFinite(saved?.accompaniment)) {
        this.state.vocals = Math.max(0, Math.min(150, saved.vocals));
        this.state.accompaniment = Math.max(0, Math.min(100, saved.accompaniment));
      }
    } catch {
      /* Optional saved controls. */
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  private update(change: Partial<StemSeparationState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  attach(source: AudioNode, destination: AudioNode) {
    this.source = source;
    this.destination = destination;
    source.connect(destination);
  }
  setPlaying(playing: boolean) {
    this.playing = playing;
    this.node?.port.postMessage({ type: 'playing', playing });
    void window.api.stemSeparation.setPlaying(playing).catch(() => undefined);
  }
  setCurrentTrack(track: MssTrack) {
    this.currentTrack = track;
    this.update({
      currentProgress: this.state.cached ? 100 : 0,
      currentPreparing: this.state.enabled && !this.state.cached,
      cacheError: ''
    });
    void window.api.stemSeparation
      .setCurrent(track)
      .catch((error) => this.update({ cacheError: String(error) }));
  }
  setNextTrack(track: MssTrack | null) {
    this.nextTrack = track;
    this.update({ nextTitle: track?.title ?? '', nextProgress: 0, nextReady: false });
    void window.api.stemSeparation
      .setNext(track)
      .catch((error) => this.update({ cacheError: String(error) }));
  }
  getPrepared(songId: number, quality: string, path?: string) {
    return window.api.stemSeparation.getPrepared(songId, quality, path);
  }
  setCachedSource(cached: boolean) {
    this.update({
      cached,
      ready: cached,
      currentPreparing: !cached && this.state.enabled,
      latencyMs: cached ? 0 : (MSS_LATENCY / MSS_SAMPLE_RATE) * 1000
    });
    this.sendMix();
  }
  private handleCacheStatus(status: MssCacheStatus) {
    if (!this.state.enabled || this.destroyed) return;
    if (
      status.songId === this.currentTrack?.songId &&
      status.quality === this.currentTrack.quality
    ) {
      this.update({
        currentProgress: status.progress,
        currentPreparing: status.phase === 'processing',
        cacheError: status.phase === 'error' ? (status.error ?? '') : this.state.cacheError
      });
      if (status.prepared && !this.state.cached) this.onCurrentPrepared?.(status.prepared);
    } else if (
      status.songId === this.nextTrack?.songId &&
      status.quality === this.nextTrack.quality
    ) {
      this.update({
        nextProgress: status.progress,
        nextReady: status.phase === 'ready',
        cacheError: status.phase === 'error' ? (status.error ?? '') : this.state.cacheError
      });
    }
  }
  reset() {
    this.node?.port.postMessage({ type: 'reset' });
    this.update({ ready: this.state.cached, underrunFrames: 0 });
  }
  private sendMix() {
    this.node?.port.postMessage({
      type: 'mix',
      enabled: this.state.enabled && this.runtimeReady,
      cached: this.state.cached,
      vocals: this.state.vocals / 100,
      accompaniment: this.state.accompaniment / 100
    });
  }
  setMix(vocals: number, accompaniment: number) {
    if (!Number.isFinite(vocals) || !Number.isFinite(accompaniment)) return;
    this.update({
      vocals: Math.max(0, Math.min(150, vocals)),
      accompaniment: Math.max(0, Math.min(100, accompaniment))
    });
    this.sendMix();
    try {
      localStorage.setItem(
        'volo:coloros-mss-mix',
        JSON.stringify({ vocals: this.state.vocals, accompaniment: this.state.accompaniment })
      );
    } catch {
      /* Optional persistence. */
    }
  }
  setBalance(value: number) {
    if (!Number.isFinite(value)) return;
    const balance = Math.round(Math.max(-100, Math.min(100, value)));
    this.setMix(balance > 0 ? 100 - balance : 100, balance < 0 ? 100 + balance : 100);
    const enabled = balance !== 0;
    if (enabled !== this.state.enabled || (enabled && this.state.error))
      void this.setEnabled(enabled);
  }
  private async process(request: string, packet: MssPacket) {
    const node = this.node,
      generation = this.generation;
    if (!this.runtimeReady || !this.state.enabled) {
      node?.port.postMessage({ type: 'dropped', request });
      return;
    }
    try {
      const result = await window.api.stemSeparation.infer(packet);
      if (generation !== this.generation || !this.state.enabled) return;
      node?.port.postMessage({ type: 'result', request, result }, [result.vocals.buffer]);
      this.update({ inferenceMs: result.inferenceMs });
    } catch (error) {
      node?.port.postMessage({ type: 'dropped', request });
      if (generation !== this.generation || !this.state.enabled) return;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('MSS_BUSY')) {
        this.runtimeReady = false;
        this.update({ enabled: false, loading: false, ready: false, error: message });
        this.sendMix();
        void window.api.stemSeparation.setEnabled(false).catch(() => {});
      }
    }
  }
  private ensureMixer(): Promise<void> {
    if (this.node) return Promise.resolve();
    this.mixerPromise ??= (async () => {
      if (this.context.sampleRate !== MSS_SAMPLE_RATE)
        throw new Error('分轨需要 48 kHz 音频上下文，请重启播放器');
      await this.context.audioWorklet.addModule(workletUrl);
      if (this.destroyed) return;
      const node = new AudioWorkletNode(this.context, 'coloros-mss-remixer', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 4,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete'
      });
      if (!this.source || !this.destination) {
        node.disconnect();
        throw new Error('Audio source unavailable');
      }
      node.port.onmessage = ({ data }) => {
        if (data.type === 'infer') void this.process(data.request, data.packet);
        else if (data.type === 'status' && this.state.enabled && !this.state.cached)
          this.update({ ready: data.ready, underrunFrames: data.underrunFrames });
      };
      node.onprocessorerror = () => {
        this.runtimeReady = false;
        this.update({ enabled: false, ready: false, error: '分轨混音异常，请重新开启' });
        this.source?.disconnect(node);
        node.disconnect();
        node.port.close();
        if (this.destination) this.source?.connect(this.destination);
        this.node = null;
        this.releaseMixer();
        this.mixerPromise = null;
        void window.api.stemSeparation.setEnabled(false).catch(() => {});
      };
      this.source.disconnect(this.destination);
      this.source.connect(node);
      node.connect(this.destination);
      this.node = node;
      this.setPlaying(this.playing);
      this.sendMix();
    })();
    return this.mixerPromise;
  }
  private releaseMixer() {
    if (!this.node) return;
    this.source?.disconnect();
    this.node.port.onmessage = null;
    this.node.port.close();
    this.node.disconnect();
    this.node = null;
    this.mixerPromise = null;
    if (this.source && this.destination) this.source.connect(this.destination);
  }
  async setEnabled(enabled: boolean) {
    const generation = ++this.generation;
    this.runtimeReady = false;
    this.update({ enabled, loading: enabled, error: '', ready: false, underrunFrames: 0 });
    this.sendMix();
    try {
      await window.api.stemSeparation.setEnabled(enabled);
      if (generation !== this.generation || this.destroyed) return;
      if (enabled) {
        await this.ensureMixer();
        if (generation !== this.generation || this.destroyed) return;
        this.runtimeReady = true;
      }
      this.update({ loading: false, ready: this.state.cached });
      this.sendMix();
      if (enabled && this.currentTrack)
        void window.api.stemSeparation.setCurrent(this.currentTrack);
      this.onEnabledChange?.(enabled);
      if (!enabled) this.releaseMixer();
    } catch (error) {
      if (generation !== this.generation || this.destroyed) return;
      this.runtimeReady = false;
      this.update({
        enabled: false,
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      });
      this.sendMix();
      await window.api.stemSeparation.setEnabled(false).catch(() => {});
      this.mixerPromise = null;
    }
  }
  destroy() {
    this.destroyed = true;
    ++this.generation;
    this.runtimeReady = false;
    this.node?.port.postMessage({ type: 'mix', enabled: false, vocals: 1, accompaniment: 1 });
    this.node?.disconnect();
    this.listeners.clear();
    this.removeCacheListener();
    void window.api.stemSeparation.setEnabled(false).catch(() => {});
  }
}
