# ADR-0011: Memory Studio projects

Date: 2026-10-29 · Status: accepted (R5 part 1)

## Context

Studio Lite (blueprint): two fixed collage templates (two-up and four-cell) on a 1:1 or 4:5 canvas, an ordered carousel of 2–10 slides, reorder, crop position and zoom, a cream or white background, and saved drafts. AC6 asks for keyboard reorder and crop in all three, drafts that come back exactly after a restart, and unavailable files named before export. AC7 (part 2) asks that exports match the preview.

## Decision

- **Layout math lives in one shared module** (`src/shared/layout.ts`), used by the renderer's preview now and by the export in part 2:
  - Canvases are 1080 × 1080 or 1080 × 1350.
  - Collages have a 48 px margin and a 24 px gap: two cells side by side, or a 2 × 2 grid.
  - A carousel slide is one photo filling the canvas.
  - The rules are versioned (`LAYOUT_VERSION = 1`, stored on each project).
- **Crops are proportions of the photo:** the point shown at the cell's centre (0–1 across and down) and a zoom from 1 to 4.
  - Zoom 1 is the smallest scale that covers the cell completely.
  - The visible area never goes past an edge.
  - Because crops are proportions, they mean the same on a 2048 px preview and on the original.
  - The editor clamps a crop to where it really ends up before saving, so repeated arrow presses can't build up past an edge.
- **Every edit is saved immediately** (title, shape, background, order, each crop). A draft is never "unsaved", so there's nothing to lose and nothing to guard. Reordering keeps each photo's crop with it.
- **Starting points:**
  - **Favorites** shows all favorites; photos selected there become the project's order.
  - Layout buttons are enabled only for counts that fit: 2, 4, or 2–10.
  - Each photo can be used once per project.
- **The editor:**
  - A canvas preview drawn with the shared math, using large previews and falling back to thumbnails.
  - The photo being adjusted is outlined.
  - Buttons for Move earlier/later, four pan directions, Zoom in/out and Reset. Inside that group, arrow keys pan and + and − zoom.
  - Shape and background are labelled radio groups.
- **Unavailable photos are named** (file name and folder) at the top of the editor whenever any can't be read now. Editing still works.
- **Deleting a project** asks first ("Keep project" focused) and removes only the project. `project_item` keeps `ON DELETE RESTRICT` on assets.

## Consequences

- **The preview outline** of the selected photo is preview-only; the export won't draw it.
- **The preview may use a thumbnail** when an original is offline, so fine detail can differ from the export. Export needs the original anyway.
- **Projects have no undo;** every step is small and reversible by hand. Undo for projects could use `undo_entry` later.
- **Changing shape keeps each crop's proportions,** which can frame a photo differently in the new cell shape. The person adjusts it, with the preview showing the result.
