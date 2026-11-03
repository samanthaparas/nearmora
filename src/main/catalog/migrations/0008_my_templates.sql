-- Schema v8: "My templates" (Studio S6b, ADR-0023). A person can save a customised layout under their own name and
-- start new projects from it. It is a copy of the layout, size, settings and number of places, never a link to the
-- project it came from, so editing or deleting either one never changes the other. No photos are stored in it.

CREATE TABLE my_template (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  template_id      TEXT NOT NULL CHECK (length(template_id) BETWEEN 1 AND 80),
  template_version INTEGER NOT NULL CHECK (template_version >= 1),
  format           TEXT NOT NULL CHECK (length(format) BETWEEN 1 AND 40),
  params_json      TEXT NOT NULL CHECK (json_valid(params_json)),
  places           INTEGER NOT NULL CHECK (places BETWEEN 1 AND 10),
  created_at       INTEGER NOT NULL
) STRICT;
