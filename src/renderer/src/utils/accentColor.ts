/**
 * 强调色工具 — hex↔HSL 转换、CSS 变量应用、背景取色
 */

/** hex 转 HSL，返回 { h, s, l } 三个独立数值 */
export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** 设置 CSS 自定义属性，应用强调色到全局 */
export function applyAccentColor(hex: string | null | undefined, brightness = 100): void {
  const root = document.documentElement;

  if (!hex) {
    root.style.removeProperty('--text-color-highlight');
    root.style.removeProperty('--text-color-highlight-2');
    root.style.removeProperty('--background-color-3');
    root.style.removeProperty('--dark-text-color-highlight');
    root.style.removeProperty('--dark-text-color-highlight-2');
    root.style.removeProperty('--dark-background-color-3');
    return;
  }

  const b = brightness / 100;
  const { h, s, l: hl } = hexToHsl(hex);
  const l = Math.round(hl * b);
  const hslVal = `${h} ${s}% ${l}%`;
  root.style.setProperty('--text-color-highlight', hslVal);
  root.style.setProperty('--text-color-highlight-2', hslVal);

  const bgS = Math.round(s * 0.35);
  const bgL = Math.min(l + 25, 95);
  root.style.setProperty('--background-color-3', `${h} ${bgS}% ${bgL}%`);

  const darkL = Math.min(l + 30, 90);
  const darkHsl = `${h} ${s}% ${darkL}%`;
  root.style.setProperty('--dark-text-color-highlight', darkHsl);
  root.style.setProperty('--dark-text-color-highlight-2', darkHsl);

  const darkBgL = Math.min(l + 15, 40);
  root.style.setProperty('--dark-background-color-3', `${h} ${Math.round(s * 0.5)}% ${darkBgL}%`);
}

/** 从图片 URL 提取主色调（canvas 像素采样） */
export function extractDominantColor(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        // 缩小到 10x10 采样，取平均色
        const size = 10;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        if (count === 0) return resolve(null);
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);

        const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
        resolve(hex);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}
