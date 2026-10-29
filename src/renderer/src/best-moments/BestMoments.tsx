/**
 * The Best Moments screen: the queue of similar-photo sets waiting for a decision (including ones saved for later),
 * the ones already reviewed, and the review of one set. Similar sets are suggestions only; nothing is ever deleted.
 */

import { useCallback, useEffect, useState } from 'react'
import type { CommandOutput } from '@shared/ipc-contract'
import { SetReview } from './SetReview'
import '../library/Library.css'
import './BestMoments.css'

type SetSummary = CommandOutput<'sets:list'>[number]

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })

function SetCards({ sets, onOpen }: { sets: SetSummary[]; onOpen: (set: SetSummary) => void }) {
  return (
    <ul className="moments__list moments__list--wrap">
      {sets.map((set) => (
        <li key={set.id}>
          <button type="button" className="moments__card" onClick={() => onOpen(set)}>
            <img className="moments__cover" src={`nm-media://thumb/${set.coverAssetId}`} alt="" />
            <span className="moments__name">
              {set.photoCount} similar photos{set.firstCapturedAt !== null ? ` · ${dateFormat.format(set.firstCapturedAt)}` : ''}
            </span>
            <span className="moments__count">
              {set.reviewStatus === 'deferred' ? 'Saved for later · ' : ''}
              {set.favoriteCount} {set.favoriteCount === 1 ? 'favorite' : 'favorites'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function BestMoments() {
  const [sets, setSets] = useState<SetSummary[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(() => {
    void window.nearmora.listSets().then((result) => setSets(result.ok ? result.data : []))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const waiting = sets?.filter((s) => s.reviewStatus !== 'reviewed') ?? []
  const reviewed = sets?.filter((s) => s.reviewStatus === 'reviewed') ?? []

  return (
    <>
      <header className="content__header">
        <h1 className="content__title">Best Moments</h1>
        <p className="content__subtitle">Choose your favorites among photos that look alike.</p>
      </header>

      {openId ? (
        <SetReview
          key={openId}
          setId={openId}
          onLeave={() => {
            setOpenId(null)
            load()
          }}
          onNext={() => {
            const next = waiting.find((s) => s.id !== openId)
            setOpenId(next?.id ?? null)
            load()
          }}
          onChanged={load}
        />
      ) : sets === null ? (
        <p>Loading…</p>
      ) : sets.length === 0 ? (
        <section className="empty-state" aria-labelledby="bm-empty">
          <h2 id="bm-empty" className="empty-state__title">
            No similar photos yet.
          </h2>
          <p className="empty-state__body">
            When photos taken moments apart look alike, they’re grouped here so you can pick your favorites. Similar means possibly the same
            moment, never “safe to delete”.
          </p>
        </section>
      ) : (
        <>
          <section className="moments" aria-labelledby="bm-waiting">
            <h2 id="bm-waiting" className="moments__title">
              To review ({waiting.length})
            </h2>
            {waiting.length > 0 ? <SetCards sets={waiting} onOpen={(set) => setOpenId(set.id)} /> : <p className="library__skipped">All caught up.</p>}
          </section>
          {reviewed.length > 0 ? (
            <section className="moments" aria-labelledby="bm-reviewed">
              <h2 id="bm-reviewed" className="moments__title">
                Reviewed ({reviewed.length})
              </h2>
              <SetCards sets={reviewed} onOpen={(set) => setOpenId(set.id)} />
            </section>
          ) : null}
        </>
      )}
    </>
  )
}
