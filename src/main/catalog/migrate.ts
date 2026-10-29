/**
 * Brings a catalog up to the latest schema, one migration at a time.
 * Each migration runs in a transaction, so a failure leaves the catalog exactly as it was,
 * and an existing catalog is copied to a backup first in case something goes wrong outside SQLite.
 */

import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { CatalogError, MigrationError } from './errors'
import type { Migration } from './migrations'
import { snapshotTo } from './snapshot'

const PREMIGRATE_PREFIX = 'catalog-premigrate-'

export interface MigrationOptions {
  /** Where pre-migration backups go. Without it, existing catalogs are migrated without a backup (tests only). */
  backupDir?: string
  /** How many pre-migration backups to keep (roadmap: the last 3). */
  keepBackups?: number
}

export interface MigrationResult {
  from: number
  to: number
  backupPath?: string
}

/** The schema version is stored in the database file header (`PRAGMA user_version`); 0 means a new, empty catalog. */
export function readSchemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number
}

export function latestVersion(migrations: readonly Migration[]): number {
  return migrations.at(-1)?.version ?? 0
}

// Catches mistakes in the migration list itself, such as a skipped or duplicated number.
function assertSequential(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(`Migration list is out of order at ${migration.name}: expected v${index + 1}`)
    }
  })
}

export async function runMigrations(
  db: Database.Database,
  migrations: readonly Migration[],
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  assertSequential(migrations)
  const from = readSchemaVersion(db)
  const to = latestVersion(migrations)

  // A catalog written by a newer Nearmora may use tables this version doesn't understand. Never touch it.
  if (from > to) {
    throw new CatalogError('CATALOG_TOO_NEW', `Catalog is schema v${from}; this app knows up to v${to}`)
  }
  if (from === to) return { from, to }

  // Only an existing catalog has anything worth backing up.
  let backupPath: string | undefined
  if (from > 0 && options.backupDir) {
    backupPath = await backupBeforeMigrate(db, options.backupDir, from, options.keepBackups ?? 3)
  }

  for (const migration of migrations.slice(from)) {
    const apply = db.transaction(() => {
      db.exec(migration.sql)
      // PRAGMA can't take bound parameters; the version is a number from our own list.
      db.pragma(`user_version = ${migration.version}`)
      // Refuse to commit a migration that leaves rows pointing at nothing.
      const violations = db.pragma('foreign_key_check') as unknown[]
      if (violations.length > 0) throw new Error(`${violations.length} foreign key violation(s) after migrating`)
    })
    try {
      apply()
    } catch (cause: unknown) {
      throw new MigrationError(migration.version, from, backupPath, cause)
    }
  }

  return backupPath ? { from, to, backupPath } : { from, to }
}

// Copies the catalog with SQLite's online backup, then deletes all but the newest `keep` copies.
async function backupBeforeMigrate(db: Database.Database, backupDir: string, version: number, keep: number): Promise<string> {
  mkdirSync(backupDir, { recursive: true })
  // The timestamp comes first so sorting by name sorts by age.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = join(backupDir, `${PREMIGRATE_PREFIX}${stamp}-v${version}.sqlite`)
  await snapshotTo(db, backupPath)

  const old = readdirSync(backupDir)
    .filter((name) => name.startsWith(PREMIGRATE_PREFIX) && name.endsWith('.sqlite'))
    .sort()
    .slice(0, -keep)
  for (const name of old) rmSync(join(backupDir, name))

  return backupPath
}
