/**
 * Measures similar-photo grouping on the owner's labelled fixture pack (AC3): the pack's manifest says which
 * photos are bursts of the same scene. Runs only where the private pack exists (not in CI), prints the scores
 * for the evidence notes, and asserts only the rules that must always hold, not a target score.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { scanSource } from '../../src/main/library/scan'
import { findSimilarGroups, readHashedPictures, SIMILARITY_CURRENT, SIMILARITY_V1, SIMILARITY_V2, type SimilarityParams } from '../../src/main/library/similarity'
import { regroupSimilaritySets } from '../../src/main/library/regroup-sets'
import { addSourceFolder } from '../../src/main/library/source-folders'
import { processImage } from '../../src/main/media/process-image'
import { scoreGrouping } from '../support/grouping-metrics'
import { openTestCatalog, tempProfile } from './helpers'

const PACK = resolve('fixtures/private/Nearmora-Real-Photo-Fixtures-88')
const PHOTOS = join(PACK, 'photos')

describe.skipIf(!existsSync(PHOTOS))('similar-photo grouping on the labelled fixture pack', () => {
  it('reports precision and recall for v1 and nearby settings', async () => {
    const profile = tempProfile()
    const db = await openTestCatalog(profile.catalogFile)
    const thumbnailsDir = join(profile.dir, 'thumbnails')
    mkdirSync(thumbnailsDir)
    const added = addSourceFolder(db, PHOTOS, profile.dir)
    if (!added.ok) throw new Error(added.reason)
    await scanSource({ db, thumbnailsDir, processImage }, added.source.id)

    // Answer key: the manifest's burst groups, as asset ids (identical copies are already the same asset).
    const manifest = JSON.parse(readFileSync(join(PACK, 'manifest.json'), 'utf8')) as {
      files: Array<{ path: string; category: string; group?: string }>
    }
    const assetFor = db.prepare('SELECT asset_id FROM asset_location WHERE relative_path = ?').pluck()
    const truthGroups = new Map<string, Set<string>>()
    for (const file of manifest.files) {
      if (file.category !== 'real_burst_frame' || !file.group) continue
      const assetId = assetFor.get(file.path.replace(/^photos\//, '')) as string
      truthGroups.set(file.group, (truthGroups.get(file.group) ?? new Set()).add(assetId))
    }
    const truth = [...truthGroups.values()].map((s) => [...s])
    const burstAssets = new Set(truth.flat())
    const exifBurst = (db.prepare(`SELECT COUNT(*) FROM asset WHERE captured_at_source = 'exif'`).pluck().get() as number)

    // The rule as specified, then a sweep of nearby settings to inform the decision (not to tune on 88 photos).
    const rows: string[] = []
    const settings: Array<Pick<SimilarityParams, 'maxDistance' | 'windowMs' | 'dateSources' | 'fileDatesSameFolderOnly'> & { label: string }> = [
      { label: 'v1: EXIF dates only', ...SIMILARITY_V1 },
      { label: 'v2 (in use): EXIF dates, or file dates within the same folder', ...SIMILARITY_V2 },
      ...[6, 10, 14, 18].flatMap((maxDistance) =>
        [120_000, 600_000].flatMap((windowMs) =>
          (['exif-only', 'exif+file'] as const).map((dates) => ({
            label: `t${maxDistance}, ${windowMs / 1000} s, ${dates}`,
            maxDistance,
            windowMs,
            dateSources: dates === 'exif-only' ? (['exif'] as const) : (['exif', 'file_mtime'] as const),
          })),
        ),
      ),
    ]
    for (const setting of settings) {
      const groups = findSimilarGroups(readHashedPictures(db, { dateSources: [...setting.dateSources] }), setting)
      const score = scoreGrouping(groups, truth)
      const strays = groups.flat().filter((id) => !burstAssets.has(id)).length
      rows.push(
        `| ${setting.label} | ${groups.length} | ${(score.precision * 100).toFixed(0)}% | ${(score.recall * 100).toFixed(0)}% | ` +
          `${score.complete}/${score.partial}/${score.missed} | ${score.impure} | ${strays} |`,
      )
    }
    console.log(`[eval] ${truth.length} labelled bursts, ${burstAssets.size} burst photos; ${exifBurst} photos have an EXIF date`)
    console.log('| Setting | Sets | Precision | Recall | Bursts complete/partial/missed | Impure sets | Non-burst photos in sets |')
    console.log('|---|---|---|---|---|---|---|')
    for (const row of rows) console.log(row)

    // Rules that must hold whatever the scores: identical copies are never their own set, and sets carry the version.
    const summary = regroupSimilaritySets(db)
    const versions = db.prepare('SELECT DISTINCT algorithm_version FROM similarity_set').pluck().all()
    expect(summary.sets).toBe(findSimilarGroups(readHashedPictures(db, SIMILARITY_CURRENT), SIMILARITY_CURRENT).length)
    if (summary.sets > 0) expect(versions).toEqual([SIMILARITY_CURRENT.version])
    const singleAssetSets = db.prepare('SELECT COUNT(*) FROM (SELECT set_id FROM set_asset GROUP BY set_id HAVING COUNT(*) < 2)').pluck().get()
    expect(singleAssetSets).toBe(0)
  }, 120_000)
})
