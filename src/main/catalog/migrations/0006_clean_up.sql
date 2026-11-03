-- Schema v6: Clean up (milestone C1, ADR-0019).
-- `unneeded` holds the pictures the person marked "Don't need". A mark is only a note: nothing is removed until they
-- review and confirm. `removal_log` is the local record of every file removed; it keeps names and sizes, never images,
-- and has no link to the catalogue so it outlives the pictures it describes.

CREATE TABLE unneeded (
  asset_id  TEXT PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
  marked_at INTEGER NOT NULL
) STRICT;

CREATE TABLE removal_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  removed_at  INTEGER NOT NULL,
  mode        TEXT NOT NULL CHECK (mode IN ('trash', 'forever')),
  file_name   TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL CHECK (size_bytes >= 0)
) STRICT;

CREATE INDEX idx_removal_log_time ON removal_log(removed_at);
