# Memory Studio expansion: plan and catalog checklist

Date: 2026-10-30 · Status: approved by the owner (Studio expansion request, 2026-10-30). This amends the roadmap: it adds Studio phases S1–S7 after R6 part 1. R6 part 2 (signing) and R7–R8 are unchanged. Amended 2026-11-03 (approved by the owner): S4–S6 gain the strong-fit ideas from the owner's carousel-app audit (research notes kept outside the repo); the ideas that change product scope are listed at the end, awaiting a decision.

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
| **S4** ✅ | Playful templates: original decorations (own SVG artwork, provenance documented), captions that wrap and accept line breaks, masks (circle, arch, torn edge, film, ticket); template picker filters by photo count and size; export compositor spike | Each playful layout is drawn the same in preview and export; a multi-line caption wraps the same in both. Done: S4a and S4b (ADR-0017, ADR-0018): wrapping captions, picker filters and all ten playful pairs; S4c (ADR-0020): all ten playful quartets |
| **S5** ✅ | Seamless carousel: 2–3 slides, boundary guides, slide previews, master-and-slices export; layouts where a photo spans two slides; a swipe preview (slides side by side, then one at a time); a factual note when a photo's edge or detail crosses a cut, saying the platform may show a small gap there; per-slide "fit with border" so a photo can sit on a mat instead of being cropped; slices cut by the remainder rule (`floor(W / N)`, first `W % N` slices one pixel wider) and encoded with identical settings; zero-padded file numbers in posting order | PNG slices reassemble the master exactly; slice widths add up to the master width for every slide count; files sort in posting order past 9. Done (ADR-0021): S5a, the seamless mode, master-and-slices export by the remainder rule, cut guides, the seam note, sharing shapes only, numbered files tested past 9, and two layouts (Across the seam, Story strip); S5b, the swipe preview, a mat for standard carousels (Carousel version 2), two playful seamless layouts (Film roll, Scattered postcards) and the optional whole-design file |
| **S6** ✅ | Customize and Advanced levels: proportions, rounding, rotation, overlap, lock, hide, move and resize with numeric controls and snapping, layers, add/remove slots, "My templates"; snapping to edges, corners and centres; arrow-key nudging; bring forward and send back; flip a photo; take a photo out of a slot without breaking the layout; a visible list of hidden items so none are lost | Level switches keep work; custom templates survive restart; every hidden item can be found and shown again. Progress: S6a done (ADR-0022): move and resize (drag or exact numbers), snapping with guides, arrow-key nudging, angle, rounded corners, flip, lock, bring forward and send back, hide with a list of hidden photos, and empty places (schema v7); S6b done (ADR-0023): added and removed places (restorable), bring to front and send to back, My templates (schema v8, saved as copies), and work kept across layout switches; the controls are always available rather than split into levels (see ADR-0023) |
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

| # | Layout | Status | Notes |
|---|---|---|---|
| 1 | Postcards | ✅ S4a | Tilted cards, editable caption, original postmark |
| 2 | Film night | ✅ S4a | Strip with see-through sprocket holes; runs across on wide canvases; no brand labels |
| 3 | Torn pages | ✅ S4b | Seeded torn edges (the same tear every time) on white torn sheets; blush background |
| 4 | Window light | ✅ S4a | Arches with fine outlines; taller on tall canvases |
| 5 | Love letter | ✅ S4b | Stationery on an envelope; a note of up to four wrapped lines |
| 6 | Colorblock | ✅ S4b | See-through lilac and sage blocks under framed photos |
| 7 | Scrapbook | ✅ S4b | Tilted prints with see-through tape, a sprig and a heart |
| 8 | Then + now | ✅ S4b | Two editable labels; the heart is drawn art: the caption font has no ♡ |
| 9 | Circle story | ✅ S4a | Large and small circles, dots and a sprig in the free corners |
| 10 | Gallery ticket | ✅ S4b | Notched ticket with an inner line, an editable title and note; sage background |

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

Postcard stack, Film weekend, Torn journal, Garden windows, Love notes, Color play, Travel scrapbook, Four seasons, Circle collection, Keepsake ticket: ✅ S4c

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
| Seamless carousel | ✅ S5 (four layouts, swipe preview, optional whole-design file) |

## Ideas from the carousel-app audit, not yet scheduled

From the owner's carousel-app audit (research notes kept outside the repo). None is built or promised until the owner decides.

| Idea | Why it waits |
|---|---|
| Photo-dump grids of 6–12 favourites | Adds a new template family; owner's decision |
| "Start me off": place the chosen favourites in capture order in a layout that fits their number | Changes how a project starts; must never rank or judge photos; owner's decision |
| The person's own text or logo mark on exports, off by default | Later; for photographers |
| Importing the person's own fonts | After S4's compositor; needs a check of font handling and licence wording |
| Video in templates | Follows the blueprint's video direction, after the photo loop is validated |
