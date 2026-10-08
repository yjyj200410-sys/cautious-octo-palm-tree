// Bounded audio-clock rings: delayed dry audio and matching model vocals.
const BATCH = 4096;
const LATENCY = 8192;
const RING = 32768;
class ColorOSMssProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = false;
    this.playing = false;
    this.cached = false;
    this.epoch = 0;
    this.position = 0;
    this.batch = new Float32Array(BATCH * 2);
    this.dry = [new Float32Array(RING), new Float32Array(RING)];
    this.voice = [new Float32Array(RING), new Float32Array(RING)];
    this.tags = new Float64Array(RING);
    this.tags.fill(-1);
    this.pending = new Set();
    this.voiceTarget = this.voiceGain = 1;
    this.backingTarget = this.backingGain = 1;
    this.coverage = 0;
    this.limiter = 1;
    this.underruns = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'mix') {
        const changed = this.enabled !== data.enabled || this.cached !== !!data.cached;
        this.enabled = !!data.enabled;
        this.cached = !!data.cached;
        this.voiceTarget = data.vocals;
        this.backingTarget = data.accompaniment;
        if (changed) this.reset();
      } else if (data.type === 'playing') {
        if (this.playing !== data.playing) {
          this.playing = !!data.playing;
          this.reset();
        }
      } else if (data.type === 'reset') this.reset();
      else if (data.type === 'result') {
        const result = data.result;
        this.pending.delete(data.request);
        if (result.epoch !== this.epoch) return;
        for (let n = result.validOffset; n < BATCH; n++) {
          const position = result.start + n;
          // Never let a late answer overwrite samples still awaiting playback.
          if (position < Math.max(0, this.position - LATENCY) || position >= this.position + RING)
            continue;
          const index = position % RING;
          this.voice[0][index] = result.vocals[n];
          this.voice[1][index] = result.vocals[BATCH + n];
          this.tags[index] = position;
        }
      } else if (data.type === 'dropped') this.pending.delete(data.request);
    };
  }
  reset() {
    ++this.epoch;
    this.position = 0;
    this.batch.fill(0);
    this.tags.fill(-1);
    this.pending.clear();
    this.coverage = 0;
    this.limiter = 1;
    this.underruns = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0] ?? [],
      output = outputs[0];
    if (!output?.length) return true;
    for (let n = 0; n < output[0].length; n++) {
      const left = input[0]?.[n] ?? 0,
        right = input[1]?.[n] ?? left;
      let l = left,
        r = right;
      if (this.enabled && this.playing && this.cached) {
        this.voiceGain += (this.voiceTarget - this.voiceGain) * 0.001;
        this.backingGain += (this.backingTarget - this.backingGain) * 0.001;
        const voiceScale = this.voiceGain - this.backingGain;
        l = this.backingGain * left + voiceScale * (input[2]?.[n] ?? 0);
        r = this.backingGain * right + voiceScale * (input[3]?.[n] ?? 0);
      } else if (this.enabled && this.playing) {
        const position = this.position++,
          index = position % RING,
          batchIndex = position % BATCH;
        this.dry[0][index] = left;
        this.dry[1][index] = right;
        this.batch[batchIndex] = left;
        this.batch[BATCH + batchIndex] = right;
        if (batchIndex === BATCH - 1 && this.pending.size < 2) {
          const start = position - BATCH + 1,
            request = `${this.epoch}:${start}`;
          const pcm = this.batch;
          this.batch = new Float32Array(BATCH * 2);
          this.pending.add(request);
          this.port.postMessage(
            { type: 'infer', request, packet: { epoch: this.epoch, start, pcm } },
            [pcm.buffer]
          );
        }
        const target = position - LATENCY;
        if (target < 0) {
          l = 0;
          r = 0;
        } else {
          const at = target % RING,
            available = this.tags[at] === target;
          const goal = available ? 1 : 0;
          this.coverage += (goal - this.coverage) * 0.002;
          if (!available) this.underruns++;
          this.voiceGain += (this.voiceTarget - this.voiceGain) * 0.001;
          this.backingGain += (this.backingTarget - this.backingGain) * 0.001;
          const voiceScale = (this.voiceGain - this.backingGain) * this.coverage;
          const fallbackGain = Math.min(1, Math.max(this.voiceGain, this.backingGain));
          const dryScale = fallbackGain + (this.backingGain - fallbackGain) * this.coverage;
          l = dryScale * this.dry[0][at] + voiceScale * (available ? this.voice[0][at] : 0);
          r = dryScale * this.dry[1][at] + voiceScale * (available ? this.voice[1][at] : 0);
        }
        if (this.position % 48000 === 0)
          this.port.postMessage({
            type: 'status',
            ready: target >= 0,
            underrunFrames: this.underruns,
            position: this.position
          });
      } else if (this.enabled && !this.playing) {
        l = 0;
        r = 0;
      }
      const peak = Math.max(Math.abs(l), Math.abs(r)),
        needed = peak > 1 ? 1 / peak : 1;
      this.limiter = needed < this.limiter ? needed : Math.min(needed, this.limiter + 0.0002);
      output[0][n] = l * this.limiter;
      if (output[1]) output[1][n] = r * this.limiter;
    }
    return true;
  }
}
registerProcessor('coloros-mss-remixer', ColorOSMssProcessor);
