/**
 * A built-in diagnostic, run with `--self-test`, that proves the native libraries load and work inside this exact build.
 * It's how CI checks a packaged app, since packaged apps (correctly) block test tools from attaching.
 * It touches no user files and no network: in-memory databases, and generated images in a temporary folder it deletes.
 * Since S7 it also has the packaged media worker render a playful layout with a caption and a seamless design cut into
 * slides, proving the bundled caption font, text outlines and slicing work in the package, not just in development.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import { IN_MEMORY, openCatalog } from './catalog/database'
import { MIGRATIONS } from './catalog/migrations'
import { latestVersion, readSchemaVersion } from './catalog/migrate'
import { MediaWorker } from './media/worker-client'
import { DEFAULT_CROP } from '@shared/layout'
import { compose } from '@shared/studio/compose'
import { layers } from '@shared/studio/layers'
import type { RenderLayer } from './media/render-export'

export const SELF_TEST_FLAG = '--self-test'
/** Prefix on the single output line, so the smoke test can find it among Electron's own logging. */
export const SELF_TEST_MARKER = 'NEARMORA_SELF_TEST '

export interface SelfTestReport {
  ok: boolean
  electron: string | undefined
  sqlite: { ok: boolean; version?: string; error?: string }
  sharp: { ok: boolean; libvips?: string; error?: string }
  catalog: { ok: boolean; schemaVersion?: number; error?: string }
  mediaWorker: { ok: boolean; error?: string }
  studio: { ok: boolean; error?: string }
}

