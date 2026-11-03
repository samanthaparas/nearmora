/**
 * Integration tests for Clean up (ADR-0019): marks, the duplicate list, and removing files with every safety check.
 * Each test generates its own photo folder in a temporary directory and uses a stand-in Trash folder, so nothing outside
 * files the test created is ever removed. Untouched files are proven unchanged by fingerprint.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/main/catalog/database'
import { addToAlbum } from '../../src/main/catalog/repositories/album-edits'
import { createAlbum } from '../../src/main/catalog/repositories/albums'
import { listDuplicates, listRemovals, listUnneeded, setUnneeded } from '../../src/main/catalog/repositories/clean-up'
import { setFavorites } from '../../src/main/catalog/repositories/favorites'
import { createProject } from '../../src/main/catalog/repositories/projects'
import { setSourceStatus } from '../../src/main/catalog/repositories/sources'
import { createLibraryService } from '../../src/main/library/library-service'
import { removePhotos, type RemoveDeps } from '../../src/main/library/remove-photos'
import { scanSource } from '../../src/main/library/scan'
import { addSourceFolder } from '../../src/main/library/source-folders'
import { processImage } from '../../src/main/media/process-image'
import { generatePhotoFolder } from '../support/generate-photos'
import { fingerprintFolder } from '../support/originals-guard'
import { openTestCatalog, tempDir, tempProfile } from './helpers'

async function setup(options: { trash?: RemoveDeps['trash'] } = {}) {
  const profile = tempProfile()
  const db = await openTestCatalog(profile.catalogFile)
  const thumbnailsDir = join(profile.dir, 'thumbnails')
  const previewsDir = join(profile.dir, 'previews')
  mkdirSync(thumbnailsDir)
  mkdirSync(previewsDir)
  const folder = await generatePhotoFolder(join(tempDir(), 'Photos'))
  const added = addSourceFolder(db, folder.root, profile.dir)
  if (!added.ok) throw new Error(`could not add test folder: ${added.reason}`)
  await scanSource({ db, thumbnailsDir, processImage }, added.source.id)

  // The stand-in Trash: a folder of the test's own, so the computer's real Trash is never used.
  const trashDir = join(tempDir(), 'Trash')
  mkdirSync(trashDir)
  const trash =
    options.trash ??
    ((path: string) => {
      renameSync(path, join(trashDir, path.split('/').pop()!))
      return Promise.resolve()
    })
  const deps: RemoveDeps = { db, appDataDir: profile.dir, thumbnailsDir, previewsDir, trash }
  return { db, deps, root: folder.root, sourceId: added.source.id, trashDir, thumbnailsDir }
}

const assetAt = (db: Catalog, relativePath: string): string =>
  (db.prepare('SELECT asset_id FROM asset_location WHERE relative_path = ?').get(relativePath) as { asset_id: string }).asset_id
const locationAt = (db: Catalog, relativePath: string): string =>
  (db.prepare('SELECT id FROM asset_location WHERE relative_path = ?').get(relativePath) as { id: string }).id
const count = (db: Catalog, sql: string, ...params: unknown[]): number => (db.prepare(sql).get(...params) as { n: number }).n

/** Every file in the folder except `removed` is exactly as it was. */
function expectOthersUnchanged(before: ReturnType<typeof fingerprintFolder>, root: string, removed: string[]) {
  const expected = Object.fromEntries(Object.entries(before).filter(([path]) => !removed.includes(path)))
  expect(fingerprintFolder(root)).toEqual(expected)
}

describe('marking photos "Don\'t need"', () => {
  it('marks and unmarks pictures, reporting only the ones that changed, and removes nothing', async () => {
    const { db, root } = await setup()
    const before = fingerprintFolder(root)
    const dated = assetAt(db, 'dated.jpg')
    const nested = assetAt(db, 'nested/nested.jpg')

    expect(setUnneeded(db, { assetIds: [dated, nested], unneeded: true }).changed.sort()).toEqual([dated, nested].sort())
    expect(setUnneeded(db, { assetIds: [dated], unneeded: true }).changed).toEqual([])

    const { items, total } = listUnneeded(db)
    expect(total).toBe(2)
    const datedItem = items.find((i) => i.assetId === dated)!
    // Two identical files of one picture: both would go, and the first is named.
    expect(datedItem).toMatchObject({ files: 2, fileName: 'dated-copy.jpg', folderName: 'Photos', offline: false, usedIn: [] })
    expect(datedItem.bytes).toBe(2 * statSync(join(root, 'dated.jpg')).size)

    expect(setUnneeded(db, { assetIds: [dated], unneeded: false }).changed).toEqual([dated])
    expect(listUnneeded(db).total).toBe(1)
    expect(fingerprintFolder(root)).toEqual(before)
  })
})

