import {
  floatingChromeStore,
  toggleFloatingPanel,
  type FloatingPanelKey
} from '@renderer/store/floatingChromeStore';
import { useStore } from '@tanstack/react-store';
import { useRef, type ReactNode } from 'react';

import './floatingChrome.css';

/** Each island owns its collapse state without changing the canvas dimensions. */
export default function FloatingPanel({
  panel,
  title,
  icon,
  className = '',
  children,
  keepMounted = true
}: {
  panel: FloatingPanelKey;
  title: string;
  icon: string;
  className?: string;
  children: ReactNode;
  keepMounted?: boolean;
}) {
  const open = useStore(floatingChromeStore, (state) => state.panels[panel] && !state.focusMode);
  const toggle = useRef<HTMLButtonElement>(null);
  const bodyId = `floating-${panel}-body`;
  return (
    <section
      className={`floating-panel dark ${className}`}
      data-panel={panel}
      data-open={open}
      aria-label={title}
      data-canvas-ui
    >
      <div
        id={bodyId}
        className="floating-panel-body"
        hidden={!open}
        inert={!open}
        aria-hidden={!open}
      >
        {(open || keepMounted) && children}
      </div>
      <button
        ref={toggle}
        type="button"
        className="floating-panel-toggle"
        aria-label={`${open ? '收起' : '展开'}${title}`}
        aria-expanded={open}
        aria-controls={bodyId}
        title={`${open ? '收起' : '展开'}${title}`}
        onClick={() => {
          toggle.current?.focus({ preventScroll: true });
          toggleFloatingPanel(panel);
        }}
      >
        <span className="material-icons-round-outlined" aria-hidden="true">
          {open ? 'keyboard_arrow_down' : icon}
        </span>
        <span className="floating-panel-label">{title}</span>
      </button>
    </section>
  );
}
