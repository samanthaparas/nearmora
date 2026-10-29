# ADR-0006: Scan control and offline folders

Date: 2026-10-29 · Status: accepted (R3b part 1)

## Context

Photo collections often live on external drives that come and go. AC5 asks that a disconnect mid-scan causes no crash, no lost decisions and no false "done", with safe retry after a *verified* reconnect. The blueprint says choices must never attach to a different file just because its name matches, and that removing a source affects the catalog, never the disk.

## Decision

- **Pause = stop after the photos in flight, then remember.**
  - The scan's `AbortController` is aborted with a `pause` reason, and the job row ends as `paused` with its counts.
  - Resuming is simply a rescan, which skips unchanged files. There's no separate cursor to keep in sync.
- **Interrupted scans become paused.**
  - Quitting pauses running scans.
  - At startup, any job still marked `running` (from a crash or force-quit) is set to `paused`, so the Library offers "Resume scan" instead of showing a scan as finished.
  - Counts are checkpointed to the job row as the scan runs, at most five times a second.
- **Schema v2 (`0002_job_source.sql`):**
  - `job.source_id` (foreign key, cascades on source removal), with an index, replaces reading every job's JSON to find a folder's last scan.
  - Existing v1 jobs are backfilled from their checkpoint, and orphans are dropped.
  - This is the project's first migration over existing data, and it's tested.
- **Three access states, checked before and after every scan:**
  - The path doesn't exist → `disconnected`.
  - It exists but can't be read or listed → `permission_denied`.
  - Otherwise → `active`.
  - A drive that vanishes mid-scan ends the scan as `failed` and `disconnected`. The files it didn't reach are **not** marked missing.
- **Reconnect only after an identity check.** A disconnected folder can't be rescanned until `reconnect` re-fingerprints up to 5 random catalogued photos at their paths. It counts as the same folder if at least one matches and matches aren't outnumbered by mismatches, so a few edited or deleted photos don't block it but a different drive does. Otherwise the result is `different_folder` and nothing changes.
- **Offline photos stay visible.** The Library still shows pictures whose files are on a disconnected drive, from cached thumbnails, labelled "Offline" in text and in the alt text.
- **Permission problems fix themselves:** listing sources re-checks access, so a `permission_denied` folder becomes `active` again once it's readable. A disconnected one never does without verification.
- **Remove = review the impact, then forget catalog rows:**
  - The review counts the files forgotten, pictures found only in this folder, and favorites and albums affected.
  - "Keep folder" has focus by default.
  - Removal deletes the source and its locations and jobs (cascade). Pictures, favorites, review choices and albums are kept, so re-adding the folder restores them.
  - Refused while the folder is scanning.

## Consequences

- **No volume UUID yet.** Identity is checked by content only. The `volume_uuid` column is unused until a need appears, and reading it needs `diskutil` or a native call.
- **Orphaned thumbnails stay in the cache** after a removal. A cache size limit and cleanup come later (blueprint: user-visible cache setting).
- **The removal review is an inline panel, not a modal dialog,** so there's no focus trap to get wrong. Its wording is the safeguard.
- **AC5 is covered for scanning only.** Comparison and export are covered when they exist (R4, R5).
