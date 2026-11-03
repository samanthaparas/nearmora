# Memory Studio expansion: plan and catalog checklist

Date: 2026-10-30 · Status: approved by the owner (Studio expansion request, 2026-10-30). This amends the roadmap: it adds Studio phases S1–S7 after R6 part 1. R6 part 2 (signing) and R7–R8 are unchanged.

References: the two-photo and four-photo concept boards and their guides (owner's design references, kept outside the repo). They are visual references only. No sample photograph or decoration from the boards is shipped.

## Where Studio stands today (R5, R6 part 1)

- Three fixed kinds: two-photo collage, four-photo collage, carousel (2–10 slides). One shared `layout.ts` computes the cells; margins (48 px) and gaps (24 px) are fixed.
- Square, portrait and landscape shapes; cream or white background.
- Each photo's crop is stored as a proportion of the photo (centre point and zoom), so it means the same at any size. Every change saves immediately; there is no undo.
- The preview draws with the browser canvas; the export draws with sharp in the main process. Both use the shared layout math.
- The export is staged, verified (size, full-resolution colour, no metadata) and crash-safe.
- In the database, `project` stores the kind, shape and background with CHECK constraints; `project_item` stores each photo and its crop.

## Decisions (explained in ADR-0014)

1. **Templates are code, projects are data.** Each built-in template is a small, pure function that takes a canvas size and the person's settings and returns elements (photo slots now; shapes, text and decorations later). Templates are versioned, so a project always reopens with the rules it was made with. A project stores the template id and version, the format, its settings (as validated JSON) and its photos with their crops. Custom templates (S6) are copies of settings and elements stored in their own table, so they never share mutable state with a project.
2. **One composition, two drawers, until text arrives.** S1 resolves every project into one list of elements in canvas pixels. The preview and the export both draw exactly that list. Rectangles, rounded corners and borders can be drawn identically by the browser canvas and by sharp. Text and decorative artwork (S4) can't be matched reliably between the two, so S4 will move export compositing into a hidden, sandboxed Chromium canvas running the same drawing code as the preview. sharp will still decode, crop and resample the originals and encode the final JPEG with full-resolution colour. That decision is made at S4 with a spike, not before.
3. **Formats are settings, not CHECK constraints.** Shapes and print sizes will grow (S3). Schema v5 stores the format as text, validated by the app's schema, so adding a format doesn't need another table rebuild.
4. **Seamless carousels use one master canvas.** S5 renders the whole strip once, then cuts exact adjacent integer slices. PNG slices are tested to reassemble the master pixel for pixel; JPEG slices are inspected separately.
5. **No new dependencies yet.** No canvas-editor library is needed for S1–S3. One will be evaluated at S6 (freeform editing) for accessibility, Electron compatibility, export fidelity, licence and size, and adopted only if it beats extending our own model.

## Phases

| Phase | Contents | Done when |
|---|---|---|
| **S1** | Versioned composition schema; template definitions; resolver; preview and export drawing from one composition; schema v5 migration of existing projects; first templates: Equal split, Stacked, Classic grid, carousel | Existing projects open and export identically; new projects can start from the three templates |
| **S2** ✅ | Quick edits: replace photo, swap, fit or fill, background colour, gutter, margin, border width and colour, undo and redo, reset to template | Every Quick edit is undoable and survives restart. Done: edits are saved at once and survive a restart; the undo list covers the current editing session (ADR-0015) |
| **S3** ✅ | Remaining everyday layouts (8 pairs, 10 quartets) — done first, as S3a, at the owner's request; then social presets (square, portrait, vertical, wide) and print presets with an effective-resolution warning | All 18 everyday layouts are selectable and exported correctly at every preset. Done: S3a (layouts) and S3 (sizes and print warnings, ADR-0016) |
| **S4** | Playful templates: original decorations (own SVG artwork, provenance documented), captions, masks (circle, arch, torn edge, film, ticket); export compositor spike | Each playful layout is drawn the same in preview and export |
| **S5** | Seamless carousel: 2–3 slides, boundary guides, slide previews, master-and-slices export | PNG slices reassemble the master exactly |
| **S6** | Customize and Advanced levels: proportions, rounding, rotation, overlap, lock, hide, move and resize with numeric controls and snapping, layers, add/remove slots, "My templates" | Level switches keep work; custom templates survive restart |
| **S7** | Performance limits, accessibility pass (VoiceOver, 200% zoom, reduced motion), recovery tests, packaged-app verification | Release checklist for Studio passes |

Each phase lands as its own pull request. Unfinished templates are never offered as working choices.

## Catalog checklist

Status: ✅ implemented · 🟡 partly implemented · ⬜ pending

### Two-photo, everyday

| # | Layout | Status | Notes |
|---|---|---|---|
| 1 | Equal split | ✅ S1 | Was the original "two-photo collage" |
| 2 | Stacked | ✅ S1 | |
| 3 | Wide gutter | ✅ S3a | |
| 4 | Quiet frame | ✅ S3a | |
| 5 | Tall + detail | ✅ S3a | |
| 6 | Landscape pair | ✅ S3a | Keeps both photos landscape-shaped, so on the Wide size it stacks them and leaves space at the sides |
| 7 | Offset pair | ✅ S3a | |
| 8 | Full bleed pair | ✅ S3a | |

### Two-photo, playful

Postcards, Film night, Torn pages, Window light, Love letter, Colorblock, Scrapbook, Then + now, Circle story, Gallery ticket: ⬜ S4

### Four-photo, everyday

| # | Layout | Status | Notes |
|---|---|---|---|
| 1 | Classic grid | ✅ S1 | Was the original "four-photo collage" |
| 2 | Gallery mat | ✅ S3a | |
| 3 | Four across | ✅ S3a | Leaves open space on square and portrait canvases, as on the board: four tall photos in a row can only be so tall |
| 4 | Four stories | ✅ S3a | |
| 5 | Lead + three | ✅ S3a | |
| 6 | Top story | ✅ S3a | |
| 7 | Quiet columns | ✅ S3a | |
| 8 | Offset grid | ✅ S3a | |
| 9 | Wide + tall | ✅ S3a | |
| 10 | Edge to edge | ✅ S3a | |

### Four-photo, playful

Postcard stack, Film weekend, Torn journal, Garden windows, Love notes, Color play, Travel scrapbook, Four seasons, Circle collection, Keepsake ticket: ⬜ S4

### Quick edits (S2)

| Edit | Status | Notes |
|---|---|---|
| Replace photo | ✅ S2 | From Favorites; photos already in the project aren't offered |
| Swap | ✅ S2 | With any other photo; crop and fit travel with the photo |
| Fit or fill | ✅ S2 | Per photo; crop controls switch off while the whole photo is shown |
| Background colour | ✅ S2 | Cream, white, sand, charcoal, or any colour from the system picker |
| Margin and gutter | ✅ S2 | Sliders, 0–200 px at 1080 (scale with the canvas); collages only |
| Border width and colour | ✅ S2 | 0–60 px, inside each photo's place; hugs the photo when it's shown whole |
| Undo and redo | ✅ S2 | Buttons and ⌘Z / ⇧⌘Z; a drag or pinch is one step; 100 steps per session |
| Reset to layout defaults | ✅ S2 | Photos and order stay; can be undone |

### Formats

| Format | Size | Status |
|---|---|---|
| Square | 1080 × 1080 | ✅ |
| Portrait | 1080 × 1350 | ✅ |
| Landscape | 1350 × 1080 | ✅ |
| Vertical | 1080 × 1920 | ✅ S3 |
| Wide (about 1.91:1) | 1200 × 628 | ✅ S3 |
| Print 8 × 8 in | 2400 × 2400 | ✅ S3 |
| Print 8 × 10 in | 2400 × 3000 | ✅ S3 |
| Print 12 × 18 in | 3600 × 5400 | ✅ S3 |
| Print 16 × 24 in | 4800 × 7200 | ✅ S3 |
| Print 12 × 8 in | 3600 × 2400 | ✅ S3 |

Print sizes are 300 output pixels per inch at the size named, and print files record that density (in a JFIF header, never EXIF). Before a print export, the editor names any photo with fewer than 200 of its own pixels per printed inch (after crop, zoom, fit and border): 150–199 "may look soft up close", under 150 "likely to look blurry". These thresholds are Nearmora's own guide, not a print service's rule.

Formats are labelled by shape and intended use. No claim about a platform's current requirements is made unless it has been checked against that platform's official documentation. There is no posting, account connection, printing service or ordering.

### Modes

| Mode | Status |
|---|---|
| Single collage | ✅ |
| Standard carousel | ✅ (one photo per slide) |
| Seamless carousel | ⬜ S5 |
