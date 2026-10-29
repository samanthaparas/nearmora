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
| Passes on GitHub's macOS runner | **Pending:** this PR's CI run | [ci] |

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
