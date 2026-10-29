/**
 * The app shell: sidebar navigation plus the main content area.
 * The Library screen is real; other sections say they aren't built yet.
 */

import { useEffect, useState } from 'react'
import { Library } from './library/Library'
import './App.css'

// The five main sections, in the order the blueprint specifies. Settings sits apart at the bottom.
const SECTIONS = ['Library', 'Best Moments', 'Favorites', 'Memory Studio', 'Sources'] as const
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
              onClick={() => setSection(name)}
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
            onClick={() => setSection('Settings')}
          >
            Settings
          </button>
          <p className="sidebar__status">On this device</p>
          <p className="sidebar__version">{describeVersion(info)}</p>
        </div>
      </aside>

      <main id="main" className="content" tabIndex={-1}>
        {section === 'Library' ? <Library /> : <NotBuiltYet section={section} />}
      </main>
    </div>
  )
}

// Placeholder for sections that don't exist yet, so nothing pretends to work.
function NotBuiltYet({ section }: { section: Section }) {
  return (
    <header className="content__header">
      <h1 className="content__title">{section}</h1>
      <p className="content__subtitle">This part of Nearmora isn&rsquo;t built yet.</p>
    </header>
  )
}
