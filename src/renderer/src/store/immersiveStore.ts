import { Store } from '@tanstack/react-store';

export type ImmersiveRegion = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'right-center' | null;

export const immersiveStore = new Store({ active: false, region: null as ImmersiveRegion });

export const setImmersiveRegion = (region: ImmersiveRegion) => {
  if (immersiveStore.state.region !== region) {
    immersiveStore.setState((state) => ({ ...state, region }));
  }
};

/** Only the edge under the pointer is revealed; the content area stays clear. */
export const getImmersiveRegion = (x: number, y: number, width: number, height: number): ImmersiveRegion => {
  const column = x < width / 3 ? 'left' : x > width * 2 / 3 ? 'right' : 'center';
  if (y <= 76) return `top-${column}`;
  if (y >= height - 150 || (x >= width - 112 && y >= height - 208)) return `bottom-${column}`;
  if (x >= width - 112) return 'right-center';
  return null;
};
