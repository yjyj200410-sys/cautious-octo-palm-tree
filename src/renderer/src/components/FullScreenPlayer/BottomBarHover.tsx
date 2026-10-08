import { useState, type ReactNode } from 'react';

type Props = {
  children: (show: boolean) => ReactNode;
  isVisible: boolean;
  className?: string;
};

/** Bottom bar that stays visible on hover, passes show state to children via render prop */
export default function BottomBarHover({ children, isVisible, className }: Props) {
  const [hovered, setHovered] = useState(false);
  const show = isVisible || hovered;

  return (
    <div
      className={className}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {children(show)}
    </div>
  );
}
