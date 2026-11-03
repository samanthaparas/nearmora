/**
 * The Favorites screen: every photo marked as a favorite (in Best Moments), ready to become a collage or carousel.
 * Select photos, then choose a template; the new project opens in Memory Studio. Filters narrow the layouts by photo
 * count and style, and the chosen size is both how the drawings are shown and the size the new project starts at.
 * The person's own saved templates (S6b) are offered first, at the size they were saved with.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import { FORMAT_IDS, FORMATS, formatLabel, type FormatId } from '@shared/studio/formats'
import { findTemplate, formatFor, latestTemplates, type TemplateDefinition } from '@shared/studio/templates'
import { TemplateIcon } from './TemplateIcon'
import { PhotoGrid, altFor, libraryFetcher, type Photo } from '../library/PhotoGrid'
import '../library/Library.css'
import './Studio.css'

// "select 2", or "select 2–10" for a template that takes a range.
const hint = ({ photos: { min, max } }: TemplateDefinition) => (min === max ? `select ${min}` : `select ${min}–${max}`)

// The picker's groups, in the order they're shown.
type Count = 'two' | 'four' | 'carousel'
const GROUPS: Array<{ title: string; count: Count; style: 'everyday' | 'playful'; seamless?: true }> = [
  { title: 'Two photos', count: 'two', style: 'everyday' },
  { title: 'Playful pairs', count: 'two', style: 'playful' },
  { title: 'Four photos', count: 'four', style: 'everyday' },
  { title: 'Playful quartets', count: 'four', style: 'playful' },
  { title: 'Carousel', count: 'carousel', style: 'everyday' },
  { title: 'Seamless carousels', count: 'carousel', style: 'everyday', seamless: true },
  { title: 'Playful seamless carousels', count: 'carousel', style: 'playful', seamless: true },
]
const countOf = (t: TemplateDefinition): Count => (t.mode !== 'single' ? 'carousel' : t.photos.max === 2 ? 'two' : 'four')
const styleOf = (t: TemplateDefinition) => t.style ?? 'everyday'

// The picker's filters: what to show, and the size new projects start at (the drawings are drawn at that size).
type Show = 'all' | 'fits' | Count
const SHOW: Array<[Show, string]> = [
  ['all', 'All layouts'],
  ['fits', 'Fit my selection'],
  ['two', 'Two photos'],
  ['four', 'Four photos'],
  ['carousel', 'Carousels'],
]
const STYLES: Array<['all' | 'everyday' | 'playful', string]> = [
  ['all', 'Any style'],
  ['everyday', 'Everyday'],
  ['playful', 'Playful'],
]

export function Favorites({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const fetchPage = useMemo(() => libraryFetcher({ favoritesOnly: true }), [])
  const [selected, setSelected] = useState<string[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [show, setShow] = useState<Show>('all')
  const [style, setStyle] = useState<'all' | 'everyday' | 'playful'>('all')
  const [format, setFormat] = useState<FormatId>('square')
  const [mine, setMine] = useState<CommandOutput<'myTemplates:list'>>([])
  const [deleting, setDeleting] = useState<string | null>(null)

  // The person's own templates (S6b); they're kept in the catalogue, so they survive a restart.
  useEffect(() => {
    let current = true
    void window.nearmora.listMyTemplates().then((result) => {
      if (current && result.ok) setMine(result.data)
    })
    return () => {
      current = false
    }
  }, [])

  async function createFromMine(id: string) {
    const result = await window.nearmora.createProjectFromMine({ myTemplateId: id, assetIds: selected })
    if (!result.ok) return setMessage('That project couldn’t be created. Nothing was changed.')
    onOpenProject(result.data.id)
  }

  async function deleteMine(id: string) {
    const result = await window.nearmora.deleteMyTemplate({ id })
    setDeleting(null)
    if (!result.ok) return setMessage('That template couldn’t be deleted. Nothing was changed.')
    setMine((list) => list.filter((t) => t.id !== id))
  }

  async function create(template: TemplateDefinition) {
    // Seamless carousels come in sharing shapes only; a print size chosen here falls back to square for them.
    const result = await window.nearmora.createProject({ templateId: template.id, format: formatFor(template, format), assetIds: selected })
    if (!result.ok) return setMessage('That project couldn’t be created. Nothing was changed.')
    onOpenProject(result.data.id)
  }

  const fitsSelection = (t: TemplateDefinition) => selected.length >= t.photos.min && selected.length <= t.photos.max
  const nothingShown = !latestTemplates().some(
    (t) => (show === 'all' || (show === 'fits' ? fitsSelection(t) : countOf(t) === show)) && (style === 'all' || styleOf(t) === style),
  )

  // Selection order is the project's starting order, so the first photo picked comes first.
  const renderCell = (photo: Photo, _index: number, image: ReactNode) => {
    const order = selected.indexOf(photo.id)
    return (
      <button
        type="button"
        className="library__pick"
        aria-pressed={order >= 0}
        aria-label={`Select: ${altFor(photo)}${order >= 0 ? `, number ${order + 1}` : ''}`}
        onClick={() => setSelected((current) => (current.includes(photo.id) ? current.filter((id) => id !== photo.id) : [...current, photo.id]))}
      >
        {image}
        {order >= 0 ? (
          <span className="library__selected" aria-hidden="true">
            ✓ {order + 1}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <>
      <header className="content__header">
        <h1 className="content__title">Favorites</h1>
        <p className="content__subtitle">The photos you chose. Select some to make a collage or carousel.</p>
      </header>

      {total === 0 ? (
        <section className="empty-state" aria-labelledby="fav-empty">
          <h2 id="fav-empty" className="empty-state__title">
            No favorites yet.
          </h2>
          <p className="empty-state__body">Pick favorites in Best Moments, and they’ll gather here, ready for Memory Studio.</p>
        </section>
      ) : (
        <div className="studio__bar" role="group" aria-label="Make something from the selected photos">
          <span className="review__note">
            {selected.length} selected{selected.length > 0 ? ' · in the order you picked them' : ''}
          </span>
          {selected.length > 0 ? (
            <button type="button" className="button button--quiet" onClick={() => setSelected([])}>
              Clear selection
            </button>
          ) : null}
        </div>
      )}
      {total !== 0 ? (
        <div className="studio__filters" role="group" aria-label="Find a layout">
          <fieldset className="studio__choice">
            <legend>Show</legend>
            {SHOW.map(([value, label]) => (
              <label key={value} className="library__check">
                <input type="radio" name="picker-show" checked={show === value} onChange={() => setShow(value)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="studio__choice">
            <legend>Style</legend>
            {STYLES.map(([value, label]) => (
              <label key={value} className="library__check">
                <input type="radio" name="picker-style" checked={style === value} onChange={() => setStyle(value)} />
                <span>{label}</span>
              </label>
            ))}
          </fieldset>
          <label className="library__field">
            <span>Size for the new project</span>
            <select value={format} onChange={(e) => setFormat(e.target.value as FormatId)}>
              {(['share', 'print'] as const).map((use) => (
                <optgroup key={use} label={use === 'share' ? 'For sharing' : 'For printing'}>
                  {FORMAT_IDS.filter((id) => FORMATS[id].use === use).map((id) => (
                    <option key={id} value={id}>
                      {formatLabel(id)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {total !== 0 ? (
        // Layouts grouped by photo count and style, narrowed by the filters; only those that fit the selection are enabled.
        <div className="studio__templates">
          {/* My templates: offered with "All layouts" and "Fit my selection" (filtered by it), not by count or style. */}
          {mine.length > 0 && (show === 'all' || show === 'fits') && style === 'all' ? (
            <section className="studio__template-group" aria-label="My templates">
              <h2 className="studio__template-title">My templates</h2>
              <ul className="studio__template-list">
                {mine
                  .filter((t) => show !== 'fits' || selected.length === t.photos)
                  .map((saved) => {
                    const base = findTemplate(saved.templateId, saved.templateVersion)!
                    return (
                      <li key={saved.id}>
                        <button
                          type="button"
                          className="studio__template"
                          disabled={selected.length !== saved.photos}
                          title={`Your template, based on ${base.name}`}
                          onClick={() => void createFromMine(saved.id)}
                        >
                          <TemplateIcon template={base} format={saved.format} params={saved.params} photoCount={saved.places} />
                          <span>
                            {saved.name} <span className="review__note">(select {saved.photos})</span>
                          </span>
                        </button>
                        {deleting === saved.id ? (
                          <span className="library__source-actions" role="group" aria-label={`Delete “${saved.name}”?`}>
                            <button type="button" className="button button--quiet" onClick={() => void deleteMine(saved.id)}>
                              Delete “{saved.name}”
                            </button>
                            <button type="button" className="button button--quiet" onClick={() => setDeleting(null)}>
                              Keep it
                            </button>
                          </span>
                        ) : (
                          <button type="button" className="button button--quiet" onClick={() => setDeleting(saved.id)} aria-label={`Delete template “${saved.name}”…`}>
                            Delete…
                          </button>
                        )}
                      </li>
                    )
                  })}
              </ul>
              <p className="review__note">Deleting a template doesn’t change any project made from it.</p>
            </section>
          ) : null}
          {GROUPS.filter((g) => (show === 'all' || show === 'fits' || show === g.count) && (style === 'all' || style === g.style)).map((group) => {
            const templates = latestTemplates().filter(
              (t) => countOf(t) === group.count && styleOf(t) === group.style && (t.mode === 'seamless') === (group.seamless ?? false) && (show !== 'fits' || fitsSelection(t)),
            )
            if (templates.length === 0) return null
            return (
              <section key={group.title} className="studio__template-group" aria-label={group.title}>
                <h2 className="studio__template-title">{group.title}</h2>
                <ul className="studio__template-list">
                  {templates.map((template) => (
                    <li key={template.id}>
                      <button type="button" className="studio__template" disabled={!fitsSelection(template)} title={template.description} onClick={() => void create(template)}>
                        <TemplateIcon template={template} format={format} />
                        <span>
                          {template.name} <span className="review__note">({hint(template)})</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
          {nothingShown ? <p className="review__note">No layouts match these filters{show === 'fits' ? ' and your selection' : ''}.</p> : null}
        </div>
      ) : null}
      {message ? (
        <p className="library__notice" role="alert">
          {message}
        </p>
      ) : null}

      <PhotoGrid fetchPage={fetchPage} refreshToken={0} label="Favorites" renderCell={renderCell} onTotal={setTotal} />
    </>
  )
}
