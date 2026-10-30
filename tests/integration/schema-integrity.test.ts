/**
 * Integration tests for the rules the schema itself enforces: foreign keys, CHECK constraints and ON DELETE behaviour.
 * These are the guarantees that hold even if application code has a bug.
 */

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/main/catalog/database'
import { listAssetLocations, recordAssetLocation } from '../../src/main/catalog/repositories/assets'
import { createAlbum, deleteAlbum, getAlbumAssetIds, setAlbumMembers } from '../../src/main/catalog/repositories/albums'
import { getSetReview, createSimilaritySet } from '../../src/main/catalog/repositories/sets'
import { saveReview } from '../../src/main/catalog/repositories/review'
import { removeSource } from '../../src/main/catalog/repositories/sources'
import { fakeSha, openTestCatalog, seedAssets, seedSource, tempProfile } from './helpers'

async function freshCatalog(): Promise<Catalog> {
  return openTestCatalog(tempProfile().catalogFile)
}

const count = (db: Catalog, table: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n

describe('foreign keys', () => {
  it('reject a row that points at a missing picture', async () => {
    const db = await freshCatalog()
    const album = createAlbum(db, 'Trip')
    expect(() => db.prepare('INSERT INTO album_asset (album_id, asset_id, position) VALUES (?, ?, 0)').run(album.id, 'missing')).toThrow(
      /FOREIGN KEY/,
    )
  })

  it('stop a picture used in a project from being deleted (ON DELETE RESTRICT)', async () => {
    const db = await freshCatalog()
    const { sourceId } = seedSource(db)
    const [assetId] = seedAssets(db, sourceId, 1)
    const projectId = randomUUID()
    db.prepare(`INSERT INTO project VALUES (?, 'Collage', 'pair-equal-split', 1, 'square', '{"v":1}', 0)`).run(projectId)
    db.prepare(`INSERT INTO project_item VALUES (?, 0, ?, 0.5, 0.5, 1, 'fill')`).run(projectId, assetId)

    expect(() => db.prepare('DELETE FROM asset WHERE id = ?').run(assetId)).toThrow(/FOREIGN KEY/)
    expect(count(db, 'asset')).toBe(1)
  })
})

describe('CHECK constraints and STRICT tables', () => {
  it('reject values outside the allowed set', async () => {
    const db = await freshCatalog()
    expect(() => db.prepare(`INSERT INTO source VALUES ('s', '/x', NULL, 'X', 'bogus', 0, NULL)`).run()).toThrow(/CHECK/)
  })

  it('reject a capture date without a known origin, and the reverse', async () => {
    const db = await freshCatalog()
    const insert = db.prepare(`INSERT INTO asset (id, content_sha256, media_type, captured_at, captured_at_source, decode_state)
                               VALUES (?, ?, 'image/jpeg', ?, ?, 'ok')`)
    expect(() => insert.run('a', fakeSha(1), 123, 'unknown')).toThrow(/CHECK/)
    expect(() => insert.run('b', fakeSha(2), null, 'exif')).toThrow(/CHECK/)
  })

  it('reject a value of the wrong type instead of storing it', async () => {
    const db = await freshCatalog()
    expect(() => db.prepare(`INSERT INTO album VALUES ('a', 'Trip', 'yesterday')`).run()).toThrow(/cannot store TEXT value in INTEGER column/)
  })
})

describe('ON DELETE behaviour (AC12)', () => {
  it('deleting an album removes memberships but keeps every picture', async () => {
    const db = await freshCatalog()
    const { sourceId } = seedSource(db)
    const assets = seedAssets(db, sourceId, 3)
    const album = createAlbum(db, 'Trip')
    setAlbumMembers(db, album.id, assets)

    deleteAlbum(db, album.id)

    expect(count(db, 'album_asset')).toBe(0)
    expect(count(db, 'asset')).toBe(3)
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('removing a source drops its locations but keeps pictures, favorites and albums', async () => {
    const db = await freshCatalog()
    const { sourceId } = seedSource(db)
    const assets = seedAssets(db, sourceId, 3)
    const album = createAlbum(db, 'Trip')
    setAlbumMembers(db, album.id, assets)
    const setId = createSimilaritySet(db, { reason: 'visual', algorithmVersion: 'test@1', assetIds: assets })
    saveReview(db, { setId, favorites: [assets[0]!], status: 'reviewed', expectedRevision: 0 })

    expect(removeSource(db, sourceId)).toEqual({ locationsRemoved: 3 })

    expect(count(db, 'asset_location')).toBe(0)
    expect(count(db, 'asset')).toBe(3)
    expect(getAlbumAssetIds(db, album.id)).toEqual(assets)
    expect(getSetReview(db, setId).members.filter((m) => m.favorite).map((m) => m.assetId)).toEqual([assets[0]])
    expect(db.pragma('foreign_key_check')).toEqual([])
  })
})

describe('identical pictures in two folders (decision D3)', () => {
  it('become one asset with two locations, so a favorite applies to both', async () => {
    const db = await freshCatalog()
    const home = seedSource(db, 'Home')
    const drive = seedSource(db, 'Drive')
    const location = { sizeBytes: 10, mtimeMs: 1, contentSha256: fakeSha(7), mediaType: 'image/jpeg', capturedAt: null, capturedAtSource: 'unknown' } as const

    const first = recordAssetLocation(db, { ...location, sourceId: home.sourceId, relativePath: 'a.jpg' })
    const second = recordAssetLocation(db, { ...location, sourceId: drive.sourceId, relativePath: 'copy/a.jpg' })

    expect(second.assetId).toBe(first.assetId)
    expect([first.assetCreated, second.assetCreated]).toEqual([true, false])
    expect(listAssetLocations(db, first.assetId)).toHaveLength(2)
  })

  it('recording the same path again updates it rather than duplicating it', async () => {
    const db = await freshCatalog()
    const { sourceId } = seedSource(db)
    seedAssets(db, sourceId, 1)
    seedAssets(db, sourceId, 1)
    expect(count(db, 'asset_location')).toBe(1)
  })
})
