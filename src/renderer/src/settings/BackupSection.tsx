/**
 * Settings → Backup (AC11): back up the catalog to a folder the person picks, see the last backup, and restore from a
 * backup after seeing what's in it and a clear warning. A restore happens on restart, before the catalog opens, keeps
 * a copy of the catalog it replaces, and can be undone. Photos themselves are never in a backup, and it says so.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'

type Status = CommandOutput<'backup:status'>
type Chosen = Extract<CommandOutput<'backup:choose'>, { status: 'ready' }>
type Counts = Chosen['counts']

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const describeCounts = (c: Partial<Counts>) =>
  [
    plural(c.sources ?? 0, 'photo folder', 'photo folders'),
    plural(c.assets ?? 0, 'photo', 'photos'),
    plural(c.favorites ?? 0, 'favorite', 'favorites'),
    plural(c.albums ?? 0, 'album', 'albums'),
    plural(c.projects ?? 0, 'project', 'projects'),
  ].join(', ')

const REFUSED: Record<'inside_source' | 'app_data' | 'unwritable', string> = {
  inside_source: 'That folder is inside one of your photo folders. Choose a place outside them.',
  app_data: 'That folder is part of Nearmora’s own data. Choose another place, ideally another drive.',
  unwritable: 'Nearmora can’t write to that folder. Choose another place.',
}

export function BackupSection() {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Chosen | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => window.nearmora.backupStatus().then((result) => setStatus(result.ok ? result.data : null)), [])
  useEffect(() => {
    void load()
  }, [load])

  async function backUp() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.nearmora.createBackup()
      if (!result.ok) return setMessage('The backup couldn’t be made. Nothing was changed.')
      const data = result.data
      if (data.status === 'refused') return setMessage(REFUSED[data.reason])
      if (data.status === 'done') setMessage(`Backed up to “${data.folderName}”: ${describeCounts(data.counts)}.`)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function choose() {
    setMessage(null)
    setChosen(null)
    const result = await window.nearmora.chooseBackup()
    if (!result.ok) return setMessage('That folder couldn’t be checked. Nothing was changed.')
    const data = result.data
    if (data.status === 'invalid') {
      setMessage(
        data.reason === 'too_new'
          ? 'That backup was made by a newer Nearmora, so this version can’t restore it. Nothing was changed.'
          : 'That folder isn’t a Nearmora catalog backup, or the backup is damaged. Nothing was changed.',
      )
    } else if (data.status === 'ready') setChosen(data)
  }

  async function restore() {
    if (!chosen) return
    const result = await window.nearmora.restoreBackup({ token: chosen.token })
    if (!result.ok || result.data.status !== 'restarting') {
      setChosen(null)
      setMessage('That backup has to be chosen again before restoring. Nothing was changed.')
    }
  }

  async function undo() {
    const result = await window.nearmora.undoRestore()
    if (!result.ok || result.data.status !== 'restarting') setMessage('The catalog from before the restore isn’t available any more.')
  }

  return (
    <section className="moments" aria-labelledby="backup-title">
      <h2 id="backup-title" className="moments__title">
        Backup
      </h2>

      {/* Said once, after the restart that applied (or couldn't apply) a restore. */}
      {status?.startup === 'restored' && status.restored ? (
        <div className="library__confirm" role="status">
          <p className="library__confirm-title">Restored the catalog from the backup made on {when.format(new Date(status.restored.backupMadeAt))}.</p>
          {status.restored.missingFolders.length > 0 ? (
            <p className="review__note">
              These photo folders aren’t on this Mac: {status.restored.missingFolders.join(', ')}. Their photos show as offline until you reconnect them in
              Sources. They aren’t in the backup.
            </p>
          ) : null}
        </div>
      ) : status?.startup === 'undone' ? (
        <p className="library__confirm" role="status">
          The restore was undone. Your catalog is back as it was before it.
        </p>
      ) : status?.startup === 'failed' ? (
        <p className="library__confirm" role="alert">
          The backup couldn’t be restored, so your catalog wasn’t changed.
        </p>
      ) : null}

      <p>
        A backup keeps your folders, favorites, choices, albums, projects and templates. <strong>It doesn’t include your photos</strong>: back up your
        photo folders separately, for example with Time Machine.
      </p>
      <p className="review__note">
        {status?.lastBackup
          ? `Last backup: ${when.format(new Date(status.lastBackup.at))}, “${status.lastBackup.folderName}”.`
          : 'No backup made from this Mac yet.'}
      </p>
      <div className="library__source-actions">
        <button type="button" className="button button--secondary" disabled={busy} onClick={() => void backUp()}>
          {busy ? 'Backing up…' : 'Back up the catalog…'}
        </button>
        <button type="button" className="button button--quiet" onClick={() => void choose()}>
          Restore from a backup…
        </button>
      </div>
      <p className="library__skipped" aria-live="polite">
        {message}
      </p>

      {chosen ? (
        <div className="library__confirm" role="group" aria-labelledby="restore-title">
          <p id="restore-title" className="library__confirm-title">
            Restore the backup made on {when.format(new Date(chosen.madeAt))}?
          </p>
          <p className="review__note">
            It holds {describeCounts(chosen.counts)} (made with Nearmora {chosen.appVersion}).
            {chosen.missingFolders.length > 0 ? ` These photo folders from it aren’t on this Mac: ${chosen.missingFolders.join(', ')}.` : ''}
          </p>
          <p>
            Restoring replaces everything in Nearmora now with this backup. A copy of your current catalog is kept first, so you can undo it. Nearmora
            restarts to restore. Your photos aren’t changed.
          </p>
          <div className="library__source-actions">
            <button type="button" className="button button--secondary" autoFocus onClick={() => setChosen(null)}>
              Cancel
            </button>
            <button type="button" className="button button--quiet" onClick={() => void restore()}>
              Restore and restart
            </button>
          </div>
        </div>
      ) : null}

      {status?.restored ? (
        <div className="library__source-actions">
          <button type="button" className="button button--quiet" onClick={() => void undo()}>
            Undo restore…
          </button>
          <span className="review__note">Puts back the catalog from just before the restore; changes made since it are lost. Nearmora restarts.</span>
        </div>
      ) : null}
    </section>
  )
}
