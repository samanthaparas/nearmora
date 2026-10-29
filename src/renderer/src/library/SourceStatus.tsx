/**
 * One folder's status line, with the action that fits its state: pause or cancel a scan, resume a paused one,
 * reconnect a drive, retry after fixing permissions, or (on the Sources screen) remove it from Nearmora.
 * Every state has its own wording and a next step, never just a colour.
 */

import { useState } from 'react'
import type { CommandOutput, ScanCounts, SourceSummary } from '@shared/ipc-contract'
import { describePictures, describeProgress, describeSkipped } from './scan-text'

type Impact = CommandOutput<'sources:removeImpact'>

const RECONNECT_MESSAGES: Record<CommandOutput<'sources:reconnect'>['result'], string | null> = {
  reconnected: null,
  unavailable: 'Still not found. Connect the drive or put the folder back where it was, then try again.',
  permission_denied: 'The folder is back, but Nearmora isn’t allowed to read it. Check its permissions, then try again.',
  different_folder: 'A folder is there, but its photos don’t match the ones Nearmora saw before, so it wasn’t reconnected. Nothing was changed.',
}

function describeState(source: SourceSummary, counts: ScanCounts | null): string {
  if (source.scanning) return counts ? `Scanning: ${describeProgress(counts)}` : 'Scanning…'
  switch (source.status) {
    case 'disconnected':
      return 'Not connected. Its photos show from saved previews and come back fully when it’s reconnected.'
    case 'permission_denied':
      return 'Nearmora can’t read this folder. Check that your account can open it, then try again.'
    default:
      break
  }
  if (source.lastScanState === 'paused') return `Scan paused · ${describePictures(source)} so far`
  if (source.lastScanState === 'cancelled') return `Scan cancelled · ${describePictures(source)} so far`
  if (source.lastScanState === 'failed') return `The last scan didn’t finish · ${describePictures(source)}`
  return describePictures(source)
}

export function SourceStatus({ source, counts, onChanged, allowRemove = false }: {
  source: SourceSummary
  counts: ScanCounts | null
  onChanged: () => void
  allowRemove?: boolean
}) {
  const [message, setMessage] = useState<string | null>(null)
  const [impact, setImpact] = useState<Impact | null>(null)
  const id = { sourceId: source.id }
  const skipped = !source.scanning && counts ? describeSkipped(counts) : null

  // Runs an action, then refreshes the screen. Failures get a plain message; nothing is ever partly done.
  async function run(action: () => Promise<string | null>) {
    setMessage(null)
    try {
      setMessage(await action())
    } catch {
      setMessage('Something went wrong. Nothing was changed.')
    }
    onChanged()
  }

  const reconnect = () =>
    run(async () => {
      const result = await window.nearmora.reconnectSource(id)
      return result.ok ? RECONNECT_MESSAGES[result.data.result] : 'Something went wrong. Nothing was changed.'
    })
  const pause = () =>
    run(async () => {
      await window.nearmora.pauseScan(id)
      return null
    })
  const cancel = () =>
    run(async () => {
      await window.nearmora.cancelScan(id)
      return null
    })
  const rescan = (doneMessage: string | null) =>
    run(async () => ((await window.nearmora.rescanSource(id)).ok ? doneMessage : 'The scan couldn’t start.'))

  async function reviewRemoval() {
    const result = await window.nearmora.sourceRemovalImpact(id)
    if (result.ok) setImpact(result.data)
    else setMessage('Something went wrong. Nothing was changed.')
  }

  return (
    <li className="library__source">
      <p className="library__source-line">
        <strong>{source.displayName}</strong> · {describeState(source, counts)}
      </p>

      <div className="library__source-actions">
        {source.scanning ? (
          <>
            <button type="button" className="button button--quiet" onClick={() => void pause()}>
              Pause scan
            </button>
            <button type="button" className="button button--quiet" onClick={() => void cancel()}>
              Cancel scan
            </button>
          </>
        ) : source.status === 'disconnected' ? (
          <button type="button" className="button button--quiet" onClick={() => void reconnect()}>
            Reconnect
          </button>
        ) : source.status === 'permission_denied' ? (
          <button type="button" className="button button--quiet" onClick={() => void rescan(null)}>
            Try again
          </button>
        ) : source.lastScanState === 'paused' || source.lastScanState === 'cancelled' || source.lastScanState === 'failed' ? (
          <button type="button" className="button button--quiet" onClick={() => void rescan(null)}>
            Resume scan
          </button>
        ) : allowRemove ? (
          <button type="button" className="button button--quiet" onClick={() => void rescan(null)}>
            Rescan
          </button>
        ) : null}
        {allowRemove && !source.scanning && !impact ? (
          <button type="button" className="button button--quiet" onClick={() => void reviewRemoval()}>
            Remove from Nearmora…
          </button>
        ) : null}
      </div>

      {skipped ? <p className="library__skipped">{skipped}</p> : null}
      {message ? (
        <p className="library__skipped" role="alert">
          {message}
        </p>
      ) : null}

      {/* The impact is shown before anything is removed, and the default choice keeps the folder. */}
      {impact ? (
        <div className="library__confirm" role="group" aria-labelledby={`remove-${source.id}`}>
          <p id={`remove-${source.id}`} className="library__confirm-title">
            Remove “{source.displayName}” from Nearmora?
          </p>
          <p className="library__skipped">
            Nearmora will forget {impact.photoFiles} {impact.photoFiles === 1 ? 'file' : 'files'} in this folder.{' '}
            {impact.picturesOnlyHere > 0
              ? `${impact.picturesOnlyHere} ${impact.picturesOnlyHere === 1 ? 'photo is' : 'photos are'} only here and will leave the Library` +
                (impact.favoritesOnlyHere > 0 ? `, including ${impact.favoritesOnlyHere} ${impact.favoritesOnlyHere === 1 ? 'favorite' : 'favorites'}` : '') +
                (impact.albumsAffected > 0 ? `, and ${impact.albumsAffected} ${impact.albumsAffected === 1 ? 'album loses' : 'albums lose'} photos` : '') +
                '. Your choices are kept and come back if you add the folder again. '
              : ''}
            The files themselves stay exactly where they are.
          </p>
          <div className="library__source-actions">
            <button type="button" className="button button--secondary" autoFocus onClick={() => setImpact(null)}>
              Keep folder
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() =>
                void run(async () => {
                  const result = await window.nearmora.removeSource(id)
                  setImpact(null)
                  return result.ok && result.data.removed ? null : 'It couldn’t be removed right now. Nothing was changed.'
                })
              }
            >
              Remove from Nearmora
            </button>
          </div>
        </div>
      ) : null}
    </li>
  )
}
