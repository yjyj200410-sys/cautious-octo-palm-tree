/**
 * Build desktop lyrics React app as a single IIFE bundle.
 * Output: dist-desktop/desktop-lyrics.js — self-contained, no external deps.
 * This gets embedded in the data URL for the desktop BrowserWindow.
 */
import { resolve } from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve(import.meta.dirname, './src/renderer/src'),
      '@types': resolve(import.meta.dirname, './src/@types'),
      '@common': resolve(import.meta.dirname, './src/common'),
      '@assets': resolve(import.meta.dirname, './src/renderer/src/assets'),
    },
  },
  build: {
    outDir: resolve(import.meta.dirname, 'out', 'renderer'),
    emptyOutDir: true,
    base: './',
    assetsInlineLimit: 0,
    lib: {
      entry: resolve(import.meta.dirname, 'src/renderer/src/desktop-lyrics/main.tsx'),
      formats: ['iife'],
      name: 'NoraDesktopLyrics',
      fileName: () => 'desktop-lyrics.js',
    },
    minify: true,
    sourcemap: false,
  },
});
