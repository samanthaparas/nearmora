import { defineConfig } from '@playwright/test'

// E2E tests launch the built Electron app (out/), not a browser.
// `npm run test:e2e` builds first. These tests do not cover a packaged .app yet.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list']],
})
