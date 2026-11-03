/**
 * Integration tests for Memory Studio projects (AC6): photo counts per template, whole designs saved and checked in one
 * step (layout, shape, settings, borders, order, swaps, replacements, crops and fit), all restored exactly after a
 * restart, offline photos named, and deleting a project leaving every photo in place.
 */

import { describe, expect, it } from 'vitest'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  renameProject,
  setDesign,
} from '../../src/main/catalog/repositories/projects'
import { emptyPlace } from '../../src/shared/studio/arrange'
import { listUnneeded, setUnneeded } from '../../src/main/catalog/repositories/clean-up'
import { designOf, moveItem, replaceItem, resetDesign, swapItems, updateItem, type Design } from '../../src/shared/studio/design'
import { setSourceStatus } from '../../src/main/catalog/repositories/sources'
import { codeOf, openTestCatalog, seedAssets, seedSource, tempProfile } from './helpers'

async function library(file = tempProfile().catalogFile) {
  const db = await openTestCatalog(file)
  const source = seedSource(db, 'Summer')
  const assets = seedAssets(db, source.sourceId, 10)
  return { db, assets, sourceId: source.sourceId }
}

// Saves an edited copy of the project's current design, the way the editor does.
type Catalog = Awaited<ReturnType<typeof openTestCatalog>>
const edit = (db: Catalog, projectId: string, change: (design: Design) => Design) => setDesign(db, { projectId, design: change(designOf(getProject(db, projectId))) })

describe('empty places (S6a)', () => {
  it('a photo can be taken out of its place and put back, the project keeps at least one photo, and Clean up no longer counts it as used', async () => {
    const { db, assets } = await library()
    const project = createProject(db, { templateId: 'pair-equal-split', format: 'square', assetIds: assets.slice(0, 2) })
    edit(db, project.id, (d) => emptyPlace(d, 1))
    expect(getProject(db, project.id).items.map((i) => [i.assetId, i.available])).toEqual([
      [assets[0], true],
      [null, true], // empty, not offline: it never blocks export
    ])
    expect(listProjects(db)[0]).toMatchObject({ coverAssetId: assets[0], photoCount: 2 })
    setUnneeded(db, { assetIds: [assets[1]!], unneeded: true })
    expect(listUnneeded(db).items[0]).toMatchObject({ assetId: assets[1], usedIn: [] })

    // The last photo can't be taken out, and an empty place can be filled again.
    expect(codeOf(() => edit(db, project.id, (d) => emptyPlace(d, 0)))).toBe('INVALID_INPUT')
    edit(db, project.id, (d) => replaceItem(d, 1, assets[2]!))
    expect(getProject(db, project.id).items.map((i) => i.assetId)).toEqual([assets[0], assets[2]])
  })
})

describe('creating projects', () => {
  it('enforces the photo count for each layout, and each photo once', async () => {
    const { db, assets } = await library()
    const make = (templateId: string, n: number) => codeOf(() => createProject(db, { templateId, format: 'square', assetIds: assets.slice(0, n) }))
    expect(make('pair-equal-split', 3)).toBe('INVALID_INPUT')
    expect(make('pair-stacked', 1)).toBe('INVALID_INPUT')
    expect(make('quartet-classic-grid', 3)).toBe('INVALID_INPUT')
    expect(make('carousel-full', 1)).toBe('INVALID_INPUT')
    expect(make('pair-equal-split', 2)).toBeUndefined()
    expect(make('pair-stacked', 2)).toBeUndefined()
    expect(make('quartet-classic-grid', 4)).toBeUndefined()
    expect(make('carousel-full', 10)).toBeUndefined()
    // Unknown templates and formats are refused, not guessed.
    expect(make('no-such-template', 2)).toBe('INVALID_INPUT')
    expect(codeOf(() => createProject(db, { templateId: 'pair-equal-split', format: 'poster', assetIds: assets.slice(0, 2) }))).toBe('INVALID_INPUT')
    expect(codeOf(() => createProject(db, { templateId: 'pair-equal-split', format: 'square', assetIds: [assets[0]!, assets[0]!] }))).toBe(
      'INVALID_INPUT',
    )
  })

  it('makes seamless carousels at sharing shapes only, when created and when the size or layout changes (S5a)', async () => {
    const { db, assets } = await library()
    const at = (format: string) => codeOf(() => createProject(db, { templateId: 'seamless-across-the-seam', format, assetIds: assets.slice(0, 3) }))
    expect(at('print-8x10')).toBe('INVALID_INPUT')
    expect(at('landscape')).toBe('INVALID_INPUT')
    expect(at('portrait')).toBeUndefined()
    // A three-photo carousel at a print size can't switch to it without a sharing shape either.
    const carousel = createProject(db, { templateId: 'carousel-full', format: 'print-8x10', assetIds: assets.slice(0, 3) })
    const switchTo = (format: 'print-8x10' | 'square') =>
      codeOf(() => edit(db, carousel.id, (d) => ({ ...d, templateId: 'seamless-across-the-seam', templateVersion: 1, format })))
    expect(switchTo('print-8x10')).toBe('INVALID_INPUT')
    expect(getProject(db, carousel.id).templateId).toBe('carousel-full')
    expect(switchTo('square')).toBeUndefined()
  })

  it('starts with the template’s name as title, centred crops, fill, default settings and the template’s version', async () => {
    const { db, assets } = await library()
    const project = createProject(db, { templateId: 'quartet-classic-grid', format: 'portrait', assetIds: assets.slice(0, 4) })
    expect(project).toMatchObject({ title: 'Classic grid', templateId: 'quartet-classic-grid', templateVersion: 1, format: 'portrait', params: { v: 1 } })
    expect(project.items.map((i) => i.crop)).toEqual(Array(4).fill({ cx: 0.5, cy: 0.5, zoom: 1 }))
    expect(project.items.map((i) => i.fit)).toEqual(Array(4).fill('fill'))
    expect(listProjects(db)).toMatchObject([{ id: project.id, photoCount: 4, coverAssetId: assets[0] }])
  })
})

