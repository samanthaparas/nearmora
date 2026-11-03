/**
 * Exporting a Memory Studio project (AC7, AC8). Before anything is written, every photo must be reachable and its
 * original must still be the exact file that was catalogued (re-fingerprinted). Files are rendered into a hidden
 * staging folder on the destination drive, checked, and only then renamed in one step into a fresh, uniquely named
 * folder. A full disk, a cancel or a crash never leaves a finished-looking set, and nothing is ever overwritten.
 */

import { createHash, randomUUID } from 'node:crypto'
import { accessSync, constants, createReadStream, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { compose } from '@shared/studio/compose'
import { FORMATS, PRINT_PPI } from '@shared/studio/formats'
import { layers } from '@shared/studio/layers'
import { sliceWidths } from '@shared/studio/slices'
import type { Catalog } from '../catalog/database'
import { getProject } from '../catalog/repositories/projects'
import { listSources } from '../catalog/repositories/sources'
import { isSameOrInside } from '../library/source-folders'
import type { RenderLayer, RenderRequest, RenderResult } from '../media/render-export'

export const JPEG_QUALITY = 92
const STAGING_PREFIX = '.nearmora-export-'

export type ExportRefusal =
  | { status: 'refused'; reason: 'unavailable' | 'changed'; files: string[] }
  | { status: 'refused'; reason: 'inside_source' | 'app_data' | 'unwritable' }

export interface ExportPlan {
  projectId: string
  title: string
  destinationDir: string
  width: number
  height: number
  background: string
  /** The frame around each photo, in canvas pixels. */
  border: { width: number; color: string }
  /** Pixels per inch recorded in print-size files; null for sharing sizes. */
  ppi: number | null
  /** Each canvas to draw, and the files it becomes: one, or a seamless design's slides with their widths. */
  outputs: Array<{ files: Array<{ fileName: string; width: number }>; layers: RenderLayer[] }>
}

/** Every file an export writes, in order. */
export const planFiles = (plan: Pick<ExportPlan, 'outputs'>): string[] => plan.outputs.flatMap((o) => o.files.map((f) => f.fileName))

export type ExportOutcome =
  | { status: 'done'; folder: string; files: string[] }
  | { status: 'failed'; reason: 'disk_full' | 'unreadable' | 'failed' | 'verify_failed' }
  | { status: 'cancelled' }

/** A file and folder name that is safe on macOS and Windows and never hidden. */
export function safeName(title: string): string {
  const cleaned = [...title]
    .map((c) => (c.charCodeAt(0) < 32 ? '-' : c)) // control characters can't appear in file names
    .join('')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim()
  return cleaned || 'Nearmora export'
}

function sha256(path: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path, { flags: 'r' })
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest()))
  })
}

/**
 * Checks everything before a single byte is written: where the files would go, that every photo is reachable, and
 * that each original is still the same file (same size and date, and the same SHA-256 as when it was catalogued).
 */
