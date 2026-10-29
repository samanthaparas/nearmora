-- Schema v1: every table Nearmora's catalog needs for the MVP.
-- The catalog stores facts *about* photos (where they are, favorites, albums); it never stores the photos themselves.
-- STRICT tables make SQLite reject values of the wrong type instead of silently storing them.

-- A folder or drive the user added. Removing one only removes catalog rows, never files.
CREATE TABLE source (
  id            TEXT PRIMARY KEY,
  root_path     TEXT NOT NULL UNIQUE,
  volume_uuid   TEXT,
  display_name  TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  status        TEXT NOT NULL CHECK (status IN ('active', 'disconnected', 'permission_denied', 'removed')),
  added_at      INTEGER NOT NULL,
  last_scan_at  INTEGER
) STRICT;

-- One row per distinct picture, identified by the SHA-256 of its bytes.
CREATE TABLE asset (
  id                 TEXT PRIMARY KEY,
  content_sha256     BLOB NOT NULL UNIQUE CHECK (length(content_sha256) = 32),
  media_type         TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png')),
  width              INTEGER CHECK (width IS NULL OR width > 0),
  height             INTEGER CHECK (height IS NULL OR height > 0),
  orientation        INTEGER CHECK (orientation IS NULL OR orientation BETWEEN 1 AND 8),
  captured_at        INTEGER,
  captured_at_source TEXT NOT NULL CHECK (captured_at_source IN ('exif', 'file_mtime', 'unknown')),
  dhash              BLOB CHECK (dhash IS NULL OR length(dhash) = 8),
  decode_state       TEXT NOT NULL CHECK (decode_state IN ('ok', 'unsupported', 'corrupt', 'too_large')),
  -- A date exists exactly when we know where it came from.
  CHECK ((captured_at IS NULL) = (captured_at_source = 'unknown'))
) STRICT;

-- One row per file path. Identical bytes in two folders are two locations of one asset.
CREATE TABLE asset_location (
  id            TEXT PRIMARY KEY,
  asset_id      TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  source_id     TEXT NOT NULL REFERENCES source(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL CHECK (size_bytes >= 0),
  mtime_ms      INTEGER NOT NULL,
  inode         INTEGER,
  dev           INTEGER,
  availability  TEXT NOT NULL CHECK (availability IN ('available', 'missing', 'changed')),
  UNIQUE (source_id, relative_path)
) STRICT;

-- Date-based groups shown in the Library ("Your moments").
CREATE TABLE moment (
  id             TEXT PRIMARY KEY,
  title          TEXT,
  auto_title     TEXT NOT NULL,
  cover_asset_id TEXT REFERENCES asset(id) ON DELETE SET NULL,
  starts_at      INTEGER NOT NULL,
  ends_at        INTEGER NOT NULL,
  user_edited    INTEGER NOT NULL DEFAULT 0 CHECK (user_edited IN (0, 1)),
  CHECK (ends_at >= starts_at)
) STRICT;

CREATE TABLE moment_asset (
  moment_id TEXT NOT NULL REFERENCES moment(id) ON DELETE CASCADE,
  asset_id  TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  PRIMARY KEY (moment_id, asset_id)
) STRICT;

-- Groups of identical or visually similar photos reviewed in Best Moments.
-- `revision` increases on every save, so a stale screen can't overwrite newer choices.
CREATE TABLE similarity_set (
  id                TEXT PRIMARY KEY,
  reason            TEXT NOT NULL CHECK (reason IN ('exact', 'visual', 'manual')),
  algorithm_version TEXT NOT NULL,
  review_status     TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'deferred', 'reviewed')),
  revision          INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
) STRICT;

CREATE TABLE set_asset (
  set_id        TEXT NOT NULL REFERENCES similarity_set(id) ON DELETE CASCADE,
  asset_id      TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL CHECK (position >= 0),
  -- A manual correction that must survive regrouping.
  user_override TEXT CHECK (user_override IN ('added', 'removed')),
  PRIMARY KEY (set_id, asset_id),
  UNIQUE (set_id, position)
) STRICT;

-- Favorites belong to the picture (asset), not to a path or a set (roadmap decision D3).
CREATE TABLE favorite (
  asset_id   TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE album (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  created_at INTEGER NOT NULL
) STRICT;

-- Deleting an album removes its memberships only; the photos' assets stay.
CREATE TABLE album_asset (
  album_id TEXT NOT NULL REFERENCES album(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  PRIMARY KEY (album_id, asset_id),
  UNIQUE (album_id, position)
) STRICT;

-- Studio Lite collages and carousels.
CREATE TABLE project (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  kind           TEXT NOT NULL CHECK (kind IN ('collage_2', 'collage_4', 'carousel')),
  aspect         TEXT NOT NULL CHECK (aspect IN ('1:1', '4:5')),
  background     TEXT NOT NULL CHECK (background IN ('cream', 'white')),
  layout_version INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
) STRICT;

-- RESTRICT: an asset used in a project can't disappear silently from under it.
CREATE TABLE project_item (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL CHECK (position >= 0),
  asset_id   TEXT NOT NULL REFERENCES asset(id) ON DELETE RESTRICT,
  crop_cx    REAL NOT NULL CHECK (crop_cx BETWEEN 0 AND 1),
  crop_cy    REAL NOT NULL CHECK (crop_cy BETWEEN 0 AND 1),
  crop_zoom  REAL NOT NULL CHECK (crop_zoom >= 1),
  PRIMARY KEY (project_id, position)
) STRICT;

-- Long-running scans and exports, so they can resume after a restart.
CREATE TABLE job (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('scan', 'export')),
  status     TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'cancelled', 'failed', 'done')),
  checkpoint TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

-- Snapshots taken before a change, so it can be undone (scoped undo, roadmap decision D9).
CREATE TABLE undo_entry (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT NOT NULL CHECK (scope IN ('review_save', 'album_edit', 'moment_edit')),
  target_id   TEXT NOT NULL,
  before_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL
) STRICT;

-- Indexes for the main queries (see docs/evidence/r2 for the measured query plans).
CREATE INDEX idx_asset_captured ON asset(captured_at);
CREATE INDEX idx_location_asset ON asset_location(asset_id);
CREATE INDEX idx_set_asset_asset ON set_asset(asset_id);

-- Indexes on foreign-key child columns. Without them, deleting a parent row
-- makes SQLite scan the whole child table to check or cascade.
CREATE INDEX idx_moment_asset_asset ON moment_asset(asset_id);
CREATE INDEX idx_moment_cover ON moment(cover_asset_id);
CREATE INDEX idx_album_asset_asset ON album_asset(asset_id);
CREATE INDEX idx_project_item_asset ON project_item(asset_id);
CREATE INDEX idx_undo_target ON undo_entry(scope, target_id);
