import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// One config, three builds: main (Node), preload (sandboxed bridge), renderer (browser).
export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
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
