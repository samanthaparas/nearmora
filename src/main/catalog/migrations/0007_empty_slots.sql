-- Schema v7: a project's photo position can be empty (Studio S6a, ADR-0022). Taking a photo out of its slot keeps the
-- layout as it is and leaves the place empty, ready to be filled again; the photo itself is no longer part of the
-- project, so Clean up no longer counts it as in use. SQLite can't drop NOT NULL in place, so the item table is
-- rebuilt and its rows copied over; the project table is untouched, so no cascade can fire.

CREATE TABLE project_item_v7 (
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL CHECK (position >= 0),
  asset_id   TEXT REFERENCES asset(id) ON DELETE RESTRICT,
  crop_cx    REAL NOT NULL CHECK (crop_cx BETWEEN 0 AND 1),
  crop_cy    REAL NOT NULL CHECK (crop_cy BETWEEN 0 AND 1),
  crop_zoom  REAL NOT NULL CHECK (crop_zoom >= 1),
  fit        TEXT NOT NULL DEFAULT 'fill' CHECK (fit IN ('fill', 'fit')),
  PRIMARY KEY (project_id, position)
) STRICT;
INSERT INTO project_item_v7 (project_id, position, asset_id, crop_cx, crop_cy, crop_zoom, fit)
  SELECT project_id, position, asset_id, crop_cx, crop_cy, crop_zoom, fit FROM project_item;

DROP TABLE project_item;
ALTER TABLE project_item_v7 RENAME TO project_item;
CREATE INDEX idx_project_item_asset ON project_item(asset_id);
