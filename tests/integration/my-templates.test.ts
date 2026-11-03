/**
 * Integration tests for S6b (ADR-0023): added and removed places in saved projects, and "My templates", saved
 * customised layouts that are copies (never links), start projects with exactly the photos they need, and survive.
 */

import { describe, expect, it } from 'vitest'
import { createFromMyTemplate, deleteMyTemplate, listMyTemplates, saveMyTemplate } from '../../src/main/catalog/repositories/my-templates'
import { createProject, deleteProject, getProject, setDesign } from '../../src/main/catalog/repositories/projects'
import { addPlace, removePlace, setEdit } from '../../src/shared/studio/arrange'
import { compose } from '../../src/shared/studio/compose'
import { designOf, replaceItem, type Design } from '../../src/shared/studio/design'
import { codeOf, openTestCatalog, seedAssets, seedSource, tempProfile } from './helpers'

async function library() {
  const db = await openTestCatalog(tempProfile().catalogFile)
  const assets = seedAssets(db, seedSource(db).sourceId, 8)
  return { db, assets }
}
type Catalog = Awaited<ReturnType<typeof openTestCatalog>>
const edit = (db: Catalog, projectId: string, change: (design: Design) => Design) => setDesign(db, { projectId, design: change(designOf(getProject(db, projectId))) })
const composed = (design: Design) => compose({ ...design, photoCount: design.items.length })

describe('added and removed places', () => {
  it('a collage takes added places on top of its layout’s count; a carousel doesn’t; a removed place holds no photo', async () => {
    const { db, assets } = await library()
    const grid = createProject(db, { templateId: 'quartet-classic-grid', format: 'square', assetIds: assets.slice(0, 4) })
    edit(db, grid.id, (d) => replaceItem(addPlace(d, composed(d)), 4, assets[4]!))
    expect(getProject(db, grid.id).items.map((i) => i.assetId)).toEqual(assets.slice(0, 5))
    edit(db, grid.id, (d) => removePlace(d, 0))
    expect(getProject(db, grid.id).items[0]!.assetId).toBeNull()
    // A photo put back into a removed place is refused, so nothing stays in the project out of sight.
    expect(codeOf(() => edit(db, grid.id, (d) => replaceItem(d, 0, assets[6]!)))).toBe('INVALID_INPUT')

    const carousel = createProject(db, { templateId: 'carousel-full', format: 'square', assetIds: assets.slice(0, 3) })
    expect(codeOf(() => edit(db, carousel.id, (d) => addPlace(d, composed(d))))).toBe('INVALID_INPUT')
  })
})

describe('My templates', () => {
  it('saves a copy of the layout, size, settings and places, never the photos, and never linked to the project', async () => {
    const { db, assets } = await library()
    const project = createProject(db, { templateId: 'quartet-classic-grid', format: 'portrait', assetIds: assets.slice(0, 4) })
    edit(db, project.id, (d) => removePlace(setEdit(addPlace(d, composed(d)), 0, { rotation: -6, flip: true }), 3))
    const saved = saveMyTemplate(db, { projectId: project.id, name: '  Weekend grid  ' })
    expect(saved).toMatchObject({ name: 'Weekend grid', templateId: 'quartet-classic-grid', format: 'portrait', places: 5, photos: 4 })
    expect(saved.params.edits).toMatchObject({ '0': { rotation: -6, flip: true }, '3': { removed: true } })
    expect(JSON.stringify(saved)).not.toContain(assets[0]!)

    // Changing or deleting the project afterwards leaves the template exactly as saved.
    edit(db, project.id, (d) => setEdit(d, 0, { rotation: 20 }))
    deleteProject(db, project.id)
    expect(listMyTemplates(db)).toEqual([saved])
  })

  it('starts a project with exactly the photos it needs, filling places in order and keeping removed ones removed', async () => {
    const { db, assets } = await library()
    const project = createProject(db, { templateId: 'quartet-classic-grid', format: 'square', assetIds: assets.slice(0, 4) })
    edit(db, project.id, (d) => removePlace(d, 1))
    const saved = saveMyTemplate(db, { projectId: project.id, name: 'Three up' })
    expect(codeOf(() => createFromMyTemplate(db, { myTemplateId: saved.id, assetIds: assets.slice(4, 8) }))).toBe('INVALID_INPUT')
    const made = createFromMyTemplate(db, { myTemplateId: saved.id, assetIds: assets.slice(4, 7) })
    expect(made.title).toBe('Three up')
    expect(made.items.map((i) => i.assetId)).toEqual([assets[4], null, assets[5], assets[6]])
    expect(made.params.edits).toEqual({ '1': { removed: true } })

    // Deleting the template leaves the project made from it as it is.
    deleteMyTemplate(db, saved.id)
    expect(listMyTemplates(db)).toEqual([])
    expect(getProject(db, made.id).items).toHaveLength(4)
  })

  it('a template written by a newer Nearmora is kept but not offered, rather than guessed at', async () => {
    const { db } = await library()
    db.prepare(
      `INSERT INTO my_template (id, name, template_id, template_version, format, params_json, places, created_at) VALUES ('x', 'Future', 'quartet-from-the-future', 1, 'square', '{"v":1}', 4, 1)`,
    ).run()
    expect(listMyTemplates(db)).toEqual([])
    expect((db.prepare('SELECT COUNT(*) AS n FROM my_template').get() as { n: number }).n).toBe(1)
  })
})
