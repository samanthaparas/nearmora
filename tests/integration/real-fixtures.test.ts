/**
 * Scans the owner's approved real-photo fixture pack (fixtures/private, never committed) and checks the result
 * against the pack's own manifest. CI doesn't have the pack, so this suite skips there and runs on the owner's Mac.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { scanSource } from '../../src/main/library/scan'
import { addSourceFolder } from '../../src/main/library/source-folders'
import { processImage } from '../../src/main/media/process-image'
import { fingerprintFolder, watchForWrites } from '../support/originals-guard'
import { openTestCatalog, tempProfile } from './helpers'

const PACK = resolve('fixtures/private/Nearmora-Real-Photo-Fixtures-88')
const PHOTOS = join(PACK, 'photos')

interface ManifestFile {
  path: string
  sha256: string
  orientation?: number
  date_taken?: string
  width: number
  height: number
}

describe.skipIf(!existsSync(PHOTOS))('real fixture pack', () => {
  it('indexes all 88 files as 85 pictures, matches the manifest, and changes nothing (AC1, AC2)', async () => {
    const manifest = JSON.parse(readFileSync(join(PACK, 'manifest.json'), 'utf8')) as { files: ManifestFile[] }
    const profile = tempProfile()
    const db = await openTestCatalog(profile.catalogFile)
    const thumbnailsDir = join(profile.dir, 'thumbnails')
    mkdirSync(thumbnailsDir)
    const added = addSourceFolder(db, PHOTOS, profile.dir)
    if (!added.ok) throw new Error(added.reason)

    const before = fingerprintFolder(PHOTOS)
    // No sentinel files here: nothing is ever written into the owner's fixture folder, not even by tests. So this
    // watcher is best-effort (one started moments before a write can miss it); the fingerprint check is the proof.
    await sleep(300)
    const watcher = watchForWrites(PHOTOS)
    const started = performance.now()
    const { outcome, counts } = await scanSource({ db, thumbnailsDir, processImage }, added.source.id)
    const seconds = (performance.now() - started) / 1000
    await sleep(1000) // file events arrive late on a busy machine; give any write time to be reported

    // Safety first: no writes seen, and every file's bytes and modification time are unchanged.
    expect(watcher.stop()).toEqual([])
    expect(fingerprintFolder(PHOTOS)).toEqual(before)

    expect(outcome).toBe('done')
    expect(counts).toEqual({ found: 88, indexed: 88, unchanged: 0, unsupported: 0, corrupt: 0, tooLarge: 0, unreadable: 0 })
    expect((db.prepare('SELECT COUNT(*) AS n FROM asset').get() as { n: number }).n).toBe(85)

    // Each file's catalog record matches the manifest: same SHA-256, rotation applied to the stored size, dates read.
    // The manifest's width/height are as stored (before rotation). Rotation is read from the file itself, because
    // the manifest omits it for exact-duplicates/copy-01.jpg, a copy of a rotated burst frame.
    const record = db.prepare(
      `SELECT lower(hex(a.content_sha256)) AS sha, a.width, a.height, a.captured_at_source AS dateSource
       FROM asset a JOIN asset_location l ON l.asset_id = a.id WHERE l.relative_path = ?`,
    )
    for (const file of manifest.files) {
      const row = record.get(file.path.replace(/^photos\//, '')) as { sha: string; width: number; height: number; dateSource: string }
      expect(row.sha, file.path).toBe(file.sha256)
      const { orientation = 1 } = await sharp(join(PACK, file.path)).metadata()
      const sideways = orientation >= 5
      expect([row.width, row.height], file.path).toEqual(sideways ? [file.height, file.width] : [file.width, file.height])
      if (file.date_taken) expect(row.dateSource, file.path).toBe('exif')
    }

    console.log(`[real fixtures] 88 files, 85 pictures scanned in ${seconds.toFixed(2)} s`)
  }, 120_000)
})
