# Nearmora — Technical Learning & Implementation Roadmap

Version R0 · October 28, 2026 · **Status: proposed, awaiting owner approval. No code has been written.**

Inputs reviewed: the implementation handoff prompt, `Nearmora-MVP-Blueprint.md` (rev. Oct 28, 2026), `Nearmora-Technical-Requirements-Source.md`, `Nearmora-Mockup-Prompts.md`, and all three images (Library Home, Best Moments Review, “Moments” Memory Studio concept board), which were attached to the conversation and inspected.

This document reviews and refines Blueprint §13. Where it agrees with the blueprint it says so briefly; where it changes something it says why.

---

## 1. Project inventory

**No Nearmora code exists.** Read-only checks performed on October 28, 2026:

| Checked | Found |
|---|---|
| `~/Projects` | CanYouSpotIt, Cypher-app, QuestKeeper, SamanthaParas, samanthaparas-portfolio, and five review/eval/SDK folders. None is Nearmora. |
| `~/Projects`, `~/Documents` (depth 3) for `*nearmora*` | Only the planning outputs folder below. |
| Planning outputs folder | Blueprint, prompt, tech requirements, mockup prompts, three PNGs, a zip and an unzipped copy of the same files. No code, no `package.json`, no git repo. |
| Dev machine | macOS 27.0.1, Apple Silicon (arm64), 16 GB RAM, Node 24.21.0, npm 11.19.0. This matches the blueprint's proposed performance-baseline machine. |

Gaps: no repository, no CI, no fixtures, no Apple Developer account confirmed, no licensed fixture photos, no legal name clearance (already acknowledged in the blueprint). Nothing in your photo collection was opened.

---

## 2. Recommended stack and versions

Versions were read from the npm registry and the Electron releases feed on October 28, 2026. “Pin” means exact version in `package.json` plus a committed lockfile; we bump deliberately, not by accident.

| Layer | Choice | Current version seen | Pin proposal | Responsibility |
|---|---|---|---|---|
| Runtime shell | **Electron** | 45.1.0 (released Oct 27, 2026; bundles Node 24.22.1, Chromium 156) | **45.x latest patch at R1 start**; fall back to 44.10.0 if the R1 spike finds a native-module problem | Windows, OS dialogs, main process, IPC, custom protocol, packaging target |
| Build/dev | **electron-vite** | 6.0.0 (peer: Vite 6–8) | 6.0.x | One config building main, preload and renderer with Vite; HMR in dev |
| Bundler | **Vite** | 8.3.5 | 8.x | Renderer bundling (you already know it) |
| UI | **React** | 19.3.1 | 19.x | Renderer views |
| Language | **TypeScript** | 7.0.2 latest; **6.0.3** latest 6.x | **6.0.3** | See note below |
| Lint | ESLint + typescript-eslint | 10.13.0 / 8.72.1 | same | Lint, including type-aware rules |
| Runtime validation | **Zod** | 4.6.7 | 4.x | Validate every IPC payload, DB-row edge cases, saved-project JSON |
| Database driver | **better-sqlite3** | 13.0.3 (Node ≥ 22) | 13.x | Synchronous SQLite in main; has an online `.backup()` API for consistent snapshots |
| Image processing | **sharp** (libvips) | 0.35.5 | 0.35.x | Decode, auto-orient, thumbnails, perceptual-hash input, export rendering, metadata stripping |
| Virtualized grid | **@tanstack/react-virtual** | 3.14.23 | 3.x | Render only visible gallery rows |
| Unit/integration tests | **Vitest** | 5.0.5 | 5.x | Domain logic, real SQLite, real temp-dir filesystem |
| Component tests | **React Testing Library** | 16.3.3 | 16.x | Keyboard/focus/selection behaviour through accessible roles |
| E2E | **Playwright** (`_electron` API) | 1.64.1 | 1.64.x | Launch the built Electron app and drive the core loop |
| Packaging | **electron-builder** | 26.18.0 | 26.x | `.dmg`/`.zip`, native-module rebuild, signing and notarization hooks |

