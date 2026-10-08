import { useEffect, useRef } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store/store';

interface Props {
  src: string;
  wallpaperId?: string;
}

const AUDIO_BANDS = 5;
const PORT = 25885;
const DEFAULT_COLORS = ['#ff6b9d', '#c44dff', '#4dc9f6', '#f9ca24', '#6c5ce7'];

function toWallpaperUrl(src: string, wallpaperId?: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  const id = wallpaperId || src.replace(/\\/g, '/').split('/').slice(-2, -1)[0] || 'default';
  const file = src.replace(/\\/g, '/').split('/').pop() || 'index.html';
  return `http://127.0.0.1:${PORT}/wallpaper/${id}/${file}`;
}

export default function WebWallpaperFrame({ src, wallpaperId }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ── Read wallpaper config from preferences ──────────────
  const webColors: string[] = useStore(store, (s) =>
    (s.localStorage.preferences as any)?.webWallpaperColors ?? DEFAULT_COLORS
  );
  const webIntensity: number = useStore(store, (s) =>
    (s.localStorage.preferences as any)?.webWallpaperIntensity ?? 28
  );
  const webSensitivity: number = useStore(store, (s) =>
    (s.localStorage.preferences as any)?.webWallpaperSensitivity ?? 28
  );

  // ── Send config to iframe whenever it changes ───────────
  const sendConfig = () => {
    const iframe = iframeRef.current;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'nora:config',
        colors: webColors,
        intensity: webIntensity / 100,
        sensitivity: webSensitivity / 100,
      }, '*');
    }
  };

  // Send config on mount + when preferences change
  useEffect(() => { sendConfig(); }, [webColors, webIntensity, webSensitivity]);

  // ── Audio connection ────────────────────────────────────
  useEffect(() => {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.5;
    analyser.minDecibels = -80;
    analyser.maxDecibels = -10;

    let lastAudio: HTMLAudioElement | null = null;
    let lastSrc = '';
    let lastSource: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
    let silentFrames = 0;
    const connectPlayer = () => {
      const player = (window as any).__noraPlayer;
      if (!player || player.audio !== lastAudio) { lastAudio = null; lastSrc = ''; }
      if (!player?.audio) return;
      const audio = player.audio as HTMLAudioElement;
      if (audio === lastAudio && audio.src === lastSrc && silentFrames < 120) return;
      if (lastSource) { try { lastSource.disconnect(); } catch { /* */ } lastSource = null; }
      try {
        const stream = (audio as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream?.() ?? (audio as any).mozCaptureStream?.();
        if (stream) { lastSource = ctx.createMediaStreamSource(stream); lastSource.connect(analyser); lastAudio = audio; lastSrc = audio.src; silentFrames = 0; return; }
      } catch { /* */ }
      try { lastSource = ctx.createMediaElementSource(audio); lastSource.connect(analyser); lastAudio = audio; lastSrc = audio.src; silentFrames = 0; } catch { /* */ }
    };
    connectPlayer();
    const retry = setInterval(connectPlayer, 2000);

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    const binCount = freqData.length;
    const spectrum = new Array<number>(binCount);
    const bandSize = Math.floor(binCount / AUDIO_BANDS);
    let raf = 0;
    let sentCount = 0;
    const feed = () => {
      const iframe = iframeRef.current;
      if (iframe?.contentWindow) {
        analyser.getByteFrequencyData(freqData);
        let hasSound = false;
        for (let i = 0; i < binCount; i++) { spectrum[i] = freqData[i] / 255; if (freqData[i] > 5) hasSound = true; }
        silentFrames = hasSound ? 0 : silentFrames + 1;
        const bands: Record<string,number> = {};
        const bandNames = ['bass','lowMid','mid','highMid','treble'];
        for (let b = 0; b < AUDIO_BANDS; b++) {
          let sum = 0;
          const start = b * bandSize;
          const end = b === AUDIO_BANDS - 1 ? binCount : start + bandSize;
          for (let i = start; i < end; i++) sum += spectrum[i];
          bands[bandNames[b]] = sum / (end - start);
        }
        iframe.contentWindow.postMessage({
          type: 'nora:audioLevels',
          spectrum,
          bands
        }, '*');
        sentCount++;
        if (sentCount <= 3) console.log('[Nora WF] spectrum sent bins='+binCount, bands);
      } else {
        if (sentCount === 0) console.warn('[Nora WF] iframe.contentWindow not available');
      }
      raf = requestAnimationFrame(feed);
    };
    feed();

    return () => { clearInterval(retry); cancelAnimationFrame(raf); analyser.disconnect(); ctx.close().catch(() => {}); };
  }, [src]);

  const url = toWallpaperUrl(src, wallpaperId);

  return (
    <iframe
      ref={iframeRef}
      key={url}
      className="absolute inset-0 z-0 h-full w-full border-none"
      src={url}
      allow="autoplay"
      title="Wallpaper Engine"
      onLoad={() => {
        // Resend config after iframe (re)loads
        setTimeout(() => sendConfig(), 100);
      }}
    />
  );
}
