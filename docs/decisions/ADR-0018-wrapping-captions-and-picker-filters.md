# ADR-0018: Captions that wrap, and picker filters

Date: 2026-11-03 · Status: accepted (Studio expansion, phase S4b; from the owner's carousel-app audit)

## Context

The amended Studio plan asks S4 for two things from the audit:
- **captions that wrap and accept line breaks,** because one-line text boxes are a frequent complaint about other apps;
- **picker filters by photo count and size,** because the catalog doubles with the playful layouts.

The S4 "done when" adds: a multi-line caption wraps the same in the preview and the export.

## Decision

**Line breaking is shared code** (`textOutline` in `text.ts`), so both drawers receive the same lines.
- **How text is broken:**
  - Lines break where the person pressed Return, then between words to fit the caption's width.
  - A single word too long for a line is split between letters.
- **When text doesn't fit:**
  - Each layout sets how many lines a caption may use: Postcards 2, Love letter 4, labels and titles 1.
  - Text that needs more lines first gets smaller, down to 60% of its size.
  - If it still doesn't fit, the last line ends with "…". It never overflows the layout.
- **Lines sit 1.2 × the font size apart.** The first baseline is the caption's anchor.
- **Captions are up to 160 characters,** line breaks included. They're edited in a text box, where Return adds a line break and the ⌘Z shortcut stays with the text box.
- **The label is linked to the text box by id.** Wrapped around a textarea, a label would take in the textarea's text and give it a muddled name.
- **The preview's accessible description reads line breaks as commas,** so VoiceOver pauses between lines.

**Picker filters are plain controls above the layout groups:**
- **Show:** all layouts, ones that fit my selection, two photos, four photos, carousels.
- **Style:** any style, everyday, playful.
- **Size for the new project:** every sharing and print size. The layout drawings are redrawn at that shape, and the new project starts at that size.
- When nothing matches, the picker says so.
- The filters are radio buttons and a select, so they work by keyboard and screen reader without extra code.

**Playful layouts may set their own background** (`defaults.background`): Torn pages and Love letter use blush, Gallery ticket uses sage. "Reset to layout defaults" brings that colour back. Blush and sage are also added to the one-click background swatches.

**Shapes may be see-through** (`opacity`), for colour blocks and tape. Canvas `globalAlpha` and SVG `opacity` blend the same way.

## Alternatives considered

- **Let the browser wrap text in the preview,** and wrap separately in the export. Two line-breaking engines would break lines differently, which is exactly what the S4 check forbids.
- **Grow the layout to fit any caption.** Layout geometry would depend on text, so the photo positions would move as the person types. Shrinking and then an ellipsis keeps the layout still.
- **A search box for templates.** Not needed for about 30 layouts; filters by count, style and size answer the audit's complaint directly.

## Consequences

- **Single-line captions now also shrink only to 60%,** then get an ellipsis. Before, they could shrink without limit.
- **Tests:**
  - Line breaks, wrapping, line spacing, shrinking, the ellipsis and splitting long words.
  - A two-line Postcards caption stays on the canvas at every size.
  - Each new pair's character at every size, and export pixels for torn sheets, ticket notches and see-through blocks.
  - A full staged export of all ten playful pairs.
  - End-to-end runs of a multi-line note (Return, a restart) and of each filter.
  - Control runs showed the tests failing when line breaks were ignored or the "fit my selection" filter was switched off.
  - In the real app, preview and export were compared for the six new pairs: they match apart from the editor-only selection outline.
