/**
 * Integration tests for album editing with undo (AC12, decision D9): add, remove, move, rename and delete,
 * each undoable exactly, only the newest change undoable, and everything kept across a restart.
 */

import { describe, expect, it } from 'vitest'
import {
  addToAlbum,
  deleteAlbumWithUndo,
  moveInAlbum,
  removeFromAlbum,
  renameAlbumWithUndo,
  undoAlbumEdit,
} from '../../src/main/catalog/repositories/album-edits'
import { createAlbum, getAlbumAssetIds, listAlbums } from '../../src/main/catalog/repositories/albums'
import { queryAlbumPhotos } from '../../src/main/catalog/repositories/library'
import { codeOf, openTestCatalog, seedAssets, seedSource, tempProfile } from './helpers'

async function albumWithPhotos(file = tempProfile().catalogFile) {
  const db = await openTestCatalog(file)
  const [a, b, c, d] = seedAssets(db, seedSource(db).sourceId, 4) as [string, string, string, string]
  const album = createAlbum(db, 'Trip')
  addToAlbum(db, album.id, [a, b, c])
  return { db, album, a, b, c, d }
}

describe('editing an album', () => {
  it('adds to the end and skips pictures already in it', async () => {
    const { db, album, a, b, c, d } = await albumWithPhotos()
    expect(addToAlbum(db, album.id, [b, d, d]).added).toBe(1)
    expect(getAlbumAssetIds(db, album.id)).toEqual([a, b, c, d])
  })

  it('moves a picture to any position, and refuses positions that do not exist', async () => {
    const { db, album, a, b, c } = await albumWithPhotos()
    moveInAlbum(db, album.id, c, 0)
    expect(getAlbumAssetIds(db, album.id)).toEqual([c, a, b])
    moveInAlbum(db, album.id, c, 2)
    expect(getAlbumAssetIds(db, album.id)).toEqual([a, b, c])
    expect(codeOf(() => moveInAlbum(db, album.id, a, 3))).toBe('INVALID_INPUT')
    expect(codeOf(() => moveInAlbum(db, album.id, a, -1))).toBe('INVALID_INPUT')
    expect(getAlbumAssetIds(db, album.id)).toEqual([a, b, c])
  })

  it('lists photos in album order, paged by position, with the first photo as the cover', async () => {
    const { db, album, a, b, c } = await albumWithPhotos()
    moveInAlbum(db, album.id, b, 0)
    const first = queryAlbumPhotos(db, { albumId: album.id, limit: 2 })
    const second = queryAlbumPhotos(db, { albumId: album.id, afterPosition: first.nextAfter, limit: 2 })
    expect([...first.items, ...second.items].map((p) => p.id)).toEqual([b, a, c])
    expect(first.total).toBe(3)
    expect(second.nextAfter).toBeNull()
    expect(listAlbums(db)[0]?.coverAssetId).toBe(b)
  })
})

describe('undoing album changes', () => {
  it.each([
    ['a move', (env: Awaited<ReturnType<typeof albumWithPhotos>>) => moveInAlbum(env.db, env.album.id, env.c, 0).undoId],
    ['a removal', (env: Awaited<ReturnType<typeof albumWithPhotos>>) => removeFromAlbum(env.db, env.album.id, env.b).undoId],
    ['an addition', (env: Awaited<ReturnType<typeof albumWithPhotos>>) => addToAlbum(env.db, env.album.id, [env.d]).undoId],
    ['a rename', (env: Awaited<ReturnType<typeof albumWithPhotos>>) => renameAlbumWithUndo(env.db, env.album.id, 'Holiday').undoId],
  ])('puts back exactly what was there before %s', async (_label, change) => {
    const env = await albumWithPhotos()
    const before = { album: listAlbums(env.db), members: getAlbumAssetIds(env.db, env.album.id) }
    const undoId = change(env)
    expect({ album: listAlbums(env.db), members: getAlbumAssetIds(env.db, env.album.id) }).not.toEqual(before)

    undoAlbumEdit(env.db, undoId)
    expect({ album: listAlbums(env.db), members: getAlbumAssetIds(env.db, env.album.id) }).toEqual(before)
  })

  it('brings a deleted album back with the same id, title, date and order; the pictures were never touched', async () => {
    const { db, album, a, b, c } = await albumWithPhotos()
    const before = listAlbums(db)
    const { undoId } = deleteAlbumWithUndo(db, album.id)
    expect(listAlbums(db)).toEqual([])
    expect((db.prepare('SELECT COUNT(*) AS n FROM asset').get() as { n: number }).n).toBe(4)

    undoAlbumEdit(db, undoId)
    expect(listAlbums(db)).toEqual(before)
    expect(getAlbumAssetIds(db, album.id)).toEqual([a, b, c])
  })

  it('only undoes the newest change, and each undo can be used once', async () => {
    const { db, album, a, b, c } = await albumWithPhotos()
    const older = moveInAlbum(db, album.id, c, 0).undoId
    const newer = removeFromAlbum(db, album.id, a).undoId

    expect(codeOf(() => undoAlbumEdit(db, older))).toBe('STALE_REVISION')
    undoAlbumEdit(db, newer)
    expect(getAlbumAssetIds(db, album.id)).toEqual([c, a, b])
    expect(codeOf(() => undoAlbumEdit(db, newer))).toBe('NOT_FOUND')
    // With the newer one undone, the older change is now the newest and can be undone too.
    undoAlbumEdit(db, older)
    expect(getAlbumAssetIds(db, album.id)).toEqual([a, b, c])
  })

  it('a change that fails leaves no undo entry and no partial change', async () => {
    const { db, album, a, b, c } = await albumWithPhotos()
    expect(codeOf(() => removeFromAlbum(db, album.id, 'not-in-album'))).toBe('NOT_FOUND')
    expect((db.prepare(`SELECT COUNT(*) AS n FROM undo_entry WHERE scope = 'album_edit'`).get() as { n: number }).n).toBe(1) // from the setup's add
    expect(getAlbumAssetIds(db, album.id)).toEqual([a, b, c])
  })

  it('keeps edits and undo across a restart', async () => {
    const { catalogFile } = tempProfile()
    const { db, album, a, b, c } = await albumWithPhotos(catalogFile)
    const { undoId } = moveInAlbum(db, album.id, a, 2)
    db.close()

    const reopened = await openTestCatalog(catalogFile)
    expect(getAlbumAssetIds(reopened, album.id)).toEqual([b, c, a])
    undoAlbumEdit(reopened, undoId)
    expect(getAlbumAssetIds(reopened, album.id)).toEqual([a, b, c])
  })
})
