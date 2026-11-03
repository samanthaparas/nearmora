# ADR-0024: Upright photos on top are placed directly, not through the SVG

Date: 2026-11-03 · Status: accepted (Studio expansion, phase S7)

## Context

Since ADR-0017, every export is one SVG rendered by sharp (librsvg). Each photo is cropped and resized by sharp to the exact pixels it covers, then embedded in the SVG as PNG data. The SVG places, clips and tilts the pieces, and draws the shapes and captions.

S7's measurement of a 10-photo collage at 16 × 24 in (34.6 MP) took 75 s:
- 1.5 s to prepare the photo pieces;
- 55 s for the SVG renderer to draw, most of it unpacking 176 MB of embedded PNG data;
- the rest encoding the JPEG.

## Decision

- **Photos at the top of the drawing order are placed onto the drawn image as pixels,** when they are:
  - upright, unshaped, not on a card;
  - wholly on the canvas.

  The SVG draws everything below them. Their borders are placed the same way, as solid rectangles.
- **Everything else stays in the SVG:** tilted or shaped photos, photos on cards, photos with a decoration drawn over them, and photos partly off the canvas. Then nothing changes order and nothing outside the canvas has to be clipped by hand.
- **Transparency is kept,** so a see-through photo shows the canvas behind it, as in the SVG.
- **The result must be identical.** A permanent test renders designs both ways and compares them byte for byte. An invisible shape drawn last forces every photo through the SVG.

## Alternatives considered

- **Embed JPEG instead of PNG pieces.** Much smaller, but the photo would be compressed twice, breaking the "copied 1:1 with full-resolution colour" guarantee.
- **Store PNG pieces uncompressed.** Less encoding work, but the SVG renderer still has to read every byte. It doesn't address where the time goes.
- **Composite every photo directly, and draw shapes in separate passes.** It would also speed up playful layouts, but it splits the one drawing into several and needs hand-written masking and tilting. That's more risk to "preview = export" than the gain is worth now.

## Consequences

- **Faster:** the 10-photo, 16 × 24 in export takes about 10 s, and a 3-slide seamless export 1.8 s (was 2.8 s), on an M1.
- **Same pixels:** six designs (a bordered grid, fitted photos, a flipped photo, a photo partly off the canvas, a seamless strip, a playful layout) were compared byte for byte with the earlier renderer and are identical. The permanent test fails if a placed photo is moved by even one pixel (control run).
- **Not faster:** playful layouts with tilted or shaped photos keep the SVG path and its cost.
