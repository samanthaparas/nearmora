# ADR-0022: Customize edits sit on top of the layout, in our own drawing model

Date: 2026-11-03 · Status: accepted (Studio expansion, phase S6a)

## Context

Until S6, a person picked a layout and adjusted it: settings, crops, order. S6a lets them arrange photos themselves:
- move, resize, tilt and round the corners of a photo;
- flip it, lock it, hide it;
- change which photo is in front;
- take a photo out of its place.

The plan asked for a canvas-editor library to be considered at S6. The owner's carousel-app audit adds:
- snapping to edges and corners;
- arrow-key nudging;
- layer order and flip;
- removing a photo without breaking the layout;
- a visible list of hidden items, so nothing gets lost.

## Decision

- **Edits are stored on top of the layout, not instead of it.**
  - A project's settings gain `edits`, keyed by photo position: a place (as fractions of the canvas), an angle, rounded corners, flip, lock, hidden. They also gain `order`: the drawing order, back to front.
  - Only what the person changed is stored. `compose()` applies it, so the editor's preview, the picker and the export keep drawing one composition (AC7).
  - "Reset to layout defaults" clears every edit, and "Back to the layout's place" clears one photo's.
  - Fractions keep a moved photo's proportions if the size changes.
- **Shaped photos keep their shape.** A circle, arch or torn edge is moved and scaled with the photo, so a stretched circle becomes an ellipse rather than staying where it was. Plain photos can have rounded corners instead.
- **Hidden photos are drawn nowhere and listed always.** The shared drawing order (`layers.ts`) leaves them out, so they can't appear in an export by accident. While any is hidden, the editor lists them, each with "Show".
- **An empty place really is empty (schema v7).**
  - Taking a photo out sets that place's photo to null, so the photo leaves the project. Clean up no longer counts it as used.
  - The layout keeps the place, shown as a dashed outline in the editor, and it can be filled again.
  - A project keeps at least one photo.
  - Empty places export as the background, as the owner chose, and the Export section says so beforehand.
  - The migration rebuilds the item table with the photo column allowed to be empty; existing rows are copied, and a photo in a project still can't be deleted underneath it.
- **Snapping and nudging.**
  - While a photo is dragged or resized, its edges and centre snap to the canvas's edges and centre, and to other photos' edges and centres, within 10 reference pixels. The line it snaps to is drawn. ⌘ turns snapping off.
  - Arrow keys nudge 1 pixel, or 10 with Shift. Every drag can also be done with the number fields, for keyboard and screen-reader users.
- **No canvas-editor library.** Our own model already guarantees preview = export, works with number fields and the keyboard, and needed only two small pure modules: `arrange.ts` (the changes) and `snap.ts`. A library would bring its own scene model to keep in step with the export, plus a new dependency and licence.

## Alternatives considered

- **Copy the layout into free-floating elements on the first edit.** Simpler to edit, but the project would lose its link to the layout: reset, size changes and layout switches would stop working, and nothing would show what was changed.
- **Mark an empty place in the settings and keep the photo in the project.** No migration, but the photo would still count as "used", and Clean up would refuse to remove a photo the person had already taken out.
- **Adopt a canvas-editor library** (as the plan allowed). Covered above.

## Consequences

- **Decorations stay in the layout's places.** A playful layout's line art, captions and tape are placed for the layout's photo positions; they don't follow a moved photo. The editor's preview shows this exactly, so nothing is hidden by it.
- **Tests:**
  - The stored edits and their limits, the edits applied in compose (place, proportions at another size, angle, corners, flip, lock, hide, order), moving a circle, path transforms, snapping and nudging logic, layer order changes, and emptying a place.
  - Migration v7 keeping every project photo.
  - Empty places in the catalogue and in Clean up.
  - Exported pixels for flip, rounded corners, hidden photos and empty places.
  - An end-to-end run of drag, typed size, nudge, flip, layer order, lock, hide and show, and emptying a place, all kept after a restart.
- **Control runs:** ignoring the moved place, drawing hidden photos, dropping flip in export, allowing an all-empty project, turning off snapping, leaving a shape behind, treating an empty place as offline, and disabling dragging each made a test fail.
- **Still to come in S6b:** adding and removing places, free overlap, "My templates", and switching levels while keeping work.
