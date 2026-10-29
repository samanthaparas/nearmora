/**
 * Finds groups of similar photos for Best Moments (AC3): two photos are candidates when their dHash fingerprints
 * differ in only a few bits and they were taken close together in time. "Similar" means "possibly related",
 * never "safe to delete". Byte-identical copies are not sets: they're already one picture with several locations.
 */

import { posix } from 'node:path'
import type { Catalog } from '../catalog/database'

export interface SimilarityParams {
  /** Recorded on every set, so results can always be traced to the rule that made them. */
  version: string
  /** Most bits (of 64) two dHashes may differ by. */
  maxDistance: number
  /** Most time between two photos' capture times. */
  windowMs: number
  /** Which capture times count. The roadmap starts with EXIF only, since file dates are often copy dates. */
  dateSources: ReadonlyArray<'exif' | 'file_mtime'>
  /**
   * When a photo's time is only its file date, it may be linked only with photos in the same folder.
   * File dates are often copy dates; bursts almost always sit together in one folder.
   */
  fileDatesSameFolderOnly?: boolean
}

/** The roadmap's starting rule (§6.6): EXIF dates only. Kept for comparison. */
export const SIMILARITY_V1: SimilarityParams = {
  version: 'dhash64-t10-w120s@1',
  maxDistance: 10,
  windowMs: 120_000,
  dateSources: ['exif'],
}

/**
 * The rule in use (owner's decision, ADR-0009): as v1, plus photos without an EXIF date, using their file date,
 * but only together with photos in the same folder. Changing any value means a new version string.
 */
export const SIMILARITY_V2: SimilarityParams = {
  version: 'dhash64-t10-w120s-filedate-samefolder@2',
  maxDistance: 10,
  windowMs: 120_000,
  dateSources: ['exif', 'file_mtime'],
  fileDatesSameFolderOnly: true,
}

export const SIMILARITY_CURRENT = SIMILARITY_V2

export interface HashedPicture {
  assetId: string
  capturedAt: number
  dhash: Buffer
  /** Where the capture time came from; missing means EXIF. */
  dateSource?: 'exif' | 'file_mtime'
  /** Folders (source id plus subfolder) where the picture was found. */
  folders?: ReadonlySet<string>
}

// Same folder: the two pictures share at least one folder.
function shareFolder(a: HashedPicture, b: HashedPicture): boolean {
  if (!a.folders || !b.folders) return false
  for (const folder of a.folders) if (b.folders.has(folder)) return true
  return false
}

/** Number of differing bits between two 8-byte hashes. */
export function hammingDistance(a: Buffer, b: Buffer): number {
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    let x = a[i]! ^ b[i]!
    while (x) {
      distance += x & 1
      x >>= 1
    }
  }
  return distance
}

/**
 * Groups pictures: every pair within the time window and distance threshold is linked, and linked pictures form
 * a group (connected components, via union-find). Sorting by time means each photo is only compared with its
 * neighbours inside the window, not with the whole library. Groups of one are not returned.
 */
export function findSimilarGroups(
  pictures: readonly HashedPicture[],
  params: Pick<SimilarityParams, 'maxDistance' | 'windowMs' | 'fileDatesSameFolderOnly'>,
): string[][] {
  const sorted = [...pictures].sort((a, b) => a.capturedAt - b.capturedAt || (a.assetId < b.assetId ? -1 : 1))
  const parent = sorted.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]! // path halving keeps the trees shallow
      i = parent[i]!
    }
    return i
  }

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j]!.capturedAt - sorted[i]!.capturedAt <= params.windowMs; j++) {
      const a = sorted[i]!
      const b = sorted[j]!
      const usesFileDate = a.dateSource === 'file_mtime' || b.dateSource === 'file_mtime'
      if (params.fileDatesSameFolderOnly && usesFileDate && !shareFolder(a, b)) continue
      if (hammingDistance(a.dhash, b.dhash) <= params.maxDistance) parent[find(j)] = find(i)
    }
  }

  const groups = new Map<number, string[]>()
  sorted.forEach((picture, i) => {
    const root = find(i)
    groups.set(root, [...(groups.get(root) ?? []), picture.assetId])
  })
  return [...groups.values()].filter((group) => group.length > 1)
}

/** Pictures that can take part: decodable, still found somewhere, with a hash and a capture time from an allowed source. */
export function readHashedPictures(db: Catalog, params: Pick<SimilarityParams, 'dateSources'>): HashedPicture[] {
  const sources = params.dateSources.map(() => '?').join(', ')
  const rows = db
    .prepare(
      `SELECT a.id AS assetId, a.captured_at AS capturedAt, a.dhash, a.captured_at_source AS dateSource,
              l.source_id AS sourceId, l.relative_path AS relativePath
       FROM asset a JOIN asset_location l ON l.asset_id = a.id AND l.availability = 'available'
       WHERE a.dhash IS NOT NULL AND a.captured_at IS NOT NULL AND a.decode_state = 'ok'
         AND a.captured_at_source IN (${sources})`,
    )
    .all(...params.dateSources) as Array<Omit<HashedPicture, 'folders'> & { sourceId: string; relativePath: string }>

  // One entry per picture, collecting every folder it was found in (identical copies can be in several).
  const pictures = new Map<string, HashedPicture & { folders: Set<string> }>()
  for (const { sourceId, relativePath, ...picture } of rows) {
    const folder = `${sourceId}/${posix.dirname(relativePath)}`
    const existing = pictures.get(picture.assetId)
    if (existing) existing.folders.add(folder)
    else pictures.set(picture.assetId, { ...picture, folders: new Set([folder]) })
  }
  return [...pictures.values()]
}
