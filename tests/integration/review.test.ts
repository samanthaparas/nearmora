/**
 * Integration tests for saving and undoing Best Moments choices (AC4, AC13).
 * They check that choices survive a restart, that stale screens can't overwrite newer saves,
 * and that a failure halfway through a save leaves nothing half-written.
 */

import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/main/catalog/database'
import { saveReview, undoReview } from '../../src/main/catalog/repositories/review'
import { createSimilaritySet, getSetReview, listSetsToReview } from '../../src/main/catalog/repositories/sets'
import { codeOf, openTestCatalog, seedAssets, seedSource, tempProfile } from './helpers'

async function setWithPictures(file: string, pictures = 3): Promise<{ db: Catalog; setId: string; assets: string[] }> {
  const db = await openTestCatalog(file)
  const { sourceId } = seedSource(db)
  const assets = seedAssets(db, sourceId, pictures)
  const setId = createSimilaritySet(db, { reason: 'visual', algorithmVersion: 'test@1', assetIds: assets })
  return { db, setId, assets }
}

const favoritesOf = (db: Catalog, setId: string): string[] =>
  getSetReview(db, setId)
    .members.filter((m) => m.favorite)
    .map((m) => m.assetId)

describe('saving review choices', () => {
  it.each([
    ['zero', 0],
    ['one', 1],
    ['several', 2],
  ])('keeps %s favorites and the review status across a restart', async (_label, n) => {
    const { catalogFile } = tempProfile()
    const { db, setId, assets } = await setWithPictures(catalogFile)
    const chosen = assets.slice(0, n)
    expect(saveReview(db, { setId, favorites: chosen, status: 'reviewed', expectedRevision: 0 }).revision).toBe(1)
    db.close()

    const reopened = await openTestCatalog(catalogFile)
    expect(favoritesOf(reopened, setId)).toEqual(chosen)
    expect(getSetReview(reopened, setId)).toMatchObject({ reviewStatus: 'reviewed', revision: 1 })
  })

  it('brings deferred sets back to the review queue, and drops reviewed ones', async () => {
    const { db, setId } = await setWithPictures(tempProfile().catalogFile)
    saveReview(db, { setId, favorites: [], status: 'deferred', expectedRevision: 0 })
    expect(listSetsToReview(db)).toEqual([{ id: setId, reviewStatus: 'deferred' }])

    saveReview(db, { setId, favorites: [], status: 'reviewed', expectedRevision: 1 })
    expect(listSetsToReview(db)).toEqual([])
  })

  it('refuses a save from a screen showing an older revision', async () => {
    const { db, setId, assets } = await setWithPictures(tempProfile().catalogFile)
    saveReview(db, { setId, favorites: [assets[0]!], status: 'reviewed', expectedRevision: 0 })

    expect(codeOf(() => saveReview(db, { setId, favorites: [assets[1]!], status: 'reviewed', expectedRevision: 0 }))).toBe('STALE_REVISION')
    expect(favoritesOf(db, setId)).toEqual([assets[0]])
  })

  it('refuses a favorite that is not in the set', async () => {
    const { db, setId } = await setWithPictures(tempProfile().catalogFile)
    expect(codeOf(() => saveReview(db, { setId, favorites: ['elsewhere'], status: 'reviewed', expectedRevision: 0 }))).toBe('INVALID_INPUT')
  })

  it('writes nothing if the save fails partway through', async () => {
    const { db, setId, assets } = await setWithPictures(tempProfile().catalogFile)
    // A real SQLite trigger makes the last step of the save (writing the undo entry) fail.
    db.exec(`CREATE TEMP TRIGGER fail_undo BEFORE INSERT ON undo_entry BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`)

    expect(() => saveReview(db, { setId, favorites: [assets[0]!], status: 'reviewed', expectedRevision: 0 })).toThrow(/simulated failure/)
    expect(favoritesOf(db, setId)).toEqual([])
    expect(getSetReview(db, setId)).toMatchObject({ reviewStatus: 'unreviewed', revision: 0 })
  })
})

describe('undoing a save', () => {
  it('restores the previous favorites and status, and survives a restart', async () => {
    const { catalogFile } = tempProfile()
    const { db, setId, assets } = await setWithPictures(catalogFile)
    saveReview(db, { setId, favorites: [assets[0]!], status: 'reviewed', expectedRevision: 0 })
    const { undoId } = saveReview(db, { setId, favorites: [assets[1]!, assets[2]!], status: 'deferred', expectedRevision: 1 })

    expect(undoReview(db, undoId).revision).toBe(3)
    db.close()

    const reopened = await openTestCatalog(catalogFile)
    expect(favoritesOf(reopened, setId)).toEqual([assets[0]])
    expect(getSetReview(reopened, setId)).toMatchObject({ reviewStatus: 'reviewed', revision: 3 })
  })

  it('is refused once a newer save exists, and can only be used once', async () => {
    const { db, setId, assets } = await setWithPictures(tempProfile().catalogFile)
    const first = saveReview(db, { setId, favorites: [assets[0]!], status: 'reviewed', expectedRevision: 0 })
    const second = saveReview(db, { setId, favorites: [assets[1]!], status: 'reviewed', expectedRevision: 1 })

    expect(codeOf(() => undoReview(db, first.undoId))).toBe('STALE_REVISION')
    expect(favoritesOf(db, setId)).toEqual([assets[1]])

    undoReview(db, second.undoId)
    expect(codeOf(() => undoReview(db, second.undoId))).toBe('NOT_FOUND')
  })

  it('rolls back completely if it fails partway through', async () => {
    const { db, setId, assets } = await setWithPictures(tempProfile().catalogFile)
    const { undoId } = saveReview(db, { setId, favorites: [assets[0]!], status: 'reviewed', expectedRevision: 0 })
    db.exec(`CREATE TEMP TRIGGER fail_delete BEFORE DELETE ON undo_entry BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`)

    expect(() => undoReview(db, undoId)).toThrow(/simulated failure/)
    expect(favoritesOf(db, setId)).toEqual([assets[0]])
    expect(getSetReview(db, setId)).toMatchObject({ reviewStatus: 'reviewed', revision: 1 })
  })
})
