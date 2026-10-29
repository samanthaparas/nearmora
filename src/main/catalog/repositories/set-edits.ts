/**
 * Correcting a similar-photo set by hand (AC3): take a photo out, put one in, or split the set apart.
 * Corrections are stored as overrides on set_asset, which regrouping respects, so they survive rescans.
 * Each one checks the revision the screen was showing, like saving a review, and none touches favorites.
 */

import type { Catalog } from '../database'
import { CatalogError } from '../errors'

function checkRevision(db: Catalog, setId: string, expectedRevision: number): void {
  const revision = db.prepare('SELECT revision FROM similarity_set WHERE id = ?').pluck().get(setId) as number | undefined
  if (revision === undefined) throw new CatalogError('NOT_FOUND', 'Set not found')
  if (revision !== expectedRevision) throw new CatalogError('STALE_REVISION', 'This set changed since it was opened')
}

function bump(db: Catalog, setId: string): number {
  db.prepare('UPDATE similarity_set SET revision = revision + 1 WHERE id = ?').run(setId)
  return db.prepare('SELECT revision FROM similarity_set WHERE id = ?').pluck().get(setId) as number
}

const shownCount = (db: Catalog, setId: string): number =>
  db.prepare(`SELECT COUNT(*) FROM set_asset WHERE set_id = ? AND (user_override IS NULL OR user_override <> 'removed')`).pluck().get(setId) as number

/** Takes a photo out of the set. If fewer than two remain, the set is dissolved (hidden, kept so regrouping remembers). */
export function removeFromSet(db: Catalog, input: { setId: string; assetId: string; expectedRevision: number }): { revision: number; dissolved: boolean } {
  return db.transaction(() => {
    checkRevision(db, input.setId, input.expectedRevision)
    const row = db.prepare('SELECT user_override FROM set_asset WHERE set_id = ? AND asset_id = ?').get(input.setId, input.assetId) as
      | { user_override: string | null }
      | undefined
    if (!row || row.user_override === 'removed') throw new CatalogError('NOT_FOUND', 'That photo isn’t in this set')
    // A photo the person added by hand simply goes; one the app grouped is remembered as removed.
    if (row.user_override === 'added') db.prepare('DELETE FROM set_asset WHERE set_id = ? AND asset_id = ?').run(input.setId, input.assetId)
    else db.prepare(`UPDATE set_asset SET user_override = 'removed' WHERE set_id = ? AND asset_id = ?`).run(input.setId, input.assetId)
    return { revision: bump(db, input.setId), dissolved: shownCount(db, input.setId) < 2 }
  })()
}

/** Puts a photo into the set by hand. A photo already shown in another set must be taken out of that one first. */
export function addToSet(db: Catalog, input: { setId: string; assetId: string; expectedRevision: number }): { revision: number } {
  return db.transaction(() => {
    checkRevision(db, input.setId, input.expectedRevision)
    if (!db.prepare('SELECT 1 FROM asset WHERE id = ?').get(input.assetId)) throw new CatalogError('NOT_FOUND', 'Picture not found')
    const elsewhere = db
      .prepare(`SELECT 1 FROM set_asset WHERE asset_id = ? AND set_id <> ? AND (user_override IS NULL OR user_override <> 'removed')`)
      .get(input.assetId, input.setId)
    if (elsewhere) throw new CatalogError('CONFLICT', 'That photo is already in another set')
    const existing = db.prepare('SELECT user_override FROM set_asset WHERE set_id = ? AND asset_id = ?').get(input.setId, input.assetId) as
      | { user_override: string | null }
      | undefined
    if (existing && existing.user_override !== 'removed') throw new CatalogError('CONFLICT', 'That photo is already in this set')
    const position = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 FROM set_asset WHERE set_id = ?').pluck().get(input.setId) as number)
    if (existing) db.prepare(`UPDATE set_asset SET user_override = 'added', position = ? WHERE set_id = ? AND asset_id = ?`).run(position, input.setId, input.assetId)
    else db.prepare(`INSERT INTO set_asset (set_id, asset_id, position, user_override) VALUES (?, ?, ?, 'added')`).run(input.setId, input.assetId, position)
    return { revision: bump(db, input.setId) }
  })()
}

/** Splits the set apart: every photo is taken out, and regrouping won't put them back together. Favorites stay. */
export function ungroupSet(db: Catalog, input: { setId: string; expectedRevision: number }): { revision: number } {
  return db.transaction(() => {
    checkRevision(db, input.setId, input.expectedRevision)
    db.prepare(`DELETE FROM set_asset WHERE set_id = ? AND user_override = 'added'`).run(input.setId)
    db.prepare(`UPDATE set_asset SET user_override = 'removed' WHERE set_id = ?`).run(input.setId)
    return { revision: bump(db, input.setId) }
  })()
}

/**
 * Photos taken shortly before or after the set (within 10 minutes) and not in any set, offered for "Add to set".
 * Reads only; nothing is suggested as "similar", just nearby in time.
 */
export function nearbyPhotos(db: Catalog, setId: string, windowMs = 10 * 60 * 1000): Array<{ assetId: string; capturedAt: number | null; offline: boolean }> {
  const range = db
    .prepare(
      `SELECT MIN(a.captured_at) AS start, MAX(a.captured_at) AS end FROM set_asset s JOIN asset a ON a.id = s.asset_id
       WHERE s.set_id = ? AND (s.user_override IS NULL OR s.user_override <> 'removed')`,
    )
    .get(setId) as { start: number | null; end: number | null }
  if (range.start === null || range.end === null) return []
  const rows = db
    .prepare(
      `SELECT a.id AS assetId, a.captured_at AS capturedAt,
              NOT EXISTS (SELECT 1 FROM asset_location l JOIN source src ON src.id = l.source_id
                          WHERE l.asset_id = a.id AND l.availability = 'available' AND src.status = 'active') AS offline
       FROM asset a
       WHERE a.captured_at BETWEEN ? AND ? AND a.decode_state = 'ok'
         AND EXISTS (SELECT 1 FROM asset_location l WHERE l.asset_id = a.id AND l.availability = 'available')
         AND NOT EXISTS (SELECT 1 FROM set_asset s WHERE s.asset_id = a.id AND (s.user_override IS NULL OR s.user_override <> 'removed'))
       ORDER BY a.captured_at, a.id LIMIT 50`,
    )
    .all(range.start - windowMs, range.end + windowMs) as Array<{ assetId: string; capturedAt: number | null; offline: number }>
  return rows.map((row) => ({ ...row, offline: row.offline === 1 }))
}
