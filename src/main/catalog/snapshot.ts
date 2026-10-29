/**
 * Copies a live catalog to a standalone file, used by backups, pre-migration copies and pre-restore safety copies.
 * The copy is switched out of WAL mode so it's one self-contained file that never grows -wal/-shm companions.
 */

import Database from 'better-sqlite3'

export async function snapshotTo(db: Database.Database, file: string): Promise<void> {
  // SQLite's online backup copies a consistent snapshot, even while the app keeps using the catalog.
  await db.backup(file)
  // The copy inherits the source's WAL setting; the classic rollback journal keeps it a single file.
  const copy = new Database(file)
  try {
    copy.pragma('journal_mode = DELETE')
  } finally {
    copy.close()
  }
}
