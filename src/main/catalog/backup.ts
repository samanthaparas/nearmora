/**
 * Catalog backup and restore (AC11). A backup is a folder holding a verified copy of the catalog,
 * a manifest describing it, and a note that original photos are not included and need their own backup.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { z } from 'zod'
import { openCatalog, type Catalog, type OpenCatalogOptions } from './database'
import { CatalogError } from './errors'
import { MIGRATIONS } from './migrations'
import { latestVersion } from './migrate'
import { snapshotTo } from './snapshot'

const CATALOG_FILE = 'catalog.sqlite'
const MANIFEST_FILE = 'manifest.json'
const README_FILE = 'README.txt'

const README_TEXT = `This folder is a backup of your Nearmora catalog: your sources, favorites, review choices, albums and projects.

It does NOT contain your original photos. Nearmora never copies or moves them.
Back up your photo folders separately (for example with Time Machine).
`

const count = z.number().int().nonnegative()

/** Describes a backup. Validated on restore, so a damaged or foreign folder is rejected before anything is replaced. */
export const BackupManifest = z.object({
  format: z.literal('nearmora-catalog-backup'),
  formatVersion: z.literal(1),
  appVersion: z.string(),
  schemaVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  originalPhotosIncluded: z.literal(false),
  counts: z.object({
    sources: count,
    assets: count,
    favorites: count,
    similaritySets: count,
    albums: count,
    projects: count,
  }),
  // Listed so a restore can explain which photo folders it expects to find.
  sources: z.array(z.object({ displayName: z.string(), rootPath: z.string() })),
})
export type BackupManifest = z.infer<typeof BackupManifest>

interface VerifiedCopy {
  schemaVersion: number
  counts: BackupManifest['counts']
  sources: BackupManifest['sources']
}

// Opens a catalog file read-only and proves it's intact: SQLite's own page check plus a foreign-key check.
function verifyCatalogFile(file: string): VerifiedCopy {
  let db: Database.Database
  try {
    db = new Database(file, { readonly: true, fileMustExist: true })
  } catch (cause: unknown) {
    throw new CatalogError('INVALID_BACKUP', 'Catalog file is missing or unreadable', { cause })
  }
  try {
    const integrity = db.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new CatalogError('INVALID_BACKUP', `Integrity check failed: ${String(integrity)}`)
    if ((db.pragma('foreign_key_check') as unknown[]).length > 0) {
      throw new CatalogError('INVALID_BACKUP', 'Catalog has rows pointing at missing rows')
    }
    const countRows = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
    return {
      schemaVersion: db.pragma('user_version', { simple: true }) as number,
      counts: {
        sources: countRows('source'),
        assets: countRows('asset'),
        favorites: countRows('favorite'),
        similaritySets: countRows('similarity_set'),
        albums: countRows('album'),
        projects: countRows('project'),
      },
      sources: db
        .prepare('SELECT display_name AS displayName, root_path AS rootPath FROM source ORDER BY display_name')
        .all() as BackupManifest['sources'],
    }
  } catch (cause: unknown) {
    // A damaged file can also make SQLite throw outright (SQLITE_CORRUPT, SQLITE_NOTADB) rather than report problems.
    if (cause instanceof CatalogError) throw cause
    throw new CatalogError('INVALID_BACKUP', 'Catalog file is damaged', { cause })
  } finally {
    db.close()
  }
}

// Creates a new, uniquely named folder. It never reuses or overwrites an existing one.
function createUniqueFolder(parent: string, baseName: string): string {
  for (let attempt = 1; attempt < 100; attempt++) {
    const folder = join(parent, attempt === 1 ? baseName : `${baseName} (${attempt})`)
    try {
      mkdirSync(folder)
      return folder
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') continue
      throw error
    }
  }
  throw new CatalogError('CONFLICT', `Too many backups named "${baseName}"`)
}

const pad = (n: number): string => String(n).padStart(2, '0')

export interface BackupOptions {
  destinationDir: string
  appVersion: string
  now?: Date
}

export interface BackupResult {
  folder: string
  manifest: BackupManifest
}

