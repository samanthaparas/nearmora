# R3b evidence — Library: scan control, offline folders, moments and search

Part 1 (scan control and offline folders) is below; part 2 (moments, search and the virtualized grid) follows it.

## Part 1

Date: 2026-10-29 · Machine: Apple M1 (8 cores), 16 GB, macOS 27.0.1, Node 24.21.0 · Electron 45.1.0

Labels: [auto] automated · [int] real files and SQLite on disk · [hw] real volume (disk image) · [pkg] packaged app · [e2e] built app driven by Playwright · [ci] GitHub Actions

| Gate item | Evidence | Label |
|---|---|---|
| Pause, then resume without duplicates | Paused after the first photo: fewer than 6 locations and state `paused`; resumed: 6 locations, state `done` | [int] |
| Quit or crash mid-scan is resumable, not "finished" | A scan that never ends is still `running`; at startup it becomes `paused` | [int] |
| Unplug mid-scan (AC5) | A 16 MB HFS+ disk image the test creates and mounts. One full scan, then a rescan that force-ejects the volume during its first photo: result `failed`, source `disconnected`, **0** locations marked missing, all photos visible as offline. Re-attached: `reconnected`, `done`, 6 locations, files' fingerprints unchanged. **Control:** without the after-scan drive check, this test fails | [hw] [int] |
| Reconnect verifies identity | Same files back: `reconnected`. Different photos under the same names: `different_folder`, still disconnected. **Control:** with the identity check always passing, the different-folder test fails | [int] |
| Permission denied | Folder set to `000`: `permission_denied`, and the scan ends `failed`; permissions restored: `active` | [int] |
| Remove after impact review | Impact `{6 files, 5 only here, 1 favorite, 1 album}`. After removal: 0 locations, empty Library, favorite kept, files unchanged. Refused while scanning | [int] |
| In the app | Offline badges and "Reconnect", including "Still not found" while it's missing; Sources screen review with "Keep folder" focused; removal leaves the files unchanged | [e2e] |
| Schema v2 migration | v1 catalog with two jobs: the one whose source exists is linked, the orphan is dropped, and `foreign_key_check` is clean | [int] |
| Passes on GitHub's macOS runner | Passed on PR #7, [run 40800283691](https://github.com/samanthaparas/nearmora/actions/runs/40800283691) (2026-10-29): 114 unit and integration tests (the private-pack test skipped as intended), including the disk-image unplug test; 16 E2E tests; all packaged checks | [ci] |

Totals: 115 unit and integration tests, 16 E2E tests. (CI skips the private-pack test.)

### Scan baseline (through the app and its worker)

`npm run measure:scan` drives the built app with Playwright. The time runs from clicking Add folder (or Rescan) until the source reports `done`, using the real `utilityProcess` worker with 2 photos in flight. Two runs each:

| Dataset | Pictures | First scan | Rescan (nothing changed) |
|---|---|---|---|
| Real fixture pack (88 files: 42 JPEGs of about 3 MP, 41 of about 12–13 MP, 5 PNGs of about 2 MP) | 85 | 4.00 s, 3.85 s | 0.11 s, 0.13 s |
| 1,000 generated JPEGs, 2016×1512, Gaussian noise, quality 85 (about 1.7 MB each) | 1,000 | 33.44 s, 33.13 s | 0.11 s, 0.11 s |

That's about 30 photos a second for the generated set on this machine. The noise images are a worst case for JPEG decoding at their size, not typical phone photos. The real pack is about half 12–13 MP photos and runs at about 22 photos a second, so larger libraries of modern phone photos should be expected to land nearer that rate (not yet measured at scale). Concurrency stays at 2, as the blueprint starts with; this is the baseline to compare against before changing it.

### Screenshots

- `library-offline.png`: a disconnected folder. Every photo is marked "Offline", with a Reconnect action.
- `sources-remove-review.png`: the removal review before anything happens.

### Not yet covered after part 1

- R3b part 2: date moments, search and filters, virtualized grid.
- A real USB drive. The disk image is a real mounted volume ejected by force, but not physical hardware.
- Volume UUID identity.
- Thumbnail cache cleanup.

## Part 2

Date: 2026-10-29 · Same machine.

| Gate item | Evidence | Label |
|---|---|---|
| Moments split only on gaps over 8 hours | Exactly 8 h stays together; 8 h plus 1 ms splits. **Control:** making SQL split at "8 h or more" fails this test | [int] |
| SQL and TypeScript grouping agree | 2,000 photos with clustered, partly identical timestamps: identical groups (more than 50 moments) | [int] |
| Edits survive regrouping | A renamed moment keeps its id, title and cover after new photos join it; a cover that left the moment is cleared; a moment with no photos left is removed | [int] |
| Edit validation | Title over 120 characters or a cover from another moment: `INVALID_INPUT`. Setting both back to null resets `user_edited` to 0 | [int] |
| Keyset paging | 250 photos sharing only 20 timestamps, read 7 at a time: every photo exactly once, in the same order as one big page. **Control:** reversing the tie-breaker fails this test | [int] |
| Search and filters | File name and subfolder (case-insensitive), folder name, moment title; `%` and `_` are literal (**control:** without escaping, this test fails); date range, folder, favorites, moment, and combinations with the right totals | [int] |
| Query plan | The Library's first page reads `idx_asset_captured` in order with no temporary sort (test, plus the timing below) | [int] |
| Schema v3 | Applied by every catalog test; the index is checked by the query-plan test | [int] |
| In the app | Three date moments for the generated folder; rename and choose cover, still there after a restart; search by folder name, then a no-results message and "Clear filters"; 1,200 photos with fewer than 200 cells in the page, scrolling until photo 1,200 appears | [e2e] |
| Passes on GitHub's macOS runner | **Pending:** this PR's CI run | [ci] |

Totals: 128 unit and integration tests, 19 E2E tests.

### Measurements

From `npm run query-plans` (10,000 synthetic photos, in memory):

| Measurement | Result |
|---|---|
| Library first page (200), newest first | 7.95 ms without the index (full scan plus temporary sort) → 0.13 ms with `idx_asset_captured (captured_at, id)` |
| Moment grouping, SQL window functions | 224 moments in 10.8–11.0 ms (median of 20, two runs) |
| Moment grouping, TypeScript loop (including reading rows in index order) | 224 moments in 1.53–1.57 ms |

Virtualized grid, 1,200 photos, 1440×784 window: 42 photo cells in the page at the top, and 84 after scrolling to the end (counted with Playwright). Without virtualization, all 1,200 would be in the page.

### What testing caught

- **Test data with too few distinct pictures.** The first virtualization test generated 1,200 solid-colour JPEGs, and JPEG compression made only 853 of them distinct, so the Library correctly showed 853. The test now uses lossless PNGs.
- **Misaligned text buttons.** The screenshot showed them indented 24 px, because `Library.css` loads before `App.css`. The rule now has higher specificity.

### Screenshots

- `library-moments.png`: Library with "Your moments" (dates as titles) above the filters and the grid.
- `moment-open.png`: an opened, renamed moment, with "Use date as title" and "Choose cover".

### Not yet covered

- Undo for moment renames.
- Full-text search (FTS5).
- Tuning the gap on real libraries.
- A physical USB drive and volume-UUID identity, carried over from part 1.
