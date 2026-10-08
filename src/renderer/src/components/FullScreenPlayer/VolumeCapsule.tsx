import { useCallback, useEffect, useRef, useState } from 'react';

type Props = {
  volume: number;
  isMuted: boolean;
  isVisible: boolean;
  onVolumeChange: (v: number) => void;
};

const VolumeCapsule = ({ volume, isMuted, isVisible, onVolumeChange }: Props) => {
  const capsuleRef = useRef<HTMLDivElement>(null);
  const onVolumeChangeRef = useRef(onVolumeChange);
  onVolumeChangeRef.current = onVolumeChange;
  const [hovered, setHovered] = useState(false);
  const show = isVisible || hovered;

  const getIcon = () => {
    if (isMuted) return 'volume_off';
    if (volume > 50) return 'volume_up';
    return 'volume_down_alt';
  };

  const updateFromY = useCallback((clientY: number) => {
    const el = capsuleRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = 1 - (clientY - rect.top) / rect.height;
    onVolumeChangeRef.current(Math.round(Math.max(0, Math.min(100, ratio * 100))));
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateFromY(e.clientY);
  }, [updateFromY]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!(e.buttons & 1)) return;
    if (!capsuleRef.current?.contains(e.target as Node)) return;
    updateFromY(e.clientY);
  }, [updateFromY]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -3 : 3;
    onVolumeChangeRef.current(Math.round(Math.max(0, Math.min(100, volume + delta))));
  }, [volume]);

  useEffect(() => {
    const el = capsuleRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const fillHeight = isMuted ? 0 : volume;

  return (
    <div
      className={`flex justify-center transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      style={{ width: 48, transform: 'translateX(-8px)', WebkitAppRegion: 'no-drag', appRegion: 'no-drag' } as React.CSSProperties}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        ref={capsuleRef}
        className="relative w-12 h-24 cursor-pointer rounded-full backdrop-blur-lg overflow-hidden"
        style={{ background: 'rgba(102,102,102,0.18)', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* 填充条 */}
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full transition-[height] duration-100"
          style={{
            height: `${fillHeight}%`,
            background: isMuted
              ? 'rgb(var(--glass-foreground) / 0.10)'
              : 'rgb(var(--glass-foreground) / 0.35)',
          }}
        />
        {/* 音量图标 */}
        <span
          className="material-icons-round absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl text-white/70 select-none pointer-events-none"
          style={{ lineHeight: 1 }}
        >
          {getIcon()}
        </span>
      </div>
    </div>
  );
};

export default VolumeCapsule;
