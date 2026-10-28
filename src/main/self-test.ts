/**
 * A built-in diagnostic, run with `--self-test`, that proves the native libraries load and work inside this exact build.
 * It's how CI checks a packaged app, since packaged apps (correctly) block test tools from attaching.
 * It touches no user files and no network: an in-memory database and a generated image only.
 */

import Database from 'better-sqlite3'
import sharp from 'sharp'

export const SELF_TEST_FLAG = '--self-test'
/** Prefix on the single output line, so the smoke test can find it among Electron's own logging. */
export const SELF_TEST_MARKER = 'NEARMORA_SELF_TEST '

export interface SelfTestReport {
  ok: boolean
  electron: string | undefined
  sqlite: { ok: boolean; version?: string; error?: string }
  sharp: { ok: boolean; libvips?: string; error?: string }
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

  return {
    ok: sqliteResult.ok && sharpResult.ok,
    electron: process.versions.electron,
    sqlite: sqliteResult,
    sharp: sharpResult,
  }
}
