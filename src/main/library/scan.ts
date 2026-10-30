/**
 * Indexes one source folder: finds its photos, fingerprints them, makes thumbnails and records them in the catalog.
 * Every original is opened read-only. Unsupported, damaged and oversized files are counted, never hidden (AC2).
 */

import { createHash, randomUUID } from 'node:crypto'
import { accessSync, constants, createReadStream, existsSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { z } from 'zod'
import { ScanCounts } from '@shared/ipc-contract'
import type { Catalog } from '../catalog/database'
import { CatalogError } from '../catalog/errors'
import { findAssetIdBySha, recordAssetLocation, recordLocation } from '../catalog/repositories/assets'
import { getSource, setSourceStatus } from '../catalog/repositories/sources'
import { detectMediaType, MAX_FILE_BYTES, SIGNATURE_BYTES } from '../media/limits'
import type { ProcessImageRequest, ProcessImageResult } from '../media/process-image'
import { walkFiles, type FoundFile } from '../media/walk'
import { thumbnailPathForSha } from './thumbnails'

export type ScanOutcome = 'done' | 'paused' | 'cancelled' | 'failed'

/** Abort with this reason to pause: the scan stops after the current photo and can be resumed later. */
export const PAUSE = 'pause'

export interface ScanDeps {
  db: Catalog
  thumbnailsDir: string
  /** The media worker in the app; the plain function in tests. */
  processImage: (request: ProcessImageRequest) => Promise<ProcessImageResult>
  maxFileBytes?: number
}

export interface ScanOptions {
  /** Aborting stops the scan after the photos in flight. Abort with PAUSE to pause rather than cancel. */
  signal?: AbortSignal
  onProgress?: (counts: ScanCounts) => void
}

/** Two photos in flight at once, as the blueprint starts with; measured before changing. */
const CONCURRENCY = 2

// Reads only the first few bytes, through a read-only file handle.
async function readSignature(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(SIGNATURE_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, SIGNATURE_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

// Streams the file through SHA-256 so even a large photo never has to fit in memory at once.
function sha256File(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path, { flags: 'r' })
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest()))
  })
}

interface KnownLocation {
  size_bytes: number
  mtime_ms: number
  availability: string
  content_sha256: Buffer
}

