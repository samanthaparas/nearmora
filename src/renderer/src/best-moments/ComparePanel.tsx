/**
 * One side of the compare view: a large preview with zoom and pan shared with the other side, so the same detail
 * is shown in both photos. Falls back to the thumbnail when the original is offline. Favorite and Remove sit below.
 */

import { useState } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'

export type Member = CommandOutput<'sets:get'>['members'][number]

/** Zoom (1 = fit) and pan offset in pixels, shared by both panels. */
export interface View {
  scale: number
  x: number
  y: number
}
export const FIT: View = { scale: 1, x: 0, y: 0 }

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
export const describeMember = (m: Member): string =>
  `${m.capturedAt === null ? 'Photo' : `Photo from ${dateTime.format(m.capturedAt)}`}${m.offline ? ', offline' : ''}`
// The caption already says "Photo A", so it shows just the date and time.
const captionTime = (m: Member): string => `${m.capturedAt === null ? 'No date' : dateTime.format(m.capturedAt)}${m.offline ? ' · offline' : ''}`

export function ComparePanel({ member, label, view, onPan, favorite, onToggleFavorite, onRemove, hidden = false }: {
  member: Member
  label: string
  view: View
  onPan: (dx: number, dy: number) => void
  favorite: boolean
  onToggleFavorite: () => void
  onRemove: () => void
  hidden?: boolean
}) {
  // The large preview may not exist (offline original); then the thumbnail is used instead.
  const [usePreview, setUsePreview] = useState(true)
  const [dragFrom, setDragFrom] = useState<{ x: number; y: number } | null>(null)
  const src = usePreview ? `nm-media://preview/${member.assetId}` : `nm-media://thumb/${member.assetId}`

  return (
    <figure className="compare__panel" hidden={hidden} aria-label={label}>
      <div
        className="compare__frame"
        // Drag to pan when zoomed in. Keyboard panning lives on the zoom controls (arrow keys).
        onPointerDown={(e) => {
          if (view.scale > 1) {
            e.currentTarget.setPointerCapture(e.pointerId)
            setDragFrom({ x: e.clientX, y: e.clientY })
          }
        }}
        onPointerMove={(e) => {
          if (!dragFrom) return
          onPan(e.clientX - dragFrom.x, e.clientY - dragFrom.y)
          setDragFrom({ x: e.clientX, y: e.clientY })
        }}
        onPointerUp={() => setDragFrom(null)}
      >
        <img
          className="compare__image"
          src={src}
          alt={describeMember(member)}
          draggable={false}
          onError={() => setUsePreview(false)}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        />
        {member.offline ? (
          <span className="library__badge" aria-hidden="true">
            Offline
          </span>
        ) : null}
      </div>
      <figcaption className="compare__caption">
        <span>
          {label} · {captionTime(member)}
          {member.addedByYou ? ' · added by you' : ''}
        </span>
        <span className="library__source-actions">
          {/* aria-pressed makes this a toggle for assistive tech; the visible text says the state too. */}
          <button type="button" className={`button ${favorite ? 'button--primary' : 'button--secondary'}`} aria-pressed={favorite} onClick={onToggleFavorite}>
            {favorite ? '★ Favorite' : '☆ Favorite'}
          </button>
          <button type="button" className="button button--quiet" onClick={onRemove}>
            Remove from set
          </button>
        </span>
      </figcaption>
    </figure>
  )
}
