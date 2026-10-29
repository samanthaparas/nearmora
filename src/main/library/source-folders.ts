/**
 * Decides whether a folder the person picked can become a source.
 * Refusing overlapping folders is what stops the same file from being catalogued twice (AC2),
 * and refusing folders around the app's own data keeps thumbnails from ever being written inside a photo folder.
 */

import { realpathSync, statSync } from 'node:fs'
import { basename, isAbsolute, relative } from 'node:path'
import type { Catalog } from '../catalog/database'
import { addSource, listSources, type Source } from '../catalog/repositories/sources'

export type AddFolderResult =
  | { ok: true; source: Source }
  | { ok: false; reason: 'unavailable' | 'overlap' | 'app_data' }

/** True when `child` is `parent` itself or somewhere inside it. */
export function isSameOrInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function addSourceFolder(db: Catalog, chosenPath: string, appDataDir: string): AddFolderResult {
  // Resolve symlinks and letter case to the folder's real path, so two spellings of one folder compare equal.
  let rootPath: string
  try {
    rootPath = realpathSync.native(chosenPath)
    if (!statSync(rootPath).isDirectory()) return { ok: false, reason: 'unavailable' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }

  const appData = realpathSync.native(appDataDir)
  if (isSameOrInside(rootPath, appData) || isSameOrInside(appData, rootPath)) return { ok: false, reason: 'app_data' }

  const overlaps = listSources(db).some(
    (source) => isSameOrInside(source.rootPath, rootPath) || isSameOrInside(rootPath, source.rootPath),
  )
  if (overlaps) return { ok: false, reason: 'overlap' }

  return { ok: true, source: addSource(db, { rootPath, displayName: basename(rootPath) || rootPath }) }
}
