/**
 * Configuration for the end-to-end tests (`npm run test:e2e`).
 * These launch the real built Electron app, so they catch problems that unit tests can't.
 */

import { defineConfig } from '@playwright/test'

// `npm run test:e2e` builds first. These tests cover the built app in out/, not a packaged .app yet.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
})
