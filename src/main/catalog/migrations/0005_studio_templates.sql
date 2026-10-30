-- Schema v5: Memory Studio projects are made from versioned templates (Studio expansion, phase S1).
-- A project now stores its template id and version, its format and its own settings (JSON, validated by the app)
-- instead of a fixed kind, shape and background. Formats are no longer a CHECK list, so new sizes need no rebuild.
-- Existing projects map onto the first template versions, which reproduce their layouts exactly:
--   collage_2 -> pair-equal-split v1, collage_4 -> quartet-classic-grid v1, carousel -> carousel-full v1;
--   1:1 -> square, 4:5 -> portrait, 5:4 -> landscape; cream/white -> their colour in the settings.
-- Each photo also gains a fit setting ('fill' as before; 'fit' arrives in phase S2).
-- As in v4: rows are copied first, the item table is dropped before the project table so no cascade can fire,
-- and renaming the new project table updates the item table's reference.

CREATE TABLE project_v5 (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  template_id      TEXT NOT NULL CHECK (length(template_id) BETWEEN 1 AND 80),
  template_version INTEGER NOT NULL CHECK (template_version >= 1),
  format           TEXT NOT NULL CHECK (length(format) BETWEEN 1 AND 40),
  params_json      TEXT NOT NULL CHECK (json_valid(params_json)),
  updated_at       INTEGER NOT NULL
) STRICT;
INSERT INTO project_v5 (id, title, template_id, template_version, format, params_json, updated_at)
  SELECT id, title,
         CASE kind WHEN 'collage_2' THEN 'pair-equal-split' WHEN 'collage_4' THEN 'quartet-classic-grid' ELSE 'carousel-full' END,
         1,
         CASE aspect WHEN '1:1' THEN 'square' WHEN '4:5' THEN 'portrait' ELSE 'landscape' END,
         json_object('v', 1, 'background', CASE background WHEN 'white' THEN '#ffffff' ELSE '#f8f0e8' END),
         updated_at
  FROM project;

CREATE TABLE project_item_v5 (
  project_id TEXT NOT NULL REFERENCES project_v5(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL CHECK (position >= 0),
  asset_id   TEXT NOT NULL REFERENCES asset(id) ON DELETE RESTRICT,
  crop_cx    REAL NOT NULL CHECK (crop_cx BETWEEN 0 AND 1),
  crop_cy    REAL NOT NULL CHECK (crop_cy BETWEEN 0 AND 1),
  crop_zoom  REAL NOT NULL CHECK (crop_zoom >= 1),
  fit        TEXT NOT NULL DEFAULT 'fill' CHECK (fit IN ('fill', 'fit')),
  PRIMARY KEY (project_id, position)
) STRICT;
INSERT INTO project_item_v5 (project_id, position, asset_id, crop_cx, crop_cy, crop_zoom)
  SELECT project_id, position, asset_id, crop_cx, crop_cy, crop_zoom FROM project_item;

DROP TABLE project_item;
DROP TABLE project;
ALTER TABLE project_v5 RENAME TO project;
ALTER TABLE project_item_v5 RENAME TO project_item;
CREATE INDEX idx_project_item_asset ON project_item(asset_id);
