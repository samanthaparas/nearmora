/**
 * Albums in the Library (AC12, decision D5): the Albums section, an opened album with rename, delete and
 * keyboard-friendly rearranging, the "Add to album" panel for selected photos, and the Undo notice.
 * Albums only reference pictures; nothing here can move, change or delete a photo file.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import { PhotoGrid, albumFetcher, altFor, type Photo } from './PhotoGrid'

export type Album = CommandOutput<'albums:list'>[number]

/** The last album change, so it can be undone. */
export interface AlbumUndo {
  message: string
  undoId: number
}

const photos = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`

// Moving focus after a rearrange: the grid re-renders asynchronously, so wait (briefly) for the button to exist.
function focusWhenReady(selector: string, tries = 30): void {
  const element = document.querySelector<HTMLElement>(selector)
  if (element && !element.hasAttribute('disabled')) element.focus()
  else if (tries > 0) requestAnimationFrame(() => focusWhenReady(selector, tries - 1))
}

/** A small form to name a new album. Used in the Albums section and the Add to album panel. */
function NewAlbumForm({ label, onCreated }: { label: string; onCreated: (album: Album) => void }) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  return (
    <form
      className="moment-header__form"
      onSubmit={(e) => {
        e.preventDefault()
        void window.nearmora.createAlbum({ title }).then((result) => {
          if (!result.ok) {
            setMessage('Album names need 1–120 characters.')
            return
          }
          setTitle('')
          setMessage(null)
          onCreated(result.data)
        })
      }}
    >
      <label className="library__field">
        <span>{label}</span>
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <button type="submit" className="button button--secondary">
        Create album
      </button>
      {message ? (
        <p className="library__skipped" role="alert">
          {message}
        </p>
      ) : null}
    </form>
  )
}

export function AlbumCards({ albums, onOpen, onCreated }: { albums: Album[]; onOpen: (album: Album) => void; onCreated: (album: Album) => void }) {
  return (
    <section className="moments" aria-labelledby="albums-title">
      <h2 id="albums-title" className="moments__title">
        Albums
      </h2>
      {albums.length > 0 ? (
        <ul className="moments__list">
          {albums.map((album) => (
            <li key={album.id}>
              <button type="button" className="moments__card" onClick={() => onOpen(album)}>
                {album.coverAssetId ? (
                  <img className="moments__cover" src={`nm-media://thumb/${album.coverAssetId}`} alt="" />
                ) : (
                  <span className="moments__cover moments__cover--empty" aria-hidden="true" />
                )}
                <span className="moments__name">{album.title}</span>
                <span className="moments__count">{photos(album.photoCount)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="library__skipped">Albums are your own collections. Select photos below and add them to one, or create one here.</p>
      )}
      <NewAlbumForm label="New album name" onCreated={onCreated} />
    </section>
  )
}

/** Shown after an album change, with Undo. A polite live region announces it. */
export function UndoNotice({ undo, onUndone }: { undo: AlbumUndo | null; onUndone: () => void }) {
  return (
    <div className="library__undo" aria-live="polite">
      {undo ? (
        <>
          <span>{undo.message}</span>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void window.nearmora.undoAlbumEdit({ undoId: undo.undoId }).then(() => onUndone())}
          >
            Undo
          </button>
        </>
      ) : null}
    </div>
  )
}

