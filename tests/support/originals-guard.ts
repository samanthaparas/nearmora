/**
 * Proof that a folder of originals wasn't changed (AC1): fingerprints every file before and after,
 * and watches the folder for any write while the test runs. Reading a file doesn't trigger the watcher; writing does.
 */

import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { join, relative } from 'node:path'

export interface FileFingerprint {
  sha256: string
  size: number
  mtimeMs: number
}

/** SHA-256, size and modification time of every file under `root` (symlinks recorded as links, not followed). */
export function fingerprintFolder(root: string): Record<string, FileFingerprint> {
  const result: Record<string, FileFingerprint> = {}
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else {
        const stats = lstatSync(path)
        const content = entry.isSymbolicLink() ? Buffer.from('symlink') : readFileSync(path)
        result[relative(root, path)] = { sha256: createHash('sha256').update(content).digest('hex'), size: stats.size, mtimeMs: stats.mtimeMs }
      }
    }
  }
  visit(root)
  return result
}

/** Records every change event under `root` until `stop()` is called. */
export function watchForWrites(root: string): { stop: () => string[] } {
  const events: string[] = []
  const watcher: FSWatcher = watch(root, { recursive: true }, (type, name) => events.push(`${type}:${String(name)}`))
  return {
    stop: () => {
      watcher.close()
      return events
    },
  }
}
