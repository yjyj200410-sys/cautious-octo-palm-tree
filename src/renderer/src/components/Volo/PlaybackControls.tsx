import { useQuery } from '@tanstack/react-query';
import { useStore } from '@tanstack/react-store';
import { memo, useContext, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Virtuoso } from 'react-virtuoso';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import type { NcmSong } from '../../ncm/types';
import { store } from '../../store/store';
type Song = SongData | NcmSong;
const time = (n: number) =>
  String(Math.floor(Math.max(0, n || 0) / 60)) +
  ':' +
  String(Math.floor(Math.max(0, n || 0) % 60)).padStart(2, '0');
const artist = (song: Song) => song.artists?.map((a) => a.name).join(' / ') || '未知歌手';
export function Icon({ name }: { name: string }) {
  return (
    <span className="material-icons-round" aria-hidden="true">
      {name}
    </span>
  );
}
export function Key({
  label,
  icon,
  onClick,
  active = false,
  disabled = false,
  className = ''
}: {
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`deck-key ${active ? 'selected' : ''} ${className}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
    >
      <Icon name={icon} />
    </button>
  );
}

export const PlaybackProgress = memo(function PlaybackProgress() {
  const player = useAudioPlayer();
  const duration = useStore(store, (s) => s.currentSongData.duration);
  const { updateSongPosition } = useContext(AppUpdateContext);
  const [position, setPosition] = useState(player.currentTime || 0);
  const dragging = useRef(false);
  useEffect(() => {
    const update = () => {
      if (!document.hidden && !dragging.current) setPosition(player.currentTime || 0);
    };
    for (const e of ['timeupdate', 'loadedmetadata', 'seeked', 'emptied'])
      player.audio.addEventListener(e, update);
    document.addEventListener('visibilitychange', update);
    return () => {
      for (const e of ['timeupdate', 'loadedmetadata', 'seeked', 'emptied'])
        player.audio.removeEventListener(e, update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [player]);
  return (
    <div className="deck-progress">
      <time>{time(position)}</time>
      <div
        className="progress-track"
        style={
          {
            '--play-progress': `${duration ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0}%`
          } as CSSProperties
        }
      >
        <span className="progress-rail" aria-hidden="true">
          <span />
        </span>
        <input
          aria-label="播放进度"
          type="range"
          min="0"
          max={duration || 1}
          step="0.1"
          value={Math.min(position, duration || 1)}
          disabled={!duration}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={() => {
            dragging.current = false;
            updateSongPosition(position);
          }}
          onPointerCancel={() => {
            dragging.current = false;
            setPosition(player.currentTime || 0);
          }}
          onChange={(e) => {
            const value = Number(e.target.value);
            setPosition(value);
            if (!dragging.current) updateSongPosition(value);
          }}
        />
      </div>
      <time>{time(duration)}</time>
    </div>
  );
});

function QueueRow({ ids, index }: { ids: number[]; index: number }) {
  const controls = useContext(AppUpdateContext);
  const group = ids.slice(Math.floor(index / 40) * 40, (Math.floor(index / 40) + 1) * 40);
  const { data } = useQuery({
    queryKey: ['volo', 'queue-chunk', group],
    queryFn: async () => {
      const localIds = group.filter((id) => id > 0);
      const local = localIds.length
        ? await window.api.audioLibraryControls.getSongInfo(
            localIds,
            undefined,
            undefined,
            undefined,
            true
          )
        : [];
      const online = await Promise.all(
        group.filter((id) => id < 0).map((id) => window.api.ncm.getSong(id))
      );
      return [...(local || []), ...online.filter(Boolean)] as Song[];
    },
    staleTime: 60_000,
    gcTime: 60_000
  });
  const song = data?.find((item) => item.songId === ids[index]);
  return (
    <button
      className="queue-row"
      disabled={!song}
      onClick={() => song && void controls.playSong(song.songId, true)}
    >
      <span className="track-number">{index + 1}</span>
      <span>
        {song?.title || '正在读取歌曲…'}
        <small>{song && artist(song)}</small>
      </span>
      <Icon name="play_arrow" />
    </button>
  );
}
export function QueuePanel() {
  const player = useAudioPlayer();
  useStore(store, (s) => s.localStorage.queue);
  const ids = player.queue.getAllSongIds();
  return (
    <div className="deck-extra queue-panel">
      <div className="extra-heading">
        <strong>播放队列</strong>
        <span>{ids.length} 首</span>
      </div>
      <div className="queue-list">
        <Virtuoso
          totalCount={ids.length}
          style={{ height: 180 }}
          itemContent={(index) => <QueueRow ids={ids} index={index} />}
        />
      </div>
      {!ids.length && <p>从列表选择一首音乐开始</p>}
    </div>
  );
}
