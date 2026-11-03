# ADR-0023: Added and removed places, and "My templates" as copies

Date: 2026-11-03 · Status: accepted (Studio expansion, phase S6b)

## Context

S6a let people arrange the photos a layout gives them. S6b completes the S6 scope:
- add places beyond the layout's own, or remove some of its places;
- let photos overlap freely, with control over which is in front;
- save a customised layout as one of "My templates" and start new projects from it;
- keep work when changing layout.

## Decision

- **Added places sit after the layout's own.**
  - They're stored in the settings as `extra`: rectangles as fractions of the canvas, at most 8, with a project holding at most 10 places in all.
  - A new place starts empty in the middle of the canvas, a third of its shorter side across, in front of the others, and is then edited like any other.
  - The layout still decides its own places: the catalogue checks that "places minus added places" is a count the layout takes.
  - Added places are for collages and seamless designs; a carousel's places are its slides, so the catalogue refuses them there.
- **A removed place keeps its position but holds nothing.**
  - "Remove this place" takes its photo out of the project and marks the place `removed`. It isn't drawn, exported or offered in the photo strip.
  - It's listed under "Removed places" with "Restore", and comes back empty where it was. Positions never shift, so edits and layer order stay attached to the right places.
  - The catalogue refuses a photo in a removed place, so nothing is kept out of sight in a project.
- **Overlap and order.** Photos could already be moved over each other (S6a). "Bring to front" and "Send to back" now sit next to "Bring forward" and "Send back".
- **My templates are copies (schema v8).**
  - "Save as my template…" stores the project's layout and version, size, settings (edits, added and removed places, captions) and number of places in a new table.
  - It stores no photos and has no link to the project: changing or deleting either never changes the other.
  - Starting a project from one takes exactly as many photos as its places that weren't removed. They fill the places in order, and the new project passes the same checks as any saved design.
  - Templates live in the catalogue, so they survive a restart and are in backups. One written by a newer Nearmora (an unknown layout, size or setting) is kept but not offered, rather than guessed at.
- **"Level switches keep work"** is met by the S6a design rather than by separate Customize and Advanced modes: the controls are always there, and all work is stored on top of the layout. Switching layout keeps every edit, added place and removed place, keyed by position. Added places never carry into a carousel, which isn't offered while there are any. "Reset to layout defaults" is the one way back.

## Alternatives considered

- **Re-number places when one is removed.** Tidier lists, but every edit, layer order and caption keyed by position would need moving too, and a mistake there would move the wrong photo.
- **Templates that link to their project.** Editing the project would silently change every project started from it later.
- **Separate Customize and Advanced levels,** as first planned. With every change stored as a layer on the layout, a mode switch would only hide controls; nothing would be "kept" or "lost" by switching, so it adds a step without protecting anything.

## Consequences

- **Tests:**
  - Settings limits for added and removed places.
  - Added places composed after the layout's.
  - Removed places not drawn, and restored where they were.
  - Front and back ordering.
  - Catalogue rules: added places on a collage and not a carousel; no photo in a removed place.
  - My templates: saved as copies; starting projects with the right photos, keeping removed places; a newer template kept but not offered.
  - An exported added place drawn in front.
  - An end-to-end run of adding, filling, ordering, removing and restoring places, saving a template, restarting, starting a project from it, and deleting it.
- **Control runs:** dropping added places, drawing removed ones, allowing them on a carousel, keeping a photo in a removed place, filling removed places from a template, and leaving a removed place selected in the editor each made a test fail.
- **Still open, outside S6:** renaming a saved template (delete and save again for now), and sharing templates between computers.