export async function scanSource(deps: ScanDeps, sourceId: string, options: ScanOptions = {}): Promise<{ outcome: ScanOutcome; counts: ScanCounts }> {
  const { db, thumbnailsDir } = deps
  const maxFileBytes = deps.maxFileBytes ?? MAX_FILE_BYTES
  const source = getSource(db, sourceId)
  // A folder that went offline must be verified as the same folder before scanning again (see reconnect.ts).
  if (source.status === 'disconnected') throw new CatalogError('CONFLICT', 'Reconnect this folder before scanning it')
  const counts: ScanCounts = { found: 0, indexed: 0, unchanged: 0, unsupported: 0, corrupt: 0, tooLarge: 0, unreadable: 0 }
  const seen = new Set<string>()

  const jobId = randomUUID()
  const now = Date.now()
  db.prepare(`INSERT INTO job (id, kind, status, source_id, created_at, updated_at) VALUES (?, 'scan', 'running', ?, ?, ?)`).run(
    jobId,
    sourceId,
    now,
    now,
  )
  // The job row keeps the counts, so progress and skipped-file explanations survive a quit or crash.
  const saveCheckpoint = (status: ScanOutcome | 'running') =>
    db.prepare('UPDATE job SET status = ?, checkpoint = ?, updated_at = ? WHERE id = ?').run(status, JSON.stringify({ sourceId, counts }), Date.now(), jobId)
  const finish = (outcome: ScanOutcome) => {
    saveCheckpoint(outcome)
    return { outcome, counts: { ...counts } }
  }

  // Can we reach and read the folder? A missing one is usually an unplugged drive; mark it, never treat its photos as deleted.
  const access = rootAccess(source.rootPath)
  if (access !== 'ok') {
    setSourceStatus(db, sourceId, access)
    return finish('failed')
  }
  if (source.status !== 'active') setSourceStatus(db, sourceId, 'active')

  const knownLocation = db.prepare(
    `SELECT l.size_bytes, l.mtime_ms, l.availability, a.content_sha256
     FROM asset_location l JOIN asset a ON a.id = l.asset_id
     WHERE l.source_id = ? AND l.relative_path = ?`,
  )
  let lastProgress = 0
  const report = (force = false) => {
    if (!options.onProgress) return
    if (!force && Date.now() - lastProgress < 200) return
    lastProgress = Date.now()
    saveCheckpoint('running')
    options.onProgress({ ...counts })
  }

  async function indexFile(file: FoundFile): Promise<void> {
    counts.found++
    seen.add(file.relativePath)

    // Unchanged since the last scan (same size and modification time) and its thumbnail is still cached: skip the work.
    const known = knownLocation.get(sourceId, file.relativePath) as KnownLocation | undefined
    if (known && known.size_bytes === file.sizeBytes && known.mtime_ms === file.mtimeMs && existsSync(thumbnailPathForSha(thumbnailsDir, known.content_sha256))) {
      if (known.availability !== 'available') {
        db.prepare(`UPDATE asset_location SET availability = 'available' WHERE source_id = ? AND relative_path = ?`).run(sourceId, file.relativePath)
      }
      counts.unchanged++
      return
    }

    let sha: Buffer
    let mediaType
    try {
      mediaType = detectMediaType(await readSignature(file.absolutePath))
      if (!mediaType) {
        counts.unsupported++
        return
      }
      // Size is checked after type, so a big video counts as "not a photo" rather than "too large".
      if (file.sizeBytes > maxFileBytes) {
        counts.tooLarge++
        return
      }
      sha = await sha256File(file.absolutePath)
    } catch {
      counts.unreadable++
      return
    }

    const location = { sourceId, relativePath: file.relativePath, sizeBytes: file.sizeBytes, mtimeMs: file.mtimeMs }
    const thumbnailPath = thumbnailPathForSha(thumbnailsDir, sha)
    const existingAssetId = findAssetIdBySha(db, sha)
    // Identical bytes already catalogued (another copy, or a renamed file): add this path to that picture.
    if (existingAssetId && existsSync(thumbnailPath)) {
      recordLocation(db, { assetId: existingAssetId, ...location })
      counts.indexed++
      return
    }

    const result = await deps.processImage({ sourcePath: file.absolutePath, thumbnailPath })
    if (!result.ok) {
      if (result.reason === 'too_large') counts.tooLarge++
      else counts.corrupt++
      return
    }
    recordAssetLocation(db, {
      ...location,
      contentSha256: sha,
      mediaType,
      width: result.width,
      height: result.height,
      orientation: result.orientation,
      // No "date taken" in the photo: fall back to the file's modification date, and say so.
      capturedAt: result.capturedAt ?? file.mtimeMs,
      capturedAtSource: result.capturedAt === null ? 'file_mtime' : 'exif',
      dhash: Buffer.from(result.dhash, 'hex'),
    })
    counts.indexed++
  }

  const files = walkFiles(source.rootPath, () => counts.unreadable++, options.signal)
  // Each lane pulls the next file from the shared walker, so at most CONCURRENCY photos are in flight.
  const lane = async () => {
    for (;;) {
      if (options.signal?.aborted) return
      const next = await files.next()
      if (next.done) return
      await indexFile(next.value)
      report()
    }
  }

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, lane))
  } catch (error: unknown) {
    console.error('[scan] failed', error)
    report(true)
    return finish('failed')
  }
  report(true)
  if (options.signal?.aborted) return finish(options.signal.reason === PAUSE ? 'paused' : 'cancelled')

  // The drive vanished during the scan: files it "didn't see" aren't gone, so mark the folder and report failure,
  // never a false "done" (AC5).
  const accessAfter = rootAccess(source.rootPath)
  if (accessAfter !== 'ok') {
    setSourceStatus(db, sourceId, accessAfter)
    return finish('failed')
  }

  // A full scan saw every file that exists now; paths it didn't see are marked missing, never deleted.
  const markMissing = db.prepare(`UPDATE asset_location SET availability = 'missing' WHERE source_id = ? AND relative_path = ?`)
  const paths = db.prepare('SELECT relative_path FROM asset_location WHERE source_id = ?').all(sourceId) as Array<{ relative_path: string }>
  db.transaction(() => {
    for (const { relative_path } of paths) if (!seen.has(relative_path)) markMissing.run(sourceId, relative_path)
    db.prepare('UPDATE source SET last_scan_at = ? WHERE id = ?').run(Date.now(), sourceId)
  })()
  return finish('done')
}

// Distinguishes "not there" (unplugged, moved) from "there but not readable" (macOS privacy or file permissions).
export function rootAccess(root: string): 'ok' | 'disconnected' | 'permission_denied' {
  if (!existsSync(root)) return 'disconnected'
  try {
    accessSync(root, constants.R_OK | constants.X_OK)
    return 'ok'
  } catch {
    return 'permission_denied'
  }
}

export interface LastScan {
  state: ScanOutcome
  counts: ScanCounts
}

/** The latest scan that isn't running now, for explaining skipped files and offering to resume a paused one. */
export function lastScan(db: Catalog, sourceId: string): LastScan | null {
  const row = db
    .prepare(
      `SELECT status, checkpoint FROM job
       WHERE kind = 'scan' AND source_id = ? AND status IN ('done', 'paused', 'cancelled', 'failed')
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(sourceId) as { status: ScanOutcome; checkpoint: string | null } | undefined
  if (!row) return null
  const parsed = z.object({ counts: ScanCounts }).safeParse(JSON.parse(row.checkpoint ?? 'null'))
  return parsed.success ? { state: row.status, counts: parsed.data.counts } : null
}

/**
 * Run at startup: a scan still marked running belongs to a previous session that quit or crashed mid-scan.
 * It becomes paused, so the Library offers to resume it instead of pretending it finished.
 */
export function markInterruptedScansPaused(db: Catalog): number {
  return db.prepare(`UPDATE job SET status = 'paused', updated_at = ? WHERE kind = 'scan' AND status = 'running'`).run(Date.now()).changes
}
