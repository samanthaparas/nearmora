# ADR-0014: Memory Studio templates and compositions

Date: 2026-10-30 · Status: accepted (Studio expansion, phase S1)

## Context

Studio Lite had three fixed kinds (two-photo, four-photo, carousel), fixed spacing and three shapes, all enforced by CHECK constraints. The Studio expansion (see `docs/planning/Nearmora-Studio-Expansion-Plan.md`) adds dozens of templates, social and print formats, editable settings, decorations and seamless carousels. Each template is an editable starting point. Preview and export must keep matching (AC7), and existing projects must keep working.

## Decision

- **Templates are versioned code.** A built-in template is a pure function in `src/shared/studio/templates.ts`: canvas size and spacing in, photo slots out. A shipped version never changes; a different layout gets a new version.
  - New projects start from the newest version.
  - Existing projects keep the version they were made with.
  - An unknown template (from a newer Nearmora) is refused with a message, never drawn as something else.
- **Projects are data.** A project stores its template id and version, its format, its own settings and its photos with their crops.
  - Settings are versioned JSON, checked by a Zod schema (`params.ts`) when written and when read.
  - Only settings the person changed are stored; the rest come from the template.
  - Margins and gutters are in reference pixels (a canvas whose shorter side is 1080), so they look the same at every size.
- **One composition for preview and export.** `compose()` turns a project into its elements in canvas pixels. The editor's canvas and the export's sharp pipeline both draw exactly that list. Crops still use `layout.ts` (`sourceRect`, `clampCrop`), unchanged.
- **Schema v5** rebuilds `project` and `project_item`:
  - Replaces kind, aspect and background with `template_id`, `template_version`, `format` and `params_json` (CHECK `json_valid`).
  - Adds `fit` to each item (`'fill'` until S2).
  - Formats are validated by the app, not a CHECK list, so adding a format needs no table rebuild.
  - Old projects map onto the first template versions, which reproduce Studio Lite's layouts exactly (48 px margin, 24 px gutter).
  - The catalog is backed up before migrating, as for every migration.
- **No new dependencies.** Nothing in S1 needed a canvas or editor library.

## Alternatives considered

- **Templates as JSON files**, interpreted at runtime. More flexible, but layout rules such as "three stacked beside one" are clearer and type-checked as code. User-saved templates (S6) will be data, because they are copies of resolved elements, not rules.
- **Keep the CHECK lists and add a migration per format.** Safe, but every new size would need a table rebuild. App-level validation keeps the same protection (nothing invalid is written) without that cost.
- **Draw the export in a hidden Chromium window now,** so text and decorations match the preview exactly. That isn't needed until S4. It will be decided then with a spike, keeping sharp for decoding, resampling and JPEG encoding (full-resolution colour).

## Consequences

- **The editor's shape choice is a format choice,** and new formats show up in the editor automatically.
- **Template names replace the old kind names** in the editor, on project cards and as default titles. Existing projects keep their titles.
- **Settings JSON is refused rather than repaired** if it's damaged or newer; the project then can't be opened until a newer version reads it. This favours never drawing the wrong thing.
- **Tests:**
  - Every template's slots at every format: count, inside the canvas, no overlap.
  - Studio Lite's exact geometry.
  - Settings validation.
  - The v4 → v5 migration with old rows written in raw SQL, including a control run without the item copy.
  - Export tests through `compose()`.
  - Visual inspection of real exports from the private fixtures (not committed).
