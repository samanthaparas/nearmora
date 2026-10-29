/**
 * "Your moments": date groups shown as cards, and the header of an opened moment, where it can be renamed
 * or given a different cover. Default titles are dates, never invented descriptions (blueprint).
 */

import { useState } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'

export type Moment = CommandOutput<'moments:list'>[number]

export const momentTitle = (moment: Moment): string => moment.title ?? moment.autoTitle
const photos = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`

export function MomentCards({ moments, onOpen }: { moments: Moment[]; onOpen: (moment: Moment) => void }) {
  if (moments.length === 0) return null
  return (
    <section className="moments" aria-labelledby="moments-title">
      <h2 id="moments-title" className="moments__title">
        Your moments
      </h2>
      <ul className="moments__list">
        {moments.map((moment) => (
          <li key={moment.id}>
            <button type="button" className="moments__card" onClick={() => onOpen(moment)}>
              {moment.coverAssetId ? <img className="moments__cover" src={`nm-media://thumb/${moment.coverAssetId}`} alt="" /> : null}
              <span className="moments__name">{momentTitle(moment)}</span>
              <span className="moments__count">{photos(moment.photoCount)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Header of an opened moment: back to all photos, rename (or go back to the date title), and choose a cover. */
export function MomentHeader({ moment, choosingCover, onBack, onChooseCover, onChanged }: {
  moment: Moment
  choosingCover: boolean
  onBack: () => void
  onChooseCover: (choosing: boolean) => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(momentTitle(moment))
  const [message, setMessage] = useState<string | null>(null)

  async function save(title: string | null) {
    const result = await window.nearmora.updateMoment({ momentId: moment.id, title })
    if (!result.ok) {
      setMessage('That title couldn’t be saved. Titles can be up to 120 characters.')
      return
    }
    setEditing(false)
    setMessage(null)
    onChanged()
  }

  return (
    <div className="moment-header">
      <button type="button" className="button button--quiet" onClick={onBack}>
        ← All photos
      </button>
      {editing ? (
        <form
          className="moment-header__form"
          onSubmit={(e) => {
            e.preventDefault()
            void save(draft.trim() || null)
          }}
        >
          <label className="library__field library__field--search">
            <span>Moment title</span>
            <input value={draft} maxLength={120} autoFocus onChange={(e) => setDraft(e.target.value)} />
          </label>
          <button type="submit" className="button button--secondary">
            Save title
          </button>
          <button type="button" className="button button--quiet" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <h2 className="moment-header__title">{momentTitle(moment)}</h2>
          <p className="library__skipped">
            {photos(moment.photoCount)}
            {moment.title ? ` · ${moment.autoTitle}` : ''}
          </p>
          <div className="library__source-actions">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setDraft(momentTitle(moment))
                setEditing(true)
              }}
            >
              Rename
            </button>
            {moment.title ? (
              <button type="button" className="button button--quiet" onClick={() => void save(null)}>
                Use date as title
              </button>
            ) : null}
            <button type="button" className="button button--quiet" aria-pressed={choosingCover} onClick={() => onChooseCover(!choosingCover)}>
              {choosingCover ? 'Done choosing cover' : 'Choose cover'}
            </button>
          </div>
          {choosingCover ? <p className="library__skipped">Select a photo to make it this moment’s cover.</p> : null}
        </>
      )}
      {message ? (
        <p className="library__skipped" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  )
}
