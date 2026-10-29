/**
 * What Nearmora stores on this Mac, and clearing its rebuildable caches (AC9: "cache deletion behaves as described").
 * Only Nearmora's own cache files are ever deleted: names must be exactly a 64-character SHA-256 plus ".webp".
 * The catalog and the person's photos are never touched here.
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CACHE_FILE = /^[0-9a-f]{64}\.webp$/

export interface StorageUsage {
  catalogBytes: number
  thumbnails: { files: number; bytes: number }
  previews: { files: number; bytes: number }
}

function folderUsage(dir: string): { files: number; bytes: number } {
  if (!existsSync(dir)) return { files: 0, bytes: 0 }
  let files = 0
  let bytes = 0
  for (const name of readdirSync(dir)) {
    if (!CACHE_FILE.test(name)) continue
    files++
    bytes += statSync(join(dir, name)).size
  }
  return { files, bytes }
}

export function storageUsage(paths: { catalogFile: string; thumbnailsDir: string; previewsDir: string }): StorageUsage {
  // The catalog is the database file plus its write-ahead log while the app runs.
  const catalogBytes = ['', '-wal', '-shm'].map((suffix) => `${paths.catalogFile}${suffix}`).filter(existsSync).reduce((sum, file) => sum + statSync(file).size, 0)
  return { catalogBytes, thumbnails: folderUsage(paths.thumbnailsDir), previews: folderUsage(paths.previewsDir) }
}

/** Deletes Nearmora's cache files in `dir` (and nothing else). Returns how many were removed. */
export function clearCacheFolder(dir: string): number {
  if (!existsSync(dir)) return 0
  let removed = 0
  for (const name of readdirSync(dir)) {
    if (!CACHE_FILE.test(name)) continue
    rmSync(join(dir, name), { force: true })
    removed++
  }
  return removed
}
