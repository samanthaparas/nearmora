/**
 * Integration tests for the Best Moments backend (AC3, AC4, AC13): listing sets in queue order, opening one,
 * correcting it by hand (remove, add, split apart) with stale-screen protection, corrections surviving
 * regrouping, and previews made from reachable originals only.
 */

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/main/catalog/database'
import { recordAssetLocation } from '../../src/main/catalog/repositories/assets'
import { saveReview } from '../../src/main/catalog/repositories/review'
import { addToSet, nearbyPhotos, removeFromSet, ungroupSet } from '../../src/main/catalog/repositories/set-edits'
import { getSetDetail, listSets } from '../../src/main/catalog/repositories/sets'
import { createPreviewResolver } from '../../src/main/library/previews'
import { regroupSimilaritySets } from '../../src/main/library/regroup-sets'
import { scanSource } from '../../src/main/library/scan'
import { addSourceFolder } from '../../src/main/library/source-folders'
import { makePreview, processImage } from '../../src/main/media/process-image'
import { generatePhotoFolder } from '../support/generate-photos'
import { fingerprintFolder } from '../support/originals-guard'
import { codeOf, fakeSha, openTestCatalog, seedSource, tempDir, tempProfile } from './helpers'

const T0 = Date.UTC(2024, 5, 1, 12)
const hash = (flip: number) => {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(0x0f0f_0f0f_0f0f_0f0fn ^ ((1n << BigInt(flip)) - 1n))
  return buffer
}
let n = 70_000

function photo(db: Catalog, sourceId: string, capturedAt: number, flip: number): string {
  n++
  return recordAssetLocation(db, {
    sourceId,
    relativePath: `p${n}.jpg`,
    sizeBytes: 1,
    mtimeMs: 1,
    contentSha256: fakeSha(n),
    mediaType: 'image/jpeg',
    capturedAt,
    capturedAtSource: 'exif',
    dhash: hash(flip),
  }).assetId
}

// Two bursts a day apart (two sets), plus one unrelated photo taken a minute after the first burst.
async function library() {
  const db = await openTestCatalog(tempProfile().catalogFile)
  const { sourceId } = seedSource(db)
  const first = [0, 1, 2].map((i) => photo(db, sourceId, T0 + i * 1000, i))
  const second = [0, 1].map((i) => photo(db, sourceId, T0 + 86_400_000 + i * 1000, i))
  const nearby = photo(db, sourceId, T0 + 60_000, 40) // close in time, different look
  regroupSimilaritySets(db)
  const setOf = (assetId: string) => db.prepare('SELECT set_id FROM set_asset WHERE asset_id = ?').pluck().get(assetId) as string
  return { db, sourceId, first, second, nearby, firstSet: setOf(first[0]!), secondSet: setOf(second[0]!) }
}

describe('listing and opening sets', () => {
  it('lists undecided sets first, then decide-later, then reviewed', async () => {
    const { db, firstSet, secondSet, first } = await library()
    expect(listSets(db).map((s) => s.id)).toEqual([secondSet, firstSet]) // both undecided: newest first
    saveReview(db, { setId: secondSet, favorites: [], status: 'reviewed', expectedRevision: 0 })
    saveReview(db, { setId: firstSet, favorites: [first[0]!], status: 'deferred', expectedRevision: 0 })
    expect(listSets(db).map((s) => [s.id, s.reviewStatus, s.favoriteCount])).toEqual([
      [firstSet, 'deferred', 1],
      [secondSet, 'reviewed', 0],
    ])
  })

  it('opens a set with each photo’s favorite state, in order', async () => {
    const { db, firstSet, first } = await library()
    saveReview(db, { setId: firstSet, favorites: [first[1]!], status: 'reviewed', expectedRevision: 0 })
    const detail = getSetDetail(db, firstSet)
    expect(detail).toMatchObject({ reason: 'visual', reviewStatus: 'reviewed', revision: 1 })
    expect(detail.members.map((m) => [m.assetId, m.favorite, m.offline])).toEqual([
      [first[0], false, false],
      [first[1], true, false],
      [first[2], false, false],
    ])
  })
})

