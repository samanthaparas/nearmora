# ADR-0020: Playful quartets, and decorations that find their own room

Date: 2026-11-03 · Status: accepted (Studio expansion, phase S4c)

## Context

S4c adds the ten playful four-photo layouts from the owner's concept board:
- Postcard stack, Film weekend, Torn journal, Garden windows, Love notes;
- Color play, Travel scrapbook, Four seasons, Circle collection, Keepsake ticket.

They use the drawing model from ADR-0017 unchanged: shapes, masks, tilted cards, line art and captions as outlines.

The new problem is room. With four photos there is much less free space for line art, and how much there is changes with every size, from a 1200 × 628 wide post to a 16 × 24 in print, and with the margin and gutter the person chooses. Placing art at fixed positions, as the pairs do, would put a sprig on a photo at some size.

## Decision

- **Four photos are laid out by one rule.** They go in a 2 × 2 grid, or in one row or one column when that gives photos at least 25% bigger (wide and very tall sizes). Below 25% the grid reads better than a thin line.
- **Decorations find their own room.** Each piece of line art has a list of preferred spots (corners, sides, the space between circles).
  - It goes at the first spot, at the largest size, where it touches no photo (including the card and tilt around it), no caption and no other art, and stays clear of the canvas edge.
  - If there's no room even at its smallest size, it's left out. A missing sprig is better than a covered photo.
- **Captions get reserved room.** Notes, labels and titles sit in a row kept for them, so the words the person types are never dropped for lack of space.
- **Shared pieces move, unchanged.** The film strip and the tape strip are now shared with the pairs. A check showed every existing layout composes exactly as before at every size.
- **New artwork is original:** a wax seal (a disc with a heart). Colours come from the existing palette.

## Alternatives considered

- **Fixed positions with size rules per format,** as the pairs use. Ten layouts × ten sizes × any spacing is too many cases to get right by hand, and nothing would prove it.
- **Drawing art over photos and accepting it.** It goes against the concept board's look and the person's photos.

## Consequences

- **Tests:**
  - A unit test checks, for every quartet at every size and at three spacings (the layout's own, none, and a lot), that no line art, caption or label touches a photo or leaves the canvas. Tape is the one decoration meant to cross a card.
  - Character tests check what makes each quartet itself.
  - Each quartet is exported through the full pipeline at 8 × 10 in, 300 ppi.
  - An end-to-end test picks a quartet, edits a label with undo, and restarts.
  - Control runs removed each placement check (for photos, for card tilt, for circles) and broke the film and label geometry; a test failed every time.
- **Preview and export:** in the built app, the editor's preview of each quartet differed from its export by a mean of 2.6–4.1 out of 255 per pixel. The differences are the editor-only selection outline, anti-aliased edges, and the preview using a smaller copy of each photo.
