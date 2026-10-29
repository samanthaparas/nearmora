/**
 * Similarity sets: groups of identical or near-identical pictures reviewed in Best Moments.
 * R4 will create them from hashes; for now this provides creation and the review view that save/undo build on.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Catalog } from '../database'
import { CatalogError, isConstraintError } from '../errors'

export const ReviewStatus = z.enum(['unreviewed', 'deferred', 'reviewed'])
export type ReviewStatus = z.infer<typeof ReviewStatus>

const NewSet = z.object({
  reason: z.enum(['exact', 'visual', 'manual']),
  algorithmVersion: z.string().min(1),
  assetIds: z.array(z.string()).min(2),
})

export function createSimilaritySet(db: Catalog, input: z.input<typeof NewSet>): string {
  const parsed = NewSet.safeParse(input)
  if (!parsed.success) throw new CatalogError('INVALID_INPUT', 'A set needs a reason and at least two pictures')
  const { reason, algorithmVersion, assetIds } = parsed.data

  const id = randomUUID()
  db.transaction(() => {
    db.prepare('INSERT INTO similarity_set (id, reason, algorithm_version) VALUES (?, ?, ?)').run(id, reason, algorithmVersion)
    const insert = db.prepare('INSERT INTO set_asset (set_id, asset_id, position) VALUES (?, ?, ?)')
    assetIds.forEach((assetId, position) => {
      try {
        insert.run(id, assetId, position)
      } catch (error: unknown) {
        if (isConstraintError(error, 'FOREIGNKEY')) throw new CatalogError('NOT_FOUND', 'Picture not found', { cause: error })
        if (isConstraintError(error, 'PRIMARYKEY')) throw new CatalogError('INVALID_INPUT', 'A picture is listed twice', { cause: error })
        throw error
      }
    })
  })()
  return id
}

export interface SetReview {
  id: string
  reviewStatus: ReviewStatus
  revision: number
  members: Array<{ assetId: string; favorite: boolean }>
}

const SetRow = z.object({ id: z.string(), review_status: ReviewStatus, revision: z.number().int() })
const MemberRow = z.object({ asset_id: z.string(), favorite: z.union([z.literal(0), z.literal(1)]) })

/** The set as the review screen sees it: its status, its revision and each member's favorite state. */
export function getSetReview(db: Catalog, setId: string): SetReview {
  const row = db.prepare('SELECT id, review_status, revision FROM similarity_set WHERE id = ?').get(setId)
  if (!row) throw new CatalogError('NOT_FOUND', 'Set not found')
  const set = SetRow.parse(row)

  // Members a person removed by hand stay recorded (so regrouping respects it) but aren't shown.
  const members = db
    .prepare(
      `SELECT s.asset_id, (f.asset_id IS NOT NULL) AS favorite
       FROM set_asset s LEFT JOIN favorite f ON f.asset_id = s.asset_id
       WHERE s.set_id = ? AND (s.user_override IS NULL OR s.user_override <> 'removed')
       ORDER BY s.position`,
    )
    .all(setId)
    .map((m) => MemberRow.parse(m))

  return {
    id: set.id,
    reviewStatus: set.review_status,
    revision: set.revision,
    members: members.map((m) => ({ assetId: m.asset_id, favorite: m.favorite === 1 })),
  }
}

/** Sets still waiting for a decision, including ones the person chose to decide later. */
export function listSetsToReview(db: Catalog): Array<{ id: string; reviewStatus: ReviewStatus }> {
  const rows = db
    .prepare(`SELECT id, review_status FROM similarity_set WHERE review_status IN ('unreviewed', 'deferred') ORDER BY rowid`)
    .all() as Array<{ id: string; review_status: string }>
  return rows.map((row) => ({ id: row.id, reviewStatus: ReviewStatus.parse(row.review_status) }))
}
