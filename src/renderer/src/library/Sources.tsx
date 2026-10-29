/**
 * The Sources screen: every folder Nearmora reads from, its status, and what you can do with it.
 * Removing a folder here only changes Nearmora's catalog; the folder and its files are never touched.
 */

import { useState } from 'react'
import { addFolderWithMessage } from './Library'
import { SourceStatus } from './SourceStatus'
import { useSources } from './use-sources'
import './Library.css'

export function Sources() {
  const { sources, progress, loadError, refresh } = useSources()
  const [notice, setNotice] = useState<string | null>(null)

  async function addFolder() {
    setNotice(await addFolderWithMessage())
    await refresh()
  }

  return (
    <>
      <header className="content__header">
        <h1 className="content__title">Sources</h1>
        <p className="content__subtitle">The folders and drives Nearmora reads from. It only ever reads them.</p>
      </header>

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

      {loadError ? <p role="alert">Sources couldn’t be loaded.</p> : null}
      {sources !== null && sources.length === 0 ? <p className="library__empty">No folders added yet.</p> : null}
      {sources && sources.length > 0 ? (
        <ul className="library__sources" aria-live="polite">
          {sources.map((source) => (
            <SourceStatus
              key={source.id}
              source={source}
              counts={progress[source.id] ?? source.lastScan}
              onChanged={() => void refresh()}
              allowRemove
            />
          ))}
        </ul>
      ) : null}
    </>
  )
}
