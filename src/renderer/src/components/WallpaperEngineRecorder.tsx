/**
 * WallpaperEngineRecorder — launch a WE Scene wallpaper in a window,
 * record N seconds at high quality via MediaRecorder, save as video background.
 *
 * Capture strategy: single path.  The WE scene window is pinned to the top-left
 * at a fixed 1700×956 (1920×1080 × 0.885, kept 16:9) so the taskbar / mouse /
 * other desktop content never enter the crop region.  getDisplayMedia() captures
 * the WHOLE screen (WGC backend, auto-granted by the main process), a hidden
 * video receives the frame, and a canvas copies only the WE window's verified
 * PHYSICAL-pixel rect (returned by IPC weSetWindowRect after a Win32
 * SetWindowPos + immediate GetWindowRect on the same per-monitor-v2 thread; the
 * crop maps 1:1 — no DPI scaling, no preset fallback).  The canvas feeds
 * canvas.captureStream(30) → MediaRecorder → WebM.
 *
 * Before recording, content is probed: if the crop is still pure black after 8s
 * (window promoted to an MPO overlay plane, scene failed to render, wrong
 * monitor), the recording is aborted WITHOUT writing a file and diagnostics are
 * dumped so the actual capture content can be inspected.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import storage from '../utils/localStorage';

type State = 'idle' | 'launching' | 'recording' | 'saving';

interface Props {
  wallpaperPath: string;
  wallpaperTitle: string;
  onDone: () => void;
  onClose?: () => void;
}

export default function WallpaperEngineRecorder({ wallpaperPath, wallpaperTitle, onDone, onClose }: Props) {

  const [state, setState] = useState<State>('idle');
  const [duration, setDuration] = useState(10);
  const [timeLeft, setTimeLeft] = useState(10);
  const [error, setError] = useState('');
  const [startCountdown, setStartCountdown] = useState<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const windowTitleRef = useRef('');
  // Cleanup for the live capture (rAF / stream / DOM nodes created inside start).
  const stopCaptureRef = useRef<(() => void) | null>(null);

  // On unmount (user closed the panel mid-recording) release the capture.
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      stopCaptureRef.current?.();
    };
  }, []);

  const start = useCallback(async () => {
    try {
      setError('');
      setStartCountdown(null);
      setState('launching');

      // Exit fullscreen & minimize main window so WE window is on top
      window.api.settingsHelpers.exitFullscreen();
      await new Promise(resolve => setTimeout(resolve, 200)); // let fullscreen exit settle
      window.api.settingsHelpers.minimizeForRecording();
      await new Promise(resolve => setTimeout(resolve, 400)); // let minimize settle

      // Scene wallpaper: best-effort strip of time/date/weather plugins happens
      // on a TEMP COPY in the main process (original project untouched).  Falls
      // back to the original path when nothing to strip or the copy fails.
      const launchPath = await window.api.settingsHelpers
        .wePrepareScene(wallpaperPath)
        .catch(() => wallpaperPath);

      // Recording window geometry — base 1920×1080 × 0.885, kept 16:9, pinned to
      // the top-left corner via Win32 below (WE ignores its own -width/-height at
      // near-fullscreen sizes).  Size matters: a window that OVERLAPS the whole
      // screen gets promoted to an MPO hardware overlay plane that no capture
      // path can read (pure black).  1786×1004 still occasionally hit MPO;
      // 1700×956 tested more stable, so we use that.
      const width = 1700;
      const height = 956;

      // 1. Launch WE window (main process).  windowTitle identifies the window.
      const { windowTitle } = await window.api.settingsHelpers.weLaunchWindow(
        launchPath,
        width,
        height,
      );
      windowTitleRef.current = windowTitle;

      await window.api.settingsHelpers.weHideCursor();
      setState('recording');

      // 2. Wait for the scene to settle, then pin the window to (0,0) at the
      //    exact recording size via Win32.  setWindowRectByTitle sets per-monitor-v2
      //    DPI awareness on ITS OWN thread, so the returned rect is the VERIFIED
      //    PHYSICAL-pixel rectangle (GetWindowRect called immediately after
      //    SetWindowPos, same thread — no virtualized logical coords).  The crop
      //    below uses this rect 1:1: no DPI re-scale, no preset fallback.
      setTimeLeft(-4);
      await new Promise(resolve => setTimeout(resolve, 2500));
      const rect = await window.api.settingsHelpers
        .weSetWindowRect(windowTitle, 0, 0, width, height)
        .catch(() => null);
      console.log('[WE录制] WE窗口物理像素矩形', rect);
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        throw new Error('未能取得 WE 窗口的实际物理像素矩形（SetWindowPos/GetWindowRect 验证失败）');
      }

      // 2b. Force DWM to recomposite the window — nudge (0,0) → (1,0) → (0,0)
      //     with SWP_NOSENDCHANGING|SWP_NOACTIVATE — so it doesn't stay cached
      //     in an MPO overlay plane, then wait 3s for DWM to finish compositing
      //     and WE to finish GPU-rendering the scene before starting capture.
      await window.api.settingsHelpers.weNudgeWindow(windowTitle, 0, 0).catch(() => {});
      console.log('[WE录制] 等待DWM合成 + WE GPU渲染 3s...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      const screenW = window.screen.width || 1920;
      const screenH = window.screen.height || 1080;

      // Target capture/draw/encode rate.  60 is the realistic ceiling for this
      // pipeline: Chromium's WGC screen capture delivers at most ~60fps, and the
      // MediaRecorder VP9 path is a SOFTWARE encoder that cannot keep up with
      // 1700×956 at 144fps in real time (it would silently drop frames).  The
      // wallpaper still renders at the monitor's refresh rate on screen; only the
      // recorded FILE is capped at this rate.
      const RECORD_FPS = 60;

      // 3. Single capture path: whole screen via getDisplayMedia().  The main
      //    process auto-grants the display containing the WE window through
      //    session.setDisplayMediaRequestHandler (no system picker).  WGC screen
      //    capture is the backend that includes GPU-rendered / DWM-composited
      //    content that the DXGI getUserMedia('desktop') path returns as black.
      let screenStream: MediaStream;
      try {
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          audio: false,
          video: { frameRate: RECORD_FPS },
        } as DisplayMediaStreamOptions);
      } catch (e: any) {
        throw new Error('屏幕捕获失败: ' + (e?.name || String(e)));
      }

      // What did the handler actually grant?  displaySurface === 'monitor' means a
      // SCREEN capture; 'window'/'browser' means a window source slipped through
      // (would explain a black full-frame dump: a background window that isn't the
      // WE window).  Fail fast and loudly instead of writing black WebM.
      const grantedSettings = screenStream.getVideoTracks()[0]?.getSettings() || {};
      console.log('[WE录制] 授权源 getSettings', grantedSettings);
      if (grantedSettings.displaySurface && grantedSettings.displaySurface !== 'monitor') {
        throw new Error(
          `getDisplayMedia 授权了非屏幕源（displaySurface=${grantedSettings.displaySurface}），` +
          `捕获的是窗口而非屏幕，已中止录制。`,
        );
      }

      // Hidden <video> receiving the whole-screen stream.  Attach it to the DOM
      // (invisible but full-sized) so the decoder always runs — a detached or
      // 1px element can stall on some Chromium builds and never deliver a frame.
      // play() is fire-and-forget: awaiting it stays PENDING until the first
      // frame arrives, which hangs the whole recorder if the stream never
      // delivers one (exactly the freeze seen at "准备录制 4s").  The video is
      // also swappable (`let`) so the prep loop can rebuild it on a fresh stream.
      const makeVideo = (stream: MediaStream): HTMLVideoElement => {
        const v = document.createElement('video');
        v.autoplay = true;
        v.muted = true;
        v.playsInline = true;
        v.style.position = 'fixed';
        v.style.left = '-500px';
        v.style.top = '-500px';
        v.style.width = '320px';
        v.style.height = '180px';
        v.style.opacity = '0';
        v.style.pointerEvents = 'none';
        document.body.appendChild(v);
        v.srcObject = stream;
        v.play().catch((e: any) => console.warn('[WE录制] video.play() 失败', e?.name || String(e)));
        return v;
      };

      let video = makeVideo(screenStream);
      // Never block the recorder on stream startup: race the first frame against
      // a 3s timeout, log the outcome, and let the prep loop drive from here.
      await Promise.race([
        new Promise<void>((resolve) => {
          video.onloadedmetadata = () => { console.log('[WE录制] video onloadedmetadata'); resolve(); };
          video.onerror = () => { console.warn('[WE录制] video error', video.error); resolve(); };
        }),
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);
      const capW = video.videoWidth || screenW;
      const capH = video.videoHeight || screenH;
      console.log('[WE录制] 屏幕捕获', {
        videoWidth: capW,
        videoHeight: capH,
        screenW,
        screenH,
        displaySurface: grantedSettings.displaySurface,
        readyState: video.readyState,
      });

      // The rect from weSetWindowRect is in PHYSICAL pixels, and the
      // screen-capture frame (videoWidth/Height) is also physical → the crop maps
      // 1:1.  Clamp defensively in case the window extends past the display edge.
      const x = Math.max(0, Math.min(capW - 1, Math.floor(rect.x)));
      const y = Math.max(0, Math.min(capH - 1, Math.floor(rect.y)));
      const w = Math.max(1, Math.min(capW - x, Math.floor(rect.width)));
      const h = Math.max(1, Math.min(capH - y, Math.floor(rect.height)));
      console.log('[WE录制] 最终裁剪区域', { x, y, w, h });

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      // 640px-wide full-frame snapshot for the black-failure diagnostic.
      const dumpCanvas = document.createElement('canvas');
      dumpCanvas.width = 640;
      dumpCanvas.height = Math.max(1, Math.round((capH * 640) / capW));
      const dumpCtx = dumpCanvas.getContext('2d')!;
      console.log('[WE录制] canvas尺寸', { width: canvas.width, height: canvas.height });

      let drawTimer = 0; // setInterval id — NOT a rAF id (see below)
      // True once the video has delivered a decodable frame.  If it stays false
      // the whole 8s prep, the failure is in the STREAM/DECODER stage, not MPO.
      let videoEverReady = false;
      // Draw-rate metering: the output FPS equals how often we redraw the canvas.
      // A ~1s log pins a choppy recording to (a) a slow draw loop vs (b) a
      // low-fps WGC source, instead of guessing.
      let drawsInWindow = 0;
      let fpsWindowStart = performance.now();
      let lastFpsLog = performance.now();

      // Drive the draw loop with setInterval (~30fps), NOT requestAnimationFrame.
      // rAF is driven by Chromium's BeginFrame, which an occluded transparent
      // window may not get at full rate even with backgroundThrottling:false —
      // that's the "readyState=4 yet canvas stays black" failure class.  JS timers
      // are task-based and demonstrably fire here (the prep loop's 300ms ticks
      // keep coming while WE covers the window), so they keep feeding the canvas
      // at a steady ~30fps.  The swap-friendly design: drawFrame reads the current
      // `video` binding, so a retry that replaces the element needs no re-kick.
      const drawFrame = () => {
        if (video.readyState >= 2) {
          videoEverReady = true;
          ctx.drawImage(video, x, y, w, h, 0, 0, w, h);
          dumpCtx.drawImage(video, 0, 0, dumpCanvas.width, dumpCanvas.height);
          drawsInWindow++;
        }
        const now = performance.now();
        if (now - lastFpsLog >= 1000) {
          console.log(
            `[WE录制] 绘制帧率 ${(drawsInWindow * 1000 / (now - fpsWindowStart)).toFixed(1)} fps`,
          );
          drawsInWindow = 0;
          fpsWindowStart = now;
          lastFpsLog = now;
        }
      };
      drawTimer = window.setInterval(drawFrame, Math.round(1000 / RECORD_FPS));

      stopCaptureRef.current = () => {
        clearInterval(drawTimer);
        screenStream.getTracks().forEach((t) => t.stop());
        video.remove();
        canvas.remove();
        dumpCanvas.remove();
        stopCaptureRef.current = null;
      };

      // Coarse luminance probe — true when any of the 8×8 sample points is
      // clearly non-black, or when the crop is not uniformly pure black.
      const hasContent = (): boolean => {
        const cols = 8, rows = 8;
        let min = 255, max = 0;
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const px = Math.min(canvas.width - 1, Math.floor(((i + 0.5) / cols) * canvas.width));
            const py = Math.min(canvas.height - 1, Math.floor(((j + 0.5) / rows) * canvas.height));
            const d = ctx.getImageData(px, py, 1, 1).data;
            const lum = (d[0] + d[1] + d[2]) / 3;
            if (lum > 4) return true;
            if (lum < min) min = lum;
            if (lum > max) max = lum;
          }
        }
        return max - min > 10;
      };

      // Same coarse probe but on the FULL-frame dump.  Tells us whether the whole
      // screen capture is black (MPO / wrong source) vs. only the crop (window not
      // at the expected rect).  Keep it 8×8 grid over the 640px dump so a black
      // background with a bright screen corner is still detected.
      const fullHasContent = (): boolean => {
        const cols = 8, rows = 8;
        let min = 255, max = 0;
        for (let i = 0; i < cols; i++) {
          for (let j = 0; j < rows; j++) {
            const px = Math.min(dumpCanvas.width - 1, Math.floor(((i + 0.5) / cols) * dumpCanvas.width));
            const py = Math.min(dumpCanvas.height - 1, Math.floor(((j + 0.5) / rows) * dumpCanvas.height));
            const d = dumpCtx.getImageData(px, py, 1, 1).data;
            const lum = (d[0] + d[1] + d[2]) / 3;
            if (lum > 4) return true;
            if (lum < min) min = lum;
            if (lum > max) max = lum;
          }
        }
        return max - min > 10;
      };

      // 4. Wait until the WE scene is actually rendering into the crop (scene
      //    shaders/textures need time to load).  Poll every 300ms AND log the
      //    capture-chain state each tick so we can tell which stage goes black
      //    (screen capture stage / canvas crop stage / later in MediaRecorder).
      //    If still black after 8s the recording is aborted WITHOUT writing a
      //    file and diagnostics (rect / screen size / crop / PNG dumps) are shown.
      let sawContent = false;
      // Last observed values for the failure message — so a black-out tells us
      // exactly which stage failed instead of a generic "画面全黑".
      let lastReady = video.readyState;
      let lastTrackState = 'n/a';
      let lastPixel = '-,-,-';
      let lastFull = '未采样';
      let lastVideoError = '无';
      let retriedCapture = false;
      const PREP_MAX_MS = 8000;
      const prepStart = Date.now();
      while (Date.now() - prepStart < PREP_MAX_MS) {
        const elapsed = Date.now() - prepStart;

        // If frames haven't flowed after ~3s the granted stream may be a rare
        // WGC stall (granted but delivering nothing).  Re-grant once and swap the
        // video element onto the fresh stream; the loop then re-drives detection.
        if (!videoEverReady && !retriedCapture && elapsed >= 3000) {
          retriedCapture = true;
          console.warn('[WE录制] 视频3秒未送帧, 重新发起屏幕捕获 (重试1次)');
          try {
            const oldStream = screenStream;
            const s2 = await navigator.mediaDevices.getDisplayMedia({
              audio: false,
              video: { frameRate: RECORD_FPS },
            } as DisplayMediaStreamOptions);
            const g2 = s2.getVideoTracks()[0]?.getSettings() || {};
            if (g2.displaySurface && g2.displaySurface !== 'monitor') {
              s2.getTracks().forEach((t) => t.stop());
              console.warn('[WE录制] 重试仍为非屏幕源', g2.displaySurface);
            } else {
              oldStream.getTracks().forEach((t) => t.stop());
              screenStream = s2;
              video.remove();
              video = makeVideo(s2);
              video.onloadedmetadata = () => { console.log('[WE录制] video onloadedmetadata (重试)'); };
              video.onerror = () => { console.warn('[WE录制] video error (重试)', video.error); };
              console.log('[WE录制] 已重建视频元素', g2);
            }
          } catch (e) {
            console.warn('[WE录制] 重试屏幕捕获失败', String(e));
          }
        }

        let r = -1, g = -1, b = -1;
        try {
          const cd = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
          r = cd[0]; g = cd[1]; b = cd[2];
        } catch { /* canvas may be 0×0 on first frame */ }
        lastPixel = `${r},${g},${b}`;
        lastReady = video.readyState;
        lastTrackState = screenStream.getVideoTracks()[0]?.readyState || 'n/a';
        lastVideoError = video.error ? `code=${video.error.code}` : '无';
        const fullOk = fullHasContent();
        lastFull = fullOk ? '有内容' : '黑';
        console.log(
          `[WE录制] screen: ${capW}x${capH} | video: readyState=${video.readyState} ` +
          `size=${video.videoWidth}x${video.videoHeight} track=${lastTrackState} ` +
          `muted=${screenStream.getVideoTracks()[0]?.muted} err=${lastVideoError} ` +
          `| canvas: ${canvas.width}x${canvas.height} | cropPixel: ${r},${g},${b} ` +
          `| fullFrame: ${lastFull} | videoEverReady: ${videoEverReady ? '是' : '否'}`,
        );
        if (hasContent()) {
          sawContent = true;
          console.log(`canvas content detected after ${elapsed}ms`);
          break;
        }
        setTimeLeft(-Math.max(1, Math.ceil((PREP_MAX_MS - elapsed) / 1000)));
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (!sawContent) {
        const rectInfo = rect ? `${rect.x},${rect.y} ${rect.width}×${rect.height}` : '未测到';
        let debugInfo = '';
        // Full-frame + crop dumps: is the WHOLE screen capture black, or only the
        // crop? (Distinguishes the screen-capture stage from the canvas-crop stage.)
        try {
          const saved = await window.api.settingsHelpers.saveDebugCapture(
            dumpCanvas.toDataURL('image/png'),
            canvas.toDataURL('image/png'),
          );
          debugInfo = `诊断截图: ${saved.dir}`;
        } catch { /* best-effort */ }
        // Named failed PNG from the FINAL recording canvas (capture-chain diag).
        try {
          const named = await window.api.settingsHelpers.saveDebugPng(
            canvas.toDataURL('image/png'),
            'we_capture_failed.png',
          );
          debugInfo = (debugInfo ? debugInfo + '；' : '诊断截图: ') + named.filePath;
        } catch { /* best-effort */ }
        stopCaptureRef.current?.();

        // Localize the failure: video never decoded a frame (videoEverReady=false
        // → autoplay/decoder/source problem) vs. frames flow but are black
        // (fullFrame 黑 → MPO/screen-capture; crop 黑但 full 有内容 → rect 错位).
        const stage =
          !videoEverReady
            ? '视频流未送达帧（readyState 停在 ' + lastReady + '，解码/autoplay/源 阶段失败）'
            : lastFull === '黑'
              ? '视频流有帧但整屏为黑（MPO 硬件 overlay 或捕获源问题）'
              : '全屏有内容但裁剪区为黑（窗口矩形与捕获错位）';
        setError(
          `录制失败：屏幕捕获 8 秒内未检测到画面（全黑）。` +
          `定位: ${stage}。` +
          `video: readyState=${lastReady} everReady=${videoEverReady ? '是' : '否'} ` +
          `error=${lastVideoError} displaySurface=${String(grantedSettings.displaySurface || '未知')} ` +
          `track=${lastTrackState}；全帧内容: ${lastFull}；裁剪中心像素: ${lastPixel}。` +
          `实测窗口矩形: ${rectInfo}；屏幕: ${capW}×${capH}；裁剪区域: ${x},${y} ${w}×${h}。` +
          `文件未保存。` + (debugInfo ? `\n${debugInfo}` : ''),
        );
        window.api.settingsHelpers.weShowCursor();
        window.api.settingsHelpers.weCloseWindow(windowTitleRef.current).catch(() => {});
        window.api.settingsHelpers.restoreFromRecording();
        setState('idle');
        return;
      }

      // Diagnostic: snapshot the FINAL recording canvas right before MediaRecorder
      // starts, so we can confirm the crop had content at this point (vs. going
      // black later inside the recorder).
      try {
        const named = await window.api.settingsHelpers.saveDebugPng(
          canvas.toDataURL('image/png'),
          'we_capture_success.png',
        );
        console.log('[WE录制] 成功画面已存', named.filePath);
      } catch { /* best-effort */ }

      // 5. MediaRecorder — VP9 high quality.  canvas.captureStream(30) only ever
      //    receives the window crop (content verified above).
      const stream = canvas.captureStream(RECORD_FPS);
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 8000000, // 8 Mbps
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          console.log('[WE录制] MediaRecorder ondataavailable blob size', e.data.size);
        }
      };

      recorder.onstop = async () => {
        stopCaptureRef.current?.();
        setState('saving');

        try {
          const blob = new Blob(chunksRef.current, { type: 'video/webm' });
          const buffer = new Uint8Array(await blob.arrayBuffer());

          // Generate cover thumbnail from the recorded video
          const coverData = await new Promise<string | null>((resolve) => {
            const v = document.createElement('video');
            v.src = URL.createObjectURL(blob);
            v.muted = true;
            v.currentTime = 1;
            v.onloadeddata = () => {
              const c = document.createElement('canvas');
              c.width = 320; c.height = 180;
              const cx = c.getContext('2d');
              if (cx) { cx.drawImage(v, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', 0.85)); }
              else resolve(null);
              URL.revokeObjectURL(v.src);
            };
            v.onerror = () => { URL.revokeObjectURL(v.src); resolve(null); };
          });

          const result = await window.api.settingsHelpers.saveRecordedBackground(
            buffer, false, 'we_' + wallpaperTitle.replace(/[\\/:*?"<>|]/g, '').slice(0, 40),
            coverData || undefined,
          );
          await window.api.settingsHelpers.weShowCursor();
          // Clean up WE window and restore main window
          await window.api.settingsHelpers.weCloseWindow(windowTitleRef.current).catch(() => {});
          window.api.settingsHelpers.restoreFromRecording();
          if (!result.success) {
            throw new Error('录制视频未能保存到本地');
          }
          if (result.success) {
            // Auto-select the recorded video as background
            storage.preferences.setPreferences('customBackgroundPath', result.path);
            storage.preferences.setPreferences('customBackgroundType', 'video');
            storage.preferences.setPreferences('backgroundSource', 'custom');
            storage.preferences.setPreferences('showCoverBackground', false);
          }
          onDone();
        } catch (e) {
          setError('保存失败: ' + String(e));
          setState('idle');
        }
      };

      // Leave time to move the pointer outside the recording area.
      for (let seconds = 3; seconds > 0; seconds--) {
        setStartCountdown(seconds);
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      }
      setStartCountdown(null);
      recorder.start(500); // 500ms chunks
      setTimeLeft(duration);
      setState('recording');

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            recorder.stop();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (e: any) {
      setError('录制失败: ' + (e?.message || String(e)));
      setState('idle');
      window.api.settingsHelpers.weShowCursor();
      window.api.settingsHelpers.weCloseWindow(windowTitleRef.current).catch(() => {});
      window.api.settingsHelpers.restoreFromRecording();
    }
  }, [wallpaperPath, wallpaperTitle, duration, onDone]);

  const cancel = useCallback(() => {
    clearInterval(timerRef.current);
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      recorderRef.current.stop();
    }
    setState('idle');
    setTimeLeft(duration);
    window.api.settingsHelpers.weShowCursor();
    window.api.settingsHelpers.weCloseWindow(windowTitleRef.current).catch(() => {});
    window.api.settingsHelpers.restoreFromRecording();
  }, [duration]);

  const isCapturing = state === 'recording' && timeLeft >= 0;
  const progress = state === 'saving' ? 100 : isCapturing
    ? Math.min(100, Math.max(0, ((duration - timeLeft) / duration) * 100)) : 0;
  const statusLabel = state === 'launching' ? '正在启动 Wallpaper Engine'
    : state === 'saving' ? '正在保存并应用壁纸'
    : isCapturing ? '录制中' : startCountdown !== null ? `${startCountdown} 秒后开始录制` : '正在准备画面';

  return (
    <section className="we-recorder overflow-hidden rounded-xl border border-black/10 bg-background-color-1 text-font-color-black dark:border-white/10 dark:bg-dark-background-color-1 dark:text-font-color-white" aria-label="场景壁纸录制">
      <div className="flex items-start gap-3 border-b border-black/8 p-4 dark:border-white/8">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
          <span className="material-icons-round text-xl" aria-hidden="true">videocam</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">场景壁纸录制</h3>
          <p className="mt-1 truncate text-xs opacity-50" title={wallpaperTitle}>{wallpaperTitle}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            disabled={state !== 'idle'}
            aria-label="关闭录制面板"
            title={state === 'idle' ? '关闭录制面板' : '录制完成后可关闭'}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md opacity-50 transition-colors hover:bg-black/5 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-default disabled:opacity-20 dark:hover:bg-white/5"
          >
            <span className="material-icons-round text-base" aria-hidden="true">close</span>
          </button>
        )}
      </div>

      <div className="space-y-4 p-4">
        {state === 'idle' ? (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium opacity-65">录制时长</span>
                <span className="text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">{duration}<span className="ml-1 text-[10px] font-normal">秒</span></span>
              </div>
              <input
                type="range"
                min={5}
                max={45}
                step={1}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                aria-label="录制时长"
                aria-valuetext={`${duration} 秒`}
                className="h-5 w-full cursor-pointer accent-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
              />
              <div className="mt-1 flex justify-between text-[10px] tabular-nums opacity-45"><span>5 秒</span><span>45 秒</span></div>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] tabular-nums opacity-45">
              <span>1700 × 956</span>
              <span>60 FPS</span>
              <span>VP9</span>
            </div>
            <button
              type="button"
              onClick={start}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-500 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
            >
              <span className="material-icons-round text-base" aria-hidden="true">fiber_manual_record</span>
              开始录制
              <span className="font-normal tabular-nums opacity-75">{duration} 秒</span>
            </button>
            <div className="space-y-1.5 text-[11px] leading-relaxed opacity-55">
              <p>点击录制后，请将鼠标移至桌面右侧，避免鼠标出现在录制画面中。</p>
              <p>画面准备完成后，3 秒倒计时结束即开始录制。窗口会暂时最小化，完成后保存至本地并自动应用。</p>
            </div>
          </>
        ) : (
          <>
            <div role="status" className="flex items-center gap-2 text-xs font-medium">
              <span className={`material-icons-round text-base ${isCapturing ? 'text-red-500' : 'opacity-50'}`} aria-hidden="true">
                {isCapturing ? 'fiber_manual_record' : state === 'saving' ? 'save' : 'hourglass_top'}
              </span>
              {statusLabel}
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-4xl font-light tabular-nums tracking-tight">{startCountdown ?? (isCapturing ? timeLeft : duration)}</span>
              <span className="text-xs opacity-45">{startCountdown !== null ? '秒后开始' : isCapturing ? '秒剩余' : '秒录制时长'}</span>
            </div>
            <div
              role="progressbar"
              aria-label="录制进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={isCapturing || state === 'saving' ? Math.round(progress) : undefined}
              className="h-1 overflow-hidden rounded-full bg-black/8 dark:bg-white/10"
            >
              <div className="h-full rounded-full bg-red-500 transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${progress}%` }} />
            </div>
            {isCapturing && (
              <button
                type="button"
                onClick={cancel}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-black/10 py-2.5 text-xs transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:border-white/10 dark:hover:bg-white/5"
              >
                <span className="material-icons-round text-base" aria-hidden="true">stop</span>
                结束并保存
              </button>
            )}
            {state === 'saving' && <p className="text-[11px] leading-relaxed opacity-45">正在处理视频，完成后将自动应用。</p>}
            {state !== 'saving' && <p className="text-[11px] leading-relaxed opacity-55">请将鼠标保持在桌面右侧，避免录入画面。</p>}
          </>
        )}
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/15 bg-red-500/8 p-3 text-xs leading-relaxed text-red-600 dark:text-red-400">
            <span className="material-icons-round shrink-0 text-base" aria-hidden="true">error_outline</span>
            <span className="min-w-0 break-words">{error}</span>
          </div>
        )}
      </div>
    </section>
  );
}
