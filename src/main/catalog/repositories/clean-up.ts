/**
 * Catalog records for Clean up (ADR-0019): "Don't need" marks, the lists the Clean up screen shows, and the local record
 * of removed files. Nothing here touches a photo file; removing files is done only by library/remove-photos.ts.
 */

import { basename, dirname } from 'node:path'
import type { Catalog } from '../database'

/**
 * Marks pictures as "Don't need" (or clears the mark). Returns the ids whose state changed, so Undo can put back
 * exactly those. Unknown ids are ignored. A mark is a note only: nothing is removed until the person confirms.
 */
export function setUnneeded(db: Catalog, input: { assetIds: readonly string[]; unneeded: boolean }): { changed: string[] } {
  return db.transaction(() => {
    const changed: string[] = []
    const add = db.prepare('INSERT INTO unneeded (asset_id, marked_at) SELECT id, ? FROM asset WHERE id = ? ON CONFLICT (asset_id) DO NOTHING')
    const remove = db.prepare('DELETE FROM unneeded WHERE asset_id = ?')
    const now = Date.now()
    for (const assetId of new Set(input.assetIds)) {
      const result = input.unneeded ? add.run(now, assetId) : remove.run(assetId)
      if (result.changes > 0) changed.push(assetId)
    }
    return { changed }
  })()
}

export interface UnneededPicture {
  assetId: string
  width: number | null
  height: number | null
  capturedAt: number | null
  fileName: string
  folderName: string
  /** Files of this picture that would be removed (identical copies count separately). */
  files: number
  bytes: number
  /** Some copy is in a folder that isn't connected, so it can't be checked or removed now. */
  offline: boolean
  /** Studio projects that use this picture: its last copy can't be removed while they do. */
  usedIn: string[]
}

/** The marked pictures still found somewhere, newest mark first, with what removing them would involve. */
export function listUnneeded(db: Catalog, limit = 1000): { items: UnneededPicture[]; total: number } {
  const rows = db
    .prepare(
      `SELECT a.id, a.width, a.height, a.captured_at,
              COUNT(l.id) AS files, SUM(l.size_bytes) AS bytes, SUM(s.status <> 'active') AS offline,
              MIN(s.display_name || char(0) || l.relative_path) AS first
       FROM unneeded u JOIN asset a ON a.id = u.asset_id
       JOIN asset_location l ON l.asset_id = a.id AND l.availability = 'available'
       JOIN source s ON s.id = l.source_id
       GROUP BY a.id ORDER BY u.marked_at DESC, a.id LIMIT ?`,
    )
    .all(limit) as Array<{ id: string; width: number | null; height: number | null; captured_at: number | null; files: number; bytes: number; offline: number; first: string }>
  const projects = db.prepare('SELECT DISTINCT p.title FROM project_item i JOIN project p ON p.id = i.project_id WHERE i.asset_id = ? ORDER BY p.title').pluck()
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM unneeded u WHERE EXISTS (SELECT 1 FROM asset_location l WHERE l.asset_id = u.asset_id AND l.availability = 'available')`)
    .get() as { total: number }
  const items = rows.map((row) => {
    const [folderName = '', relativePath = ''] = row.first.split('\0')
    return {
      assetId: row.id,
      width: row.width,
      height: row.height,
      capturedAt: row.captured_at,
      fileName: basename(relativePath),
      folderName,
      files: row.files,
      bytes: row.bytes,
      offline: row.offline > 0,
      usedIn: projects.all(row.id) as string[],
    }
  })
  return { items, total }
}

export interface DuplicateCopy {
  locationId: string
  fileName: string
  folderName: string
  /** The subfolder inside the added folder, '' for the folder itself. Shown so the person can tell copies apart. */
  subfolder: string
  bytes: number
  offline: boolean
}

/**
 * Pictures found as two or more byte-identical files, newest first. Each group lists its copies so the person can
 * choose which one stays; the order is stable (folder, then path) so the same copy is offered first every time.
 */
export function listDuplicates(db: Catalog, limit = 500): { groups: Array<{ assetId: string; copies: DuplicateCopy[] }>; total: number } {
  const duplicated = `SELECT asset_id FROM asset_location WHERE availability = 'available' GROUP BY asset_id HAVING COUNT(*) > 1`
  const assets = db
    .prepare(`SELECT a.id FROM asset a WHERE a.id IN (${duplicated}) ORDER BY a.captured_at DESC, a.id DESC LIMIT ?`)
    .pluck()
    .all(limit) as string[]
  const copiesOf = db.prepare(
    `SELECT l.id, l.relative_path, l.size_bytes, s.display_name, s.status FROM asset_location l JOIN source s ON s.id = l.source_id
     WHERE l.asset_id = ? AND l.availability = 'available' ORDER BY s.display_name, l.relative_path`,
  )
  const groups = assets.map((assetId) => ({
    assetId,
    copies: (copiesOf.all(assetId) as Array<{ id: string; relative_path: string; size_bytes: number; display_name: string; status: string }>).map((c) => ({
      locationId: c.id,
      fileName: basename(c.relative_path),
      folderName: c.display_name,
      subfolder: dirname(c.relative_path) === '.' ? '' : dirname(c.relative_path),
      bytes: c.size_bytes,
      offline: c.status !== 'active',
    })),
  }))
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM (${duplicated})`).get() as { total: number }
  return { groups, total }
}

export interface RemovalRecord {
  removedAt: number
  mode: 'trash' | 'forever'
  fileName: string
  folderName: string
  sizeBytes: number
}

export function recordRemoval(db: Catalog, record: RemovalRecord): void {
  db.prepare('INSERT INTO removal_log (removed_at, mode, file_name, folder_name, size_bytes) VALUES (?, ?, ?, ?, ?)').run(
    record.removedAt,
    record.mode,
    record.fileName,
    record.folderName,
    record.sizeBytes,
  )
}

/** The most recent removals, newest first. */
export function listRemovals(db: Catalog, limit = 200): RemovalRecord[] {
  return (
    db.prepare('SELECT removed_at, mode, file_name, folder_name, size_bytes FROM removal_log ORDER BY id DESC LIMIT ?').all(limit) as Array<{
      removed_at: number
      mode: 'trash' | 'forever'
      file_name: string
      folder_name: string
      size_bytes: number
    }>
  ).map((r) => ({ removedAt: r.removed_at, mode: r.mode, fileName: r.file_name, folderName: r.folder_name, sizeBytes: r.size_bytes }))
}