describe('correcting a set by hand', () => {
  it('removes a photo (favorites untouched) and refuses a screen showing an older revision', async () => {
    const { db, firstSet, first } = await library()
    saveReview(db, { setId: firstSet, favorites: [first[2]!], status: 'reviewed', expectedRevision: 0 })
    expect(codeOf(() => removeFromSet(db, { setId: firstSet, assetId: first[2]!, expectedRevision: 0 }))).toBe('STALE_REVISION')

    expect(removeFromSet(db, { setId: firstSet, assetId: first[2]!, expectedRevision: 1 })).toEqual({ revision: 2, dissolved: false })
    expect(getSetDetail(db, firstSet).members.map((m) => m.assetId)).toEqual([first[0], first[1]])
    expect(db.prepare('SELECT asset_id FROM favorite').pluck().all()).toEqual([first[2]])
  })

  it('adds a nearby photo, which then stays through regrouping, and refuses one already in another set', async () => {
    const { db, firstSet, secondSet, second, nearby } = await library()
    expect(nearbyPhotos(db, firstSet).map((p) => p.assetId)).toEqual([nearby])
    expect(codeOf(() => addToSet(db, { setId: firstSet, assetId: second[0]!, expectedRevision: 0 }))).toBe('CONFLICT')

    addToSet(db, { setId: firstSet, assetId: nearby, expectedRevision: 0 })
    regroupSimilaritySets(db)
    const members = getSetDetail(db, firstSet).members
    expect(members.at(-1)).toMatchObject({ assetId: nearby, addedByYou: true })
    expect(nearbyPhotos(db, firstSet)).toEqual([])
    expect(secondSet).toBeDefined()
  })

  it('a removed photo stays out after regrouping, and removing down to one photo dissolves the set', async () => {
    const { db, firstSet, first } = await library()
    removeFromSet(db, { setId: firstSet, assetId: first[0]!, expectedRevision: 0 })
    regroupSimilaritySets(db)
    expect(getSetDetail(db, firstSet).members.map((m) => m.assetId)).toEqual([first[1], first[2]])

    const { revision } = getSetDetail(db, firstSet)
    expect(removeFromSet(db, { setId: firstSet, assetId: first[1]!, expectedRevision: revision }).dissolved).toBe(true)
    expect(listSets(db).map((s) => s.id)).not.toContain(firstSet)
  })

  it('splitting a set apart sticks: regrouping does not put the photos back together', async () => {
    const { db, firstSet, secondSet } = await library()
    ungroupSet(db, { setId: firstSet, expectedRevision: 0 })
    expect(listSets(db).map((s) => s.id)).toEqual([secondSet])

    const summary = regroupSimilaritySets(db)
    expect(summary).toMatchObject({ sets: 1, created: 0, dissolved: 1 })
    expect(listSets(db).map((s) => s.id)).toEqual([secondSet])
  })
})

describe('previews for comparing', () => {
  it('are made once from a reachable original, cached, and not made while the folder is offline', async () => {
    const profile = tempProfile()
    const db = await openTestCatalog(profile.catalogFile)
    const thumbnailsDir = join(profile.dir, 'thumbnails')
    mkdirSync(thumbnailsDir)
    const folder = await generatePhotoFolder(join(tempDir(), 'Photos'))
    const added = addSourceFolder(db, folder.root, profile.dir)
    if (!added.ok) throw new Error(added.reason)
    await scanSource({ db, thumbnailsDir, processImage }, added.source.id)
    const before = fingerprintFolder(folder.root)

    let calls = 0
    const preview = createPreviewResolver({
      db,
      previewsDir: join(profile.dir, 'previews'),
      makePreview: (request) => {
        calls++
        return makePreview(request)
      },
    })
    const assetId = db.prepare(`SELECT asset_id FROM asset_location WHERE relative_path = 'rotated.jpg'`).pluck().get() as string
    const [one, two] = await Promise.all([preview(assetId), preview(assetId)])
    expect(one).toBeDefined()
    expect(two).toBe(one)
    expect(await preview(assetId)).toBe(one)
    expect(calls).toBe(1) // shared while in flight, then cached
    expect(fingerprintFolder(folder.root)).toEqual(before)

    const other = db.prepare(`SELECT asset_id FROM asset_location WHERE relative_path = 'screenshot.png'`).pluck().get() as string
    rmSync(folder.root, { recursive: true }) // the test's generated folder goes offline
    db.prepare(`UPDATE source SET status = 'disconnected'`).run()
    expect(await preview(other)).toBeUndefined()
    expect(await preview('3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e')).toBeUndefined()
  })
})
