/**
 * Integration tests for controlling scans and handling folders that change state (R3b part 1, AC2, AC5):
 * pause and resume, recovery after quitting mid-scan, permission problems, unplugging a drive mid-scan,
 * reconnecting only the same folder, and removing a folder after reviewing the impact.
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { MainEvent } from '@shared/ipc-contract'
import type { Catalog } from '../../src/main/catalog/database'
import { createAlbum, setAlbumMembers } from '../../src/main/catalog/repositories/albums'
import { queryLibrary } from '../../src/main/catalog/repositories/library'
import { saveReview } from '../../src/main/catalog/repositories/review'
import { createSimilaritySet } from '../../src/main/catalog/repositories/sets'
import { getSource } from '../../src/main/catalog/repositories/sources'
import { createLibraryService } from '../../src/main/library/library-service'
import { lastScan, markInterruptedScansPaused } from '../../src/main/library/scan'
import { processImage, type ProcessImageRequest } from '../../src/main/media/process-image'
import { generatePhotoFolder } from '../support/generate-photos'
import { fingerprintFolder } from '../support/originals-guard'
import { openTestCatalog, tempDir, tempProfile } from './helpers'

type Processor = (request: ProcessImageRequest) => ReturnType<typeof processImage>

async function setup(options: { folder?: string; processImage?: Processor } = {}) {
  const profile = tempProfile()
  const db = await openTestCatalog(profile.catalogFile)
  const thumbnailsDir = join(profile.dir, 'thumbnails')
  mkdirSync(thumbnailsDir)
  const events: MainEvent[] = []
  let processor: Processor = options.processImage ?? processImage
  const library = createLibraryService({
    db,
    appDataDir: profile.dir,
    thumbnailsDir,
    processImage: (request) => processor(request),
    emit: (event) => events.push(event),
  })
  const root = options.folder ?? (await generatePhotoFolder(join(tempDir(), 'Photos'))).root
  const added = library.addFolder(root)
  if (!added.ok) throw new Error(added.reason)
  const sourceId = added.source.id

  // Resolves with the end state of the current scan (anything but 'running').
  const scanEnd = async (): Promise<MainEvent['state']> => {
    for (;;) {
      const done = events.find((e) => e.sourceId === sourceId && e.state !== 'running')
      if (done) {
        events.splice(0)
        return done.state
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  const setProcessor = (next: Processor) => {
    processor = next
  }
  return { db, library, sourceId, root, scanEnd, setProcessor }
}

const locations = (db: Catalog) => (db.prepare('SELECT COUNT(*) AS n FROM asset_location').get() as { n: number }).n

describe('pause and resume', () => {
  it('pausing stops after the photo in flight; resuming finishes without duplicates', async () => {
    const env = await setup()
    // Pause as soon as the first photo finishes processing.
    env.setProcessor((request) => processImage(request).finally(() => env.library.pauseScan(env.sourceId)))
    expect(await env.scanEnd()).toBe('paused')
    expect(lastScan(env.db, env.sourceId)?.state).toBe('paused')
    const partial = locations(env.db)
    expect(partial).toBeLessThan(6)

    env.setProcessor(processImage)
    expect(env.library.startScan(env.sourceId)).toBe(true)
    expect(await env.scanEnd()).toBe('done')
    expect(locations(env.db)).toBe(6)
    expect(lastScan(env.db, env.sourceId)?.state).toBe('done')
  })

  it('a scan cut off by quitting or a crash is offered as paused at the next launch, not shown as finished', async () => {
    const { db, sourceId } = await setup({ processImage: () => new Promise(() => {}) }) // never finishes: the "crash"
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(lastScan(db, sourceId)).toBeNull() // still running, so nothing to report yet

    expect(markInterruptedScansPaused(db)).toBe(1)
    expect(lastScan(db, sourceId)?.state).toBe('paused')
  })
})

describe('folder permissions', () => {
  it('a folder that can no longer be read is marked permission_denied, then active again once fixed', async () => {
    const env = await setup()
    await env.scanEnd()
    chmodSync(env.root, 0o000) // the test's own generated folder
    try {
      expect(env.library.listSources()[0]?.status).toBe('permission_denied')
      expect(env.library.startScan(env.sourceId)).toBe(true)
      expect(await env.scanEnd()).toBe('failed')
    } finally {
      chmodSync(env.root, 0o755)
    }
    expect(env.library.listSources()[0]?.status).toBe('active')
  })
})

describe('disconnected folders', () => {
  it('a vanished folder is disconnected, its photos stay visible offline, and it reconnects only after verification', async () => {
    const env = await setup()
    await env.scanEnd()
    const parked = join(tempDir(), 'parked')
    cpSync(env.root, parked, { recursive: true, preserveTimestamps: true })
    rmSync(env.root, { recursive: true }) // "unplug": the generated folder disappears

    expect(env.library.listSources()[0]?.status).toBe('disconnected')
    expect(env.library.startScan(env.sourceId)).toBe(false) // can't scan until reconnected
    const offline = queryLibrary(env.db, { limit: 50 })
    expect(offline.total).toBe(5)
    expect(offline.items.every((item) => item.offline)).toBe(true)
    expect(await env.library.reconnect(env.sourceId)).toBe('unavailable')

    cpSync(parked, env.root, { recursive: true, preserveTimestamps: true }) // "plug back in": same photos
    expect(await env.library.reconnect(env.sourceId)).toBe('reconnected')
    expect(await env.scanEnd()).toBe('done')
    expect(getSource(env.db, env.sourceId).status).toBe('active')
    expect(queryLibrary(env.db, { limit: 50 }).items.some((item) => item.offline)).toBe(false)
    expect(locations(env.db)).toBe(6)
  })

  it('refuses to reconnect a different folder that appears at the same path', async () => {
    const env = await setup()
    await env.scanEnd()
    rmSync(env.root, { recursive: true })
    env.library.listSources()
    // Different photos under the same file names, standing in for a different drive that happens to share a name.
    mkdirSync(join(env.root, 'nested', 'deeper'), { recursive: true })
    mkdirSync(join(env.root, 'copies'))
    for (const name of ['dated.jpg', 'rotated.jpg', 'nested/nested.jpg', 'nested/deeper/deep.jpg', 'copies/dated-copy.jpg']) {
      await sharp({ create: { width: 30, height: 30, channels: 3, background: '#123456' } }).jpeg().toFile(join(env.root, name))
    }
    await sharp({ create: { width: 30, height: 30, channels: 3, background: '#654321' } }).png().toFile(join(env.root, 'screenshot.png'))

    expect(await env.library.reconnect(env.sourceId)).toBe('different_folder')
    expect(getSource(env.db, env.sourceId).status).toBe('disconnected')
  })
})

// Unplugging a real volume mid-scan. Uses a small disk image the test creates, mounts and force-ejects itself.
describe.skipIf(process.platform !== 'darwin')('unplugging a drive mid-scan (AC5)', () => {
  it('ends as failed and disconnected, never "done", marks nothing missing, and recovers after reconnecting', async () => {
    const work = tempDir()
    const image = join(work, 'drive.dmg')
    const mount = join(work, 'mnt')
    mkdirSync(mount)
    execFileSync('hdiutil', ['create', '-size', '16m', '-fs', 'HFS+', '-volname', 'NearmoraTest', image], { stdio: 'ignore' })
    const attach = () => execFileSync('hdiutil', ['attach', image, '-nobrowse', '-mountpoint', mount], { stdio: 'ignore' })
    const eject = () => execFileSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore' })
    attach()
    try {
      const folder = await generatePhotoFolder(join(mount, 'Photos'))
      // First, a complete scan, so there are records that must survive the unplug.
      const env = await setup({ folder: folder.root })
      expect(await env.scanEnd()).toBe('done')
      const before = fingerprintFolder(folder.root)

      // Rescan with changed thumbnails so photos are reprocessed, and eject the volume during the first one.
      env.db.prepare('UPDATE asset_location SET mtime_ms = mtime_ms - 1').run() // forces each file to be re-read
      let ejected = false
      env.setProcessor(async (request) => {
        if (!ejected) {
          ejected = true
          eject()
        }
        return processImage(request)
      })
      expect(env.library.startScan(env.sourceId)).toBe(true)
      expect(await env.scanEnd()).toBe('failed')
      expect(getSource(env.db, env.sourceId).status).toBe('disconnected')
      expect((env.db.prepare(`SELECT COUNT(*) AS n FROM asset_location WHERE availability = 'missing'`).get() as { n: number }).n).toBe(0)
      expect(queryLibrary(env.db, { limit: 50 }).items.every((item) => item.offline)).toBe(true)

      // Plug back in: verified, rescanned, back online, and the files on the volume never changed.
      attach()
      env.setProcessor(processImage)
      expect(await env.library.reconnect(env.sourceId)).toBe('reconnected')
      expect(await env.scanEnd()).toBe('done')
      expect(locations(env.db)).toBe(6)
      expect(fingerprintFolder(folder.root)).toEqual(before)
    } finally {
      try {
        eject()
      } catch {
        // already ejected
      }
    }
  }, 60_000)
})

describe('removing a folder', () => {
  it('shows the impact first, then forgets only catalog rows: files stay, choices for shared pictures stay', async () => {
    const env = await setup()
    await env.scanEnd()
    const before = fingerprintFolder(env.root)
    const assets = queryLibrary(env.db, { limit: 50 }).items.map((item) => item.id)
    const setId = createSimilaritySet(env.db, { reason: 'manual', algorithmVersion: 'test@1', assetIds: assets.slice(0, 2) })
    saveReview(env.db, { setId, favorites: [assets[0]!], status: 'reviewed', expectedRevision: 0 })
    const album = createAlbum(env.db, 'Trip')
    setAlbumMembers(env.db, album.id, [assets[1]!])

    expect(env.library.removalImpact(env.sourceId)).toEqual({ photoFiles: 6, picturesOnlyHere: 5, favoritesOnlyHere: 1, albumsAffected: 1 })
    expect(env.library.remove(env.sourceId)).toBe(true)

    expect(locations(env.db)).toBe(0)
    expect(queryLibrary(env.db, { limit: 50 }).total).toBe(0)
    // The pictures' records, favorites and albums are kept, so re-adding the folder brings them back.
    expect((env.db.prepare('SELECT COUNT(*) AS n FROM favorite').get() as { n: number }).n).toBe(1)
    expect(fingerprintFolder(env.root)).toEqual(before)
  })

  it('is refused while the folder is scanning', async () => {
    const env = await setup({ processImage: () => new Promise(() => {}) })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(env.library.remove(env.sourceId)).toBe(false)
  })
})
