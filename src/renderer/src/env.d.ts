/// <reference types="vite/client" />

/**
 * Tells TypeScript about things that exist at runtime but not in our source:
 * `window.nearmora` from the preload, and Vite's handling of CSS and asset imports.
 */
import type { NearmoraApi } from '@shared/bridge-api'

declare global {
  interface Window {
    readonly nearmora: NearmoraApi
  }
}

export {}
