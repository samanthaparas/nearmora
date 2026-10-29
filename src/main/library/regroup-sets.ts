/**
 * Rebuilds the similar-photo sets after photos change, keeping the person's work (AC4, AC13):
 * each new group is matched to the old set it shares the most photos with, so its id, review status and manual
 * corrections carry over. Favorites are per picture and never touched here; regrouping can't change a choice.
 */

import { randomUUID } from 'node:crypto'
import type { Catalog } from '../catalog/database'
import { findSimilarGroups, readHashedPictures, SIMILARITY_CURRENT, type SimilarityParams } from './similarity'

interface OldMember {
  set_id: string
  asset_id: string
  user_override: 'added' | 'removed' | null
}

export interface RegroupSummary {
  sets: number
  created: number
  kept: number
  removed: number
  /** Kept sets that gained photos since they were reviewed, and so need another look. */
  reopened: number
}

export function regroupSimilaritySets(db: Catalog, params: SimilarityParams = SIMILARITY_CURRENT): RegroupSummary {
  const groups = findSimilarGroups(readHashedPictures(db, params), params)

  return db.transaction(() => {
    // Only automatic ('visual') sets are rebuilt. 'manual' sets are the person's own and are left alone.
    const oldSets = db.prepare(`SELECT id, review_status FROM similarity_set WHERE reason = 'visual'`).all() as Array<{
      id: string
      review_status: string
    }>
    const members = db
      .prepare(`SELECT s.set_id, s.asset_id, s.user_override FROM set_asset s JOIN similarity_set x ON x.id = s.set_id WHERE x.reason = 'visual'`)
      .all() as OldMember[]
    const membersOf = new Map<string, OldMember[]>()
    for (const m of members) membersOf.set(m.set_id, [...(membersOf.get(m.set_id) ?? []), m])
    const setOfAsset = new Map(members.filter((m) => m.user_override !== 'removed').map((m) => [m.asset_id, m.set_id]))

    // Overlap between each new group and the old sets its photos were in; then greedy one-to-one matching.
    const candidates: Array<{ group: number; setId: string; overlap: number }> = []
    groups.forEach((group, index) => {
      const counts = new Map<string, number>()
      for (const assetId of group) {
        const setId = setOfAsset.get(assetId)
        if (setId) counts.set(setId, (counts.get(setId) ?? 0) + 1)
      }
      for (const [setId, overlap] of counts) candidates.push({ group: index, setId, overlap })
    })
    candidates.sort((a, b) => b.overlap - a.overlap)
    const matchFor = new Map<number, string>()
    const used = new Set<string>()
    for (const { group, setId } of candidates) {
      if (matchFor.has(group) || used.has(setId)) continue
      matchFor.set(group, setId)
      used.add(setId)
    }

    const insertSet = db.prepare(`INSERT INTO similarity_set (id, reason, algorithm_version) VALUES (?, 'visual', ?)`)
    const clearMembers = db.prepare('DELETE FROM set_asset WHERE set_id = ?')
    const insertMember = db.prepare('INSERT INTO set_asset (set_id, asset_id, position, user_override) VALUES (?, ?, ?, ?)')
    const deleteSet = db.prepare('DELETE FROM similarity_set WHERE id = ?')
    const summary: RegroupSummary = { sets: 0, created: 0, kept: 0, removed: 0, reopened: 0 }

    groups.forEach((group, index) => {
      const setId = matchFor.get(index)
      if (!setId) {
        const id = randomUUID()
        insertSet.run(id, params.version)
        group.forEach((assetId, position) => insertMember.run(id, assetId, position, null))
        summary.created++
        summary.sets++
        return
      }

      // Corrections survive: photos the person removed stay out (and stay recorded), photos they added stay in.
      const old = membersOf.get(setId) ?? []
      const removed = new Set(old.filter((m) => m.user_override === 'removed').map((m) => m.asset_id))
      const added = old.filter((m) => m.user_override === 'added').map((m) => m.asset_id)
      const previous = new Set(old.filter((m) => m.user_override !== 'removed').map((m) => m.asset_id))
      const shown = [...new Set([...group.filter((id) => !removed.has(id)), ...added])]
      if (shown.length < 2) {
        deleteSet.run(setId)
        summary.removed++
        return
      }

      const changed = shown.length !== previous.size || shown.some((id) => !previous.has(id))
      const gainedPhotos = shown.some((id) => !previous.has(id))
      clearMembers.run(setId)
      let position = 0
      for (const assetId of shown) insertMember.run(setId, assetId, position++, added.includes(assetId) ? 'added' : null)
      for (const assetId of removed) insertMember.run(setId, assetId, position++, 'removed')

      // Kept sets are re-stamped with the rule that produced them now.
      db.prepare('UPDATE similarity_set SET algorithm_version = ? WHERE id = ? AND algorithm_version <> ?').run(params.version, setId, params.version)
      if (changed) {
        // The revision moves on, so a review screen showing the old membership can't save over it. A reviewed
        // set that gained photos goes back to the queue (favorites stay); one that only lost photos keeps its status.
        const reopen = gainedPhotos && db.prepare('SELECT review_status FROM similarity_set WHERE id = ?').pluck().get(setId) === 'reviewed'
        db.prepare(
          `UPDATE similarity_set SET revision = revision + 1${reopen ? ", review_status = 'unreviewed'" : ''} WHERE id = ?`,
        ).run(setId)
        if (reopen) summary.reopened++
      }
      summary.kept++
      summary.sets++
    })

    // Old sets with no matching group: their photos are no longer similar or no longer found. The set goes; each
    // photo's favorite stays, because favorites belong to the picture.
    for (const { id } of oldSets) {
      if (!used.has(id)) {
        deleteSet.run(id)
        summary.removed++
      }
    }
    return summary
  })()
}
