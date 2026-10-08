import type { ReactNode } from 'react';

type Props = {
  columns?: number;
  gap?: string;
  className?: string;
  children: ReactNode;
  gridRef?: React.Ref<HTMLDivElement>;
};

export default function ResponsiveGrid({
  columns = 3,
  gap = 'gap-2',
  className = '',
  children,
  gridRef,
}: Props) {
  return (
    <div
      ref={gridRef}
      style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}
      className={`grid max-w-full ${gap} ${className}`}
    >
      {children}
    </div>
  );
}
