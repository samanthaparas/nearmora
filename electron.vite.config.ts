/**
 * Build configuration for all three parts of the desktop app (main, preload, renderer).
 * One config keeps the three builds consistent and is what `npm run dev` and `npm run build` read.
 */

import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Records which third-party packages a build bundles into its output, as `bundled-packages.json`. scripts/notices.mjs
 * turns these lists (with the packages shipped as they are, and Electron) into the licence notices the app shows.
 */
function recordPackages(): Plugin {
  return {
    name: 'nearmora-record-packages',
    generateBundle() {
      const names = new Set<string>()
      for (const id of this.getModuleIds()) {
        const match = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(id.replace(/\\/g, '/'))
        if (match) names.add(match[1]!)
      }
      this.emitFile({ type: 'asset', fileName: 'bundled-packages.json', source: `${JSON.stringify([...names].sort(), null, 2)}\n` })
    },
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [recordPackages()],
    build: {
      rollupOptions: {
        // Two entry points: the main process, and the media worker it starts as a separate process.
        input: { index: resolve('src/main/index.ts'), 'media-worker': resolve('src/main/media-worker.ts') },
      },
    },
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [recordPackages()],
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react(), recordPackages()],
    build: {
      // Emit every asset as a file. Inlined data: URIs would need a looser CSP.
      assetsInlineLimit: 0,
      rollupOptions: { input: resolve('src/renderer/index.html') },
    },
  },
})
