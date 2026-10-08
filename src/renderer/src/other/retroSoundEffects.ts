export type RetroEffectMode = 'gramophone' | 'vinyl' | 'cassette' | 'radio' | 'cd';

// Listening presets inspired by playback media, rather than a model of a specific device.
export const retroProfiles = {
  gramophone: {
    highpass: 180,
    lowpass: 2800,
    presence: 3,
    drive: 2.2,
    mono: true,
    noise: 0.004,
    crackle: 0.00028,
    wow: 0.00035,
    flutter: 0.00004
  },
  vinyl: {
    highpass: 35,
    lowpass: 12500,
    presence: -0.8,
    drive: 1.25,
    mono: false,
    noise: 0.0015,
    crackle: 0.0001,
    wow: 0.0002,
    flutter: 0.000015
  },
  cassette: {
    highpass: 65,
    lowpass: 7500,
    presence: -1.5,
    drive: 1.65,
    mono: false,
    noise: 0.0024,
    crackle: 0,
    wow: 0.0005,
    flutter: 0.000065
  },
  radio: {
    highpass: 260,
    lowpass: 3800,
    presence: 3.5,
    drive: 1.8,
    mono: true,
    noise: 0.0018,
    crackle: 0,
    wow: 0,
    flutter: 0
  },
  cd: {
    highpass: 20,
    lowpass: 20000,
    presence: 0,
    drive: 0,
    mono: false,
    noise: 0,
    crackle: 0,
    wow: 0,
    flutter: 0
  }
} satisfies Record<
  RetroEffectMode,
  {
    highpass: number;
    lowpass: number;
    presence: number;
    drive: number;
    mono: boolean;
    noise: number;
    crackle: number;
    wow: number;
    flutter: number;
  }
>;

export function isRetroEffect(mode: string): mode is RetroEffectMode {
  return Object.hasOwn(retroProfiles, mode);
}

export class RetroSoundEffect {
  readonly input: GainNode;
  readonly output: GainNode;
  private nodes: AudioNode[] = [];
  private sources: (AudioBufferSourceNode | OscillatorNode)[] = [];
  private analyser: AnalyserNode | null = null;
  private noiseGate: GainNode | null = null;
  private samples = new Float32Array(256);
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private context: BaseAudioContext;

  constructor(context: BaseAudioContext, mode: RetroEffectMode) {
    this.context = context;
    const profile = retroProfiles[mode];
    this.input = this.keep(context.createGain());
    this.output = this.keep(context.createGain());
    if (profile.mono) {
      this.input.channelCount = 1;
      this.input.channelCountMode = 'explicit';
      this.input.channelInterpretation = 'speakers';
    }
    this.analyser = this.keep(context.createAnalyser());
    this.analyser.fftSize = this.samples.length;
    const highpass = this.filter('highpass', profile.highpass);
    const lowpass = this.filter('lowpass', profile.lowpass);
    const presence = this.filter('peaking', 1400, profile.presence);
    this.input.connect(this.analyser).connect(highpass).connect(lowpass).connect(presence);
    let tail: AudioNode = presence;
    if (profile.drive > 0) {
      const saturation = this.keep(context.createWaveShaper());
      const curve = new Float32Array(8193);
      // Normalize small-signal gain to avoid making a preset win just by being louder.
      for (let n = 0; n < curve.length; n++) {
        const x = (n / (curve.length - 1)) * 2 - 1;
        curve[n] = Math.tanh(x * profile.drive) / profile.drive;
      }
      saturation.curve = curve;
      saturation.oversample = '2x';
      tail.connect(saturation);
      tail = saturation;
    }
    if (profile.wow > 0) {
      const delay = this.keep(context.createDelay(0.02));
      delay.delayTime.value = 0.004;
      tail.connect(delay);
      tail = delay;
      this.modulate(delay.delayTime, 0.55, profile.wow);
      this.modulate(delay.delayTime, 6.2, profile.flutter);
    }
    const compressor = this.keep(context.createDynamicsCompressor());
    compressor.threshold.value = mode === 'radio' ? -20 : -10;
    compressor.knee.value = 12;
    compressor.ratio.value = mode === 'radio' ? 3 : 1.5;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.15;
    tail.connect(compressor).connect(this.output);
    if (profile.noise > 0) {
      const buffer = context.createBuffer(
        1,
        Math.floor(context.sampleRate * 4),
        context.sampleRate
      );
      const data = buffer.getChannelData(0);
      let colored = 0;
      for (let n = 0; n < data.length; n++) {
        colored = colored * 0.82 + (Math.random() * 2 - 1) * 0.18;
        const click = Math.random() < profile.crackle ? (Math.random() * 2 - 1) * 0.025 : 0;
        data[n] = colored * profile.noise + click;
      }
      const source = this.keep(context.createBufferSource());
      source.buffer = buffer;
      source.loop = true;
      const noiseFilter = this.filter('lowpass', Math.min(profile.lowpass, 8500));
      this.noiseGate = this.keep(context.createGain());
      this.noiseGate.gain.value = 0;
      source.connect(noiseFilter).connect(this.noiseGate).connect(compressor);
      this.sources.push(source);
      source.start();
    }
  }
  private keep<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }
  private filter(type: BiquadFilterType, frequency: number, gain = 0) {
    const filter = this.keep(this.context.createBiquadFilter());
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.707;
    filter.gain.value = gain;
    return filter;
  }
  private modulate(parameter: AudioParam, frequency: number, depth: number) {
    const oscillator = this.keep(this.context.createOscillator());
    const gain = this.keep(this.context.createGain());
    oscillator.frequency.value = frequency;
    gain.gain.value = depth;
    oscillator.connect(gain).connect(parameter);
    this.sources.push(oscillator);
    oscillator.start();
  }
  setPlaying(playing: boolean) {
    if (this.disposed) return;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (!this.noiseGate || !this.analyser) return;
    this.noiseGate.gain.cancelScheduledValues(this.context.currentTime);
    this.noiseGate.gain.setTargetAtTime(0, this.context.currentTime, 0.008);
    if (!playing) return;
    const updateGate = () => {
      if (this.disposed || !this.analyser || !this.noiseGate) return;
      this.analyser.getFloatTimeDomainData(this.samples);
      let energy = 0;
      for (const sample of this.samples) energy += sample * sample;
      const audible = energy / this.samples.length > 0.000001;
      this.noiseGate.gain.setTargetAtTime(audible ? 1 : 0, this.context.currentTime, 0.012);
    };
    updateGate();
    this.timer = setInterval(updateGate, 40);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const source of this.sources) source.stop();
    for (const node of this.nodes) node.disconnect();
    this.sources = [];
    this.nodes = [];
    this.analyser = null;
    this.noiseGate = null;
  }
}
