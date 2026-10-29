/**
 * The photo grid, virtualized: only the rows on screen (plus a few) exist in the page, however many photos there
 * are, and more are fetched page by page as you scroll. It's shared by the Library, moments and albums: each passes
 * its own way of fetching a page, and may wrap each photo in controls (pick a cover, select, rearrange).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CommandInput, CommandOutput } from '@shared/ipc-contract'

export type Photo = CommandOutput<'library:query'>['items'][number]
export type Filters = NonNullable<CommandInput<'library:query'>['filters']>

/** One page of photos; `next` is whatever the source needs to continue (a cursor or a position), or null at the end. */
export interface GridPage {
  items: Photo[]
  total: number
  next: unknown
}
/** Fetches the page after `next` (null for the first page). Returns null if the request failed. */
export type FetchPage = (next: unknown, limit: number) => Promise<GridPage | null>

const PAGE_SIZE = 300
const MIN_CELL = 160
const GAP = 8

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })

// Alt text: the photos have no captions, so describe what we know (the date, and whether it's offline).
export function altFor(photo: Photo): string {
  const base = photo.capturedAt === null ? 'Photo' : `Photo from ${dateFormat.format(photo.capturedAt)}`
  return photo.offline ? `${base}, offline` : base
}

/** Page fetcher for the Library and moments: date order, with search and filters. */
export function libraryFetcher(filters: Filters): FetchPage {
  return async (next, limit) => {
    const result = await window.nearmora.queryLibrary({ limit, cursor: next as CommandOutput<'library:query'>['nextCursor'], filters })
    return result.ok ? { items: result.data.items, total: result.data.total, next: result.data.nextCursor } : null
  }
}

/** Page fetcher for an album: the person's own order. */
export function albumFetcher(albumId: string): FetchPage {
  return async (next, limit) => {
    const result = await window.nearmora.albumPhotos({ albumId, afterPosition: next as number | null, limit })
    return result.ok ? { items: result.data.items, total: result.data.total, next: result.data.nextAfter } : null
  }
}

export function PhotoGrid({ fetchPage, refreshToken, label, renderCell, onTotal }: {
  /** A new function (new filters, another album) starts again from the top. */
  fetchPage: FetchPage
  /** Changes when the catalog may have changed, so the photos already loaded are fetched again in place. */
  refreshToken: number
  label: string
  /** Wraps a photo's image in controls; by default the image is shown as is. */
  renderCell?: (photo: Photo, index: number, image: ReactNode) => ReactNode
  onTotal?: (total: number) => void
}) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [total, setTotal] = useState(0)
  const [next, setNext] = useState<unknown>(null)
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
      let after: unknown = null
      let latestTotal = 0
      do {
        const page = await fetchPage(after, PAGE_SIZE)
        if (!page) break
        collected.push(...page.items)
        after = page.next
        latestTotal = page.total
      } while (after !== null && collected.length < count)
      loadedCount.current = collected.length
      setPhotos(collected)
      setNext(after)
      setTotal(latestTotal)
      onTotalRef.current?.(latestTotal)
      loading.current = false
    },
    [fetchPage],
  )

  // A new source starts from the top; a refresh keeps what was already loaded, so the view doesn't jump.
  useEffect(() => {
    void loadUpTo(PAGE_SIZE)
  }, [loadUpTo])
  useEffect(() => {
    if (refreshToken > 0) void loadUpTo(Math.max(PAGE_SIZE, loadedCount.current))
  }, [refreshToken, loadUpTo])

  const loadMore = useCallback(async () => {
    if (loading.current || next === null) return
    loading.current = true
    const page = await fetchPage(next, PAGE_SIZE)
    if (page) {
      setPhotos((current) => {
        const merged = [...current, ...page.items]
        loadedCount.current = merged.length
        return merged
      })
      setNext(page.next)
      setTotal(page.total)
    }
    loading.current = false
  }, [next, fetchPage])

  // Column count follows the available width, like a CSS auto-fill grid.
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
              {renderCell ? renderCell(photo, position, image) : image}
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
