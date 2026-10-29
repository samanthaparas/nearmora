# ADR-0004: The SQLite catalog

Date: 2026-10-28 · Status: accepted (R2)

## Context

Every later milestone stores something: R3 records the pictures it finds, R4 saves favorites and review choices, and R5 saves projects. They all need a catalog with integrity rules, safe schema upgrades and a backup people can trust (AC11–AC13). Original photos must never be part of it.

## Decision

- **Plain parameterized SQL with Zod at the repository edge** (roadmap decision D2). Rows are validated as they leave SQLite and inputs as they arrive, so the rest of the app gets typed, checked objects. We'll re-evaluate Drizzle once there are more queries.
- **Schema v1** follows the roadmap's proposal (§6.2), with these refinements:
  - `STRICT` tables, so SQLite rejects a value of the wrong type instead of storing it.
  - Extra `CHECK`s:
    - `captured_at` is set exactly when its source is known.
    - SHA-256 hashes are 32 bytes and dHash values are 8 bytes.
    - Crop values stay in range.
    - Titles are 1–120 characters.
  - `source.root_path` is unique, so the same folder can't be added twice.
  - `UNIQUE (…, position)` on album and set members, so the order can't be ambiguous.
  - Indexes on every foreign-key child column. Without them, deleting a parent makes SQLite scan the whole child table.
  - `favorite` drops its `revision` column. Conflicts are detected on `similarity_set.revision`, which every review save checks against the revision the screen showed.
- **Migrations:**
  - Numbered `.sql` files, imported with Vite's `?raw` so their text is bundled into the app and no loose files need to ship.
  - Each migration runs in a transaction, with the version in `PRAGMA user_version`. A foreign-key check runs before commit.
  - Before upgrading an existing catalog, a copy goes to the backups folder; the newest 3 are kept.
  - A catalog newer than the app is refused and left untouched.
- **Connection settings:** `foreign_keys = ON` (verified, not assumed), WAL journal, 5 s busy timeout.
- **Copies** (backups, pre-migration and pre-restore copies) use SQLite's online backup and are then switched to the rollback journal. That keeps each one a single self-contained file. The tests caught that copies otherwise inherit WAL mode and grow `-wal`/`-shm` files when opened.
- **Backup format:**
  - A new, uniquely named folder holding `catalog.sqlite`, `manifest.json` and a `README.txt` saying original photos are not included.
  - Before the manifest is written, the copy is checked with `integrity_check` and `foreign_key_check`.
  - On restore, the manifest is checked against the actual contents before anything is replaced.
  - Restore keeps a safety copy of the catalog it replaces and reports which photo folders aren't reachable.
- **Review save/undo:**
  - One transaction writes favorites, the set's status and revision, and an undo snapshot (validated JSON).
  - Undo is refused if the set was saved again since, and each undo entry can be used once.

## Consequences

- Nothing in the running app opens the catalog yet. R3a will open it at startup from the app-data folder, and will add a recovery screen for a failed migration. The restore function and the test for it exist now.
- Backup and restore have no dialogs or IPC commands yet (`catalog.backup` / `catalog.restore` in the roadmap's IPC list). Those come with the screens that use them.
- Album edits and moment renames don't write undo entries yet; the table allows them (decision D9).
- AC11 is only partly covered: projects are restored as rows, but the full check needs R5's project features.
