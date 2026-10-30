/**
 * Integration tests for Memory Studio projects (AC6): photo counts per template, settings checked against their schema, crops and order restored exactly
 * after a restart, reordering that keeps each photo's crop, offline photos named, and deleting a project
 * leaving every photo in place.
 */

import { describe, expect, it } from 'vitest'
import {
  createProject,
  deleteProject,
  getProject,
  listProjects,
  reorderProject,
  setItemCrop,
  updateProject,
} from '../../src/main/catalog/repositories/projects'
import { setSourceStatus } from '../../src/main/catalog/repositories/sources'
import { codeOf, openTestCatalog, seedAssets, seedSource, tempProfile } from './helpers'

async function library(file = tempProfile().catalogFile) {
  const db = await openTestCatalog(file)
  const source = seedSource(db, 'Summer')
  const assets = seedAssets(db, source.sourceId, 10)
  return { db, assets, sourceId: source.sourceId }
}

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
  it('reopens after a restart with the same order, crops, title, format and settings', async () => {
    const { catalogFile } = tempProfile()
    const { db, assets } = await library(catalogFile)
    const project = createProject(db, { templateId: 'carousel-full', format: 'square', assetIds: assets.slice(0, 3) })
    setItemCrop(db, { projectId: project.id, position: 1, crop: { cx: 0.25, cy: 0.75, zoom: 2.5 } })
    reorderProject(db, { projectId: project.id, assetIds: [assets[2]!, assets[1]!, assets[0]!] })
    updateProject(db, { projectId: project.id, title: 'Beach carousel', format: 'portrait', params: { v: 1, background: '#ffffff', margin: 30 } })
    const before = getProject(db, project.id)
    db.close()

    const reopened = await openTestCatalog(catalogFile)
    expect(getProject(reopened, project.id)).toEqual(before)
    expect(before.items.map((i) => i.assetId)).toEqual([assets[2], assets[1], assets[0]])
    // The crop followed its photo when the order changed.
    expect(before.items[1]).toMatchObject({ assetId: assets[1], crop: { cx: 0.25, cy: 0.75, zoom: 2.5 } })
  })

  it('refuses crops out of range and reorders that change which photos are in it', async () => {
    const { db, assets } = await library()
    const project = createProject(db, { templateId: 'pair-equal-split', format: 'square', assetIds: assets.slice(0, 2) })
    expect(codeOf(() => setItemCrop(db, { projectId: project.id, position: 0, crop: { cx: 1.5, cy: 0.5, zoom: 1 } }))).toBe('INVALID_INPUT')
    expect(codeOf(() => setItemCrop(db, { projectId: project.id, position: 0, crop: { cx: 0.5, cy: 0.5, zoom: 5 } }))).toBe('INVALID_INPUT')
    expect(codeOf(() => setItemCrop(db, { projectId: project.id, position: 7, crop: { cx: 0.5, cy: 0.5, zoom: 1 } }))).toBe('NOT_FOUND')
    expect(codeOf(() => reorderProject(db, { projectId: project.id, assetIds: [assets[0]!, assets[5]!] }))).toBe('INVALID_INPUT')
    expect(codeOf(() => updateProject(db, { projectId: project.id, title: '   ' }))).toBe('INVALID_INPUT')
    // Settings are checked against the schema: no unknown keys, colours as #rrggbb, margins within range.
    for (const params of [{ v: 1, background: 'red' }, { v: 1, margin: -4 }, { v: 1, script: 'x' }, { v: 2 }]) {
      expect(codeOf(() => updateProject(db, { projectId: project.id, params: params as never }))).toBe('INVALID_INPUT')
    }
    expect(codeOf(() => updateProject(db, { projectId: project.id, format: 'poster' }))).toBe('INVALID_INPUT')
    expect(getProject(db, project.id).items.map((i) => i.assetId)).toEqual(assets.slice(0, 2))
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
    setItemCrop(db, { projectId: project.id, position: 0, crop: { cx: 0.4, cy: 0.5, zoom: 1.5 } })
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
