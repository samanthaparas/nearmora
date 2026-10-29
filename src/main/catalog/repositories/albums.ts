/**
 * Albums: named, ordered collections of pictures (AC12).
 * Albums hold references to assets only, so creating, reordering or deleting one never touches a photo file.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Catalog } from '../database'
import { CatalogError, isConstraintError } from '../errors'

const Title = z.string().trim().min(1).max(120)

const AlbumRow = z
  .object({
    id: z.string(),
    title: z.string(),
    created_at: z.number().int(),
    asset_count: z.number().int(),
    cover_asset_id: z.string().nullable(),
  })
  .transform((row) => ({ id: row.id, title: row.title, createdAt: row.created_at, assetCount: row.asset_count, coverAssetId: row.cover_asset_id }))

// The album's first photo is its cover.
const ALBUM_COLUMNS = `a.id, a.title, a.created_at, COUNT(m.asset_id) AS asset_count,
  (SELECT asset_id FROM album_asset c WHERE c.album_id = a.id ORDER BY c.position LIMIT 1) AS cover_asset_id`
export type Album = z.output<typeof AlbumRow>

function parseTitle(title: string): string {
  const parsed = Title.safeParse(title)
  if (!parsed.success) throw new CatalogError('INVALID_INPUT', 'Album title must be 1–120 characters')
  return parsed.data
}

export function createAlbum(db: Catalog, title: string): Album {
  const id = randomUUID()
  db.prepare('INSERT INTO album (id, title, created_at) VALUES (?, ?, ?)').run(id, parseTitle(title), Date.now())
  return getAlbum(db, id)
}

export function getAlbum(db: Catalog, id: string): Album {
  const row = db
    .prepare(
      `SELECT ${ALBUM_COLUMNS}
       FROM album a LEFT JOIN album_asset m ON m.album_id = a.id
       WHERE a.id = ? GROUP BY a.id`,
    )
    .get(id)
  if (!row) throw new CatalogError('NOT_FOUND', 'Album not found')
  return AlbumRow.parse(row)
}

export function listAlbums(db: Catalog): Album[] {
  return db
    .prepare(
      `SELECT ${ALBUM_COLUMNS}
       FROM album a LEFT JOIN album_asset m ON m.album_id = a.id
       GROUP BY a.id ORDER BY a.created_at, a.id`,
    )
    .all()
    .map((row) => AlbumRow.parse(row))
}

export function renameAlbum(db: Catalog, id: string, title: string): void {
  const result = db.prepare('UPDATE album SET title = ? WHERE id = ?').run(parseTitle(title), id)
  if (result.changes === 0) throw new CatalogError('NOT_FOUND', 'Album not found')
}

/** Removes the album and its memberships. The pictures stay in the catalog and on disk. */
export function deleteAlbum(db: Catalog, id: string): void {
  const result = db.prepare('DELETE FROM album WHERE id = ?').run(id)
  if (result.changes === 0) throw new CatalogError('NOT_FOUND', 'Album not found')
}

/**
 * Replaces the album's contents with `assetIds`, in that order. Adding, removing and reordering all go through here,
 * inside one transaction, so the album is never seen half-updated.
 */
export function setAlbumMembers(db: Catalog, albumId: string, assetIds: readonly string[]): void {
  if (new Set(assetIds).size !== assetIds.length) throw new CatalogError('INVALID_INPUT', 'An album lists each picture once')

  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM album WHERE id = ?').get(albumId)) throw new CatalogError('NOT_FOUND', 'Album not found')
    db.prepare('DELETE FROM album_asset WHERE album_id = ?').run(albumId)
    const insert = db.prepare('INSERT INTO album_asset (album_id, asset_id, position) VALUES (?, ?, ?)')
    assetIds.forEach((assetId, position) => {
      try {
        insert.run(albumId, assetId, position)
      } catch (error: unknown) {
        // The foreign key rejects a picture that isn't in the catalog; the whole change rolls back.
        if (isConstraintError(error, 'FOREIGNKEY')) throw new CatalogError('NOT_FOUND', 'Picture not found', { cause: error })
        throw error
      }
    })
  })()
}

export function getAlbumAssetIds(db: Catalog, albumId: string): string[] {
  const rows = db.prepare('SELECT asset_id FROM album_asset WHERE album_id = ? ORDER BY position').all(albumId) as Array<{ asset_id: string }>
  return rows.map((row) => row.asset_id)
}