export async function prepareExport(
  db: Catalog,
  input: { projectId: string; destinationDir: string; appDataDir: string },
): Promise<{ status: 'ready'; plan: ExportPlan } | ExportRefusal> {
  // Outputs never go inside a photo folder (it would be scanned as photos) or inside Nearmora's own data.
  let destination: string
  try {
    destination = realpathSync.native(input.destinationDir)
    if (!statSync(destination).isDirectory()) return { status: 'refused', reason: 'unwritable' }
    accessSync(destination, constants.W_OK)
  } catch {
    return { status: 'refused', reason: 'unwritable' }
  }
  if (isSameOrInside(realpathSync.native(input.appDataDir), destination)) return { status: 'refused', reason: 'app_data' }
  if (listSources(db).some((source) => isSameOrInside(source.rootPath, destination))) return { status: 'refused', reason: 'inside_source' }

  const project = getProject(db, input.projectId)
  const original = db.prepare(
    `SELECT s.root_path, l.relative_path, l.size_bytes, l.mtime_ms, a.content_sha256 FROM asset a
     JOIN asset_location l ON l.asset_id = a.id AND l.availability = 'available'
     JOIN source s ON s.id = l.source_id AND s.status = 'active'
     WHERE a.id = ? ORDER BY l.relative_path`,
  )
  const unavailable: string[] = []
  const changed: string[] = []
  const paths: string[] = []
  for (const item of project.items) {
    const candidates = original.all(item.assetId) as Array<{ root_path: string; relative_path: string; size_bytes: number; mtime_ms: number; content_sha256: Buffer }>
    let found: string | undefined
    for (const c of candidates) {
      const path = join(c.root_path, c.relative_path)
      try {
        const stats = statSync(path)
        // A different size or date means the file was edited or replaced since it was catalogued.
        if (stats.size !== c.size_bytes || Math.floor(stats.mtimeMs) !== c.mtime_ms) continue
        if (!(await sha256(path)).equals(c.content_sha256)) continue
        found = path
        break
      } catch {
        continue
      }
    }
    if (found) paths.push(found)
    else if (candidates.length > 0) changed.push(candidates[0]!.relative_path.split('/').at(-1)!)
    else unavailable.push(item.fileName ?? 'a photo')
  }
  if (unavailable.length > 0) return { status: 'refused', reason: 'unavailable', files: unavailable }
  if (changed.length > 0) return { status: 'refused', reason: 'changed', files: changed }

  // The same composition the editor's preview draws: same template, format, settings and photo positions.
  const composition = compose({ ...project, photoCount: project.items.length })
  const name = safeName(project.title)
  // Slides are numbered, zero-padded, so they sort in posting order everywhere (01 … 09, 10).
  const numbered = (i: number) => `${name} ${String(i + 1).padStart(2, '0')}.jpg`
  const outputs: ExportPlan['outputs'] = Array.from({ length: composition.canvasCount }, (_, i) => ({
    files:
      composition.mode === 'seamless'
        ? sliceWidths(composition.width, composition.slices).map((width, slice) => ({ fileName: numbered(slice), width }))
        : [{ fileName: composition.mode === 'carousel' ? numbered(i) : `${name}.jpg`, width: composition.width }],
    layers: [],
  }))
  // Each file's drawing order, shared with the preview; photos gain the path of their verified original.
  for (const [canvas, output] of outputs.entries()) {
    output.layers = layers(composition, canvas).map((layer): RenderLayer => {
      if (layer.kind === 'shape') return layer
      const item = project.items[layer.element.slot]!
      return { kind: 'photo', sourcePath: paths[layer.element.slot]!, crop: item.crop, fit: item.fit, element: layer.element }
    })
  }
  return {
    status: 'ready',
    plan: {
      projectId: project.id,
      title: project.title,
      destinationDir: destination,
      width: composition.width,
      height: composition.height,
      background: composition.background,
      border: composition.border,
      ppi: FORMATS[project.format].use === 'print' ? PRINT_PPI : null,
      outputs,
    },
  }
}

// Removes a staging folder this code created, and nothing else: the name must carry our prefix.
function removeStaging(path: string): void {
  if (basename(path).startsWith(STAGING_PREFIX)) rmSync(path, { recursive: true, force: true })
}

// "Nearmora <title> <date>", with (2), (3)… if that name is taken. Never reuses an existing folder.
function freshFolderName(destination: string, title: string, now: Date): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const base = `Nearmora ${safeName(title)} ${date}`
  for (let n = 1; n < 1000; n++) {
    const candidate = join(destination, n === 1 ? base : `${base} (${n})`)
    if (!existsSync(candidate)) return candidate
  }
  throw new Error('No free folder name')
}

/**
 * Each file has the planned size, is a JPEG with full-resolution colour, carries no EXIF, XMP or IPTC, and (for print
 * sizes) records the print density; and nothing else is in the folder.
 */
async function verifyOutputs(staging: string, plan: ExportPlan): Promise<boolean> {
  const expected = plan.outputs.flatMap((o) => o.files)
  if (JSON.stringify(readdirSync(staging).sort()) !== JSON.stringify(expected.map((f) => f.fileName).sort())) return false
  for (const { fileName, width } of expected) {
    const meta = await sharp(join(staging, fileName)).metadata()
    if (meta.format !== 'jpeg' || meta.width !== width || meta.height !== plan.height) return false
    if (meta.chromaSubsampling !== '4:4:4') return false
    if (meta.exif || meta.xmp || meta.iptc) return false
    if (plan.ppi && meta.density !== plan.ppi) return false
  }
  return true
}

