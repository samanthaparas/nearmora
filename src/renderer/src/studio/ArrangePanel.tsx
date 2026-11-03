/**
 * Customize controls for the selected photo (S6a, ADR-0022): exact position, size and angle, rounded corners, flip,
 * lock, hide, layer order, and taking the photo out of its place. Arrow keys nudge it (Shift for 10 pixels), so
 * everything a drag does can also be done from the keyboard. Also the list of hidden photos, so none is ever lost.
 */

import type { KeyboardEvent } from 'react'
import { emptyPlace, moveInOrder, placeEdit, setEdit } from '@shared/studio/arrange'
import type { Composition } from '@shared/studio/compose'
import type { Design } from '@shared/studio/design'
import { MAX_ROUNDING } from '@shared/studio/params'

type Apply = (next: Design, label: string) => void

export function ArrangePanel({ design, composition, position, change, live }: {
  design: Design
  composition: Composition
  /** The selected photo's place. */
  position: number
  /** A one-off change (a button), saved as its own undo step. */
  change: Apply
  /** A change that repeats while typing or holding a key, grouped into one undo step. */
  live: Apply
}) {
  const element = composition.elements.find((e) => e.slot === position)
  if (!element) return null
  const edit = design.params.edits?.[String(position)] ?? {}
  const name = `Photo ${position + 1}`
  const locked = element.locked
  const order = composition.elements.map((e) => e.slot)
  const photos = design.items.filter((i) => i.assetId !== null).length
  const empty = design.items[position]?.assetId === null
  // A layout that gives this photo its own shape (circle, arch, torn edge) keeps it; corners can't be rounded then.
  const shapedByLayout = element.mask !== null && edit.rounding === undefined
  const rect = element.rect
  const round = (v: number) => Math.round(v)
  const moveTo = (next: Partial<typeof rect>, label: string) =>
    live(setEdit(design, position, { rect: placeEdit(composition, { ...rect, ...next }) }), label)

  // Arrow keys nudge the photo one pixel, or ten with Shift; the held key is one undo step.
  function onKey(event: KeyboardEvent) {
    if (locked || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    if (event.target !== event.currentTarget) return // typing in a number box moves its own value, not the photo
    event.preventDefault()
    const step = event.shiftKey ? 10 : 1
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
    moveTo({ x: rect.x + dx, y: rect.y + dy }, `${name} nudged`)
  }

  const number = (label: string, value: number, onValue: (v: number) => void, options: { min?: number; max?: number; disabled?: boolean } = {}) => (
    <label className="library__field">
      <span>{label}</span>
      <input
        type="number"
        value={round(value)}
        min={options.min}
        max={options.max}
        disabled={options.disabled ?? locked}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (e.target.value !== '' && Number.isFinite(v)) onValue(v)
        }}
      />
    </label>
  )

  return (
    <section
      className="studio__arrange library__confirm"
      aria-labelledby="arrange-title"
      tabIndex={0}
      onKeyDown={onKey}
      aria-description={locked ? undefined : 'Arrow keys move the photo one pixel; with Shift, ten pixels.'}
    >
      <h3 id="arrange-title" className="library__confirm-title">
        Arrange {name.toLowerCase()}
        {locked ? ' (locked)' : ''}
      </h3>
      <p className="review__note">
        Drag it on the preview, or its bottom-right corner to resize; it snaps to edges and centres (hold ⌘ to place it freely). Sizes are in pixels of
        the exported image.
      </p>
      <div className="studio__arrange-grid">
        {number('Left', rect.x, (x) => moveTo({ x }, `${name} moved`))}
        {number('Top', rect.y, (y) => moveTo({ y }, `${name} moved`))}
        {number('Width', rect.width, (width) => moveTo({ width: Math.max(20, width) }, `${name} resized`), { min: 20 })}
        {number('Height', rect.height, (height) => moveTo({ height: Math.max(20, height) }, `${name} resized`), { min: 20 })}
        {number('Angle (°)', element.rotation, (rotation) => live(setEdit(design, position, { rotation: Math.max(-180, Math.min(180, rotation)) }), `${name} turned`), {
          min: -180,
          max: 180,
        })}
        {number('Rounded corners', edit.rounding ?? 0, (r) => live(setEdit(design, position, { rounding: r > 0 ? Math.min(MAX_ROUNDING, r) : undefined }), `${name} corners changed`), {
          min: 0,
          max: MAX_ROUNDING,
          disabled: locked || shapedByLayout,
        })}
      </div>
      {shapedByLayout ? <p className="review__note">This layout gives the photo its own shape, so its corners stay as they are.</p> : null}

      <div className="library__source-actions">
        <label className="library__check">
          <input type="checkbox" checked={element.flip} disabled={locked} onChange={(e) => change(setEdit(design, position, { flip: e.target.checked ? true : undefined }), `${name} ${e.target.checked ? 'flipped' : 'unflipped'}`)} />
          <span>Flip left to right</span>
        </label>
        <label className="library__check">
          <input type="checkbox" checked={locked} onChange={(e) => change(setEdit(design, position, { locked: e.target.checked ? true : undefined }), `${name} ${e.target.checked ? 'locked' : 'unlocked'}`)} />
          <span>Lock in place</span>
        </label>
      </div>
      <div className="library__source-actions">
        <button type="button" className="button button--quiet" disabled={order.indexOf(position) === order.length - 1} onClick={() => change(moveInOrder(design, composition, position, 1), `${name} brought forward`)}>
          Bring forward
        </button>
        <button type="button" className="button button--quiet" disabled={order.indexOf(position) === 0} onClick={() => change(moveInOrder(design, composition, position, -1), `${name} sent back`)}>
          Send back
        </button>
        <button type="button" className="button button--quiet" onClick={() => change(setEdit(design, position, { hidden: true }), `${name} hidden`)}>
          Hide
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={empty || photos <= 1}
          title={photos <= 1 && !empty ? 'A project keeps at least one photo' : undefined}
          onClick={() => change(emptyPlace(design, position), `${name} taken out; its place is empty`)}
        >
          Take out of its place
        </button>
        <button
          type="button"
          className="button button--quiet"
          disabled={locked || (edit.rect === undefined && edit.rotation === undefined && edit.rounding === undefined && !edit.flip)}
          onClick={() => change(setEdit(design, position, { rect: undefined, rotation: undefined, rounding: undefined, flip: undefined }), `${name} back in the layout’s place`)}
        >
          Back to the layout’s place
        </button>
      </div>
    </section>
  )
}

/** Every hidden photo, always listed while any is hidden, each with a way to show it again. */
export function HiddenPhotos({ design, composition, change }: { design: Design; composition: Composition; change: Apply }) {
  const hidden = composition.elements.filter((e) => e.hidden).sort((a, b) => a.slot - b.slot)
  if (hidden.length === 0) return null
  return (
    <section className="library__confirm" aria-labelledby="hidden-title">
      <h3 id="hidden-title" className="library__confirm-title">
        Hidden photos ({hidden.length})
      </h3>
      <p className="review__note">Hidden photos stay in the project but aren’t shown or exported.</p>
      <ul className="review__note">
        {hidden.map((e) => (
          <li key={e.slot}>
            Photo {e.slot + 1}{' '}
            <button type="button" className="button button--quiet" onClick={() => change(setEdit(design, e.slot, { hidden: undefined }), `Photo ${e.slot + 1} shown again`)}>
              Show photo {e.slot + 1}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