describe('listing duplicates', () => {
  it('lists each picture found as identical files, with every copy in a stable order', async () => {
    const { db } = await setup()
    const { groups, total } = listDuplicates(db)
    expect(total).toBe(1)
    expect(groups[0]!.copies.map((c) => [c.subfolder, c.fileName])).toEqual([
      ['copies', 'dated-copy.jpg'],
      ['', 'dated.jpg'],
    ])
  })
})

describe('removing photos', () => {
  it('moves an extra copy to the Trash, keeps the picture and its other copy, and records the removal', async () => {
    const { db, deps, root, trashDir } = await setup()
    const before = fingerprintFolder(root)
    const asset = assetAt(db, 'dated.jpg')
    const copy = locationAt(db, 'copies/dated-copy.jpg')

    const result = await removePhotos(deps, { pictures: [], copies: [copy] }, 'trash')

    expect(result).toMatchObject({ removed: 1, refused: [], blocked: [] })
    expect(result.bytes).toBe(before['copies/dated-copy.jpg']!.size)
    // In the (stand-in) Trash with its bytes intact, so the person can put it back.
    expect(readdirSync(trashDir)).toEqual(['dated-copy.jpg'])
    expect(readFileSync(join(trashDir, 'dated-copy.jpg')).equals(readFileSync(join(root, 'dated.jpg')))).toBe(true)
    expectOthersUnchanged(before, root, ['copies/dated-copy.jpg'])
    expect(count(db, 'SELECT COUNT(*) AS n FROM asset_location WHERE asset_id = ?', asset)).toBe(1)
    expect(listDuplicates(db).total).toBe(0)
    expect(listRemovals(db)).toEqual([expect.objectContaining({ mode: 'trash', fileName: 'dated-copy.jpg', folderName: 'Photos', sizeBytes: result.bytes })])
  })

  it('never removes every copy through Duplicates: the picture always keeps one', async () => {
    const { db, deps, root, trashDir } = await setup()
    const before = fingerprintFolder(root)
    const copies = [locationAt(db, 'dated.jpg'), locationAt(db, 'copies/dated-copy.jpg')]

    const result = await removePhotos(deps, { pictures: [], copies }, 'forever')

    expect(result.removed).toBe(0)
    expect(result.refused.map((r) => r.reason)).toEqual(['last_copy', 'last_copy'])
    expect(fingerprintFolder(root)).toEqual(before)
    expect(readdirSync(trashDir)).toEqual([])
  })

  it('deletes a picture forever: every copy, its catalogue entry, favourite, album place and cached thumbnail', async () => {
    const { db, deps, root, trashDir, thumbnailsDir } = await setup()
    const before = fingerprintFolder(root)
    const asset = assetAt(db, 'dated.jpg')
    setFavorites(db, { assetIds: [asset], favorite: true })
    setUnneeded(db, { assetIds: [asset], unneeded: true })
    const album = createAlbum(db, 'Trip')
    addToAlbum(db, album.id, [asset])
    const thumbnails = readdirSync(thumbnailsDir).length

    const result = await removePhotos(deps, { pictures: [asset], copies: [] }, 'forever')

    expect(result).toMatchObject({ removed: 2, refused: [], blocked: [] })
    expect(existsSync(join(root, 'dated.jpg'))).toBe(false)
    expect(readdirSync(trashDir)).toEqual([]) // forever means not in the Trash either
    expectOthersUnchanged(before, root, ['dated.jpg', 'copies/dated-copy.jpg'])
    expect(count(db, 'SELECT COUNT(*) AS n FROM asset WHERE id = ?', asset)).toBe(0)
    expect(count(db, 'SELECT COUNT(*) AS n FROM favorite WHERE asset_id = ?', asset)).toBe(0)
    expect(count(db, 'SELECT COUNT(*) AS n FROM album_asset WHERE asset_id = ?', asset)).toBe(0)
    expect(count(db, 'SELECT COUNT(*) AS n FROM unneeded')).toBe(0)
    expect(readdirSync(thumbnailsDir)).toHaveLength(thumbnails - 1)
    expect(listRemovals(db).map((r) => r.mode)).toEqual(['forever', 'forever'])
  })

  it('refuses a picture used in a Studio project, naming the project, and touches none of its files', async () => {
    const { db, deps, root } = await setup()
    const before = fingerprintFolder(root)
    const asset = assetAt(db, 'dated.jpg')
    const project = createProject(db, { templateId: 'pair-equal-split', format: 'square', assetIds: [asset, assetAt(db, 'rotated.jpg')] })

    const result = await removePhotos(deps, { pictures: [asset], copies: [] }, 'trash')

    expect(result.removed).toBe(0)
    expect(result.blocked).toEqual([{ fileName: 'dated-copy.jpg', projects: [project.title] }])
    expect(fingerprintFolder(root)).toEqual(before)
    expect(listUnneeded(db).items).toEqual([]) // not marked, so not listed; the project check doesn't depend on marks
  })

  it('refuses a file changed since the scan, even with the same size and date', async () => {
    const { db, deps, root } = await setup()
    const asset = assetAt(db, 'nested/nested.jpg')
    const path = join(root, 'nested', 'nested.jpg')
    const { size, atime, mtime } = statSync(path)
    // Different bytes, same length, and the old modification time put back: only the fingerprint can tell.
    writeFileSync(path, Buffer.alloc(size, 1))
    utimesSync(path, atime, mtime)
    const before = fingerprintFolder(root)

    const result = await removePhotos(deps, { pictures: [asset], copies: [] }, 'forever')

    expect(result.removed).toBe(0)
    expect(result.refused).toEqual([{ fileName: 'nested.jpg', folderName: 'Photos', reason: 'changed' }])
    expect(fingerprintFolder(root)).toEqual(before)
    expect(count(db, 'SELECT COUNT(*) AS n FROM asset WHERE id = ?', asset)).toBe(1)
  })

  it('refuses a catalogued file that has been replaced by a link, and leaves what it points to alone', async () => {
    const { db, deps, root } = await setup()
    const asset = assetAt(db, 'nested/deeper/deep.jpg')
    const outside = join(tempDir(), 'elsewhere.jpg')
    renameSync(join(root, 'nested', 'deeper', 'deep.jpg'), outside)
    symlinkSync(outside, join(root, 'nested', 'deeper', 'deep.jpg'))
    const outsideBytes = readFileSync(outside)

    const result = await removePhotos(deps, { pictures: [asset], copies: [] }, 'forever')

    expect(result.refused.map((r) => r.reason)).toEqual(['not_a_file'])
    expect(readFileSync(outside).equals(outsideBytes)).toBe(true)
  })

  it('refuses when the added folder now resolves somewhere else', async () => {
    const { db, deps, root } = await setup()
    const asset = assetAt(db, 'rotated.jpg')
    const moved = `${root}-moved`
    renameSync(root, moved)
    symlinkSync(moved, root)
    const before = fingerprintFolder(moved)

    const result = await removePhotos(deps, { pictures: [asset], copies: [] }, 'forever')

    expect(result.refused.map((r) => r.reason)).toEqual(['outside_folder'])
    expect(fingerprintFolder(moved)).toEqual(before)
  })

  it('refuses files in a folder that is offline or no longer there, and keeps them in the catalogue', async () => {
    const { db, deps, root, sourceId } = await setup()
    const missing = assetAt(db, 'screenshot.png')
    rmSync(join(root, 'screenshot.png')) // the test's own file, gone before Clean up runs
    expect((await removePhotos(deps, { pictures: [missing], copies: [] }, 'trash')).refused.map((r) => r.reason)).toEqual(['missing'])

    setSourceStatus(db, sourceId, 'disconnected')
    const before = fingerprintFolder(root)
    const result = await removePhotos(deps, { pictures: [assetAt(db, 'rotated.jpg')], copies: [] }, 'trash')
    expect(result.refused.map((r) => r.reason)).toEqual(['offline'])
    expect(fingerprintFolder(root)).toEqual(before)
    expect(count(db, 'SELECT COUNT(*) AS n FROM asset')).toBe(5)
  })

  it('leaves the catalogue as it was when the Trash step fails', async () => {
    const { db, deps, root } = await setup({ trash: () => Promise.reject(new Error('Trash unavailable')) })
    const before = fingerprintFolder(root)
    const asset = assetAt(db, 'rotated.jpg')

    const result = await removePhotos(deps, { pictures: [asset], copies: [] }, 'trash')

    expect(result.refused.map((r) => r.reason)).toEqual(['failed'])
    expect(fingerprintFolder(root)).toEqual(before)
    expect(count(db, 'SELECT COUNT(*) AS n FROM asset_location WHERE asset_id = ?', asset)).toBe(1)
    expect(listRemovals(db)).toEqual([])
  })

  it('does not run while a scan is running, and holds new scans while it runs', async () => {
    const { db, deps, sourceId } = await setup()
    const library = createLibraryService({ db, appDataDir: deps.appDataDir, thumbnailsDir: deps.thumbnailsDir, processImage, emit: () => {} })

    expect(library.startScan(sourceId)).toBe(true)
    expect(await library.withoutScans(() => Promise.resolve('removed'))).toBe('busy')
    await expect.poll(() => library.listSources()[0]!.scanning).toBe(false)

    let scanDuringRemoval: boolean | undefined
    expect(await library.withoutScans(() => Promise.resolve((scanDuringRemoval = library.startScan(sourceId))))).toBe(false)
    expect(scanDuringRemoval).toBe(false)
  })
})