export async function runExport(
  deps: { db: Catalog; render: (request: RenderRequest) => Promise<RenderResult>; now?: () => Date },
  plan: ExportPlan,
  options: { jobId?: string; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ExportOutcome & { jobId: string }> {
  const { db } = deps
  const jobId = options.jobId ?? randomUUID()
  const staging = join(plan.destinationDir, `${STAGING_PREFIX}${jobId}`)
  const now = Date.now()
  db.prepare(`INSERT INTO job (id, kind, status, checkpoint, created_at, updated_at) VALUES (?, 'export', 'running', ?, ?, ?)`).run(
    jobId,
    JSON.stringify({ projectId: plan.projectId, staging }),
    now,
    now,
  )
  const finish = (outcome: ExportOutcome) => {
    if (outcome.status !== 'done') removeStaging(staging)
    const status = outcome.status === 'done' ? 'done' : outcome.status === 'cancelled' ? 'cancelled' : 'failed'
    db.prepare('UPDATE job SET status = ?, error_code = ?, checkpoint = ?, updated_at = ? WHERE id = ?').run(
      status,
      outcome.status === 'failed' ? outcome.reason : null,
      JSON.stringify(outcome.status === 'done' ? { projectId: plan.projectId, folder: outcome.folder } : { projectId: plan.projectId, staging }),
      Date.now(),
      jobId,
    )
    return { ...outcome, jobId }
  }

  try {
    mkdirSync(staging)
  } catch (error: unknown) {
    const full = error instanceof Error && 'code' in error && error.code === 'ENOSPC'
    return finish({ status: 'failed', reason: full ? 'disk_full' : 'failed' })
  }

  for (const [index, output] of plan.outputs.entries()) {
    if (options.signal?.aborted) return finish({ status: 'cancelled' })
    const result = await deps.render({
      outputPaths: output.files.map((f) => join(staging, f.fileName)),
      width: plan.width,
      height: plan.height,
      background: plan.background,
      border: plan.border,
      ppi: plan.ppi,
      quality: JPEG_QUALITY,
      layers: output.layers,
    })
    if (!result.ok) return finish({ status: 'failed', reason: result.reason })
    options.onProgress?.(plan.outputs.slice(0, index + 1).reduce((n, o) => n + o.files.length, 0), planFiles(plan).length)
  }
  if (options.signal?.aborted) return finish({ status: 'cancelled' })
  if (!(await verifyOutputs(staging, plan))) return finish({ status: 'failed', reason: 'verify_failed' })

  // One rename on the same drive: the finished folder appears complete or not at all.
  try {
    const folder = freshFolderName(plan.destinationDir, plan.title, deps.now?.() ?? new Date())
    renameSync(staging, folder)
    return finish({ status: 'done', folder, files: planFiles(plan) })
  } catch {
    return finish({ status: 'failed', reason: 'failed' })
  }
}

/**
 * Run at startup: an export still marked running was cut off by a quit or crash. Its staging folder (only ever
 * ours, by name) is removed and the job marked failed, so nothing half-made looks finished. Retrying starts afresh.
 */
export function recoverInterruptedExports(db: Catalog): number {
  const jobs = db.prepare(`SELECT id, checkpoint FROM job WHERE kind = 'export' AND status = 'running'`).all() as Array<{ id: string; checkpoint: string | null }>
  for (const job of jobs) {
    try {
      const { staging } = JSON.parse(job.checkpoint ?? '{}') as { staging?: string }
      if (staging && basename(staging) === `${STAGING_PREFIX}${job.id}`) removeStaging(staging)
    } catch {
      // A damaged checkpoint can't name a folder; there's nothing safe to remove.
    }
    db.prepare(`UPDATE job SET status = 'failed', error_code = 'interrupted', updated_at = ? WHERE id = ?`).run(Date.now(), job.id)
  }
  return jobs.length
}
