/**
 * Measures the catalog's key queries on 10,000 synthetic pictures, with and without their indexes, and compares
 * moment grouping in SQL with the same grouping in JavaScript (`npm run query-plans`). Its output is evidence for
 * the docs; no real photos are involved.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'

const ROWS = 10_000
const RUNS = 200
// Every migration, in order, so the measured schema is the one the app really has.
const migrationsDir = new URL('../src/main/catalog/migrations/', import.meta.url)
const schema = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(new URL(name, migrationsDir), 'utf8'))
  .join('\n')

// Synthetic catalog: 10k pictures over ~2 years, 10% favorites, 1.2 locations each, sets of 3.
function buildCatalog() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(schema)
  const start = Date.UTC(2024, 0, 1)
  const span = 2 * 365 * 24 * 3600 * 1000
  let seed = 42
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)

  db.transaction(() => {
    db.prepare(`INSERT INTO source VALUES ('src', '/fixtures', NULL, 'Fixtures', 'active', 0, NULL)`).run()
    const asset = db.prepare(`INSERT INTO asset (id, content_sha256, media_type, captured_at, captured_at_source, decode_state)
                              VALUES (?, ?, 'image/jpeg', ?, 'exif', 'ok')`)
    const location = db.prepare(`INSERT INTO asset_location (id, asset_id, source_id, relative_path, size_bytes, mtime_ms, availability)
                                 VALUES (?, ?, 'src', ?, 1000, 0, 'available')`)
    const favorite = db.prepare('INSERT INTO favorite VALUES (?, 0)')
    const set = db.prepare(`INSERT INTO similarity_set (id, reason, algorithm_version) VALUES (?, 'visual', 'synthetic')`)
    const member = db.prepare('INSERT INTO set_asset (set_id, asset_id, position) VALUES (?, ?, ?)')
    let setId = ''
    for (let i = 0; i < ROWS; i++) {
      const id = `asset-${i}`
      asset.run(id, createHash('sha256').update(id).digest(), start + Math.floor(random() * span))
      location.run(randomUUID(), id, `photos/${i}.jpg`)
      if (i % 5 === 0) location.run(randomUUID(), id, `copies/${i}.jpg`)
      if (random() < 0.1) favorite.run(id)
      if (i % 3 === 0) set.run((setId = `set-${i}`))
      member.run(setId, id, i % 3)
    }
  })()
  return db
}

const MONTH = [Date.UTC(2025, 5, 1), Date.UTC(2025, 6, 1)]
const QUERIES = [
  {
    name: 'Gallery: one month, by date',
    index: 'idx_asset_captured',
    sql: 'SELECT id, captured_at FROM asset WHERE captured_at BETWEEN ? AND ? ORDER BY captured_at LIMIT 200',
    params: MONTH,
  },
  {
    name: 'Favorites in one month, by date',
    index: 'idx_asset_captured',
    sql: `SELECT a.id, a.captured_at FROM asset a JOIN favorite f ON f.asset_id = a.id
          WHERE a.captured_at BETWEEN ? AND ? ORDER BY a.captured_at LIMIT 200`,
    params: MONTH,
  },
  {
    name: 'Library first page, newest first (keyset order)',
    index: 'idx_asset_captured',
    sql: `SELECT a.id FROM asset a WHERE a.decode_state = 'ok'
            AND EXISTS (SELECT 1 FROM asset_location l WHERE l.asset_id = a.id AND l.availability = 'available')
          ORDER BY a.captured_at DESC, a.id DESC LIMIT 200`,
    params: [],
  },
  {
    name: 'Locations of one picture',
    index: 'idx_location_asset',
    sql: 'SELECT relative_path, availability FROM asset_location WHERE asset_id = ?',
    params: ['asset-5000'],
  },
  {
    name: 'Sets containing one picture',
    index: 'idx_set_asset_asset',
    sql: 'SELECT set_id FROM set_asset WHERE asset_id = ?',
    params: ['asset-5000'],
  },
]

function measure(db, query) {
  const statement = db.prepare(query.sql)
  const plan = db
    .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
    .all(...query.params)
    .map((row) => row.detail)
  const rows = statement.all(...query.params).length
  const times = []
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint()
    statement.all(...query.params)
    times.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
  times.sort((a, b) => a - b)
  return { plan, rows, medianMs: times[Math.floor(RUNS / 2)] }
}

const withIndexes = buildCatalog()
const withoutIndexes = buildCatalog()
for (const q of QUERIES) withoutIndexes.exec(`DROP INDEX IF EXISTS ${q.index}`)

console.log(`SQLite ${withIndexes.prepare('SELECT sqlite_version() AS v').get().v} · ${ROWS} pictures · median of ${RUNS} runs\n`)
for (const query of QUERIES) {
  const before = measure(withoutIndexes, query)
  const after = measure(withIndexes, query)
  console.log(`## ${query.name} (${after.rows} rows)`)
  console.log(`before (no ${query.index}): ${before.medianMs.toFixed(3)} ms`)
  for (const line of before.plan) console.log(`  ${line}`)
  console.log(`after: ${after.medianMs.toFixed(3)} ms`)
  for (const line of after.plan) console.log(`  ${line}`)
  console.log('')
}

// Moment grouping: the app's SQL (window functions) against the same rule in plain JavaScript.
const GAP = 8 * 60 * 60 * 1000
const groupingSql = `WITH dated AS (SELECT id, captured_at FROM asset WHERE captured_at IS NOT NULL),
  flagged AS (SELECT id, captured_at, CASE WHEN captured_at - LAG(captured_at) OVER (ORDER BY captured_at, id) > ? THEN 1 ELSE 0 END AS starts_new FROM dated)
  SELECT id, SUM(starts_new) OVER (ORDER BY captured_at, id ROWS UNBOUNDED PRECEDING) AS grp FROM flagged`
const timeIt = (fn) => {
  const times = []
  let result
  for (let i = 0; i < 20; i++) {
    const t = process.hrtime.bigint()
    result = fn()
    times.push(Number(process.hrtime.bigint() - t) / 1e6)
  }
  times.sort((a, b) => a - b)
  return { result, medianMs: times[10] }
}
const sqlGroups = timeIt(() => new Set(withIndexes.prepare(groupingSql).all(GAP).map((r) => r.grp)).size)
const jsGroups = timeIt(() => {
  const rows = withIndexes.prepare('SELECT id, captured_at FROM asset WHERE captured_at IS NOT NULL ORDER BY captured_at, id').all()
  let groups = 0
  let previous
  for (const row of rows) {
    if (previous === undefined || row.captured_at - previous > GAP) groups++
    previous = row.captured_at
  }
  return groups
})
console.log('## Moment grouping (8-hour gap), median of 20 runs')
console.log(`SQL window functions: ${sqlGroups.result} moments in ${sqlGroups.medianMs.toFixed(2)} ms`)
console.log(`JavaScript loop (incl. reading rows): ${jsGroups.result} moments in ${jsGroups.medianMs.toFixed(2)} ms`)
