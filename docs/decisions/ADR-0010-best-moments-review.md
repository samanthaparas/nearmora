# ADR-0010: The Best Moments review screen

Date: 2026-10-29 · Status: accepted (R4 part 2)

## Context

The blueprint's Best Moments flow: choose a set, compare two photos, look through the rest, mark several favorites if wanted, "Favorite all", "Decide later", Save atomically with "Saved" and Undo. Review status and favorites are separate. Unsaved changes must never be silently discarded. Manual choices survive rescans and regrouping (AC4, AC13). A disconnect mid-review must not crash or lose decisions (AC5). It also needs narrow-width A/B tabs and zoom and pan.

## Decision

- **Queue and review:**
  - Best Moments lists sets waiting for a decision (undecided, then "Saved for later"), then reviewed ones.
  - Opening a set shows two photos side by side, Photo A and Photo B, with a strip of all its photos. Choosing a photo in the strip shows it as B (or A if it's already B), and "Swap sides" switches them.
  - Below 900 px wide, A and B become tabs.
- **Previews for comparing.** `nm-media://preview/<id>` serves a 2048 px upright WebP that the media worker makes on first request from a reachable original, then caches by content hash. Two requests for the same preview share one job. When the original is offline, the panel falls back to the cached thumbnail and says "Offline".
- **Zoom and pan apply to both photos together,** so the same detail is compared: buttons (Zoom in, Zoom out, Fit), the + and − keys, the arrow keys to pan when zoomed in, and dragging.
- **Choosing.** Favorites are a draft until saved:
  - **Save choices** writes favorites and "reviewed" in one transaction (R2's `saveReview`), shows "Saved: N favorites", and offers Undo and "Next set".
  - **Decide later** saves the draft too, with status "deferred", so nothing is lost and the set stays in the queue.
  - **Favorite all** fills the draft. Zero favorites is a valid saved choice.
- **Stale screens are handled, not errors.** If a scan regrouped the set while it was open, save and the corrections return `stale`. The screen reloads the set, keeps unsaved picks for photos still in it, and explains what happened. Expected outcomes like this are explicit results in the IPC contract, because errors only cross the bridge as coarse codes.
- **The unsaved-changes guard.**
  - A small navigation guard lets the review screen intercept sidebar navigation, "← All sets" and "Next set".
  - With unsaved picks, a modal dialog offers **Save**, **Discard changes** or **Continue reviewing**.
  - Save has focus first, Tab stays inside the dialog, Escape continues reviewing, and focus returns afterwards.
- **Corrections** (stored as `set_asset.user_override`, respected by regrouping):
  - **Remove from set** marks a grouped photo removed, or deletes one the person added. Fewer than two left dissolves the set.
  - **Add a photo taken around the same time** offers photos within 10 minutes that aren't in any set.
  - **Split set apart** removes every photo. The set row is kept, hidden, so regrouping matches it again by its removed photos and doesn't recreate the group.
  - Each correction checks the revision. None touches favorites or files.
- **React Testing Library 16.3.3** (with @testing-library/dom 10.4.2, user-event 14.6.8 and jsdom 30.1.2) is added for component tests, in `tests/component/*.test.tsx`. They're type-checked with the UI's settings and run in jsdom, chosen per file.

## Consequences

- **Quitting the app with unsaved picks doesn't prompt yet.** The guard covers navigation inside the app. Catching window close needs a main-process handshake (`will-prevent-unload`); that's left for R6.
- **Review saves have undo; corrections don't.** A removed photo can be added back from "nearby", and a split can't be undone from the UI yet.
- **Previews accumulate in app data,** like thumbnails. A cache size limit comes later.
- **No zoom-level persistence or per-photo zoom.** Both photos always share one view.
