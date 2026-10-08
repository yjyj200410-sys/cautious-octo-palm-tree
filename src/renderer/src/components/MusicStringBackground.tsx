/** Layered, anchored strings; settings update without restarting the audio graph. */
import { useEffect, useRef } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store/store';

const DEFAULT_COLORS = ['#ff6b9d', '#c44dff', '#4dc9f6', '#f9ca24', '#6c5ce7'];
type WallpaperPreferences = { webWallpaperColors?: string[]; webWallpaperIntensity?: number; webWallpaperSensitivity?: number };

export default function MusicStringBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const preferences = useStore(store, (s) => s.localStorage.preferences) as WallpaperPreferences | undefined;
  const configRef = useRef({ colors: DEFAULT_COLORS, intensity: 0.28, sensitivity: 0.28 });
  useEffect(() => {
    const colors = preferences?.webWallpaperColors?.filter((color) => /^#[0-9a-f]{6}$/i.test(color));
    configRef.current = {
      colors: colors?.length ? colors : DEFAULT_COLORS,
      intensity: Math.max(0, Math.min(1, (preferences?.webWallpaperIntensity ?? 28) / 100)),
      sensitivity: Math.max(0, Math.min(1, (preferences?.webWallpaperSensitivity ?? 28) / 100)),
    };
  }, [preferences]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let width = 1, height = 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    // Capture an independent stream; never reroute the player's audible output.
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    let source: MediaStreamAudioSourceNode | null = null;
    let stream: MediaStream | null = null;
    let lastAudio: HTMLAudioElement | null = null;
    let lastSrc = '';
    const disconnect = () => { source?.disconnect(); stream?.getTracks().forEach((track) => track.stop()); source = null; stream = null; };
    const connect = () => {
      const player = (window as unknown as { __noraPlayer?: { audio?: HTMLAudioElement & { captureStream?: () => MediaStream } } }).__noraPlayer;
      const audio = player?.audio;
      if (!audio) { disconnect(); lastAudio = null; lastSrc = ''; return; }
      if (source && audio === lastAudio && audio.src === lastSrc) return;
      disconnect();
      try {
        stream = audio.captureStream?.() ?? null;
        if (stream && stream.getAudioTracks().length) {
          source = audioContext.createMediaStreamSource(stream); source.connect(analyser);
          lastAudio = audio; lastSrc = audio.src;
          void audioContext.resume().catch(() => {});
        }
      } catch { disconnect(); }
    };
    connect(); const retry = setInterval(connect, 2000);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    const levels = [0, 0, 0, 0, 0];
    let frame = 0, lastTime = 0, time = 0;
    const render = (now: number) => {
      frame = requestAnimationFrame(render);
      if (document.hidden) { lastTime = now; return; }
      if (now - lastTime < 1000 / 30) return;
      const dt = Math.min(0.08, (now - (lastTime || now)) / 1000); lastTime = now;
      const { colors, intensity, sensitivity } = configRef.current;
      if (!reducedMotion.matches) time += dt * intensity;
      analyser.getByteFrequencyData(spectrum);
      for (let band = 0; band < 5; band++) {
        const start = Math.floor(band * spectrum.length / 5), end = Math.floor((band + 1) * spectrum.length / 5);
        let sum = 0; for (let bin = start; bin < end; bin++) sum += spectrum[bin] / 255;
        const target = reducedMotion.matches ? 0 : sum / (end - start);
        levels[band] += (target - levels[band]) * (1 - Math.exp(-dt * 5));
      }
      ctx.fillStyle = '#060811'; ctx.fillRect(0, 0, width, height);
      const ambient = ctx.createRadialGradient(width * 0.35, height * 0.65, 0, width * 0.35, height * 0.65, width * 0.7);
      ambient.addColorStop(0, `${colors[0]}18`); ambient.addColorStop(1, `${colors[0]}00`);
      ctx.fillStyle = ambient; ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = 'screen';
      // Three strands per voice form a fan, with a quiet center for the player UI.
      for (let voice = 0; voice < 5; voice++) {
        const color = colors[voice % colors.length];
        const amplitude = height * (0.025 + intensity * 0.055 + levels[voice] * sensitivity * intensity * 0.32);
        for (let strand = 0; strand < 3; strand++) {
          const path = new Path2D();
          for (let step = 0; step <= 160; step++) {
            const u = step / 160, envelope = Math.sin(u * Math.PI);
            const base = height * (0.77 - u * 0.39 + (voice - 2) * (0.026 + u * 0.022));
            const wave = Math.sin(u * Math.PI * (2.2 + voice * 0.24) - time * (0.7 + voice * 0.08) + voice * 0.55);
            const harmonic = Math.sin(u * Math.PI * 6 + time * 0.8 + strand * 0.6) * 0.12;
            const y = base + (wave + harmonic) * envelope * amplitude + (strand - 1) * height * 0.006 * envelope;
            if (step === 0) path.moveTo(0, y); else path.lineTo(u * width, y);
          }
          const ink = ctx.createLinearGradient(0, 0, width, 0);
          ink.addColorStop(0, `${color}00`); ink.addColorStop(0.2, `${color}88`);
          ink.addColorStop(0.65, `${color}bb`); ink.addColorStop(1, `${color}00`);
          ctx.strokeStyle = ink;
          ctx.globalAlpha = strand === 1 ? 0.85 : 0.3;
          ctx.lineWidth = strand === 1 ? 1.2 : 0.65; ctx.stroke(path);
          if (strand === 1) { ctx.globalAlpha = 0.08; ctx.lineWidth = 7; ctx.stroke(path); }
        }
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    };
    frame = requestAnimationFrame(render);
    return () => { observer.disconnect(); clearInterval(retry); cancelAnimationFrame(frame); disconnect(); analyser.disconnect(); void audioContext.close().catch(() => {}); };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
}
