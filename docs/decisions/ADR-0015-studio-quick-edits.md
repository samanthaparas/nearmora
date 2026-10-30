# ADR-0015: Studio Quick edits, undo and redo

Date: 2026-10-30 · Status: accepted (Studio expansion, phase S2)

## Context

S2 adds Quick edits to Memory Studio: replace and swap photos, fit or fill, background colour, margin, gutter, photo borders, undo and redo, and reset to the layout's defaults. Every edit must be undoable and must survive a restart. The preview and the export must keep matching (AC7, ADR-0014).

Before S2 the editor saved each kind of change through its own command (reorder, set crop, update settings). Undoing across those would have needed an "inverse" for every command.

## Decision

- **A project's design is one value.** `src/shared/studio/design.ts` defines it: layout and version, format, settings, and each photo with its crop and fit. Small pure functions make the edits (swap, move, replace, update one photo, reset).
- **One command saves a whole design.** `projects:setDesign` checks the design (schema, known layout version, photo count, each photo once, photos that exist) and writes it in one transaction. It replaces `projects:reorder`, `projects:setCrop` and the settings part of `projects:update`. The title has its own `projects:rename`.
- **Undo is a list of designs.** The renderer keeps past and future designs (`design-history.ts`, pure and unit-tested). Undo and redo save the earlier or later design through the same command, so an undo can never leave the catalog half-changed. An edit that changes nothing adds nothing; a new edit clears the redo list; 100 steps are kept.
- **A drag or pinch is one step.** Sliders, the system colour picker and pinch zoom update the preview live and are saved, as one undo step, once they pause for 300 ms (or when the editor closes).
- **Borders and fit live in the shared math.** `placePhoto()` in `layout.ts` decides the border rectangle, the part of the photo used and where it goes. With fill, the border lines the photo's place and the photo fills what's inside. With fit, the whole photo is centred and the border hugs it. A border is at most a quarter of the place's shorter side. The canvas preview and the sharp export both call it.
- **Settings stay at version 1.** `borderWidth` and `borderColor` are new optional fields. Older settings still read correctly. An older Nearmora refuses a project with a border, because the schema is strict, rather than drawing it without one.

## Alternatives considered

- **Keep the undo list in the catalog**, so it also survives a restart. Edits already survive a restart. An undo list that outlives the session raises questions (how long to keep it, what "undo" means a week later) without a clear benefit yet. This can be revisited with "My templates" (S6).
- **Commands with inverses** (reorder back, crop back). More code paths, each one a chance for undo and redo to drift from what was saved.
- **Border as a stroke drawn over the photo's edge.** Simpler, but the photo's visible area would differ by half a stroke between the browser canvas and sharp. A filled frame with the photo inset is drawn the same way by both.

## Consequences

- Saves send the whole design (at most 10 photos), which is tiny. Replies are applied only if they belong to the newest save, so a slow reply can't overwrite newer edits.
- If a save fails, the editor reloads the project as saved and says so. The undo list starts again from there.
- ⌘Z works anywhere on the editor screen except in text fields, which keep their own typing undo.
- **Tests:**
  - Placement maths for fill, fit and borders.
  - The design edits and the undo rules.
  - Whole-design saves and refusals in the catalog, including after a restart.
  - Export pixels for borders and fit.
  - An end-to-end run of every Quick edit with undo, redo, reset and a restart. A control run showed the end-to-end test failing when the ⌘Z shortcut was switched off.
