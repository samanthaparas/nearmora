/**
 * Tests for finding similar photos and regrouping them (AC3, AC4, AC13): the distance and time rules, the
 * scoring helper, and that regrouping keeps review status, corrections and favorites while staying out of
 * the person's own (manual) sets.
 */

import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/main/catalog/database'
import { recordAssetLocation } from '../../src/main/catalog/repositories/assets'
import { saveReview } from '../../src/main/catalog/repositories/review'
import { createSimilaritySet, getSetReview } from '../../src/main/catalog/repositories/sets'
import { regroupSimilaritySets } from '../../src/main/library/regroup-sets'
import { findSimilarGroups, hammingDistance, SIMILARITY_CURRENT, SIMILARITY_V1, SIMILARITY_V2 } from '../../src/main/library/similarity'
import { scoreGrouping } from '../support/grouping-metrics'
import { fakeSha, openTestCatalog, seedSource, tempProfile } from './helpers'

const T0 = Date.UTC(2024, 5, 1, 12)
// An 8-byte hash from a 64-bit pattern; flipping k low bits gives a hash at distance k.
const hash = (base: bigint, flip = 0) => {
  const value = base ^ ((1n << BigInt(flip)) - 1n)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(value)
  return buffer
}
const A = 0x0f0f_0f0f_0f0f_0f0fn
const B = 0xf0f0_f0f0_f0f0_f0f0n // 64 bits away from A

describe('similarity rules', () => {
  it('counts differing bits', () => {
    expect(hammingDistance(hash(A), hash(A))).toBe(0)
    expect(hammingDistance(hash(A), hash(A, 10))).toBe(10)
    expect(hammingDistance(hash(A), hash(B))).toBe(64)
  })

  it('links photos only when both close in look (≤ 10 bits) and in time (≤ 120 s)', () => {
    const groups = findSimilarGroups(
      [
        { assetId: 'a1', capturedAt: T0, dhash: hash(A) },
        { assetId: 'a2', capturedAt: T0 + 60_000, dhash: hash(A, 10) }, // same look, within window
        { assetId: 'a3', capturedAt: T0 + 60_000, dhash: hash(A, 11) }, // one bit too different from a1
        { assetId: 'a4', capturedAt: T0 + 400_000, dhash: hash(A) }, // same look, too late
        { assetId: 'b1', capturedAt: T0 + 1000, dhash: hash(B) }, // different look
      ],
      SIMILARITY_V1,
    )
    // a3 is 11 bits from a1 but only 1 from a2, so it joins through a2: groups are connected components.
    expect(groups.map((g) => [...g].sort())).toEqual([['a1', 'a2', 'a3']])
  })

  it('v2: photos dated only by file date are linked only within the same folder; EXIF-dated ones across folders', () => {
    const at = (assetId: string, dateSource: 'exif' | 'file_mtime', folder: string) => ({
      assetId,
      capturedAt: T0,
      dhash: hash(A),
      dateSource,
      folders: new Set([folder]),
    })
    const groups = findSimilarGroups(
      [
        at('file-trip-1', 'file_mtime', 's/Trip'),
        at('file-trip-2', 'file_mtime', 's/Trip'),
        at('file-other', 'file_mtime', 's/Other'), // same look and time, different folder: not linked
        at('exif-x', 'exif', 's/X'),
        at('exif-y', 'exif', 's/Y'), // EXIF dates are trusted across folders
      ],
      SIMILARITY_V2,
    ).map((g) => [...g].sort())
    expect(groups.sort()).toEqual([
      ['exif-x', 'exif-y'],
      ['file-trip-1', 'file-trip-2'],
    ])
    // A file-dated photo and an EXIF-dated one also need a shared folder.
    expect(findSimilarGroups([at('exif-x', 'exif', 's/X'), at('file-other', 'file_mtime', 's/Other')], SIMILARITY_V2)).toEqual([])
  })

  it('the rule in use is v2', () => {
    expect(SIMILARITY_CURRENT).toBe(SIMILARITY_V2)
    expect(SIMILARITY_V2.version).not.toBe(SIMILARITY_V1.version)
  })

  it('scores a grouping: precision, recall, and whole, partial or missed groups', () => {
    const score = scoreGrouping(
      [
        ['a', 'b'],
        ['c', 'x'],
      ],
      [
        ['a', 'b', 'c'],
        ['d', 'e'],
      ],
    )
    expect(score).toMatchObject({ truePairs: 4, predictedPairs: 2, correctPairs: 1, precision: 0.5, recall: 0.25, complete: 0, partial: 1, missed: 1, impure: 1 })
  })
})

