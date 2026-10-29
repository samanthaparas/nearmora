/**
 * Guards the key query plans: if a migration drops or breaks an index, these fail instead of the app quietly slowing down.
 * Timings live in docs/evidence/r2 (`npm run query-plans`); this test only checks that SQLite chooses the index.
 */

import { describe, expect, it } from 'vitest'
import { openTestCatalog, seedAssets, seedSource, tempProfile } from './helpers'

const QUERIES = [
  ['gallery by date', 'SELECT id FROM asset WHERE captured_at BETWEEN 0 AND 1 ORDER BY captured_at', 'idx_asset_captured'],
  [
    'favorites by date',
    'SELECT a.id FROM asset a JOIN favorite f ON f.asset_id = a.id WHERE a.captured_at BETWEEN 0 AND 1 ORDER BY a.captured_at',
    'idx_asset_captured',
  ],
  [
    'Library first page, newest first (keyset order)',
    `SELECT a.id FROM asset a WHERE a.decode_state = 'ok'
       AND EXISTS (SELECT 1 FROM asset_location l WHERE l.asset_id = a.id AND l.availability = 'available')
     ORDER BY a.captured_at DESC, a.id DESC LIMIT 200`,
    'idx_asset_captured',
  ],
  ['locations of a picture', `SELECT relative_path FROM asset_location WHERE asset_id = 'x'`, 'idx_location_asset'],
  ['sets containing a picture', `SELECT set_id FROM set_asset WHERE asset_id = 'x'`, 'idx_set_asset_asset'],
] as const

describe('query plans', () => {
  it.each(QUERIES)('%s uses its index and needs no temporary sort', async (_name, sql, index) => {
    const db = await openTestCatalog(tempProfile().catalogFile)
    seedAssets(db, seedSource(db).sourceId, 50)

    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>).map((row) => row.detail).join('\n')
    // "COVERING INDEX" is even better: the answer comes from the index alone, without reading the table.
    expect(plan).toMatch(new RegExp(`USING (COVERING )?INDEX ${index}\\b`))
    expect(plan).not.toContain('TEMP B-TREE')
  })
})
