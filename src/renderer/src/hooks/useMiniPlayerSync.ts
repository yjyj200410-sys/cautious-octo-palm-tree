import { useEffect, useRef } from 'react';
import { store } from '@renderer/store/store';
import { LyricsStore } from './LyricsStore';
import type { AppUpdateContextType } from '../contexts/AppUpdateContext';

/**
 * Mini Player 独立窗口同步:
 *
 *  push:主窗口 → mini 窗口 — 歌曲/播放状态/进度/时长/音量
 *  pull:mini 窗口命令 → 主窗口执行 — togglePlay/next/previous/seek/volume/expand/openMain
 *
 * 不复制播放器逻辑,只连接现有 store + AppUpdateContext。
 */
export function useMiniPlayerSync(context: AppUpdateContextType): void {
  const contextRef = useRef(context);
  contextRef.current = context;

  // ── 状态推送(事件驱动 + store 订阅) ──
  useEffect(() => {
    const w = window as any;
    const player = w.__noraPlayer;

    const send = () => {
      const s = store.state;
      const ls = LyricsStore.getState();
      (window as any).api?.miniPlayerWindow?.sendState?.({
        song: {
          title: s.currentSongData.title || '',
          artists: Array.isArray(s.currentSongData.artists)
            ? s.currentSongData.artists.map((a: any) => a.name).join(', ')
            : '',
          artworkPath: s.currentSongData.artworkPath || '',
        },
        currentLine: ls.line?.text || '',
        isPlaying: !!s.player.isCurrentSongPlaying,
        position: player?.audio?.currentTime ?? 0,
        duration: s.currentSongData.duration || 0,
        volume: s.player.volume.value,
        isMuted: !!s.player.volume.isMuted,
      });
    };

    // 立即推一次(窗口可能晚于歌曲打开)
    send();

    // 播放事件驱动(进度/播放状态变化)
    const playerEvents = ['timeUpdate', 'songLoaded', 'play', 'pause', 'durationChange', 'seeked'];
    const offs = playerEvents.map((ev) => {
      const fn = () => send();
      player?.on?.(ev, fn);
      return () => player?.off?.(ev, fn);
    });

    // store 订阅(切歌/音量/收藏等)
    const unsub = store.subscribe(() => send());

    return () => {
      offs.forEach((off) => off());
      unsub.unsubscribe();
    };
  }, []);

  // ── mini 窗口命令执行 ──
  useEffect(() => {
    const api = (window as any).api?.miniPlayerWindow;
    if (!api?.onCommand) return;
    return api.onCommand((cmd: { type: string; value?: number }) => {
      const c = contextRef.current;
      switch (cmd?.type) {
        case 'togglePlay':
          c.toggleSongPlayback();
          break;
        case 'next':
          c.handleSkipForwardClick('USER_SKIP');
          break;
        case 'previous':
          c.handleSkipBackwardClick();
          break;
        case 'seek':
          if (typeof cmd.value === 'number') c.updateSongPosition(cmd.value);
          break;
        case 'volume':
          if (typeof cmd.value === 'number') c.updateVolume(cmd.value);
          break;
        case 'expand':
          // 单击封面:展开主窗口 mini 模式(现有 MiniPlayer 大 UI)
          c.updatePlayerType('mini');
          break;
        case 'openMain':
          // 双击:回到主窗口 normal 模式
          c.updatePlayerType('normal');
          break;
        default:
          break;
      }
    });
  }, []);
}
