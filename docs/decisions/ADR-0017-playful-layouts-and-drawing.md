# ADR-0017: Playful layouts, and one drawing model for preview and export

Date: 2026-11-03 · Status: accepted (Studio expansion, phase S4a)

## Context

The playful layouts (S4) add more than photo rectangles:
- photos cut to circles and arches;
- photos tilted on white cards;
- film strips with sprocket holes, colour blocks and tickets;
- line art (sprigs, hearts, postmarks);
- editable captions.

The preview (browser canvas) and the export (sharp, in the main process) must still draw the same picture (AC7). Rectangles and colours were easy to match. Text and decorations were the open question that ADR-0014 left for a spike.

## The spike

One test scene had an arch-masked photo, a circle-masked photo, a tilted postcard, a line-art sprig and a handwritten caption. It was drawn by a Chromium canvas (in Electron, as the preview draws) and by sharp rendering one SVG.

- The two images differed by an average of 0.87 out of 255 per pixel.
- Only 0.02% of pixels differed by more than 40, all of them on anti-aliased edges.
- A 5760 × 7200 render took about 5 s and 0.5 GB of memory.

Later the same comparison was made in the real app, between the editor's preview and an exported file for each S4a layout. Apart from the editor-only selection outline, they differ only at edges.

## Decision

- **Everything that isn't a photo is vector path data in canvas pixels,** built by shared code:
  - `scene.ts`: shapes and line art;
  - `playful.ts`: the playful templates;
  - `text.ts`: captions.
- **A slot can be shaped.** It may be tilted (`rotation`), cut to a shape (`mask`) or set on a card (`frame`).
- **A template can decorate.** It can add shapes `under` and `over` the photos, and offer caption slots whose words live in the project's settings (`params.text`).
- **Captions become letter outlines,** using opentype.js and the bundled Caveat font, before either side draws them.
  - Neither side depends on fonts installed on the computer, so text can't lay out differently between preview and export.
  - Characters the font lacks (♡, emoji) are left out, and the editor names them. Hearts are drawn as artwork instead.
- **One drawing order.** `layers.ts` lists each canvas's layers once: shapes under, photos, shapes and captions over.
  - The preview walks that list with the canvas API.
  - The export turns it into one SVG and renders it with sharp.
  - Both use the same transforms (translate, rotate, scale; tilt around the photo's centre) and the same `placePhoto()`.
- **The export keeps its photo pipeline.** sharp still crops and resizes each original to exactly the whole pixels it covers, with EXIF orientation and full-resolution colour. The SVG only places, clips and tilts those pieces.
  - The existing test that a photo is copied 1:1 with full-resolution colour still passes on the new renderer.
- **Borders on shaped photos run along the inside of the mask.**
- **Artwork is original,** drawn as code for Nearmora. Film frames carry no brand names.
- **New dependencies:**
  - opentype.js 1.3.4 (MIT), with @types/opentype.js;
  - @fontsource/caveat 5.3.0 (SIL Open Font License).

  Both are bundled at build time. The font is inlined as data, because the app's CSP blocks fetching, and the same import works in the main process, the UI and the tests.

## Alternatives considered

- **Export by drawing in a hidden browser window,** so preview and export share one canvas. It would match by construction, but it needs a second window able to read originals, more memory, and its own route to full-resolution colour JPEGs. The spike showed it isn't needed.
- **Let sharp's SVG renderer lay out text with `<text>`.** It depends on system fonts and a different text layout engine, which is the main risk this decision removes.
- **Draw text on the canvas and in SVG separately with the same font file.** Glyph shapes would match, but line widths, kerning and fitting could still differ.

## Consequences

- Every export now goes through the SVG renderer, including everyday layouts. All earlier export tests still pass on it, including pixel checks, metadata, print density and every size up to 16 × 24 in.
- The picker shows playful layouts in their own group. Their picker drawings come from the same layers.
- **Licence notices are needed before distribution.** The app doesn't yet ship third-party licence notices for the libraries and fonts it bundles (Fraunces, Source Sans 3 and Caveat are OFL; React and opentype.js are MIT). The pre-beta checklist must add them.
- **Tests:**
  - Text outlines: fitting, anchoring, characters the font lacks.
  - Caption settings and the drawing order.
  - Each playful pair's character at every size.
  - Export pixels: masks, see-through sprocket holes, white cards, drawn captions.
  - A full staged export of each playful pair at print size.
  - An end-to-end run of the picker, caption editing with undo, and a restart.
  - Control runs showed the tests failing when masks or captions were switched off.
