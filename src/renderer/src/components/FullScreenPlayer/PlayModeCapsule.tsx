import { useState } from 'react';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store/store';

type Props = {
  isVisible: boolean;
  onToggleRepeat: (state?: 'false' | 'repeat' | 'repeat-1') => void;
  onToggleShuffle: () => void;
};

const PlayModeCapsule = ({ isVisible, onToggleRepeat, onToggleShuffle }: Props) => {
  const isRepeating = useStore(store, (state) => state.player.isRepeating);
  const isShuffling = useStore(store, (state) => state.player.isShuffling);
  const [hovered, setHovered] = useState(false);
  const show = isVisible || hovered;

  const active = isShuffling || isRepeating !== 'false';

  const getIcon = () => {
    if (isShuffling) return 'shuffle';
    if (isRepeating === 'repeat-1') return 'repeat_one';
    return 'repeat';
  };

  const handleClick = () => {
    if (isShuffling) {
      onToggleShuffle();
    } else if (isRepeating === 'false') {
      onToggleRepeat('repeat');
    } else if (isRepeating === 'repeat') {
      onToggleRepeat('repeat-1');
    } else {
      onToggleRepeat('false');
      onToggleShuffle();
    }
  };

  return (
    <div
      className={`flex justify-center transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      style={{ width: 48, transform: 'translateX(8px)', WebkitAppRegion: 'no-drag', appRegion: 'no-drag' } as React.CSSProperties}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        className="relative w-12 h-12 cursor-pointer rounded-full backdrop-blur-lg flex items-center justify-center active:scale-90 transition-transform"
        style={{ background: 'rgba(102,102,102,0.18)' }}
        onClick={handleClick}
      >
        <span
          className={`material-icons-round text-2xl select-none pointer-events-none transition-colors ${
            active ? 'text-font-color-highlight dark:text-dark-font-color-highlight' : 'text-white/45'
          }`}
        >
          {getIcon()}
        </span>
      </button>
    </div>
  );
};

export default PlayModeCapsule;
