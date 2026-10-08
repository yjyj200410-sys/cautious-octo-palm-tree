import { useState, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  isVisible: boolean;
  className?: string;
};

/** Wrapper that fades out when isVisible=false, but stays visible on hover */
export default function HoverVisibleCapsule({ children, isVisible, className }: Props) {
  const [hovered, setHovered] = useState(false);
  const show = isVisible || hovered;

  return (
    <div
      className={className}
      style={{ WebkitAppRegion: 'no-drag', appRegion: 'no-drag' } as React.CSSProperties}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div className={`transition-opacity duration-300 ${show ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {children}
      </div>
    </div>
  );
}
