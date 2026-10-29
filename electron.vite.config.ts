/**
 * Build configuration for all three parts of the desktop app (main, preload, renderer).
 * One config keeps the three builds consistent and is what `npm run dev` and `npm run build` read.
 */

import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        // Two entry points: the main process, and the media worker it starts as a separate process.
        input: { index: resolve('src/main/index.ts'), 'media-worker': resolve('src/main/media-worker.ts') },
      },
    },
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()],
    build: {
      // Emit every asset as a file. Inlined data: URIs would need a looser CSP.
      assetsInlineLimit: 0,
      rollupOptions: { input: resolve('src/renderer/index.html') },
    },
  },
})