**TypeScript note (a real conflict, verified):** typescript-eslint 8.72.1 declares `typescript: >=4.8.4 <6.1.0`. TypeScript 7 (the Go-native compiler) is outside that range, so type-aware linting would be unsupported. Recommendation: pin **TypeScript 6.0.3** now and revisit TS 7 when typescript-eslint supports it. You lose nothing for learning purposes — the type system you'll learn is the same.

**Electron note:** 45.1.0 is one day old. Electron supports the latest three majors, so starting on 45 maximizes support runway, but we only commit to it after the R1 spike proves better-sqlite3 and sharp load in a *packaged* build.

**Deliberately not chosen for the MVP**

| Option | Why not now | When it might return |
|---|---|---|
| Drizzle ORM | SQL is a top learning goal; an ORM in the first schema hides the joins, indexes and transactions you want to learn. One data layer only. | Re-evaluate after R2, when you've written ~15 real queries and can judge whether types-from-schema saves real bugs. Section 6 shows what a Drizzle version would look like. |
| `node:sqlite` (built into Node 24) | Avoids a native module, but its Electron support and backup API are less proven than better-sqlite3. | R1 spike fallback if better-sqlite3 packaging fails. |
| Electron Forge | Official and good; electron-builder has more mature notarization and native-rebuild docs for a solo macOS beta. | If electron-builder gives packaging trouble. |
| Tailwind | You already have BEM/CSS skill; the design is token-driven and photo-led. Tailwind adds a tool without solving a current problem. | Next.js website (R7) is a better place to learn it. |
| Zustand | Most state is local or lives in SQLite. | When two or more distant components share a mutable session (likely Studio project editing in R5). |
| Component library (Radix, React Aria, MUI) | Risk of SaaS look; native `<dialog>`, `<button>`, radio groups cover R1–R4. | React Aria hooks if a listbox/menu proves hard to make accessible by hand. |
| A pHash library | Difference-hash (dHash) is ~30 lines on top of sharp, testable and a good learning exercise. | If measured precision is poor. |

---

## 3. MVP technologies vs later learning goals

| Technology | MVP? | Reason |
|---|---|---|
| TypeScript, React, Vite, Electron | Yes | The product. |
| SQLite + hand-written SQL migrations | Yes | Catalog of record; core SQL learning. |
| Zod | Yes | Types disappear at runtime; IPC is a trust boundary. |
| sharp | Yes | Only realistic way to decode, orient, hash and export in Node with bounded memory. |
| Vitest / RTL / Playwright | Yes | Required to prove AC1–AC13. |
| GitHub Actions CI | Yes | You already know protected merges; we add macOS runners and packaged smoke tests. |
| Next.js | **After** the desktop core loop works (R7) | Public website has no data to show until the app does. |
| Docker | **After**, with the website (R8) | Desktop users never need it. A Next.js standalone build is a genuine multi-stage-build use case. |
| PostgreSQL | **Optional, later** | No hosted feature needs it. Candidate later exercises: a beta-waitlist/feedback API for the website (no photo data), or a separate exercise porting the Nearmora schema to Postgres to compare SQL dialects. |
| AWS | **No** | Nothing in the local product needs it. Don't invent a use. |
| Auth (JWT/bcrypt) | **No** | No accounts in V0.1. |

---

## 4. Learning objectives tied to Nearmora work

### TypeScript (vs JavaScript)

