/**
 * Starts the built app for end-to-end tests with a throwaway profile, so tests never touch the real
 * app-data folder (catalog, thumbnails) on the machine running them.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

export function tempFolder(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `nearmora-e2e-${prefix}-`))
}

export async function launchApp(profileDir = tempFolder('profile')): Promise<{ app: ElectronApplication; profileDir: string }> {
  // ELECTRON_RENDERER_URL is removed so the app loads from app://nearmora exactly as a built app does.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL',
    ),
  )
  env['NEARMORA_USER_DATA_DIR'] = profileDir
  const app = await electron.launch({ args: ['.'], env })
  return { app, profileDir }
}