// Exercises the SQLite features later milestones depend on: foreign keys, transactions and joins.
function checkSqlite(): SelfTestReport['sqlite'] {
  const db = new Database(':memory:')
  try {
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE source (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE asset (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES source(id));
    `)
    const insert = db.transaction(() => {
      db.prepare('INSERT INTO source (id, name) VALUES (1, ?)').run('fixture')
      db.prepare('INSERT INTO asset (source_id) VALUES (1), (1)').run()
    })
    insert()

    const row = db
      .prepare('SELECT s.name AS name, COUNT(a.id) AS count FROM source s JOIN asset a ON a.source_id = s.id GROUP BY s.id')
      .get() as { name: string; count: number } | undefined
    const fkEnforced = (() => {
      try {
        db.prepare('INSERT INTO asset (source_id) VALUES (999)').run()
        return false
      } catch {
        return true
      }
    })()

    const { version } = db.prepare('SELECT sqlite_version() AS version').get() as { version: string }
    const ok = row?.name === 'fixture' && row.count === 2 && fkEnforced
    return ok ? { ok, version } : { ok, version, error: 'unexpected query result' }
  } finally {
    db.close()
  }
}

// Runs the real migrations on an in-memory catalog, proving the bundled schema ships and applies in this build.
async function checkCatalog(): Promise<SelfTestReport['catalog']> {
  const db = await openCatalog(IN_MEMORY)
  try {
    const schemaVersion = readSchemaVersion(db)
    const ok = schemaVersion === latestVersion(MIGRATIONS) && schemaVersion > 0
    return ok ? { ok, schemaVersion } : { ok, schemaVersion, error: 'catalog not at the latest schema' }
  } finally {
    db.close()
  }
}

// Starts the real media worker process from this build and has it make a thumbnail,
// proving the worker file, sharp and exifr all load inside the package.
async function checkMediaWorker(): Promise<SelfTestReport['mediaWorker']> {
  const dir = mkdtempSync(join(tmpdir(), 'nearmora-self-test-'))
  const worker = new MediaWorker()
  try {
    const source = join(dir, 'generated.jpg')
    const thumbnail = join(dir, 'thumb.webp')
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#5b414b' } }).jpeg().toFile(source)
    const result = await worker.process({ sourcePath: source, thumbnailPath: thumbnail })
    const ok = result.ok && result.width === 64 && existsSync(thumbnail)
    return ok ? { ok } : { ok, error: 'worker did not produce a thumbnail' }
  } finally {
    worker.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}

// Renders Postcards (tilted cards, a postmark, a caption drawn as letter outlines from the bundled font) and a 2-slide
// seamless design through the real media worker, and checks every file came out at its expected size.
async function checkStudio(): Promise<SelfTestReport['studio']> {
  const dir = mkdtempSync(join(tmpdir(), 'nearmora-self-test-'))
  const worker = new MediaWorker()
  try {
    const source = join(dir, 'generated.jpg')
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#b9a4c8' } }).jpeg().toFile(source)
    const render = async (templateId: string, photoCount: number, files: string[]) => {
      const composition = compose({ templateId, templateVersion: 1, format: 'square', params: { v: 1 }, photoCount })
      const drawn = layers(composition, 0).map((l): RenderLayer => (l.kind === 'shape' ? l : { kind: 'photo', sourcePath: source, crop: DEFAULT_CROP, fit: 'fill', element: l.element }))
      const textDrawn = drawn.some((l) => l.kind === 'shape' && l.d.length > 500) // the caption's letter outlines
      const result = await worker.render({ outputPaths: files.map((f) => join(dir, f)), width: composition.width, height: composition.height, background: composition.background, border: composition.border, ppi: null, quality: 90, layers: drawn })
      const widths = await Promise.all(files.map(async (f) => (await sharp(join(dir, f)).metadata()).width))
      return { ok: result.ok, widths, textDrawn }
    }
    const postcards = await render('pair-postcards', 2, ['postcards.jpg'])
    const seamless = await render('seamless-across-the-seam', 3, ['seam-01.jpg', 'seam-02.jpg'])
    const ok = postcards.ok && postcards.textDrawn && postcards.widths[0] === 1080 && seamless.ok && seamless.widths.join() === '1080,1080'
    return ok ? { ok } : { ok, error: `unexpected result: ${JSON.stringify({ postcards, seamless })}` }
  } finally {
    worker.stop()
    rmSync(dir, { recursive: true, force: true })
  }
}

// Exercises the sharp features later milestones depend on: decode, resize and re-encode.
async function checkSharp(): Promise<SelfTestReport['sharp']> {
  const width = 64
  const height = 48
  const pixels = Buffer.alloc(width * height * 3, 200)

  const png = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .resize(16, 12)
    .png()
    .toBuffer()
  const meta = await sharp(png).metadata()

  const ok = meta.format === 'png' && meta.width === 16 && meta.height === 12
  return ok
    ? { ok, libvips: sharp.versions.vips }
    : { ok, libvips: sharp.versions.vips, error: 'unexpected resize result' }
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export async function runSelfTest(): Promise<SelfTestReport> {
  let sqliteResult: SelfTestReport['sqlite']
  try {
    sqliteResult = checkSqlite()
  } catch (error: unknown) {
    sqliteResult = { ok: false, error: describeError(error) }
  }

  let sharpResult: SelfTestReport['sharp']
  try {
    sharpResult = await checkSharp()
  } catch (error: unknown) {
    sharpResult = { ok: false, error: describeError(error) }
  }

  let catalogResult: SelfTestReport['catalog']
  try {
    catalogResult = await checkCatalog()
  } catch (error: unknown) {
    catalogResult = { ok: false, error: describeError(error) }
  }

  let workerResult: SelfTestReport['mediaWorker']
  try {
    workerResult = await checkMediaWorker()
  } catch (error: unknown) {
    workerResult = { ok: false, error: describeError(error) }
  }

  let studioResult: SelfTestReport['studio']
  try {
    studioResult = await checkStudio()
  } catch (error: unknown) {
    studioResult = { ok: false, error: describeError(error) }
  }

  return {
    ok: sqliteResult.ok && sharpResult.ok && catalogResult.ok && workerResult.ok && studioResult.ok,
    electron: process.versions.electron,
    sqlite: sqliteResult,
    sharp: sharpResult,
    catalog: catalogResult,
    mediaWorker: workerResult,
    studio: studioResult,
  }
}
