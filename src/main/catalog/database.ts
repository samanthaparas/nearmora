/**
 * Opens Nearmora's catalog: the SQLite database of sources, photos, favorites, albums and projects.
 * Every connection goes through here so the safety settings (foreign keys, WAL) and migrations are never skipped.
 */

import Database from 'better-sqlite3'
import { MIGRATIONS, type Migration } from './migrations'
import { runMigrations } from './migrate'

export type Catalog = Database.Database

export interface OpenCatalogOptions {
  /** Folder for automatic pre-migration backups. */
  backupDir?: string
  /** Overridable so tests can run a deliberately broken migration. */
  migrations?: readonly Migration[]
}

export const IN_MEMORY = ':memory:'

export async function openCatalog(file: string, options: OpenCatalogOptions = {}): Promise<Catalog> {
  const db = new Database(file)
  try {
    // SQLite ignores foreign keys unless each connection turns them on.
    db.pragma('foreign_keys = ON')
    if (db.pragma('foreign_keys', { simple: true }) !== 1) throw new Error('SQLite foreign keys are unavailable')
    // Wait briefly instead of failing if another connection holds a lock.
    db.pragma('busy_timeout = 5000')
    // Write-ahead logging: readers don't block the writer, and a crash can't leave a half-written page.
    if (file !== IN_MEMORY) db.pragma('journal_mode = WAL')

    const migrationOptions = options.backupDir ? { backupDir: options.backupDir } : {}
    await runMigrations(db, options.migrations ?? MIGRATIONS, migrationOptions)
    return db
  } catch (error: unknown) {
    db.close()
    throw error
  }
}
