/**
 * Proof that a folder of originals wasn't changed (AC1): fingerprints every file before and after,
 * and watches the folder for any write while the test runs. Reading a file doesn't trigger the watcher; writing does.
 */

import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, rmSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
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
export function watchForWrites(root: string): { stop: () => string[]; events: () => readonly string[] } {
  const events: string[] = []
  const watcher: FSWatcher = watch(root, { recursive: true }, (type, name) => events.push(`${type}:${String(name)}`))
  return {
    events: () => events,
    stop: () => {
      watcher.close()
      return events
    },
  }
}

// Each marker has its own name: one write can be reported twice, and a late second report of the opening
// marker must never be mistaken for the closing one.
const SENTINEL_PREFIX = '.nearmora-test-sentinel-'

// Writes a sentinel file until the watcher reports it. A new macOS watcher starts asynchronously, and a write made
// before it's running is never reported at all, so one write isn't enough; the first report proves it's live.
async function markAndWait(root: string, name: string, watcher: ReturnType<typeof watchForWrites>, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs
  let nextWrite = 0
  for (;;) {
    const index = watcher.events().findIndex((event) => event.endsWith(name))
    if (index >= 0) return index
    if (Date.now() > deadline) throw new Error(`The file watcher never reported ${name} within ${timeoutMs} ms`)
    if (Date.now() >= nextWrite) {
      writeFileSync(join(root, name), String(Date.now()))
      nextWrite = Date.now() + 200
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/**
 * Watches a test's own folder for writes without guessing how long macOS takes to report them.
 * `start()` writes a hidden sentinel file and waits for its event, proving the watcher is live and that events from
 * creating the folder are behind us. `finish()` writes the sentinel again and waits for that event: file events
 * arrive in order, so anything written before it has been reported by then. It returns the events in between
 * (the sentinel's own events excluded) and removes the sentinel. Only for folders the test itself created.
 */
export async function guardFolder(root: string, timeoutMs = 20_000): Promise<{ finish: () => Promise<string[]> }> {
  const watcher = watchForWrites(root)
  const opening = `${SENTINEL_PREFIX}start`
  const closing = `${SENTINEL_PREFIX}end`
  const startAt = (await markAndWait(root, opening, watcher, timeoutMs)) + 1
  return {
    finish: async () => {
      const endAt = await markAndWait(root, closing, watcher, timeoutMs)
      const between = watcher
        .stop()
        .slice(startAt, endAt)
        .filter((event) => !event.includes(SENTINEL_PREFIX))
      rmSync(join(root, opening), { force: true })
      rmSync(join(root, closing), { force: true })
      return between
    },
  }
}
