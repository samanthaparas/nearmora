# Nearmora

*Keep the feeling close.*

Nearmora is a local-first macOS desktop app for finding your favorite photos, choosing between similar shots, and turning a few of them into a collage or carousel. Your originals stay where they are. It never moves, edits, deletes or uploads them.

> Nearmora is a working name and has not been legally cleared.

## Status

R1a (secure app shell), R1b (CI and packaging), R2 (the catalog database), R3a (indexing slice) and R3b (scan control, offline folders, moments, search and a virtualized grid) are done. You can add a photo folder: Nearmora scans it read-only, makes thumbnails in a separate worker process and shows them in a grid, explaining any files it skipped. Scans can be paused and resumed (also after quitting), unplugged drives show their photos as offline and reconnect only after a fingerprint check, and the Sources screen removes a folder from the catalog after showing what that changes. Photos are grouped into date moments you can rename and give a cover, you can search by file, folder or moment and filter by date, folder and favorites, and the grid keeps only the visible rows in the page (tested with 1,200 photos). See the [roadmap](docs/planning/Nearmora-Technical-Roadmap.md) for what comes next.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs the exact package versions recorded in `package-lock.json` |
| `npm run dev` | Opens the app with live reload while you edit |
| `npm run build` | Builds the app into `out/` |
| `npm run typecheck` | Checks every TypeScript file without running anything |
| `npm test` | Runs the unit tests and the integration tests (real SQLite files and generated photos in a temporary folder; the private fixture pack too, if it's present) |
| `npm run test:e2e` | Builds the app, then launches it with a throwaway profile and runs the security and Library tests inside it |
| `npm run lint` | Checks code for likely mistakes (ESLint, including type-aware rules) |
| `npm run package:mac` | Builds an unsigned `Nearmora.app` into `release/` |
| `npm run test:packaged` | Checks the packaged app: native libraries, catalog migrations, security fuses, launch, and shipped files |
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
    library/         Adding, scanning, reconnecting and removing folders, date moments, and the thumbnail cache
    catalog/         The SQLite catalog: opening, migrations, backup/restore
      migrations/      Numbered schema changes (.sql), applied in order
      repositories/    Reading and writing sources, pictures, albums, sets and review choices
    ipc/             The checkpoint for every request the UI makes
    security/        CSP, app:// and nm-media:// serving, navigation and permission guards
  preload/         Builds window.nearmora, the UI's only bridge to the main process
  renderer/        The UI (React). Sandboxed: no Node.js, no file access
    src/styles/      Design tokens (colors, fonts, spacing) and base styles
    src/library/     The Library and Sources screens: folders and scans, moments, search and filters, virtualized grid
  shared/          Types and schemas used by more than one process
tests/unit/        Fast tests of individual functions (Vitest)
tests/integration/ Catalog and scanning tests against real files and SQLite (Vitest)
tests/support/     Shared test helpers: generated test photos and the originals-unchanged checks
scripts/           Helper scripts: the packaged-app smoke test and query-plan measurements
.github/workflows/ CI: the checks GitHub runs on every pull request
e2e/               Tests that launch the real app (Playwright)
fixtures/private/  The owner's approved test photos. Git-ignored, never committed
docs/
  planning/        Blueprint, roadmap, requirements and concept images
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

The concept images in `docs/planning/` are design references only. The photos in them are synthetic. The rights to the "Moments" concept board are unverified, so none of its assets may be shipped.

## Stack

In use: Electron · React · TypeScript · Vite · Zod · ESLint · Vitest · Playwright · electron-builder · GitHub Actions

In use: SQLite (better-sqlite3) · sharp · exifr (reads the date a photo was taken)

Planned: React Testing Library
