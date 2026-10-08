import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../../../../src/renderer/src/assets/styles/glass.css', import.meta.url), 'utf8');
const luminance = (channels: number[]) => channels.map((channel) => {
  const value = channel / 255;
  return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);

describe('glass theme text legibility', () => {
  for (const theme of ['light', 'dark']) {
    const block = css.match(theme === 'light' ? /:root\s*\{([^}]+)\}/ : /body\.dark\s*\{([^}]+)\}/)![1];
    const color = (name: string) => block.match(new RegExp(`--glass-${name}: ([\\d ]+);`))![1].trim().split(/\s+/).map(Number);
    const opacity = Number(block.match(/--glass-opacity: ([\d.]+);/)![1]);
    it.each([0, 255])(`${theme} text remains readable over a backdrop with channel value %i`, (backdrop) => {
      const background = color('background').map((channel) => channel * opacity + backdrop * (1 - opacity));
      const values = [luminance(background), luminance(color('foreground'))].sort((a, b) => a - b);
      expect((values[1] + .05) / (values[0] + .05)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
