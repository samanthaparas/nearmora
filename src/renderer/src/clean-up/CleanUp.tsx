/**
 * The Clean up screen (ADR-0019): photos marked "Don't need", exact duplicates with a chosen copy that stays, and one
 * review step that moves them to the Trash or, only if the person picks it, deletes them forever. The person chooses
 * every photo; main re-checks each file and asks again natively before deleting forever. This screen never sees a path.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import './CleanUp.css'

type Unneeded = CommandOutput<'cleanup:unneeded'>
type Duplicates = CommandOutput<'cleanup:duplicates'>
type Removal = CommandOutput<'cleanup:remove'>
type Refusal = Extract<Removal, { status: 'done' }>['refused'][number]

const REASONS: Record<Refusal['reason'], string> = {
  offline: 'its folder isn’t connected',
  missing: 'it’s no longer in its folder',
  changed: 'it changed since Nearmora last scanned it',
  not_a_file: 'it isn’t an ordinary photo file',
  outside_folder: 'it isn’t inside the folder you added',
  last_copy: 'it’s the last copy of that photo',
  failed: 'macOS couldn’t remove it',
}

const size = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`
const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`
const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** One sentence per outcome, so the person knows exactly what happened and what was left alone. */
function describe(result: Removal): string[] {
  if (result.status === 'cancelled') return ['Nothing was deleted.']
  if (result.status === 'busy') return ['A folder is being scanned. Nothing was removed; try again when the scan finishes.']
  const lines: string[] = []
  if (result.removed > 0) {
    lines.push(
      result.mode === 'trash'
        ? `Moved ${files(result.removed)} (${size(result.bytes)}) to the Trash. You can put them back from the Trash in Finder.`
        : `Deleted ${files(result.removed)} (${size(result.bytes)}) forever.`,
    )
  } else lines.push('Nothing was removed.')
  for (const r of result.refused) lines.push(`Left alone: ${r.fileName} in ${r.folderName}, because ${REASONS[r.reason]}.`)
  for (const b of result.blocked) lines.push(`Kept ${b.fileName}: it’s used in ${b.projects.map((p) => `“${p}”`).join(', ')}.`)
  return lines
}

