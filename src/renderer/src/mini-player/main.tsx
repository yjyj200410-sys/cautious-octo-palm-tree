import { installCustomTooltips } from '../utils/customTooltips';
/** 独立迷你播放器：只通过 IPC 与主窗口同步播放状态。 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'material-symbols/rounded.css';
import './mini-player.css';

const api = (window as any).api?.miniPlayerWindow;
const LS_LEFT_MODE = 'lumina_miniLeftMode';

type MiniState = {
  song: { title: string; artists: string; artworkPath: string };
  currentLine: string;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  isMuted: boolean;
};

const EMPTY: MiniState = {
  song: { title: '', artists: '', artworkPath: '' },
  currentLine: '',
  isPlaying: false,
  position: 0,
  duration: 0,
  volume: 100,
  isMuted: false,
};

function resolveCover(path: string): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `file:///${path.replace(/\\/g, '/')}`;
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function App() {
  const [state, setState] = useState<MiniState>(EMPTY);
  const [leftMode, setLeftMode] = useState<'lyrics' | 'cover'>(() => {
    try { return localStorage.getItem(LS_LEFT_MODE) === 'cover' ? 'cover' : 'lyrics'; }
    catch { return 'lyrics'; }
  });
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const seekDraftRef = useRef<number | null>(null);

  useEffect(() => {
    api?.setLeftMode?.(leftMode);
    const unsub = api?.onLeftModeChanged?.((mode: string) => {
      const next = mode === 'cover' ? 'cover' : 'lyrics';
      setLeftMode(next);
      try { localStorage.setItem(LS_LEFT_MODE, next); } catch {}
    });
    return unsub;
  }, [leftMode]);

  useEffect(() => {
    if (!api?.onState) return;
    return api.onState((data: Partial<MiniState>) => {
      if (!data) return;
      setState((prev) => ({
        song: data.song || prev.song,
        currentLine: typeof data.currentLine === 'string' ? data.currentLine : prev.currentLine,
        isPlaying: typeof data.isPlaying === 'boolean' ? data.isPlaying : prev.isPlaying,
        position: typeof data.position === 'number' ? data.position : prev.position,
        duration: typeof data.duration === 'number' ? data.duration : prev.duration,
        volume: typeof data.volume === 'number' ? data.volume : prev.volume,
        isMuted: typeof data.isMuted === 'boolean' ? data.isMuted : prev.isMuted,
      }));
    });
  }, []);

  const cmd = (type: string, value?: number) => api?.sendCommand?.({ type, value });
  const duration = Math.max(0, state.duration || 0);
  const position = Math.min(duration, Math.max(0, seekDraft ?? state.position ?? 0));
  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const cover = resolveCover(state.song.artworkPath);
  const title = state.song.title || '未在播放';
  const artist = state.song.artists || '未知歌手';
  const lyric = leftMode === 'lyrics' ? state.currentLine.trim() : '';

  function commitSeek() {
    if (seekDraftRef.current === null) return;
    if (duration > 0) cmd('seek', Math.min(duration, Math.max(0, seekDraftRef.current)));
    seekDraftRef.current = null;
    setSeekDraft(null);
  }

  return (
    <section
      className="mini-player"
      aria-label="迷你播放器"
      onContextMenu={(event) => {
        event.preventDefault();
        api?.showContextMenu?.();
      }}
    >
      <div className="mini-player__drag" aria-hidden="true" />
      <div className="mini-player__body">
        <div
          className="mini-player__identity"
        >
          <button
            className="mini-player__cover"
            type="button"
            title="打开主窗口"
            aria-label="打开主窗口"
            onClick={() => cmd('openMain')}
          >
            {cover ? (
              <img src={cover} alt="歌曲封面" draggable={false} />
            ) : (
              <span className="material-symbols-rounded" aria-hidden="true">music_note</span>
            )}
          </button>
          <div className="mini-player__copy">
            <div className="mini-player__title" title={title}>{title}</div>
            <div className="mini-player__artist" title={artist}>{artist}</div>
            {lyric && <div className="mini-player__lyric" title={lyric}>{lyric}</div>}
          </div>
        </div>

        <div className="mini-player__controls" role="group" aria-label="播放控制">
          <IconButton label="上一首" icon="skip_previous" onClick={() => cmd('previous')} />
          <IconButton
            label={state.isPlaying ? '暂停' : '播放'}
            icon={state.isPlaying ? 'pause' : 'play_arrow'}
            onClick={() => cmd('togglePlay')}
            primary
          />
          <IconButton label="下一首" icon="skip_next" onClick={() => cmd('next')} />
        </div>
      </div>
      <div className="mini-player__seek">
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={position}
          disabled={duration <= 0}
          aria-label="播放进度"
          aria-valuetext={`${formatTime(position)} / ${formatTime(duration)}`}
          title={`${formatTime(position)} / ${formatTime(duration)}`}
          style={{ '--mini-progress': `${progress}%` } as React.CSSProperties}
          onChange={(event) => {
            const value = Number(event.currentTarget.value);
            seekDraftRef.current = value;
            setSeekDraft(value);
          }}
          onPointerUp={commitSeek}
          onPointerCancel={() => {
            seekDraftRef.current = null;
            setSeekDraft(null);
          }}
          onKeyUp={commitSeek}
          onBlur={commitSeek}
        />
      </div>
    </section>
  );
}

function IconButton({ label, icon, onClick, primary = false }: {
  label: string;
  icon: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      className={`mini-player__button${primary ? ' mini-player__button--primary' : ''}`}
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      <span className="material-symbols-rounded" aria-hidden="true">{icon}</span>
    </button>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<App />);

installCustomTooltips();