describe('regrouping sets', () => {
  let n = 5000
  function photo(db: Catalog, sourceId: string, capturedAt: number, dhash: Buffer): string {
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
      dhash,
    }).assetId
  }
  async function burst() {
    const db = await openTestCatalog(tempProfile().catalogFile)
    const { sourceId } = seedSource(db)
    const ids = [0, 1, 2].map((i) => photo(db, sourceId, T0 + i * 1000, hash(A, i)))
    regroupSimilaritySets(db)
    const setId = db.prepare(`SELECT id FROM similarity_set`).pluck().get() as string
    return { db, sourceId, ids, setId }
  }

  it('creates a set per group, recorded with the algorithm version', async () => {
    const { db, ids, setId } = await burst()
    expect(getSetReview(db, setId).members.map((m) => m.assetId).sort()).toEqual([...ids].sort())
    expect(db.prepare('SELECT reason, algorithm_version FROM similarity_set').get()).toEqual({ reason: 'visual', algorithm_version: SIMILARITY_CURRENT.version })
  })

  it('a rerun with nothing changed keeps the same set, status and revision', async () => {
    const { db, ids, setId } = await burst()
    saveReview(db, { setId, favorites: [ids[1]!], status: 'reviewed', expectedRevision: 0 })
    expect(regroupSimilaritySets(db)).toMatchObject({ sets: 1, kept: 1, created: 0, removed: 0, reopened: 0 })
    expect(getSetReview(db, setId)).toMatchObject({ reviewStatus: 'reviewed', revision: 1 })
  })

  it('a reviewed set that gains a photo goes back to the queue, with favorites kept and a new revision', async () => {
    const { db, sourceId, ids, setId } = await burst()
    saveReview(db, { setId, favorites: [ids[0]!], status: 'reviewed', expectedRevision: 0 })
    const newcomer = photo(db, sourceId, T0 + 3000, hash(A, 3))

    expect(regroupSimilaritySets(db)).toMatchObject({ kept: 1, reopened: 1 })
    const review = getSetReview(db, setId)
    expect(review.reviewStatus).toBe('unreviewed')
    expect(review.revision).toBe(2)
    expect(review.members.map((m) => m.assetId)).toContain(newcomer)
    expect(review.members.filter((m) => m.favorite).map((m) => m.assetId)).toEqual([ids[0]])
  })

  it('a photo the person removed stays out, and one they added stays in', async () => {
    const { db, sourceId, ids, setId } = await burst()
    const unrelated = photo(db, sourceId, T0 + 50 * 86_400_000, hash(B))
    db.prepare(`UPDATE set_asset SET user_override = 'removed' WHERE set_id = ? AND asset_id = ?`).run(setId, ids[2])
    db.prepare(`INSERT INTO set_asset (set_id, asset_id, position, user_override) VALUES (?, ?, 9, 'added')`).run(setId, unrelated)

    regroupSimilaritySets(db)
    expect(getSetReview(db, setId).members.map((m) => m.assetId).sort()).toEqual([ids[0], ids[1], unrelated].sort())
    expect(db.prepare(`SELECT user_override FROM set_asset WHERE set_id = ? AND asset_id = ?`).pluck().get(setId, ids[2])).toBe('removed')
  })

  it('a set whose photos stop being found goes away; favorites stay, and manual sets are never touched', async () => {
    const { db, sourceId, ids, setId } = await burst()
    saveReview(db, { setId, favorites: [ids[0]!], status: 'reviewed', expectedRevision: 0 })
    const manual = createSimilaritySet(db, { reason: 'manual', algorithmVersion: 'manual', assetIds: [ids[0]!, ids[1]!] })
    db.prepare(`UPDATE asset_location SET availability = 'missing' WHERE source_id = ?`).run(sourceId)

    expect(regroupSimilaritySets(db)).toMatchObject({ sets: 0, removed: 1 })
    expect(db.prepare('SELECT id FROM similarity_set').pluck().all()).toEqual([manual])
    expect(db.prepare('SELECT asset_id FROM favorite').pluck().all()).toEqual([ids[0]])
  })

  it('identical copies never form a set: they are one picture with several locations', async () => {
    const db = await openTestCatalog(tempProfile().catalogFile)
    const { sourceId } = seedSource(db)
    const location = { sizeBytes: 1, mtimeMs: 1, contentSha256: fakeSha(99_999), mediaType: 'image/jpeg', capturedAt: T0, capturedAtSource: 'exif', dhash: hash(A) } as const
    recordAssetLocation(db, { ...location, sourceId, relativePath: 'a.jpg' })
    recordAssetLocation(db, { ...location, sourceId, relativePath: 'copy/a.jpg' })
    expect(regroupSimilaritySets(db).sets).toBe(0)
  })
})
