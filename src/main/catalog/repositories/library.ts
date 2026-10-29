/**
 * The Library grid's query: pictures still found somewhere, newest first, with search and filters.
 * Pages are fetched by "keyset": each page continues after the last photo of the previous one, so scrolling
 * stays fast however deep you go and never skips or repeats a photo when new ones arrive mid-scroll.
 */

import { z } from 'zod'
import type { Catalog } from '../database'

export interface LibraryFilters {
  /** Matched against file names and subfolders, folder names, and moment titles. */
  search?: string
  /** Epoch ms, inclusive. */
  from?: number
  to?: number
  sourceId?: string
  favoritesOnly?: boolean
  momentId?: string
}

/** Where the previous page ended: its last photo's date and id. */
export interface LibraryCursor {
  capturedAt: number | null
  id: string
}

const LibraryRow = z
  .object({
    id: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    captured_at: z.number().int().nullable(),
    offline: z.union([z.literal(0), z.literal(1)]),
  })
  .transform((row) => ({ id: row.id, width: row.width, height: row.height, capturedAt: row.captured_at, offline: row.offline === 1 }))
export type LibraryItem = z.output<typeof LibraryRow>

// LIKE treats % and _ as wildcards; escape them so a search for "50%" means the characters "50%".
const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** Builds the WHERE clause and its parameters. Every value is a bound parameter, never pasted into the SQL. */
function whereClause(filters: LibraryFilters): { sql: string; params: unknown[] } {
  // Shown: pictures last seen in place, including on a disconnected drive (from the cached thumbnail).
  const clauses = [
    `a.decode_state = 'ok'`,
    `EXISTS (SELECT 1 FROM asset_location l WHERE l.asset_id = a.id AND l.availability = 'available'${filters.sourceId ? ' AND l.source_id = ?' : ''})`,
  ]
  const params: unknown[] = filters.sourceId ? [filters.sourceId] : []

  if (filters.from !== undefined) {
    clauses.push('a.captured_at >= ?')
    params.push(filters.from)
  }
  if (filters.to !== undefined) {
    clauses.push('a.captured_at <= ?')
    params.push(filters.to)
  }
  if (filters.favoritesOnly) clauses.push('EXISTS (SELECT 1 FROM favorite f WHERE f.asset_id = a.id)')
  if (filters.momentId) {
    clauses.push('EXISTS (SELECT 1 FROM moment_asset ma WHERE ma.asset_id = a.id AND ma.moment_id = ?)')
    params.push(filters.momentId)
  }
  const search = filters.search?.trim()
  if (search) {
    const pattern = likePattern(search)
    clauses.push(`(
      EXISTS (SELECT 1 FROM asset_location l JOIN source s ON s.id = l.source_id
              WHERE l.asset_id = a.id AND (l.relative_path LIKE ? ESCAPE '\\' OR s.display_name LIKE ? ESCAPE '\\'))
      OR EXISTS (SELECT 1 FROM moment_asset ma JOIN moment m ON m.id = ma.moment_id
                 WHERE ma.asset_id = a.id AND (m.title LIKE ? ESCAPE '\\' OR m.auto_title LIKE ? ESCAPE '\\')))`)
    params.push(pattern, pattern, pattern, pattern)
  }
  return { sql: clauses.join(' AND '), params }
}

export function queryLibrary(
  db: Catalog,
  request: { limit: number; cursor?: LibraryCursor | null; filters?: LibraryFilters },
): { items: LibraryItem[]; total: number; nextCursor: LibraryCursor | null } {
  const where = whereClause(request.filters ?? {})

  // Order: newest first, then id, with undated pictures last. The cursor continues strictly after the last row.
  let after = ''
  const afterParams: unknown[] = []
  const cursor = request.cursor
  if (cursor) {
    if (cursor.capturedAt === null) {
      after = ' AND (a.captured_at IS NULL AND a.id < ?)'
      afterParams.push(cursor.id)
    } else {
      after = ' AND (a.captured_at < ? OR (a.captured_at = ? AND a.id < ?) OR a.captured_at IS NULL)'
      afterParams.push(cursor.capturedAt, cursor.capturedAt, cursor.id)
    }
  }

  // Offline: none of its available files is in a connected folder.
  const offline = `NOT EXISTS (
    SELECT 1 FROM asset_location l JOIN source s ON s.id = l.source_id
    WHERE l.asset_id = a.id AND l.availability = 'available' AND s.status = 'active')`
  const items = db
    .prepare(
      `SELECT a.id, a.width, a.height, a.captured_at, ${offline} AS offline FROM asset a
       WHERE ${where.sql}${after}
       ORDER BY a.captured_at DESC, a.id DESC
       LIMIT ?`,
    )
    .all(...where.params, ...afterParams, request.limit)
    .map((row) => LibraryRow.parse(row))
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM asset a WHERE ${where.sql}`).get(...where.params) as { total: number }

  const last = items.at(-1)
  const nextCursor = items.length === request.limit && last ? { capturedAt: last.capturedAt, id: last.id } : null
  return { items, total, nextCursor }
}

/**
 * An album's photos in the order the person arranged them, paged by position. Every member is listed, including
 * ones only reachable offline, so positions match what reordering works with.
 */
export function queryAlbumPhotos(
  db: Catalog,
  request: { albumId: string; afterPosition?: number | null; limit: number },
): { items: LibraryItem[]; total: number; nextAfter: number | null } {
  const after = request.afterPosition ?? -1
  const rows = db
    .prepare(
      `SELECT a.id, a.width, a.height, a.captured_at, m.position,
              NOT EXISTS (
                SELECT 1 FROM asset_location l JOIN source s ON s.id = l.source_id
                WHERE l.asset_id = a.id AND l.availability = 'available' AND s.status = 'active') AS offline
       FROM album_asset m JOIN asset a ON a.id = m.asset_id
       WHERE m.album_id = ? AND m.position > ?
       ORDER BY m.position LIMIT ?`,
    )
    .all(request.albumId, after, request.limit) as Array<Record<string, unknown> & { position: number }>
  const items = rows.map((row) => LibraryRow.parse(row))
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM album_asset WHERE album_id = ?').get(request.albumId) as { total: number }
  const last = rows.at(-1)
  return { items, total, nextAfter: rows.length === request.limit && last ? last.position : null }
}
