import roundTo from '@common/roundTo';

import AudioPlayer from '../other/player';
import { getQueue } from '../other/queueSingleton';
let playerInstance: AudioPlayer | null = null;
/** The audio event bridge belongs to the singleton, not to every mounted view. */
export function useAudioPlayer() {
  if (!playerInstance) {
    const player = new AudioPlayer(getQueue());
    playerInstance = player;
    (window as unknown as Record<string, unknown>).__noraPlayer = player;
    const update = () => {
      if (!document.hidden)
        document.dispatchEvent(
          new CustomEvent('player/positionChange', { detail: roundTo(player.currentTime || 0, 2) })
        );
    };
    player.audio.addEventListener('timeupdate', update);
    player.audio.addEventListener('seeked', update);
    document.addEventListener('visibilitychange', update);
  }
  return playerInstance;
}
