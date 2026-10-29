# R3a evidence — Indexing slice

Date: 2026-10-28 · Machine: Apple M1 (8 cores), 16 GB, macOS 27.0.1, Node 24.21.0 · Electron 45.1.0

Labels: [auto] automated · [int] real files and SQLite on disk · [pkg] packaged app · [e2e] built app driven by Playwright · [ci] GitHub Actions · [human] manual check

| Gate item | Evidence | Label |
|---|---|---|
| AC1: originals unchanged | SHA-256, size and modification time of every file are identical before and after a scan plus a rescan, and a recursive watcher saw no events. **Control:** the same watcher does catch a write. Covered for the generated folder (`scan.test.ts`), the real fixture pack, and the built app (`e2e/library.spec.ts`) | [int] [e2e] |
| AC2: supported photos appear, the rest are explained | Generated folder of 10 files: 6 indexed (5 pictures plus 1 identical copy), 2 unsupported (text, and text renamed `.jpg`), 2 damaged (bad JPEG and PNG). Hidden files and symlinks are skipped. The UI shows "5 photos · 1 identical copy" and explains the 4 skipped files | [int] [e2e] |
| AC2: no duplicate records | Rescan: 0 new rows, 6 unchanged. Cancel after the first photo, then restart: same totals, one cancelled job recorded. Inside, around or the same folder: refused | [int] [e2e] |
| Missing and disconnected | A removed file is marked `missing` and its other copy keeps the picture visible; a removed folder makes the source `disconnected` and keeps its records | [int] |
| Dates and rotation | EXIF date read; a PNG without one falls back to the file date, labelled `file_mtime`; an orientation-6 JPEG is stored at its displayed size; dHash is 8 bytes | [int] |
| Thumbnails only by id | `nm-media://` accepts only `thumb/<uuid>`. Paths, queries, extra segments and other hosts are refused (unit tests). In the app, unknown ids and path-like URLs never return a file | [auto] [e2e] |
| Restart keeps photos | Relaunching with the same profile shows the same grid without rescanning | [e2e] |
| Media worker in the package | `--self-test` starts the worker from the packaged `.app` and gets a thumbnail back | [pkg] |
| Real fixture pack (88 files) | See below | [int] |
| Passes on GitHub's macOS runner | **Pending:** this PR's CI run. CI has no private fixtures, so the real-pack test skips there | [ci] |

Totals: 106 unit and integration tests, 14 E2E tests, 19 packaged checks. Package size: 310 MB (was 309 MB).

## Real fixture pack

`fixtures/private/Nearmora-Real-Photo-Fixtures-88/photos` is the owner's approved test set: HDR+ dataset photos under CC BY-SA 4.0, plus 5 generated PNGs. It's git-ignored and was never copied or committed. `tests/integration/real-fixtures.test.ts` scans it in place:

- **Result:** 88 files found, 88 indexed, 0 skipped, 85 distinct pictures (the 3 exact copies share a picture), as the manifest says.
- **Manifest match:** every file's SHA-256 matches. Stored sizes match the manifest after rotation, and every file with a date in the manifest has an EXIF date.
- **Nothing changed:** before and after fingerprints are identical, and the watcher saw no events.
- **Scan time:** 3.23 s, 3.24 s and 3.20 s over three runs. This runs the image pipeline in the test process, not through the app's worker, so it's a baseline for the pipeline itself, not the app.

**Manifest gap:** the manifest's width/height are as stored (before rotation), and the entry for `exact-duplicates/copy-01.jpg` leaves out its orientation, although the file is a rotated burst frame (orientation 6). The test reads orientation from the file itself.

## Screenshot

`library-grid.png`: the Library after adding a generated test folder. Five photos are shown with the rotated one upright, a note of one identical copy, and the four skipped files explained. No real fixture photos appear in committed screenshots, because of their attribution licence.

## Not yet covered (R3b)

- Pause and resume.
- Date moments, search and filters.
- Virtualized grid for large libraries (paging is by offset, 200 at a time).
- An external USB drive test.
- Larger-library timing.
