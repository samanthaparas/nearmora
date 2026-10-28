/// <reference types="vite/client" />
import type { NearmoraApi } from '@shared/bridge-api'

declare global {
  interface Window {
    readonly nearmora: NearmoraApi
  }
}

export {}
