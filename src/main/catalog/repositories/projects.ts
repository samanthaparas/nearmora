/**
 * Memory Studio projects (AC6): collages and carousels made from favorites, from a versioned template, with each
 * photo's order and crop.
 * Every change is saved straight away, so a draft can't be lost and reopens exactly after a restart.
 * Projects only reference pictures; nothing here touches a photo file.
 */

import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { z } from 'zod'
import { DEFAULT_CROP, MAX_ZOOM, type Crop } from '@shared/layout'
import { isFormatId, type FormatId } from '@shared/studio/formats'
import { DEFAULT_PARAMS, ParamsSchema, readParams, type Params } from '@shared/studio/params'
import { latestTemplates, type TemplateDefinition } from '@shared/studio/templates'
import type { Catalog } from '../database'
import { CatalogError, isConstraintError } from '../errors'

const Title = z.string().trim().min(1).max(120)
const CropSchema = z.object({ cx: z.number().min(0).max(1), cy: z.number().min(0).max(1), zoom: z.number().min(1).max(MAX_ZOOM) })

export interface ProjectSummary {
  id: string
  title: string
  templateId: string
  templateVersion: number
  format: FormatId
  photoCount: number
  coverAssetId: string | null
  updatedAt: number
}

export interface ProjectItem {
  position: number
  assetId: string
  crop: Crop
  /** Fill covers the slot (cropping the photo); fit shows the whole photo inside it. Used from phase S2. */
  fit: 'fill' | 'fit'
  width: number | null
  height: number | null
  /** False when no file of this picture can be read now (folder disconnected, or file missing). */
  available: boolean
  /** For naming an unavailable photo: its file name and the folder it was in. */
  fileName: string | null
  folderName: string | null
}

export interface ProjectDetail extends Omit<ProjectSummary, 'photoCount' | 'coverAssetId'> {
  params: Params
  items: ProjectItem[]
}

// New projects always start from the newest version of a template.
function newestTemplate(templateId: string): TemplateDefinition {
  const template = latestTemplates().find((t) => t.id === templateId)
  if (!template) throw new CatalogError('INVALID_INPUT', 'Unknown template')
  return template
}

function checkFormat(format: string): FormatId {
  if (!isFormatId(format)) throw new CatalogError('INVALID_INPUT', 'Unknown format')
  return format
}

// A format read back from the catalog that this version doesn't know (written by a newer Nearmora) is refused, not guessed.
const storedFormat = (format: string): FormatId => {
  if (!isFormatId(format)) throw new CatalogError('INVALID_INPUT', `This project uses a format this version of Nearmora doesn't know (${format})`)
  return format
}

