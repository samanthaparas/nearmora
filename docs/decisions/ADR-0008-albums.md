# ADR-0008: Albums

Date: 2026-10-29 · Status: accepted (R3c)

## Context

AC12 asks that albums can be created, renamed, reordered and removed, then checked after a restart, with no source file changes, dangling references or accidental photo removal. Roadmap decision D5 puts albums inside the Library (no new navigation item); D9 calls for scoped undo of album edits; and the roadmap requires reordering to work from the keyboard.

## Decision

- **Albums live in the Library,** in an **Albums** section under "Your moments". Opening one replaces the moments and filters with the album's own view, as an opened moment does.
- **Adding photos:**
  - **Select photos** turns each grid photo into a toggle button (`aria-pressed`), shown with "✓ Selected" in words and an outline.
  - **Add to album…** offers the existing albums or a new one.
  - Additions go at the end of the album, and photos already in it are skipped and reported.
- **Order is the person's,** not the date's.
  - `albums:photos` pages the album's photos by `position`; every member is listed, offline ones too, so positions match what reordering uses.
  - The grid component is now shared: each screen gives it a page-fetching function and, optionally, controls to wrap each photo in.
- **Rearranging is plain buttons.** **Arrange** shows "←", "→" and "Remove" on each photo, each with a full accessible name ("Move later: Photo from 6 May 2024, position 1 of 3").
  - After a move, focus returns to the same photo's same button, so pressing Return again keeps moving it.
  - Disabled buttons at the ends prevent impossible moves; the catalog refuses them too.
  - Drag and drop isn't offered yet, so nothing depends on a mouse.
- **Undo** (`undo_entry`, scope `album_edit`):
  - Add, remove, move, rename and delete each take a snapshot of the album (title, created date, ordered members) in the same transaction as the change.
  - Undo restores that snapshot exactly, including recreating a deleted album with its id.
  - Only an album's newest change can be undone, so an undo never silently discards a later edit. Each undo works once. Each album keeps its last 20 steps.
- **Deleting an album** asks first, with "Keep album" focused, and says plainly that the photos stay in the Library and their folders. It removes only the album and its memberships.

## Consequences

- **No drag and drop yet.** It can be added on top of the same move command.
- **The Undo notice covers the last album change only,** not a history.
- **Two "Create album" forms can be on screen at once** (the Albums section and the Add-to-album panel). Each is in its own labelled group.
- **Album photos whose files have all gone missing still appear in the album, marked offline.** Removing them is the person's choice.
