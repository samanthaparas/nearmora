/**
 * Integration tests for date moments: the SQL grouping must match the plain TypeScript reference exactly,
 * and regrouping (after rescans, new photos or removed folders) must keep the person's titles and covers.
 */

import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/main/catalog/database'
import { recordAssetLocation } from '../../src/main/catalog/repositories/assets'
import { listMoments, updateMoment } from '../../src/main/catalog/repositories/moments'
import { groupByGap, groupInSql, MOMENT_GAP_MS, regroupMoments } from '../../src/main/library/moments'
import { codeOf, fakeSha, openTestCatalog, seedSource, tempProfile } from './helpers'

const HOUR = 60 * 60 * 1000
const T0 = Date.UTC(2024, 6, 1, 9)
const title = (start: number, end: number) => `${new Date(start).toISOString().slice(0, 10)}..${new Date(end).toISOString().slice(0, 10)}`

let picture = 0
// Records one photo per timestamp and returns their asset ids, in the same order.
function seedAt(db: Catalog, sourceId: string, times: number[]): string[] {
  return times.map((capturedAt) => {
    picture++
    return recordAssetLocation(db, {
      sourceId,
      relativePath: `p${picture}.jpg`,
      sizeBytes: 1,
      mtimeMs: 1,
      contentSha256: fakeSha(picture),
      mediaType: 'image/jpeg',
      capturedAt,
      capturedAtSource: 'exif',
    }).assetId
  })
}

async function catalog() {
  const db = await openTestCatalog(tempProfile().catalogFile)
  return { db, sourceId: seedSource(db).sourceId }
}

const ids = (groups: Array<Array<{ assetId: string }>>) => groups.map((g) => g.map((p) => p.assetId))

describe('grouping photos into moments', () => {
  it('splits only where the gap is more than 8 hours; exactly 8 hours stays together', async () => {
    const { db, sourceId } = await catalog()
    const [a, b, c, d] = seedAt(db, sourceId, [T0, T0 + 8 * HOUR, T0 + 16 * HOUR + 1, T0 + 17 * HOUR])
    regroupMoments(db, { formatTitle: title })
    const expected = [
      [a, b],
      [c, d],
    ]
    expect(ids(groupInSql(db))).toEqual(expected)
    // The app's grouping (TypeScript, via regroupMoments) gives the same moments.
    const members = db.prepare('SELECT moment_id, asset_id FROM moment_asset').all() as Array<{ moment_id: string; asset_id: string }>
    const byMoment = Object.values(Object.groupBy(members, (m) => m.moment_id)).map((list) => list!.map((m) => m.asset_id).sort())
    expect(byMoment.sort()).toEqual(expected.map((g) => [...g].sort()).sort())
  })

  it('SQL and TypeScript agree on 2,000 random photos, including identical timestamps', async () => {
    const { db, sourceId } = await catalog()
    let seed = 7
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31
    // Clustered times: bursts within minutes, days apart, plus some exact duplicates of a timestamp.
    const times: number[] = []
    for (let i = 0; i < 2000; i++) {
      const day = Math.floor(random() * 120)
      const base = T0 + day * 24 * HOUR + Math.floor(random() * 3) * 9 * HOUR
      times.push(random() < 0.05 && times.length ? times.at(-1)! : base + Math.floor(random() * 30) * 60_000)
    }
    const assetIds = seedAt(db, sourceId, times)
    const reference = groupByGap(
      assetIds.map((assetId, i) => ({ assetId, capturedAt: times[i]! })),
      MOMENT_GAP_MS,
    )

    expect(ids(groupInSql(db))).toEqual(ids(reference))
    expect(reference.length).toBeGreaterThan(50)
  })
})

describe('regrouping keeps the person’s edits', () => {
  it('a renamed moment keeps its id, title and cover when photos are added to it', async () => {
    const { db, sourceId } = await catalog()
    const [first, second] = seedAt(db, sourceId, [T0, T0 + HOUR])
    regroupMoments(db, { formatTitle: title })
    const [moment] = listMoments(db)
    updateMoment(db, { momentId: moment!.id, title: 'Beach weekend', coverAssetId: second! })

    seedAt(db, sourceId, [T0 + 2 * HOUR, T0 + 30 * 24 * HOUR]) // one joins the moment, one starts a new one
    regroupMoments(db, { formatTitle: title })

    const moments = listMoments(db)
    expect(moments).toHaveLength(2)
    const kept = moments.find((m) => m.id === moment!.id)
    expect(kept).toMatchObject({ title: 'Beach weekend', coverAssetId: second, photoCount: 3 })
    expect(first).toBeDefined()
  })

  it('clears a cover that left the moment, and removes moments with no photos left', async () => {
    const { db, sourceId } = await catalog()
    const other = seedSource(db, 'Other')
    const [stay] = seedAt(db, sourceId, [T0])
    const [leaving] = seedAt(db, other.sourceId, [T0 + HOUR])
    const [alone] = seedAt(db, other.sourceId, [T0 + 40 * 24 * HOUR])
    regroupMoments(db, { formatTitle: title })
    const shared = listMoments(db).find((m) => m.photoCount === 2)!
    updateMoment(db, { momentId: shared.id, coverAssetId: leaving! })

    // The "Other" folder's photos stop being available (as after removing the folder).
    db.prepare(`UPDATE asset_location SET availability = 'missing' WHERE source_id = ?`).run(other.sourceId)
    regroupMoments(db, { formatTitle: title })

    const moments = listMoments(db)
    expect(moments).toHaveLength(1)
    expect(moments[0]).toMatchObject({ id: shared.id, photoCount: 1, coverAssetId: stay })
    expect(alone).toBeDefined()
  })

  it('validates edits: titles of 1–120 characters, covers from the moment only, and null goes back to the date', async () => {
    const { db, sourceId } = await catalog()
    const [a] = seedAt(db, sourceId, [T0])
    const [elsewhere] = seedAt(db, sourceId, [T0 + 50 * 24 * HOUR])
    regroupMoments(db, { formatTitle: title })
    const moment = listMoments(db).find((m) => m.startsAt === T0)!

    expect(codeOf(() => updateMoment(db, { momentId: moment.id, title: 'x'.repeat(121) }))).toBe('INVALID_INPUT')
    expect(codeOf(() => updateMoment(db, { momentId: moment.id, coverAssetId: elsewhere! }))).toBe('INVALID_INPUT')

    updateMoment(db, { momentId: moment.id, title: '  Picnic  ', coverAssetId: a! })
    expect(db.prepare('SELECT title, user_edited FROM moment WHERE id = ?').get(moment.id)).toEqual({ title: 'Picnic', user_edited: 1 })
    updateMoment(db, { momentId: moment.id, title: null, coverAssetId: null })
    expect(db.prepare('SELECT title, user_edited FROM moment WHERE id = ?').get(moment.id)).toEqual({ title: null, user_edited: 0 })
  })

  it('lists newest first, with the earliest photo as the default cover', async () => {
    const { db, sourceId } = await catalog()
    const [early, late] = seedAt(db, sourceId, [T0, T0 + HOUR])
    const [newer] = seedAt(db, sourceId, [T0 + 10 * 24 * HOUR])
    regroupMoments(db, { formatTitle: title })
    expect(listMoments(db).map((m) => m.coverAssetId)).toEqual([newer, early])
    expect(late).toBeDefined()
  })
})
