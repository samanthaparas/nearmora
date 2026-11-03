# S7 evidence: Memory Studio release checklist

Date: 2026-11-03 · Machine: Apple M1 (8 cores), 16 GB, internal SSD, macOS 27.0.1, Node 24.21.0 · Electron 45.1.0

Labels: [auto] automated · [int] real files and SQLite · [e2e] built app · [pkg] packaged app · [human] person's judgment

## Release checklist for Studio

| Check | Result | Label |
|---|---|---|
| Automated accessibility (WCAG 2.1 AA, axe) on every Studio screen, at 100% and 200% zoom. Covered: the picker with My templates, the editor customised (Arrange, hidden photos, removed places), a seamless carousel with guides and seam notes, the swipe preview in both views, and Clean up | Pass, after one fix (below) | [e2e] |
| No sideways scrolling of the page at 200% zoom on those screens | Pass | [e2e] |
| Reduced motion stops the swipe preview's slide (0.3 s normally, effectively 0 with "Reduce motion") | Pass | [e2e] |
| Customize from the keyboard alone: nudge, size, flip, hide and show, add, remove and restore a place, save a template | Pass | [e2e] |
| Performance budget: no UI-blocking work over 100 ms while dragging a photo or opening a large design | Met, after one fix (below) | [e2e] |
| A seamless export that fails after writing slices leaves nothing behind, and a retry completes | Pass | [int] |
| Quitting right after a drag keeps the drag | Pass | [e2e] |
| A project or saved template damaged on disk is named ("This project couldn’t be opened"), or left out, and the rest of Studio keeps working | Pass | [e2e] |
| The packaged app renders a captioned playful layout and a seamless design cut into slides, using its bundled font and its own media worker, also with networking denied | Pass, after one fix (below) | [pkg] |
| VoiceOver walk-through of Studio | **Not done yet: for the owner** ([checklist](voiceover-studio.md)) | [human] |
| Studio with the owner's own photos | **Not done yet: for the owner** | [human] |

Earlier phases' own tests (S1–S6) still pass. The full suite for this change was 343 unit and integration tests and 55 end-to-end tests, with the 3 opt-in measurement runs skipped.

## What the checks found, and the fixes

- **The side-by-side swipe preview wasn't reachable by keyboard when it scrolled** (axe `scrollable-region-focusable`, at 200% zoom). The row is now focusable and labelled ("All 3 slides side by side"), so the arrow keys scroll it.
- **Opening a 3-slide seamless design blocked the page for up to 199 ms** (two tasks over 100 ms). The large preview images were decoded on the main thread the first time they were drawn. They're now decoded in the background before drawing: no long tasks in two runs.
- **A 10-photo collage took 75 s to export at 16 × 24 in.** Almost all of it was the SVG renderer unpacking 176 MB of embedded photo data. Upright photos on top are now placed onto the drawn image directly (ADR-0024).
  - Ten seconds now, in two runs.
  - The output is byte-for-byte the same, checked on six designs (bordered grid, fitted photos, a flipped photo, a photo partly off the canvas, a seamless strip, a playful layout).
  - A permanent test compares the two paths.
- **The packaged self-test with networking denied ran out of time** once it gained the Studio render. Inside the no-network sandbox, Chromium's GPU process can't start, and Chromium quits after a few retries, which the slightly longer self-test now reached. The self-test draws nothing, so it now turns hardware acceleration off and runs Chromium's remaining GPU work inside its own process, leaving no GPU process to fail. Turning acceleration off alone was not enough: it passed once, then failed 3 times out of 3 after merging with the licence notices, because Chromium still started a GPU process. With both, the offline self-test passed 5 times out of 5. Verified the cause both ways: without the Studio render, the offline self-test passed before any fix.

## Performance (`npm run measure:studio`)

**Setup:**
- Ten 4000 × 3000 JPEGs with noise (about phone-photo size), favorited.
- A Classic grid with six added places, so ten photos on one canvas.
- A 3-slide Story strip at portrait.

| Measure | Before fixes | After (run 1) | After (run 2) | Budget |
|---|---|---|---|---|
| Drag a photo 40 steps across the 10-photo collage: tasks over 100 ms | 0 (worst under 50 ms) | 0 | 0 | none ✓ |
| Drag total time | 735 ms | 723 ms | 693 ms | tracked |
| Open the 3-slide seamless design: tasks over 100 ms | **2 (worst 199 ms)** | 0 | 0 | none ✓ |
| Export the 10-photo collage at 16 × 24 in (34.6 MP) | **75.4 s** | 10.4 s | 10.4 s | tracked |
| Peak memory during that export, all processes | 1,766 MB | 1,612 MB | 1,597 MB | tracked |
| Export the 3 seamless slides | 2.8 s | 1.9 s | 1.8 s | tracked |
| Peak memory during that export | 1,046 MB | 1,218 MB | 1,217 MB | tracked |

**Limits of this measurement:**
- Two runs on one machine, with generated photos.
- The browser only reports tasks over 50 ms, so "0" means none over 50 ms.
- Memory is the working set of every app process, sampled every 200 ms, so short peaks between samples can be missed.
- Playful layouts with tilted or shaped photos still go through the SVG path, so they're slower at large print sizes than these numbers.

## Noticed, not changed here

- Choosing "Memory Studio" in the sidebar while a project is open keeps that project open; "← All projects" returns to the list. This is long-standing behaviour, not something S7 introduced. It may be worth making the sidebar return to the list.
