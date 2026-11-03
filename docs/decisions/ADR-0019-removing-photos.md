# ADR-0019: Removing photos the person chooses (Clean up)

Date: 2026-11-03 · Status: accepted by the owner; implemented in milestone C1

## Context

Nearmora was built read-only: no command could delete, move or rename an original (blueprint §8, ADR-0001's bridge rules). The owner has decided that helping people clear clutter and duplicates is part of the product's purpose. People need to be able to remove photos they don't need, including permanently. The original requirements already allow this with consent: originals must not be modified, moved or deleted "without explicit user consent".

Deleting someone's photo is the one action in Nearmora that may not be undoable, so the safeguards matter more than the feature.

## Decision

**Two ways to remove, chosen each time.**
- **Move to Trash** is the default. The file goes to the macOS Trash, through Electron's `shell.trashItem`, and can be put back from there.
- **Delete forever** removes the file immediately (`unlink`) and can't be recovered by Nearmora or the person.
  - It's never the default button and never a single keystroke.
  - Its confirmation is a native dialog shown by the main process, naming how many files and where. The UI can't skip it.

**The person chooses every photo.**
- No automatic deletion, no "delete all similar", and no ranking of photos for deletion.
- Exact duplicates can be cleared in one step, but each group always keeps at least one copy, and the person sees which copy stays.

**Checks before every removal, in the main process, file by file.** A file is refused, and left untouched, unless all of these hold:
1. **It's in the catalog.** It's identified by its catalogue entry (picture and location id), never by a path sent from the UI.
2. **It's in one of the person's folders.** The source is active, and the file's real path is inside that folder's real path.
3. **It's an ordinary file.** Not a symbolic link, and not inside Nearmora's own data.
4. **It's the same file that was catalogued.** Same size and modification time, and the same SHA-256 fingerprint. A file edited or replaced since the scan is never removed.

**The catalogue follows the files.**
- A removed file's location is dropped from the catalogue.
- When a picture's last copy goes, the picture leaves the Library, its moments, sets, favourites and albums.
- A picture used in a Memory Studio project can't have its last copy removed. The person is told which project uses it, so a draft can't silently lose a photo.

**A record of what was removed.** Each removal is recorded locally: when, which way (Trash or forever), the file name, the folder name and the size. No images, no metadata. The record stays on the computer like the rest of the catalogue.

**Tests never touch real photos.**
- Removal is tested only on files the test itself creates in temporary folders.
- The Trash step is injectable, so automated tests use a stand-in Trash folder instead of the computer's real Trash.

**Unchanged.** Nearmora still never moves, renames or rewrites photos, never edits their metadata, and never uploads anything. Removing a folder from Nearmora still only affects the catalogue.

## Alternatives considered

- **Mark only, and let the person delete in Finder.** It keeps the read-only promise, but it doesn't meet the product's purpose of getting rid of clutter. It also makes duplicates tedious to clear by hand.
- **Trash only.** Safer, but the owner wants a true "delete forever" option, for example for sensitive photos people don't want sitting in the Trash.
- **Delete forever with an in-app confirmation only.** The UI could be made to skip its own dialog. A main-process native dialog keeps the final decision outside the UI's reach.

## Consequences

- **The README's promise must change** when C1 ships. "It never moves, edits or deletes your photos" becomes "it never changes or moves your photos, and removes them only when you ask".
- **The bridge gains removal commands,** by catalogue id only. Generic file access stays absent.
- **Fewer read-only guarantees.** The tests that prove other actions leave originals untouched still apply everywhere outside Clean up.
- **Videos aren't covered** until Nearmora shows videos at all.

## Implementation (C1)

- **Catalogue:** schema v6 adds `unneeded` (the "Don't need" marks) and `removal_log` (the record, with no link to the catalogue so it outlives the pictures it lists).
- **Code:** `src/main/library/remove-photos.ts` is the only code that removes a photo file. It plans the removal, re-checks each file, removes it, then updates the catalogue one file at a time, so a failure part-way leaves the catalogue matching the disk.
- **Two more safeguards found while building:**
  - Removal waits for scans, and scans wait for removal, so a scan can't re-record a file while it's being removed.
  - When a picture leaves the catalogue, its cached thumbnail and preview (Nearmora's own data) are deleted too, so nothing of a photo deleted forever stays inside Nearmora.
- **Duplicates** means byte-identical files. Photos that only look alike stay in Best Moments.
- **Tests:**
  - Integration tests cover each check (changed bytes with the same size and date, a file replaced by a link, a folder that now resolves elsewhere, offline and missing files, the last copy, a project's photo, a failing Trash step).
  - An end-to-end test runs the whole flow with a stand-in Trash folder and the native dialog answered both ways.
  - Control runs removed each check in turn, and skipped the native confirmation; each time a test failed.
