/**
 * The ordered list of schema migrations. To change the schema, add a new numbered .sql file and append it here;
 * never edit a migration that has already shipped, because existing catalogs have already run it.
 */

// `?raw` makes Vite bundle the file's text into the app, so no .sql files need to ship separately.
import init from './0001_init.sql?raw'
import jobSource from './0002_job_source.sql?raw'
import assetOrderIndex from './0003_asset_order_index.sql?raw'
import landscapeProjects from './0004_landscape_projects.sql?raw'
import studioTemplates from './0005_studio_templates.sql?raw'
import cleanUp from './0006_clean_up.sql?raw'
import emptySlots from './0007_empty_slots.sql?raw'

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'init', sql: init },
  { version: 2, name: 'job-source', sql: jobSource },
  { version: 3, name: 'asset-order-index', sql: assetOrderIndex },
  { version: 4, name: 'landscape-projects', sql: landscapeProjects },
  { version: 5, name: 'studio-templates', sql: studioTemplates },
  { version: 6, name: 'clean-up', sql: cleanUp },
  { version: 7, name: 'empty-slots', sql: emptySlots },
]
