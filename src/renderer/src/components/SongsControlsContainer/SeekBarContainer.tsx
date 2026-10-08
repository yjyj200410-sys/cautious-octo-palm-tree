import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useState } from 'react';

import calculateTime from '../../utils/calculateTime';
import SeekBarSlider from '../SeekBarSlider';

const SeekBarContainer = () => {
  const currentSongData = useStore(store, (state) => state.currentSongData);
  const preferences = useStore(store, (state) => state.localStorage.preferences);

  const [songPos, setSongPos] = useState(0);

  const songDuration = preferences?.showSongRemainingTime
    ? currentSongData.duration - Math.floor(songPos) >= 0
      ? calculateTime(currentSongData.duration - Math.floor(songPos))
      : calculateTime(0)
    : calculateTime(currentSongData.duration);
  const position = calculateTime(songPos);

  return (
    <div className="floating-seek-content seekbar-and-song-durations-container">
      <span>
        {position.minutes}:{position.seconds}
      </span>
      <div className="seek-bar">
        <SeekBarSlider
          id="seek-bar-slider"
          name="seek-bar-slider"
          onSeek={(currentPosition) => setSongPos(currentPosition)}
          className="seek-bar-slider no-thumb relative m-0 h-8 w-full cursor-pointer appearance-none bg-transparent p-0 outline-hidden outline-offset-1 before:absolute before:top-1/2 before:left-0 before:h-[3px] before:w-[var(--seek-before-width)] before:-translate-y-1/2 before:bg-white/60 before:content-[''] focus-visible:outline!"
        />
      </div>
      <span className="full-song-duration">
        {preferences?.showSongRemainingTime ? '-' : ''}
        {songDuration.minutes}:{songDuration.seconds}
      </span>
    </div>
  );
};

export default SeekBarContainer;
