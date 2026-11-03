# Nearmora

*Keep the feeling close.*

Nearmora is a local-first macOS desktop app for finding your favorite photos, choosing between similar shots, and turning a few of them into a collage or carousel. Your originals stay where they are. It never moves, edits or uploads them, and removes one only when you ask it to in Clean up.

> Nearmora is a working name and has not been legally cleared.

## Status

R1a (secure app shell), R1b (CI and packaging), R2 (the catalog database), R3a (indexing slice) R3b (scan control, offline folders, moments, search and a virtualized grid) and R3c (albums) are done, R4 (Best Moments) and R5 (Memory Studio and export) are done: every feature milestone of the MVP. R6 part 1 (beta hardening) is in: a quit prompt for unsaved picks, a Settings screen with cache controls, automated network-off and accessibility checks, and measured performance. Signing and notarization (R6 part 2) need an Apple Developer account. You can add a photo folder: Nearmora scans it read-only, makes thumbnails in a separate worker process and shows them in a grid, explaining any files it skipped. Scans can be paused and resumed (also after quitting), unplugged drives show their photos as offline and reconnect only after a fingerprint check, and the Sources screen removes a folder from the catalog after showing what that changes. Photos are grouped into date moments you can rename and give a cover, you can search by file, folder or moment and filter by date, folder and favorites, and the grid keeps only the visible rows in the page (tested with 1,200 photos). Albums are your own ordered collections: select photos to add them, rearrange with buttons that work from the keyboard, and undo any album change. Best Moments groups photos that look alike and were taken moments apart, so you can compare two side by side (with zoom), pick zero, one or several favorites, save with undo or decide later, and fix sets that grouped the wrong photos. Leaving with unsaved picks always asks first. Favorites gathers your picks, and Memory Studio turns 2 or 4 of them into a collage (18 everyday layouts, plus 20 playful pairs and quartets with tilted postcards, film strips, arches, circles, tape, labels and captions), or 2–10 into a carousel, or 3 or 5 into a seamless carousel (one wide design cut into exactly matching slides, with photos running across the cuts), with a swipe preview and a mat for standard carousels, at five sharing sizes or five print sizes (with a warning for photos too small to print sharply). Quick edits change the background colour, margin, gutter and photo borders, and per photo the order, swap, replace, fit or fill, crop and zoom, by mouse or keyboard; Customize moves, resizes, tilts, rounds, flips, locks and hides photos (dragged with snapping, nudged with the arrow keys, or typed exactly), changes which is in front, can leave a place empty, add or remove places, and save the result as one of your own templates; every change is saved, can be undone and redone, and "Reset to layout defaults" brings back the layout's own look. Export writes JPEGs at the chosen size (full-resolution colour, no location or camera data) into a fresh folder you choose: checked first, never overwriting, and never leaving a half-finished set behind. Clean up (milestone C1) helps clear clutter: mark photos "Don't need" in the Library, choose which identical copy stays, and remove them, to the Trash by default or forever after a macOS confirmation. Every file is re-checked first (in a folder you added, an ordinary file, unchanged since the scan), a photo used in a Studio project keeps its last copy, and a local record lists what was removed. See the [roadmap](docs/planning/Nearmora-Technical-Roadmap.md) for what comes next.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs the exact package versions recorded in `package-lock.json` |
| `npm run dev` | Opens the app with live reload while you edit |
| `npm run build` | Builds the app into `out/` |
| `npm run typecheck` | Checks every TypeScript file without running anything |
| `npm test` | Runs the unit, integration and component tests (real SQLite files and generated photos in a temporary folder; the private fixture pack too, if it's present) |
| `npm run test:e2e` | Builds the app, then launches it with a throwaway profile and runs the security and Library tests inside it |
| `npm run lint` | Checks code for likely mistakes (ESLint, including type-aware rules) |
| `npm run package:mac` | Builds an unsigned `Nearmora.app` into `release/` |
| `npm run test:packaged` | Checks the packaged app: native libraries, catalog migrations, the media worker, security fuses, launch, shipped files, and the self-test with networking denied |
| `npm run measure:perf` | Measures the blueprint's performance budgets on 10,000 generated photos (writes several GB of temporary files, then deletes them) |
| `npm run measure:scan` | Times scans through the real app and worker: the private fixture pack (if present) and 1,000 generated photos |
| `npm run query-plans` | Measures the key catalog queries on 10,000 synthetic pictures, with and without their indexes, and compares moment grouping in SQL and JavaScript |

## Project map

```text
src/
  main/            Main process: the only code with access to the computer
    index.ts         Starts the app: security guards, then the catalog, then the window
    self-test.ts     --self-test mode: proves SQLite, sharp, the catalog and the media worker work in a packaged build
    media-worker.ts  Entry point of the separate process that decodes photos
    media/           Reading photos safely: file walking, type detection, thumbnails and dHash
    library/         Adding, scanning, reconnecting and removing folders, date moments, similar-photo sets, thumbnail cache, storage, and removing the photos chosen in Clean up (the only code that removes a photo file)
    studio/          Export: checks, staged rendering, verification, finalizing and crash recovery
    catalog/         The SQLite catalog: opening, migrations, backup/restore
      migrations/      Numbered schema changes (.sql), applied in order (v4 landscape projects, v5 Studio templates, v6 Clean up marks and removal record, v7 empty places in projects, v8 My templates)
      repositories/    Reading and writing sources, pictures, favorites, albums, sets, review choices, Clean up marks and My templates
    ipc/             The checkpoint for every request the UI makes
    security/        CSP, app:// and nm-media:// serving, navigation and permission guards
  preload/         Builds window.nearmora, the UI's only bridge to the main process
  renderer/        The UI (React). Sandboxed: no Node.js, no file access
    src/styles/      Design tokens (colors, fonts, spacing) and base styles
    src/wheel-zoom.ts Pinch and mouse-wheel zoom, shared by Memory Studio and Best Moments
    src/library/     The Library and Sources screens: folders and scans, moments, albums, search and filters, virtualized grid
    src/best-moments/ The Best Moments screen: queue, compare view, choosing favorites, corrections, unsaved-changes dialog
    src/studio/      Favorites and Memory Studio: template picker with filters, projects, the canvas preview, Quick edits and captions with undo and redo, Customize (arrange, snapping, hidden photos), the swipe preview, export panel
    src/clean-up/    Clean up: photos marked "Don't need", identical copies with the copy that stays, review and removal, the removal record
    src/settings/    Settings: storage sizes, cache clearing, privacy statement
  shared/          Types and schemas used by more than one process, and the Studio crop, fit and border math (preview and export)
    studio/          Studio templates (everyday, playful pairs and playful quartets), shapes and line art, caption text as outlines, seamless carousel layouts and how they're cut into slides, Customize changes and snapping, sizes, print resolution, settings, the project design and the composition and drawing order both preview and export use
tests/unit/        Fast tests of individual functions (Vitest)
tests/integration/ Catalog and scanning tests against real files and SQLite (Vitest)
tests/support/     Shared test helpers: generated test photos, the originals-unchanged checks, grouping scores
tests/component/   UI component tests in a simulated browser (React Testing Library)
scripts/           Helper scripts: the packaged-app smoke test and query-plan measurements
.github/workflows/ CI: the checks GitHub runs on every pull request
e2e/               Tests that launch the real app (Playwright)
fixtures/private/  The owner's approved test photos. Git-ignored, never committed
docs/
  planning/        Blueprint, roadmap, requirements, concept images and the carousel-app audit
  decisions/       Short records of why key technical choices were made (ADRs)
  evidence/        Test results and screenshots for each milestone
  journal/         Learning notes, written in my own words
```

Every source file starts with a short comment explaining its purpose. These files can't hold comments, so they're described here:

| File | Purpose |
|---|---|
| `package.json` | The project's name, its scripts (the commands above) and its dependencies, each pinned to an exact version. `dependencies` holds only what ships inside the app; `allowScripts` lists which packages may run install scripts (npm 11 blocks them by default) |
| `package-lock.json` | Generated by npm. It records the exact version of every package, including dependencies of dependencies, so every install is identical. Never edit it by hand |
| `electron-builder.yml` | How the app is packaged into a .app, and which security fuses are switched off (comments inside) |
| `src/main/catalog/migrations/*.sql` | Schema changes, applied in order. Each starts with a comment explaining it |
| `docs/evidence/**/*.png` | Screenshots kept as proof of what a milestone looked like when it was checked |

## Docs

| Document | What it is |
|---|---|
| [MVP Blueprint](docs/planning/Nearmora-MVP-Blueprint.md) | Product scope, behaviour and acceptance criteria (AC1–AC13) |
| [Technical Roadmap](docs/planning/Nearmora-Technical-Roadmap.md) | Stack, schema, IPC contract, milestones and open decisions |
| [Technical Requirements](docs/planning/Nearmora-Technical-Requirements-Source.md) | Original stack and learning requirements, kept word for word |
| [Mockup Prompts](docs/planning/Nearmora-Mockup-Prompts.md) | How the concept images were generated, and their limits |

The concept images in `docs/planning/` are design references only, and the photos in them are synthetic. The "Moments" concept board is the owner's own work, kept as a picture of the wider product vision; the app ships none of its assets.

## Stack

In use: Electron · React · TypeScript · Vite · Zod · ESLint · Vitest · React Testing Library · Playwright · electron-builder · GitHub Actions

In use: SQLite (better-sqlite3) · sharp · exifr (reads the date a photo was taken)