| Concept | Where you'll meet it in Nearmora |
|---|---|
| `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | Project setup in R1 — you'll see what JS silently allowed. |
| Interfaces vs type aliases | `interface Asset` for DB-shaped records; `type` for unions and computed types. |
| Discriminated unions + narrowing | `ReviewStatus = 'unreviewed' \| 'deferred' \| 'reviewed'`; scan job events `{ kind: 'progress' } \| { kind: 'skipped', reason } \| { kind: 'done' }`; `switch` with an exhaustive `never` check. |
| Branded IDs | `type AssetId = string & { __brand: 'AssetId' }` so you can't pass a `ProjectId` where an `AssetId` belongs. |
| Generics | A typed IPC helper `invoke<C extends Command>(cmd, input: Input<C>): Promise<Output<C>>`; a generic `Result<T, E>`. |
| `unknown` and error handling | Every `catch (e)` is `unknown`; narrow to known error codes; never leak paths in messages. |
| Zod inference | `z.infer<typeof schema>` — one source of truth for runtime check and static type. |
| Typed React | Props, `useReducer` with action unions for the review draft, typed custom hooks (`useScanProgress`). |
| Typed async | `AbortSignal` cancellation for scans and exports. |

### SQL

| Concept | Where |
|---|---|
| Schema design, normalization | `asset` vs `asset_location` split (one picture, many paths). |
| Primary/foreign keys, `ON DELETE` behaviour | Removing an album must not cascade to assets; removing a source cascades to its locations only. |
| Joins | Gallery query: asset ⨝ location ⨝ source ⨝ favorite with filters. |
| Indexes + `EXPLAIN QUERY PLAN` | Date-range and favorite-filter queries over 10k fixture rows; record before/after. |
| Transactions | “Save choices” writes favorites, review status and undo entry atomically. |
| Migrations | Numbered `.sql` files, `PRAGMA user_version`, backup-before-migrate, a deliberately failing migration test. |
| Integrity | `CHECK` constraints, `PRAGMA foreign_keys=ON`, `PRAGMA integrity_check` after restore. |
| Window functions / CTEs (stretch) | Grouping photos into date-gap moments in SQL vs in TypeScript — compare both. |

### Testing

| Level | Definition | Nearmora examples |
|---|---|---|
| Unit | One function, no I/O | dHash Hamming distance; moment gap-splitting; crop math; date-fallback rules; review-draft reducer. |
| Component | One React component, DOM simulated | Favorite toggle has text label and `aria-pressed`; unsaved-changes dialog traps and returns focus. |
| Integration | Real collaborating boundaries | Index a temp copy of fixtures into a real SQLite file; save/undo choices; migrate + restore; export to a temp destination and inspect output bytes. |
| E2E | The built app, driven like a user | Add fixture folder → review a set → favorite two → create collage → export → assert files. |

Rule we'll follow: mocks are allowed only at OS seams (e.g., the folder picker dialog). A mocked filesystem never counts as AC evidence.

---

## 5. Implementation order (refined)

Main changes from Blueprint §13:

1. **Packaging spike moves to R1.** Native modules (better-sqlite3, sharp) in a signed, packaged Electron app are the highest technical risk. Discovering that in R6 would be expensive.
2. **R3 becomes a vertical slice before it becomes a feature.** First pass: add folder → index 20 fixtures → show thumbnails in a grid. Then broaden.
3. **Albums move to late R3/early R4** — they're small and depend on a working gallery, but nothing else depends on them.
4. **Backup/restore is built in R2 and re-verified in R5** once projects exist (AC11 can only fully pass then).
5. **Stage 0 user validation runs in parallel** with R1–R2 using the existing mockups; it does not block code but its results can change R4/R5 copy.

| Slice | Depends on | Contents | Est. focused weeks (solo, learning) |
|---|---|---|---|
| **R1a** Shell & security | approval | electron-vite scaffold, strict TS, secure `BrowserWindow`, CSP, one validated IPC command (`app:getVersion`), navigation/permission denial, design tokens + fonts bundled | 1 |
| **R1b** CI & packaging spike | R1a | GitHub Actions (lint, typecheck, test, build) on macOS; package unsigned `.app` that opens a SQLite DB and resizes one image with sharp; Playwright launches packaged app | 1 |
| **R2** Catalog | R1 | Schema v1, migration runner, repositories, backup/restore, undo table, query-plan notes | 1.5–2 |
| **R3a** Index slice | R2 | Add source (dialog), enumerate, signature check, hash, thumbnail in utility process, media protocol, basic grid | 1.5 |
| **R3b** Library | R3a | Progressive scan UI, counts, pause/cancel/resume, date moments, rename/cover, search/filters, virtualization, disconnected/empty/error states | 2 |
| **R3c** Albums | R3b | Album CRUD, ordered membership, keyboard reorder | 0.5 |
| **R4** Best Moments | R3b | Exact groups, dHash + time-window candidates, manual correction, compare view, multi-favorite, decide later, save/undo, unsaved-changes guard, narrow-width A/B tabs, zoom/pan | 2.5–3 |
| **R5** Studio Lite + export | R4 | Projects, two templates, carousel, keyboard crop/reorder, shared layout math, export pipeline, metadata stripping, staged finalize, recovery | 3 |
| **R6** Beta hardening | R1–R5 | Profiling against budgets, VoiceOver pass, network-off test, signing/notarization, release checklist | 1.5–2 |
| **R7** Website | validated core | Next.js marketing site | 1.5 |
| **R8** Docker | R7 | Containerize the site; optional Postgres exercise | 1 |

Total R1–R6: roughly 18–21 focused weeks solo. This is longer than the blueprint's 6–10 weeks for an experienced team, which is expected; it is an estimate, not a commitment.

---

## 6. Architecture details

### 6.1 Process layout

```text
Renderer (React, sandboxed, contextIsolation, no Node)
   │  window.nearmora.<command>(input)   ← only API exposed by preload
   ▼
