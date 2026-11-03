/**
 * Runs exports for the IPC handlers: one at a time per project, with cancel, progress events for the UI, and the
 * finished folders it may reveal in Finder. The UI never sees or sends a path; it only knows job ids.
 */

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { MainEvent } from '@shared/ipc-contract'
import type { Catalog } from '../catalog/database'
import type { RenderRequest, RenderResult } from '../media/render-export'
import { planFiles, prepareExport, runExport, type ExportRefusal } from './export'

export function createExportService(deps: {
  db: Catalog
  appDataDir: string
  render: (request: RenderRequest) => Promise<RenderResult>
  emit: (event: MainEvent) => void
}) {
  const running = new Map<string, AbortController>()
  const finished = new Map<string, string>() // job id → finished folder, for "Show in Finder"

  return {
    /** Checks first; if all is well, starts the export in the background and returns its job id. */
    async start(projectId: string, destinationDir: string): Promise<{ status: 'started'; jobId: string; fileCount: number } | ExportRefusal> {
      const prepared = await prepareExport(deps.db, { projectId, destinationDir, appDataDir: deps.appDataDir })
      if (prepared.status === 'refused') return prepared
      const { plan } = prepared
      const controller = new AbortController()
      const jobId = randomUUID()
      running.set(jobId, controller)
      void runExport({ db: deps.db, render: deps.render }, plan, {
        jobId,
        signal: controller.signal,
        onProgress: (done, total) => deps.emit({ type: 'export', jobId, projectId, state: 'running', done, total }),
      })
        .then((outcome) => {
          const total = planFiles(plan).length
          if (outcome.status === 'done') {
            finished.set(jobId, outcome.folder)
            deps.emit({ type: 'export', jobId, projectId, state: 'done', done: total, total, folderName: basename(outcome.folder) })
          } else if (outcome.status === 'cancelled') deps.emit({ type: 'export', jobId, projectId, state: 'cancelled', done: 0, total })
          else deps.emit({ type: 'export', jobId, projectId, state: 'failed', done: 0, total, reason: outcome.reason })
        })
        .finally(() => running.delete(jobId))
      return { status: 'started', jobId, fileCount: planFiles(plan).length }
    },
    cancel(jobId: string): boolean {
      const controller = running.get(jobId)
      controller?.abort()
      return controller !== undefined
    },
    finishedFolder: (jobId: string): string | undefined => finished.get(jobId),
    cancelAll(): void {
      for (const controller of running.values()) controller.abort()
    },
  }
}

export type ExportService = ReturnType<typeof createExportService>
