/**
 * Reading and editing date moments: the list shown under "Your moments", renaming one, and choosing its cover.
 * Grouping itself lives in library/moments.ts; edits here are marked so regrouping never overwrites them.
 */

import { z } from 'zod'
import type { Catalog } from '../database'
import { CatalogError } from '../errors'

const MomentRow = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    auto_title: z.string(),
    starts_at: z.number().int(),
    ends_at: z.number().int(),
    photo_count: z.number().int(),
    cover_asset_id: z.string().nullable(),
  })
  .transform((row) => ({
    id: row.id,
    title: row.title,
    autoTitle: row.auto_title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    photoCount: row.photo_count,
    coverAssetId: row.cover_asset_id,
  }))
export type Moment = z.output<typeof MomentRow>

/**
 * Newest first. The cover is the chosen one, or else the moment's earliest photo, so every card has a picture.
 * Moments of photos that are all offline still show, from cached thumbnails.
 */
export function listMoments(db: Catalog): Moment[] {
  return db
    .prepare(
      `SELECT m.id, m.title, m.auto_title, m.starts_at, m.ends_at,
              (SELECT COUNT(*) FROM moment_asset ma WHERE ma.moment_id = m.id) AS photo_count,
              COALESCE(m.cover_asset_id, (
                SELECT ma.asset_id FROM moment_asset ma JOIN asset a ON a.id = ma.asset_id
                WHERE ma.moment_id = m.id ORDER BY a.captured_at, a.id LIMIT 1)) AS cover_asset_id
       FROM moment m ORDER BY m.starts_at DESC, m.id`,
    )
    .all()
    .map((row) => MomentRow.parse(row))
}

const MomentEdit = z.object({
  momentId: z.string(),
  // A string renames; null goes back to the date-based title. Omitted leaves it unchanged.
  title: z.string().trim().min(1).max(120).nullable().optional(),
  // An asset in this moment, or null to go back to the automatic cover.
  coverAssetId: z.string().nullable().optional(),
})

export function updateMoment(db: Catalog, input: z.input<typeof MomentEdit>): void {
  const parsed = MomentEdit.safeParse(input)
  if (!parsed.success) throw new CatalogError('INVALID_INPUT', 'A moment title must be 1–120 characters')
  const { momentId, title, coverAssetId } = parsed.data

  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM moment WHERE id = ?').get(momentId)) throw new CatalogError('NOT_FOUND', 'Moment not found')
    if (coverAssetId) {
      const isMember = db.prepare('SELECT 1 FROM moment_asset WHERE moment_id = ? AND asset_id = ?').get(momentId, coverAssetId)
      if (!isMember) throw new CatalogError('INVALID_INPUT', 'The cover must be a photo in this moment')
    }
    if (title !== undefined) db.prepare('UPDATE moment SET title = ? WHERE id = ?').run(title, momentId)
    if (coverAssetId !== undefined) db.prepare('UPDATE moment SET cover_asset_id = ? WHERE id = ?').run(coverAssetId, momentId)
    // user_edited records whether anything is the person's choice, for the UI and for future regrouping rules.
    db.prepare('UPDATE moment SET user_edited = (title IS NOT NULL OR cover_asset_id IS NOT NULL) WHERE id = ?').run(momentId)
  })()
}