Preload (contextBridge: fixed list of named functions, no raw ipcRenderer)
   │  ipcRenderer.invoke('nm:<command>', input)
   ▼
Main process
   ├─ IPC router: verify sender frame URL → Zod-parse input → handler → Zod-shaped output
   ├─ Source registry: the only code that turns IDs into filesystem paths
   ├─ Catalog (better-sqlite3, single connection, WAL, foreign_keys ON)
   ├─ Job coordinator: queue, checkpoints, cancellation
   ├─ protocol.handle('nm-media')  ← thumbnails/previews by opaque ID
   └─ utilityProcess "media-worker" (sharp) — bounded jobs, killable on timeout
```

**About the worker:** an Electron `utilityProcess` is a separate OS process we can kill on timeout or memory overrun, and it has no IPC to the renderer. It is *not* an OS sandbox — it can still read files. Mitigations: give it only absolute paths main has already authorized, pass `limitInputPixels` to sharp, enforce byte/dimension caps before decode, and treat a crash as a per-file error. We'll document this as a known limit before any untrusted-file beta (blueprint already requires this).

### 6.2 Data model (schema v1, SQLite)

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE source (
  id            TEXT PRIMARY KEY,           -- random UUID
  root_path     TEXT NOT NULL,
  volume_uuid   TEXT,                       -- from OS; null for boot volume edge cases
  display_name  TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('active','disconnected','permission_denied','removed')),
  added_at      INTEGER NOT NULL,
  last_scan_at  INTEGER
);

-- One row per distinct picture (by bytes).
CREATE TABLE asset (
  id              TEXT PRIMARY KEY,
  content_sha256  BLOB NOT NULL UNIQUE,
  media_type      TEXT NOT NULL CHECK (media_type IN ('image/jpeg','image/png')),
  width           INTEGER, height INTEGER, orientation INTEGER,
  captured_at     INTEGER,                    -- epoch ms
  captured_at_source TEXT NOT NULL CHECK (captured_at_source IN ('exif','file_mtime','unknown')),
  dhash           BLOB,                        -- 64-bit
  decode_state    TEXT NOT NULL CHECK (decode_state IN ('ok','unsupported','corrupt','too_large'))
);

-- One row per file path; identical bytes in two folders = two rows, one asset.
CREATE TABLE asset_location (
  id            TEXT PRIMARY KEY,
  asset_id      TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  mtime_ms      INTEGER NOT NULL,
  inode         INTEGER, dev INTEGER,          -- identity hints, never proof alone
  availability  TEXT NOT NULL CHECK (availability IN ('available','missing','changed')),
  UNIQUE (source_id, relative_path)
);

CREATE TABLE moment (
  id TEXT PRIMARY KEY, title TEXT, auto_title TEXT NOT NULL,
  cover_asset_id TEXT REFERENCES asset(id) ON DELETE SET NULL,
  starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, user_edited INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE moment_asset (
  moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE,
  asset_id  TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  PRIMARY KEY (moment_id, asset_id)
);

CREATE TABLE similarity_set (
  id TEXT PRIMARY KEY,
  reason TEXT NOT NULL CHECK (reason IN ('exact','visual','manual')),
  algorithm_version TEXT NOT NULL,            -- e.g. 'dhash64-t10-w120s@1'
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
     CHECK (review_status IN ('unreviewed','deferred','reviewed')),
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE set_asset (
  set_id   TEXT NOT NULL REFERENCES similarity_set(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  user_override TEXT CHECK (user_override IN ('added','removed')),  -- survives regrouping
  PRIMARY KEY (set_id, asset_id)
);

-- Favorites are per asset and independent of sets.
CREATE TABLE favorite (
  asset_id   TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
  revision   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE album (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE album_asset (
  album_id TEXT NOT NULL REFERENCES album(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (album_id, asset_id)
);

CREATE TABLE project (
  id TEXT PRIMARY KEY, title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('collage_2','collage_4','carousel')),
  aspect TEXT NOT NULL CHECK (aspect IN ('1:1','4:5')),
  background TEXT NOT NULL CHECK (background IN ('cream','white')),
  layout_version INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE project_item (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  asset_id   TEXT NOT NULL REFERENCES asset(id) ON DELETE RESTRICT,
  crop_cx REAL NOT NULL, crop_cy REAL NOT NULL, crop_zoom REAL NOT NULL,  -- normalized 0..1 / ≥1
  PRIMARY KEY (project_id, position)
);

CREATE TABLE job (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('scan','export')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','paused','cancelled','failed','done')),
  checkpoint TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE undo_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,           -- 'review_save' | 'album_edit' | 'moment_edit'
  target_id TEXT NOT NULL,
  before_json TEXT NOT NULL,     -- Zod-validated snapshot
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_asset_captured ON asset(captured_at);
CREATE INDEX idx_location_asset ON asset_location(asset_id);
CREATE INDEX idx_set_asset_asset ON set_asset(asset_id);
```

