/**
 * Errors the catalog raises on purpose, each with a code callers can act on.
 * Unexpected failures (a bug, a full disk) stay ordinary errors.
 */

export type CatalogErrorCode =
  | 'NOT_FOUND'
  | 'STALE_REVISION'
  | 'INVALID_INPUT'
  | 'CONFLICT'
  | 'INVALID_BACKUP'
  | 'CATALOG_TOO_NEW'
  | 'MIGRATION_FAILED'

export class CatalogError extends Error {
  override readonly name = 'CatalogError'

  constructor(
    readonly code: CatalogErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

/** A migration failed and was rolled back. `backupPath` is the copy taken before migrating, if one was needed. */
export class MigrationError extends CatalogError {
  constructor(
    readonly failedVersion: number,
    readonly fromVersion: number,
    readonly backupPath: string | undefined,
    cause: unknown,
  ) {
    super('MIGRATION_FAILED', `Migration to schema v${failedVersion} failed`, { cause })
  }
}

// SQLite reports constraint failures with codes like SQLITE_CONSTRAINT_UNIQUE.
export function isConstraintError(error: unknown, kind: 'UNIQUE' | 'FOREIGNKEY' | 'CHECK' | 'PRIMARYKEY'): boolean {
  return error instanceof Error && 'code' in error && error.code === `SQLITE_CONSTRAINT_${kind}`
}
