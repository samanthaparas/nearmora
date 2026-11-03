/**
 * Removes the photos the person chose in Clean up (ADR-0019): to the Trash by default, or forever when they confirm it.
 * This is the only code in Nearmora that removes a photo file, so every file is re-checked here first, one by one,
 * and anything that doesn't match exactly what was catalogued is refused and left untouched.
 */

import { lstatSync, realpathSync, rmSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Catalog } from '../catalog/database'
import { recordRemoval } from '../catalog/repositories/clean-up'
import { regroupMoments } from './moments'
import { regroupSimilaritySets } from './regroup-sets'
import { sha256File } from './scan'
import { isSameOrInside } from './source-folders'
import { thumbnailPathForSha } from './thumbnails'

export type RemoveMode = 'trash' | 'forever'

/** Why a file was left alone. Each is shown to the person in plain words. */
export type RefusalReason = 'offline' | 'missing' | 'changed' | 'not_a_file' | 'outside_folder' | 'last_copy' | 'failed'

export interface RemoveRequest {
  /** Pictures marked "Don't need": every copy of each goes. */
  pictures: readonly string[]
  /** Extra copies chosen in Duplicates: only these files go, and each picture always keeps at least one copy. */
  copies: readonly string[]
}

export interface RemoveDeps {
  db: Catalog
  appDataDir: string
  thumbnailsDir: string
  previewsDir: string
  /** Moves one file to the Trash. Electron's shell.trashItem in the app; a stand-in Trash folder in tests. */
  trash: (path: string) => Promise<void>
}

/** One file that would be removed, with everything needed to re-check it is still the catalogued file. */
interface Target {
  locationId: string
  assetId: string
  rootPath: string
  relativePath: string
  folderName: string
  sourceStatus: string
  sizeBytes: number
  mtimeMs: number
  sha: Buffer
}

export interface RemovalPlan {
  targets: Target[]
  refused: Array<{ fileName: string; folderName: string; reason: RefusalReason }>
  /** Pictures that can't go because a Studio project uses them. No file of theirs is touched. */
  blocked: Array<{ fileName: string; projects: string[] }>
}

export interface RemovalResult {
  removed: number
  bytes: number
  refused: RemovalPlan['refused']
  blocked: RemovalPlan['blocked']
}

/** Works out which files a request covers, without touching any. Also used to count files for the confirmation. */
export function planRemoval(db: Catalog, request: RemoveRequest): RemovalPlan {
  const plan: RemovalPlan = { targets: [], refused: [], blocked: [] }
  const locationsOf = db.prepare(
    `SELECT l.id AS locationId, l.asset_id AS assetId, s.root_path AS rootPath, l.relative_path AS relativePath,
            s.display_name AS folderName, s.status AS sourceStatus, l.size_bytes AS sizeBytes, l.mtime_ms AS mtimeMs, a.content_sha256 AS sha
     FROM asset_location l JOIN source s ON s.id = l.source_id JOIN asset a ON a.id = l.asset_id
     WHERE l.asset_id = ? AND l.availability = 'available' ORDER BY s.display_name, l.relative_path`,
  )
  const assetOfLocation = db.prepare(`SELECT asset_id FROM asset_location WHERE id = ? AND availability = 'available'`).pluck()
  const projectsUsing = db.prepare('SELECT DISTINCT p.title FROM project_item i JOIN project p ON p.id = i.project_id WHERE i.asset_id = ? ORDER BY p.title').pluck()

  // Whole pictures. A project's photo can't lose its last copy, so the picture is refused before any file is touched.
  const pictures = new Set(request.pictures)
  for (const assetId of pictures) {
    const copies = locationsOf.all(assetId) as Target[]
    if (copies.length === 0) continue
    const projects = projectsUsing.all(assetId) as string[]
    if (projects.length > 0) {
      plan.blocked.push({ fileName: basename(copies[0]!.relativePath), projects })
      continue
    }
    plan.targets.push(...copies)
  }

  // Extra copies, grouped by picture. If the chosen copies are all the copies there are, none of them goes.
  const chosenByAsset = new Map<string, Set<string>>()
  for (const locationId of new Set(request.copies)) {
    const assetId = assetOfLocation.get(locationId) as string | undefined
    if (!assetId || pictures.has(assetId)) continue
    chosenByAsset.set(assetId, (chosenByAsset.get(assetId) ?? new Set()).add(locationId))
  }
  for (const [assetId, chosen] of chosenByAsset) {
    const copies = locationsOf.all(assetId) as Target[]
    const picked = copies.filter((c) => chosen.has(c.locationId))
    if (picked.length === copies.length) {
      for (const c of picked) plan.refused.push({ fileName: basename(c.relativePath), folderName: c.folderName, reason: 'last_copy' })
      continue
    }
    plan.targets.push(...picked)
  }
  return plan
}

