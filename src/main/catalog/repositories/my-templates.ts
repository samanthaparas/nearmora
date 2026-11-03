/**
 * "My templates" (Studio S6b, ADR-0023): a customised layout saved under the person's own name, to start new projects
 * from. A saved template is a copy of the layout, size, settings and places, never a link to its project, and holds no
 * photos. Nothing here touches a photo file.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DEFAULT_CROP } from '@shared/layout'
import { isFormatId, type FormatId } from '@shared/studio/formats'
import { readParams, type Params } from '@shared/studio/params'
import { findTemplate } from '@shared/studio/templates'
import type { Catalog } from '../database'
import { CatalogError } from '../errors'
import { createProjectFromDesign, getProject, type ProjectDetail } from './projects'

const Name = z.string().trim().min(1).max(80)

export interface MyTemplate {
  id: string
  name: string
  templateId: string
  templateVersion: number
  format: FormatId
  params: Params
  /** Every place, removed ones included (they keep their positions). */
  places: number
  /** How many photos starting a project from it takes: its places that weren't removed. */
  photos: number
}

const photosFor = (places: number, params: Params) => places - Object.values(params.edits ?? {}).filter((e) => e.removed).length

/** Saves the project's layout, size, settings and places under a name of the person's choosing. Its photos stay out. */
export function saveMyTemplate(db: Catalog, input: { projectId: string; name: string }): MyTemplate {
  const name = Name.safeParse(input.name)
  if (!name.success) throw new CatalogError('INVALID_INPUT', 'Template names need 1–80 characters')
  const project = getProject(db, input.projectId)
  const id = randomUUID()
  db.prepare(
    'INSERT INTO my_template (id, name, template_id, template_version, format, params_json, places, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, name.data, project.templateId, project.templateVersion, project.format, JSON.stringify(project.params), project.items.length, Date.now())
  return listMyTemplates(db).find((t) => t.id === id)!
}

/**
 * The person's templates, newest first. One written by a newer Nearmora (an unknown layout, size or setting) is left
 * out rather than guessed at; it stays stored, untouched.
 */
export function listMyTemplates(db: Catalog): MyTemplate[] {
  const rows = db.prepare('SELECT id, name, template_id, template_version, format, params_json, places FROM my_template ORDER BY created_at DESC, id').all() as Array<{
    id: string
    name: string
    template_id: string
    template_version: number
    format: string
    params_json: string
    places: number
  }>
  return rows.flatMap((row) => {
    if (!isFormatId(row.format) || !findTemplate(row.template_id, row.template_version)) return []
    let params: Params
    try {
      params = readParams(JSON.parse(row.params_json))
    } catch {
      return []
    }
    return [{ id: row.id, name: row.name, templateId: row.template_id, templateVersion: row.template_version, format: row.format, params, places: row.places, photos: photosFor(row.places, params) }]
  })
}

export function deleteMyTemplate(db: Catalog, id: string): void {
  if (db.prepare('DELETE FROM my_template WHERE id = ?').run(id).changes === 0) throw new CatalogError('NOT_FOUND', 'Template not found')
}

/**
 * Starts a project from one of the person's templates: the chosen photos fill its places in order, skipping removed
 * ones, which stay removed and empty. It goes through every rule a saved design meets.
 */
export function createFromMyTemplate(db: Catalog, input: { myTemplateId: string; assetIds: readonly string[] }): ProjectDetail {
  const saved = listMyTemplates(db).find((t) => t.id === input.myTemplateId)
  if (!saved) throw new CatalogError('NOT_FOUND', 'Template not found')
  if (input.assetIds.length !== saved.photos) throw new CatalogError('INVALID_INPUT', `${saved.name} takes exactly ${saved.photos} photos`)
  const queue = [...input.assetIds]
  const items = Array.from({ length: saved.places }, (_, i) => ({
    assetId: saved.params.edits?.[String(i)]?.removed ? null : queue.shift()!,
    crop: DEFAULT_CROP,
    fit: 'fill' as const,
  }))
  return createProjectFromDesign(db, {
    design: { templateId: saved.templateId, templateVersion: saved.templateVersion, format: saved.format, params: saved.params, items },
    title: saved.name,
  })
}
