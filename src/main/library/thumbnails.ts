/**
 * Where thumbnails live: one WebP per distinct picture in the app's cache folder, named by the picture's SHA-256.
 * Naming by content means identical copies share one thumbnail and a rescan finds it again.
 */

import { join } from 'node:path'
import type { Catalog } from '../catalog/database'

export function thumbnailPathForSha(thumbnailsDir: string, sha256: Buffer): string {
  return join(thumbnailsDir, `${sha256.toString('hex')}.webp`)
}

/** Turns an asset id from the UI into its thumbnail file, or undefined if there is no such picture. */
export function thumbnailPathForAsset(db: Catalog, thumbnailsDir: string, assetId: string): string | undefined {
  const row = db.prepare('SELECT content_sha256 FROM asset WHERE id = ?').get(assetId) as { content_sha256: Buffer } | undefined
  return row ? thumbnailPathForSha(thumbnailsDir, row.content_sha256) : undefined
}
