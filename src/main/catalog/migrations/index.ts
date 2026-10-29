/**
 * The ordered list of schema migrations. To change the schema, add a new numbered .sql file and append it here;
 * never edit a migration that has already shipped, because existing catalogs have already run it.
 */

// `?raw` makes Vite bundle the file's text into the app, so no .sql files need to ship separately.
import init from './0001_init.sql?raw'

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: 'init', sql: init }]
