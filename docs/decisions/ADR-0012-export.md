# ADR-0012: Export

Date: 2026-10-29 · Status: accepted (R5 part 2)

## Context

- **AC7:** square 1080 × 1080 and portrait 1080 × 1350 outputs match the preview; carousel slides are consistently sized with ordered file names; JPEG transparency is flattened intentionally; GPS, EXIF, XMP and IPTC are absent.
- **AC8:** existing files and originals can't be overwritten; a full disk, cancel or crash leaves no "success" state or partly published set; retry can complete.
- **Blueprint:** a user-chosen destination outside sources and app data; a fresh, uniquely named child folder; staging on the destination volume; verification; then a same-volume rename; no cross-volume atomicity claim.

## Decision

- **Main opens the destination picker.** The UI only knows job ids.
- **Destination rules:**
  - A destination inside a photo folder (where exports would be scanned as photos), inside Nearmora's data, or not writable is refused with a reason.
  - A destination that merely contains a photo folder is fine: the export always goes into a new child folder.
- **Checks before any write:**
  - Every photo needs a reachable original in a connected folder, or it's named.
  - Each original must still be the catalogued file: same size, same modification time, **and the same SHA-256, re-hashed now**. Otherwise it's named as changed. This catches in-place edits that keep size and date.
- **Rendering** happens in the media worker (separate process, 120 s per file), with the shared layout math:
  - EXIF orientation is applied first, then the crop is cut in upright coordinates, resized to the cell, and composited onto a background canvas.
  - The result is flattened onto the background and written as an sRGB JPEG at **quality 92 with full-resolution colour (4:4:4) and the mozjpeg encoder**.
    - **Why:** the first version used quality 90 with JPEG's default half-resolution colour (4:2:0). In the owner's preview-versus-export review, saturated edges (red petals) were visibly smeared.
    - **Measured** on a 1080 × 1350 photo: 293 KB with an average error of 2.05 before, against 392 KB and 1.55 now (quality 95 at 4:4:4 would be 589 KB and 1.26).
  - sharp writes no metadata unless asked, and never is.
- **Staging and finalizing:**
  - Files are written into `<destination>/.nearmora-export-<job id>/` and then verified: the exact file list, JPEG format, exact pixel size, full-resolution colour, and no EXIF/XMP/IPTC.
  - Only then is that folder renamed in one step to `Nearmora <title> <date>`, or `(2)`, `(3)`… if taken.
  - Collages are `<title>.jpg`; carousel slides are `<title> 01.jpg`, `02`… so they sort in order.
  - Titles are made safe as file names (no `/ \ : * ? " < > |`, control characters or leading dots).
- **Failure, cancel and crash:**
  - Failure and cancel remove the staging folder. Only a folder whose name carries our prefix is ever removed.
  - The `job` row records running, then done, failed or cancelled.
  - At startup, export jobs still marked running are failed, and their staging folders removed if the name matches the job id exactly. Retrying starts afresh.
- **The Export panel** says up front what will be made (format, size, number of files) and that exporting creates new files and publishes nothing. It shows progress with Cancel, then the finished folder's name with "Show in Finder" (`shell.showItemInFolder` on a folder this run created).

## Consequences

- **The rename is atomic only on one volume,** which is why staging is on the destination. If the destination drive is unplugged mid-export, the staging folder stays on it until that drive is next exported to and cleaned, or the app recovers it at startup while the drive is connected.
- **Exporting reads each original twice** (once to hash, once to render). That's acceptable for 2–10 photos.
- **JPEG only for now.** A PNG or higher-quality option can be added to the plan's fields.
- **The preview's selection outline isn't in the export,** by design.
