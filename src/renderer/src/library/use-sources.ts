/**
 * Shared state for screens that show folders: the source list plus live scan progress from main.
 * Both the Library and Sources screens use it, so they always agree on what's scanning.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MainEvent, ScanCounts, SourceSummary } from '@shared/ipc-contract'

export interface SourcesState {
  sources: SourceSummary[] | null
  /** Latest counts per source from scan events, newer than `lastScan` while a scan runs. */
  progress: Record<string, ScanCounts>
  loadError: boolean
  refresh: () => Promise<void>
}

/** `onChange` runs after each refresh, so a screen can reload its own data (such as the photo grid) alongside. */
export function useSources(onChange?: () => void): SourcesState {
  const [sources, setSources] = useState<SourceSummary[] | null>(null)
  const [progress, setProgress] = useState<Record<string, ScanCounts>>({})
  const [loadError, setLoadError] = useState(false)
  // Kept in a ref so a new callback each render doesn't restart the event subscription.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  // State is set in the promise callback, after main replies, never synchronously inside an effect.
  const refresh = useCallback(
    () =>
      window.nearmora.listSources().then((result) => {
        setLoadError(!result.ok)
        if (result.ok) setSources(result.data)
        onChangeRef.current?.()
      }),
    [],
  )

  // Load once, then follow scan events. While a scan runs, refresh at most once a second.
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

  return { sources, progress, loadError, refresh }
}
