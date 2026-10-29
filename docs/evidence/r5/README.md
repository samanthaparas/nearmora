# R5 evidence — Memory Studio and export

## Part 1: projects

Date: 2026-10-29 · Machine: Apple M1 (8 cores), 16 GB, macOS 27.0.1, Node 24.21.0 · Electron 45.1.0

Labels: [auto] automated · [int] real SQLite · [e2e] built app · [ci] GitHub Actions · [human] person's judgment

| Gate item | Evidence | Label |
|---|---|---|
| Canvas sizes and cells | 1080 × 1080 and 1080 × 1350; 48 px margins on every side and a 24 px gap; equal cells; one full-canvas cell per carousel slide | [auto] |
| Crops always cover, never overflow | At zoom 1 the photo just covers the cell with no stretching; any centre (even far outside 0–1) stays within the photo; zoom is limited to 1–4; clamping is idempotent | [auto] |
| Photo counts | 2 for a two-photo collage, 4 for a four-photo collage, 2–10 for a carousel, each photo once | [int] |
| Draft restored exactly (AC6) | After crop, reorder, title, shape and background changes, a reopened catalog returns an identical project; the crop moved with its photo. **Control:** resetting crops on reorder fails this test | [int] |
| Keyboard reorder and crop (AC6) | In the app, using only the keyboard: + twice, → and ↓ inside the crop controls, then Return on "Move later"; after a restart the photo still has exactly that crop, at its new position, with portrait shape and the new title | [e2e] |
| Unavailable files named before export (AC6) | Disconnected folder: every item reports its file name and folder ("IMG_0001.jpg", "Summer"), and crops can still be edited. In the app: "5 photos are offline" with "burst-1.jpg (in “Burst”)" | [int] [e2e] |
| Carousel | One preview per slide ("Preview of slide N of 5") | [e2e] |
| Delete keeps photos | Project and items gone, all 10 pictures remain; in the app, "Keep project" is focused first and Favorites still lists 5 | [int] [e2e] |
| Originals untouched | Fingerprints of the generated folder are identical after all Studio tests | [e2e] |
| Passes on GitHub's macOS runner | Failed first on PR #12 (run 40811798384: the flaky watcher test, see below), then passed after the fix, [run 40812762801](https://github.com/samanthaparas/nearmora/actions/runs/40812762801) (2026-10-29): 177 unit, integration and component tests (2 private-pack tests skipped as intended), 29 E2E tests, all packaged checks | [ci] |

Totals: 179 unit, integration and component tests; 29 E2E tests.

### What testing caught

- **A flaky R3a test, and a weakness in the no-write checks.** The check that the file watcher notices a write failed once locally, then on GitHub (run 40811798384). The first guess (macOS reports writes late under load) led to longer waits, which weren't enough.
  - **The real causes, found by logging the events:** a new macOS watcher starts asynchronously and never reports a write made before it's running; and one write can be reported twice, with the second report late.
  - **Why it mattered:** a "no writes" check could pass while missing a write.
  - **The fix:** the tests now bracket the work with two differently named hidden sentinel files in the test's own folder. Each is rewritten until the watcher reports it, which proves the watcher is live. File reports arrive in order, so every write made before the closing sentinel is reported by the time it is. No fixed waits remain.
  - **Result:** 10 runs of the scan suites and 4 full runs, all green.
  - **The private-pack test** can't use sentinels (nothing is written into the owner's fixture folder), so its watcher is best-effort and its fingerprint check is the proof.

- **A shape option looked unclicked in the test.** The radio button for shape shows the saved state, so it only becomes checked once main confirms the change. Playwright's `check()` expects an instant change, so the test now clicks and waits. Real use was unaffected.

### Screenshots (generated photos)

- `favorites-select.png`: Favorites with two photos selected, numbered in pick order; only the two-photo layout is enabled.
- `collage-editor.png`: a two-photo collage, the first photo zoomed to 125% and moved right, outlined as the one being adjusted.
- `carousel-editor.png`: a five-slide carousel, one preview per slide.

## Part 2: export

Date: 2026-10-29 · Same machine.