Notes:
- `asset.id` is stable; regrouping rebuilds `similarity_set` rows but replays `user_override` and carries `review_status` forward by member overlap, so choices survive (AC4, AC13).
- `project_item.asset_id` uses `RESTRICT`: you can't silently lose an asset that a project uses; source removal shows the impact review first.
- The schema is a starting proposal; R2 will refine it with tests and query plans.

**Why plain SQL rather than Drizzle (for now):** compare —

```ts
// plain, parameterized (what you'd write)
db.prepare(`SELECT a.* FROM asset a JOIN favorite f ON f.asset_id = a.id
            WHERE a.captured_at BETWEEN ? AND ? ORDER BY a.captured_at`).all(from, to);

// Drizzle equivalent
db.select().from(asset).innerJoin(favorite, eq(favorite.assetId, asset.id))
  .where(between(asset.capturedAt, from, to)).orderBy(asset.capturedAt);
```

Drizzle gives inferred row types; plain SQL gives you the language you're trying to learn and exactly the query that `EXPLAIN QUERY PLAN` shows. We get most of Drizzle's safety by validating rows with Zod at the repository edge and covering every query with an integration test.

### 6.3 Exact-duplicate favorite policy — recommendation: **asset-level**

A favorite means “I love this picture,” not “I love this path.” Byte-identical files share one `asset`, so favoriting it favorites every location. UI consequence: the photo detail shows “Also in 2 other folders” as plain text, and Favorites shows the picture once. Locations stay separate rows for availability and export source selection (export uses any *available, verified* location). Visually similar but non-identical files are always separate assets and are never merged.

