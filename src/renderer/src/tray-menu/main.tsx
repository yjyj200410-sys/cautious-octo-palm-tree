/**
 * Tray Menu — 独立透明置顶窗口,在托盘图标位置弹出。
 *
 * 点击菜单项保持打开(连续操作),失焦/Esc 关闭。
 * 状态经 IPC 推送(song/isPlaying),操作复用 mini 命令通道:
 *   miniPlayerWindow.sendCommand → mini-player:command → 主窗口执行
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const api = (window as any).api;

type TrayState = {
  song?: { title: string; artists: string; artworkPath: string };
  isPlaying?: boolean;
};

function App() {
  const [song, setSong] = useState<{ title: string; artists: string; artworkPath: string } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dlEnabled, setDlEnabled] = useState(false);
  const [miniOpen, setMiniOpen] = useState(false);

  useEffect(() => {
    // 接收播放状态推送
    const unsub = api?.windowControls?.onTrayMenuState?.((data: TrayState) => {
      if (data?.song) setSong(data.song);
      if (typeof data.isPlaying === 'boolean') setIsPlaying(data.isPlaying);
    });
    // 打开时刷新开关状态
    api?.settingsHelpers?.getDesktopLyricsState?.().then(setDlEnabled);
    api?.miniPlayerWindow?.getState?.().then(setMiniOpen);
    // Esc 关闭
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') api?.windowControls?.closeTrayMenu?.(); };
    window.addEventListener('keydown', onKey);
    return () => { unsub?.(); window.removeEventListener('keydown', onKey); };
  }, []);

  const cmd = (type: string, value?: number) => api?.miniPlayerWindow?.sendCommand?.({ type, value });

  const item: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '8px 12px',
    border: 'none',
    background: 'transparent',
    color: 'rgba(255,255,255,0.88)',
    fontSize: 13,
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: 6,
  };
  const itemHover: React.CSSProperties = { ...item, background: 'rgba(255,255,255,0.10)' };
  const divider: React.CSSProperties = { height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 8px' };

  const artists = song?.artists || '';
  const cover = song?.artworkPath
    ? /^https?:\/\//i.test(song.artworkPath)
      ? song.artworkPath
      : `file:///${song.artworkPath.replace(/\\/g, '/')}`
    : '';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        padding: 6,
        borderRadius: 10,
        background: 'hsl(228 7% 14% / 0.94)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.10)',
      } as React.CSSProperties}
    >
      {/* 当前歌曲 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px' }}>
        {cover ? (
          <img src={cover} alt="" style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover' }} />
        ) : (
          <div style={{ width: 28, height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.10)' }} />
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
            {song?.title || '未在播放'}
          </div>
          {artists && (
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
              {artists}
            </div>
          )}
        </div>
      </div>
      <div style={divider} />

      {/* 播放控制(点击不关闭) */}
      <button style={item} onMouseEnter={(e) => Object.assign(e.currentTarget.style, itemHover)} onMouseLeave={(e) => Object.assign(e.currentTarget.style, item)} onClick={() => cmd('previous')}>上一首</button>
      <button style={item} onMouseEnter={(e) => Object.assign(e.currentTarget.style, itemHover)} onMouseLeave={(e) => Object.assign(e.currentTarget.style, item)} onClick={() => cmd('togglePlay')}>
        {isPlaying ? '暂停' : '播放'}
      </button>
      <button style={item} onMouseEnter={(e) => Object.assign(e.currentTarget.style, itemHover)} onMouseLeave={(e) => Object.assign(e.currentTarget.style, item)} onClick={() => cmd('next')}>下一首</button>
      <div style={divider} />

      {/* 迷你播放器开关 */}
      <button
        style={{ ...item, color: miniOpen ? 'hsl(213 80% 88%)' : 'rgba(255,255,255,0.88)' } as React.CSSProperties}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, itemHover)}
        onMouseLeave={(e) => Object.assign(e.currentTarget.style, item)}
        onClick={async () => {
          const open = await api?.miniPlayerWindow?.toggle?.();
          if (typeof open === 'boolean') setMiniOpen(open);
        }}
      >
        <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}>{miniOpen ? '✓' : ''}</span>
        迷你播放器
      </button>
      {/* 桌面歌词开关 */}
      <button
        style={{ ...item, color: dlEnabled ? 'hsl(213 80% 88%)' : 'rgba(255,255,255,0.88)' } as React.CSSProperties}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, itemHover)}
        onMouseLeave={(e) => Object.assign(e.currentTarget.style, item)}
        onClick={async () => {
          const enabled = await api?.settingsHelpers?.toggleDesktopLyrics?.();
          if (typeof enabled === 'boolean') setDlEnabled(enabled);
        }}
      >
        <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}>{dlEnabled ? '✓' : ''}</span>
        桌面歌词
      </button>
      <div style={divider} />

      {/* 窗口控制 */}
      <button style={item} onMouseEnter={(e) => Object.assign(e.currentTarget.style, itemHover)} onMouseLeave={(e) => Object.assign(e.currentTarget.style, item)}
        onClick={() => { api?.windowControls?.hideApp?.(); api?.windowControls?.closeTrayMenu?.(); }}>
        隐藏窗口
      </button>
      <button style={{ ...item, color: 'rgba(255,120,120,0.9)' } as React.CSSProperties} onMouseEnter={(e) => Object.assign(e.currentTarget.style, itemHover)} onMouseLeave={(e) => Object.assign(e.currentTarget.style, item)}
        onClick={() => api?.windowControls?.closeApp?.()}>
        退出
      </button>
    </div>
  );
}

const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<App />);
