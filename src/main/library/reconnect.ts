/**
 * Checks that a folder that went offline is really the same folder when it comes back.
 * A drive with the same name isn't proof: a few catalogued photos are re-fingerprinted, so saved choices
 * are never attached to different files that merely share a name (blueprint: offline behaviour).
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import type { Catalog } from '../catalog/database'
import { getSource } from '../catalog/repositories/sources'

/** How many catalogued photos to re-fingerprint. Enough to catch a different drive, quick even on a slow disk. */
const SAMPLE_SIZE = 5

export type IdentityCheck = 'same' | 'different'

function sha256(path: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const hash = createHash('sha256')
    createReadStream(path, { flags: 'r' })
      .on('data', (chunk) => hash.update(chunk))
      .on('error', () => resolve(null))
      .on('end', () => resolve(hash.digest()))
  })
}

/**
 * Same folder if most sampled photos that still exist have the bytes we catalogued, and at least one does.
 * A few edited or deleted photos don't block reconnecting; a folder of different photos does.
 */
export async function checkSourceIdentity(db: Catalog, sourceId: string): Promise<IdentityCheck> {
  const { rootPath } = getSource(db, sourceId)
  const sample = db
    .prepare(
      `SELECT l.relative_path, a.content_sha256 FROM asset_location l JOIN asset a ON a.id = l.asset_id
       WHERE l.source_id = ? AND l.availability = 'available' ORDER BY random() LIMIT ?`,
    )
    .all(sourceId, SAMPLE_SIZE) as Array<{ relative_path: string; content_sha256: Buffer }>
  // Nothing was catalogued from this folder, so there are no choices that could attach to the wrong files.
  if (sample.length === 0) return 'same'

  let matched = 0
  let mismatched = 0
  for (const { relative_path, content_sha256 } of sample) {
    const actual = await sha256(join(rootPath, relative_path))
    if (actual === null) continue
    if (actual.equals(content_sha256)) matched++
    else mismatched++
  }
  return matched > 0 && matched >= mismatched ? 'same' : 'different'
}
