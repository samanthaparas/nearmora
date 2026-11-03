# ADR-0016: Sharing and print sizes, and print sharpness warnings

Date: 2026-11-03 · Status: accepted (Studio expansion, phase S3)

## Context

Studio offered three 1080-pixel shapes. The expansion plan adds two more sharing sizes (vertical 1080 × 1920, wide 1200 × 628) and five print sizes (8 × 8, 8 × 10, 12 × 8, 12 × 18 and 16 × 24 in). A photo that looks fine on a phone can look soft on paper, so people need to know before they export a print. Nearmora doesn't post anywhere or order prints, and it makes no claim about any platform's or print service's rules.

## Decision

- **Sizes are presets with a use.** Each format in `formats.ts` is either `share` or `print`. The editor shows them as two groups: "Shape for sharing" and "Print size".
  - Formats are stored as text and checked by the app (ADR-0014), so adding them needed no schema change.
  - Margins, gutters and borders are in reference pixels, so every layout keeps its look at every size.
- **Print sizes are 300 output pixels per inch** at the size named: 8 in × 300 = 2400 px. Common print guidance uses this figure, and it keeps the largest size (16 × 24 in, 34.6 megapixels) within what sharp handles in a few seconds.
- **Effective resolution is the photo's own pixels per printed inch.** `resolution.ts` works it out after crop, zoom, fit and border, using the same `placePhoto()` as the preview and export.
  - 200 and up counts as good.
  - 150–199 may look soft up close.
  - Below 150 is likely to look blurry.
  - These thresholds are Nearmora's own guide, and the docs say so.
  - The editor names each affected photo before export and says what helps: zooming out, showing the whole photo, or a smaller size.
  - It warns rather than blocks. The person may still want the print.
- **Print files record 300 pixels per inch** in a standard JFIF header inserted after the JPEG start marker, so print software sizes the file correctly.
  - sharp's `withDensity()` would write an EXIF block, and exports promise no EXIF at all.
  - The export's verification step checks the density, alongside size, colour and no metadata.
- **Tall shapes get a narrower preview**, so the whole canvas fits beside the controls.

## Alternatives considered

- **Block exports below a threshold.** Too strict: a large print viewed from across a room can use fewer pixels per inch, and the person knows their use better.
- **Warn on sharing sizes too.** Screens show small images well. Warnings on every phone-sized project would teach people to ignore them.
- **Leave the density at sharp's default (no header, read as 72).** Some print software would then read a 4800-pixel file as 66 inches wide.

## Consequences

- Ten sizes, two groups in the editor. Adding a size is one line plus its tests.
- **Tests:**
  - Every layout at every size: photo count, inside the canvas, no overlaps.
  - Print sizes are 300 × their inches, and wide is about 1.91 : 1.
  - Resolution figures for fill, zoom and fit, plus the thresholds.
  - Every size exported at its exact pixel size and verified, with print density and no EXIF.
  - An end-to-end check that small photos are named at a print size, and that the warning goes away at a sharing size.
  - Control runs showed these tests failing when the warnings or the print density were switched off.
