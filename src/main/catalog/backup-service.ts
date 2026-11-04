/**
 * Backup and restore for the Settings screen. Main opens the folder pickers, so the UI never sends or sees a path:
 * a backup chosen for restoring is checked here and given a one-time token, and restoring with that token schedules
 * the restore and restarts the app (see restore-on-start.ts).
 */

import { randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, realpathSync } from 'node:fs'
import { basename } from 'node:path'
import type { Catalog } from './database'
import { backupCatalog, inspectBackup } from './backup'
import { CatalogError } from './errors'
import { checkSourceReachability, listSources } from './repositories/sources'
import { lastBackup, lastRestore, recordBackup, scheduleRestore, scheduleUndo, type StartupOutcome } from './restore-on-start'
import { isSameOrInside } from '../library/source-folders'

export interface BackupServiceDeps {
  db: Catalog
  appDataDir: string
  appVersion: string
  /** What happened to a scheduled restore when the app started. */
  startup: StartupOutcome
  /** Restarts the app so a scheduled restore or undo is applied before the catalog opens. */
  restart: () => void
}

type Counts = { sources: number; assets: number; favorites: number; similaritySets: number; albums: number; projects: number }

export function createBackupService(deps: BackupServiceDeps) {
  // Backups chosen for restoring, by one-time token. The path stays here in main.
  const chosen = new Map<string, string>()

  return {
    status() {
      const restore = lastRestore(deps.appDataDir)
      return {
        lastBackup: lastBackup(deps.appDataDir),
        // After a restore: which of the restored catalog's photo folders aren't on this Mac (AC11), and whether the
        // catalog from before it can still be put back.
        restored: restore
          ? {
              backupMadeAt: restore.backupMadeAt,
              appVersion: restore.appVersion,
              missingFolders: checkSourceReachability(deps.db)
                .filter((s) => !s.reachable)
                .map((s) => s.source.displayName),
            }
          : null,
        startup: deps.startup?.kind ?? null,
      }
    },

    /** Writes a new, dated backup folder into `destination`, never inside a photo folder or Nearmora's own data. */
    async create(destination: string): Promise<{ status: 'done'; folderName: string; counts: Counts } | { status: 'refused'; reason: 'inside_source' | 'app_data' | 'unwritable' }> {
      let target: string
      try {
        target = realpathSync.native(destination)
        accessSync(target, constants.W_OK)
      } catch {
        return { status: 'refused', reason: 'unwritable' }
      }
      if (isSameOrInside(realpathSync.native(deps.appDataDir), target)) return { status: 'refused', reason: 'app_data' }
      // Folders are compared by their real paths, so two spellings of one place (a link, /var and /private/var) match.
      const real = (path: string) => {
        try {
          return realpathSync.native(path)
        } catch {
          return path
        }
      }
      if (listSources(deps.db).some((s) => isSameOrInside(real(s.rootPath), target))) return { status: 'refused', reason: 'inside_source' }
      const { folder, manifest } = await backupCatalog(deps.db, { destinationDir: target, appVersion: deps.appVersion })
      recordBackup(deps.appDataDir, basename(folder), manifest)
      return { status: 'done', folderName: basename(folder), counts: manifest.counts }
    },

    /** Checks a folder chosen for restoring, without changing anything, and describes it. */
    inspect(folder: string) {
      try {
        const manifest = inspectBackup(folder)
        const token = randomUUID()
        chosen.set(token, folder)
        return {
          status: 'ready' as const,
          token,
          madeAt: manifest.createdAt,
          appVersion: manifest.appVersion,
          counts: manifest.counts,
          missingFolders: manifest.sources.filter((s) => !existsSync(s.rootPath)).map((s) => s.displayName),
        }
      } catch (error: unknown) {
        return { status: 'invalid' as const, reason: error instanceof CatalogError && error.code === 'CATALOG_TOO_NEW' ? ('too_new' as const) : ('damaged' as const) }
      }
    },

    restore(token: string): boolean {
      const folder = chosen.get(token)
      if (!folder) return false
      chosen.clear()
      scheduleRestore(deps.appDataDir, folder)
      deps.restart()
      return true
    },

    undoRestore(): boolean {
      if (!lastRestore(deps.appDataDir)) return false
      scheduleUndo(deps.appDataDir)
      deps.restart()
      return true
    },
  }
}

export type BackupService = ReturnType<typeof createBackupService>
