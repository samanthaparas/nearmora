/**
 * Catalog records for pictures (assets) and the file paths where they were found (locations).
 * The scanner (R3) will call `recordAssetLocation` for every photo it reads; nothing here reads or writes photo files.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Catalog } from '../database'
import { CatalogError } from '../errors'

const sha256 = z.custom<Buffer>((value) => Buffer.isBuffer(value) && value.length === 32, 'expected a 32-byte SHA-256')

const NewAssetLocation = z
  .object({
    sourceId: z.string(),
    relativePath: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    mtimeMs: z.number().int(),
    contentSha256: sha256,
    mediaType: z.enum(['image/jpeg', 'image/png']),
    width: z.number().int().positive().nullable().default(null),
    height: z.number().int().positive().nullable().default(null),
    orientation: z.number().int().min(1).max(8).nullable().default(null),
    capturedAt: z.number().int().nullable(),
    capturedAtSource: z.enum(['exif', 'file_mtime', 'unknown']),
    decodeState: z.enum(['ok', 'unsupported', 'corrupt', 'too_large']).default('ok'),
  })
  .refine((v) => (v.capturedAt === null) === (v.capturedAtSource === 'unknown'), 'capturedAt and its source disagree')

const AssetRow = z
  .object({
    id: z.string(),
    media_type: z.string(),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    captured_at: z.number().int().nullable(),
    captured_at_source: z.enum(['exif', 'file_mtime', 'unknown']),
  })
  .transform((row) => ({
    id: row.id,
    mediaType: row.media_type,
    width: row.width,
    height: row.height,
    capturedAt: row.captured_at,
    capturedAtSource: row.captured_at_source,
  }))
export type Asset = z.output<typeof AssetRow>

const LocationRow = z
  .object({
    id: z.string(),
    source_id: z.string(),
    relative_path: z.string(),
    availability: z.enum(['available', 'missing', 'changed']),
  })
  .transform((row) => ({
    id: row.id,
    sourceId: row.source_id,
    relativePath: row.relative_path,
    availability: row.availability,
  }))
export type AssetLocation = z.output<typeof LocationRow>

/**
 * Records that a picture exists at a path. Identical bytes found in another folder reuse the same asset,
 * so favorites follow the picture rather than the path (roadmap decision D3).
 */
export function recordAssetLocation(db: Catalog, input: z.input<typeof NewAssetLocation>): { assetId: string; assetCreated: boolean } {
  const parsed = NewAssetLocation.safeParse(input)
  if (!parsed.success) throw new CatalogError('INVALID_INPUT', 'Invalid asset location')
  const v = parsed.data

  return db.transaction(() => {
    const existing = db.prepare('SELECT id FROM asset WHERE content_sha256 = ?').get(v.contentSha256) as { id: string } | undefined
    const assetId = existing?.id ?? randomUUID()
    if (!existing) {
      db.prepare(
        `INSERT INTO asset (id, content_sha256, media_type, width, height, orientation, captured_at, captured_at_source, decode_state)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(assetId, v.contentSha256, v.mediaType, v.width, v.height, v.orientation, v.capturedAt, v.capturedAtSource, v.decodeState)
    }

    // A path seen again (for example on rescan) updates its row instead of adding a second one.
    db.prepare(
      `INSERT INTO asset_location (id, asset_id, source_id, relative_path, size_bytes, mtime_ms, availability)
       VALUES (?, ?, ?, ?, ?, ?, 'available')
       ON CONFLICT (source_id, relative_path) DO UPDATE SET
         asset_id = excluded.asset_id, size_bytes = excluded.size_bytes,
         mtime_ms = excluded.mtime_ms, availability = 'available'`,
    ).run(randomUUID(), assetId, v.sourceId, v.relativePath, v.sizeBytes, v.mtimeMs)

    return { assetId, assetCreated: !existing }
  })()
}

export function getAsset(db: Catalog, id: string): Asset {
  const row = db.prepare('SELECT * FROM asset WHERE id = ?').get(id)
  if (!row) throw new CatalogError('NOT_FOUND', 'Asset not found')
  return AssetRow.parse(row)
}

export function listAssetLocations(db: Catalog, assetId: string): AssetLocation[] {
  return db
    .prepare('SELECT * FROM asset_location WHERE asset_id = ? ORDER BY relative_path')
    .all(assetId)
    .map((row) => LocationRow.parse(row))
}
