/**
 * Integration tests for restoring from Settings (AC11): a restore is applied at the next start, before the catalog
 * opens, keeping a copy of the catalog it replaces so it can be undone; a damaged backup leaves the catalog exactly as
 * it was. Also the backup service's refusals and its record of the last backup.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupCatalog } from '../../src/main/catalog/backup'
import { createBackupService } from '../../src/main/catalog/backup-service'
import { openCatalog } from '../../src/main/catalog/database'
import { createAlbum, listAlbums } from '../../src/main/catalog/repositories/albums'
import { applyPendingRestore, lastBackup, lastRestore, scheduleRestore, scheduleUndo } from '../../src/main/catalog/restore-on-start'
import { openTestCatalog, seedAssets, seedSource, tempDir, tempProfile } from './helpers'

// A profile like the app's: a catalog file and an app-data folder with a backups folder, plus one backup made of it.
async function profileWithBackup() {
  const profile = tempProfile()
  const db = await openTestCatalog(profile.catalogFile)
  seedAssets(db, seedSource(db, 'Summer').sourceId, 3)
  createAlbum(db, 'In the backup')
  const { folder } = await backupCatalog(db, { destinationDir: tempDir(), appVersion: '0.0.1' })
  createAlbum(db, 'Made after the backup')
  db.close()
  const paths = { appDataDir: profile.dir, catalogFile: profile.catalogFile, backupDir: profile.backupDir }
  return { paths, folder }
}

const albumTitles = async (file: string) => {
  const db = await openCatalog(file)
  try {
    return listAlbums(db).map((a) => a.title).sort()
  } finally {
    db.close()
  }
}

describe('restoring at the next start', () => {
  it('does nothing when no restore is scheduled', async () => {
    const { paths } = await profileWithBackup()
    expect(await applyPendingRestore(paths)).toBeNull()
  })

  it('puts the backup in place before the catalog opens, and can be undone at the start after', async () => {
    const { paths, folder } = await profileWithBackup()
    scheduleRestore(paths.appDataDir, folder)
    expect(await applyPendingRestore(paths)).toEqual({ kind: 'restored' })
    expect(await albumTitles(paths.catalogFile)).toEqual(['In the backup'])
    expect(existsSync(join(paths.appDataDir, 'pending-restore.json'))).toBe(false) // never applied twice
    expect(lastRestore(paths.appDataDir)).toMatchObject({ appVersion: '0.0.1' })

    scheduleUndo(paths.appDataDir)
    expect(await applyPendingRestore(paths)).toEqual({ kind: 'undone' })
    expect(await albumTitles(paths.catalogFile)).toEqual(['In the backup', 'Made after the backup'])
    expect(lastRestore(paths.appDataDir)).toBeNull()
  })

  it('leaves the catalog exactly as it was when the backup is damaged, and says the restore failed', async () => {
    const { paths, folder } = await profileWithBackup()
    writeFileSync(join(folder, 'catalog.sqlite'), 'not a catalog any more') // the test's own backup, damaged
    const before = readFileSync(paths.catalogFile)
    scheduleRestore(paths.appDataDir, folder)
    expect(await applyPendingRestore(paths)).toEqual({ kind: 'failed' })
    expect(readFileSync(paths.catalogFile).equals(before)).toBe(true)
    expect(lastRestore(paths.appDataDir)).toBeNull()
    expect(existsSync(join(paths.appDataDir, 'pending-restore.json'))).toBe(false)
  })

  it('keeps only the three newest copies of replaced catalogs', async () => {
    const { paths, folder } = await profileWithBackup()
    for (let i = 0; i < 5; i++) {
      scheduleRestore(paths.appDataDir, folder)
      expect(await applyPendingRestore(paths, new Date(Date.UTC(2026, 10, 3, 10, i)))).toEqual({ kind: 'restored' })
    }
    expect(readdirSync(paths.backupDir).filter((n) => n.startsWith('catalog-prerestore-'))).toHaveLength(3)
  })
})

describe('the backup service', () => {
  it('backs up to a folder the person picks, records it, and refuses photo folders and Nearmora’s own data', async () => {
    const profile = tempProfile()
    mkdirSync(profile.dir, { recursive: true })
    const db = await openTestCatalog(profile.catalogFile)
    const { rootPath } = seedSource(db, 'Summer')
    const service = createBackupService({ db, appDataDir: profile.dir, appVersion: '0.0.1', startup: null, restart: () => {} })

    expect(await service.create(rootPath)).toEqual({ status: 'refused', reason: 'inside_source' })
    expect(await service.create(profile.dir)).toEqual({ status: 'refused', reason: 'app_data' })
    expect(await service.create(join(tempDir(), 'missing'))).toEqual({ status: 'refused', reason: 'unwritable' })
    const done = await service.create(tempDir())
    expect(done).toMatchObject({ status: 'done', counts: { sources: 1 } })
    expect(lastBackup(profile.dir)).toMatchObject({ folderName: done.status === 'done' ? done.folderName : '' })
  })

  it('only restores a backup it checked and gave a token for, and restarts to do it', async () => {
    const profile = tempProfile()
    const db = await openTestCatalog(profile.catalogFile)
    let restarts = 0
    const service = createBackupService({ db, appDataDir: profile.dir, appVersion: '0.0.1', startup: null, restart: () => restarts++ })
    const { folder } = await backupCatalog(db, { destinationDir: tempDir(), appVersion: '0.0.1' })
    expect(service.restore('3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e')).toBe(false)
    expect(service.inspect(join(tempDir()))).toEqual({ status: 'invalid', reason: 'damaged' })
    const checked = service.inspect(folder)
    expect(checked.status).toBe('ready')
    expect(service.restore(checked.status === 'ready' ? checked.token : '')).toBe(true)
    expect(restarts).toBe(1)
    expect(JSON.parse(readFileSync(join(profile.dir, 'pending-restore.json'), 'utf8'))).toEqual({ kind: 'backup', folder })
  })
})
