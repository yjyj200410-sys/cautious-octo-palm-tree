export const MSS_SAMPLE_RATE = 48000;
export const MSS_FFT = 2048;
export const MSS_HOP = 512;
export const MSS_STEPS = 8;
export const MSS_BATCH = MSS_HOP * MSS_STEPS;
export const MSS_HISTORY = MSS_FFT - MSS_HOP;
export const MSS_LATENCY = MSS_BATCH * 2;
export const MSS_MODEL_SHA256 = 'c4e52f3d5e2c7d46d72ffffe16ea5a126c6bb8d034fd5f5e2fd0f04c2e1b3ff7';

export interface MssPacket {
  epoch: number;
  start: number;
  pcm: Float32Array<ArrayBuffer>;
}
export interface MssResult {
  epoch: number;
  start: number;
  vocals: Float32Array<ArrayBuffer>;
  validOffset: number;
  inferenceMs: number;
}
export interface MssRuntimeInfo {
  sampleRate: number;
  latencyFrames: number;
  modelBytes: number;
}

export interface MssTrack {
  songId: number;
  path: string;
  title: string;
  duration?: number;
  trial: boolean;
  quality: string;
}
export interface MssPreparedTrack {
  songId: number;
  url: string;
  originalPath: string;
  trial: boolean;
  quality: string;
  frames: number;
}
export interface MssCacheStatus {
  songId: number;
  quality: string;
  phase: 'processing' | 'ready' | 'error';
  progress: number;
  prepared?: MssPreparedTrack;
  error?: string;
}
