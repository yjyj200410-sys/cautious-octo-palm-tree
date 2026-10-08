import { Store } from '@tanstack/react-store';

export type FloatingPanelKey =
  | 'sidebar'
  | 'library'
  | 'canvas'
  | 'song'
  | 'progress'
  | 'controls'
  | 'tools';
const defaults: Record<FloatingPanelKey, boolean> = {
  sidebar: false,
  library: false,
  canvas: false,
  song: false,
  progress: true,
  controls: true,
  tools: false
};
const key = 'volo-floating-panels';
function loadPanels() {
  const panels = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    for (const name of Object.keys(panels) as FloatingPanelKey[]) {
      if (typeof saved?.[name] === 'boolean') panels[name] = saved[name];
    }
  } catch {
    /* Keep the controls usable if preferences are unavailable. */
  }
  return panels;
}

export const floatingChromeStore = new Store({ panels: loadPanels(), focusMode: false });
export function setFloatingPanel(name: FloatingPanelKey, open: boolean) {
  floatingChromeStore.setState((state) => ({
    ...state,
    panels: { ...state.panels, [name]: open }
  }));
}
export function toggleFloatingPanel(name: FloatingPanelKey) {
  setFloatingPanel(name, !floatingChromeStore.state.panels[name]);
}
export function toggleFloatingFocus() {
  // Keep each panel's previous state, so one click restores the working layout.
  floatingChromeStore.setState((state) => ({ ...state, focusMode: !state.focusMode }));
}
floatingChromeStore.subscribe(() => {
  try {
    localStorage.setItem(key, JSON.stringify(floatingChromeStore.state.panels));
  } catch {
    /* Session state still works without storage. */
  }
});
