# ADR-0021: Seamless carousels are one design, cut by the remainder rule

Date: 2026-11-03 · Status: accepted (Studio expansion, phase S5a)

## Context

A seamless carousel is one wide picture cut into slides, so photos can run from one slide into the next and the post swipes like one image. The owner's carousel-app audit found two common faults in tools that make them:
- thin lines where the slides meet;
- slides that don't match, because each was rounded, drawn or encoded on its own.

Nearmora already had standard carousels (one photo per slide) and collages. S5a adds the seamless kind.

## Decision

- **A new layout mode, `seamless`.** A seamless layout says how many slides it has. Its composition is one canvas, as wide as all the slides together.
  - Spacing scales with a single slide's shorter side, like every other layout.
  - The preview, the picker drawing and the export all draw this one composition.
- **The design is drawn once, then cut.**
  - The export renders the whole design to raw pixels in one pass.
  - It cuts that into slices by the remainder rule: each slice is `floor(W / N)` wide, and the first `W mod N` slices get one more pixel, so the widths always add up exactly.
  - Every slice is encoded from the same pixels with the same settings (JPEG quality 92, full-resolution colour, no metadata).
  - With today's slide sizes (1080 wide) every slice is the same width; the rule is there, and tested, for any width.
- **The editor shows the cuts.** Dashed guides are drawn from the same slicing numbers the export uses. They're editor-only and never exported.
- **A factual note when a photo meets a cut.** If a photo runs across a cut, or one of its edges sits within 12 reference pixels of one, the editor says so: apps show a small gap between slides, or a sliver may show on the next slide. Crossing a cut is the point of the layout, so the note informs rather than warns.
- **Sharing shapes only.** Seamless layouts are made at square or portrait slides. The catalogue refuses any other size, whether on creation or when the size or layout changes. Switching layouts, or creating from a print size in the picker, falls back to square.
- **Numbered files.** Slides are named "Title 01.jpg", "Title 02.jpg"…, zero-padded so 10 sorts after 09. Standard carousels already did this; it's now tested past 9.
- **First layouts:**
  - Across the seam: 2 slides, 3 photos, a large photo centred on the cut.
  - Story strip: 3 slides, 5 photos, two of them across the cuts.

## Alternatives considered

- **Render each slide separately,** shifting the design left by the slide's offset. This draws the edge pixels twice, and anti-aliasing or rounding could differ at the cut, which is the "white line" fault.
- **Round each slice's share on its own** (`round(W / N)`). The slices can then add up to a pixel more or less than the design.
- **Let the person drag guides.** Hand-placed guides are the other common source of mismatched slices; the cuts follow from the slide count instead.

## Consequences

- **The render path changed for every export.** Collages and carousels are now also drawn to raw pixels and then encoded. All earlier export tests (pixel colours, crops, borders, print density, metadata, full-resolution colour) still pass.
- **Tests:**
  - The remainder rule, for widths from 2 to 21,601 px and 1 to 20 slices.
  - Cut positions, the wide composition, both layouts, and the seam notes, including edges just beside a cut.
  - Lossless PNG slices put side by side match the whole design byte for byte, for the Story strip and for a 1001 px design cut into 334 + 334 + 333.
  - A full seamless export at both shapes, and ten carousel files sorting in order.
  - The catalogue refusing other sizes.
  - An end-to-end run: picker, guides, note, size choice and a two-file export.
- **Control runs** broke each rule in turn (overlapping slices, rounding each slice, no edge note, no size check, unpadded numbers); a test failed every time.
- **Still to come in S5b:** the swipe preview, a mat for standard carousels, two playful seamless layouts, and the optional whole-design file.
