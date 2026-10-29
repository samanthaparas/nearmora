/**
 * Integration tests for opening and migrating the catalog, including a deliberately broken migration.
 * These prove a failed upgrade can't damage existing choices and that the pre-migration backup restores cleanly.
 */

import { existsSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { replaceCatalogFile } from '../../src/main/catalog/backup'
import { CatalogError, MigrationError } from '../../src/main/catalog/errors'
import { MIGRATIONS, type Migration } from '../../src/main/catalog/migrations'
import { latestVersion, readSchemaVersion } from '../../src/main/catalog/migrate'
import { createAlbum, listAlbums } from '../../src/main/catalog/repositories/albums'
import { openTestCatalog, tempProfile } from './helpers'

const v1 = MIGRATIONS[0]!
const v2 = MIGRATIONS[1]!
const LATEST = latestVersion(MIGRATIONS)
const goodV2: Migration = { version: 2, name: 'add-note', sql: 'ALTER TABLE album ADD COLUMN note TEXT;' }
// The first statement succeeds and the second fails, so this also proves partial work is rolled back.
const brokenV2: Migration = {
  version: 2,
  name: 'broken',
  sql: 'CREATE TABLE half_done (id TEXT PRIMARY KEY); ALTER TABLE no_such_table ADD COLUMN x TEXT;',
}

const tableNames = (db: Database.Database): string[] =>
  (db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name`).all() as Array<{ name: string }>).map((r) => r.name)

describe('opening a catalog', () => {
  it('creates the latest schema with foreign keys and WAL turned on', async () => {
    const { catalogFile } = tempProfile()
    const db = await openTestCatalog(catalogFile)

    expect(readSchemaVersion(db)).toBe(LATEST)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(tableNames(db)).toEqual(
      expect.arrayContaining(['source', 'asset', 'asset_location', 'similarity_set', 'favorite', 'album', 'project', 'undo_entry']),
    )
  })

  it('does nothing, and takes no backup, when the catalog is already current', async () => {
    const { catalogFile, backupDir } = tempProfile()
    ;(await openTestCatalog(catalogFile, { backupDir })).close()
    const db = await openTestCatalog(catalogFile, { backupDir })

    expect(readSchemaVersion(db)).toBe(LATEST)
    expect(existsSync(backupDir)).toBe(false)
  })
})

describe('migrating an existing catalog', () => {
  it('backs up first, applies the new migration and keeps existing data', async () => {
    const { catalogFile, backupDir } = tempProfile()
    const before = await openTestCatalog(catalogFile, { migrations: [v1] })
    createAlbum(before, 'Summer')
    before.close()

    const db = await openTestCatalog(catalogFile, { backupDir, migrations: [v1, goodV2] })

    expect(readSchemaVersion(db)).toBe(2)
    expect(listAlbums(db).map((a) => a.title)).toEqual(['Summer'])
    expect(readdirSync(backupDir)).toHaveLength(1)
  })

  it('rolls a failing migration back completely, and the pre-migration backup restores cleanly', async () => {
    const { catalogFile, backupDir } = tempProfile()
    const before = await openTestCatalog(catalogFile, { migrations: [v1] })
    createAlbum(before, 'Summer')
    before.close()

    const error = await openTestCatalog(catalogFile, { backupDir, migrations: [v1, brokenV2] }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MigrationError)
    const { backupPath, failedVersion, fromVersion } = error as MigrationError
    expect({ failedVersion, fromVersion }).toEqual({ failedVersion: 2, fromVersion: 1 })
    expect(backupPath && existsSync(backupPath)).toBe(true)

    // The catalog itself is untouched: still v1, no half-created table, data intact.
    const after = new Database(catalogFile, { readonly: true })
    expect(readSchemaVersion(after)).toBe(1)
    expect(tableNames(after)).not.toContain('half_done')
    after.close()

    // Recovery path: put the backup in place and open normally.
    replaceCatalogFile(backupPath!, catalogFile)
    const restored = await openTestCatalog(catalogFile, { migrations: [v1] })
    expect(restored.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(listAlbums(restored).map((a) => a.title)).toEqual(['Summer'])
  })

  it('refuses a catalog from a newer version of the app and leaves it alone', async () => {
    const { catalogFile } = tempProfile()
    const db = await openTestCatalog(catalogFile)
    db.pragma('user_version = 99')
    db.close()

    const error = await openTestCatalog(catalogFile).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CatalogError)
    expect((error as CatalogError).code).toBe('CATALOG_TOO_NEW')
    const check = new Database(catalogFile, { readonly: true })
    expect(readSchemaVersion(check)).toBe(99)
    check.close()
  })

  it('keeps only the newest three pre-migration backups', async () => {
    const { catalogFile, backupDir } = tempProfile()
    const migrations: Migration[] = [v1]
    ;(await openTestCatalog(catalogFile, { migrations })).close()

    for (let version = 2; version <= 6; version++) {
      migrations.push({ version, name: `step-${version}`, sql: `CREATE TABLE step_${version} (id INTEGER PRIMARY KEY);` })
      ;(await openTestCatalog(catalogFile, { backupDir, migrations: [...migrations] })).close()
    }

    const kept = readdirSync(backupDir).sort()
    expect(kept).toHaveLength(3)
    expect(kept.map((name) => name.match(/-v(\d+)\.sqlite$/)?.[1])).toEqual(['3', '4', '5'])
  })

  it('v2 links existing scan jobs to their source, and drops jobs whose source is gone', async () => {
    const { catalogFile, backupDir } = tempProfile()
    const old = await openTestCatalog(catalogFile, { migrations: [v1] })
    old.prepare(`INSERT INTO source VALUES ('s1', '/photos', NULL, 'Photos', 'active', 0, NULL)`).run()
    const job = old.prepare(`INSERT INTO job (id, kind, status, checkpoint, created_at, updated_at) VALUES (?, 'scan', 'done', ?, 0, 0)`)
    job.run('kept', JSON.stringify({ sourceId: 's1', counts: {} }))
    job.run('orphan', JSON.stringify({ sourceId: 'deleted-source', counts: {} }))
    old.close()

    const db = await openTestCatalog(catalogFile, { backupDir, migrations: [v1, v2] })
    expect(db.prepare('SELECT id, source_id FROM job').all()).toEqual([{ id: 'kept', source_id: 's1' }])
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('rejects a migration list with a gap', async () => {
    const { catalogFile } = tempProfile()
    const gap: Migration = { version: 3, name: 'gap', sql: '' }
    await expect(openTestCatalog(catalogFile, { migrations: [v1, gap] })).rejects.toThrow(/out of order/)
  })
})
