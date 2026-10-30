-- Schema v4: Memory Studio projects can also be landscape ('5:4', 1350 × 1080).
-- SQLite can't change a CHECK constraint in place, so both project tables are rebuilt and their rows copied over.
-- The old item table is dropped before the old project table, so its ON DELETE CASCADE never removes any item;
-- renaming project_v4 to project also updates the reference in project_item_v4.

CREATE TABLE project_v4 (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  kind           TEXT NOT NULL CHECK (kind IN ('collage_2', 'collage_4', 'carousel')),
  aspect         TEXT NOT NULL CHECK (aspect IN ('1:1', '4:5', '5:4')),
  background     TEXT NOT NULL CHECK (background IN ('cream', 'white')),
  layout_version INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
) STRICT;
INSERT INTO project_v4 (id, title, kind, aspect, background, layout_version, updated_at)
  SELECT id, title, kind, aspect, background, layout_version, updated_at FROM project;

CREATE TABLE project_item_v4 (
  project_id TEXT NOT NULL REFERENCES project_v4(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL CHECK (position >= 0),
  asset_id   TEXT NOT NULL REFERENCES asset(id) ON DELETE RESTRICT,
  crop_cx    REAL NOT NULL CHECK (crop_cx BETWEEN 0 AND 1),
  crop_cy    REAL NOT NULL CHECK (crop_cy BETWEEN 0 AND 1),
  crop_zoom  REAL NOT NULL CHECK (crop_zoom >= 1),
  PRIMARY KEY (project_id, position)
) STRICT;
INSERT INTO project_item_v4 (project_id, position, asset_id, crop_cx, crop_cy, crop_zoom)
  SELECT project_id, position, asset_id, crop_cx, crop_cy, crop_zoom FROM project_item;

DROP TABLE project_item;
DROP TABLE project;
ALTER TABLE project_v4 RENAME TO project;
ALTER TABLE project_item_v4 RENAME TO project_item;
CREATE INDEX idx_project_item_asset ON project_item(asset_id);
