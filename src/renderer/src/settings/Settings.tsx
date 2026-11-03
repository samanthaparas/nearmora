/**
 * The Settings screen: what Nearmora stores on this Mac and how big it is, clearing the caches that can be rebuilt
 * (AC9), plain statements of what Nearmora does with the person's data, and the licences of the fonts and open-source
 * software it includes, as their licences ask.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import '../library/Library.css'

type Usage = CommandOutput<'settings:storage'>

const size = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(2)} GB`

export function Settings() {
  const [usage, setUsage] = useState<Usage | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [licences, setLicences] = useState<CommandOutput<'app:licences'> | null>(null)

  useEffect(() => {
    let current = true
    void window.nearmora.licences().then((result) => {
      if (current) setLicences(result.ok ? result.data : [])
    })
    return () => {
      current = false
    }
  }, [])

  const load = useCallback(() => window.nearmora.storageUsage().then((result) => setUsage(result.ok ? result.data : null)), [])
  useEffect(() => {
    void load()
  }, [load])

  async function clear(cache: 'previews' | 'thumbnails') {
    const result = await window.nearmora.clearCache({ cache })
    if (!result.ok) setMessage('The cache couldn’t be cleared. Nothing was changed.')
    else if (cache === 'previews') setMessage(`Cleared ${result.data.removed} previews. They’re made again when you compare photos.`)
    else
      setMessage(
        `Cleared ${result.data.removed} thumbnails. ${result.data.rescanning} connected ${result.data.rescanning === 1 ? 'folder is' : 'folders are'} being rescanned to rebuild them; photos on disconnected drives stay blank until those are reconnected.`,
      )
    await load()
  }

  return (
    <>
      <header className="content__header">
        <h1 className="content__title">Settings</h1>
        <p className="content__subtitle">What Nearmora keeps on this Mac.</p>
      </header>

      <section className="moments" aria-labelledby="storage-title">
        <h2 id="storage-title" className="moments__title">
          Storage
        </h2>
        {usage ? (
          <dl className="settings__list">
            <dt>Catalog</dt>
            <dd>
              {size(usage.catalogBytes)}. Your folders, favorites, choices, albums and projects. It isn’t encrypted, so turn on FileVault in System
              Settings to protect it along with the rest of your Mac.
            </dd>
            <dt>Thumbnails</dt>
            <dd>
              {usage.thumbnails.files} files, {size(usage.thumbnails.bytes)}. Rebuilt by rescanning.
            </dd>
            <dt>Previews</dt>
            <dd>
              {usage.previews.files} files, {size(usage.previews.bytes)}. Larger copies for comparing photos, made again when needed.
            </dd>
          </dl>
        ) : (
          <p>Loading…</p>
        )}
        <div className="library__source-actions">
          <button type="button" className="button button--secondary" onClick={() => void clear('previews')}>
            Clear previews
          </button>
          <button type="button" className="button button--secondary" onClick={() => void clear('thumbnails')}>
            Clear thumbnails
          </button>
        </div>
        <p className="library__skipped" aria-live="polite">
          {message}
        </p>
        <p className="library__skipped">Clearing never touches your photos, your catalog or anything you’ve exported.</p>
      </section>

      <section className="moments" aria-labelledby="privacy-title">
        <h2 id="privacy-title" className="moments__title">
          Privacy
        </h2>
        <p>
          Nearmora works entirely on this Mac. It never connects to the internet, sends no analytics, and never moves, edits or uploads your photos.
          It removes a photo only when you choose to in Clean up.
        </p>
      </section>

      {/* Each package's licence asks for its notice to travel with the app; each opens to show its full text. */}
      <section className="moments" aria-labelledby="licences-title">
        <h2 id="licences-title" className="moments__title">
          Licences
        </h2>
        <p>
          Nearmora is built with these fonts and open-source software. Chromium’s own notices are in the app, in Contents/Resources/LICENSES.chromium.html.
        </p>
        {licences === null ? (
          <p>Loading…</p>
        ) : licences.length === 0 ? (
          <p className="library__skipped">The list is made when the app is built, so it isn’t available in this development run.</p>
        ) : (
          <ul className="settings__licences" aria-label="Fonts and open-source software">
            {licences.map((notice) => (
              <li key={notice.name}>
                <details>
                  <summary>
                    {notice.name} {notice.version} · {notice.license}
                  </summary>
                  <pre className="settings__licence-text">{notice.text}</pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
