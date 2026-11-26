import { useStore } from '@tanstack/react-store';
import { useContext } from 'react';

import { AppUpdateContext } from '../../contexts/AppUpdateContext';
import { store } from '../../store/store';
import { Icon, Key, PlaybackProgress } from './PlaybackControls';

export function NowPlayingBar({ onOpen }: { onOpen: () => void }) {
  const song = useStore(store, (s) => s.currentSongData);
  const playing = useStore(store, (s) => s.player.isCurrentSongPlaying);
  const c = useContext(AppUpdateContext);
  return (
    <aside className="now-playing-bar" aria-label="正在播放">
      <button className="now-playing-track" onClick={onOpen} aria-label="打开播放器">
        {song.artworkPath ? <img className="paper-mini-art" src={song.artworkPath} alt="" /> : <span className="paper-mini-art placeholder"><Icon name="album" /></span>}
        <span className="paper-mini-meta">
          <strong>{song.title || '打开播放器'}</strong>
          <small>{song.artists?.map((a) => a.name).join(' / ') || '选一首，听一会儿。'}</small>
        </span>
        <Icon name="north_east" />
      </button>
      <div className="paper-mini-controls"><Key
        label="上一首"
        icon="skip_previous"
        disabled={!song.songId}
        onClick={c.handleSkipBackwardClick}
      />
      <Key
        label={playing ? '暂停' : '播放'}
        icon={playing ? 'pause' : 'play_arrow'}
        className="play-key"
        disabled={!song.songId}
        onClick={() => c.toggleSongPlayback()}
      />
      <Key
        label="下一首"
        icon="skip_next"
        disabled={!song.songId}
        onClick={() => c.handleSkipForwardClick('USER_SKIP')}
      />
      </div><div className="paper-mini-progress"><PlaybackProgress /></div><button className="icon-button paper-expand" onClick={onOpen} aria-label="展开播放页"><Icon name="keyboard_arrow_up" /></button>
    </aside>
  );
}