describe('editing and restoring a draft (AC6)', () => {
  it('reopens after a restart with the same order, crops, fit, title, format and settings', async () => {
    const { catalogFile } = tempProfile()
    const { db, assets } = await library(catalogFile)
    const project = createProject(db, { templateId: 'quartet-classic-grid', format: 'square', assetIds: assets.slice(0, 4) })
    edit(db, project.id, (d) => updateItem(d, 1, { crop: { cx: 0.25, cy: 0.75, zoom: 2.5 } }))
    edit(db, project.id, (d) => updateItem(d, 3, { fit: 'fit' }))
    edit(db, project.id, (d) => moveItem(d, 0, 2))
    edit(db, project.id, (d) => ({
      ...d,
      format: 'portrait',
      params: { v: 1, background: '#123456', margin: 30, gutter: 0, borderWidth: 12, borderColor: '#2f2b2c' },
    }))
    renameProject(db, { projectId: project.id, title: 'Beach grid' })
    const before = getProject(db, project.id)
    db.close()

    const reopened = await openTestCatalog(catalogFile)
    expect(getProject(reopened, project.id)).toEqual(before)
    expect(before).toMatchObject({ title: 'Beach grid', format: 'portrait', params: { borderWidth: 12, borderColor: '#2f2b2c', background: '#123456' } })
    expect(before.items.map((i) => i.assetId)).toEqual([assets[1], assets[2], assets[0], assets[3]])
    // Crop and fit followed their photo when the order changed.
    expect(before.items[0]).toMatchObject({ assetId: assets[1], crop: { cx: 0.25, cy: 0.75, zoom: 2.5 }, fit: 'fill' })
    expect(before.items[3]).toMatchObject({ assetId: assets[3], fit: 'fit' })
  })

  it('swaps and replaces photos: a swap keeps each crop, a replacement starts centred and keeps its place’s fit', async () => {
    const { db, assets } = await library()
    const project = createProject(db, { templateId: 'pair-equal-split', format: 'square', assetIds: assets.slice(0, 2) })
    edit(db, project.id, (d) => updateItem(updateItem(d, 0, { crop: { cx: 0.1, cy: 0.5, zoom: 2 } }), 1, { fit: 'fit', crop: { cx: 0.9, cy: 0.9, zoom: 3 } }))
    edit(db, project.id, (d) => swapItems(d, 0, 1))
    expect(getProject(db, project.id).items.map((i) => [i.assetId, i.crop.cx, i.fit])).toEqual([
      [assets[1], 0.9, 'fit'],
      [assets[0], 0.1, 'fill'],
    ])
    edit(db, project.id, (d) => replaceItem(d, 0, assets[7]!))
    expect(getProject(db, project.id).items[0]).toMatchObject({ assetId: assets[7], crop: { cx: 0.5, cy: 0.5, zoom: 1 }, fit: 'fit', fileName: 'IMG_0008.jpg' })
  })

  it('resets to the layout defaults, keeping the photos and their order', async () => {
    const { db, assets } = await library()
    const project = createProject(db, { templateId: 'pair-stacked', format: 'square', assetIds: assets.slice(0, 2) })
    edit(db, project.id, (d) => ({ ...swapItems(updateItem(d, 0, { fit: 'fit', crop: { cx: 0.2, cy: 0.2, zoom: 2 } }), 0, 1), params: { v: 1, margin: 0, borderWidth: 20 } }))
    edit(db, project.id, resetDesign)
    const reset = getProject(db, project.id)
    expect(reset.params).toEqual({ v: 1 })
    expect(reset.items.map((i) => [i.assetId, i.fit, i.crop])).toEqual([
      [assets[1], 'fill', { cx: 0.5, cy: 0.5, zoom: 1 }],
      [assets[0], 'fill', { cx: 0.5, cy: 0.5, zoom: 1 }],
    ])
  })

  it('refuses an invalid design as a whole, so nothing is half-saved', async () => {
    const { db, assets } = await library()
    const project = createProject(db, { templateId: 'pair-equal-split', format: 'square', assetIds: assets.slice(0, 2) })
    const before = getProject(db, project.id)
    const bad = (change: (d: Design) => unknown) => codeOf(() => edit(db, project.id, change as (d: Design) => Design))
    expect(bad((d) => updateItem(d, 0, { crop: { cx: 1.5, cy: 0.5, zoom: 1 } }))).toBe('INVALID_INPUT')
    expect(bad((d) => updateItem(d, 0, { crop: { cx: 0.5, cy: 0.5, zoom: 5 } }))).toBe('INVALID_INPUT')
    expect(bad((d) => updateItem(d, 0, { fit: 'stretch' as never }))).toBe('INVALID_INPUT')
    // The same photo twice, a photo that isn't in the catalog, or a photo count the layout can't take.
    expect(bad((d) => replaceItem(d, 1, assets[0]!))).toBe('INVALID_INPUT')
    expect(bad((d) => replaceItem(d, 1, '00000000-0000-4000-8000-000000000000'))).toBe('NOT_FOUND')
    expect(bad((d) => ({ ...d, items: [...d.items, { ...d.items[0]!, assetId: assets[5]! }] }))).toBe('INVALID_INPUT')
    // Settings are checked against the schema: no unknown keys, colours as #rrggbb, sizes within range.
    for (const params of [{ v: 1, background: 'red' }, { v: 1, margin: -4 }, { v: 1, script: 'x' }, { v: 2 }, { v: 1, borderWidth: 61 }, { v: 1, borderColor: 'url(x)' }]) {
      expect(bad((d) => ({ ...d, params }))).toBe('INVALID_INPUT')
    }
    expect(bad((d) => ({ ...d, format: 'poster' }))).toBe('INVALID_INPUT')
    expect(bad((d) => ({ ...d, templateVersion: 99 }))).toBe('INVALID_INPUT')
    expect(codeOf(() => renameProject(db, { projectId: project.id, title: '   ' }))).toBe('INVALID_INPUT')
    expect(getProject(db, project.id)).toEqual(before)
  })
})

