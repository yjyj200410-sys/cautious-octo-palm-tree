import ErrorBoundary from '../ErrorBoundary';
import FloatingPanel from '../FloatingChrome/FloatingPanel';
import CurrentlyPlayingSongInfoContainer from './CurrentlyPlayingSongInfoContainer';
import OtherSongControlsContainer from './OtherSongControlsContainer';
import SeekBarContainer from './SeekBarContainer';
import SongControlsAndSeekbarContainer from './SongControlsAndSeekbarContainer';

const SongControlsContainer = ({
  isQueueOpen,
  onQueueToggle
}: {
  isQueueOpen: boolean;
  onQueueToggle: () => void;
}) => {
  return (
    <footer className="floating-player song-controls-container text-white" aria-label="播放控制">
      <ErrorBoundary>
        <>
          <FloatingPanel
            panel="progress"
            title="播放进度"
            icon="linear_scale"
            className="floating-progress"
            keepMounted={false}
          >
            <SeekBarContainer />
          </FloatingPanel>
          <FloatingPanel panel="song" title="当前歌曲" icon="music_note" className="floating-song">
            <CurrentlyPlayingSongInfoContainer />
          </FloatingPanel>
          <FloatingPanel
            panel="controls"
            title="播放按钮"
            icon="play_circle"
            className="floating-playback"
            keepMounted={false}
          >
            <SongControlsAndSeekbarContainer />
          </FloatingPanel>
          <FloatingPanel
            panel="tools"
            title="播放功能"
            icon="more_horiz"
            className="floating-tools"
            keepMounted={false}
          >
            <OtherSongControlsContainer isQueueOpen={isQueueOpen} onQueueToggle={onQueueToggle} />
          </FloatingPanel>
        </>
      </ErrorBoundary>
    </footer>
  );
};

SongControlsContainer.displayName = 'SongControlsContainer';
export default SongControlsContainer;
