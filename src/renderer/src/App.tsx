import { useEffect, useState } from 'react'
import './App.css'

const SECTIONS = ['Library', 'Best Moments', 'Favorites', 'Memory Studio', 'Sources'] as const
type Section = (typeof SECTIONS)[number] | 'Settings'

/** What we know about the app version. Each state renders differently, and the compiler checks we handle all three. */
type AppInfoState =
  | { status: 'loading' }
  | { status: 'ready'; name: string; version: string }
  | { status: 'error' }

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
      <a className="app__skip-link" href="#main">
        Skip to content
      </a>

      <aside className="sidebar">
        <p className="sidebar__wordmark">Nearmora</p>

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
        {section === 'Library' ? <LibraryEmpty /> : <NotBuiltYet section={section} />}
      </main>
    </div>
  )
}

function LibraryEmpty() {
  return (
    <>
      <header className="content__header">
        <h1 className="content__title">Library</h1>
        <p className="content__subtitle">A little closer to the moments you love.</p>
      </header>

      <section className="empty-state" aria-labelledby="empty-title">
        <h2 id="empty-title" className="empty-state__title">
          Choose a folder to get started.
        </h2>
        <p className="empty-state__body">
          Your originals stay where they are. Nearmora only reads them. It never moves, edits or uploads them.
        </p>
        <button type="button" className="button button--primary" disabled aria-describedby="add-folder-note">
          Add folder
        </button>
        <p id="add-folder-note" className="empty-state__note">
          Adding folders isn&rsquo;t available in this development build yet.
        </p>
      </section>
    </>
  )
}

function NotBuiltYet({ section }: { section: Section }) {
  return (
    <header className="content__header">
      <h1 className="content__title">{section}</h1>
      <p className="content__subtitle">This part of Nearmora isn&rsquo;t built yet.</p>
    </header>
  )
}
