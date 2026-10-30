/**
 * Integration tests for favoriting from the Library: favorites can be added and removed for any picture, only real
 * changes are reported (so Undo puts back exactly those), and the Library grid knows which photos are favorites.
 */

import { describe, expect, it } from 'vitest'
import { recordAssetLocation } from '../../src/main/catalog/repositories/assets'
import { setFavorites } from '../../src/main/catalog/repositories/favorites'
import { queryLibrary } from '../../src/main/catalog/repositories/library'
import { fakeSha, openTestCatalog, seedSource, tempProfile } from './helpers'

async function catalogWithPhotos(count: number) {
  const db = await openTestCatalog(tempProfile().catalogFile)
  const { sourceId } = seedSource(db)
  const ids = Array.from({ length: count }, (_, i) =>
    recordAssetLocation(db, {
      sourceId,
      relativePath: `p${i}.jpg`,
      sizeBytes: 1,
      mtimeMs: 1,
      contentSha256: fakeSha(i + 1),
      mediaType: 'image/jpeg',
      capturedAt: Date.UTC(2026, 9, 26, 10, i),
      capturedAtSource: 'exif',
    }).assetId,
  )
  return { db, ids }
}

const favoriteIds = (db: Parameters<typeof queryLibrary>[0]) =>
  queryLibrary(db, { limit: 50 })
    .items.filter((item) => item.favorite)
    .map((item) => item.id)
    .sort()

describe('favoriting from the Library', () => {
  it('adds and removes favorites, reporting only the photos whose state changed', async () => {
    const { db, ids } = await catalogWithPhotos(3)
    const [a, b, c] = ids as [string, string, string]

    expect(setFavorites(db, { assetIds: [a, b], favorite: true }).changed.sort()).toEqual([a, b].sort())
    expect(favoriteIds(db)).toEqual([a, b].sort())
    // a is already a favorite, so only c changes; a repeated id counts once.
    expect(setFavorites(db, { assetIds: [a, c, c], favorite: true }).changed).toEqual([c])

    expect(setFavorites(db, { assetIds: [b, c], favorite: false }).changed.sort()).toEqual([b, c].sort())
    expect(favoriteIds(db)).toEqual([a])
    // Undoing that removal with exactly the changed ids restores the earlier state.
    setFavorites(db, { assetIds: [b, c], favorite: true })
    expect(favoriteIds(db)).toEqual([a, b, c].sort())
  })

  it('ignores ids that aren’t pictures in the catalog', async () => {
    const { db, ids } = await catalogWithPhotos(1)
    const missing = '00000000-0000-4000-8000-000000000000'
    expect(setFavorites(db, { assetIds: [missing, ids[0]!], favorite: true }).changed).toEqual([ids[0]])
    expect(db.prepare('SELECT COUNT(*) AS n FROM favorite').get()).toEqual({ n: 1 })
  })
})