Alternative (location-level) would show the same image multiple times in Favorites and make “which copy did I favorite?” a user problem. Not recommended.

### 6.4 Migrations and backup

- Migrations: `migrations/0001_init.sql`, `0002_*.sql`… applied in a transaction; version in `PRAGMA user_version`.
- Before any migration: `db.backup()` to `catalog-premigrate-<version>-<timestamp>.sqlite` in the app-data folder; keep the last 3.
- On migration failure: transaction rolls back; app shows a recovery screen offering to restore the pre-migration backup. Tested with an intentionally broken migration fixture.
- User backup: `db.backup()` to a user-chosen location → `PRAGMA integrity_check` on the copy → write a small manifest (app version, schema version, counts). Restore into a clean profile in tests. Thumbnails are not included (rebuildable). Copy states plainly that original photos are not in the backup.

### 6.5 IPC contract (complete V0.1 list)

All inputs are IDs or small validated values. No command accepts a path from the renderer except as the result of a main-owned OS dialog.

| Command | Input | Output |
|---|---|---|
| `sources.add` | — (main opens dialog) | `Source \| { cancelled: true }` |
| `sources.list` / `sources.rescan` / `sources.reconnect` | `sourceId?` | status |
| `sources.removeImpact` / `sources.remove` | `sourceId` | impact summary / ok — catalog only |
| `scan.pause` / `scan.resume` / `scan.cancel` | `jobId` | ok |
| `library.query` | filters, cursor, limit ≤ 500 | page of asset summaries |
| `moments.list` / `moments.update` | ids, title, coverAssetId | — |
| `albums.*` | create/rename/delete/setMembers/reorder | — |
| `sets.list` / `sets.get` / `sets.removeMember` / `sets.addMember` / `sets.ungroup` | ids | — |
| `review.save` | `setId`, `favorites: AssetId[]`, `status`, `expectedRevision` | new revision + undo id |
| `review.undo` | `undoId` | restored state |
| `projects.*` | create/update/list/delete (project rows only) | — |
| `export.preview` | `projectId` | per-output dims + availability report |
| `export.start` | `projectId`, format, quality — main opens destination dialog | `jobId` |
| `export.cancel` | `jobId` | ok |
| `catalog.backup` / `catalog.restore` | — (dialogs in main) | manifest |
| `settings.get` / `settings.set` | whitelisted keys | — |

Events main → renderer (one channel, discriminated union): scan progress, job status, source status changes.

Explicitly absent: any delete/trash/move/rename/write-metadata of originals; any generic `readFile`, `openExternal` with arbitrary URLs, or shell command.

### 6.6 Media pipeline boundaries

