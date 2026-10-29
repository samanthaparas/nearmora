/**
 * Album changes with undo (AC12, roadmap decision D9): add, remove, move, rename and delete each save a snapshot
 * of the album first, in the same transaction, so the most recent change can be put back exactly.
 * Only catalog rows change; no photo file is ever touched.
 */

import { z } from 'zod'
import type { Catalog } from '../database'
import { CatalogError } from '../errors'
import { deleteAlbum, getAlbumAssetIds, renameAlbum, setAlbumMembers } from './albums'

/** How many undo steps each album keeps. Older ones are dropped. */
const UNDO_DEPTH = 20

const AlbumSnapshot = z.object({
  albumId: z.string(),
  title: z.string(),
  createdAt: z.number().int(),
  assetIds: z.array(z.string()),
})
type AlbumSnapshot = z.infer<typeof AlbumSnapshot>

function snapshot(db: Catalog, albumId: string): AlbumSnapshot {
  const row = db.prepare('SELECT title, created_at FROM album WHERE id = ?').get(albumId) as { title: string; created_at: number } | undefined
  if (!row) throw new CatalogError('NOT_FOUND', 'Album not found')
  return { albumId, title: row.title, createdAt: row.created_at, assetIds: getAlbumAssetIds(db, albumId) }
}

// Snapshot, change and undo entry in one transaction: if the change fails, no undo entry is left behind either.
function withUndo(db: Catalog, albumId: string, change: () => void): number {
  return db.transaction(() => {
    const before = snapshot(db, albumId)
    change()
    const undoId = Number(
      db
        .prepare(`INSERT INTO undo_entry (scope, target_id, before_json, created_at) VALUES ('album_edit', ?, ?, ?)`)
        .run(albumId, JSON.stringify(before), Date.now()).lastInsertRowid,
    )
    db.prepare(
      `DELETE FROM undo_entry WHERE scope = 'album_edit' AND target_id = ? AND id NOT IN (
         SELECT id FROM undo_entry WHERE scope = 'album_edit' AND target_id = ? ORDER BY id DESC LIMIT ?)`,
    ).run(albumId, albumId, UNDO_DEPTH)
    return undoId
  })()
}

/** Appends pictures to the end of the album, skipping ones already in it. */
export function addToAlbum(db: Catalog, albumId: string, assetIds: readonly string[]): { added: number; undoId: number } {
  let added = 0
  const undoId = withUndo(db, albumId, () => {
    const current = getAlbumAssetIds(db, albumId)
    const fresh = [...new Set(assetIds)].filter((id) => !current.includes(id))
    added = fresh.length
    setAlbumMembers(db, albumId, [...current, ...fresh])
  })
  return { added, undoId }
}

export function removeFromAlbum(db: Catalog, albumId: string, assetId: string): { undoId: number } {
  return {
    undoId: withUndo(db, albumId, () => {
      const current = getAlbumAssetIds(db, albumId)
      if (!current.includes(assetId)) throw new CatalogError('NOT_FOUND', 'That photo isn’t in this album')
      setAlbumMembers(db, albumId, current.filter((id) => id !== assetId))
    }),
  }
}

/** Moves one picture to position `toIndex` (0 = first). Out-of-range positions are refused, not clamped. */
export function moveInAlbum(db: Catalog, albumId: string, assetId: string, toIndex: number): { undoId: number } {
  return {
    undoId: withUndo(db, albumId, () => {
      const current = getAlbumAssetIds(db, albumId)
      const from = current.indexOf(assetId)
      if (from === -1) throw new CatalogError('NOT_FOUND', 'That photo isn’t in this album')
      if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= current.length) throw new CatalogError('INVALID_INPUT', 'No such position')
      current.splice(from, 1)
      current.splice(toIndex, 0, assetId)
      setAlbumMembers(db, albumId, current)
    }),
  }
}

export function renameAlbumWithUndo(db: Catalog, albumId: string, title: string): { undoId: number } {
  return { undoId: withUndo(db, albumId, () => renameAlbum(db, albumId, title)) }
}

/** Deletes the album (its memberships go too); the pictures stay. Undo brings the album back with the same id. */
export function deleteAlbumWithUndo(db: Catalog, albumId: string): { undoId: number } {
  return { undoId: withUndo(db, albumId, () => deleteAlbum(db, albumId)) }
}

/**
 * Puts an album back as it was before change `undoId`, including recreating it after a delete.
 * Only the album's most recent change can be undone, so an undo never silently discards a newer edit.
 */
export function undoAlbumEdit(db: Catalog, undoId: number): { albumId: string } {
  return db.transaction(() => {
    const entry = db.prepare(`SELECT target_id, before_json FROM undo_entry WHERE id = ? AND scope = 'album_edit'`).get(undoId) as
      | { target_id: string; before_json: string }
      | undefined
    if (!entry) throw new CatalogError('NOT_FOUND', 'Nothing to undo')
    const latest = db.prepare(`SELECT MAX(id) AS id FROM undo_entry WHERE scope = 'album_edit' AND target_id = ?`).get(entry.target_id) as { id: number }
    if (latest.id !== undoId) throw new CatalogError('STALE_REVISION', 'The album changed after this edit')

    const before = AlbumSnapshot.parse(JSON.parse(entry.before_json))
    db.prepare(
      `INSERT INTO album (id, title, created_at) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET title = excluded.title`,
    ).run(before.albumId, before.title, before.createdAt)
    // Pictures removed from the catalog since (rare) are skipped rather than failing the whole undo.
    const stillThere = before.assetIds.filter((id) => db.prepare('SELECT 1 FROM asset WHERE id = ?').get(id))
    setAlbumMembers(db, before.albumId, stillThere)
    db.prepare('DELETE FROM undo_entry WHERE id = ?').run(undoId)
    return { albumId: before.albumId }
  })()
}
