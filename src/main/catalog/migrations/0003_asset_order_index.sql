-- Schema v3: the Library is ordered by date, then id (so photos taken in the same second have a fixed order).
-- An index on both columns lets SQLite read photos in that order directly, page after page, without sorting.

DROP INDEX idx_asset_captured;
CREATE INDEX idx_asset_captured ON asset(captured_at, id);
