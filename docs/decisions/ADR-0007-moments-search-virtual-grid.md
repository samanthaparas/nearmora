# ADR-0007: Date moments, search and the virtualized grid

Date: 2026-10-29 · Status: accepted (R3b part 2)

## Context

The blueprint asks for:
- date-based moments with default titles from the date (never invented descriptions), which people can rename and give a cover
- search over file name, title and folder
- date, folder and favorite filters
- a virtualized grid, so large libraries stay smooth

Choices must survive rescans and regrouping.

## Decision

- **Moments break on a gap of more than 8 hours** between consecutive photos, ordered by capture time and then id. Exactly 8 hours stays in the same moment.
- **The grouping exists in TypeScript and in SQL** (`LAG` plus a running `SUM` window), and the tests check they agree on 2,000 random photos with ties. On 10,000 synthetic photos the TypeScript loop took about 1.5 ms (including reading the rows in index order), against about 11 ms for SQL, so the app uses TypeScript and keeps SQL as a cross-check. The roadmap listed this comparison as a stretch goal; the measurement decided it.
- **Regrouping runs after every scan** (including paused or failed ones, since photos may still have changed) **and after removing a folder.** It's one transaction:
  - Each new group is matched one-to-one to the old moment it shares the most photos with, so ids, renamed titles and chosen covers carry over.
  - A cover that left its moment is cleared, never moved to another photo.
  - Moments with no photos left are deleted. Photos are never touched.
- **Default titles** are the date or date range, formatted with `Intl.DateTimeFormat#formatRange` in the system language and stored as `auto_title`. A renamed title goes in `title`; "Use date as title" sets it back to null.
- **Search** is a case-insensitive `LIKE` over each file's relative path (its name and subfolders), the folder's display name, and moment titles. `%`, `_` and `\` are escaped, so a search for "50%" means those characters. Every value is a bound parameter.
- **Filters:** date range (whole local days), one folder, favorites only, and the opened moment. They combine, and the total is counted for the filtered set.
- **Keyset paging replaces offset paging.**
  - Order is `captured_at DESC, id DESC`, undated photos last. Each page continues strictly after the previous page's last photo, so deep pages cost the same as the first, and photos arriving mid-scroll can't cause skips or repeats.
  - **Schema v3** rebuilds `idx_asset_captured` on `(captured_at, id)`, so this order is read straight from the index, often as a covering index.
- **Virtualized grid** with **@tanstack/react-virtual 3.14.19**, a new dev dependency bundled into the UI, pinned to a release more than two weeks old:
  - Rows are measured from the available width (at least 160 px per cell), and only visible rows plus 4 extra are in the page.
  - Pages of 300 load as the end comes near.
  - Each cell carries `aria-setsize` and `aria-posinset`, so a screen reader still hears "photo 401 of 1,200".
  - A scan refresh reloads as many photos as were already loaded, so the view doesn't jump.

## Consequences

- **Moment renames don't write undo entries yet** (decision D9 allows it); renaming back or "Use date as title" covers the common case.
- **Search is substring matching, not full-text.** If it gets slow at large scale, SQLite FTS5 is the next step, measured first.
- **The 8-hour gap is a starting value**, to be tuned with real libraries; it's one constant.
- **Moment titles use the system language** at grouping time. Changing the Mac's language updates them at the next regroup.
