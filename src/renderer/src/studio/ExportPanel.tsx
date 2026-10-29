/**
 * The Export section of a project (AC7, AC8): what will be made (format, size, number of files), a reminder that
 * exporting creates new files and publishes nothing, progress with Cancel, and the result with "Show in Finder".
 * The destination is chosen in the macOS dialog that main opens; this screen never sees a path.
 */

import { useEffect, useState } from 'react'
import type { MainEvent } from '@shared/ipc-contract'

type ExportState =
  | { kind: 'idle' }
  | { kind: 'running'; jobId: string; done: number; total: number }
  | { kind: 'done'; jobId: string; folderName: string; total: number }
  | { kind: 'message'; text: string }

const FAILURES: Record<string, string> = {
  disk_full: 'The destination ran out of space. Nothing was left behind; free some space or choose another place, then export again.',
  unreadable: 'A photo couldn’t be read while exporting. Nothing was left behind; check the photo’s folder is connected and try again.',
  verify_failed: 'The exported files didn’t pass their final check, so they were removed. Please try again.',
  failed: 'The export couldn’t be finished. Nothing was left behind; please try again.',
}

const REFUSALS = {
  unavailable: (files: string[]) => `Some photos can’t be reached: ${files.join(', ')}. Reconnect their folder, then export.`,
  changed: (files: string[]) =>
    `These photos changed since Nearmora last saw them, so they weren’t used: ${files.join(', ')}. Rescan their folder, check the project, then export.`,
  inside_source: () => 'That folder is inside one of your photo folders. Choose a place outside them, so exports never mix with your originals.',
  app_data: () => 'That folder is part of Nearmora’s own data. Choose another place.',
  unwritable: () => 'Nearmora can’t write to that folder. Choose another place.',
}

export function ExportPanel({ projectId, summary, blocked }: { projectId: string; summary: string; blocked: boolean }) {
  const [state, setState] = useState<ExportState>({ kind: 'idle' })

  // Follows this export's progress events from main.
  useEffect(
    () =>
      window.nearmora.onEvent((event: MainEvent) => {
        if (event.type !== 'export' || event.projectId !== projectId) return
        setState((current) => {
          // jobId '' means "started, id not known yet": a quick export can finish before start() returns.
          if (current.kind !== 'running' || (current.jobId !== '' && current.jobId !== event.jobId)) return current
          if (event.state === 'running') return { ...current, done: event.done, total: event.total }
          if (event.state === 'done') return { kind: 'done', jobId: event.jobId, folderName: event.folderName ?? '', total: event.total }
          if (event.state === 'cancelled') return { kind: 'message', text: 'Export cancelled. Nothing was left behind.' }
          return { kind: 'message', text: FAILURES[event.reason ?? 'failed'] ?? FAILURES['failed']! }
        })
      }),
    [projectId],
  )

  async function start() {
    setState({ kind: 'running', jobId: '', done: 0, total: 0 })
    const result = await window.nearmora.startExport({ projectId })
    if (!result.ok) return setState({ kind: 'message', text: FAILURES['failed']! })
    const data = result.data
    if (data.status === 'cancelled') return setState({ kind: 'idle' })
    if (data.status === 'refused') return setState({ kind: 'message', text: REFUSALS[data.reason](data.files ?? []) })
    // Fill in the job id, unless the export already finished (its event arrived first).
    setState((current) => (current.kind === 'running' ? { ...current, jobId: data.jobId, total: Math.max(current.total, data.fileCount) } : current))
  }

  return (
    <section className="library__confirm" aria-labelledby="export-title" role="region">
      <h3 id="export-title" className="library__confirm-title">
        Export
      </h3>
      <p className="review__note">
        {summary}. Exporting creates new files in a new folder you choose. It doesn’t change your photos, publish or share anything, and photo details
        like location are left out.
      </p>
      <div className="library__source-actions" aria-live="polite">
        {state.kind === 'running' ? (
          <>
            <span>
              Exporting {state.done} of {state.total}…
            </span>
            {state.jobId ? (
              <button type="button" className="button button--quiet" onClick={() => void window.nearmora.cancelExport({ jobId: state.jobId })}>
                Cancel export
              </button>
            ) : null}
          </>
        ) : (
          <button type="button" className="button button--primary" disabled={blocked} onClick={() => void start()}>
            Export…
          </button>
        )}
        {state.kind === 'done' ? (
          <>
            <span>
              Exported {state.total} {state.total === 1 ? 'file' : 'files'} to “{state.folderName}”.
            </span>
            <button type="button" className="button button--quiet" onClick={() => void window.nearmora.revealExport({ jobId: state.jobId })}>
              Show in Finder
            </button>
          </>
        ) : null}
        {state.kind === 'message' ? <span role="alert">{state.text}</span> : null}
        {blocked && state.kind === 'idle' ? <span className="review__note">Reconnect the offline photos to export.</span> : null}
      </div>
    </section>
  )
}
