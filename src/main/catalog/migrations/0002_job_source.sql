-- Schema v2: links each scan job to its source, so "the last scan of this folder" is one indexed lookup
-- instead of reading every job's JSON. Removing a source now also removes its scan history.

ALTER TABLE job ADD COLUMN source_id TEXT REFERENCES source(id) ON DELETE CASCADE;

-- Backfill from the JSON checkpoint written by v1 scans. Jobs for sources that no longer exist are dropped,
-- since they can't be linked and nothing reads them.
UPDATE job SET source_id = json_extract(checkpoint, '$.sourceId')
WHERE kind = 'scan' AND json_extract(checkpoint, '$.sourceId') IN (SELECT id FROM source);
DELETE FROM job WHERE kind = 'scan' AND source_id IS NULL;

CREATE INDEX idx_job_source ON job(source_id, updated_at);
