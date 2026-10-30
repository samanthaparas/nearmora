/**
 * The Favorites screen: every photo marked as a favorite (in Best Moments), ready to become a collage or carousel.
 * Select photos, then choose a template; the new project opens in Memory Studio.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { latestTemplates, type TemplateDefinition } from '@shared/studio/templates'
import { TemplateIcon } from './TemplateIcon'
import { PhotoGrid, altFor, libraryFetcher, type Photo } from '../library/PhotoGrid'
import '../library/Library.css'
import './Studio.css'

// "select 2", or "select 2–10" for a template that takes a range.
const hint = ({ photos: { min, max } }: TemplateDefinition) => (min === max ? `select ${min}` : `select ${min}–${max}`)

// The picker's groups, in the order they're shown.
const GROUPS: Array<{ title: string; fits: (t: TemplateDefinition) => boolean }> = [
  { title: 'Two photos', fits: (t) => t.mode === 'single' && t.photos.max === 2 },
  { title: 'Four photos', fits: (t) => t.mode === 'single' && t.photos.max === 4 },
  { title: 'Carousel', fits: (t) => t.mode === 'carousel' },
]

export function Favorites({ onOpenProject }: { onOpenProject: (projectId: string) => void }) {
  const fetchPage = useMemo(() => libraryFetcher({ favoritesOnly: true }), [])
  const [selected, setSelected] = useState<string[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function create(template: TemplateDefinition) {
    const result = await window.nearmora.createProject({ templateId: template.id, format: 'square', assetIds: selected })
    if (!result.ok) return setMessage('That project couldn’t be created. Nothing was changed.')
    onOpenProject(result.data.id)
  }

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
        // Every layout, grouped by how many photos it takes; only those that fit the selection are enabled.
        <div className="studio__templates">
          {GROUPS.map((group) => (
            <section key={group.title} className="studio__template-group" aria-label={group.title}>
              <h2 className="studio__template-title">{group.title}</h2>
              <ul className="studio__template-list">
                {latestTemplates()
                  .filter(group.fits)
                  .map((template) => {
                    const fits = selected.length >= template.photos.min && selected.length <= template.photos.max
                    return (
                      <li key={template.id}>
                        <button
                          type="button"
                          className="studio__template"
                          disabled={!fits}
                          title={template.description}
                          onClick={() => void create(template)}
                        >
                          <TemplateIcon template={template} />
                          <span>
                            {template.name} <span className="review__note">({hint(template)})</span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
              </ul>
            </section>
          ))}
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
