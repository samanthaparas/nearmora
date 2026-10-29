/**
 * Integration tests for indexing a folder (AC1, AC2) with real files, real SQLite and the real image pipeline.
 * The originals-safety tests fingerprint every file and watch for writes; the rest check counts and duplicates.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/main/catalog/database'
import { queryLibrary } from '../../src/main/catalog/repositories/library'
import { getSource } from '../../src/main/catalog/repositories/sources'
import { scanSource, type ScanDeps } from '../../src/main/library/scan'
import { addSourceFolder } from '../../src/main/library/source-folders'
import { processImage } from '../../src/main/media/process-image'
import { generatePhotoFolder } from '../support/generate-photos'
import { fingerprintFolder, watchForWrites } from '../support/originals-guard'
import { openTestCatalog, tempDir, tempProfile } from './helpers'

async function setup() {
  const profile = tempProfile()
  const db = await openTestCatalog(profile.catalogFile)
  const thumbnailsDir = join(profile.dir, 'thumbnails')
  mkdirSync(thumbnailsDir)
  const folder = await generatePhotoFolder(join(tempDir(), 'Photos'))
  const added = addSourceFolder(db, folder.root, profile.dir)
  if (!added.ok) throw new Error(`could not add test folder: ${added.reason}`)
  const deps: ScanDeps = { db, thumbnailsDir, processImage }
  return { db, deps, folder, sourceId: added.source.id, thumbnailsDir, appDataDir: profile.dir }
}

const count = (db: Catalog, sql: string): number => (db.prepare(sql).get() as { n: number }).n

describe('scanning a folder', () => {
  it('indexes every supported photo and explains everything it skipped', async () => {
    const { db, deps, folder, sourceId, thumbnailsDir } = await setup()
    const { outcome, counts } = await scanSource(deps, sourceId)

    expect(outcome).toBe('done')
    const { found, indexed, unsupported, corrupt } = folder.expected
    expect(counts).toEqual({ found, indexed, unsupported, corrupt, tooLarge: 0, unreadable: 0, unchanged: 0 })
    expect(count(db, 'SELECT COUNT(*) AS n FROM asset')).toBe(folder.expected.distinctPhotos)
    expect(count(db, 'SELECT COUNT(*) AS n FROM asset_location')).toBe(folder.expected.indexed)
    expect(readdirSync(thumbnailsDir).filter((f) => f.endsWith('.webp'))).toHaveLength(folder.expected.distinctPhotos)
    expect(getSource(db, sourceId).lastScanAt).not.toBeNull()
  })

  it('reads dates and rotation from the photo, and falls back to the file date when there is none', async () => {
    const { db, deps, sourceId } = await setup()
    await scanSource(deps, sourceId)
    const byPath = (path: string) =>
      db
        .prepare(
          `SELECT a.width, a.height, a.orientation, a.captured_at_source AS source, length(a.dhash) AS dhashBytes
           FROM asset a JOIN asset_location l ON l.asset_id = a.id WHERE l.relative_path = ?`,
        )
        .get(path)

    expect(byPath('rotated.jpg')).toEqual({ width: 48, height: 64, orientation: 6, source: 'exif', dhashBytes: 8 })
    expect(byPath('dated.jpg')).toMatchObject({ width: 64, height: 48, source: 'exif' })
    expect(byPath('screenshot.png')).toMatchObject({ source: 'file_mtime' })
  })

  it('leaves every original byte-for-byte unchanged, with the same modification times, and writes nothing in the folder (AC1)', async () => {
    const { deps, folder, sourceId } = await setup()
    const before = fingerprintFolder(folder.root)
    await sleep(300) // let file-creation events from generating the folder settle before watching
    const watcher = watchForWrites(folder.root)

    await scanSource(deps, sourceId)
    await scanSource(deps, sourceId) // and a rescan
    await sleep(1000) // file events arrive late on a busy machine; give any write time to be reported

    expect(watcher.stop()).toEqual([])
    expect(fingerprintFolder(folder.root)).toEqual(before)
  })

  it('the write watcher really does notice a write (control for the test above)', async () => {
    const { folder } = await setup()
    await sleep(300)
    const watcher = watchForWrites(folder.root)
    writeFileSync(join(folder.root, 'new.txt'), 'written')
    expect(await watcher.firstEvent(5000)).toBe(true)
    watcher.stop()
  })
})

describe('rescans, cancelling and missing files (AC2)', () => {
  it('a rescan adds no duplicates and skips unchanged files', async () => {
    const { db, deps, sourceId, folder } = await setup()
    await scanSource(deps, sourceId)
    const { counts } = await scanSource(deps, sourceId)

    expect(counts).toMatchObject({ indexed: 0, unchanged: folder.expected.indexed })
    expect(count(db, 'SELECT COUNT(*) AS n FROM asset_location')).toBe(folder.expected.indexed)
  })

  it('a cancelled scan can be restarted without duplicates', async () => {
    const { db, deps, sourceId, folder } = await setup()
    const controller = new AbortController()
    // Cancel as soon as the first photo has been processed.
    const cancelling: ScanDeps = { ...deps, processImage: (request) => processImage(request).finally(() => controller.abort()) }

    const first = await scanSource(cancelling, sourceId, { signal: controller.signal })
    expect(first.outcome).toBe('cancelled')
    expect(first.counts.indexed).toBeLessThan(folder.expected.indexed)

    const second = await scanSource(deps, sourceId)
    expect(second.outcome).toBe('done')
    expect(count(db, 'SELECT COUNT(*) AS n FROM asset_location')).toBe(folder.expected.indexed)
    expect(count(db, 'SELECT COUNT(*) AS n FROM asset')).toBe(folder.expected.distinctPhotos)
    expect(count(db, `SELECT COUNT(*) AS n FROM job WHERE status = 'cancelled'`)).toBe(1)
  })

  it('marks a file that disappeared as missing instead of deleting its record', async () => {
    const { db, deps, sourceId, folder } = await setup()
    await scanSource(deps, sourceId)
    // The test's own generated copy is removed, standing in for a file the person moved elsewhere.
    rmSync(join(folder.root, 'copies', 'dated-copy.jpg'))
    await scanSource(deps, sourceId)

    expect(db.prepare(`SELECT availability FROM asset_location WHERE relative_path = 'copies/dated-copy.jpg'`).get()).toEqual({
      availability: 'missing',
    })
    // The picture still has its other copy, so it stays in the Library.
    expect(queryLibrary(db, { limit: 50 }).total).toBe(folder.expected.distinctPhotos)
  })

  it('counts files over the size limit without opening them', async () => {
    const { deps, sourceId } = await setup()
    const { counts } = await scanSource({ ...deps, maxFileBytes: 400 }, sourceId)
    expect(counts.tooLarge).toBeGreaterThan(0)
    expect(counts.indexed + counts.tooLarge + counts.unsupported + counts.corrupt).toBe(counts.found)
  })

  it('marks a folder that is no longer there as disconnected, not empty', async () => {
    const { db, deps, sourceId, folder } = await setup()
    await scanSource(deps, sourceId)
    rmSync(folder.root, { recursive: true }) // the test's generated folder, standing in for an unplugged drive

    const { outcome } = await scanSource(deps, sourceId)
    expect(outcome).toBe('failed')
    expect(getSource(db, sourceId).status).toBe('disconnected')
    expect(count(db, `SELECT COUNT(*) AS n FROM asset_location WHERE availability = 'available'`)).toBe(folder.expected.indexed)
  })
})

describe('adding folders', () => {
  it('refuses a folder inside, or around, one already added, so files are never catalogued twice', async () => {
    const { db, folder, appDataDir } = await setup()
    expect(addSourceFolder(db, join(folder.root, 'nested'), appDataDir)).toEqual({ ok: false, reason: 'overlap' })
    expect(addSourceFolder(db, join(folder.root, '..'), appDataDir)).toEqual({ ok: false, reason: 'overlap' })
    expect(addSourceFolder(db, folder.root, appDataDir)).toEqual({ ok: false, reason: 'overlap' })
  })

  it('refuses the app data folder and folders around it, so thumbnails are never written inside a photo folder', async () => {
    const { db, appDataDir } = await setup()
    expect(addSourceFolder(db, appDataDir, appDataDir)).toEqual({ ok: false, reason: 'app_data' })
    expect(addSourceFolder(db, join(appDataDir, '..'), appDataDir)).toEqual({ ok: false, reason: 'app_data' })
  })

  it('refuses a folder that does not exist', async () => {
    const { db, appDataDir } = await setup()
    expect(addSourceFolder(db, join(tempDir(), 'nope'), appDataDir)).toEqual({ ok: false, reason: 'unavailable' })
  })
})

describe('the Library query', () => {
  it('lists each picture once, newest first, with a total', async () => {
    const { db, deps, sourceId, folder } = await setup()
    await scanSource(deps, sourceId)
    const { items, total } = queryLibrary(db, { limit: 50 })

    expect(total).toBe(folder.expected.distinctPhotos)
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    const dates = items.map((i) => i.capturedAt ?? 0)
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
  })
})
