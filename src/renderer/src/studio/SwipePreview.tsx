/**
 * The swipe preview for carousels (S5b): every slide side by side with a gap like the apps show, then one at a time
 * with Previous and Next (or the arrow keys), sliding across as a swipe would. A seamless design is shown cut exactly
 * as it will be exported, so people see the result without posting a test. Motion is skipped with "Reduce motion".
 */

import { useState, type KeyboardEvent } from 'react'
import type { Composition } from '@shared/studio/compose'
import { cutPositions } from '@shared/studio/slices'
import { StudioCanvas } from './StudioCanvas'

type Items = Parameters<typeof StudioCanvas>[0]['items']

/** The gap apps leave between slides, on screen. */
const GAP = 8

export function SwipePreview({ composition, items, slideWidth }: { composition: Composition; items: Items; slideWidth: number }) {
  const [view, setView] = useState<'side' | 'one'>('side')
  const [index, setIndex] = useState(0)
  const seamless = composition.mode === 'seamless'
  const count = seamless ? composition.slices : composition.canvasCount
  const current = Math.min(index, count - 1)

  // One slide as posted. A seamless slide is the whole design drawn once, shifted so only that slide's part shows.
  const slide = (i: number) => {
    if (!seamless) {
      return <StudioCanvas key={i} composition={composition} items={items} canvasIndex={i} displayWidth={slideWidth} highlight={null} label={`Slide ${i + 1} of ${count}`} placeholders={false} />
    }
    const scale = slideWidth / (composition.width / count)
    const left = i === 0 ? 0 : cutPositions(composition.width, count)[i - 1]! * scale
    return (
      <div key={i} className="studio__swipe-slide" role="img" aria-label={`Slide ${i + 1} of ${count}`} style={{ width: slideWidth, height: composition.height * scale }}>
        <div aria-hidden="true" style={{ transform: `translateX(${-left}px)`, width: composition.width * scale }}>
          <StudioCanvas composition={composition} items={items} canvasIndex={0} displayWidth={composition.width * scale} highlight={null} label="" guides={false} placeholders={false} />
        </div>
      </div>
    )
  }

  function onKey(event: KeyboardEvent) {
    if (view !== 'one') return
    if (event.key === 'ArrowRight') setIndex(Math.min(current + 1, count - 1))
    else if (event.key === 'ArrowLeft') setIndex(Math.max(current - 1, 0))
    else return
    event.preventDefault()
  }

  return (
    <section className="studio__swipe" aria-labelledby="swipe-title">
      <h3 id="swipe-title" className="studio__template-title">
        Swipe preview
      </h3>
      <fieldset className="studio__choice">
        <legend className="visually-hidden">Show the slides</legend>
        <label className="library__check">
          <input type="radio" name="swipe-view" checked={view === 'side'} onChange={() => setView('side')} />
          <span>Side by side</span>
        </label>
        <label className="library__check">
          <input type="radio" name="swipe-view" checked={view === 'one'} onChange={() => setView('one')} />
          <span>One at a time</span>
        </label>
      </fieldset>

      {view === 'side' ? (
        // Focusable, so keyboard users can scroll it sideways when the slides don't fit (at 200% zoom, for example).
        <div className="studio__swipe-row" style={{ gap: GAP }} tabIndex={0} role="group" aria-label={`All ${count} slides side by side`}>
          {Array.from({ length: count }, (_, i) => slide(i))}
        </div>
      ) : (
        // The viewport shows one slide; the track behind it slides across, as a swipe would.
        <div className="studio__swipe-one" tabIndex={0} onKeyDown={onKey} aria-label={`Slide ${current + 1} of ${count}. Use the arrow keys to move between slides.`}>
          <div className="studio__swipe-viewport" style={{ width: slideWidth }}>
            <div className="studio__swipe-track" style={{ gap: GAP, transform: `translateX(${-current * (slideWidth + GAP)}px)` }}>
              {Array.from({ length: count }, (_, i) => slide(i))}
            </div>
          </div>
          <div className="library__source-actions">
            <button type="button" className="button button--quiet" disabled={current === 0} onClick={() => setIndex(current - 1)}>
              ← Previous
            </button>
            <span aria-live="polite">
              Slide {current + 1} of {count}
            </span>
            <button type="button" className="button button--quiet" disabled={current === count - 1} onClick={() => setIndex(current + 1)}>
              Next →
            </button>
          </div>
        </div>
      )}
      <p className="review__note">
        Apps show a thin gap between slides and compress photos when you post, so the posted carousel may look slightly different. Nothing is posted from
        here.
      </p>
    </section>
  )
}
