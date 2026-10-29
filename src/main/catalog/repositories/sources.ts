/**
 * Catalog records for photo folders and drives the user has added.
 * Everything here changes catalog rows only; no function in this file touches the user's files.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { Catalog } from '../database'
import { CatalogError, isConstraintError } from '../errors'

export const SourceStatus = z.enum(['active', 'disconnected', 'permission_denied', 'removed'])
export type SourceStatus = z.infer<typeof SourceStatus>

// Rows are validated as they leave SQLite, so the rest of the app can trust their shape.
const SourceRow = z
  .object({
    id: z.string(),
    root_path: z.string(),
    volume_uuid: z.string().nullable(),
    display_name: z.string(),
    status: SourceStatus,
    added_at: z.number().int(),
    last_scan_at: z.number().int().nullable(),
  })
  .transform((row) => ({
    id: row.id,
    rootPath: row.root_path,
    volumeUuid: row.volume_uuid,
    displayName: row.display_name,
    status: row.status,
    addedAt: row.added_at,
    lastScanAt: row.last_scan_at,
  }))
export type Source = z.output<typeof SourceRow>

const NewSource = z.object({
  rootPath: z.string().refine(isAbsolute, 'must be an absolute path'),
  displayName: z.string().trim().min(1).max(200),
  volumeUuid: z.string().nullable().default(null),
})

export function addSource(db: Catalog, input: z.input<typeof NewSource>): Source {
  const parsed = NewSource.safeParse(input)
  if (!parsed.success) throw new CatalogError('INVALID_INPUT', 'Invalid source')
  const { rootPath, displayName, volumeUuid } = parsed.data

  const id = randomUUID()
  try {
    db.prepare(
      `INSERT INTO source (id, root_path, volume_uuid, display_name, status, added_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    ).run(id, rootPath, volumeUuid, displayName, Date.now())
  } catch (error: unknown) {
    if (isConstraintError(error, 'UNIQUE')) throw new CatalogError('CONFLICT', 'This folder is already a source', { cause: error })
    throw error
  }
  return getSource(db, id)
}

export function getSource(db: Catalog, id: string): Source {
  const row = db.prepare('SELECT * FROM source WHERE id = ?').get(id)
  if (!row) throw new CatalogError('NOT_FOUND', 'Source not found')
  return SourceRow.parse(row)
}

export function listSources(db: Catalog): Source[] {
  return db.prepare('SELECT * FROM source ORDER BY display_name').all().map((row) => SourceRow.parse(row))
}

export function setSourceStatus(db: Catalog, id: string, status: SourceStatus): void {
  const result = db.prepare('UPDATE source SET status = ? WHERE id = ?').run(SourceStatus.parse(status), id)
  if (result.changes === 0) throw new CatalogError('NOT_FOUND', 'Source not found')
}

/**
 * Forgets a source: its locations go (ON DELETE CASCADE), but assets, favorites and albums stay,
 * so re-adding the folder later brings the same choices back. The folder itself is not touched.
 */
export function removeSource(db: Catalog, id: string): { locationsRemoved: number } {
  return db.transaction(() => {
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM asset_location WHERE source_id = ?').get(id) as { n: number }
    const result = db.prepare('DELETE FROM source WHERE id = ?').run(id)
    if (result.changes === 0) throw new CatalogError('NOT_FOUND', 'Source not found')
    return { locationsRemoved: n }
  })()
}

/** After a restore, explains which photo folders are reachable on this computer. Only checks that each path exists. */
export function checkSourceReachability(db: Catalog): Array<{ source: Source; reachable: boolean }> {
  return listSources(db).map((source) => ({ source, reachable: existsSync(source.rootPath) }))
}
