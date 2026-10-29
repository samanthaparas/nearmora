/**
 * The Library screen: add a photo folder, follow its scan, and browse the photos as a thumbnail grid.
 * Thumbnails load from nm-media:// by picture id; this screen never sees a file path.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { CommandOutput, MainEvent, ScanCounts, SourceSummary } from '@shared/ipc-contract'
import { describePictures, describeProgress, describeSkipped } from './scan-text'
import './Library.css'

type Photo = CommandOutput<'library:query'>['items'][number]

const PAGE_SIZE = 200

const REFUSALS: Record<'unavailable' | 'overlap' | 'app_data', string> = {
  unavailable: 'That folder couldn’t be opened. It may have been moved or disconnected.',
  overlap: 'That folder is inside, or contains, a folder you’ve already added, so its photos are already included.',
  app_data: 'That folder contains Nearmora’s own data, so it can’t be added as a photo folder.',
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })

// Alt text: the photos have no captions, so describe what we know (the date) rather than leaving it blank.
const altFor = (photo: Photo): string => (photo.capturedAt === null ? 'Photo' : `Photo from ${dateFormat.format(photo.capturedAt)}`)

export function Library() {
  const [sources, setSources] = useState<SourceSummary[] | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [total, setTotal] = useState(0)
  const [progress, setProgress] = useState<Record<string, ScanCounts>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const shownCount = useRef(PAGE_SIZE)

  const refresh = useCallback(async () => {
    const [sourceResult, libraryResult] = await Promise.all([
      window.nearmora.listSources(),
      window.nearmora.queryLibrary({ offset: 0, limit: shownCount.current }),
    ])
    if (!sourceResult.ok || !libraryResult.ok) {
      setLoadError(true)
      return
    }
    setLoadError(false)
    setSources(sourceResult.data)
    setPhotos(libraryResult.data.items)
    setTotal(libraryResult.data.total)
  }, [])

  // Load once, then follow scan events. While a scan runs, the grid refreshes at most once a second.
  useEffect(() => {
    void refresh()
    let lastRefresh = 0
    const unsubscribe = window.nearmora.onEvent((event: MainEvent) => {
      setProgress((current) => ({ ...current, [event.sourceId]: event.counts }))
      const now = Date.now()
      if (event.state !== 'running' || now - lastRefresh > 1000) {
        lastRefresh = now
        void refresh()
      }
    })
    return unsubscribe
  }, [refresh])

  async function addFolder() {
    setNotice(null)
    const result = await window.nearmora.addSource()
    if (!result.ok) setNotice('Something went wrong adding that folder. Nothing was changed.')
    else if (result.data.status === 'refused') setNotice(REFUSALS[result.data.reason])
    void refresh()
  }

  async function showMore() {
    shownCount.current += PAGE_SIZE
    await refresh()
  }

  if (sources === null) {
    return <LibraryHeader>{loadError ? <p role="alert">The Library couldn’t be loaded.</p> : null}</LibraryHeader>
  }

  if (sources.length === 0) {
    return (
      <LibraryHeader>
        <section className="empty-state" aria-labelledby="empty-title">
          <h2 id="empty-title" className="empty-state__title">
            Choose a folder to get started.
          </h2>
          <p className="empty-state__body">
            Your originals stay where they are. Nearmora only reads them. It never moves, edits or uploads them.
          </p>
          <button type="button" className="button button--primary" onClick={() => void addFolder()}>
            Add folder
          </button>
          {notice ? <p className="empty-state__note" role="alert">{notice}</p> : null}
        </section>
      </LibraryHeader>
    )
  }

  return (
    <LibraryHeader>
      <div className="library__toolbar">
        <button type="button" className="button button--secondary" onClick={() => void addFolder()}>
          Add folder
        </button>
        {notice ? <p className="library__notice" role="alert">{notice}</p> : null}
      </div>

      {/* A polite live region, so screen readers hear scan progress without being interrupted constantly. */}
      <ul className="library__sources" aria-live="polite">
        {sources.map((source) => (
          <SourceStatus key={source.id} source={source} counts={progress[source.id] ?? source.lastScan} />
        ))}
      </ul>

      {photos.length === 0 ? (
        <p className="library__empty">No photos yet.</p>
      ) : (
        <>
          <ul className="library__grid" aria-label={`Photos, ${total} in total`}>
            {photos.map((photo) => (
              <li key={photo.id} className="library__cell">
                <img
                  className="library__thumb"
                  src={`nm-media://thumb/${photo.id}`}
                  alt={altFor(photo)}
                  loading="lazy"
                  decoding="async"
                />
              </li>
            ))}
          </ul>
          {photos.length < total ? (
            <button type="button" className="button button--secondary library__more" onClick={() => void showMore()}>
              Show more ({photos.length} of {total})
            </button>
          ) : null}
        </>
      )}
    </LibraryHeader>
  )
}

function LibraryHeader({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="content__header">
        <h1 className="content__title">Library</h1>
        <p className="content__subtitle">A little closer to the moments you love.</p>
      </header>
      {children}
    </>
  )
}

// One line per folder: scanning progress with a Cancel button, or the result of its last scan.
function SourceStatus({ source, counts }: { source: SourceSummary; counts: ScanCounts | null }) {
  const skipped = counts ? describeSkipped(counts) : null
  return (
    <li className="library__source">
      <p className="library__source-line">
        <strong>{source.displayName}</strong>
        {source.status === 'disconnected' ? ' · Not connected. Its photos will come back when it is.' : null}
        {source.scanning && counts ? ` · Scanning: ${describeProgress(counts)}` : null}
        {source.scanning && !counts ? ' · Scanning…' : null}
        {!source.scanning ? ` · ${describePictures(source)}` : null}
      </p>
      {source.scanning ? (
        <button type="button" className="button button--quiet" onClick={() => void window.nearmora.cancelScan({ sourceId: source.id })}>
          Cancel scan
        </button>
      ) : null}
      {!source.scanning && skipped ? <p className="library__skipped">{skipped}</p> : null}
    </li>
  )
}
