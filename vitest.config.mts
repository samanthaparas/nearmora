/**
 * Configuration for the unit tests (`npm test`).
 * Tests run in plain Node, with no Electron, so they stay fast and can run in CI.
 */

import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
