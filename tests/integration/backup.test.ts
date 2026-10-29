/**
 * Integration tests for catalog backup and restore (AC11, partial until projects exist in R5).
 * A backup must restore choices into a clean profile, explain missing photo folders,
 * never overwrite an earlier backup, and refuse a damaged backup before replacing anything.
 */

import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupCatalog, BackupManifest, inspectBackup, restoreCatalogBackup } from '../../src/main/catalog/backup'
import type { Catalog } from '../../src/main/catalog/database'
import { CatalogError } from '../../src/main/catalog/errors'
import { latestVersion } from '../../src/main/catalog/migrate'
import { MIGRATIONS } from '../../src/main/catalog/migrations'
import { createAlbum, getAlbumAssetIds, listAlbums, setAlbumMembers } from '../../src/main/catalog/repositories/albums'
import { saveReview } from '../../src/main/catalog/repositories/review'
import { createSimilaritySet, getSetReview } from '../../src/main/catalog/repositories/sets'
import { checkSourceReachability } from '../../src/main/catalog/repositories/sources'
import { codeOf, openTestCatalog, seedAssets, seedSource, tempDir, tempProfile } from './helpers'

const NOW = new Date('2026-10-28T15:30:00')

// A catalog with a source, pictures, a reviewed set, an album and a project.
async function populatedCatalog() {
  const profile = tempProfile()
  const db = await openTestCatalog(profile.catalogFile)
  const { sourceId, rootPath } = seedSource(db, 'Fixtures')
  const assets = seedAssets(db, sourceId, 4)
  const setId = createSimilaritySet(db, { reason: 'visual', algorithmVersion: 'test@1', assetIds: assets.slice(0, 3) })
  saveReview(db, { setId, favorites: [assets[0]!, assets[2]!], status: 'reviewed', expectedRevision: 0 })
  const album = createAlbum(db, 'Beach day')
  setAlbumMembers(db, album.id, [assets[3]!, assets[1]!])
  const projectId = randomUUID()
  db.prepare(`INSERT INTO project VALUES (?, 'Beach collage', 'collage_2', '4:5', 'cream', 1, 0)`).run(projectId)
  db.prepare('INSERT INTO project_item VALUES (?, 0, ?, 0.4, 0.6, 1.5)').run(projectId, assets[0])
  return { db, profile, assets, setId, albumId: album.id, projectId, rootPath }
}

const codeOfAsync = async (promise: Promise<unknown>): Promise<string | undefined> =>
  promise.then(
    () => undefined,
    (error: unknown) => (error instanceof CatalogError ? error.code : String(error)),
  )