export function CleanUp() {
  const [unneeded, setUnneeded] = useState<Unneeded | null>(null)
  const [duplicates, setDuplicates] = useState<Duplicates | null>(null)
  const [history, setHistory] = useState<CommandOutput<'cleanup:history'>>([])
  const [loadError, setLoadError] = useState(false)
  // Duplicates: which groups the person chose to clear, and which copy stays in each (the first copy unless changed).
  const [chosenGroups, setChosenGroups] = useState<ReadonlySet<string>>(new Set())
  const [keeper, setKeeper] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'trash' | 'forever'>('trash')
  const [working, setWorking] = useState(false)
  const [outcome, setOutcome] = useState<string[] | null>(null)

  // Like the Library, state is set only when the replies arrive, never synchronously inside the effect.
  const load = useCallback(
    () =>
      Promise.all([window.nearmora.listUnneeded(), window.nearmora.listDuplicates(), window.nearmora.removalHistory()]).then(([u, d, h]) => {
        if (!u.ok || !d.ok || !h.ok) {
          setLoadError(true)
          return
        }
        setUnneeded(u.data)
        setDuplicates(d.data)
        setHistory(h.data)
        // Choices for groups that no longer exist are dropped, so nothing stale is ever sent.
        const present = new Set(d.data.groups.map((g) => g.assetId))
        setChosenGroups((current) => new Set([...current].filter((id) => present.has(id))))
      }),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

  // What the review would remove: marked photos not held by a project, and every copy except the one that stays.
  const removable = useMemo(() => unneeded?.items.filter((item) => item.usedIn.length === 0) ?? [], [unneeded])
  // A photo marked "Don't need" loses every copy anyway, so its group adds nothing here (and isn't counted twice).
  const extraCopies = useMemo(
    () =>
      (duplicates?.groups ?? [])
        .filter((group) => chosenGroups.has(group.assetId) && !removable.some((item) => item.assetId === group.assetId))
        .flatMap((group) => {
          const stays = keeper[group.assetId] ?? group.copies[0]?.locationId
          return group.copies.filter((copy) => copy.locationId !== stays)
        }),
    [duplicates, chosenGroups, keeper, removable],
  )
  const fileCount = removable.reduce((n, item) => n + item.files, 0) + extraCopies.length
  const byteCount = removable.reduce((n, item) => n + item.bytes, 0) + extraCopies.reduce((n, copy) => n + copy.bytes, 0)

  async function keep(assetId: string) {
    const result = await window.nearmora.markUnneeded({ assetIds: [assetId], unneeded: false })
    if (result.ok) await load()
  }

  async function remove() {
    setWorking(true)
    setOutcome(null)
    try {
      const result = await window.nearmora.removePhotos({ pictures: removable.map((item) => item.assetId), copies: extraCopies.map((copy) => copy.locationId), mode })
      setOutcome(result.ok ? describe(result.data) : ['Something went wrong. Files that were already checked may have been removed; the list below is up to date.'])
      if (result.ok && result.data.status === 'done') {
        setChosenGroups(new Set())
        setMode('trash') // never leave "forever" selected for next time
      }
      await load()
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <header className="content__header">
        <h1 className="content__title">Clean up</h1>
        <p className="content__subtitle">Clear photos you don’t need and extra copies. Nothing is removed until you confirm.</p>
      </header>
      {loadError ? <p role="alert">Clean up couldn’t be loaded.</p> : null}

      <section className="cleanup__section" aria-labelledby="cleanup-unneeded">
        <h2 id="cleanup-unneeded" className="cleanup__heading">
          Photos you don’t need{unneeded ? ` (${unneeded.total})` : ''}
        </h2>
        {unneeded && unneeded.items.length === 0 ? (
          <p className="cleanup__hint">None yet. In the Library, choose Select photos, then “Don’t need”.</p>
        ) : (
          <ul className="cleanup__photos" aria-label="Photos you don’t need">
            {unneeded?.items.map((item) => (
              <li key={item.assetId} className="cleanup__photo">
                <img className="cleanup__thumb" src={`nm-media://thumb/${item.assetId}`} alt="" />
                <div className="cleanup__photo-text">
                  <p className="cleanup__name">{item.fileName}</p>
                  <p className="cleanup__meta">
                    {item.folderName} · {size(item.bytes)}
                    {item.files > 1 ? ` · ${item.files} identical copies` : ''}
                  </p>
                  {item.usedIn.length > 0 ? (
                    <p className="cleanup__warning">Used in {item.usedIn.map((t) => `“${t}”`).join(', ')}, so it stays until you take it out of the project.</p>
                  ) : item.offline ? (
                    <p className="cleanup__warning">A copy is on a folder that isn’t connected; that copy will be left alone.</p>
                  ) : null}
                </div>
                <button type="button" className="button button--quiet" onClick={() => void keep(item.assetId)} aria-label={`Keep ${item.fileName}`}>
                  Keep
                </button>
              </li>
            ))}
          </ul>
        )}
        {unneeded && unneeded.total > unneeded.items.length ? <p className="cleanup__hint">Showing the latest {unneeded.items.length}.</p> : null}
      </section>

      <section className="cleanup__section" aria-labelledby="cleanup-duplicates">
        <h2 id="cleanup-duplicates" className="cleanup__heading">
          Identical copies{duplicates ? ` (${duplicates.total})` : ''}
        </h2>
        {duplicates && duplicates.groups.length === 0 ? (
          <p className="cleanup__hint">No photo is saved more than once.</p>
        ) : (
          <>
            <p className="cleanup__hint">These photos are saved as identical files. Choose the ones to clear; the copy marked “Stays” is kept.</p>
            <div className="library__toolbar">
              <button type="button" className="button button--quiet" onClick={() => setChosenGroups(new Set(duplicates?.groups.map((g) => g.assetId)))}>
                Choose all
              </button>
              <button type="button" className="button button--quiet" disabled={chosenGroups.size === 0} onClick={() => setChosenGroups(new Set())}>
                Choose none
              </button>
            </div>
            <ul className="cleanup__groups" aria-label="Identical copies">
              {duplicates?.groups.map((group) => {
                const stays = keeper[group.assetId] ?? group.copies[0]?.locationId
                const chosen = chosenGroups.has(group.assetId)
                // Marked "Don't need": every copy goes with the photo, so there's no copy to keep here.
                if (removable.some((item) => item.assetId === group.assetId)) {
                  return (
                    <li key={group.assetId} className="cleanup__group">
                      <img className="cleanup__thumb" src={`nm-media://thumb/${group.assetId}`} alt="" />
                      <div className="cleanup__photo-text">
                        <p className="cleanup__name">{group.copies[0]?.fileName}</p>
                        <p className="cleanup__warning">
                          Marked “Don’t need”, so all {group.copies.length} copies go. To keep one, choose Keep above, then clear only the extra copies here.
                        </p>
                      </div>
                    </li>
                  )
                }
                return (
                  <li key={group.assetId} className="cleanup__group">
                    <img className="cleanup__thumb" src={`nm-media://thumb/${group.assetId}`} alt="" />
                    <div className="cleanup__photo-text">
                      <label className="cleanup__choose">
                        <input
                          type="checkbox"
                          checked={chosen}
                          onChange={(event) =>
                            setChosenGroups((current) => {
                              const next = new Set(current)
                              if (event.target.checked) next.add(group.assetId)
                              else next.delete(group.assetId)
                              return next
                            })
                          }
                        />
                        Clear extra copies of {group.copies[0]?.fileName}
                      </label>
                      <fieldset className="cleanup__copies">
                        <legend className="cleanup__meta">Copy that stays</legend>
                        {group.copies.map((copy) => (
                          <label key={copy.locationId} className="cleanup__copy">
                            <input
                              type="radio"
                              name={`stays-${group.assetId}`}
                              checked={copy.locationId === stays}
                              onChange={() => setKeeper((current) => ({ ...current, [group.assetId]: copy.locationId }))}
                            />
                            <span>
                              {copy.subfolder ? `${copy.subfolder}/` : ''}
                              {copy.fileName} in {copy.folderName}
                              {copy.offline ? ' (not connected)' : ''}
                            </span>
                            {copy.locationId === stays ? <span className="cleanup__stays">Stays</span> : chosen ? <span className="cleanup__goes">Goes</span> : null}
                          </label>
                        ))}
                      </fieldset>
                    </div>
                  </li>
                )
              })}
            </ul>
            {duplicates && duplicates.total > duplicates.groups.length ? <p className="cleanup__hint">Showing the latest {duplicates.groups.length}.</p> : null}
          </>
        )}
      </section>

      <section className="cleanup__section cleanup__review" aria-labelledby="cleanup-review">
        <h2 id="cleanup-review" className="cleanup__heading">
          Review and remove
        </h2>
        {fileCount === 0 ? (
          <p className="cleanup__hint">Nothing chosen yet.</p>
        ) : (
          <p>
            {removable.length > 0 ? `${removable.length} ${removable.length === 1 ? 'photo' : 'photos'} you don’t need` : ''}
            {removable.length > 0 && extraCopies.length > 0 ? ' and ' : ''}
            {extraCopies.length > 0 ? `${extraCopies.length} extra ${extraCopies.length === 1 ? 'copy' : 'copies'}` : ''}: {files(fileCount)}, {size(byteCount)}.
          </p>
        )}
        <fieldset className="cleanup__modes" disabled={working}>
          <legend className="cleanup__meta">How to remove them</legend>
          <label className="cleanup__copy">
            <input type="radio" name="remove-mode" checked={mode === 'trash'} onChange={() => setMode('trash')} />
            <span>Move to Trash. You can put them back from the Trash until it’s emptied.</span>
          </label>
          <label className="cleanup__copy">
            <input type="radio" name="remove-mode" checked={mode === 'forever'} onChange={() => setMode('forever')} />
            <span>Delete forever. They skip the Trash and can’t be recovered. You’ll be asked to confirm.</span>
          </label>
        </fieldset>
        <button type="button" className="button button--primary" disabled={fileCount === 0 || working} onClick={() => void remove()}>
          {working ? 'Checking and removing…' : mode === 'trash' ? `Move ${files(fileCount)} to Trash` : `Delete ${files(fileCount)} forever…`}
        </button>
        <div aria-live="polite">
          {outcome ? (
            <ul className="cleanup__outcome">
              {outcome.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </section>

      {history.length > 0 ? (
        <details className="cleanup__section">
          <summary className="cleanup__heading">Recently removed ({history.length})</summary>
          <p className="cleanup__hint">A record kept on this Mac: names and sizes only, never the photos.</p>
          <ul className="cleanup__history">
            {history.map((r, i) => (
              <li key={i}>
                {when.format(r.removedAt)}: {r.fileName} in {r.folderName}, {size(r.sizeBytes)}, {r.mode === 'trash' ? 'moved to Trash' : 'deleted forever'}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  )
}
