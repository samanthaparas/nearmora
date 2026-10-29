/**
 * The Library grid's query: pictures that have at least one known location, newest first, flagged when offline.
 * R3a pages with a simple offset; R3b replaces it with keyset paging and filters when the grid is virtualized.
 */

import { z } from 'zod'
import type { Catalog } from '../database'

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

export function queryLibrary(db: Catalog, page: { offset: number; limit: number }): { items: LibraryItem[]; total: number } {
  // Shown: pictures last seen in place, including on a disconnected drive (from the cached thumbnail).
  // Hidden: pictures whose every file has gone missing.
  const visible = `a.decode_state = 'ok' AND EXISTS (
    SELECT 1 FROM asset_location l WHERE l.asset_id = a.id AND l.availability = 'available')`
  // Offline: none of its available files is in a connected folder.
  const offline = `NOT EXISTS (
    SELECT 1 FROM asset_location l JOIN source s ON s.id = l.source_id
    WHERE l.asset_id = a.id AND l.availability = 'available' AND s.status = 'active')`
  const items = db
    .prepare(
      `SELECT a.id, a.width, a.height, a.captured_at, ${offline} AS offline FROM asset a
       WHERE ${visible}
       ORDER BY a.captured_at IS NULL, a.captured_at DESC, a.id
       LIMIT ? OFFSET ?`,
    )
    .all(page.limit, page.offset)
    .map((row) => LibraryRow.parse(row))
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM asset a WHERE ${visible}`).get() as { total: number }
  return { items, total }
}