describe('catalog backup', () => {
  it('writes a verified copy, a manifest and a note that photos are not included', async () => {
    const { db } = await populatedCatalog()
    const { folder, manifest } = await backupCatalog(db, { destinationDir: tempDir(), appVersion: '0.0.1', now: NOW })

    expect(readdirSync(folder).sort()).toEqual(['README.txt', 'catalog.sqlite', 'manifest.json'])
    expect(folder).toMatch(/Nearmora catalog backup 2026-10-28 1530$/)
    expect(BackupManifest.parse(JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8')))).toEqual(manifest)
    expect(manifest).toMatchObject({
      schemaVersion: latestVersion(MIGRATIONS),
      originalPhotosIncluded: false,
      counts: { sources: 1, assets: 4, favorites: 2, similaritySets: 1, albums: 1, projects: 1 },
    })
    expect(readFileSync(join(folder, 'README.txt'), 'utf8')).toMatch(/does NOT contain your original photos/)
  })

  it('never overwrites an earlier backup with the same name', async () => {
    const { db } = await populatedCatalog()
    const destinationDir = tempDir()
    const first = await backupCatalog(db, { destinationDir, appVersion: '0.0.1', now: NOW })
    const second = await backupCatalog(db, { destinationDir, appVersion: '0.0.1', now: NOW })

    expect(second.folder).toBe(`${first.folder} (2)`)
    expect(readdirSync(first.folder)).toHaveLength(3)
  })
})

describe('catalog restore', () => {
  it('restores choices, albums and projects into a clean profile', async () => {
    const original = await populatedCatalog()
    const { folder } = await backupCatalog(original.db, { destinationDir: tempDir(), appVersion: '0.0.1', now: NOW })

    const clean = tempProfile()
    const { catalog, manifest } = await restoreCatalogBackup(folder, clean.catalogFile, { backupDir: clean.backupDir })

    expect(manifest.counts.assets).toBe(4)
    expect(catalog.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(getSetReview(catalog, original.setId)).toMatchObject({ reviewStatus: 'reviewed', revision: 1 })
    expect(getSetReview(catalog, original.setId).members.filter((m) => m.favorite).map((m) => m.assetId)).toEqual([
      original.assets[0],
      original.assets[2],
    ])
    expect(listAlbums(catalog).map((a) => a.title)).toEqual(['Beach day'])
    expect(getAlbumAssetIds(catalog, original.albumId)).toEqual([original.assets[3], original.assets[1]])
    expect(catalog.prepare('SELECT crop_zoom FROM project_item WHERE project_id = ?').get(original.projectId)).toEqual({ crop_zoom: 1.5 })
    catalog.close()
  })

  it('explains a photo folder that is missing on this computer instead of hiding it', async () => {
    const original = await populatedCatalog()
    const { folder } = await backupCatalog(original.db, { destinationDir: tempDir(), appVersion: '0.0.1', now: NOW })
    // Stand-in for "the drive isn't plugged in": the test's own temporary fixture folder goes away.
    rmSync(original.rootPath, { recursive: true })

    const clean = tempProfile()
    const { catalog } = await restoreCatalogBackup(folder, clean.catalogFile)
    expect(checkSourceReachability(catalog).map((r) => ({ name: r.source.displayName, reachable: r.reachable }))).toEqual([
      { name: 'Fixtures', reachable: false },
    ])
    catalog.close()
  })

  it('keeps a safety copy of the catalog it replaces', async () => {
    const original = await populatedCatalog()
    const { folder } = await backupCatalog(original.db, { destinationDir: tempDir(), appVersion: '0.0.1', now: NOW })

    const target = tempProfile()
    const existing: Catalog = await openTestCatalog(target.catalogFile)
    createAlbum(existing, 'Only in the replaced catalog')
    existing.close()

    const { catalog, safetyCopy } = await restoreCatalogBackup(folder, target.catalogFile, { safetyCopyDir: target.backupDir })
    catalog.close()
    expect(safetyCopy && existsSync(safetyCopy)).toBe(true)
    const kept = await openTestCatalog(safetyCopy!)
    expect(listAlbums(kept).map((a) => a.title)).toEqual(['Only in the replaced catalog'])
  })

  it('refuses a backup whose manifest does not match its contents, and leaves the current catalog alone', async () => {
    const original = await populatedCatalog()
    const { folder, manifest } = await backupCatalog(original.db, { destinationDir: tempDir(), appVersion: '0.0.1', now: NOW })
    writeFileSync(join(folder, 'manifest.json'), JSON.stringify({ ...manifest, counts: { ...manifest.counts, assets: 99 } }))

    const target = tempProfile()
    const existing = await openTestCatalog(target.catalogFile)
    createAlbum(existing, 'Keep me')
    existing.close()

    expect(await codeOfAsync(restoreCatalogBackup(folder, target.catalogFile))).toBe('INVALID_BACKUP')
    const after = await openTestCatalog(target.catalogFile)
    expect(listAlbums(after).map((a) => a.title)).toEqual(['Keep me'])
  })

  it('refuses a corrupted catalog file', async () => {
    const original = await populatedCatalog()
    const { folder } = await backupCatalog(original.db, { destinationDir: tempDir(), appVersion: '0.0.1', now: NOW })
    const file = join(folder, 'catalog.sqlite')
    const bytes = readFileSync(file)
    bytes.fill(0xff, 4096, 8192) // overwrite the second page with garbage
    writeFileSync(file, bytes)

    expect(codeOf(() => inspectBackup(folder))).toBe('INVALID_BACKUP')
  })

  it('refuses a folder without a manifest', async () => {
    expect(await codeOfAsync(restoreCatalogBackup(tempDir(), tempProfile().catalogFile))).toBe('INVALID_BACKUP')
  })
})
