/** Small, lazy audio tap used only by backgrounds; lyrics never depend on it. */
let analyser: AnalyserNode | undefined;
let source: AudioNode | undefined;
const samples = new Uint8Array(256);
export function getBackgroundPulse(): number {
  const player = (window as unknown as { __noraPlayer?: { audio?: HTMLAudioElement; gainNode?: GainNode } }).__noraPlayer;
  if (!player?.gainNode || player.audio?.paused || document.hidden) return 0;
  if (source !== player.gainNode) {
    if (source && analyser) { try { source.disconnect(analyser); } catch { /* Previous graph disposed. */ } }
    analyser?.disconnect();
    source = player.gainNode;
    analyser = source.context.createAnalyser();
    analyser.fftSize = samples.length;
    source.connect(analyser);
  }
  analyser!.getByteTimeDomainData(samples);
  let energy = 0;
  for (const sample of samples) energy += ((sample - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(energy / samples.length) * 4);
}
