# ADR-0005: Indexing photo folders

Date: 2026-10-28 · Status: accepted (R3a)

## Context

R3a is the first time Nearmora touches real photo files. AC1 says originals must come out byte-for-byte unchanged, with the same modification times. AC2 says supported photos appear, everything else is counted and explained, and rescans or overlapping folders never create duplicate records.

## Decision

- **Main opens the folder picker.** The UI asks for "add folder" and never sends or receives a file path (roadmap §6.5). Sources reach the UI as id, name and status only.
- **Overlapping folders are refused.** A folder inside, or containing, an existing source is refused, as is any folder around the app's own data folder. Paths are compared after `realpath`, so a symlink or a different letter case can't sneak past. This is what makes "no duplicate locations" hold, and it guarantees thumbnails are never written inside a photo folder.
- **Every original is read, never written:**
  - The folder walk lists directories and reads metadata, and skips symlinks and hidden files.
  - The type check reads 8 bytes through a read-only handle. A file is judged by its first bytes, not its extension.
  - SHA-256 is computed from a read-only stream.
  - sharp and exifr only read.
- **Decoding happens in a separate worker process** (an Electron `utilityProcess`):
  - Each photo has 30 seconds. A photo that hangs or crashes the decoder is counted as damaged and the worker restarts.
  - sharp is capped at 100 megapixels, files over 200 MB are never decoded, and `failOn: 'error'` rejects truncated files.
  - The worker isn't an OS sandbox: it can still read files. It's only ever given paths main has already chosen.
- **Thumbnails:**
  - A 512 px oriented WebP per distinct picture, in the app-data `thumbnails/` folder, named by SHA-256. Identical copies share one.
  - Written to a temporary name, then renamed.
  - Served at `nm-media://thumb/<asset id>`. The protocol accepts only a bare id and looks it up in the catalog, so a URL can't name a file. The CSP adds `img-src nm-media:` and nothing else.
- **Dates:** `DateTimeOriginal` (or `CreateDate`) from EXIF via **exifr 7.1.3**, a new runtime dependency with no dependencies of its own; sharp doesn't parse EXIF dates. Without one, the file's modification time is used and recorded as `file_mtime`, so the UI can be honest about it.
- **dHash is computed now** (9×8 greyscale, 64 bits) and stored, so R4 doesn't need to decode every photo again.
- **Rescans:**
  - A file with the same size and modification time, whose thumbnail still exists, is skipped.
  - A path seen again updates its row.
  - Paths no longer found are marked `missing`, never deleted.
  - A missing folder marks the source `disconnected` rather than emptying it.
- **Scan counts** (found, indexed, unchanged, unsupported, damaged, too large, unreadable) are stored on the scan's `job` row, so the explanation survives a restart.
- **The catalog opens at startup** from the app-data folder, which is set to `0700` (owner only):
  - If a migration fails, a native dialog explains that it was rolled back and offers to restore the pre-migration copy.
  - A catalog from a newer app is refused, unchanged.
- **Test profile:** in unpackaged builds only, `NEARMORA_USER_DATA_DIR` points the app at a throwaway profile, so tests never touch a real app-data folder. Packaged apps ignore it.

## Consequences

- **The grid pages by offset (200 at a time, with "Show more")** and isn't virtualized. R3b replaces it with keyset paging and virtualization.
- **No pause/resume yet.** Cancel works, and a restarted scan skips finished files.
- **The packaged smoke test launches the real packaged app,** which creates an empty catalog in that machine's real app-data folder (`~/Library/Application Support/Nearmora`). It's the normal first-launch result, but worth knowing on a development Mac.
- **AC1 is proven by measurement, not by watching system calls:**
  - every file's SHA-256, size and modification time before and after
  - a recursive file watcher that must see no events during a scan, with a control test proving it does see a write
  - A system-level trace (`fs_usage`) needs admin rights and isn't automated.
