# Nearmora

*Keep the feeling close.*

Nearmora is a local-first macOS desktop app for finding your favorite photos, choosing between similar shots, and turning a few of them into a collage or carousel. Your originals stay where they are. It never moves, edits or uploads them, and removes one only when you ask it to in Clean up.

> Nearmora is a working name and has not been legally cleared.

## What it does

- **Library.** Add photo folders and drives. Nearmora scans them, makes thumbnails in a separate worker process, and groups photos into date moments you can rename and give a cover. Search by file, folder or moment, filter by date, folder and favorites, and scroll any size of library smoothly (only the visible rows are in the page). Albums are your own ordered collections, rearrangeable from the keyboard, with undo.
- **Offline drives.** Unplugged drives keep showing their photos from saved previews, and reconnect only after a check that the files are the same ones.
- **Best Moments.** Finds photos that look alike and were taken moments apart, so you can compare them side by side (with zoom), pick zero, one or several favorites, decide later, and fix sets that grouped the wrong photos. Leaving with unsaved picks always asks first.
- **Memory Studio.** Turns favorites into a collage (2 or 4 photos: 18 everyday layouts and 20 playful ones, with tilted postcards, film strips, arches, captions and more), a carousel (2–10 photos), or a seamless carousel (one wide design cut into matching slides). Five sharing sizes and five print sizes, with a warning when a photo is too small to print sharply.
- **Editing.** Quick edits for background, margins, gutters, borders, crop, zoom and photo order. Customize moves, resizes, tilts, rounds, flips, locks and hides photos, adds or removes places, and saves the result as your own template. Every change saves as you go, with undo and redo.
- **Export.** Full-resolution JPEGs into a fresh folder you choose, with no location or camera data. Checked first, never overwriting, and never leaving a half-finished set behind.
- **Clean up.** Mark photos "Don't need", choose which identical copy stays, and remove them: to the Trash by default, or forever after its own confirmation. Every file is re-checked first, and a local record lists what was removed.
- **Backup and restore.** Settings backs up the catalog (your folders, choices, albums, projects and templates, not the photos) and restores a backup on restart, with undo.

## Privacy and safety

- **Local-first.** Everything stays on your Mac. The app makes no network requests, and an automated test checks that no app process opens a network socket.
- **Originals stay put.** Browsing, favoriting, organizing and making projects never move, edit or upload a photo. The only way a photo leaves its folder is Clean up, when you choose it and confirm ([ADR-0019](docs/decisions/ADR-0019-removing-photos.md)).
- **A locked-down app.** The interface runs sandboxed with a strict content security policy, and every request it makes to the rest of the app is validated first ([ADR-0002](docs/decisions/ADR-0002-renderer-security.md)).

## Status

Every MVP milestone is done: the secure app shell, CI and packaging, the catalog, indexing, scan control and offline drives, moments, search, albums, Best Moments, Memory Studio and export, beta hardening, and Clean up.

In progress:

- A visual refresh of the interface: a deep plum sidebar with icons, a photo-led Library, and a photos-first way to start a project, with layout previews drawn from your own photos.

Not done yet:

- Signing and notarization, which need an Apple Developer account. Until then, builds are unsigned and only for testing.
- A manual VoiceOver walk-through of Memory Studio. Automated accessibility checks (WCAG 2.1 AA, at normal size and 200% zoom) run on every screen.

See the [roadmap](docs/planning/Nearmora-Technical-Roadmap.md) for what comes next.

## Getting started

You need macOS on Apple silicon and Node.js 24 or later.

```bash
npm install
npm run dev
```

