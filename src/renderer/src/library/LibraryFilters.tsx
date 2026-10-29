/**
 * The Library's search and filter controls: text search, a date range, one folder, and favorites only.
 * Kept restrained, as the blueprint asks; every control has a visible label.
 */

import { useEffect, useState } from 'react'
import type { SourceSummary } from '@shared/ipc-contract'
import type { Filters } from './PhotoGrid'

// <input type="date"> gives "YYYY-MM-DD"; turn it into the start or end of that day in local time.
function dayBoundary(value: string, end: boolean): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [, y, m, d] = match.map(Number) as [number, number, number, number]
  return end ? new Date(y, m - 1, d, 23, 59, 59, 999).getTime() : new Date(y, m - 1, d).getTime()
}

export function LibraryFilters({ sources, onChange }: { sources: SourceSummary[]; onChange: (filters: Filters) => void }) {
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)

  // Search waits for a short pause in typing, so each keystroke doesn't trigger a query.
  useEffect(() => {
    const timer = setTimeout(() => {
      const filters: Filters = {}
      if (search.trim()) filters.search = search.trim()
      const fromMs = dayBoundary(from, false)
      const toMs = dayBoundary(to, true)
      if (fromMs !== undefined) filters.from = fromMs
      if (toMs !== undefined) filters.to = toMs
      if (sourceId) filters.sourceId = sourceId
      if (favoritesOnly) filters.favoritesOnly = true
      onChange(filters)
    }, 250)
    return () => clearTimeout(timer)
  }, [search, from, to, sourceId, favoritesOnly, onChange])

  const active = Boolean(search || from || to || sourceId || favoritesOnly)

  return (
    <form className="library__filters" role="search" aria-label="Search and filter photos" onSubmit={(e) => e.preventDefault()}>
      <label className="library__field library__field--search">
        <span>Search</span>
        <input type="search" value={search} placeholder="File, folder or moment" onChange={(e) => setSearch(e.target.value)} />
      </label>
      <label className="library__field">
        <span>From</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="library__field">
        <span>To</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      {sources.length > 1 ? (
        <label className="library__field">
          <span>Folder</span>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
            <option value="">All folders</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.displayName}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="library__check">
        <input type="checkbox" checked={favoritesOnly} onChange={(e) => setFavoritesOnly(e.target.checked)} />
        <span>Favorites only</span>
      </label>
      {active ? (
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setSearch('')
            setFrom('')
            setTo('')
            setSourceId('')
            setFavoritesOnly(false)
          }}
        >
          Clear filters
        </button>
      ) : null}
    </form>
  )
}
