/**
 * Integration tests for the Library query: keyset paging (every photo exactly once, in order, across pages),
 * search over file names, folders and moment titles, and each filter.
 */

import { describe, expect, it } from 'vitest'
import type { Catalog } from '../../src/main/catalog/database'
import { recordAssetLocation } from '../../src/main/catalog/repositories/assets'
import { queryLibrary, type LibraryCursor, type LibraryFilters } from '../../src/main/catalog/repositories/library'
import { listMoments, updateMoment } from '../../src/main/catalog/repositories/moments'
import { regroupMoments } from '../../src/main/library/moments'
import { fakeSha, openTestCatalog, seedSource, tempProfile } from './helpers'

const DAY = 24 * 60 * 60 * 1000
const T0 = Date.UTC(2024, 0, 1)
let picture = 1000

function add(db: Catalog, sourceId: string, relativePath: string, capturedAt: number): string {
  picture++
  return recordAssetLocation(db, {
    sourceId,
    relativePath,
    sizeBytes: 1,
    mtimeMs: 1,
    contentSha256: fakeSha(picture),
    mediaType: 'image/jpeg',
    capturedAt,
    capturedAtSource: 'exif',
  }).assetId
}

// Reads every page and returns the ids in order.
function readAll(db: Catalog, limit: number, filters: LibraryFilters = {}): string[] {
  const seen: string[] = []
  let cursor: LibraryCursor | null = null
  do {
    const page = queryLibrary(db, { limit, cursor, filters })
    seen.push(...page.items.map((item) => item.id))
    cursor = page.nextCursor
  } while (cursor)
  return seen
}

describe('keyset paging', () => {
  it('returns every photo exactly once, newest first, even with many identical timestamps', async () => {
    const db = await openTestCatalog(tempProfile().catalogFile)
    const { sourceId } = seedSource(db)
    // 250 photos sharing only 20 distinct timestamps, so most page boundaries fall inside a tie.
    for (let i = 0; i < 250; i++) add(db, sourceId, `img${i}.jpg`, T0 + (i % 20) * 1000)

    const all = readAll(db, 500)
    const paged = readAll(db, 7)
    expect(all).toHaveLength(250)
    expect(paged).toEqual(all)
    expect(new Set(paged).size).toBe(250)
    expect(queryLibrary(db, { limit: 7 }).total).toBe(250)
  })
})

describe('search and filters', () => {
  async function library() {
    const db = await openTestCatalog(tempProfile().catalogFile)
    const home = seedSource(db, 'Home')
    const drive = seedSource(db, 'Drive')
    const ids = {
      beach: add(db, home.sourceId, 'Holiday/beach-001.jpg', T0),
      percent: add(db, home.sourceId, 'sale_50%.jpg', T0 + 1000),
      party: add(db, drive.sourceId, 'party.jpg', T0 + 40 * DAY),
      later: add(db, drive.sourceId, 'misc/img.jpg', T0 + 80 * DAY),
    }
    regroupMoments(db, { formatTitle: () => 'auto title' })
    return { db, home, drive, ids }
  }
  const find = (db: Catalog, filters: LibraryFilters) => readAll(db, 50, filters).sort()

  it('matches file names and subfolders, case-insensitively', async () => {
    const { db, ids } = await library()
    expect(find(db, { search: 'BEACH' })).toEqual([ids.beach])
    expect(find(db, { search: 'holiday' })).toEqual([ids.beach])
  })

  it('matches folder names and moment titles', async () => {
    const { db, ids } = await library()
    expect(find(db, { search: 'drive' })).toEqual([ids.party, ids.later].sort())
    const moment = listMoments(db).find((m) => m.startsAt === T0 + 40 * DAY)!
    updateMoment(db, { momentId: moment.id, title: 'Birthday' })
    expect(find(db, { search: 'birthday' })).toEqual([ids.party])
  })

  it('treats % and _ in a search as plain characters', async () => {
    const { db, ids } = await library()
    expect(find(db, { search: '50%' })).toEqual([ids.percent])
    expect(find(db, { search: '%' })).toEqual([ids.percent])
    expect(find(db, { search: 'e_0' })).toEqual([])
  })

  it('filters by date range, folder, favorites and moment', async () => {
    const { db, drive, ids } = await library()
    expect(find(db, { from: T0 + DAY, to: T0 + 50 * DAY })).toEqual([ids.party])
    expect(find(db, { sourceId: drive.sourceId })).toEqual([ids.party, ids.later].sort())
    expect(find(db, { favoritesOnly: true })).toEqual([])
    db.prepare('INSERT INTO favorite VALUES (?, 0)').run(ids.later)
    expect(find(db, { favoritesOnly: true })).toEqual([ids.later])
    const firstMoment = listMoments(db).find((m) => m.startsAt === T0)!
    expect(find(db, { momentId: firstMoment.id })).toEqual([ids.beach, ids.percent].sort())
  })

  it('combines filters, and reports the total for the filtered set', async () => {
    const { db, home, ids } = await library()
    const result = queryLibrary(db, { limit: 1, filters: { sourceId: home.sourceId, search: 'jpg' } })
    expect(result.total).toBe(2)
    expect(result.items).toHaveLength(1)
    expect(result.nextCursor).not.toBeNull()
    expect(find(db, { sourceId: home.sourceId, search: 'beach' })).toEqual([ids.beach])
  })
})