The app opens with live reload. The first time, add a folder of photos from the Library screen.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs the exact package versions recorded in `package-lock.json` |
| `npm run dev` | Opens the app with live reload while you edit |
| `npm run build` | Builds the app into `out/`, then the licence notices of everything it ships (fails if one lacks a licence text) |
| `npm run typecheck` | Checks every TypeScript file without running anything |
| `npm test` | Runs the unit, integration and component tests (real SQLite files and generated photos in a temporary folder; the private fixture pack too, if it's present) |
| `npm run test:e2e` | Builds the app, then launches it with a throwaway profile and runs every end-to-end test inside it: security, Library, Best Moments, Studio, export, Clean up, backup, accessibility and network-off checks |
| `npm run lint` | Checks code for likely mistakes (ESLint, including type-aware rules) |
| `npm run package:mac` | Builds an unsigned `Nearmora.app` into `release/` |
| `npm run test:packaged` | Checks the packaged app: native libraries, catalog migrations, the media worker, security fuses, launch, shipped files, and the self-test with networking denied |
| `npm run measure:studio` | Measures Memory Studio at its limits: dragging on a 10-photo collage, opening a 3-slide seamless design, and exporting at 16 × 24 in and as slides, with twelve-megapixel photos (generated, then deleted) |
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
    catalog/         The SQLite catalog: opening, migrations, backup and restore (restores applied at startup, before it opens)
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
    src/settings/    Settings: storage sizes, cache clearing, backing up and restoring the catalog, privacy statement, licences of everything the app ships
  shared/          Types and schemas used by more than one process, and the Studio crop, fit and border math (preview and export)
    studio/          Studio templates (everyday, playful pairs and playful quartets), shapes and line art, caption text as outlines, seamless carousel layouts and how they're cut into slides, Customize changes and snapping, sizes, print resolution, settings, the project design and the composition and drawing order both preview and export use
tests/unit/        Fast tests of individual functions (Vitest)
tests/integration/ Catalog and scanning tests against real files and SQLite (Vitest)
tests/support/     Shared test helpers: generated test photos, the originals-unchanged checks, grouping scores
tests/component/   UI component tests in a simulated browser (React Testing Library)
scripts/           Helper scripts: the licence notices built after each build, the packaged-app smoke test and query-plan measurements
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
| `electron-builder.yml` | How the app is packaged into a .app, which security fuses are switched off, and Chromium's licence file copied inside it (comments inside) |
| `src/main/catalog/migrations/*.sql` | Schema changes, applied in order. Each starts with a comment explaining it |
| `docs/evidence/**/*.png` | Screenshots kept as proof of what a milestone looked like when it was checked |

## Docs

| Document | What it is |
|---|---|
| [MVP Blueprint](docs/planning/Nearmora-MVP-Blueprint.md) | Product scope, behaviour and acceptance criteria (AC1–AC13) |
| [Technical Roadmap](docs/planning/Nearmora-Technical-Roadmap.md) | Stack, schema, IPC contract, milestones and open decisions |
| [Technical Requirements](docs/planning/Nearmora-Technical-Requirements-Source.md) | Original stack and learning requirements, kept word for word |
| [Mockup Prompts](docs/planning/Nearmora-Mockup-Prompts.md) | How the concept images were generated, and their limits |
| [Decision records](docs/decisions/) | Why each key technical choice was made (ADR-0001 to ADR-0024) |
| [Evidence](docs/evidence/) | Test results, measurements and screenshots for each milestone |

The concept images in `docs/planning/` are design references only, and the photos in them are synthetic. The "Moments" concept board is the owner's own work, kept as a picture of the wider product vision; the app ships none of its assets.

## Stack

- **App:** Electron · React · TypeScript · Vite (electron-vite) · Zod
- **Data and photos:** SQLite (better-sqlite3) · sharp · exifr (reads the date a photo was taken)
- **Quality:** ESLint · Vitest · React Testing Library · Playwright · axe-core
- **Build and CI:** electron-builder · GitHub Actions (macOS)

## Licence

Nearmora is not open source. The code is published for reference and as a portfolio piece; all rights are reserved. The third-party packages it ships keep their own licences, listed in the app's Settings screen.