| Gate item | Evidence | Label |
|---|---|---|
| Sizes (AC7) | Exactly 1080 × 1080 and 1080 × 1350 JPEGs; every carousel slide 1080 × 1080 | [int] [e2e] |
| Crops match the layout math (AC7) | A two-tone photo: the left cell's crop (25% across) shows red, the right cell's (75%) shows blue, and the margin shows cream. A rotated (orientation 6) photo is cropped as displayed | [int] |
| Preview matches export (AC7) | **First owner review: failed.** "The quality of the preview is noticeably way better than the export." Aligned measurements showed brightness and contrast matching within half a level in all four cells; enlarged, the export's saturated edges (red petals) were smeared by JPEG's half-resolution colour (4:2:0). **Fixed:** quality 92, full-resolution colour (4:4:4), mozjpeg. **Second owner review: passed** (2026-10-29). Preview and export "look similar", and the exported bougainvillea cell at actual size "looks right". The owner first saw the enlarged petals as pixelated: that view was a 2.25× nearest-neighbour enlargement made to show pixels, and the export never enlarges originals (it shrinks about 2.5× at zoom 1). The preview's selection outline is the one intended difference | [human] |
| Colour kept at full resolution | One-pixel red/blue stripes rendered 1:1 come back with an average error under 15 and 4:4:4 recorded in the file; the export's final check now requires 4:4:4. **Control:** back to the default 4:2:0, the stripe test fails, and two exports fail their final check | [int] |
| Transparency flattened | A fully transparent PNG renders as the cream background | [int] |
| No GPS, EXIF, XMP, IPTC (AC7) | The source carries GPS (51.5° N), EXIF (Copyright) and XMP (creator), checked; the output has none (sharp metadata and exifr both empty). The export verifies this for every file. **Control:** writing EXIF into the output fails the metadata test and makes two exports fail their final check | [int] |
| Ordered names, fresh folders, no overwrite (AC8) | "Carousel 01/02/03.jpg" in "Nearmora Carousel 2026-10-29"; a second export goes to "… (2)"; originals' fingerprints are unchanged and the sentinel guard saw no writes in the photo folder | [int] [e2e] |
| Destination rules | Inside a photo folder, inside app data, or read-only: refused with a reason, nothing written. In the app: "inside one of your photo folders" | [int] [e2e] |
| Originals re-checked | Offline photos named; an edited original (extra byte) named as changed; an **in-place edit with the same size and date** is caught by the re-hash. **Control:** without the re-hash, that test fails | [int] |
| Cancel (AC8) | Cancel after the first slide: no folder, no staging left, job "cancelled". **Control:** without staging cleanup, this test fails | [int] |
| Full disk (AC8) | Export to a 2 MB disk image the test mounts: fails as `disk_full`, the volume is left empty, and a retry to another folder completes. **Control:** without staging cleanup, this test fails | [hw] [int] |
| Crash (AC8) | A running export job with a half-written staging folder is failed at startup and its folder removed; a job naming a folder that isn't its own staging folder never deletes it | [int] |
| Backup restores projects (AC11 full) | A carousel with a changed crop, backed up and restored into a clean profile, comes back identical | [int] |
| Passes on GitHub's macOS runner | **Pending:** this PR's CI run | [ci] |

Totals: 193 unit, integration and component tests; 30 E2E tests.

### What the owner's review caught

- **A misleading comparison of mine.** Enlarging a patch without smoothing made both sides look pixelated; comparisons now include an actual-size view, and enlarged views are labelled as such.
- **Smeared colour in exports.** My checks measured brightness, contrast and crop position, which all matched; they didn't measure colour resolution. The owner's eye caught it, and the stripe test now covers it. An earlier measurement of mine was also wrong (a misaligned crop of the preview included the cream margin, so its contrast looked twice the export's); the aligned measurement is the one recorded above.

### What testing caught

- **Identical test photos.** The first export fixture made two byte-identical photos, which the catalog rightly treats as one picture; the "changed original" check then (correctly) used the untouched copy. Test photos are now distinct.
- **JPEG colour shifts.** Cream 248,240,232 comes back as 248,239,232 after compression, so colour checks allow ±4.
- **A disk image GitHub's Mac couldn't eject** (run 40816408369). The full-disk test's cleanup failed with "resource busy" (status 16), which also hid whether its checks had passed. The image library keeps recently used files open, and a fresh volume can be briefly indexed. A shared helper now releases sharp's file cache and retries the eject; the unplug test uses it too.
- **A miscounting end-to-end check.** Counting entries in the destination also counted the second export's hidden staging folder while it ran. The test now waits for the "Exported … (2)" message.
