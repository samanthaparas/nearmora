/**
 * Date moments: photos grouped into "Your moments" wherever there's a long gap in time (blueprint, Library).
 * Grouping is written twice on purpose, in TypeScript and in SQL window functions, and the tests check they agree.
 * Measured on 10,000 photos (docs/evidence/r3b), the TypeScript loop was about 7× faster, so the app uses it.
 * Regrouping keeps moment ids, renamed titles and chosen covers wherever the photos overlap.
 */

import { randomUUID } from 'node:crypto'
import type { Catalog } from '../catalog/database'

/** A new moment starts when the next photo is more than 8 hours after the previous one. */
export const MOMENT_GAP_MS = 8 * 60 * 60 * 1000

export interface DatedPicture {
  assetId: string
  capturedAt: number
}

/** Sorts by time (then id, so ties are stable) and cuts wherever the gap exceeds `gapMs`. The app's grouping. */
export function groupByGap(pictures: readonly DatedPicture[], gapMs = MOMENT_GAP_MS): DatedPicture[][] {
  const sorted = [...pictures].sort((a, b) => a.capturedAt - b.capturedAt || (a.assetId < b.assetId ? -1 : 1))
  const groups: DatedPicture[][] = []
  for (const picture of sorted) {
    const current = groups.at(-1)
    const previous = current?.at(-1)
    if (current && previous && picture.capturedAt - previous.capturedAt <= gapMs) current.push(picture)
    else groups.push([picture])
  }
  return groups
}

/** Dated pictures still found somewhere, read in index order (captured_at, id). */
function readDatedPictures(db: Catalog): DatedPicture[] {
  return db
    .prepare(
      `SELECT a.id AS assetId, a.captured_at AS capturedAt FROM asset a
       WHERE a.captured_at IS NOT NULL AND a.decode_state = 'ok'
         AND EXISTS (SELECT 1 FROM asset_location l WHERE l.asset_id = a.id AND l.availability = 'available')
       ORDER BY a.captured_at, a.id`,
    )
    .all() as DatedPicture[]
}

/**
 * The same grouping in one SQL query, kept as a cross-check and for comparison. LAG compares each photo with the one before it; a running SUM of
 * "starts a new moment" flags then numbers the groups. Only dated pictures still found somewhere are grouped.
 */
export function groupInSql(db: Catalog, gapMs = MOMENT_GAP_MS): DatedPicture[][] {
  const rows = db
    .prepare(
      `WITH dated AS (
         SELECT a.id, a.captured_at FROM asset a
         WHERE a.captured_at IS NOT NULL AND a.decode_state = 'ok'
           AND EXISTS (SELECT 1 FROM asset_location l WHERE l.asset_id = a.id AND l.availability = 'available')
       ),
       flagged AS (
         SELECT id, captured_at,
                CASE WHEN captured_at - LAG(captured_at) OVER (ORDER BY captured_at, id) > ? THEN 1 ELSE 0 END AS starts_new
         FROM dated
       )
       SELECT id, captured_at, SUM(starts_new) OVER (ORDER BY captured_at, id ROWS UNBOUNDED PRECEDING) AS grp
       FROM flagged ORDER BY captured_at, id`,
    )
    .all(gapMs) as Array<{ id: string; captured_at: number; grp: number }>

  const groups: DatedPicture[][] = []
  for (const row of rows) {
    const picture = { assetId: row.id, capturedAt: row.captured_at }
    if (groups.length === row.grp + 1) groups[row.grp]!.push(picture)
    else groups.push([picture])
  }
  return groups
}

export type FormatTitle = (startsAt: number, endsAt: number) => string

// "22 July 2016", or a range such as "22–24 July 2016", in the system's language.
const defaultFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })
export const formatMomentTitle: FormatTitle = (startsAt, endsAt) => defaultFormat.formatRange(new Date(startsAt), new Date(endsAt))

interface ExistingMoment {
  id: string
  cover_asset_id: string | null
}

/**
 * Rebuilds moments from the current photos in one transaction. Each new group is matched to the old moment it
 * shares the most photos with, so ids, renamed titles and covers survive rescans and new photos (user edits are
 * never recomputed). A cover that's no longer in its moment is cleared rather than pointing elsewhere.
 */
export function regroupMoments(db: Catalog, options: { gapMs?: number; formatTitle?: FormatTitle } = {}): number {
  const groups = groupByGap(readDatedPictures(db), options.gapMs ?? MOMENT_GAP_MS)
  const formatTitle = options.formatTitle ?? formatMomentTitle

  return db.transaction(() => {
    const oldMembership = new Map(
      (db.prepare('SELECT asset_id, moment_id FROM moment_asset').all() as Array<{ asset_id: string; moment_id: string }>).map((r) => [
        r.asset_id,
        r.moment_id,
      ]),
    )
    const existing = new Map((db.prepare('SELECT id, cover_asset_id FROM moment').all() as ExistingMoment[]).map((m) => [m.id, m]))

    // Overlap between every new group and the old moments its photos belonged to.
    const candidates: Array<{ group: number; momentId: string; overlap: number }> = []
    groups.forEach((group, index) => {
      const counts = new Map<string, number>()
      for (const { assetId } of group) {
        const momentId = oldMembership.get(assetId)
        if (momentId) counts.set(momentId, (counts.get(momentId) ?? 0) + 1)
      }
      for (const [momentId, overlap] of counts) candidates.push({ group: index, momentId, overlap })
    })
    // Greedy one-to-one matching, biggest overlap first.
    candidates.sort((a, b) => b.overlap - a.overlap)
    const matchFor = new Map<number, string>()
    const usedMoments = new Set<string>()
    for (const { group, momentId } of candidates) {
      if (matchFor.has(group) || usedMoments.has(momentId)) continue
      matchFor.set(group, momentId)
      usedMoments.add(momentId)
    }

    db.prepare('DELETE FROM moment_asset').run()
    const update = db.prepare('UPDATE moment SET auto_title = ?, starts_at = ?, ends_at = ?, cover_asset_id = ? WHERE id = ?')
    const insert = db.prepare('INSERT INTO moment (id, auto_title, starts_at, ends_at) VALUES (?, ?, ?, ?)')
    const member = db.prepare('INSERT INTO moment_asset (moment_id, asset_id) VALUES (?, ?)')

    groups.forEach((group, index) => {
      const startsAt = group[0]!.capturedAt
      const endsAt = group.at(-1)!.capturedAt
      const autoTitle = formatTitle(startsAt, endsAt)
      const matched = matchFor.get(index)
      let momentId: string
      if (matched) {
        momentId = matched
        const cover = existing.get(matched)?.cover_asset_id ?? null
        const coverStillHere = cover !== null && group.some((p) => p.assetId === cover)
        update.run(autoTitle, startsAt, endsAt, coverStillHere ? cover : null, momentId)
      } else {
        momentId = randomUUID()
        insert.run(momentId, autoTitle, startsAt, endsAt)
      }
      for (const { assetId } of group) member.run(momentId, assetId)
    })

    // Moments whose photos are all gone (or merged into another moment) are removed; photos are untouched.
    const deleteMoment = db.prepare('DELETE FROM moment WHERE id = ?')
    for (const id of existing.keys()) if (!usedMoments.has(id)) deleteMoment.run(id)
    return groups.length
  })()
}
