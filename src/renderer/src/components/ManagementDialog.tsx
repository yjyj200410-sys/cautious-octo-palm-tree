import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react';
import type { ReactNode } from 'react';

/** Shared manager surface: portal, focus containment, topmost Escape and exit lifecycle. */
export default function ManagementDialog({ open, onClose, label, className = '', children }: {
  open: boolean;
  onClose: () => void;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} unmount={false} onClose={onClose} className="management-dialog relative z-[70]" aria-label={label}>
      <DialogBackdrop transition className="fixed inset-0 bg-black/25 transition-opacity duration-200 data-closed:opacity-0" />
      <div className="fixed inset-0 flex items-center justify-center p-6">
        <DialogPanel transition className={`management-dialog-panel flex max-h-[calc(100dvh-48px)] max-w-[calc(100vw-48px)] min-w-0 flex-col overflow-hidden rounded-2xl shadow-2xl ring-1 ring-inset ring-white/70 transition-[opacity,translate] duration-200 ease-out data-closed:translate-y-3 data-closed:opacity-0 ${className}`}>
          {children}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
