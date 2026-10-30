/**
 * Memory Studio projects (AC6): collages and carousels made from favorites, with each photo's order and crop.
 * Every change is saved straight away, so a draft can't be lost and reopens exactly after a restart.
 * Projects only reference pictures; nothing here touches a photo file.
 */

import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { z } from 'zod'
import { DEFAULT_CROP, LAYOUT_VERSION, MAX_ZOOM, PHOTO_COUNT, type Aspect, type Background, type Crop, type ProjectKind } from '@shared/layout'
import type { Catalog } from '../database'
import { CatalogError, isConstraintError } from '../errors'

const Kind = z.enum(['collage_2', 'collage_4', 'carousel'])
const AspectSchema = z.enum(['1:1', '4:5', '5:4'])
const BackgroundSchema = z.enum(['cream', 'white'])
const Title = z.string().trim().min(1).max(120)
const CropSchema = z.object({ cx: z.number().min(0).max(1), cy: z.number().min(0).max(1), zoom: z.number().min(1).max(MAX_ZOOM) })

const DEFAULT_TITLES: Record<ProjectKind, string> = { collage_2: 'Two-photo collage', collage_4: 'Four-photo collage', carousel: 'Carousel' }

export interface ProjectSummary {
  id: string
  title: string
  kind: ProjectKind
  aspect: Aspect
  background: Background
  photoCount: number
  coverAssetId: string | null
  updatedAt: number
}

export interface ProjectItem {
  position: number
  assetId: string
  crop: Crop
  width: number | null
  height: number | null
  /** False when no file of this picture can be read now (folder disconnected, or file missing). */
  available: boolean
  /** For naming an unavailable photo: its file name and the folder it was in. */
  fileName: string | null
  folderName: string | null
}

export interface ProjectDetail extends Omit<ProjectSummary, 'photoCount' | 'coverAssetId'> {
  layoutVersion: number
  items: ProjectItem[]
}

function checkCount(kind: ProjectKind, count: number): void {
  const { min, max } = PHOTO_COUNT[kind]
  if (count < min || count > max) {
    throw new CatalogError('INVALID_INPUT', min === max ? `This layout takes exactly ${min} photos` : `A carousel takes ${min}–${max} photos`)
  }
}

const touch = (db: Catalog, projectId: string) => db.prepare('UPDATE project SET updated_at = ? WHERE id = ?').run(Date.now(), projectId)

function insertItems(db: Catalog, projectId: string, items: ReadonlyArray<{ assetId: string; crop: Crop }>): void {
  const insert = db.prepare('INSERT INTO project_item (project_id, position, asset_id, crop_cx, crop_cy, crop_zoom) VALUES (?, ?, ?, ?, ?, ?)')
  items.forEach(({ assetId, crop }, position) => {
    try {
      insert.run(projectId, position, assetId, crop.cx, crop.cy, crop.zoom)
    } catch (error: unknown) {
      if (isConstraintError(error, 'FOREIGNKEY')) throw new CatalogError('NOT_FOUND', 'Picture not found', { cause: error })
      throw error
    }
  })
}

export function createProject(
  db: Catalog,
  input: { kind: ProjectKind; aspect: Aspect; background: Background; assetIds: readonly string[]; title?: string },
): ProjectDetail {
  const kind = Kind.parse(input.kind)
  checkCount(kind, input.assetIds.length)
  if (new Set(input.assetIds).size !== input.assetIds.length) throw new CatalogError('INVALID_INPUT', 'Each photo can be used once per project')
  const title = Title.safeParse(input.title ?? DEFAULT_TITLES[kind])
  if (!title.success) throw new CatalogError('INVALID_INPUT', 'Project titles need 1–120 characters')

  const id = randomUUID()
  db.transaction(() => {
    db.prepare('INSERT INTO project (id, title, kind, aspect, background, layout_version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id,
      title.data,
      kind,
      AspectSchema.parse(input.aspect),
      BackgroundSchema.parse(input.background),
      LAYOUT_VERSION,
      Date.now(),
    )
    insertItems(db, id, input.assetIds.map((assetId) => ({ assetId, crop: DEFAULT_CROP })))
  })()
  return getProject(db, id)
}

/** Most recently edited first. */
export function listProjects(db: Catalog): ProjectSummary[] {
  return (
    db
      .prepare(
        `SELECT p.id, p.title, p.kind, p.aspect, p.background, p.updated_at AS updatedAt,
                COUNT(i.position) AS photoCount,
                (SELECT asset_id FROM project_item c WHERE c.project_id = p.id ORDER BY c.position LIMIT 1) AS coverAssetId
         FROM project p LEFT JOIN project_item i ON i.project_id = p.id
         GROUP BY p.id ORDER BY p.updated_at DESC, p.id`,
      )
      .all() as ProjectSummary[]
  )
}

export function getProject(db: Catalog, projectId: string): ProjectDetail {
  const project = db.prepare('SELECT id, title, kind, aspect, background, layout_version, updated_at FROM project WHERE id = ?').get(projectId) as
    | { id: string; title: string; kind: ProjectKind; aspect: Aspect; background: Background; layout_version: number; updated_at: number }
    | undefined
  if (!project) throw new CatalogError('NOT_FOUND', 'Project not found')

  const rows = db
    .prepare(
      `SELECT i.position, i.asset_id, i.crop_cx, i.crop_cy, i.crop_zoom, a.width, a.height,
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
    width: number | null
    height: number | null
    available: number
    relative_path: string | null
    folder_name: string | null
  }>

  return {
    id: project.id,
    title: project.title,
    kind: project.kind,
    aspect: project.aspect,
    background: project.background,
    layoutVersion: project.layout_version,
    updatedAt: project.updated_at,
    items: rows.map((row) => ({
      position: row.position,
      assetId: row.asset_id,
      crop: { cx: row.crop_cx, cy: row.crop_cy, zoom: row.crop_zoom },
      width: row.width,
      height: row.height,
      available: row.available === 1,
      fileName: row.relative_path ? posix.basename(row.relative_path) : null,
      folderName: row.folder_name,
    })),
  }
}

export function updateProject(db: Catalog, input: { projectId: string; title?: string; aspect?: Aspect; background?: Background }): void {
  db.transaction(() => {
    getProject(db, input.projectId)
    if (input.title !== undefined) {
      const title = Title.safeParse(input.title)
      if (!title.success) throw new CatalogError('INVALID_INPUT', 'Project titles need 1–120 characters')
      db.prepare('UPDATE project SET title = ? WHERE id = ?').run(title.data, input.projectId)
    }
    if (input.aspect !== undefined) db.prepare('UPDATE project SET aspect = ? WHERE id = ?').run(AspectSchema.parse(input.aspect), input.projectId)
    if (input.background !== undefined) {
      db.prepare('UPDATE project SET background = ? WHERE id = ?').run(BackgroundSchema.parse(input.background), input.projectId)
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
    const cropOf = new Map(current.map((item) => [item.assetId, item.crop]))
    db.prepare('DELETE FROM project_item WHERE project_id = ?').run(input.projectId)
    insertItems(db, input.projectId, input.assetIds.map((assetId) => ({ assetId, crop: cropOf.get(assetId)! })))
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
