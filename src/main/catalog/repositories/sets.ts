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

// A set is shown while at least two of its photos are still in it; fewer means the person split it up.
const SHOWN = `(s.user_override IS NULL OR s.user_override <> 'removed')`

const SetSummaryRow = z
  .object({
    id: z.string(),
    reason: z.enum(['exact', 'visual', 'manual']),
    review_status: ReviewStatus,
    revision: z.number().int(),
    photo_count: z.number().int(),
    favorite_count: z.number().int(),
    cover_asset_id: z.string(),
    first_captured_at: z.number().int().nullable(),
  })
  .transform((row) => ({
    id: row.id,
    reason: row.reason,
    reviewStatus: row.review_status,
    revision: row.revision,
    photoCount: row.photo_count,
    favoriteCount: row.favorite_count,
    coverAssetId: row.cover_asset_id,
    firstCapturedAt: row.first_captured_at,
  }))
export type SetSummary = z.output<typeof SetSummaryRow>

/** Every set still worth showing: waiting ones first (undecided, then decide-later), then reviewed; newest first within each. */
export function listSets(db: Catalog): SetSummary[] {
  return db
    .prepare(
      `SELECT x.id, x.reason, x.review_status, x.revision,
              COUNT(*) AS photo_count,
              SUM(EXISTS (SELECT 1 FROM favorite f WHERE f.asset_id = s.asset_id)) AS favorite_count,
              (SELECT s2.asset_id FROM set_asset s2 WHERE s2.set_id = x.id AND (s2.user_override IS NULL OR s2.user_override <> 'removed')
               ORDER BY s2.position LIMIT 1) AS cover_asset_id,
              MIN(a.captured_at) AS first_captured_at
       FROM similarity_set x
       JOIN set_asset s ON s.set_id = x.id AND ${SHOWN}
       JOIN asset a ON a.id = s.asset_id
       GROUP BY x.id
       HAVING COUNT(*) >= 2
       ORDER BY CASE x.review_status WHEN 'unreviewed' THEN 0 WHEN 'deferred' THEN 1 ELSE 2 END, first_captured_at DESC, x.id`,
    )
    .all()
    .map((row) => SetSummaryRow.parse(row))
}

const DetailMemberRow = z
  .object({
    asset_id: z.string(),
    favorite: z.union([z.literal(0), z.literal(1)]),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    captured_at: z.number().int().nullable(),
    offline: z.union([z.literal(0), z.literal(1)]),
    user_override: z.enum(['added', 'removed']).nullable(),
  })
  .transform((row) => ({
    assetId: row.asset_id,
    favorite: row.favorite === 1,
    width: row.width,
    height: row.height,
    capturedAt: row.captured_at,
    offline: row.offline === 1,
    addedByYou: row.user_override === 'added',
  }))
export type SetMember = z.output<typeof DetailMemberRow>

export interface SetDetail {
  id: string
  reason: 'exact' | 'visual' | 'manual'
  algorithmVersion: string
  reviewStatus: ReviewStatus
  revision: number
  members: SetMember[]
}

/** One set for the review screen: its photos in order, each with favorite state and whether it's offline. */
export function getSetDetail(db: Catalog, setId: string): SetDetail {
  const set = db.prepare('SELECT id, reason, algorithm_version, review_status, revision FROM similarity_set WHERE id = ?').get(setId) as
    | { id: string; reason: SetDetail['reason']; algorithm_version: string; review_status: string; revision: number }
    | undefined
  if (!set) throw new CatalogError('NOT_FOUND', 'Set not found')
  const members = db
    .prepare(
      `SELECT s.asset_id, EXISTS (SELECT 1 FROM favorite f WHERE f.asset_id = s.asset_id) AS favorite,
              a.width, a.height, a.captured_at, s.user_override,
              NOT EXISTS (SELECT 1 FROM asset_location l JOIN source src ON src.id = l.source_id
                          WHERE l.asset_id = a.id AND l.availability = 'available' AND src.status = 'active') AS offline
       FROM set_asset s JOIN asset a ON a.id = s.asset_id
       WHERE s.set_id = ? AND ${SHOWN}
       ORDER BY s.position`,
    )
    .all(setId)
    .map((row) => DetailMemberRow.parse(row))
  return {
    id: set.id,
    reason: set.reason,
    algorithmVersion: set.algorithm_version,
    reviewStatus: ReviewStatus.parse(set.review_status),
    revision: set.revision,
    members,
  }
}