- Enumerate with `fs.opendir`, `lstat` each entry; skip symlinks; skip hidden/system files; record videos and other types as “skipped: unsupported” with counts.
- Check magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`), size ≤ 200 MB, then decode metadata with sharp; reject > 100 megapixels (tunable, documented).
- Stream SHA-256 in main via `fs.createReadStream`; worker generates a 512-px oriented WebP thumbnail and a 9×8 grayscale for dHash.
- Concurrency: 2 decode jobs initially (blueprint), measured before changing.
- Similarity v1: candidates must be within a capture-time window (start: 120 s; only when `captured_at_source='exif'`) **and** dHash Hamming distance ≤ 10. Exact matches come from SHA-256 and are shown as “Identical copies,” separately. Thresholds recorded in `algorithm_version` and tuned on the labelled corpus.
- Export: full-resolution oriented decode from a verified original location (re-check size/mtime/identity, re-hash), render with the same layout math as preview, `toColourspace('srgb')`, no `withMetadata()` (sharp strips by default), JPEG flattens alpha onto the chosen background. Write into `<destination>/.nearmora-tmp-<id>/`, verify dimensions and count by re-reading outputs, then rename to a fresh `Nearmora <title> <date>` folder (suffix `(2)`… if taken). Never overwrite.

---

## 7. Milestone gates and evidence

Evidence labels used in every handoff: **[auto]** automated test in CI, **[int]** integration against real SQLite/filesystem, **[pkg]** run on packaged app, **[hw]** real hardware/drive, **[human]** manual inspection or assistive-tech check, **[mock]** mocked — never counts toward an AC.

| Slice | Exit gate | Evidence required |
|---|---|---|
| R1a | `nodeIntegration` off, `contextIsolation` on, sandbox on, CSP blocks inline script, navigation and `window.open` blocked, unknown IPC channel rejected, invalid payload rejected | [auto] unit tests on router; [pkg] Playwright asserts `typeof require === 'undefined'` in renderer; CSP violation test |
| R1b | Clean `npm ci` → lint → typecheck → tests → build passes on GitHub macOS runner; packaged unsigned app opens DB and runs sharp | CI run link; [pkg] smoke log; written note on native-module rebuild |
| R2 | AC11 (partial), AC12/13 schema behaviour; FK violations rejected; rollback on mid-transaction error; failing migration restores backup | [int] tests; `EXPLAIN QUERY PLAN` before/after for 3 key queries on 10k synthetic rows |
| R3a–c | AC1, AC2, AC12 | [int] before/after SHA-256 + mtime of every fixture; fs write instrumentation (macOS `fs_usage` capture or a test that opens sources read-only and a watcher that fails on writes); overlapping-folder and cancel/restart tests; [hw] external USB drive run; baseline scan timing recorded with hardware/dataset |
| R4 | AC3, AC4, AC5, AC13 | Labelled corpus precision/recall report; [int] restart/rescan/regroup persistence; [hw] unplug drive mid-review; [auto] RTL keyboard tests; [human] false-positive review |
| R5 | AC6, AC7, AC8, AC11 full | [int] exiftool-style check (or sharp metadata read) on outputs shows no EXIF/GPS/XMP/IPTC; pixel dims; filenames ordered; disk-full simulated on a small disk image; kill-during-export test; [human] visual comparison preview vs export |
| R6 | AC9, AC10, all release gates | [pkg] network-disabled run + traffic capture; [human] VoiceOver journey, 200% zoom, reduced motion; notarized build; performance record vs budgets |

---

## 8. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Native modules (better-sqlite3, sharp) fail in packaged/notarized app | Blocks release | R1b spike on packaged build; `node:sqlite` fallback; pin versions; CI packaging job |
| macOS privacy prompts (TCC) for Desktop/Documents/removable volumes | Confusing permission-denied states | Dedicated permission-denied state with “Open System Settings” guidance; test on a fresh user account |
| Remounted drive at a new path or different drive at the same path | Choices attached to the wrong files | Match on volume UUID + per-file size/mtime/hash; mismatches go to verify flow, never auto-attach |
| Decompression bombs / malformed files crash the worker | Scan stalls | Pre-decode size/pixel caps, sharp `limitInputPixels`, per-job timeout, kill + mark corrupt, continue |
| `utilityProcess` isn't a sandbox | Parser bug could read other files | Documented limit; minimal privileges; keep sharp patched; block “untrusted files” claims until assessed |
| Export partially written on disk full | False success | Temp dir + verify + rename; `job` row only `done` after rename |
| Metadata leaks in exports | Privacy | Explicit test on fixtures containing GPS/XMP/IPTC |
| Local catalog is sensitive | Privacy | App-data dir with `0700`; clear copy that it isn't encrypted; recommend FileVault |
| Signing/notarization needs paid Apple Developer membership | Cannot ship beta outside your machine | Decide before R6 (see §10) |
| Similarity precision below 90% | Users distrust suggestions | Ship exact groups + manual grouping; label visual sets “possibly related” |
| Scope creep from concept board | Never finishing | Blueprint §14 mapping is binding; changes need an explicit decision |
| Learning load (TS + SQL + tests + Electron security at once) | Burnout, shallow learning | One new concept cluster per slice; journal entries; you explain each PR in your own words before merge |
| Fixture licensing | Can't publish screenshots | Use photos you took and consent to, CC0 sources with recorded licenses, or generated synthetic images labelled as such |
| Name not cleared | Rebrand cost | Keep “Nearmora” in one constants file and the bundle ID neutral until clearance |

---

## 9. Portfolio evidence and mentoring/documentation plan

Repository docs (created in R1):

```text
docs/
  decisions/   ADR-0001-electron-vite.md, ADR-0002-plain-sql.md, …   (context, options, decision, consequences)
  journal/     2026-11-xx.md   (what I learned, what confused me, what I did vs. what AI did)
  evidence/    R3-ac1-hashes.md, R4-precision.md, perf-baseline.md   (method, hardware, dataset, numbers)
  bugs/        short write-ups: symptom → cause → fix → test added
