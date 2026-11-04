/**
 * The app shell: sidebar navigation plus the main content area.
 * Every section is real: Library, Best Moments, Favorites, Memory Studio, Clean up, Sources and Settings.
 */

import { useEffect, useState } from 'react'
import { Library } from './library/Library'
import { Sources } from './library/Sources'
import { BestMoments } from './best-moments/BestMoments'
import { CleanUp } from './clean-up/CleanUp'
import { Favorites } from './studio/Favorites'
import { MemoryStudio } from './studio/MemoryStudio'
import { Settings } from './settings/Settings'
import { navigate } from './navigation-guard'
import './App.css'

// The main sections in the blueprint's order, with Clean up (ADR-0019) before Sources. Settings sits apart at the bottom.
const SECTIONS = ['Library', 'Best Moments', 'Favorites', 'Memory Studio', 'Clean up', 'Sources'] as const
type Section = (typeof SECTIONS)[number] | 'Settings'

/** What we know about the app version. Each state renders differently, and the compiler checks we handle all three. */
type AppInfoState =
  | { status: 'loading' }
  | { status: 'ready'; name: string; version: string }
  | { status: 'error' }

// Asks the main process for the app version once, when the UI starts.
// `cancelled` stops a late reply from updating a component that has already unmounted.
function useAppInfo(): AppInfoState {
  const [state, setState] = useState<AppInfoState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    window.nearmora
      .getAppInfo()
      .then((result) => {
        if (cancelled) return
        setState(result.ok ? { status: 'ready', ...result.data } : { status: 'error' })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

// Turns the loading state into the text shown in the sidebar.
function describeVersion(info: AppInfoState): string {
  switch (info.status) {
    case 'loading':
      return 'Loading…'
    case 'ready':
      return `Version ${info.version}`
    case 'error':
      return 'Version unavailable'
  }
}

export function App() {
  const [section, setSection] = useState<Section>('Library')
  // A project to open when arriving in Memory Studio from Favorites.
  const [studioProjectId, setStudioProjectId] = useState<string | null>(null)
  // Counts sidebar choices, so choosing Library or Memory Studio there always starts it afresh: Library at all photos
  // (not an open album or moment), Studio at its project list. Edits in both are saved as they happen, so nothing is lost.
  const [sidebarVisit, setSidebarVisit] = useState(0)
  const info = useAppInfo()

  return (
    <div className="app">
      {/* Lets keyboard users jump past the sidebar straight to the page content. */}
      <a className="app__skip-link" href="#main">
        Skip to content
      </a>

      <aside className="sidebar">
        <p className="sidebar__wordmark">Nearmora</p>

        {/* aria-current tells screen readers which section is open; the blush background shows it visually. */}
        <nav className="sidebar__nav" aria-label="Main">
          {SECTIONS.map((name) => (
            <button
              key={name}
              type="button"
              className="sidebar__item"
              aria-current={section === name ? 'page' : undefined}
              onClick={() =>
                navigate(() => {
                  setStudioProjectId(null)
                  setSidebarVisit((n) => n + 1)
                  setSection(name)
                })
              }
            >
              {name}
            </button>
          ))}
        </nav>

        <div className="sidebar__footer">
          <button
            type="button"
            className="sidebar__item"
            aria-current={section === 'Settings' ? 'page' : undefined}
            onClick={() => navigate(() => setSection('Settings'))}
          >
            Settings
          </button>
          <p className="sidebar__status">On this device</p>
          <p className="sidebar__version">{describeVersion(info)}</p>
        </div>
      </aside>

      <main id="main" className="content" tabIndex={-1}>
        {section === 'Library' ? (
          <Library key={sidebarVisit} />
        ) : section === 'Sources' ? (
          <Sources />
        ) : section === 'Best Moments' ? (
          <BestMoments />
        ) : section === 'Favorites' ? (
          <Favorites
            onOpenProject={(projectId) => {
              setStudioProjectId(projectId)
              setSection('Memory Studio')
            }}
          />
        ) : section === 'Clean up' ? (
          <CleanUp />
        ) : section === 'Memory Studio' ? (
          <MemoryStudio key={`${studioProjectId ?? 'list'}-${sidebarVisit}`} initialProjectId={studioProjectId} onGoToFavorites={() => setSection('Favorites')} />
        ) : (
          <Settings />
        )}
      </main>
    </div>
  )
}
