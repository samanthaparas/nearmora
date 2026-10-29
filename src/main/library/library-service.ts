/**
 * Coordinates the Library for the IPC handlers: adding folders, running one scan per source,
 * cancelling, and pushing progress to the UI. It holds no UI code and no file paths from the renderer.
 */

import type { MainEvent, ScanCounts, SourceSummary } from '@shared/ipc-contract'
import type { Catalog } from '../catalog/database'
import { listSources, type Source } from '../catalog/repositories/sources'
import type { ProcessImageRequest, ProcessImageResult } from '../media/process-image'
import { lastScanCounts, scanSource } from './scan'
import { addSourceFolder, type AddFolderResult } from './source-folders'

export interface LibraryServiceDeps {
  db: Catalog
  appDataDir: string
  thumbnailsDir: string
  processImage: (request: ProcessImageRequest) => Promise<ProcessImageResult>
  emit: (event: MainEvent) => void
}

export function createLibraryService(deps: LibraryServiceDeps) {
  const { db } = deps
  // One running scan per source; its controller lets the UI cancel it.
  const running = new Map<string, AbortController>()

  const countPictures = db.prepare(
    `SELECT COUNT(*) AS files, COUNT(DISTINCT asset_id) AS pictures
     FROM asset_location WHERE source_id = ? AND availability = 'available'`,
  )

  const summarize = (source: Source): SourceSummary => {
    const { files, pictures } = countPictures.get(source.id) as { files: number; pictures: number }
    return {
      id: source.id,
      displayName: source.displayName,
      status: source.status,
      lastScanAt: source.lastScanAt,
      lastScan: lastScanCounts(db, source.id),
      pictureCount: pictures,
      // Byte-identical copies show once in the grid, so they're reported separately.
      duplicateCount: files - pictures,
      scanning: running.has(source.id),
    }
  }

  function startScan(sourceId: string): boolean {
    if (running.has(sourceId)) return false
    const controller = new AbortController()
    running.set(sourceId, controller)
    const send = (state: MainEvent['state'], counts: ScanCounts) => deps.emit({ type: 'scan', sourceId, state, counts })

    void scanSource(deps, sourceId, { signal: controller.signal, onProgress: (counts) => send('running', counts) })
      .then(({ outcome, counts }) => send(outcome, counts))
      .catch((error: unknown) => {
        console.error('[library] scan crashed', error)
        send('failed', { found: 0, indexed: 0, unchanged: 0, unsupported: 0, corrupt: 0, tooLarge: 0, unreadable: 0 })
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
    listSources: (): SourceSummary[] => listSources(db).map(summarize),
    summarize,
    startScan,
    cancelScan(sourceId: string): boolean {
      const controller = running.get(sourceId)
      controller?.abort()
      return controller !== undefined
    },
    cancelAll(): void {
      for (const controller of running.values()) controller.abort()
    },
  }
}

export type LibraryService = ReturnType<typeof createLibraryService>