/**
 * Checks, just before removing it, that a file is exactly the one catalogued: in a connected folder the person added,
 * an ordinary file (not a link), not inside Nearmora's data, and with the same size, date and SHA-256 as when scanned.
 */
export async function checkTarget(target: Target, appDataDir: string): Promise<RefusalReason | null> {
  if (target.sourceStatus !== 'active') return 'offline'
  let root: string
  try {
    root = realpathSync.native(target.rootPath)
  } catch {
    return 'offline'
  }
  // The folder's path was resolved when it was added; if it now resolves elsewhere, it isn't the same folder.
  if (root !== target.rootPath) return 'outside_folder'
  const path = join(root, target.relativePath)
  let stats
  try {
    stats = lstatSync(path)
  } catch {
    return 'missing'
  }
  if (!stats.isFile()) return 'not_a_file'
  const real = realpathSync.native(path)
  if (real === root || !isSameOrInside(root, real) || isSameOrInside(realpathSync.native(appDataDir), real)) return 'outside_folder'
  if (stats.size !== target.sizeBytes || Math.floor(stats.mtimeMs) !== target.mtimeMs) return 'changed'
  try {
    if (!(await sha256File(path)).equals(target.sha)) return 'changed'
  } catch {
    return 'missing'
  }
  // Hashing takes a moment; make sure the file wasn't replaced or edited while it was being read.
  const after = lstatSync(path, { throwIfNoEntry: false })
  if (!after || after.ino !== stats.ino || after.size !== stats.size || after.mtimeMs !== stats.mtimeMs) return 'changed'
  return null
}

/** Removes every file in the plan that passes its checks, then updates the catalogue to match. */
export async function removePhotos(deps: RemoveDeps, request: RemoveRequest, mode: RemoveMode): Promise<RemovalResult> {
  const { db } = deps
  const plan = planRemoval(db, request)
  const result: RemovalResult = { removed: 0, bytes: 0, refused: [...plan.refused], blocked: plan.blocked }
  const touched = new Set<string>()

  // One file at a time, so a failure part-way leaves the catalogue matching exactly what happened on disk.
  for (const target of plan.targets) {
    const fileName = basename(target.relativePath)
    const reason = await checkTarget(target, deps.appDataDir)
    if (reason) {
      result.refused.push({ fileName, folderName: target.folderName, reason })
      continue
    }
    const path = join(target.rootPath, target.relativePath)
    try {
      if (mode === 'trash') await deps.trash(path)
      else await unlink(path)
    } catch (error: unknown) {
      console.warn('[clean-up] could not remove a file', error instanceof Error ? error.message : '')
      result.refused.push({ fileName, folderName: target.folderName, reason: 'failed' })
      continue
    }
    db.transaction(() => {
      db.prepare('DELETE FROM asset_location WHERE id = ?').run(target.locationId)
      recordRemoval(db, { removedAt: Date.now(), mode, fileName, folderName: target.folderName, sizeBytes: target.sizeBytes })
    })()
    touched.add(target.assetId)
    result.removed++
    result.bytes += target.sizeBytes
  }

  // A picture with no copy left leaves the catalogue (and its moments, sets, favourites and albums, by cascade),
  // along with its cached thumbnail and preview, so nothing of a photo deleted forever stays behind in Nearmora.
  const stillAvailable = db.prepare(`SELECT 1 FROM asset_location WHERE asset_id = ? AND availability = 'available'`)
  const shaOf = db.prepare('SELECT content_sha256 FROM asset WHERE id = ?').pluck()
  for (const assetId of touched) {
    if (stillAvailable.get(assetId)) continue
    const sha = shaOf.get(assetId) as Buffer | undefined
    try {
      db.prepare('DELETE FROM asset WHERE id = ?').run(assetId)
    } catch (error: unknown) {
      // A project started using it while the files were being removed: keep the record so the project stays whole.
      console.warn('[clean-up] kept a picture record still in use', error instanceof Error ? error.message : '')
      continue
    }
    if (sha) {
      rmSync(thumbnailPathForSha(deps.thumbnailsDir, sha), { force: true })
      rmSync(join(deps.previewsDir, `${sha.toString('hex')}.webp`), { force: true })
    }
  }

  if (touched.size > 0) {
    regroupMoments(db)
    regroupSimilaritySets(db)
  }
  return result
}