const touch = (db: Catalog, projectId: string) => db.prepare('UPDATE project SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)

function insertItems(db: Catalog, projectId: string, items: ReadonlyArray<{ assetId: string; crop: Crop; fit: 'fill' | 'fit' }>): void {
  const insert = db.prepare('INSERT INTO project_item (project_id, position, asset_id, crop_cx, crop_cy, crop_zoom, fit) VALUES (?, ?, ?, ?, ?, ?, ?)')
  items.forEach(({ assetId, crop, fit }, position) => {
    try {
      insert.run(projectId, position, assetId, crop.cx, crop.cy, crop.zoom, fit)
    } catch (error: unknown) {
      if (isConstraintError(error, 'FOREIGNKEY')) throw new CatalogError('NOT_FOUND', 'Picture not found', { cause: error })
      throw error
    }
  })
}

export function createProject(db: Catalog, input: { templateId: string; format: string; assetIds: readonly string[]; title?: string }): ProjectDetail {
  const template = newestTemplate(input.templateId)
  const format = checkFormat(input.format)
  const { min, max } = template.photos
  if (input.assetIds.length < min || input.assetIds.length > max) {
    throw new CatalogError('INVALID_INPUT', min === max ? `${template.name} takes exactly ${min} photos` : `${template.name} takes ${min}–${max} photos`)
  }
  if (new Set(input.assetIds).size !== input.assetIds.length) throw new CatalogError('INVALID_INPUT', 'Each photo can be used once per project')
  const title = Title.safeParse(input.title ?? template.name)
  if (!title.success) throw new CatalogError('INVALID_INPUT', 'Project titles need 1–120 characters')

  const id = randomUUID()
  db.transaction(() => {
    db.prepare('INSERT INTO project (id, title, template_id, template_version, format, params_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      title.data,
      template.id,
      template.version,
      format,
      JSON.stringify(DEFAULT_PARAMS),
      Date.now(),
    )
    insertItems(db, id, input.assetIds.map((assetId) => ({ assetId, crop: DEFAULT_CROP, fit: 'fill' as const })))
  })()
  return getProject(db, id)
}

/** Most recently edited first. */
export function listProjects(db: Catalog): ProjectSummary[] {
  return (
    db
      .prepare(
        `SELECT p.id, p.title, p.template_id AS templateId, p.template_version AS templateVersion, p.format, p.updated_at AS updatedAt,
                COUNT(i.position) AS photoCount,
                (SELECT asset_id FROM project_item c WHERE c.project_id = p.id ORDER BY c.position LIMIT 1) AS coverAssetId
         FROM project p LEFT JOIN project_item i ON i.project_id = p.id
         GROUP BY p.id ORDER BY p.updated_at DESC, p.id`,
      )
      .all() as Array<Omit<ProjectSummary, 'format'> & { format: string }>
  ).map((row) => ({ ...row, format: storedFormat(row.format) }))
}

export function getProject(db: Catalog, projectId: string): ProjectDetail {
  const project = db.prepare('SELECT id, title, template_id, template_version, format, params_json, updated_at FROM project WHERE id = ?').get(projectId) as
    | { id: string; title: string; template_id: string; template_version: number; format: string; params_json: string; updated_at: number }
    | undefined
  if (!project) throw new CatalogError('NOT_FOUND', 'Project not found')

  const rows = db
    .prepare(
      `SELECT i.position, i.asset_id, i.crop_cx, i.crop_cy, i.crop_zoom, i.fit, a.width, a.height,
              EXISTS (SELECT 1 FROM asset_location l JOIN source s ON s.id = l.source_id
                      WHERE l.asset_id = a.id AND l.availability = 'available' AND s.status = 'active') AS available,
              (SELECT l.relative_path FROM asset_location l WHERE l.asset_id = a.id ORDER BY l.availability = 'available' DESC, l.relative_path LIMIT 1) AS relative_path,
              (SELECT s.display_name FROM asset_location l JOIN source s ON s.id = l.source_id WHERE l.asset_id = a.id
               ORDER BY l.availability = 'available' DESC, l.relative_path LIMIT 1) AS folder_name
       FROM project_item i JOIN asset a ON a.id = i.asset_id
       WHERE i.project_id = ? ORDER BY i.position`,
    )
    .all(projectId) as Array<{
    position: number
    asset_id: string
    crop_cx: number
    crop_cy: number
    crop_zoom: number
    fit: 'fill' | 'fit'
    width: number | null
    height: number | null
    available: number
    relative_path: string | null
    folder_name: string | null
  }>

  return {
    id: project.id,
    title: project.title,
    templateId: project.template_id,
    templateVersion: project.template_version,
    format: storedFormat(project.format),
    params: parseStoredParams(project.params_json),
    updatedAt: project.updated_at,
    items: rows.map((row) => ({
      position: row.position,
      assetId: row.asset_id,
      crop: { cx: row.crop_cx, cy: row.crop_cy, zoom: row.crop_zoom },
      fit: row.fit,
      width: row.width,
      height: row.height,
      available: row.available === 1,
      fileName: row.relative_path ? posix.basename(row.relative_path) : null,
      folderName: row.folder_name,
    })),
  }
}

// Stored settings that don't match the schema (damaged, or written by a newer Nearmora) are refused, not guessed at.
function parseStoredParams(json: string): Params {
  try {
    return readParams(JSON.parse(json))
  } catch (error: unknown) {
    throw new CatalogError('INVALID_INPUT', 'This project’s settings can’t be read by this version of Nearmora', { cause: error })
  }
}

/**
 * Title, layout, format and settings. A new layout must take the project's number of photos; it starts at its newest
 * version, and the photos keep their order and crops. Settings are replaced as a whole, after checking them.
 */
export function updateProject(db: Catalog, input: { projectId: string; title?: string; templateId?: string; format?: string; params?: Params }): void {
  db.transaction(() => {
    const current = getProject(db, input.projectId)
    if (input.templateId !== undefined) {
      const template = newestTemplate(input.templateId)
      const count = current.items.length
      if (count < template.photos.min || count > template.photos.max) throw new CatalogError('INVALID_INPUT', `${template.name} doesn’t take ${count} photos`)
      db.prepare('UPDATE project SET template_id = ?, template_version = ? WHERE id = ?').run(template.id, template.version, input.projectId)
    }
    if (input.title !== undefined) {
      const title = Title.safeParse(input.title)
      if (!title.success) throw new CatalogError('INVALID_INPUT', 'Project titles need 1–120 characters')
      db.prepare('UPDATE project SET title = ? WHERE id = ?').run(title.data, input.projectId)
    }
    if (input.format !== undefined) db.prepare('UPDATE project SET format = ? WHERE id = ?').run(checkFormat(input.format), input.projectId)
    if (input.params !== undefined) {
      const params = ParamsSchema.safeParse(input.params)
      if (!params.success) throw new CatalogError('INVALID_INPUT', 'Those settings aren’t valid')
      db.prepare('UPDATE project SET params_json = ? WHERE id = ?').run(JSON.stringify(params.data), input.projectId)
    }
    touch(db, input.projectId)
  })()
}

/** Puts the same photos in a new order; each keeps its own crop. */
export function reorderProject(db: Catalog, input: { projectId: string; assetIds: readonly string[] }): void {
  db.transaction(() => {
    const current = getProject(db, input.projectId).items
    const same = input.assetIds.length === current.length && current.every((item) => input.assetIds.includes(item.assetId))
    if (!same) throw new CatalogError('INVALID_INPUT', 'A reorder must list the project’s photos exactly once')
    const itemOf = new Map(current.map((item) => [item.assetId, item]))
    db.prepare('DELETE FROM project_item WHERE project_id = ?').run(input.projectId)
    insertItems(db, input.projectId, input.assetIds.map((assetId) => ({ assetId, crop: itemOf.get(assetId)!.crop, fit: itemOf.get(assetId)!.fit })))
    touch(db, input.projectId)
  })()
}

export function setItemCrop(db: Catalog, input: { projectId: string; position: number; crop: Crop }): void {
  const crop = CropSchema.safeParse(input.crop)
  if (!crop.success) throw new CatalogError('INVALID_INPUT', 'Crop position must be 0–1 and zoom 1–4')
  db.transaction(() => {
    const result = db
      .prepare('UPDATE project_item SET crop_cx = ?, crop_cy = ?, crop_zoom = ? WHERE project_id = ? AND position = ?')
      .run(crop.data.cx, crop.data.cy, crop.data.zoom, input.projectId, input.position)
    if (result.changes === 0) throw new CatalogError('NOT_FOUND', 'No photo at that position')
    touch(db, input.projectId)
  })()
}

/** Deletes the project. Its photos stay in the Library and in their folders. */
export function deleteProject(db: Catalog, projectId: string): void {
  const result = db.prepare('DELETE FROM project WHERE id = ?').run(projectId)
  if (result.changes === 0) throw new CatalogError('NOT_FOUND', 'Project not found')
}
