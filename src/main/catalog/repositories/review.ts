/**
 * Saving and undoing Best Moments choices (AC4, AC13).
 * A save writes favorites, the set's review status and an undo snapshot in one transaction:
 * either all of it lands or none of it does.
 */

import { z } from 'zod'
import type { Catalog } from '../database'
import { CatalogError } from '../errors'
import { getSetReview, ReviewStatus } from './sets'

const SaveReviewInput = z.object({
  setId: z.string(),
  favorites: z.array(z.string()),
  status: ReviewStatus,
  // The revision the screen was showing. If someone saved since, this save is refused instead of overwriting.
  expectedRevision: z.number().int().nonnegative(),
})

/** What the set looked like before a save. Stored as JSON and validated again before it's used to undo. */
const ReviewSnapshot = z.object({
  setId: z.string(),
  reviewStatus: ReviewStatus,
  revisionAfterSave: z.number().int(),
  members: z.array(z.object({ assetId: z.string(), favorite: z.boolean() })),
})

// Makes each listed asset's favorite state match its `favorite` flag.
function applyFavorites(db: Catalog, members: ReadonlyArray<{ assetId: string; favorite: boolean }>, now: number): void {
  const add = db.prepare('INSERT INTO favorite (asset_id, updated_at) VALUES (?, ?) ON CONFLICT (asset_id) DO NOTHING')
  const remove = db.prepare('DELETE FROM favorite WHERE asset_id = ?')
  for (const { assetId, favorite } of members) {
    if (favorite) add.run(assetId, now)
    else remove.run(assetId)
  }
}

export function saveReview(db: Catalog, input: z.input<typeof SaveReviewInput>): { revision: number; undoId: number } {
  const parsed = SaveReviewInput.safeParse(input)
  if (!parsed.success) throw new CatalogError('INVALID_INPUT', 'Invalid review')
  const { setId, favorites, status, expectedRevision } = parsed.data

  return db.transaction(() => {
    const before = getSetReview(db, setId)
    if (before.revision !== expectedRevision) throw new CatalogError('STALE_REVISION', 'This set changed since it was opened')

    const memberIds = new Set(before.members.map((m) => m.assetId))
    if (!favorites.every((id) => memberIds.has(id))) throw new CatalogError('INVALID_INPUT', 'A favorite is not in this set')

    const now = Date.now()
    // Zero, one or several favorites are all valid choices.
    const chosen = new Set(favorites)
    applyFavorites(db, before.members.map((m) => ({ assetId: m.assetId, favorite: chosen.has(m.assetId) })), now)

    const revision = before.revision + 1
    db.prepare('UPDATE similarity_set SET review_status = ?, revision = ? WHERE id = ?').run(status, revision, setId)

    const snapshot: z.infer<typeof ReviewSnapshot> = {
      setId,
      reviewStatus: before.reviewStatus,
      revisionAfterSave: revision,
      members: before.members,
    }
    const undo = db
      .prepare(`INSERT INTO undo_entry (scope, target_id, before_json, created_at) VALUES ('review_save', ?, ?, ?)`)
      .run(setId, JSON.stringify(snapshot), now)

    return { revision, undoId: Number(undo.lastInsertRowid) }
  })()
}

/**
 * Puts a set back the way it was before a save. Refused if the set was saved again since,
 * because undoing then would silently throw away the newer choices.
 */
export function undoReview(db: Catalog, undoId: number): { revision: number } {
  return db.transaction(() => {
    const entry = db.prepare(`SELECT before_json FROM undo_entry WHERE id = ? AND scope = 'review_save'`).get(undoId) as
      | { before_json: string }
      | undefined
    if (!entry) throw new CatalogError('NOT_FOUND', 'Nothing to undo')
    const snapshot = ReviewSnapshot.parse(JSON.parse(entry.before_json))

    const current = getSetReview(db, snapshot.setId)
    if (current.revision !== snapshot.revisionAfterSave) throw new CatalogError('STALE_REVISION', 'The set changed after this save')

    applyFavorites(db, snapshot.members, Date.now())
    // The revision keeps counting up, so any screen still showing the undone state knows to refresh.
    const revision = current.revision + 1
    db.prepare('UPDATE similarity_set SET review_status = ?, revision = ? WHERE id = ?').run(snapshot.reviewStatus, revision, snapshot.setId)
    db.prepare('DELETE FROM undo_entry WHERE id = ?').run(undoId)
    return { revision }
  })()
}
