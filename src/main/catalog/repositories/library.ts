/**
 * The Library grid's query: pictures that have at least one known location, newest first.
 * R3a pages with a simple offset; R3b replaces it with keyset paging and filters when the grid is virtualized.
 */

import { z } from 'zod'
import type { Catalog } from '../database'

const LibraryRow = z
  .object({ id: z.string(), width: z.number().int().nullable(), height: z.number().int().nullable(), captured_at: z.number().int().nullable() })
  .transform((row) => ({ id: row.id, width: row.width, height: row.height, capturedAt: row.captured_at }))
export type LibraryItem = z.output<typeof LibraryRow>

export function queryLibrary(db: Catalog, page: { offset: number; limit: number }): { items: LibraryItem[]; total: number } {
  // Only pictures still found somewhere are shown; a missing drive's photos come back when it's reconnected.
  const visible = `a.decode_state = 'ok' AND EXISTS (
    SELECT 1 FROM asset_location l WHERE l.asset_id = a.id AND l.availability = 'available')`
  const items = db
    .prepare(
      `SELECT a.id, a.width, a.height, a.captured_at FROM asset a
       WHERE ${visible}
       ORDER BY a.captured_at IS NULL, a.captured_at DESC, a.id
       LIMIT ? OFFSET ?`,
    )
    .all(page.limit, page.offset)
    .map((row) => LibraryRow.parse(row))
  const { total } = db.prepare(`SELECT COUNT(*) AS total FROM asset a WHERE ${visible}`).get() as { total: number }
  return { items, total }
}
