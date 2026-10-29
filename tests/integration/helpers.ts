/**
 * Shared setup for catalog integration tests: a fresh temporary folder per test and small seeding helpers.
 * Tests use real SQLite files on disk, so they exercise the same code paths the app will.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { openCatalog, type Catalog } from '../../src/main/catalog/database'
import { CatalogError } from '../../src/main/catalog/errors'
import { recordAssetLocation } from '../../src/main/catalog/repositories/assets'
import { addSource } from '../../src/main/catalog/repositories/sources'

const created: string[] = []
const open: Catalog[] = []

afterEach(() => {
  for (const db of open.splice(0)) if (db.open) db.close()
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A new empty folder under the OS temp directory, deleted after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nearmora-test-'))
  created.push(dir)
  return dir
}

/** A test "profile": its own catalog file and backup folder, like a clean app-data folder. */
export function tempProfile(): { dir: string; catalogFile: string; backupDir: string } {
  const dir = tempDir()
  return { dir, catalogFile: join(dir, 'catalog.sqlite'), backupDir: join(dir, 'backups') }
}

/** Opens a catalog and closes it automatically after the test. */
export async function openTestCatalog(file: string, options: Parameters<typeof openCatalog>[1] = {}): Promise<Catalog> {
  const db = await openCatalog(file, options)
  open.push(db)
  return db
}

/** Runs `fn` and returns the CatalogError code it threw, so tests can assert on the reason for a refusal. */
export function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error: unknown) {
    return error instanceof CatalogError ? error.code : `not a CatalogError: ${String(error)}`
  }
  return undefined
}

/** A stand-in SHA-256 for picture `n`; equal `n` means identical bytes. */
export const fakeSha = (n: number): Buffer => createHash('sha256').update(`picture-${n}`).digest()

/** Adds a source whose folder really exists (so reachability checks pass) and returns its id. */
export function seedSource(db: Catalog, name = 'Fixtures'): { sourceId: string; rootPath: string } {
  const rootPath = join(tempDir(), name)
  mkdirSync(rootPath)
  return { sourceId: addSource(db, { rootPath, displayName: name }).id, rootPath }
}

/** Records `count` distinct pictures in a source and returns their asset ids. */
export function seedAssets(db: Catalog, sourceId: string, count: number, firstPicture = 1): string[] {
  return Array.from({ length: count }, (_, i) => {
    const n = firstPicture + i
    return recordAssetLocation(db, {
      sourceId,
      relativePath: `IMG_${String(n).padStart(4, '0')}.jpg`,
      sizeBytes: 1000 + n,
      mtimeMs: 1_700_000_000_000 + n,
      contentSha256: fakeSha(n),
      mediaType: 'image/jpeg',
      capturedAt: 1_700_000_000_000 + n * 1000,
      capturedAtSource: 'exif',
    }).assetId
  })
}
