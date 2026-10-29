# R3b part 1 evidence — Scan control and offline folders

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
| Passes on GitHub's macOS runner | **Pending:** this PR's CI run | [ci] |

Totals: 115 unit and integration tests, 16 E2E tests. (CI skips the private-pack test.)

## Scan baseline (through the app and its worker)

`npm run measure:scan` drives the built app with Playwright. The time runs from clicking Add folder (or Rescan) until the source reports `done`, using the real `utilityProcess` worker with 2 photos in flight. Two runs each:

| Dataset | Pictures | First scan | Rescan (nothing changed) |
|---|---|---|---|
| Real fixture pack (88 files: 42 JPEGs of about 3 MP, 41 of about 12–13 MP, 5 PNGs of about 2 MP) | 85 | 4.00 s, 3.85 s | 0.11 s, 0.13 s |
| 1,000 generated JPEGs, 2016×1512, Gaussian noise, quality 85 (about 1.7 MB each) | 1,000 | 33.44 s, 33.13 s | 0.11 s, 0.11 s |

That's about 30 photos a second for the generated set on this machine. The noise images are a worst case for JPEG decoding at their size, not typical phone photos. The real pack is about half 12–13 MP photos and runs at about 22 photos a second, so larger libraries of modern phone photos should be expected to land nearer that rate (not yet measured at scale). Concurrency stays at 2, as the blueprint starts with; this is the baseline to compare against before changing it.

## Screenshots

- `library-offline.png`: a disconnected folder. Every photo is marked "Offline", with a Reconnect action.
- `sources-remove-review.png`: the removal review before anything happens.

## Not yet covered

- R3b part 2: date moments, search and filters, virtualized grid.
- A real USB drive. The disk image is a real mounted volume ejected by force, but not physical hardware.
- Volume UUID identity.
- Thumbnail cache cleanup.
