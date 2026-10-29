/**
 * Reviewing one set in Best Moments: compare two photos side by side (or as A/B tabs in a narrow window),
 * choose zero, one or several favorites, then Save (with Undo) or Decide later. Photos can be taken out, nearby
 * ones put in, or the set split apart. Leaving with unsaved choices always asks first.
 * "Similar" means possibly related; nothing here deletes or changes a photo file.
 */

import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import { setNavigationGuard } from '../navigation-guard'
import { ComparePanel, describeMember, FIT, type Member, type View } from './ComparePanel'
import { favoriteAll, isDirty, keepMembers, toggleFavorite, type Favorites } from './review-draft'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'

type Detail = CommandOutput<'sets:get'>
type Nearby = CommandOutput<'sets:nearby'>

const STALE_MESSAGE = 'This set changed while you were reviewing it (a scan found or lost photos). It has been updated; your picks are kept for the photos still in it. Check and save again.'

// Narrow windows show the two photos as tabs instead of side by side.
function useNarrow(): boolean {
  const query = '(max-width: 899px)'
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const update = () => setNarrow(list.matches)
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [])
  return narrow
}

export function SetReview({ setId, onLeave, onNext, onChanged }: {
  setId: string
  /** Back to the queue. */
  onLeave: () => void
  /** On to the next set waiting for review. */
  onNext: () => void
  /** The set list may have changed (saved, corrected), so the queue should reload. */
  onChanged: () => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [saved, setSaved] = useState<Favorites>(new Set())
  const [draft, setDraft] = useState<Favorites>(new Set())
  const [left, setLeft] = useState(0)
  const [right, setRight] = useState(1)
  const [view, setView] = useState<View>(FIT)
  const [tab, setTab] = useState<'a' | 'b'>('a')
  const [message, setMessage] = useState<string | null>(null)
  const [undoId, setUndoId] = useState<number | null>(null)
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null)
  const [confirmSplit, setConfirmSplit] = useState(false)
  const [nearby, setNearby] = useState<Nearby | null>(null)
  const narrow = useNarrow()
  const dirty = isDirty(saved, draft)

  // Loads the set; `keepDraft` keeps unsaved picks for photos still in it (after a stale save or a correction).
  // State is set in the promise callback, after main replies, never synchronously inside an effect.
  const load = useCallback(
    (keepDraft: Favorites | null): Promise<void> =>
      window.nearmora.getSet({ setId }).then((result) => {
        if (!result.ok) {
          setMessage('This set couldn’t be opened. It may have been split up or regrouped.')
          return
        }
        const members = result.data.members.map((m) => m.assetId)
        const savedNow = new Set(result.data.members.filter((m) => m.favorite).map((m) => m.assetId))
        setDetail(result.data)
        setSaved(savedNow)
        setDraft(keepDraft ? keepMembers(keepDraft, members) : savedNow)
        setLeft((i) => Math.min(i, Math.max(0, members.length - 1)))
        setRight((i) => Math.min(Math.max(i, 1), Math.max(0, members.length - 1)))
      }),
    [setId],
  )
  useEffect(() => {
    void load(null)
  }, [load])

  // Navigation elsewhere in the app asks first while there are unsaved picks.
  useEffect(() => {
    setNavigationGuard((proceed) => {
      if (!dirty) return false
      setPendingLeave(() => proceed)
      return true
    })
    return () => setNavigationGuard(null)
  }, [dirty])

  const leave = (proceed: () => void) => {
    if (dirty) setPendingLeave(() => proceed)
    else proceed()
  }

  async function save(status: 'reviewed' | 'deferred'): Promise<boolean> {
    if (!detail) return false
    const result = await window.nearmora.saveReview({ setId, favorites: [...draft], status, expectedRevision: detail.revision })
    if (!result.ok) {
      setMessage('Your choices couldn’t be saved. Nothing was changed; please try again.')
      return false
    }
    if (result.data.status === 'stale') {
      setMessage(STALE_MESSAGE)
      await load(draft)
      return false
    }
    setUndoId(result.data.undoId)
    setMessage(status === 'reviewed' ? `Saved: ${draft.size} ${draft.size === 1 ? 'favorite' : 'favorites'}.` : 'Saved for later. This set stays in your queue.')
    await load(null)
    onChanged()
    return true
  }

  async function undo() {
    if (undoId === null) return
    const result = await window.nearmora.undoReview({ undoId })
    setUndoId(null)
    setMessage(result.ok && result.data.status === 'undone' ? 'Undone. The set is back as it was before you saved.' : 'That save couldn’t be undone because the set changed since.')
    await load(null)
    onChanged()
  }

  // Corrections: each reloads the set (keeping unsaved picks) and the queue.
  async function correct(run: () => Promise<{ ok: boolean; data?: { status: string } }>, done: string) {
    const result = await run()
    if (!result.ok) return setMessage('That change couldn’t be made. Nothing was changed.')
    setMessage(result.data?.status === 'stale' ? STALE_MESSAGE : done)
    setNearby(null)
    await load(draft)
    onChanged()
  }

  if (!detail) return <p>{message ?? 'Opening set…'}</p>
  const members = detail.members
  if (members.length < 2) {
    return (
      <div>
        <p role="status">This set has been split up, so there’s nothing left to compare. Its photos are all still in your Library.</p>
        <button type="button" className="button button--secondary" onClick={onLeave}>
          Back to Best Moments
        </button>
      </div>
    )
  }

  const a = members[left] ?? members[0]!
  const b = members[right === left ? (left + 1) % members.length : right] ?? members[1]!
  const pan = (dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  const zoom = (factor: number) => setView((v) => (v.scale * factor <= 1 ? FIT : { ...v, scale: Math.min(8, v.scale * factor) }))
  const onZoomKeys = (event: KeyboardEvent) => {
    const steps: Record<string, [number, number]> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }
    const step = steps[event.key]
    if (step && view.scale > 1) {
      event.preventDefault()
      pan(step[0], step[1])
    } else if (event.key === '+' || event.key === '=') zoom(1.5)
    else if (event.key === '-') zoom(1 / 1.5)
  }
  const removeMember = (m: Member) =>
    correct(
      () => window.nearmora.removeFromSet({ setId, assetId: m.assetId, expectedRevision: detail.revision }),
      'Taken out of this set. The photo is still in your Library.',
    )

  const panel = (m: Member, label: string, hidden: boolean) => (
    <ComparePanel
      member={m}
      label={label}
      view={view}
      onPan={pan}
      favorite={draft.has(m.assetId)}
      onToggleFavorite={() => setDraft((d) => toggleFavorite(d, m.assetId))}
      onRemove={() => void removeMember(m)}
      hidden={hidden}
    />
  )

  return (
    <section className="review" aria-labelledby="review-title">
      <div className="moment-header">
        <button type="button" className="button button--quiet" onClick={() => leave(onLeave)}>
          ← All sets
        </button>
        <h2 id="review-title" className="moment-header__title">
          {members.length} similar photos
        </h2>
        <p className="library__skipped">
          {detail.reviewStatus === 'reviewed' ? 'Reviewed' : detail.reviewStatus === 'deferred' ? 'Saved for later' : 'Not decided yet'} · Similar means
          possibly the same moment, never “safe to delete”.
        </p>
      </div>

      <div className="library__undo" aria-live="polite">
        {message ? <span>{message}</span> : null}
        {undoId !== null ? (
          <button type="button" className="button button--quiet" onClick={() => void undo()}>
            Undo
          </button>
        ) : null}
        {undoId !== null ? (
          <button type="button" className="button button--quiet" onClick={onNext}>
            Next set →
          </button>
        ) : null}
      </div>

      {/* Zoom applies to both photos at once, so the same detail can be compared. */}
      <div className="compare__tools" role="group" aria-label="Zoom (arrow keys pan when zoomed in)" onKeyDown={onZoomKeys}>
        <button type="button" className="button button--quiet" onClick={() => zoom(1 / 1.5)} disabled={view.scale <= 1}>
          Zoom out
        </button>
        <button type="button" className="button button--quiet" onClick={() => setView(FIT)} disabled={view.scale === 1}>
          Fit
        </button>
        <button type="button" className="button button--quiet" onClick={() => zoom(1.5)}>
          Zoom in
        </button>
        <span className="review__note">{Math.round(view.scale * 100)}%</span>
        <button
          type="button"
          className="button button--quiet"
          onClick={() => {
            setLeft(right)
            setRight(left)
          }}
        >
          Swap sides
        </button>
      </div>

      {narrow ? (
        <>
          <div role="tablist" aria-label="Photos being compared" className="library__source-actions">
            <button type="button" role="tab" aria-selected={tab === 'a'} className="button button--quiet" onClick={() => setTab('a')}>
              Photo A
            </button>
            <button type="button" role="tab" aria-selected={tab === 'b'} className="button button--quiet" onClick={() => setTab('b')}>
              Photo B
            </button>
          </div>
          <div className="compare compare--narrow" role="tabpanel">
            {panel(a, 'Photo A', tab !== 'a')}
            {panel(b, 'Photo B', tab !== 'b')}
          </div>
        </>
      ) : (
        <div className="compare">
          {panel(a, 'Photo A', false)}
          {panel(b, 'Photo B', false)}
        </div>
      )}

      {/* Every photo in the set. Choosing one shows it as Photo B (or A, if it's already B). */}
      <ul className="strip" aria-label="All photos in this set">
        {members.map((m, index) => {
          const side = m === a ? 'A' : m === b ? 'B' : null
          return (
            <li key={m.assetId}>
              <button
                type="button"
                className="strip__item"
                aria-pressed={side !== null}
                aria-label={`Compare ${describeMember(m)}${draft.has(m.assetId) ? ', favorite' : ''}${side ? `, showing as Photo ${side}` : ''}`}
                onClick={() => (side === 'B' ? setLeft(index) : setRight(index))}
              >
                <img src={`nm-media://thumb/${m.assetId}`} alt="" />
                <span className="strip__label" aria-hidden="true">
                  {side ? `${side} ` : ''}
                  {draft.has(m.assetId) ? '★' : ''}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <div className="review__actions">
        <button type="button" className="button button--primary" onClick={() => void save('reviewed')}>
          Save choices
        </button>
        <button type="button" className="button button--secondary" onClick={() => setDraft(favoriteAll(members.map((m) => m.assetId)))}>
          Favorite all
        </button>
        <button type="button" className="button button--secondary" onClick={() => void save('deferred')}>
          Decide later
        </button>
        <span className="review__note">
          {draft.size} of {members.length} chosen{dirty ? ' · not saved yet' : ''}
        </span>
      </div>

      <div className="library__source-actions review__corrections">
        <button
          type="button"
          className="button button--quiet"
          aria-expanded={nearby !== null}
          onClick={() =>
            nearby
              ? setNearby(null)
              : void window.nearmora.nearbyPhotos({ setId }).then((result) => setNearby(result.ok ? result.data : []))
          }
        >
          {nearby ? 'Hide nearby photos' : 'Add a photo taken around the same time…'}
        </button>
        <button type="button" className="button button--quiet" onClick={() => setConfirmSplit(true)}>
          These aren’t similar: split set apart…
        </button>
      </div>

      {nearby ? (
        nearby.length === 0 ? (
          <p className="library__skipped">No other photos were taken within 10 minutes of this set.</p>
        ) : (
          <ul className="strip" aria-label="Photos taken around the same time">
            {nearby.map((p) => (
              <li key={p.assetId}>
                <button
                  type="button"
                  className="strip__item"
                  aria-label={`Add to this set: photo${p.offline ? ', offline' : ''}`}
                  onClick={() =>
                    void correct(
                      () => window.nearmora.addToSet({ setId, assetId: p.assetId, expectedRevision: detail.revision }),
                      'Added to this set.',
                    )
                  }
                >
                  <img src={`nm-media://thumb/${p.assetId}`} alt="" />
                  <span className="strip__label" aria-hidden="true">
                    + Add
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {confirmSplit ? (
        <div className="library__confirm" role="group" aria-labelledby="split-title">
          <p id="split-title" className="library__confirm-title">
            Split this set apart?
          </p>
          <p className="library__skipped">These photos won’t be grouped together again. They stay in your Library, and favorites are kept.</p>
          <div className="library__source-actions">
            <button type="button" className="button button--secondary" autoFocus onClick={() => setConfirmSplit(false)}>
              Keep set
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setConfirmSplit(false)
                void correct(() => window.nearmora.ungroupSet({ setId, expectedRevision: detail.revision }), 'Split apart.')
              }}
            >
              Split set apart
            </button>
          </div>
        </div>
      ) : null}

      {pendingLeave ? (
        <UnsavedChangesDialog
          onSave={() =>
            void save('reviewed').then((ok) => {
              const proceed = pendingLeave
              setPendingLeave(null)
              if (ok) proceed()
            })
          }
          onDiscard={() => {
            const proceed = pendingLeave
            setDraft(saved)
            setPendingLeave(null)
            proceed()
          }}
          onContinue={() => setPendingLeave(null)}
        />
      ) : null}
    </section>
  )
}
