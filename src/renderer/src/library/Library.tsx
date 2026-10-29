/**
 * The Library screen: add a photo folder, follow its scan, and browse the photos as a thumbnail grid.
 * Thumbnails load from nm-media:// by picture id; this screen never sees a file path.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import { SourceStatus } from './SourceStatus'
import { useSources } from './use-sources'
import './Library.css'

type Photo = CommandOutput<'library:query'>['items'][number]

const PAGE_SIZE = 200

const REFUSALS: Record<'unavailable' | 'overlap' | 'app_data', string> = {
  unavailable: 'That folder couldn’t be opened. It may have been moved or disconnected.',
  overlap: 'That folder is inside, or contains, a folder you’ve already added, so its photos are already included.',
  app_data: 'That folder contains Nearmora’s own data, so it can’t be added as a photo folder.',
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })

// Alt text: the photos have no captions, so describe what we know (the date, and whether it's offline).
function altFor(photo: Photo): string {
  const base = photo.capturedAt === null ? 'Photo' : `Photo from ${dateFormat.format(photo.capturedAt)}`
  return photo.offline ? `${base}, offline` : base
}

/** Opens the folder picker in main and turns a refusal into a sentence. Shared by Library and Sources. */
export async function addFolderWithMessage(): Promise<string | null> {
  const result = await window.nearmora.addSource()
  if (!result.ok) return 'Something went wrong adding that folder. Nothing was changed.'
  return result.data.status === 'refused' ? REFUSALS[result.data.reason] : null
}

export function Library() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [total, setTotal] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const shownCount = useRef(PAGE_SIZE)

  const loadPhotos = useCallback(() => {
    void window.nearmora.queryLibrary({ offset: 0, limit: shownCount.current }).then((result) => {
      if (!result.ok) return
      setPhotos(result.data.items)
      setTotal(result.data.total)
    })
  }, [])
  const { sources, progress, loadError, refresh } = useSources(loadPhotos)

  async function addFolder() {
    setNotice(await addFolderWithMessage())
    await refresh()
  }

  function showMore() {
    shownCount.current += PAGE_SIZE
    loadPhotos()
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
          {notice ? (
            <p className="empty-state__note" role="alert">
              {notice}
            </p>
          ) : null}
        </section>
      </LibraryHeader>
    )
  }

  const scanning = sources.some((source) => source.scanning)

  return (
    <LibraryHeader>
      <div className="library__toolbar">
        <button type="button" className="button button--secondary" onClick={() => void addFolder()}>
          Add folder
        </button>
        {notice ? (
          <p className="library__notice" role="alert">
            {notice}
          </p>
        ) : null}
      </div>

      {/* A polite live region, so screen readers hear scan progress without being interrupted constantly. */}
      <ul className="library__sources" aria-live="polite">
        {sources.map((source) => (
          <SourceStatus key={source.id} source={source} counts={progress[source.id] ?? source.lastScan} onChanged={() => void refresh()} />
        ))}
      </ul>

      {photos.length === 0 ? (
        <p className="library__empty">
          {scanning ? 'Photos appear here as they’re found.' : 'No photos found yet. Folders with JPEG or PNG photos appear here once scanned.'}
        </p>
      ) : (
        <>
          <ul className="library__grid" aria-label={`Photos, ${total} in total`}>
            {photos.map((photo) => (
              <li key={photo.id} className="library__cell">
                <img className="library__thumb" src={`nm-media://thumb/${photo.id}`} alt={altFor(photo)} loading="lazy" decoding="async" />
                {/* Text, not just an icon or colour, so the state is clear to everyone. The alt text says it too. */}
                {photo.offline ? (
                  <span className="library__badge" aria-hidden="true">
                    Offline
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {photos.length < total ? (
            <button type="button" className="button button--secondary library__more" onClick={showMore}>
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
