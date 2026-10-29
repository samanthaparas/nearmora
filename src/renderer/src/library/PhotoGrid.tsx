/**
 * The Library's photo grid, virtualized: only the rows on screen (plus a few) exist in the page, however many
 * photos there are, and more are fetched page by page as you scroll. This keeps large libraries smooth (blueprint).
 * With `onPick`, each photo becomes a button (used to choose a moment's cover).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CommandInput, CommandOutput } from '@shared/ipc-contract'

type Photo = CommandOutput<'library:query'>['items'][number]
type Cursor = CommandOutput<'library:query'>['nextCursor']
export type Filters = NonNullable<CommandInput<'library:query'>['filters']>

const PAGE_SIZE = 300
const MIN_CELL = 160
const GAP = 8

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })

// Alt text: the photos have no captions, so describe what we know (the date, and whether it's offline).
function altFor(photo: Photo): string {
  const base = photo.capturedAt === null ? 'Photo' : `Photo from ${dateFormat.format(photo.capturedAt)}`
  return photo.offline ? `${base}, offline` : base
}

export function PhotoGrid({ filters, refreshToken, label, onPick, onTotal }: {
  filters: Filters
  /** Changes when the catalog may have changed (a scan event), so loaded pages are fetched again. */
  refreshToken: number
  label: string
  onPick?: (assetId: string) => void
  onTotal?: (total: number) => void
}) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<Cursor>(null)
  const [width, setWidth] = useState(0)
  const [scrollMargin, setScrollMargin] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const loading = useRef(false)
  const loadedCount = useRef(0)
  const onTotalRef = useRef(onTotal)
  useEffect(() => {
    onTotalRef.current = onTotal
  })

  // Fetches pages until at least `count` photos are loaded (or there are no more), then replaces the list at once.
  const loadUpTo = useCallback(
    async (count: number) => {
      loading.current = true
      const collected: Photo[] = []
      let next: Cursor = null
      let latestTotal = 0
      do {
        const result = await window.nearmora.queryLibrary({ limit: PAGE_SIZE, cursor: next, filters })
        if (!result.ok) break
        collected.push(...result.data.items)
        next = result.data.nextCursor
        latestTotal = result.data.total
      } while (next && collected.length < count)
      loadedCount.current = collected.length
      setPhotos(collected)
      setCursor(next)
      setTotal(latestTotal)
      onTotalRef.current?.(latestTotal)
      loading.current = false
    },
    [filters],
  )

  // New filters start from the top; a refresh keeps what was already loaded, so the view doesn't jump.
  useEffect(() => {
    void loadUpTo(PAGE_SIZE)
  }, [loadUpTo])
  useEffect(() => {
    if (refreshToken > 0) void loadUpTo(Math.max(PAGE_SIZE, loadedCount.current))
  }, [refreshToken, loadUpTo])

  const loadMore = useCallback(async () => {
    if (loading.current || !cursor) return
    loading.current = true
    const result = await window.nearmora.queryLibrary({ limit: PAGE_SIZE, cursor, filters })
    if (result.ok) {
      setPhotos((current) => {
        const merged = [...current, ...result.data.items]
        loadedCount.current = merged.length
        return merged
      })
      setCursor(result.data.nextCursor)
      setTotal(result.data.total)
    }
    loading.current = false
  }, [cursor, filters])

  // Column count follows the available width, like the CSS auto-fill grid it replaces.
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const observer = new ResizeObserver(() => {
      setWidth(list.clientWidth)
      // The page scrolls in <main>; the virtualizer needs to know how far down that scroll the grid starts.
      const main = document.getElementById('main')
      if (main) setScrollMargin(list.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop)
    })
    observer.observe(list)
    const main = document.getElementById('main')
    if (main) observer.observe(main)
    return () => observer.disconnect()
  }, [])

  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CELL + GAP)))
  const cell = width > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CELL
  const rowCount = Math.ceil(photos.length / columns)

  // eslint-disable-next-line react-hooks/incompatible-library -- see the note below
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => document.getElementById('main'),
    estimateSize: () => cell + GAP,
    overscan: 4,
    scrollMargin,
  })
  const rows = virtualizer.getVirtualItems()
  // (The react-hooks/incompatible-library warning on useVirtualizer is about React Compiler's automatic memoization,
  // which this project doesn't use; the hook itself works normally.)

  // Near the end of what's loaded: fetch the next page.
  const lastRow = rows.at(-1)?.index ?? 0
  useEffect(() => {
    if (lastRow >= rowCount - 3) void loadMore()
  }, [lastRow, rowCount, loadMore])

  return (
    <ul
      ref={listRef}
      className="library__grid"
      aria-label={`${label}, ${total} in total`}
      style={{ height: virtualizer.getTotalSize() || undefined }}
    >
      {rows.flatMap((row) =>
        photos.slice(row.index * columns, row.index * columns + columns).map((photo, column) => {
          const position = row.index * columns + column
          const image = <img className="library__thumb" src={`nm-media://thumb/${photo.id}`} alt={altFor(photo)} decoding="async" />
          return (
            <li
              key={photo.id}
              className="library__cell"
              // Screen readers still hear "photo 401 of 1,000" although only some photos are in the page.
              aria-setsize={total}
              aria-posinset={position + 1}
              style={{ width: cell, height: cell, transform: `translate(${column * (cell + GAP)}px, ${row.start - scrollMargin}px)` }}
            >
              {onPick ? (
                <button type="button" className="library__pick" onClick={() => onPick(photo.id)} aria-label={`Use as cover: ${altFor(photo)}`}>
                  {image}
                </button>
              ) : (
                image
              )}
              {/* Text, not just colour, so the state is clear to everyone. The alt text says it too. */}
              {photo.offline ? (
                <span className="library__badge" aria-hidden="true">
                  Offline
                </span>
              ) : null}
            </li>
          )
        }),
      )}
    </ul>
  )
}
