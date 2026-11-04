/**
 * Restoring the catalog from the Settings screen. A restore is never done while the catalog is open: it's scheduled,
 * the app restarts, and the backup is put in place before the catalog opens, keeping a copy of the catalog it replaces
 * so the restore can be undone. Also remembers the last backup made, so Settings can show it.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { z } from 'zod'
import { inspectBackup, replaceCatalogFile, type BackupManifest } from './backup'
import { snapshotTo } from './snapshot'

const PENDING_FILE = 'pending-restore.json'
const LAST_RESTORE_FILE = 'last-restore.json'
const LAST_BACKUP_FILE = 'last-backup.json'
const SAFETY_PREFIX = 'catalog-prerestore-'

const Pending = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('backup'), folder: z.string() }),
  z.object({ kind: z.literal('undo') }),
])

const LastRestore = z.object({
  restoredAt: z.iso.datetime(),
  backupMadeAt: z.iso.datetime(),
  appVersion: z.string(),
  /** The catalog as it was just before the restore, kept so the restore can be undone. */
  safetyCopy: z.string(),
})
export type LastRestore = z.infer<typeof LastRestore>

const LastBackup = z.object({ at: z.iso.datetime(), folderName: z.string(), counts: z.record(z.string(), z.number()) })
export type LastBackup = z.infer<typeof LastBackup>

export interface Paths {
  appDataDir: string
  catalogFile: string
  /** Where safety copies go (the app-data backups folder, with the pre-migration copies). */
  backupDir: string
}

/** What happened at startup, for Settings to say. */
export type StartupOutcome = { kind: 'restored' } | { kind: 'undone' } | { kind: 'failed' } | null

const readJson = <T>(file: string, schema: z.ZodType<T>): T | null => {
  try {
    return schema.parse(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/** Asks for the backup in `folder` to be put in place at the next start. */
export const scheduleRestore = (appDataDir: string, folder: string): void =>
  writeFileSync(join(appDataDir, PENDING_FILE), JSON.stringify({ kind: 'backup', folder }))

/** Asks for the last restore to be undone at the next start (the catalog from just before it is put back). */
export const scheduleUndo = (appDataDir: string): void => writeFileSync(join(appDataDir, PENDING_FILE), JSON.stringify({ kind: 'undo' }))

export const lastRestore = (appDataDir: string): LastRestore | null => {
  const record = readJson(join(appDataDir, LAST_RESTORE_FILE), LastRestore)
  return record && existsSync(record.safetyCopy) ? record : null
}

export const lastBackup = (appDataDir: string): LastBackup | null => readJson(join(appDataDir, LAST_BACKUP_FILE), LastBackup)

export const recordBackup = (appDataDir: string, folderName: string, manifest: BackupManifest): void =>
  writeFileSync(join(appDataDir, LAST_BACKUP_FILE), JSON.stringify({ at: manifest.createdAt, folderName, counts: manifest.counts }))

/**
 * Run at startup, before the catalog opens. Applies a scheduled restore or undo, if any. The request is removed first,
 * so a problem can't repeat on every start; on any problem the catalog is left exactly as it was (replaceCatalogFile
 * checks the incoming copy before it replaces anything).
 */
export async function applyPendingRestore(paths: Paths, now = new Date()): Promise<StartupOutcome> {
  const pendingFile = join(paths.appDataDir, PENDING_FILE)
  if (!existsSync(pendingFile)) return null
  const pending = readJson(pendingFile, Pending)
  rmSync(pendingFile, { force: true })
  if (!pending) return { kind: 'failed' }
  try {
    if (pending.kind === 'undo') {
      const record = lastRestore(paths.appDataDir)
      if (!record) return { kind: 'failed' }
      replaceCatalogFile(record.safetyCopy, paths.catalogFile)
      rmSync(join(paths.appDataDir, LAST_RESTORE_FILE), { force: true })
      return { kind: 'undone' }
    }
    const manifest = inspectBackup(pending.folder)
    // A copy of the catalog being replaced, so the restore can be undone; only the newest three are kept.
    const safetyCopy = join(paths.backupDir, `${SAFETY_PREFIX}${now.toISOString().replace(/[:.]/g, '-')}.sqlite`)
    mkdirSync(paths.backupDir, { recursive: true })
    if (existsSync(paths.catalogFile)) {
      const current = new Database(paths.catalogFile, { readonly: true })
      try {
        await snapshotTo(current, safetyCopy)
      } finally {
        current.close()
      }
    }
    replaceCatalogFile(join(pending.folder, 'catalog.sqlite'), paths.catalogFile)
    const record: LastRestore = { restoredAt: now.toISOString(), backupMadeAt: manifest.createdAt, appVersion: manifest.appVersion, safetyCopy }
    writeFileSync(join(paths.appDataDir, LAST_RESTORE_FILE), JSON.stringify(record))
    const old = readdirSync(paths.backupDir)
      .filter((name) => name.startsWith(SAFETY_PREFIX))
      .sort()
      .slice(0, -3)
    for (const name of old) rmSync(join(paths.backupDir, name), { force: true })
    return { kind: 'restored' }
  } catch (error: unknown) {
    console.error('[restore] not applied', error instanceof Error ? error.message : '')
    return { kind: 'failed' }
  }
}