/** Picks an album for the selected photos, or creates one. */
export function AddToAlbumPanel({ albums, count, onChoose, onCancel }: {
  albums: Album[]
  count: number
  onChoose: (album: Album) => void
  onCancel: () => void
}) {
  return (
    <div className="library__confirm" role="group" aria-labelledby="add-to-album-title">
      <p id="add-to-album-title" className="library__confirm-title">
        Add {photos(count)} to an album
      </p>
      <div className="library__source-actions">
        {albums.map((album) => (
          <button key={album.id} type="button" className="button button--secondary" onClick={() => onChoose(album)}>
            {album.title}
          </button>
        ))}
      </div>
      <NewAlbumForm label="Or a new album" onCreated={onChoose} />
      <button type="button" className="button button--quiet" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/** An opened album: its photos in the person's order, with rename, delete and Arrange (move earlier/later, remove). */
export function AlbumView({ album, refreshToken: outsideRefresh, onBack, onChanged, onUndoable }: {
  album: Album
  /** Bumped by the Library (for example after Undo), so the album's photos reload too. */
  refreshToken: number
  onBack: () => void
  onChanged: () => void
  onUndoable: (undo: AlbumUndo) => void
}) {
  const [arranging, setArranging] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(album.title)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState(0)
  const [total, setTotal] = useState(album.photoCount)
  const fetchPage = useMemo(() => albumFetcher(album.id), [album.id])

  // After any change: reload this album's photos and the album list, and offer Undo.
  const afterChange = useCallback(
    (undo: AlbumUndo) => {
      setRefreshToken((n) => n + 1)
      onChanged()
      onUndoable(undo)
    },
    [onChanged, onUndoable],
  )

  async function move(photo: Photo, index: number, direction: -1 | 1) {
    const result = await window.nearmora.movePhotoInAlbum({ albumId: album.id, assetId: photo.id, toIndex: index + direction })
    if (!result.ok) return setMessage('That photo couldn’t be moved. Nothing was changed.')
    afterChange({ message: `Moved ${direction < 0 ? 'earlier' : 'later'}: ${altFor(photo)}.`, undoId: result.data.undoId })
    // Keep focus on the same photo's button, so keyboard users can keep moving it.
    const action = direction < 0 ? 'earlier' : 'later'
    requestAnimationFrame(() => focusWhenReady(`[data-focus-key="${photo.id}:${action}"]`))
  }

  async function remove(photo: Photo) {
    const result = await window.nearmora.removePhotoFromAlbum({ albumId: album.id, assetId: photo.id })
    if (!result.ok) return setMessage('That photo couldn’t be removed from the album. Nothing was changed.')
    afterChange({ message: `Removed from “${album.title}”: ${altFor(photo)}. The photo is still in your Library.`, undoId: result.data.undoId })
  }

  async function rename() {
    const result = await window.nearmora.renameAlbum({ albumId: album.id, title: draft })
    if (!result.ok) return setMessage('Album names need 1–120 characters.')
    setRenaming(false)
    setMessage(null)
    afterChange({ message: `Renamed to “${draft.trim()}”.`, undoId: result.data.undoId })
  }

  async function deleteAlbum() {
    const result = await window.nearmora.deleteAlbum({ albumId: album.id })
    if (!result.ok) return setMessage('The album couldn’t be deleted. Nothing was changed.')
    onUndoable({ message: `Deleted the album “${album.title}”. Its photos are still in your Library.`, undoId: result.data.undoId })
    onChanged()
    onBack()
  }

  return (
    <>
      <div className="moment-header">
        <button type="button" className="button button--quiet" onClick={onBack}>
          ← All photos
        </button>
        {renaming ? (
          <form
            className="moment-header__form"
            onSubmit={(e) => {
              e.preventDefault()
              void rename()
            }}
          >
            <label className="library__field library__field--search">
              <span>Album name</span>
              <input value={draft} maxLength={120} autoFocus onChange={(e) => setDraft(e.target.value)} />
            </label>
            <button type="submit" className="button button--secondary">
              Save name
            </button>
            <button type="button" className="button button--quiet" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h2 className="moment-header__title">{album.title}</h2>
            <p className="library__skipped">{photos(total)} · Album</p>
            <div className="library__source-actions">
              <button
                type="button"
                className="button button--quiet"
                onClick={() => {
                  setDraft(album.title)
                  setRenaming(true)
                }}
              >
                Rename
              </button>
              <button type="button" className="button button--quiet" aria-pressed={arranging} onClick={() => setArranging(!arranging)}>
                {arranging ? 'Done arranging' : 'Arrange'}
              </button>
              <button type="button" className="button button--quiet" onClick={() => setConfirmDelete(true)}>
                Delete album…
              </button>
            </div>
          </>
        )}
        {confirmDelete ? (
          <div className="library__confirm" role="group" aria-labelledby="delete-album-title">
            <p id="delete-album-title" className="library__confirm-title">
              Delete the album “{album.title}”?
            </p>
            <p className="library__skipped">Only the album goes. Its photos stay in your Library and in their folders. You can undo this.</p>
            <div className="library__source-actions">
              <button type="button" className="button button--secondary" autoFocus onClick={() => setConfirmDelete(false)}>
                Keep album
              </button>
              <button type="button" className="button button--quiet" onClick={() => void deleteAlbum()}>
                Delete album
              </button>
            </div>
          </div>
        ) : null}
        {message ? (
          <p className="library__skipped" role="alert">
            {message}
          </p>
        ) : null}
      </div>

      {total === 0 ? <p className="library__empty">This album is empty. Select photos in the Library and choose Add to album.</p> : null}
      <PhotoGrid
        fetchPage={fetchPage}
        refreshToken={refreshToken + outsideRefresh}
        label={`Photos in ${album.title}`}
        onTotal={setTotal}
        {...(arranging
          ? {
              renderCell: (photo: Photo, index: number, image: ReactNode) => (
                <div className="library__arrange">
                  {image}
                  {/* Plain buttons, so rearranging works with a keyboard, switch control or screen reader, not only a mouse. */}
                  <div className="library__arrange-bar">
                    <button
                      type="button"
                      data-focus-key={`${photo.id}:earlier`}
                      disabled={index === 0}
                      aria-label={`Move earlier: ${altFor(photo)}, position ${index + 1} of ${total}`}
                      onClick={() => void move(photo, index, -1)}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      data-focus-key={`${photo.id}:later`}
                      disabled={index === total - 1}
                      aria-label={`Move later: ${altFor(photo)}, position ${index + 1} of ${total}`}
                      onClick={() => void move(photo, index, 1)}
                    >
                      →
                    </button>
                    <button type="button" aria-label={`Remove from album: ${altFor(photo)}`} onClick={() => void remove(photo)}>
                      Remove
                    </button>
                  </div>
                </div>
              ),
            }
          : {})}
      />
    </>
  )
}
