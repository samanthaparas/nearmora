/**
 * The Library screen: add a photo folder, follow its scan, browse "Your moments", search and filter,
 * and scroll every photo in a virtualized grid. Thumbnails load from nm-media:// by picture id; this screen
 * never sees a file path.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { LibraryFilters } from './LibraryFilters'
import { MomentCards, MomentHeader, type Moment } from './Moments'
import { PhotoGrid, type Filters } from './PhotoGrid'
import { SourceStatus } from './SourceStatus'
import { useSources } from './use-sources'
import './Library.css'

const REFUSALS: Record<'unavailable' | 'overlap' | 'app_data', string> = {
  unavailable: 'That folder couldn’t be opened. It may have been moved or disconnected.',
  overlap: 'That folder is inside, or contains, a folder you’ve already added, so its photos are already included.',
  app_data: 'That folder contains Nearmora’s own data, so it can’t be added as a photo folder.',
}

/** Opens the folder picker in main and turns a refusal into a sentence. Shared by Library and Sources. */
export async function addFolderWithMessage(): Promise<string | null> {
  const result = await window.nearmora.addSource()
  if (!result.ok) return 'Something went wrong adding that folder. Nothing was changed.'
  return result.data.status === 'refused' ? REFUSALS[result.data.reason] : null
}

export function Library() {
  const [notice, setNotice] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>({})
  const [moments, setMoments] = useState<Moment[]>([])
  const [openMomentId, setOpenMomentId] = useState<string | null>(null)
  const [choosingCover, setChoosingCover] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)
  const [total, setTotal] = useState<number | null>(null)

  const loadMoments = useCallback(() => {
    void window.nearmora.listMoments().then((result) => {
      if (result.ok) setMoments(result.data)
    })
  }, [])
  // After each sources refresh (scan progress, reconnect, removal), reload moments and the grid's loaded pages.
  const onSourcesChanged = useCallback(() => {
    loadMoments()
    setRefreshToken((n) => n + 1)
  }, [loadMoments])
  const { sources, progress, loadError, refresh } = useSources(onSourcesChanged)

  useEffect(() => {
    loadMoments()
  }, [loadMoments])

  const openMoment = moments.find((m) => m.id === openMomentId) ?? null
  const gridFilters: Filters = openMoment ? { ...filters, momentId: openMoment.id } : filters
  const filtering = Object.keys(filters).length > 0

  async function addFolder() {
    setNotice(await addFolderWithMessage())
    await refresh()
  }

  async function chooseCover(assetId: string) {
    if (!openMoment) return
    const result = await window.nearmora.updateMoment({ momentId: openMoment.id, coverAssetId: assetId })
    if (result.ok) {
      setChoosingCover(false)
      loadMoments()
    }
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

      {openMoment ? (
        <MomentHeader
          key={openMoment.id}
          moment={openMoment}
          choosingCover={choosingCover}
          onBack={() => {
            setOpenMomentId(null)
            setChoosingCover(false)
          }}
          onChooseCover={setChoosingCover}
          onChanged={loadMoments}
        />
      ) : (
        <MomentCards moments={moments} onOpen={(moment) => setOpenMomentId(moment.id)} />
      )}

      <LibraryFilters sources={sources} onChange={setFilters} />

      {total === 0 ? (
        <div className="library__empty">
          {filtering ? (
            <p>No photos match these filters. Try a different search or clear the filters.</p>
          ) : scanning ? (
            <p>Photos appear here as they’re found.</p>
          ) : (
            <p>No photos found yet. Folders with JPEG or PNG photos appear here once scanned.</p>
          )}
        </div>
      ) : null}
      <PhotoGrid
        key={openMoment?.id ?? 'all'}
        filters={gridFilters}
        refreshToken={refreshToken}
        label={openMoment ? 'Photos in this moment' : 'Photos'}
        onTotal={setTotal}
        {...(choosingCover ? { onPick: (assetId: string) => void chooseCover(assetId) } : {})}
      />
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