describe('changing a project’s layout', () => {
  it('switches to another layout for the same number of photos, keeping order and crops; refuses one that doesn’t fit', async () => {
    const { db, assets } = await library()
    const project = createProject(db, { templateId: 'quartet-classic-grid', format: 'portrait', assetIds: assets.slice(0, 4) })
    edit(db, project.id, (d) => updateItem(d, 2, { crop: { cx: 0.2, cy: 0.8, zoom: 3 } }))
    edit(db, project.id, (d) => ({ ...d, templateId: 'quartet-lead-three', templateVersion: 1 }))
    const switched = getProject(db, project.id)
    expect(switched).toMatchObject({ templateId: 'quartet-lead-three', templateVersion: 1, title: 'Classic grid' })
    expect(switched.items.map((i) => i.assetId)).toEqual(assets.slice(0, 4))
    expect(switched.items[2]!.crop).toEqual({ cx: 0.2, cy: 0.8, zoom: 3 })
    // A two-photo layout can't hold four photos, and an unknown layout is refused; nothing changes either way.
    expect(codeOf(() => edit(db, project.id, (d) => ({ ...d, templateId: 'pair-stacked' })))).toBe('INVALID_INPUT')
    expect(codeOf(() => edit(db, project.id, (d) => ({ ...d, templateId: 'no-such-layout' })))).toBe('INVALID_INPUT')
    expect(getProject(db, project.id).templateId).toBe('quartet-lead-three')
  })
})

describe('photos that can’t be reached (AC6)', () => {
  it('names each unavailable photo by file and folder, while the draft stays editable', async () => {
    const { db, assets, sourceId } = await library()
    const project = createProject(db, { templateId: 'pair-equal-split', format: 'square', assetIds: assets.slice(0, 2) })
    expect(getProject(db, project.id).items.every((i) => i.available)).toBe(true)

    setSourceStatus(db, sourceId, 'disconnected')
    const offline = getProject(db, project.id)
    expect(offline.items.map((i) => [i.available, i.fileName, i.folderName])).toEqual([
      [false, 'IMG_0001.jpg', 'Summer'],
      [false, 'IMG_0002.jpg', 'Summer'],
    ])
    edit(db, project.id, (d) => updateItem(d, 0, { crop: { cx: 0.4, cy: 0.5, zoom: 1.5 } }))
    expect(getProject(db, project.id).items[0]?.crop.zoom).toBe(1.5)
  })
})

describe('deleting a project', () => {
  it('removes the project and its items only; every picture stays', async () => {
    const { db, assets } = await library()
    const project = createProject(db, { templateId: 'pair-equal-split', format: 'square', assetIds: assets.slice(0, 2) })
    deleteProject(db, project.id)
    expect(listProjects(db)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) FROM project_item').pluck().get()).toBe(0)
    expect(db.prepare('SELECT COUNT(*) FROM asset').pluck().get()).toBe(10)
  })
})
