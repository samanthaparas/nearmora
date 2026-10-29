/**
 * Lists the files inside a source folder, one at a time, without following symlinks.
 * It only reads directory listings and file metadata; it never opens anything for writing.
 */

import { lstat, opendir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { isHiddenName } from './limits'

export interface FoundFile {
  absolutePath: string
  /** Relative to the source root, with forward slashes; this is what the catalog stores. */
  relativePath: string
  sizeBytes: number
  mtimeMs: number
}

/**
 * Yields every regular, non-hidden file under `root`, depth first.
 * Symlinks are skipped so a link can't lead the scan outside the folder the person chose,
 * and unreadable subfolders are reported through `onUnreadable` instead of stopping the scan.
 */
export async function* walkFiles(root: string, onUnreadable: (path: string) => void, signal?: AbortSignal): AsyncGenerator<FoundFile> {
  const pending = [root]
  while (pending.length > 0) {
    if (signal?.aborted) return
    const dir = pending.pop()!
    let handle
    try {
      handle = await opendir(dir)
    } catch {
      onUnreadable(dir)
      continue
    }
    for await (const entry of handle) {
      if (isHiddenName(entry.name)) continue
      const absolutePath = join(dir, entry.name)
      // Dirent types come from the directory listing itself, so a symlink reports as a symlink here.
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        pending.push(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stats = await lstat(absolutePath)
        yield {
          absolutePath,
          relativePath: relative(root, absolutePath).split('\\').join('/'),
          sizeBytes: stats.size,
          mtimeMs: Math.floor(stats.mtimeMs),
        }
      } catch {
        onUnreadable(absolutePath)
      }
    }
  }
}