```

Each entry records date, problem, options, choice, **personal contribution vs AI-assisted**, verification and limits.

How we'll work per slice: I explain the concept and the plan → we write the smallest piece together, with you typing or reviewing key parts → tests first where the rule is clear (crop math, dHash, review reducer) → you write a 3–5 sentence “explain it back” note in the journal before merge.

Honest portfolio statements become available only when the corresponding gate passes, e.g. after R4: “Designed a SQLite schema separating assets from file locations so user choices survive rescans; covered with integration tests against real databases.” Not before.

---

## 10. Conflicts and decisions needing your approval

Consolidated; each has my recommendation.

| # | Decision | Recommendation |
|---|---|---|
| D1 | TypeScript version | **Pin 6.0.3** (typescript-eslint doesn't support 7 yet). |
| D2 | Data layer | **Plain parameterized SQL + Zod at the repository edge**; re-evaluate Drizzle after R2. |
| D3 | Exact-duplicate favorites | **Asset-level**, with “Also in N other folders” shown. |
| D4 | Build/packaging tools | **electron-vite + electron-builder**, confirmed by the R1b packaging spike. |
| D5 | Where albums live (no nav item for them) | **Inside Library**: an “Albums” section below “Your moments,” plus “Add to album” from selection. No new nav item. |
| D6 | Vocabulary clash: “moments” (date groups) vs “Best Moments” (similar sets) | Keep the nav label **Best Moments**; call its units **“sets”** in UI (“Set 2 of 8”) and date groups **“moments”**. Internally: `moment`, `similarity_set`. |
| D7 | Best Moments mockup shows scenery-only shots in the same set as the couple shots | That's a time-only neighbour pattern the blueprint says must not be presented as visually similar. Implementation will likely split them; I'll treat the mockup as layout reference only. |
| D8 | “On this device” in the sidebar (mockups) isn't in the nav spec | Render as a **non-navigating source-status indicator** (e.g., “On this device · 1 drive offline”) that links to Sources. |
| D9 | Undo scope | **Scoped undo** for review saves, album edits, moment renames — not a global undo stack. |
| D10 | Distribution | **Outside the Mac App Store** (Developer ID + notarization). Requires an Apple Developer Program membership ($99/yr) **before R6** — your decision and account, not mine. |
| D11 | Repository | Create a **new private GitHub repo `nearmora`** in `~/Projects/nearmora` at R1 start. I'll scaffold locally; you create the GitHub repo and branch protection (or explicitly authorize me to). |
| D12 | Fixtures | You supply ~50–200 photos you own and consent to use (including near-duplicate bursts), copied into a fixtures folder; I add generated edge-case files (corrupt, huge, rotated, Unicode names). Your real library stays untouched until you say otherwise. |
| D13 | Stage 0 user validation | Run in **parallel** with R1–R2 using the mockups; doesn't block code. |
| D14 | Electron major | **45.x**, falling back to 44.x if the spike finds issues. |

**Genuine blockers for starting R1:** only D11 (where the repo lives and who creates the GitHub remote). Everything else has a safe default above that you can override.

---

*Next step after approval:* R1a — scaffold the Electron + Vite + strict TypeScript shell with the security settings and one validated IPC command, in small reviewed steps.
