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
import { deleteProject, getProject, setDesign } from '../../src/main/catalog/repositories/projects'
import { designOf } from '../../src/shared/studio/design'
import { compose } from '../../src/shared/studio/compose'
import { openTestCatalog, seedAssets, seedSource, tempProfile } from './helpers'

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

// Old project rows written with plain SQL, as an older Nearmora would have, so these tests don't depend on today's repository code.
function insertOldProject(db: Database.Database, row: { id: string; kind: string; aspect: string; background: string; assets: string[]; crop?: [number, number, number] }) {
  db.prepare(`INSERT INTO project (id, title, kind, aspect, background, layout_version, updated_at) VALUES (?, ?, ?, ?, ?, 1, 5)`).run(
    row.id,
    `Old ${row.kind}`,
    row.kind,
    row.aspect,
    row.background,
  )
  row.assets.forEach((assetId, position) => {
    const [cx, cy, zoom] = position === 1 && row.crop ? row.crop : [0.5, 0.5, 1]
    db.prepare(`INSERT INTO project_item (project_id, position, asset_id, crop_cx, crop_cy, crop_zoom) VALUES (?, ?, ?, ?, ?, ?)`).run(row.id, position, assetId, cx, cy, zoom)
  })
}

describe('schema v4: landscape projects', () => {
  it('keeps every existing project, photo and crop, allows landscape, and still deletes items with their project', async () => {
    const { catalogFile, backupDir } = tempProfile()
    const old = await openTestCatalog(catalogFile, { migrations: MIGRATIONS.slice(0, 3) })
    const assets = seedAssets(old, seedSource(old).sourceId, 2)
    insertOldProject(old, { id: 'p1', kind: 'collage_2', aspect: '4:5', background: 'white', assets, crop: [0.3, 0.7, 2] })
    const items = () => old.prepare('SELECT * FROM project_item ORDER BY position').all()
    const before = { project: old.prepare('SELECT * FROM project').all(), items: items() }
    expect(() => old.prepare(`UPDATE project SET aspect = '5:4'`).run()).toThrow(/CHECK/)
    old.close()

    const db = await openTestCatalog(catalogFile, { backupDir, migrations: MIGRATIONS.slice(0, 4) })
    expect(readSchemaVersion(db)).toBe(4)
    expect({ project: db.prepare('SELECT * FROM project').all(), items: db.prepare('SELECT * FROM project_item ORDER BY position').all() }).toEqual(before)
    db.prepare(`UPDATE project SET aspect = '5:4'`).run()
    // The item table points at the new project table, so deleting a project still removes its items (and only those).
    expect(db.prepare('PRAGMA foreign_key_list(project_item)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'project', on_delete: 'CASCADE' })]),
    )
    db.prepare(`DELETE FROM project WHERE id = 'p1'`).run()
    expect(db.prepare('SELECT COUNT(*) AS n FROM project_item').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM asset').get()).toEqual({ n: 2 })
  })
})

describe('schema v5: templates', () => {
  it('maps every older project onto a template that lays it out exactly as before, keeping photos and crops', async () => {
    const { catalogFile, backupDir } = tempProfile()
    const old = await openTestCatalog(catalogFile, { migrations: MIGRATIONS.slice(0, 4) })
    const assets = seedAssets(old, seedSource(old).sourceId, 4)
    insertOldProject(old, { id: 'two', kind: 'collage_2', aspect: '1:1', background: 'white', assets: assets.slice(0, 2), crop: [0.3, 0.7, 2] })
    insertOldProject(old, { id: 'four', kind: 'collage_4', aspect: '5:4', background: 'cream', assets })
    insertOldProject(old, { id: 'slides', kind: 'carousel', aspect: '4:5', background: 'cream', assets: assets.slice(0, 3) })
    old.close()

    const db = await openTestCatalog(catalogFile, { backupDir })
    expect(readSchemaVersion(db)).toBe(LATEST)
    expect(readdirSync(backupDir)).toHaveLength(1) // backed up before migrating
    const two = getProject(db, 'two')
    expect(two).toMatchObject({ title: 'Old collage_2', templateId: 'pair-equal-split', templateVersion: 1, format: 'square', params: { v: 1, background: '#ffffff' } })
    expect(two.items.map((i) => [i.assetId, i.crop, i.fit])).toEqual([
      [assets[0], { cx: 0.5, cy: 0.5, zoom: 1 }, 'fill'],
      [assets[1], { cx: 0.3, cy: 0.7, zoom: 2 }, 'fill'],
    ])
    expect(getProject(db, 'four')).toMatchObject({ templateId: 'quartet-classic-grid', format: 'landscape', params: { v: 1, background: '#f8f0e8' } })
    expect(getProject(db, 'slides')).toMatchObject({ templateId: 'carousel-full', format: 'portrait' })

    // Studio Lite's square two-photo layout: a 48 px margin, a 24 px gap and two 480 × 984 cells.
    const layout = compose({ ...two, photoCount: 2 })
    expect(layout.elements.map((e) => e.rect)).toEqual([
      { x: 48, y: 48, width: 480, height: 984 },
      { x: 552, y: 48, width: 480, height: 984 },
    ])
    expect(layout.background).toBe('#ffffff')
    // Projects keep working: edit, then delete (its items go with it; pictures stay).
    setDesign(db, { projectId: 'four', design: { ...designOf(getProject(db, 'four')), format: 'portrait' } })
    deleteProject(db, 'slides')
    expect(db.prepare(`SELECT COUNT(*) AS n FROM project_item WHERE project_id = 'slides'`).get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM asset').get()).toEqual({ n: 4 })
  })
})
