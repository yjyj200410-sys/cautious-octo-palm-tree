import { copyFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      sourcemap: true,
      minify: false,
      rollupOptions: {
        input: { main: '/src/main/bootstrap.ts', colorosMssWorker: '/src/main/audio/colorosMssWorker.ts', colorosMssPrepareWorker:'/src/main/audio/colorosMssPrepareWorker.ts' },
        external: ['sharp', 'ffmpeg-static', 'onnxruntime-node', /@neteasecloudmusicapienhanced/]
      }
    },
    resolve: {
      alias: {
        '@db': resolve(import.meta.dirname, './src/main/db'),
        '@main': resolve(import.meta.dirname, './src/main'),
        '@common': resolve(import.meta.dirname, './src/common')
      }
    }
  },
  preload: {
    build: {
      sourcemap: true,
      minify: false,
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].mjs' } }
    }
  },
  renderer: {
    build: {
      minify: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          main: resolve(import.meta.dirname, './src/renderer/index.html'),
          'desktop-lyrics': resolve(import.meta.dirname, './src/renderer/desktop-lyrics.html'),
          'mini-player': resolve(import.meta.dirname, './src/renderer/mini-player.html'),
          'tray-menu': resolve(import.meta.dirname, './src/renderer/tray-menu.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@renderer': resolve(import.meta.dirname, './src/renderer/src'),
        '@types': resolve(import.meta.dirname, './src/@types'),
        '@common': resolve(import.meta.dirname, './src/common'),
        '@assets': resolve(import.meta.dirname, './src/renderer/src/assets')
      }
    },
    plugins: [
      // Copy built-in wallpaper HTML files to out/builtin-wallpapers/
      {
        name: 'copy-builtin-wallpapers',
        writeBundle() {
          const srcDir = resolve(import.meta.dirname, './src/renderer/src/assets/builtin-wallpapers');
          const destDir = resolve(import.meta.dirname, './out/builtin-wallpapers');
          mkdirSync(destDir, { recursive: true });
          for (const name of ['starfield.html', 'static-glow.html']) {
            copyFileSync(join(srcDir, name), join(destDir, name));
          }
        },
      },
      tanstackRouter({
        target: 'react',
        routesDirectory: 'src/routes',
        generatedRouteTree: 'src/routeTree.gen.ts',
        autoCodeSplitting: true
      }),
      react(),
      tailwindcss()
    ]
  }
});
