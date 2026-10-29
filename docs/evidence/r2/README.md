# R2 evidence — Catalog

Date: 2026-10-28 · Machine: Apple Silicon (arm64), 16 GB, macOS 27.0.1, Node 24.21.0 · SQLite 3.53.4

Labels: [auto] automated · [int] real SQLite files on disk · [pkg] packaged app · [ci] GitHub Actions · [human] manual check

| Gate item | Evidence | Label |
|---|---|---|
| Schema v1 created with foreign keys on and WAL | `tests/integration/migrations.test.ts` | [int] |
| Foreign-key violations rejected | Missing picture in an album; deleting a picture used by a project (RESTRICT) | [int] |
| CHECK and STRICT rules enforced | Bad status value; capture date without a source (and the reverse); text in an integer column | [int] |
| Rollback on a mid-transaction error | A SQLite trigger makes the last step of a review save fail, and again for undo; nothing is written | [int] |
| Failing migration leaves the catalog unchanged, and its backup restores | Deliberately broken v2: the catalog stays at v1 with no half-created table; the pre-migration copy restores and passes `integrity_check` | [int] |
| Newer catalog refused | `user_version = 99` → `CATALOG_TOO_NEW`, file untouched | [int] |
| Only the last 3 pre-migration backups kept | Five upgrades in a row leave the v3, v4 and v5 copies | [int] |
| AC12 albums | Create, rename, reorder, add and remove, then a restart, and membership is identical; deleting an album or removing a source keeps every picture; `foreign_key_check` is clean | [int] |
| AC13 / AC4 review state | Zero, one and several favorites survive a restart; deferred sets come back to the queue; stale revisions are refused; undo restores the previous state, is refused after a newer save, and can be used only once | [int] |
| AC11 backup/restore (partial) | Restoring into a clean profile brings back favorites, review status, albums in order and project rows; a missing photo folder is reported as unreachable; damaged, mismatched or missing manifests are refused before anything is replaced; backups never overwrite each other | [int] |
| Migrations ship inside the packaged app | `--self-test` applies them to an in-memory catalog: schema v1 | [pkg] |
| Key query plans use their indexes | `tests/integration/query-plans.test.ts` fails if an index stops being used | [int] |
| Tests can actually fail | Control runs: with foreign keys turned off, 6 tests failed; with the review-save transaction removed, the partial-failure test failed | [int] |
| Passes on GitHub's macOS runner | Passed on PR #4, [run 40792199559](https://github.com/samanthaparas/nearmora/actions/runs/40792199559) (2026-10-29): every step succeeded, 75 unit and integration tests, 11 E2E tests and all packaged checks, including the catalog migrations | [ci] |

Totals: 33 unit tests and 42 integration tests pass, plus 11 E2E tests and 18 packaged checks.

## Query plans on 10,000 synthetic pictures

From `npm run query-plans` (median of 200 runs; in-memory, so this compares plans, not disk speed). "Before" is the same catalog with that query's index dropped.

| Query | Rows | Before | After | Plan change |
|---|---|---|---|---|
| Gallery: one month, by date | 200 | 0.467 ms | 0.054 ms | `SCAN asset` + temp sort → `SEARCH asset USING INDEX idx_asset_captured` |
| Favorites in one month, by date | 39 | 0.432 ms | 0.139 ms | `SCAN a` + temp sort → `SEARCH a USING INDEX idx_asset_captured`, then favorite by primary key |
| Locations of one picture | 2 | 0.352 ms | 0.001 ms | `SCAN asset_location` → `SEARCH … USING INDEX idx_location_asset` |
| Sets containing one picture | 1 | 0.289 ms | 0.001 ms | full scan of the primary-key index → `SEARCH … USING INDEX idx_set_asset_asset` |

At 10,000 rows even the slow plans are under half a millisecond. What matters is the shape: a full scan reads every row, so its cost grows with the library, while an index search reads only the matching rows. Larger libraries haven't been measured yet; R6 profiles against real budgets.

## Not yet covered

- The app doesn't open the catalog at startup yet, and there's no migration recovery screen (R3a).
- No backup/restore dialogs or IPC commands yet.
- AC11 needs R5 projects for a full pass.
