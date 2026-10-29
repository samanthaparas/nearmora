# R6 evidence — Beta hardening

## Part 1

Date: 2026-10-29 · Machine: Apple M1 (8 cores), 16 GB, internal SSD, macOS 27.0.1, Node 24.21.0 · Electron 45.1.0

Labels: [auto] automated · [int] real files and SQLite · [e2e] built app · [pkg] packaged app · [ci] GitHub Actions · [human] person's judgment

### Performance (blueprint budgets, measured with `npm run measure:perf`)

**Collection:**
- 10,000 generated JPEGs, 1200 × 900, Gaussian noise at quality 85, so files are realistically sized.
- EXIF dates two hours apart across about 2.3 years, in 100 subfolders of 100.
- Generation took 311 s. The photos were deleted afterwards.

One run:

| Measure | Result | Budget |
|---|---|---|
| First browsable photo (Add folder → first thumbnail shown) | **0.27 s** | ≤ 10 s ✓ |
| Full scan | **223 s, 44.8 photos/s** | tracked |
| Longest main-process stall during the scan, including regrouping all 10,000 into moments and sets at the end (a 10 ms timer's worst delay) | **71 ms** | ≤ 100 ms ✓ |
| Longest UI task while scanning and while scrolling the whole grid | **none over 50 ms** (the browser only reports tasks over 50 ms). **Control:** a deliberate 200 ms block was recorded as 200 ms | ≤ 100 ms ✓ |
| Warm gallery (relaunch → first thumbnail shown, timed from the window opening) | **0.23 s** | ≤ 2 s ✓ |
| Peak memory, all processes (sampled every 0.5 s) | **928 MB** | tracked |
| Thumbnail cache | **412 MB** for 10,000 pictures (about 41 KB each) | tracked |

**Limits of this measurement:**
- It's one run, on an internal SSD, with generated photos; real collections and external drives will differ.
- 1.1 MP photos decode faster than 12 MP phone photos. The R3b baseline measured about 22 photos/s on the fixture pack's mix.
- The warm-gallery time starts when the window exists, not at process launch.

### Privacy (AC9)

| Gate item | Evidence | Label |
|---|---|---|
| Core workflow with networking blocked | Index, review (with zoom), Studio and export all complete with every host name failing to resolve | [e2e] |
| No network requests | The request recorder sees only a deliberate control request from main; the app made none | [e2e] |
| No sockets | `lsof` over every app process: nothing besides Playwright's own two loopback debugging ports (identified as the ports the test process is connected to). **Control:** a listener opened in main is flagged | [e2e] |
| Packaged app with networking denied by macOS | `--self-test` (SQLite, sharp, catalog migrations, the media worker process) passes inside `sandbox-exec (deny network*)`. **Control:** the same sandbox stops perl opening a loopback socket. The packaged window can't run in an outer sandbox: Chromium refuses nested sandboxes (tried and recorded) | [pkg] |
| Packaged workflow with Wi-Fi off | **Pending:** owner, checklist section 7 | [human] |
| Cache deletion behaves as described | Settings shows sizes; clearing thumbnails removes them and rescans connected folders until all are rebuilt; clearing previews works; only files named like Nearmora's cache are deleted (a `.jpg` and a `.partial` in the same folder survive) | [int] [e2e] |
| Catalog removal behaves as described | R3b part 1: Sources → remove after an impact review; catalog rows only, files untouched | [int] [e2e] |

### Access (AC10)

| Gate item | Evidence | Label |
|---|---|---|
| Automated WCAG 2.1 AA checks | axe-core 4.13.0 on all 8 screens (Library, Best Moments, set review, Favorites, Memory Studio, project editor, Sources, Settings) at 100% and 200%: **no violations**. **Control:** axe reports an injected image without alt text and grey-on-white text | [e2e] |
| Reflow at 200% | No sideways scrolling on any screen. **Found and fixed:** the project editor scrolled 63 px sideways; its preview now shrinks to fit | [e2e] |
| Reduced motion | Transition and animation durations are 0 with `prefers-reduced-motion: reduce` | [e2e] |
| Keyboard-only journeys | Album rearranging (R3c), Studio crop and reorder (R5), the unsaved-changes dialog (R4), all by keyboard | [e2e] |
| Quit with unsaved picks | Closing asks first; "Keep reviewing" keeps the window and the picks, "Quit without saving" closes | [e2e] |
| VoiceOver | **Pending:** owner, `voiceover-checklist.md` | [human] |
| Passes on GitHub's macOS runner | **Pending:** this PR's CI run | [ci] |
