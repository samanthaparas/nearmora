/**
 * Integration tests for albums (AC12): create, rename, reorder and remove, then restart and check nothing drifted.
 * A failed change must leave the album exactly as it was.
 */

import { describe, expect, it } from 'vitest'
import { createAlbum, getAlbumAssetIds, listAlbums, renameAlbum, setAlbumMembers } from '../../src/main/catalog/repositories/albums'
import { codeOf, openTestCatalog, seedAssets, seedSource, tempProfile } from './helpers'

describe('albums', () => {
  it('keep their title, order and membership across a restart', async () => {
    const { catalogFile } = tempProfile()
    const db = await openTestCatalog(catalogFile)
    const { sourceId } = seedSource(db)
    const [a, b, c, d] = seedAssets(db, sourceId, 4) as [string, string, string, string]

    const album = createAlbum(db, 'Beach day')
    setAlbumMembers(db, album.id, [a, b, c])
    renameAlbum(db, album.id, 'Beach weekend')
    setAlbumMembers(db, album.id, [c, a, d]) // reorder, remove b, add d
    db.close()

    const reopened = await openTestCatalog(catalogFile)
    expect(listAlbums(reopened)).toMatchObject([{ id: album.id, title: 'Beach weekend', assetCount: 3 }])
    expect(getAlbumAssetIds(reopened, album.id)).toEqual([c, a, d])
  })

  it('reject an empty or overly long title', async () => {
    const db = await openTestCatalog(tempProfile().catalogFile)
    expect(codeOf(() => createAlbum(db, '   '))).toBe('INVALID_INPUT')
    expect(codeOf(() => createAlbum(db, 'x'.repeat(121)))).toBe('INVALID_INPUT')
  })

  it('roll back the whole change when one picture is unknown', async () => {
    const db = await openTestCatalog(tempProfile().catalogFile)
    const { sourceId } = seedSource(db)
    const [a, b] = seedAssets(db, sourceId, 2) as [string, string]
    const album = createAlbum(db, 'Trip')
    setAlbumMembers(db, album.id, [a, b])

    expect(codeOf(() => setAlbumMembers(db, album.id, [b, 'missing-asset']))).toBe('NOT_FOUND')
    expect(getAlbumAssetIds(db, album.id)).toEqual([a, b])
  })

  it('reject the same picture listed twice', async () => {
    const db = await openTestCatalog(tempProfile().catalogFile)
    const { sourceId } = seedSource(db)
    const [a] = seedAssets(db, sourceId, 1) as [string]
    const album = createAlbum(db, 'Trip')
    expect(codeOf(() => setAlbumMembers(db, album.id, [a, a]))).toBe('INVALID_INPUT')
  })
})
