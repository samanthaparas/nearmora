/**
 * Coordinates the Library for the IPC handlers: adding, reconnecting and removing folders, running one scan
 * per source with pause and cancel, and pushing progress to the UI. It holds no UI code and takes no paths from the UI.
 */

import type { MainEvent, ScanCounts, SourceSummary } from '@shared/ipc-contract'
import type { Catalog } from '../catalog/database'
import { CatalogError } from '../catalog/errors'
import { getSource, listSources, removeSource, setSourceStatus, sourceRemovalImpact, type RemovalImpact, type Source } from '../catalog/repositories/sources'
import type { ProcessImageRequest, ProcessImageResult } from '../media/process-image'
import { checkSourceIdentity } from './reconnect'
import { lastScan, PAUSE, rootAccess, scanSource } from './scan'
import { addSourceFolder, type AddFolderResult } from './source-folders'

export interface LibraryServiceDeps {
  db: Catalog
  appDataDir: string
  thumbnailsDir: string
  processImage: (request: ProcessImageRequest) => Promise<ProcessImageResult>
  emit: (event: MainEvent) => void
}

export type ReconnectResult = 'reconnected' | 'unavailable' | 'permission_denied' | 'different_folder'

const NO_COUNTS: ScanCounts = { found: 0, indexed: 0, unchanged: 0, unsupported: 0, corrupt: 0, tooLarge: 0, unreadable: 0 }

export function createLibraryService(deps: LibraryServiceDeps) {
  const { db } = deps
  // One running scan per source; its controller lets the UI pause or cancel it.
  const running = new Map<string, AbortController>()

  const countPictures = db.prepare(
    `SELECT COUNT(*) AS files, COUNT(DISTINCT asset_id) AS pictures
     FROM asset_location WHERE source_id = ? AND availability = 'available'`,
  )

  const summarize = (source: Source): SourceSummary => {
    const { files, pictures } = countPictures.get(source.id) as { files: number; pictures: number }
    const last = lastScan(db, source.id)
    return {
      id: source.id,
      displayName: source.displayName,
      status: source.status,
      lastScanAt: source.lastScanAt,
      lastScan: last?.counts ?? null,
      lastScanState: last?.state ?? null,
      pictureCount: pictures,
      // Byte-identical copies show once in the grid, so they're reported separately.
      duplicateCount: files - pictures,
      scanning: running.has(source.id),
    }
  }

  /**
   * Keeps statuses honest without a rescan: a folder that vanished becomes disconnected, and one whose permission
   * problem was fixed becomes active again. A disconnected folder stays so until `reconnect` verifies it.
   */
  function refreshStatuses(): void {
    for (const source of listSources(db)) {
      if (running.has(source.id) || source.status === 'disconnected' || source.status === 'removed') continue
      const access = rootAccess(source.rootPath)
      const status = access === 'ok' ? 'active' : access
      if (status !== source.status) setSourceStatus(db, source.id, status)
    }
  }

  function startScan(sourceId: string): boolean {
    if (running.has(sourceId)) return false
    if (getSource(db, sourceId).status === 'disconnected') return false
    const controller = new AbortController()
    running.set(sourceId, controller)
    const send = (state: MainEvent['state'], counts: ScanCounts) => deps.emit({ type: 'scan', sourceId, state, counts })

    void scanSource(deps, sourceId, { signal: controller.signal, onProgress: (counts) => send('running', counts) })
      .then(({ outcome, counts }) => send(outcome, counts))
      .catch((error: unknown) => {
        console.error('[library] scan crashed', error)
        send('failed', NO_COUNTS)
      })
      .finally(() => running.delete(sourceId))
    return true
  }

  return {
    /** Adds the folder the person picked in main's dialog, then scans it straight away. */
    addFolder(path: string): AddFolderResult {
      const result = addSourceFolder(db, path, deps.appDataDir)
      if (result.ok) startScan(result.source.id)
      return result
    },
    listSources(): SourceSummary[] {
      refreshStatuses()
      return listSources(db).map(summarize)
    },
    summarize,
    startScan,

    /** Brings back a disconnected folder only after checking it's the same one, then rescans it. */
    async reconnect(sourceId: string): Promise<ReconnectResult> {
      const source = getSource(db, sourceId)
      const access = rootAccess(source.rootPath)
      if (access === 'disconnected') return 'unavailable'
      if (access === 'permission_denied') {
        setSourceStatus(db, sourceId, 'permission_denied')
        return 'permission_denied'
      }
      if ((await checkSourceIdentity(db, sourceId)) === 'different') return 'different_folder'
      setSourceStatus(db, sourceId, 'active')
      startScan(sourceId)
      return 'reconnected'
    },

    removalImpact: (sourceId: string): RemovalImpact => sourceRemovalImpact(db, sourceId),

    /** Forgets a folder (catalog rows only). Refused while it's scanning, so a scan never writes to a removed source. */
    remove(sourceId: string): boolean {
      if (running.has(sourceId)) return false
      try {
        removeSource(db, sourceId)
        return true
      } catch (error: unknown) {
        if (error instanceof CatalogError && error.code === 'NOT_FOUND') return false
        throw error
      }
    },

    pauseScan(sourceId: string): boolean {
      const controller = running.get(sourceId)
      controller?.abort(PAUSE)
      return controller !== undefined
    },
    cancelScan(sourceId: string): boolean {
      const controller = running.get(sourceId)
      controller?.abort()
      return controller !== undefined
    },
    /** On quit: pause rather than cancel, so the next launch offers to resume. */
    pauseAll(): void {
      for (const controller of running.values()) controller.abort(PAUSE)
    },
  }
}

export type LibraryService = ReturnType<typeof createLibraryService>
