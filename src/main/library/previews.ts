/**
 * Larger previews for the Best Moments compare view, made on first request from an original that's reachable now.
 * Previews are cached in app data by content hash, like thumbnails; originals are only ever read.
 */

import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Catalog } from '../catalog/database'
import type { PreviewRequest } from '../media/process-image'

export function createPreviewResolver(deps: {
  db: Catalog
  previewsDir: string
  makePreview: (request: PreviewRequest) => Promise<{ ok: boolean }>
}) {
  mkdirSync(deps.previewsDir, { recursive: true })
  // Two requests for the same preview share one job instead of decoding the photo twice.
  const inFlight = new Map<string, Promise<string | undefined>>()

  // An original the app can read right now: an available file in a connected folder.
  const originalPath = deps.db.prepare(
    `SELECT s.root_path, l.relative_path, a.content_sha256 FROM asset a
     JOIN asset_location l ON l.asset_id = a.id AND l.availability = 'available'
     JOIN source s ON s.id = l.source_id AND s.status = 'active'
     WHERE a.id = ? LIMIT 1`,
  )
  const shaOf = deps.db.prepare('SELECT content_sha256 FROM asset WHERE id = ?').pluck()

  return async function preview(assetId: string): Promise<string | undefined> {
    const sha = shaOf.get(assetId) as Buffer | undefined
    if (!sha) return undefined
    const previewPath = join(deps.previewsDir, `${sha.toString('hex')}.webp`)
    if (existsSync(previewPath)) return previewPath

    const running = inFlight.get(previewPath)
    if (running) return running
    const job = (async () => {
      const row = originalPath.get(assetId) as { root_path: string; relative_path: string } | undefined
      if (!row) return undefined // offline: the UI falls back to the thumbnail
      const sourcePath = join(row.root_path, row.relative_path)
      if (!existsSync(sourcePath)) return undefined
      const result = await deps.makePreview({ sourcePath, previewPath })
      return result.ok ? previewPath : undefined
    })().finally(() => inFlight.delete(previewPath))
    inFlight.set(previewPath, job)
    return job
  }
}
