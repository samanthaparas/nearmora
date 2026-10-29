# R3c evidence — Albums

Date: 2026-10-29 · Machine: Apple M1 (8 cores), 16 GB, macOS 27.0.1, Node 24.21.0 · Electron 45.1.0

Labels: [auto] automated · [int] real SQLite on disk · [pkg] packaged app · [e2e] built app driven by Playwright · [ci] GitHub Actions

| Gate item (AC12) | Evidence | Label |
|---|---|---|
| Create, add, rename, reorder, remove | Additions go at the end and skip duplicates; moves to any valid position; out-of-range positions are refused with no change; paging by position returns album order; the first photo is the cover (`album-edits.test.ts`, plus the R2 album tests) | [int] |
| Restart keeps everything | A move, then reopening the catalog: same order, and undo still works | [int] |
| Undo restores exactly | Move, remove, add and rename each undone back to an identical album list and member order; a deleted album comes back with the same id, title, date and order | [int] |
| Undo is safe | Only the newest change can be undone (older: `STALE_REVISION`); each undo works once. **Control:** without the newest-only check, this test fails | [int] |
| No accidental photo removal | Deleting an album leaves all 4 pictures in the catalog; R2's tests already cover album deletion keeping assets and a clean `foreign_key_check` | [int] |
| In the app, keyboard only | Select 3 photos, add them to a new album, then use **Return** on a focused "Move later" twice: the order changes and focus stays on the same photo's button. Then Undo, rename, restart (same name and order), delete with "Keep album" focused, and Undo the delete | [e2e] |
| Originals untouched | SHA-256, size and modification time of every file in the folder are identical after the whole album test | [e2e] |
| Passes on GitHub's macOS runner | **Pending:** this PR's CI run | [ci] |

Totals: 139 unit and integration tests, 20 E2E tests.

## What testing caught

- **Stale album view after Undo.** The first end-to-end run showed the album still in its old order: Undo is handled by the Library, which refreshed its own grid but not the open album's. The album view now also listens to the Library's refresh.

## Screenshots

- `select-add-to-album.png`: three photos selected ("✓ Selected" and an outline), with the add-to-album panel open.
- `album-arrange.png`: an album in Arrange mode, with the Undo notice above. The first photo's "←" and the last photo's "→" are disabled.

## Not yet covered

- Drag-and-drop reordering.
- Undo history beyond the last change in the notice (the catalog keeps 20 steps per album).
- A VoiceOver pass, which is planned for R6.
