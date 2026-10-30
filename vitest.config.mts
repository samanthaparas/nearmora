/**
 * Configuration for the unit, integration and component tests (`npm test`).
 * Tests run in plain Node, with no Electron, so they stay fast and can run in CI. Component tests (*.test.tsx)
 * opt into a simulated browser (jsdom) with a comment at the top of the file.
 */

import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Compiles JSX in component tests the same way the app's renderer build does.
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    // On CI, one test file at a time: mounting and ejecting the tests' small disk images can briefly stall path
    // lookups on the runner, which made unrelated tests time out when they ran alongside (about 13 s slower locally).
    fileParallelism: !process.env['CI'],
  },
})