export async function backupCatalog(db: Catalog, options: BackupOptions): Promise<BackupResult> {
  const now = options.now ?? new Date()
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`
  const folder = createUniqueFolder(options.destinationDir, `Nearmora catalog backup ${stamp}`)
  const partial = join(folder, `${CATALOG_FILE}.partial`)
  const written: string[] = [partial]

  try {
    await snapshotTo(db, partial)
    // The manifest describes the copy as it actually is, not the live catalog.
    const verified = verifyCatalogFile(partial)
    const manifest: BackupManifest = {
      format: 'nearmora-catalog-backup',
      formatVersion: 1,
      appVersion: options.appVersion,
      schemaVersion: verified.schemaVersion,
      createdAt: now.toISOString(),
      originalPhotosIncluded: false,
      counts: verified.counts,
      sources: verified.sources,
    }

    const finalFile = join(folder, CATALOG_FILE)
    renameSync(partial, finalFile)
    written.push(finalFile)
    writeFileSync(join(folder, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
    written.push(join(folder, MANIFEST_FILE))
    writeFileSync(join(folder, README_FILE), README_TEXT, { flag: 'wx' })
    return { folder, manifest }
  } catch (error: unknown) {
    // Clean up only the files this call wrote, then the folder it created, so a failed backup leaves nothing behind.
    for (const file of written) rmSync(file, { force: true })
    rmdirSync(folder)
    throw error
  }
}

/** Reads and checks a backup folder without changing anything. */
export function inspectBackup(folder: string): BackupManifest {
  let manifest: BackupManifest
  try {
    manifest = BackupManifest.parse(JSON.parse(readFileSync(join(folder, MANIFEST_FILE), 'utf8')))
  } catch (cause: unknown) {
    throw new CatalogError('INVALID_BACKUP', 'Missing or unreadable backup manifest', { cause })
  }

  const verified = verifyCatalogFile(join(folder, CATALOG_FILE))
  if (verified.schemaVersion !== manifest.schemaVersion || JSON.stringify(verified.counts) !== JSON.stringify(manifest.counts)) {
    throw new CatalogError('INVALID_BACKUP', 'Backup contents do not match its manifest')
  }
  if (manifest.schemaVersion > latestVersion(MIGRATIONS)) {
    throw new CatalogError('CATALOG_TOO_NEW', `Backup is schema v${manifest.schemaVersion}, newer than this app`)
  }
  return manifest
}

/**
 * Puts a verified catalog file in place of the current one. The current catalog must be closed first.
 * The copy goes to a temporary name and is renamed in one step, so a crash never leaves a half-copied catalog.
 */
export function replaceCatalogFile(sourceFile: string, catalogFile: string): void {
  verifyCatalogFile(sourceFile)
  const temporary = `${catalogFile}.restoring`
  rmSync(temporary, { force: true })
  copyFileSync(sourceFile, temporary)
  // Leftover WAL files belong to the catalog being replaced and must not be applied to the restored one.
  rmSync(`${catalogFile}-wal`, { force: true })
  rmSync(`${catalogFile}-shm`, { force: true })
  renameSync(temporary, catalogFile)
}

export interface RestoreOptions extends OpenCatalogOptions {
  /** If set and a catalog already exists, it's copied here first, so a restore can itself be undone. */
  safetyCopyDir?: string
}

export interface RestoreResult {
  catalog: Catalog
  manifest: BackupManifest
  safetyCopy?: string
}

/** Restores a backup folder over `catalogFile` (which must be closed), then opens and migrates it. */
export async function restoreCatalogBackup(folder: string, catalogFile: string, options: RestoreOptions = {}): Promise<RestoreResult> {
  const manifest = inspectBackup(folder)

  let safetyCopy: string | undefined
  if (options.safetyCopyDir && existsSync(catalogFile)) {
    mkdirSync(options.safetyCopyDir, { recursive: true })
    safetyCopy = join(options.safetyCopyDir, `catalog-prerestore-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`)
    const current = new Database(catalogFile, { readonly: true })
    try {
      await snapshotTo(current, safetyCopy)
    } finally {
      current.close()
    }
  }

  replaceCatalogFile(join(folder, CATALOG_FILE), catalogFile)
  const openOptions: OpenCatalogOptions = {}
  if (options.backupDir) openOptions.backupDir = options.backupDir
  if (options.migrations) openOptions.migrations = options.migrations
  const catalog = await openCatalog(catalogFile, openOptions)
  return safetyCopy ? { catalog, manifest, safetyCopy } : { catalog, manifest }
}
