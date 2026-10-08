import { useState, useCallback, useEffect } from 'react';

type Props = { isVisible: boolean };

export default function DesktopLyricsToggle({ isVisible }: Props) {
  const [active, setActive] = useState(false);
  const [hovered, setHovered] = useState(false);
  const show = isVisible || hovered;

  useEffect(() => {
    window.api.settingsHelpers.getDesktopLyricsState().then(setActive);
  }, []);

  const toggle = useCallback(async () => {
    const state = await window.api.settingsHelpers.toggleDesktopLyrics();
    setActive(state);
  }, []);

  return (
    <div
      className={`flex justify-center transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      style={{ width: 48, transform: 'translateX(8px)', WebkitAppRegion: 'no-drag', appRegion: 'no-drag' } as React.CSSProperties}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <button
        className={`relative w-12 h-12 cursor-pointer rounded-full backdrop-blur-lg flex items-center justify-center active:scale-90 transition-transform`}
        style={{ background: active ? 'rgba(255,255,255,0.18)' : 'rgba(102,102,102,0.18)' }}
        onClick={toggle}
        title="桌面歌词"
      >
        <span className={`material-icons-round text-2xl select-none pointer-events-none ${
          active ? 'text-font-color-highlight dark:text-dark-font-color-highlight' : 'text-white/45'
        }`}>
          lyrics
        </span>
      </button>
    </div>
  );
}
