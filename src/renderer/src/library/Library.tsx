/**
 * The Library screen: add a photo folder, follow its scan, browse "Your moments" and Albums, search and filter,
 * select photos to add to an album or to Favorites, and scroll every photo in a virtualized grid. Thumbnails load from
 * nm-media:// by picture id; this screen never sees a file path.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AddToAlbumPanel, AlbumCards, AlbumView, UndoNotice, type Album, type AlbumUndo } from './Albums'
import { LibraryFilters } from './LibraryFilters'
import { MomentCards, MomentHeader, type Moment } from './Moments'
import { PhotoGrid, altFor, libraryFetcher, type Filters, type Photo } from './PhotoGrid'
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
  const [albums, setAlbums] = useState<Album[]>([])
  const [openMomentId, setOpenMomentId] = useState<string | null>(null)
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null)
  const [choosingCover, setChoosingCover] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [addingToAlbum, setAddingToAlbum] = useState(false)
  const [albumUndo, setAlbumUndo] = useState<AlbumUndo | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [total, setTotal] = useState<number | null>(null)
  // The last Favorites change, with exactly the photos it changed, so Undo puts only those back.
  const [favoriteUndo, setFavoriteUndo] = useState<{ message: string; changed: string[]; favorite: boolean } | null>(null)

  const loadMoments = useCallback(() => {
    void window.nearmora.listMoments().then((result) => {
      if (result.ok) setMoments(result.data)
    })
  }, [])
  const loadAlbums = useCallback(() => {
    void window.nearmora.listAlbums().then((result) => {
      if (result.ok) setAlbums(result.data)
    })
  }, [])
  // After each sources refresh (scan progress, reconnect, removal), reload moments, albums and the grid.
  const onSourcesChanged = useCallback(() => {
    loadMoments()
    loadAlbums()
    setRefreshToken((n) => n + 1)
  }, [loadMoments, loadAlbums])
  const { sources, progress, loadError, refresh } = useSources(onSourcesChanged)

  useEffect(() => {
    loadMoments()
    loadAlbums()
  }, [loadMoments, loadAlbums])

  const openMoment = moments.find((m) => m.id === openMomentId) ?? null
  const openAlbum = albums.find((a) => a.id === openAlbumId) ?? null
  const gridFilters = useMemo<Filters>(() => (openMoment ? { ...filters, momentId: openMoment.id } : filters), [filters, openMoment])
  const fetchPage = useMemo(() => libraryFetcher(gridFilters), [gridFilters])
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

  function stopSelecting() {
    setSelecting(false)
    setSelected(new Set())
    setAddingToAlbum(false)
  }

  async function addSelectedTo(album: Album) {
    const result = await window.nearmora.addPhotosToAlbum({ albumId: album.id, assetIds: [...selected] })
    if (!result.ok) {
      setNotice('Those photos couldn’t be added. Nothing was changed.')
      return
    }
    const { added, undoId } = result.data
    const skipped = selected.size - added
    setAlbumUndo({
      message: `Added ${added} ${added === 1 ? 'photo' : 'photos'} to “${album.title}”.${skipped > 0 ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} already in it.` : ''}`,
      undoId,
    })
    stopSelecting()
    loadAlbums()
  }

  // The star on each photo: one click, no selecting. Saved straight away; clicking again takes it back.
  async function toggleFavorite(photo: Photo, favorite: boolean): Promise<boolean> {
    const result = await window.nearmora.setFavorites({ assetIds: [photo.id], favorite })
    if (!result.ok) setNotice('That photo’s favorite couldn’t be changed. Nothing was changed.')
    return result.ok
  }

  // Any photo can become a favorite here, not only ones Best Moments grouped into a set.
  async function favoriteSelected(favorite: boolean) {
    const result = await window.nearmora.setFavorites({ assetIds: [...selected], favorite })
    if (!result.ok) {
      setNotice('Favorites couldn’t be changed. Nothing was changed.')
      return
    }
    const { changed } = result.data
    const already = selected.size - changed.length
    const photos = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`
    setFavoriteUndo({
      message: `${favorite ? 'Added' : 'Removed'} ${photos(changed.length)} ${favorite ? 'to' : 'from'} Favorites.${
        already > 0 ? ` ${photos(already)} ${favorite ? (already === 1 ? 'was already' : 'were already') : already === 1 ? 'wasn’t' : 'weren’t'} in Favorites.` : ''
      }`,
      changed,
      favorite,
    })
    stopSelecting()
    setRefreshToken((n) => n + 1)
  }

  async function undoFavorites() {
    if (!favoriteUndo) return
    if (favoriteUndo.changed.length > 0) await window.nearmora.setFavorites({ assetIds: favoriteUndo.changed, favorite: !favoriteUndo.favorite })
    setFavoriteUndo(null)
    setRefreshToken((n) => n + 1)
  }

  // In select mode each photo is a toggle button; aria-pressed tells assistive tech whether it's selected.
  const renderSelectable = (photo: Photo, _index: number, image: ReactNode) => {
    const isSelected = selected.has(photo.id)
    return (
      <button
        type="button"
        className="library__pick"
        aria-pressed={isSelected}
        aria-label={`Select: ${altFor(photo)}`}
        onClick={() =>
          setSelected((current) => {
            const nextSet = new Set(current)
            if (nextSet.has(photo.id)) nextSet.delete(photo.id)
            else nextSet.add(photo.id)
            return nextSet
          })
        }
      >
        {image}
        {isSelected ? (
          <span className="library__selected" aria-hidden="true">
            ✓ Selected
          </span>
        ) : null}
      </button>
    )
  }
  const renderCover = (photo: Photo, _index: number, image: ReactNode) => (
    <button type="button" className="library__pick" onClick={() => void chooseCover(photo.id)} aria-label={`Use as cover: ${altFor(photo)}`}>
      {image}
    </button>
  )

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

      <UndoNotice
        undo={albumUndo}
        onUndone={() => {
          setAlbumUndo(null)
          loadAlbums()
          setRefreshToken((n) => n + 1)
        }}
      />

      <div className="library__undo" aria-live="polite">
        {favoriteUndo ? (
          <>
            <span>{favoriteUndo.message}</span>
            {favoriteUndo.changed.length > 0 ? (
              <button type="button" className="button button--quiet" onClick={() => void undoFavorites()}>
                Undo
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {openAlbum ? (
        <AlbumView
          key={openAlbum.id}
          album={openAlbum}
          refreshToken={refreshToken}
          onBack={() => setOpenAlbumId(null)}
          onChanged={loadAlbums}
          onUndoable={setAlbumUndo}
        />
      ) : (
        <>
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
            <>
              <MomentCards moments={moments} onOpen={(moment) => setOpenMomentId(moment.id)} />
              <AlbumCards
                albums={albums}
                onOpen={(album) => setOpenAlbumId(album.id)}
                onCreated={() => loadAlbums()}
              />
            </>
          )}

          <LibraryFilters sources={sources} onChange={setFilters} />

          <div className="library__toolbar">
            {selecting ? (
              <>
                <p className="library__notice">
                  {selected.size} {selected.size === 1 ? 'photo' : 'photos'} selected
                </p>
                <button type="button" className="button button--secondary" disabled={selected.size === 0} onClick={() => setAddingToAlbum(true)}>
                  Add to album…
                </button>
                <button type="button" className="button button--secondary" disabled={selected.size === 0} onClick={() => void favoriteSelected(true)}>
                  ★ Add to Favorites
                </button>
                <button type="button" className="button button--quiet" disabled={selected.size === 0} onClick={() => void favoriteSelected(false)}>
                  Remove from Favorites
                </button>
                <button type="button" className="button button--quiet" onClick={stopSelecting}>
                  Done selecting
                </button>
              </>
            ) : (
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  setChoosingCover(false)
                  setSelecting(true)
                }}
              >
                Select photos
              </button>
            )}
          </div>
          {addingToAlbum ? (
            <AddToAlbumPanel albums={albums} count={selected.size} onChoose={(album) => void addSelectedTo(album)} onCancel={() => setAddingToAlbum(false)} />
          ) : null}

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
            fetchPage={fetchPage}
            refreshToken={refreshToken}
            label={openMoment ? 'Photos in this moment' : 'Photos'}
            onTotal={setTotal}
            onToggleFavorite={toggleFavorite}
            {...(selecting ? { renderCell: renderSelectable } : choosingCover ? { renderCell: renderCover } : {})}
          />
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
